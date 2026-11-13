import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 1111 收口：全站数据 / 他人隐私 / 群发导出 → 仅管理员；访客可写入口保留匿名但限流；成长营同步分析入口加闸门。
 * 离线替身：库、导出、发信全替身。
 */
const h = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), review: vi.fn(), exportCsv: vi.fn(), mail: vi.fn() }));
vi.mock("./db", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getGuestbookMessages: h.list,
  createGuestbookMessage: h.create,
  createMvReview: h.review,
}));
vi.mock("./growth/trendStore", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  exportTrendCollectionsCsv: h.exportCsv,
}));
vi.mock("./services/smtp-mailer", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendMailWithAttachments: h.mail,
}));
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { consumeUsage, resetUsageLimitsForTest, USAGE_LIMITS } from "./_core/usageLimits";

function ctx(user: { id: number; role: string; email?: string | null } | null, ip = "10.0.0.1"): TrpcContext {
  return {
    user: user ? ({ openId: `open-${user.id}`, name: "测试", email: null, ...user } as never) : null,
    req: { protocol: "https", headers: {}, ip } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
    clientDisconnected: new AbortController().signal,
  };
}
const caller = (user: Parameters<typeof ctx>[0], ip?: string) => appRouter.createCaller(ctx(user, ip));
const USER = { id: 7, role: "user" };
const ADMIN = { id: 1, role: "admin", email: "boss@mvstudiopro.com" };

beforeEach(() => {
  resetUsageLimitsForTest();
  h.list.mockReset().mockResolvedValue([{ id: 1, name: "访客", email: "v@example.com", phone: "138", company: "c", subject: "s", message: "m" }]);
  h.create.mockReset().mockResolvedValue(1);
  h.review.mockReset().mockResolvedValue(1);
  h.exportCsv.mockReset().mockResolvedValue({ rows: 3, manifestPath: "/data/growth/manifest.json", files: [{ platform: "douyin", filePath: "/data/growth/douyin.csv" }] });
  h.mail.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("GROWTH_TREND_REPORT_EMAIL", "internal-report@corp.example");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("guestbook", () => {
  it("list：未登录 / 普通用户 FORBIDDEN，不读库；管理员可读", async () => {
    await expect(caller(null).guestbook.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(USER).guestbook.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.list).not.toHaveBeenCalled();
    expect(await caller(ADMIN).guestbook.list()).toHaveLength(1);
  });

  it("submit：保留匿名；字段超长 BAD_REQUEST；同 IP 超限 TOO_MANY_REQUESTS", async () => {
    const msg = { name: "访客", subject: "合作", message: "你好" };
    expect(await caller(null).guestbook.submit(msg)).toEqual({ success: true, id: 1 });
    await expect(caller(null).guestbook.submit({ ...msg, message: "字".repeat(5001) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // 闸门在入参校验之前：上面那次超长请求也占了一次额度
    for (let i = 2; i < USAGE_LIMITS.guestbookSubmit.perMinute; i++) await caller(null).guestbook.submit(msg);
    await expect(caller(null).guestbook.submit(msg)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    // 换 IP 不受影响
    expect(await caller(null, "10.0.0.9").guestbook.submit(msg)).toEqual({ success: true, id: 1 });
  });
});

describe("mvReviews.submit", () => {
  it("保留匿名，按 IP 限流", async () => {
    const review = { mvId: "mv-1", nickname: "n", rating: 5, comment: "好" };
    for (let i = 0; i < USAGE_LIMITS.guestbookSubmit.perMinute; i++) await caller(null, "10.0.0.3").mvReviews.submit(review);
    await expect(caller(null, "10.0.0.3").mvReviews.submit(review)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("mvAnalysis.exportGrowthTrendsCsv", () => {
  it("未登录 / 普通用户 FORBIDDEN，不导出不发信", async () => {
    await expect(caller(null).mvAnalysis.exportGrowthTrendsCsv({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(USER).mvAnalysis.exportGrowthTrendsCsv({ email: "attacker@evil.example" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.exportCsv).not.toHaveBeenCalled();
    expect(h.mail).not.toHaveBeenCalled();
  });

  it("管理员：收件人固定为本人登记邮箱（忽略入参），响应不带任何邮箱与服务器路径", async () => {
    const result = await caller(ADMIN).mvAnalysis.exportGrowthTrendsCsv({ email: "attacker@evil.example" });
    expect(h.mail).toHaveBeenCalledTimes(1);
    expect(h.mail.mock.calls[0][0].to).toBe("boss@mvstudiopro.com");
    expect(JSON.stringify(result)).not.toMatch(/@|\/data\//);
    expect(result).toMatchObject({ success: true, rows: 3, fileCount: 1, emailed: true });
  });

  it("管理员未登记邮箱 → PRECONDITION_FAILED，不导出", async () => {
    await expect(caller({ id: 2, role: "admin", email: null }).mvAnalysis.exportGrowthTrendsCsv({})).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.exportCsv).not.toHaveBeenCalled();
  });
});

describe("mvAnalysis.getGrowthSystemStatus", () => {
  it("未登录 → UNAUTHORIZED", async () => {
    await expect(caller(null).mvAnalysis.getGrowthSystemStatus()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("成长营同步分析入口：须登录 + 闸门", () => {
  const cases = [
    ["synthesizeGrowthCampAnalyses", (c: ReturnType<typeof caller>) => c.mvAnalysis.synthesizeGrowthCampAnalyses({} as never)],
  ] as const;
  it.each(cases)("%s：未登录 401 / 用户放行（停在入参校验）/ 超限 429", async (_n, run) => {
    await expect(run(caller(null))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(run(caller(USER))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    resetUsageLimitsForTest();
    for (let i = 0; i < USAGE_LIMITS.growthCampAnalyze.perMinute; i++) consumeUsage(USAGE_LIMITS.growthCampAnalyze, ["u:7"]);
    await expect(run(caller(USER))).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});
