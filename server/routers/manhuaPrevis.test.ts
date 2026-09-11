import { beforeEach, it, expect, vi } from "vitest";
import { createManhuaPrevisStudio } from "../../shared/manhuaPrevis";
import type { TrpcContext } from "../_core/context";
const mocks = vi.hoisted(() => ({
  submitPrevisTask: vi.fn(),
  getPrevisTask: vi.fn(),
  listPrevisTasks: vi.fn(),
}));
vi.mock("../services/manhuaPrevisTask", async importOriginal => ({
  ...(await importOriginal<typeof import("../services/manhuaPrevisTask")>()),
  ...mocks,
}));
import { manhuaPrevisRouter } from "./manhuaPrevis";
const studio = createManhuaPrevisStudio(
  2,
  "11111111-1111-4111-8111-111111111111"
);
const input = {
  requestId: "22222222-2222-4222-8222-222222222222",
  scopeId: studio.scopeId,
  clipId: "clip-1",
  spec: studio.spec,
};
function caller(role: "admin" | "supervisor" | "user") {
  return manhuaPrevisRouter.createCaller({
    user: { id: 7, role },
  } as TrpcContext);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.submitPrevisTask.mockResolvedValue({ jobId: "test-job" });
  mocks.getPrevisTask.mockResolvedValue(null);
  mocks.listPrevisTasks.mockResolvedValue({ items: [], nextCursor: null });
});
for (const role of ["admin", "supervisor"] as const) {
  it(`${role}真实router caller可提交、查询及分页`, async () => {
    const c = caller(role);
    expect(await c.submit(input)).toEqual({ jobId: "test-job" });
    expect(await c.get({ requestId: input.requestId })).toBeNull();
    const before = JSON.stringify({
      createdAt: "2026-09-11T01:02:03.123Z",
      id: `prv_${"a".repeat(48)}`,
    });
    expect(
      await c.list({ scopeId: input.scopeId, clipId: input.clipId, before })
    ).toEqual({ items: [], nextCursor: null });
    expect(mocks.submitPrevisTask).toHaveBeenCalledWith(7, input);
    expect(mocks.getPrevisTask).toHaveBeenCalledWith(7, input.requestId);
    expect(mocks.listPrevisTasks).toHaveBeenCalledWith(
      7,
      input.scopeId,
      input.clipId,
      before
    );
  });
}
it("普通用户全部入口均被真实权限中间件拒绝，服务零调用", async () => {
  const c = caller("user");
  await expect(c.submit(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(c.get({ requestId: input.requestId })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(
    c.list({ scopeId: input.scopeId, clipId: input.clipId })
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  for (const service of Object.values(mocks))
    expect(service).not.toHaveBeenCalled();
});
it("管理员坏游标在路由schema拒绝，分页服务零调用", async () => {
  await expect(
    caller("admin").list({
      scopeId: input.scopeId,
      clipId: input.clipId,
      before: "not-a-cursor",
    })
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(mocks.listPrevisTasks).not.toHaveBeenCalled();
});
