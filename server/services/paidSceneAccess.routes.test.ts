import { beforeEach, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const mocks = vi.hoisted(() => ({
  plan: vi.fn(), create: vi.fn(), retry: vi.fn(), get: vi.fn(), list: vi.fn(), remove: vi.fn(),
  source: vi.fn(), sign: vi.fn(), object: vi.fn(), analyze: vi.fn(), find: vi.fn(),
}));
vi.mock("../credits", () => ({ getUserPlan: mocks.plan }));
vi.mock("./manhuaWorldTask", () => ({ createManhuaWorldTask: mocks.create, retryManhuaWorldTask: mocks.retry, getManhuaWorldTask: mocks.get, listManhuaWorldTasks: mocks.list, deleteManhuaWorldTask: mocks.remove, findExistingManhuaWorldImageTask: mocks.find }));
vi.mock("./postProdMediaSource", () => ({ resolveRegisteredPostProdMediaSource: mocks.source }));
vi.mock("./gcs", () => ({ signGsUriV4ReadUrl: mocks.sign }));
vi.mock("./manhua3dTask", () => ({ createManhua3dTask: mocks.object }));
vi.mock("./imageWorldAnalysis", () => ({ analyzeImageWorld: mocks.analyze }));
import { manhuaWorldRouter } from "../routers/manhuaWorld";
import { imageWorldRouter } from "../routers/imageWorld";

const ctx = (role: string) => ({ user: { id: 7, role } }) as TrpcContext;
const submit = { sceneRef: "scene", sourceVersion: "v1", sourceImageUrl: "https://fixture.invalid/scene.png", displayName: "场景", prompt: { type: "text" as const, textPrompt: "空场景" } };
const world = { sceneRef: "scene", sourceUri: "gs://fixture/scene.png", name: "场景", plan: { scene: "空场景", ambience: "", objects: [] }, model: "marble-1.1" as const };
const task = { taskId: "mw_probe_12345678", status: "failed" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.plan.mockResolvedValue("free"); mocks.create.mockResolvedValue(task); mocks.retry.mockResolvedValue(task); mocks.get.mockResolvedValue(task); mocks.list.mockResolvedValue([task]); mocks.remove.mockResolvedValue(true); mocks.source.mockResolvedValue("gs://fixture/scene.png"); mocks.sign.mockReturnValue("https://fixture.invalid/scene.png"); mocks.object.mockResolvedValue(task); mocks.analyze.mockResolvedValue({ ok: true });
});

it("免费与普通付费会员的三个生成入口均在素材签名和任务创建前拒绝", async () => {
  for (const plan of ["free", "pro", "enterprise"]) {
    mocks.plan.mockResolvedValue(plan);
    const caller = manhuaWorldRouter.createCaller(ctx("user"));
    expect(await caller.sceneAccess()).toMatchObject({ canGenerate: false, paidMember: plan !== "free" });
    await expect(caller.submit(submit)).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining(plan === "free" ? "付费会员" : "尚未开放") });
    await expect(caller.retry({ taskId: task.taskId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(imageWorldRouter.createCaller(ctx("user")).world(world)).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.retry).not.toHaveBeenCalled(); expect(mocks.source).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled();
});
it("两种内部角色三个入口仍沿原归属和任务链，会员查询不参与", async () => {
  for (const role of ["admin", "supervisor"]) {
    const caller = manhuaWorldRouter.createCaller(ctx(role));
    expect((await caller.sceneAccess()).canGenerate).toBe(true);
    await caller.submit(submit); await caller.retry({ taskId: task.taskId });
    await imageWorldRouter.createCaller(ctx(role)).world(world);
  }
  expect(mocks.create).toHaveBeenCalledTimes(4); expect(mocks.retry).toHaveBeenCalledTimes(2); expect(mocks.source).toHaveBeenCalledWith({ userId: "7", source: world.sourceUri }); expect(mocks.plan).not.toHaveBeenCalled();
});
it("旧任务查询删除不新增会员查询，物件和分析维持原权限", async () => {
  const caller = manhuaWorldRouter.createCaller(ctx("supervisor"));
  expect(await caller.getStatus({ taskId: task.taskId })).toEqual(task);
  expect(await caller.listMine()).toEqual([task]);
  expect(await caller.remove({ taskId: task.taskId })).toEqual({ ok: true });
  const image = imageWorldRouter.createCaller(ctx("admin"));
  await image.object({ assetRef: "object", sourceUri: world.sourceUri });
  await imageWorldRouter.createCaller(ctx("user")).analyze({ requestId: "existing-analysis", sourceUri: world.sourceUri });
  expect(mocks.object).toHaveBeenCalledOnce(); expect(mocks.analyze).toHaveBeenCalledOnce(); expect(mocks.plan).not.toHaveBeenCalled();
});
it("匿名账号不能查准入或提交场景", async () => {
  const caller = manhuaWorldRouter.createCaller({ user: null } as TrpcContext);
  await expect(caller.sceneAccess()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  await expect(caller.submit(submit)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  expect(mocks.plan).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
});

it("原提交续查沿内部角色和素材归属，只查原指纹，不签名或创建任务", async () => {
  mocks.plan.mockRejectedValue(new Error("订阅查询故障"));
  mocks.find.mockResolvedValue(task);
  for (const role of ["admin", "supervisor"]) {
    expect(await imageWorldRouter.createCaller(ctx(role)).worldStatus(world)).toEqual(task);
  }
  expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, sceneRef: "scene", sourceVersion: "gs://fixture/scene.png", model: "marble-1.1", prompt: expect.objectContaining({ type: "image", isPano: "auto" }) }));
  mocks.find.mockResolvedValue(null);
  expect(await imageWorldRouter.createCaller(ctx("admin")).worldStatus(world)).toBeNull();
  await expect(imageWorldRouter.createCaller(ctx("user")).worldStatus(world)).rejects.toMatchObject({ code: "FORBIDDEN" });
  mocks.source.mockRejectedValueOnce(new Error("来源不属于此账号"));
  await expect(imageWorldRouter.createCaller(ctx("admin")).worldStatus(world)).rejects.toThrow("来源不属于此账号");
  expect(mocks.find).toHaveBeenCalledTimes(3);
  expect(mocks.plan).not.toHaveBeenCalled(); expect(mocks.sign).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.retry).not.toHaveBeenCalled();
});
