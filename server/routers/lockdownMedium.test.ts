import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 1111 收口（中风险）：首页访客入口限流与转义、验证码 / 注册 / 密码登录限流、假 webhook 与邀请码仅授权可进、envStatus 只给监管。离线替身。 */
const h = vi.hoisted(() => ({ simpleMail: vi.fn(), mail: vi.fn(), getDb: vi.fn() }));
vi.mock("../services/smtp-mailer", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendSimpleMail: h.simpleMail,
  sendMailWithAttachments: h.mail,
}));
vi.mock("../db", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), getDb: h.getDb }));
import { inviteApplyRouter } from "./inviteApply";
import { educationRouter } from "./education";
import { emailOtpRouter } from "./emailOtp";
import { emailAuthRouter } from "./emailAuth";
import { paymentRouter } from "./payment";
import { betaCodeRouter } from "./betaCode";
import { resetUsageLimitsForTest, USAGE_LIMITS } from "../_core/usageLimits";
import { decideLegacyJobsOpAccess, legacyJobsOpAccess } from "../../shared/internalMediaEndpointPolicy";
import type { TrpcContext } from "../_core/context";

function ctx(user: { id: number; role: string } | null, ip = "10.0.0.1"): TrpcContext {
  return {
    user: user ? ({ openId: `open-${user.id}`, name: "测试", email: null, ...user } as never) : null,
    req: { protocol: "https", headers: {}, ip } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
    clientDisconnected: new AbortController().signal,
  };
}

beforeEach(() => {
  resetUsageLimitsForTest();
  h.simpleMail.mockReset().mockResolvedValue(undefined);
  h.mail.mockReset().mockResolvedValue(undefined);
  h.getDb.mockReset().mockResolvedValue(null);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("inviteApply.submit（首页访客入口，保留匿名）", () => {
  const input = { purpose: "<img src=x onerror=alert(1)>做短剧", contact: "<b>wx</b>", name: "<script>x</script>" };
  it("匿名放行，邮件 HTML 已转义", async () => {
    await inviteApplyRouter.createCaller(ctx(null)).submit(input);
    const html = String(h.simpleMail.mock.calls[0][0].html);
    expect(html).not.toMatch(/<img src=x|<script>|<b>wx<\/b>/);
    expect(html).toContain("&lt;script&gt;");
  });
  it("同 IP 超限 → TOO_MANY_REQUESTS，不再发信；换 IP 不受影响", async () => {
    for (let i = 0; i < USAGE_LIMITS.visitorInquiry.perMinute; i++) await inviteApplyRouter.createCaller(ctx(null)).submit(input);
    const before = h.simpleMail.mock.calls.length;
    await expect(inviteApplyRouter.createCaller(ctx(null)).submit(input)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(h.simpleMail.mock.calls.length).toBe(before);
    await inviteApplyRouter.createCaller(ctx(null, "10.0.0.2")).submit(input);
  });
});

describe("education.inquiry（首页访客入口，保留匿名）", () => {
  it("换邮箱也绕不过按 IP 的闸门", async () => {
    for (let i = 0; i < USAGE_LIMITS.visitorInquiry.perMinute; i++) {
      await educationRouter.createCaller(ctx(null)).inquiry({ name: "n", email: `a${i}@example.com` });
    }
    await expect(educationRouter.createCaller(ctx(null)).inquiry({ name: "n", email: "z@example.com" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("emailOtp.sendCode / emailAuth", () => {
  it("验证码：换邮箱也受按 IP 的闸门约束", async () => {
    for (let i = 0; i < USAGE_LIMITS.otpSend.perMinute; i++) await emailOtpRouter.createCaller(ctx(null)).sendCode({ email: `x${i}@example.com` });
    await expect(emailOtpRouter.createCaller(ctx(null)).sendCode({ email: "y@example.com" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
  it("密码登录：同一邮箱跨 IP 撞库也会被拒", async () => {
    for (let i = 0; i < USAGE_LIMITS.passwordLogin.perMinute; i++) {
      await expect(emailAuthRouter.createCaller(ctx(null, `10.1.0.${i}`)).login({ email: "victim@example.com", password: `p${i}` })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    }
    await expect(emailAuthRouter.createCaller(ctx(null, "10.1.9.9")).login({ email: "victim@example.com", password: "x" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
  it("注册：按 IP 闸门", async () => {
    for (let i = 0; i < USAGE_LIMITS.accountRegister.perMinute; i++) {
      await expect(emailAuthRouter.createCaller(ctx(null)).register({ email: `r${i}@example.com`, password: "123456" })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    }
    await expect(emailAuthRouter.createCaller(ctx(null)).register({ email: "r9@example.com", password: "123456" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

describe("payment.handleStripeWebhook / betaCode", () => {
  it("假 webhook：未登录 / 普通用户 FORBIDDEN", async () => {
    const input = { paymentIntentId: "pi_1", status: "succeeded" as const };
    await expect(paymentRouter.createCaller(ctx(null)).handleStripeWebhook(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(paymentRouter.createCaller(ctx({ id: 7, role: "user" })).handleStripeWebhook(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("邀请码：未登录 UNAUTHORIZED，不碰库（不再先建表）", async () => {
    await expect(betaCodeRouter.createCaller(ctx(null)).generate({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(betaCodeRouter.createCaller(ctx(null)).listMine()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(h.getDb).not.toHaveBeenCalled();
  });
});

describe("/api/jobs?op=envStatus", () => {
  it("只给监管：未登录 401、普通用户 403、监管放行", () => {
    const access = legacyJobsOpAccess("envStatus");
    expect(access).toBe("supervisor");
    expect(decideLegacyJobsOpAccess(access!, { internal: false })).toEqual({ ok: false, status: 401 });
    expect(decideLegacyJobsOpAccess(access!, { internal: false, userId: 7, role: "user" })).toEqual({ ok: false, status: 403 });
    expect(decideLegacyJobsOpAccess(access!, { internal: false, userId: 1, role: "supervisor" })).toEqual({ ok: true });
  });
});
