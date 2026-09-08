import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
const calls = vi.hoisted(() => ({ generate: vi.fn(), get: vi.fn(), list: vi.fn() }));
vi.mock("../services/canvasDialogueOperation", async importOriginal => ({
  ...await importOriginal<typeof import("../services/canvasDialogueOperation")>(),
  generateCanvasDialogue: calls.generate, getCanvasDialogue: calls.get, listCanvasDialogue: calls.list,
}));
import { canvasAudioRouter } from "./canvasAudio";
const input = { billingRequestId: "12345678-1234-4123-8123-123456789abc", input: "别怕，站我身后。", voice: "longanlufeng", speakerZh: "墨屠", voiceStateZh: "变身后" };
const caller = (id?: number) => canvasAudioRouter.createCaller({ user: id ? { id, role: "user" } : null } as TrpcContext);
beforeEach(() => vi.clearAllMocks());
describe("逐句配音入口鉴权与输入", () => {
  it("未登录不能生成或读取", async () => {
    await expect(caller().generateDialogue(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller().getDialogue({ billingRequestId: input.billingRequestId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(calls.generate).not.toHaveBeenCalled();
  });
  it("普通创作者可用，用户身份仅取会话", async () => {
    calls.generate.mockResolvedValue({ status: "running" });
    await caller(7).generateDialogue(input);
    expect(calls.generate).toHaveBeenCalledWith(7, input);
    await expect(caller(7).generateDialogue({ ...input, userId: 8 } as typeof input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("查询和列表保持本人身份，列表限制显式校验", async () => {
    calls.get.mockResolvedValue(null); calls.list.mockResolvedValue([]);
    expect(await caller(7).getDialogue({ billingRequestId: input.billingRequestId })).toBeNull();
    await caller(7).listDialogue({});
    expect(calls.get).toHaveBeenCalledWith(7, input.billingRequestId);
    expect(calls.list).toHaveBeenCalledWith(7, 30);
    await expect(caller(7).listDialogue({ limit: 101 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("查询错误不会将内部服务错误透出", async () => {
    calls.get.mockRejectedValue(new Error("internal provider database detail"));
    await expect(caller(7).getDialogue({ billingRequestId: input.billingRequestId })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "配音操作未能确认，请查询原任务，勿重复生成" });
  });
});
