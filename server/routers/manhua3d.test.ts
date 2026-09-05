import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context.js";

const mocks = vi.hoisted(() => ({
  createManhua3dTask: vi.fn(),
  getManhua3dTask: vi.fn(),
  importExistingManhua3dAsset: vi.fn(),
  retryManhua3dTask: vi.fn(),
}));

vi.mock("../services/manhua3dTask.js", () => mocks);

import { manhua3dRouter } from "./manhua3d.js";

function ctx(role: "user" | "admin" | "supervisor", id = 7): TrpcContext {
  return {
    user: { id, role, openId: `test-${role}-${id}` },
  } as unknown as TrpcContext;
}

const taskView = {
  taskId: "m3d_0123456789abcdef01234567",
  assetRef: "character:black-horse",
  sourceVersion: "sha256:test-v1",
  sourceImageUrl: "https://assets.test/black-horse-front.png",
  status: "running" as const,
  predictionId: "pred-test",
  createdAt: "2026-09-04T00:00:00.000Z",
  updatedAt: "2026-09-04T00:00:01.000Z",
};

describe("manhua3dRouter", () => {
  beforeEach(() => {
    mocks.createManhua3dTask.mockReset().mockResolvedValue(taskView);
    mocks.getManhua3dTask.mockReset().mockResolvedValue(taskView);
    mocks.importExistingManhua3dAsset.mockReset().mockResolvedValue({
      ...taskView,
      status: "succeeded",
      glbGcsUri: "gs://test-bucket/uploads/u7/existing.glb",
      glbUrl: "https://signed.test/existing.glb",
    });
    mocks.retryManhua3dTask.mockReset().mockResolvedValue(taskView);
  });

  it("普通用户不能提交或查询三维任务", async () => {
    const caller = manhua3dRouter.createCaller(ctx("user"));
    await expect(
      caller.submit({
        assetRef: "character:black-horse",
        sourceVersion: "sha256:test-v1",
        sourceImageUrl: "https://assets.test/black-horse-front.png",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.getStatus({ taskId: taskView.taskId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.retry({ taskId: taskView.taskId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.importExisting({
        assetRef: taskView.assetRef,
        sourceVersion: taskView.sourceVersion,
        sourceImageUrl: taskView.sourceImageUrl,
        glbGcsUri: "gs://test-bucket/uploads/u7/existing.glb",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.createManhua3dTask).not.toHaveBeenCalled();
    expect(mocks.getManhua3dTask).not.toHaveBeenCalled();
    expect(mocks.retryManhua3dTask).not.toHaveBeenCalled();
    expect(mocks.importExistingManhua3dAsset).not.toHaveBeenCalled();
  });

  it("admin 可登记本人已上传的 GLB，服务层负责归属和文件验真", async () => {
    const caller = manhua3dRouter.createCaller(ctx("admin"));
    await expect(
      caller.importExisting({
        assetRef: taskView.assetRef,
        sourceVersion: taskView.sourceVersion,
        sourceImageUrl: taskView.sourceImageUrl,
        glbGcsUri: "gs://test-bucket/uploads/u7/existing.glb",
      }),
    ).resolves.toMatchObject({ status: "succeeded" });
    expect(mocks.importExistingManhua3dAsset).toHaveBeenCalledWith({
      userId: 7,
      assetRef: taskView.assetRef,
      sourceVersion: taskView.sourceVersion,
      sourceImageUrl: taskView.sourceImageUrl,
      glbGcsUri: "gs://test-bucket/uploads/u7/existing.glb",
    });
  });

  it("导入伪造 GLB 时返回可操作的 BAD_REQUEST", async () => {
    mocks.importExistingManhua3dAsset.mockRejectedValue(
      new Error("invalid_glb_magic"),
    );
    const caller = manhua3dRouter.createCaller(ctx("admin"));
    await expect(
      caller.importExisting({
        assetRef: taskView.assetRef,
        sourceVersion: taskView.sourceVersion,
        sourceImageUrl: taskView.sourceImageUrl,
        glbGcsUri: "gs://test-bucket/uploads/u7/fake.glb",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "文件不是有效的 GLB 2.0 模型",
    });
  });

  it.each([
    { error: new Error("manhua3d_glb_import_busy"), code: "TOO_MANY_REQUESTS", message: "正在校验其他三维文件，请稍后重新导入；当前人物参考未改变" },
    { error: new DOMException("expired", "TimeoutError"), code: "TIMEOUT", message: "三维文件校验超时，请稍后重新导入；当前人物参考未改变" },
  ])("导入资源边界返回可操作错误：$code", async ({ error, code, message }) => {
    mocks.importExistingManhua3dAsset.mockRejectedValue(error);
    const caller = manhua3dRouter.createCaller(ctx("admin"));
    await expect(caller.importExisting({
      assetRef: taskView.assetRef,
      sourceVersion: taskView.sourceVersion,
      sourceImageUrl: taskView.sourceImageUrl,
      glbGcsUri: "gs://test-bucket/uploads/u7/existing.glb",
    })).rejects.toMatchObject({ code, message });
    expect(mocks.createManhua3dTask).not.toHaveBeenCalled();
  });

  it("admin 可提交，supervisor 可查询，且不经过公开扣费参数", async () => {
    const admin = manhua3dRouter.createCaller(ctx("admin"));
    await expect(
      admin.submit({
        assetRef: "character:black-horse",
        sourceVersion: `gs://test-bucket/${"v".repeat(180)}`,
        sourceImageUrl: "https://assets.test/black-horse-front.png",
        options: { geometryQuality: "detailed" },
      })
    ).resolves.toEqual(taskView);
    expect(mocks.createManhua3dTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        assetRef: "character:black-horse",
        options: expect.objectContaining({ geometryQuality: "detailed" }),
      })
    );

    const supervisor = manhua3dRouter.createCaller(ctx("supervisor"));
    await expect(
      supervisor.getStatus({ taskId: taskView.taskId })
    ).resolves.toEqual(taskView);
    expect(mocks.getManhua3dTask).toHaveBeenCalledWith(taskView.taskId, 7);

    await expect(
      supervisor.retry({ taskId: taskView.taskId })
    ).resolves.toEqual(taskView);
    expect(mocks.retryManhua3dTask).toHaveBeenCalledWith(taskView.taskId, 7);
  });

  it("人工对账态禁止重试并保留明确错误", async () => {
    mocks.retryManhua3dTask.mockRejectedValue(
      new Error("manhua3d_retry_reconcile_forbidden")
    );
    const caller = manhua3dRouter.createCaller(ctx("admin"));
    await expect(
      caller.retry({ taskId: taskView.taskId })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "任务结果仍待核对，为避免重复计费暂不能重试",
    });
  });

  it("缺服务端配置映射为 SERVICE_UNAVAILABLE", async () => {
    mocks.createManhua3dTask.mockRejectedValue(
      new Error("manhua3d_service_unavailable")
    );
    const caller = manhua3dRouter.createCaller(ctx("admin"));
    await expect(
      caller.submit({
        assetRef: "character:black-horse",
        sourceVersion: "sha256:test-v1",
        sourceImageUrl: "https://assets.test/black-horse-front.png",
      })
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "三维生成服务暂未配置，请联系管理员",
    });
  });
});
