import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 1111 收口：成长营 / 平台 / 工作台里会调模型的入口（原先匿名可调、不扣费）。
 * 中间件顺序：登录 → 用量闸门 → 入参校验 → 业务。用非法入参让请求停在校验层（BAD_REQUEST），
 * 证明登录与闸门已放行且不触达任何业务 / 上游；超限用预先记满的额度验证。
 */
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { consumeUsage, resetUsageLimitsForTest, USAGE_LIMITS, type UsageLimitSpec } from "./_core/usageLimits";

function ctx(user: { id: number; role: string } | null, ip = "10.0.0.1"): TrpcContext {
  return {
    user: user ? ({ openId: `open-${user.id}`, name: "测试", email: null, ...user } as never) : null,
    req: { protocol: "https", headers: {}, ip } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
    clientDisconnected: new AbortController().signal,
  };
}
const caller = (user: { id: number; role: string } | null) => appRouter.createCaller(ctx(user));
const USER = { id: 7, role: "user" };
const ADMIN = { id: 1, role: "admin" };
const fetchMock = vi.fn();

beforeEach(() => {
  resetUsageLimitsForTest();
  fetchMock.mockReset().mockRejectedValue(new Error("不应访问任何上游"));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const fillQuota = (spec: UsageLimitSpec, subject = "u:7") => {
  for (let i = 0; i < spec.perMinute; i++) expect(consumeUsage(spec, [subject]).ok).toBe(true);
};

type Case = { name: string; spec: UsageLimitSpec; run: (c: ReturnType<typeof caller>) => Promise<unknown> };
const LOGIN_CASES: Case[] = [
  { name: "mvAnalysis.getGrowthSnapshot", spec: USAGE_LIMITS.growthSnapshot, run: c => c.mvAnalysis.getGrowthSnapshot({} as never) },
  { name: "mvAnalysis.getPlatformDashboard", spec: USAGE_LIMITS.platformDashboard, run: c => c.mvAnalysis.getPlatformDashboard({ windowDays: 999 } as never) },
  { name: "ambient.dashboardNews", spec: USAGE_LIMITS.ambientNews, run: c => c.ambient.dashboardNews({ lat: 999 } as never) },
  { name: "ambient.hybridDashboard", spec: USAGE_LIMITS.ambientNews, run: c => c.ambient.hybridDashboard({ lat: 999 } as never) },
  { name: "ambient.dashboardLive", spec: USAGE_LIMITS.ambientLive, run: c => c.ambient.dashboardLive({ lat: 999 } as never) },
];

describe.each(LOGIN_CASES)("$name：须登录 + 用量闸门", ({ spec, run }) => {
  it("未登录 → UNAUTHORIZED，不触达上游", async () => {
    await expect(run(caller(null))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("普通用户放行（停在入参校验）", async () => {
    await expect(run(caller(USER))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("超过每分钟上限 → TOO_MANY_REQUESTS", async () => {
    fillQuota(spec);
    await expect(run(caller(USER))).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("mvAnalysis.getPlatformContent：前台无调用点 → 仅管理员 / 监管", () => {
  const run = (c: ReturnType<typeof caller>) => c.mvAnalysis.getPlatformContent({ windowDays: 999 } as never);
  it("未登录 / 普通用户 → FORBIDDEN", async () => {
    await expect(run(caller(null))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(run(caller(USER))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("管理员放行（停在入参校验）；超限被拒", async () => {
    await expect(run(caller(ADMIN))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    resetUsageLimitsForTest();
    fillQuota(USAGE_LIMITS.platformContent, "u:1");
    await expect(run(caller(ADMIN))).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});
