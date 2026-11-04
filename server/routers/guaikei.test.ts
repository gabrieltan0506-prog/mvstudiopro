import { describe, expect, it, vi } from "vitest";
const methods = vi.hoisted(() => ({ quote: vi.fn(async () => ({ configured: false })), list: vi.fn(async () => []), get: vi.fn(), submit: vi.fn(), poll: vi.fn() }));
vi.mock("../growth/guaikei/service", () => ({ guaikeiService: methods }));
import { guaikeiRouter } from "./guaikei";
describe("共享付费账户权限", () => {
  it.each([null, "user", "supervisor"])("%s不能触发采集", async role => {
    const caller = guaikeiRouter.createCaller({ user: role ? { id: 4, role } : null } as any);
    await expect(caller.submit({ request: { platform: "douyin", operation: "search", query: "AI", limit: 10 }, requestId: "11111111-1111-4111-8111-111111111111", confirmedReservedCents: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(methods.submit).not.toHaveBeenCalled();
  });
  it("管理员使用真实ctx身份，客户端无法替换owner", async () => {
    const caller = guaikeiRouter.createCaller({ user: { id: 7, role: "admin" } } as any);
    await caller.list(); expect(methods.list).toHaveBeenCalledWith(7);
  });
});
