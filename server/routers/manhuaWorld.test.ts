import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context.js";

const mocks = vi.hoisted(() => ({
  createManhuaWorldTask: vi.fn(),
  getManhuaWorldTask: vi.fn(),
  listManhuaWorldTasks: vi.fn(),
  retryManhuaWorldTask: vi.fn(),
  deleteManhuaWorldTask: vi.fn(),
}));
vi.mock("../services/manhuaWorldTask.js", () => mocks);

import { manhuaWorldRouter } from "./manhuaWorld.js";

function ctx(role: "user" | "admin", id = 7): TrpcContext {
  return { user: { id, role, openId: `test-${role}-${id}` } } as unknown as TrpcContext;
}

const view = {
  taskId: "mw_0123456789abcdef01234567",
  sceneRef: "scene:deck",
  sourceVersion: "gs://b/deck.png",
  displayName: "船甲板",
  model: "marble-1.1" as const,
  status: "running" as const,
  createdAt: "2026-09-16T00:00:00.000Z",
  updatedAt: "2026-09-16T00:00:01.000Z",
};

describe("manhuaWorldRouter", () => {
  beforeEach(() => {
    mocks.createManhuaWorldTask.mockReset().mockResolvedValue(view);
    mocks.getManhuaWorldTask.mockReset().mockResolvedValue(view);
    mocks.listManhuaWorldTasks.mockReset().mockResolvedValue([view]);
    mocks.retryManhuaWorldTask.mockReset().mockResolvedValue(view);
    mocks.deleteManhuaWorldTask.mockReset().mockResolvedValue(true);
  });

  it("管理员提交：模型默认 1.1、image 提示 isPano 默认 auto、gs:// 透传；http 场景图与坏模型被 zod 拒", async () => {
    const admin = manhuaWorldRouter.createCaller(ctx("admin"));
    await admin.submit({
      sceneRef: "scene:deck",
      sourceVersion: "gs://b/deck.png",
      sourceImageUrl: "https://signed/deck.png",
      sourceImageGcsUri: "gs://b/deck.png",
      displayName: "船甲板",
      prompt: { type: "image", textPrompt: "暴风雨夜" },
    });
    expect(mocks.createManhuaWorldTask).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 7, model: "marble-1.1", sourceImageGcsUri: "gs://b/deck.png", prompt: { type: "image", isPano: "auto", textPrompt: "暴风雨夜" } }),
    );
    await expect(
      admin.submit({ sceneRef: "s", sourceVersion: "v", sourceImageUrl: "http://x/deck.png", displayName: "d", prompt: { type: "text", textPrompt: "夜雨" } }),
    ).rejects.toThrow();
    await expect(
      admin.submit({ sceneRef: "s", sourceVersion: "v", sourceImageUrl: "https://x/deck.png", displayName: "d", model: "marble-9" as never, prompt: { type: "text", textPrompt: "夜雨" } }),
    ).rejects.toThrow();
  });

  it("PR-11/WL-D01 layout 提示：depthPanoUrl 必须 https、textPrompt 必填、depthMeta 必填且 0<zMin<zMax、2:1、编码固定；合格的原样传给任务层", async () => {
    const admin = manhuaWorldRouter.createCaller(ctx("admin"));
    const depthMeta = { width: 1024, height: 512, zMin: 0.3, zMax: 60, encoding: "log_inverse_01" as const };
    await admin.submit({ sceneRef: "s", sourceVersion: "v", sourceImageUrl: "https://x/d.png", displayName: "d", prompt: { type: "layout", depthPanoUrl: "https://x/d.png", depthMeta, textPrompt: "雨夜甲板" } });
    expect(mocks.createManhuaWorldTask).toHaveBeenCalledWith(expect.objectContaining({ prompt: { type: "layout", depthPanoUrl: "https://x/d.png", depthMeta, textPrompt: "雨夜甲板" } }));
    const base = { sceneRef: "s", sourceVersion: "v", sourceImageUrl: "https://x/d.png", displayName: "d" };
    await expect(admin.submit({ ...base, prompt: { type: "layout", depthPanoUrl: "http://x/d.png", depthMeta, textPrompt: "雨夜甲板" } })).rejects.toThrow();
    await expect(admin.submit({ ...base, prompt: { type: "layout", depthPanoUrl: "https://x/d.png", depthMeta, textPrompt: "" } })).rejects.toThrow();
    await expect(admin.submit({ ...base, prompt: { type: "layout", depthPanoUrl: "https://x/d.png", textPrompt: "雨夜" } as never })).rejects.toThrow();
    await expect(admin.submit({ ...base, prompt: { type: "layout", depthPanoUrl: "https://x/d.png", depthMeta: { ...depthMeta, zMin: 0 }, textPrompt: "雨夜" } })).rejects.toThrow();
    await expect(admin.submit({ ...base, prompt: { type: "layout", depthPanoUrl: "https://x/d.png", depthMeta: { ...depthMeta, zMax: 0.3 }, textPrompt: "雨夜" } })).rejects.toThrow();
    await expect(admin.submit({ ...base, prompt: { type: "layout", depthPanoUrl: "https://x/d.png", depthMeta: { ...depthMeta, height: 500 }, textPrompt: "雨夜" } })).rejects.toThrow();
    await expect(admin.submit({ ...base, prompt: { type: "layout", depthPanoUrl: "https://x/d.png", depthMeta: { ...depthMeta, encoding: "near_bright_linear" as never }, textPrompt: "雨夜" } })).rejects.toThrow();
    expect(mocks.createManhuaWorldTask).toHaveBeenCalledTimes(1);
  });

  it("普通用户不可用；服务错误映射为 TRPC 码", async () => {
    const user = manhuaWorldRouter.createCaller(ctx("user"));
    await expect(user.listMine()).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|UNAUTHORIZED/) });
    const admin = manhuaWorldRouter.createCaller(ctx("admin"));
    mocks.createManhuaWorldTask.mockRejectedValueOnce(new Error("manhua_world_service_unavailable"));
    await expect(
      admin.submit({ sceneRef: "s", sourceVersion: "v", sourceImageUrl: "https://x/d.png", displayName: "d", prompt: { type: "text", textPrompt: "夜雨" } }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    mocks.retryManhuaWorldTask.mockRejectedValueOnce(new Error("manhua_world_retry_reconcile_forbidden"));
    await expect(admin.retry({ taskId: view.taskId })).rejects.toMatchObject({ code: "CONFLICT" });
    mocks.getManhuaWorldTask.mockResolvedValueOnce(null);
    await expect(admin.getStatus({ taskId: view.taskId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    mocks.deleteManhuaWorldTask.mockRejectedValueOnce(new Error("manhua_world_delete_busy"));
    await expect(admin.remove({ taskId: view.taskId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await admin.remove({ taskId: view.taskId })).toEqual({ ok: true });
  });
});
