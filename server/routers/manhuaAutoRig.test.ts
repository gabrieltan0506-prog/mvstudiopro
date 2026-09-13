import { beforeEach, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  adopt: vi.fn(),
}));
vi.mock("../services/manhuaAutoRigTask", async importOriginal => {
  const original =
    await importOriginal<typeof import("../services/manhuaAutoRigTask")>();
  return {
    ...original,
    submitAutoRigTask: mocks.submit,
    getAutoRigTask: mocks.get,
    listAutoRigTasks: mocks.list,
    adoptAutoRigTask: mocks.adopt,
  };
});
import { manhuaAutoRigRouter } from "./manhuaAutoRig";
const request = {
  stage: "inspect" as const,
  requestId: "11111111-1111-4111-8111-111111111111",
  assetRef: "person",
  sourceJobId: "m3d_test_original",
  settings: {
    pose: "T" as const,
    forwardAxis: "+X" as const,
    targetHeight: 1.7,
  },
};
const caller = (role: string) =>
  manhuaAutoRigRouter.createCaller({
    user: { id: 7, role, openId: "test-only" },
  } as TrpcContext);
beforeEach(() => {
  vi.clearAllMocks();
});
it("普通用户不能从任一专用入口绕过现有权限", async () => {
  const c = caller("user");
  for (const call of [
    () => c.submit(request),
    () => c.get({ requestId: request.requestId }),
    () => c.list({ assetRef: "person" }),
    () =>
      c.adopt({
        requestId: request.requestId,
        expectedSha256: "a".repeat(64),
        qualityReviewed: true,
      }),
    () =>
      c.restore({
        requestId: request.requestId,
        expectedSha256: "a".repeat(64),
      }),
  ])
    await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.adopt).not.toHaveBeenCalled();
});
it.each(["admin", "supervisor"])("%s 仅以当前登录者身份提交", async role => {
  mocks.submit.mockResolvedValue({ status: "queued" });
  await caller(role).submit(request);
  expect(mocks.submit).toHaveBeenCalledWith(7, request);
});
it("缺少质量确认拒绝采用", async () => {
  await expect(
    caller("admin").adopt({
      requestId: request.requestId,
      expectedSha256: "a".repeat(64),
    } as any)
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(mocks.adopt).not.toHaveBeenCalled();
});
it("未知服务错误保持未确认语义，不能促使换编号重试", async () => {
  mocks.submit.mockRejectedValue(Error("test-internal-path"));
  await expect(caller("admin").submit(request)).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
    message: "绑骨操作未确认，请查询原任务；原模型保持不变",
  });
});
