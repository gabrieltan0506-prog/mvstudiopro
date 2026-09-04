import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context.js";

const mocks = vi.hoisted(() => ({
  createManhua3dTask: vi.fn(),
  getManhua3dTask: vi.fn(),
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
    expect(mocks.createManhua3dTask).not.toHaveBeenCalled();
    expect(mocks.getManhua3dTask).not.toHaveBeenCalled();
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
