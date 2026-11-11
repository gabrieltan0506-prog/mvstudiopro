import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 1111 收口：AI 客服四个入口须登录、会话绑定本人、用量闸门、固定便宜档模型、提示词与失败文案无模型名 / 个人邮箱。离线替身。 */
const h = vi.hoisted(() => ({ invoke: vi.fn(), notify: vi.fn() }));
vi.mock("../_core/llm", () => ({ invokeLLM: h.invoke }));
vi.mock("../_core/notification", () => ({ notifyOwner: h.notify }));
import { customerServiceRouter, CUSTOMER_SERVICE_MAX_MESSAGE_CHARS } from "./customerService";
import { resetUsageLimitsForTest, USAGE_LIMITS } from "../_core/usageLimits";
import type { TrpcContext } from "../_core/context";

function ctx(user: { id: number; role: string } | null, ip = "10.0.0.1"): TrpcContext {
  return {
    user: user ? ({ openId: `open-${user.id}`, name: "测试", email: null, ...user } as never) : null,
    req: { protocol: "https", headers: {}, ip } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
    clientDisconnected: new AbortController().signal,
  };
}
const caller = (user: { id: number; role: string } | null, ip?: string) => customerServiceRouter.createCaller(ctx(user, ip));
const U7 = { id: 7, role: "user" };
const U8 = { id: 8, role: "user" };
let seq = 0;
const sid = () => `sess-${Date.now()}-${seq++}`;

beforeEach(() => {
  resetUsageLimitsForTest();
  h.invoke.mockReset().mockResolvedValue({ choices: [{ message: { content: "你好" } }] });
  h.notify.mockReset().mockResolvedValue(false);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("sendMessage", () => {
  it("未登录 → UNAUTHORIZED，不调模型", async () => {
    await expect(caller(null).sendMessage({ sessionId: sid(), message: "你好" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("登录放行：固定 flash 档、上限 1024，系统提示词不含模型 / 供应商名", async () => {
    const result = await caller(U7).sendMessage({ sessionId: sid(), message: "你好" });
    expect(result.response).toBe("你好");
    const params = h.invoke.mock.calls[0][0];
    expect(params).toMatchObject({ model: "flash", maxTokens: 1024 });
    expect(params).not.toHaveProperty("modelName");
    expect(params).not.toHaveProperty("provider");
    expect(params.messages[0].content).not.toMatch(/Suno|Kling|NBP|Nano ?Banana|Trellis|Forge|Gemini|GPT|Omni Video/i);
  });

  it("消息超长 → BAD_REQUEST，不调模型", async () => {
    await expect(caller(U7).sendMessage({ sessionId: sid(), message: "字".repeat(CUSTOMER_SERVICE_MAX_MESSAGE_CHARS + 1) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("超过每分钟上限 → TOO_MANY_REQUESTS，被拒请求不调模型", async () => {
    for (let i = 0; i < USAGE_LIMITS.customerServiceChat.perMinute; i++) await caller(U7).sendMessage({ sessionId: sid(), message: "你好" });
    const before = h.invoke.mock.calls.length;
    await expect(caller(U7).sendMessage({ sessionId: sid(), message: "你好" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(h.invoke.mock.calls.length).toBe(before);
  });

  it("模型失败：回固定文案，不带上游原文", async () => {
    h.invoke.mockRejectedValue(new Error("EvoLink 500 https://api.example/v1 gemini-3.8-flash"));
    const result = await caller(U7).sendMessage({ sessionId: sid(), message: "你好" });
    expect(result.response).not.toMatch(/evolink|https?:|gemini/i);
  });

  it("会话绑定本人：别人拿到会话号续写 → FORBIDDEN，读历史为空", async () => {
    const id = sid();
    await caller(U7).sendMessage({ sessionId: id, message: "我的订单号 123" });
    await expect(caller(U8, "10.0.0.2").sendMessage({ sessionId: id, message: "偷看" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await caller(U8, "10.0.0.2").getHistory({ sessionId: id })).toEqual({ messages: [], escalated: false });
    const own = await caller(U7).getHistory({ sessionId: id });
    expect(own.messages.map(m => m.content)).toContain("我的订单号 123");
  });
});

describe("getHistory / escalate / submitContactForm", () => {
  it("未登录一律 UNAUTHORIZED", async () => {
    await expect(caller(null).getHistory({ sessionId: sid() })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller(null).escalate({ sessionId: sid() })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller(null).submitContactForm({ email: "a@b.com", content: "x" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("通知失败文案只给站内客服邮箱，不出现个人邮箱", async () => {
    const id = sid();
    await caller(U7).sendMessage({ sessionId: id, message: "你好" });
    const esc = await caller(U7).escalate({ sessionId: id });
    const form = await caller(U7).submitContactForm({ email: "a@b.com", content: "咨询" });
    for (const r of [esc, form]) {
      expect(r.success).toBe(false);
      expect(r.message).toContain("support@mvstudiopro.com");
      expect(r.message).not.toMatch(/gmail|163\.com/);
    }
  });

  it("通知类入口超限 → TOO_MANY_REQUESTS，不再发通知", async () => {
    for (let i = 0; i < USAGE_LIMITS.contactNotify.perMinute; i++) await caller(U7).submitContactForm({ email: "a@b.com", content: "咨询" });
    const before = h.notify.mock.calls.length;
    await expect(caller(U7).submitContactForm({ email: "a@b.com", content: "咨询" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(h.notify.mock.calls.length).toBe(before);
  });
});
