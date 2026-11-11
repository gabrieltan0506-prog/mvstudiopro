import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 可灵停用（方案 A）回归：开关三态、底层创建函数零上游、tRPC 新建入口零扣费零建任务、
 * 查询/轮询在停用后照常（在途任务可收尾）、自动路由剔除可灵通道。全部离线替身，不发任何网络请求。
 */
const h = vi.hoisted(() => ({
  request: vi.fn(),
  falSubmit: vi.fn(),
  falSubscribe: vi.fn(),
  falStatus: vi.fn(),
  deductCredits: vi.fn(),
  addCredits: vi.fn(),
  recordCreation: vi.fn(),
  storagePut: vi.fn(),
}));

vi.mock("./client", () => ({
  KlingClient: class {},
  getKlingClient: () => ({ request: h.request, getKeyStats: () => [] }),
  configureKlingClient: vi.fn(),
  parseKeysFromEnv: () => [],
}));
vi.mock("@fal-ai/client", () => ({
  fal: { config: vi.fn(), subscribe: h.falSubscribe, queue: { submit: h.falSubmit, status: h.falStatus, result: vi.fn() } },
}));
vi.mock("../credits", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deductCredits: h.deductCredits, addCredits: h.addCredits, getUserPlan: vi.fn(async () => "free"),
}));
vi.mock("../routers/creations", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), recordCreation: h.recordCreation }));
vi.mock("../storage", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), storagePut: h.storagePut }));

import { isKlingRetired, KLING_RETIRED_CLIENT, KLING_RETIRED_MESSAGE_ZH } from "../../shared/klingRetired";
import {
  assertKlingNotRetired,
  assertKlingNotRetiredTrpc,
  isKlingCreateJobsOp,
  isKlingJobAction,
  isKlingRetiredError,
  KlingRetiredError,
  klingRetiredBody,
  withoutKlingProviders,
} from "./retired";
import { createOmniVideoTask, getOmniVideoTask } from "./omni-video";
import { createMotionControlTask } from "./motion-control";
import { createLipSyncTask, identifyFaces } from "./lip-sync";
import { createImageElement, createVideoElement } from "./elements";
import { createImageTask, getImageTask } from "./image-generation";
import { falKlingQueue, falKlingStatus, falKlingSubmit } from "./fal-proxy";
import { klingRouter } from "../routers/kling";
import { getTierProviderChain } from "../services/tier-provider-routing";
import { resolveFailedJobDisposition } from "../jobs/runner";
import { workflowRouter } from "../routers/workflow";

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.request.mockResolvedValue({ code: 0, data: { task_id: "t-up", task_status: "succeed" } });
  h.falSubmit.mockResolvedValue({ request_id: "r1", status_url: "u" });
  h.falStatus.mockResolvedValue({ status: "IN_PROGRESS" });
  h.deductCredits.mockResolvedValue({ success: true, cost: 8 });
  vi.stubEnv("FAL_API_KEY", "test-fal");
  vi.stubEnv("KLING_RETIRED", "");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("开关三态", () => {
  it("缺省（未设置 / 空串）= 停用", () => {
    expect(isKlingRetired({})).toBe(true);
    expect(isKlingRetired({ KLING_RETIRED: "" })).toBe(true);
    expect(isKlingRetired({ KLING_RETIRED: "  " })).toBe(true);
  });
  it("KLING_RETIRED=0 / false / off（大小写、空白不敏感）= 紧急恢复", () => {
    for (const v of ["0", "false", "off", " FALSE ", "Off"]) expect(isKlingRetired({ KLING_RETIRED: v })).toBe(false);
  });
  it("非法值一律按停用处理（fail closed）", () => {
    for (const v of ["1", "true", "no", "abc", "00", "-1"]) expect(isKlingRetired({ KLING_RETIRED: v })).toBe(true);
  });
  it("缺省参数读 process.env；前端常量恒为停用", () => {
    expect(isKlingRetired()).toBe(true);
    vi.stubEnv("KLING_RETIRED", "0");
    expect(isKlingRetired()).toBe(false);
    expect(KLING_RETIRED_CLIENT).toBe(true);
  });
  it("守卫函数与 410 响应体", () => {
    expect(() => assertKlingNotRetired({})).toThrow(KlingRetiredError);
    expect(() => assertKlingNotRetired({ KLING_RETIRED: "0" })).not.toThrow();
    expect(() => assertKlingNotRetiredTrpc({})).toThrow(expect.objectContaining({ code: "PRECONDITION_FAILED", message: KLING_RETIRED_MESSAGE_ZH }));
    expect(klingRetiredBody()).toEqual({ ok: false, error: "kling_retired", code: "kling_retired", message: KLING_RETIRED_MESSAGE_ZH });
    expect(isKlingRetiredError(new KlingRetiredError())).toBe(true);
    expect(isKlingRetiredError(new Error(new KlingRetiredError().message))).toBe(true);
    expect(isKlingRetiredError(new Error("Kling generation failed"))).toBe(false);
  });
  it("入口清单：新建 op/action 命中，轮询 op 不命中", () => {
    for (const op of ["klingCreate", "KLINGT2V", "klingI2V", "workflowGenerateVideo"]) expect(isKlingCreateJobsOp(op)).toBe(true);
    for (const op of ["klingTask", "workflowGenerateSceneVideo", "seedanceI2V", ""]) expect(isKlingCreateJobsOp(op)).toBe(false);
    for (const a of ["omni_t2v", "omni_i2v", "omni_storyboard", "motion_control", "lip_sync", "kling_image"]) expect(isKlingJobAction(a)).toBe(true);
    for (const a of ["nano_image", "canvas_gpt_image2", "virtual_idol", "suno_music"]) expect(isKlingJobAction(a)).toBe(false);
  });
});

describe("底层创建函数：停用时零上游，查询照常", () => {
  const creates: Array<[string, () => Promise<unknown>]> = [
    ["createOmniVideoTask", () => createOmniVideoTask({ prompt: "p" } as any, "cn")],
    ["createMotionControlTask", () => createMotionControlTask({} as any, "cn")],
    ["identifyFaces", () => identifyFaces({} as any, "cn")],
    ["createLipSyncTask", () => createLipSyncTask({} as any, "cn")],
    ["createImageElement", () => createImageElement({ image_list: [] } as any, "cn")],
    ["createVideoElement", () => createVideoElement({ video_url: "v" } as any, "cn")],
    ["createImageTask", () => createImageTask({ prompt: "p" } as any, "cn")],
    ["falKlingSubmit", () => falKlingSubmit("v3-pro-t2v" as any, { prompt: "p" })],
    ["falKlingQueue", () => falKlingQueue("motion-control" as any, { prompt: "p" })],
  ];
  it.each(creates)("%s 停用时抛 kling_retired，零上游调用", async (_name, run) => {
    await expect(run()).rejects.toThrow(/^kling_retired:/);
    expect(h.request).not.toHaveBeenCalled();
    expect(h.falSubmit).not.toHaveBeenCalled();
    expect(h.falSubscribe).not.toHaveBeenCalled();
  });
  it("KLING_RETIRED=0 恢复后，创建函数重新走到上游（替身）", async () => {
    vi.stubEnv("KLING_RETIRED", "0");
    await expect(createOmniVideoTask({ prompt: "p" } as any, "cn")).resolves.toEqual(expect.objectContaining({ task_id: "t-up" }));
    await expect(falKlingQueue("motion-control" as any, { prompt: "p" })).resolves.toEqual(expect.objectContaining({ request_id: "r1" }));
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.falSubmit).toHaveBeenCalledTimes(1);
  });
  it("在途任务：停用后 getOmniVideoTask / getImageTask / falKlingStatus 照常查询", async () => {
    await expect(getOmniVideoTask("t-old", "cn")).resolves.toEqual(expect.objectContaining({ task_status: "succeed" }));
    await expect(getImageTask("t-old", "cn")).resolves.toEqual(expect.objectContaining({ task_status: "succeed" }));
    await expect(falKlingStatus("motion-control" as any, "r-old")).resolves.toBeDefined();
    expect(h.request).toHaveBeenCalledTimes(2);
    expect(h.request.mock.calls.every(([opts]) => opts.method === "GET")).toBe(true);
  });
});

describe("tRPC kling 路由：新建入口 412+中文提示、零扣费零建任务；查询放行", () => {
  const caller = () => klingRouter.createCaller({ user: { id: 7, role: "user" } } as any);
  const createCalls: Array<[string, (c: ReturnType<typeof caller>) => Promise<unknown>]> = [
    ["omniVideo.createT2V", (c) => c.omniVideo.createT2V({ prompt: "p" } as any)],
    ["omniVideo.createI2V", (c) => c.omniVideo.createI2V({ prompt: "p", imageUrl: "https://x/a.png" } as any)],
    ["omniVideo.createStoryboard", (c) => c.omniVideo.createStoryboard({ shots: [{ prompt: "p", duration: "5" }] } as any)],
    ["omniVideo.createAllInOne", (c) => c.omniVideo.createAllInOne({ prompt: "p" } as any)],
    ["motionControl.create", (c) => c.motionControl.create({ imageUrl: "https://x/a.png", videoUrl: "https://x/a.mp4" } as any)],
    ["lipSync.identifyFaces", (c) => c.lipSync.identifyFaces({ videoUrl: "https://x/a.mp4" } as any)],
    ["lipSync.create", (c) => c.lipSync.create({ sessionId: "s", faceId: "f", audioUrl: "https://x/a.mp3" } as any)],
    ["elements.createImage", (c) => c.elements.createImage({ imageUrls: ["https://x/a.png"] } as any)],
    ["elements.createVideo", (c) => c.elements.createVideo({ videoUrl: "https://x/a.mp4" } as any)],
    ["imageGen.create", (c) => c.imageGen.create({ prompt: "p", count: 2 } as any)],
    ["uploadFile", (c) => c.uploadFile({ fileBase64: "aGk=", fileName: "a.png" } as any)],
  ];
  it.each(createCalls)("%s 停用时拒绝", async (_name, run) => {
    await expect(run(caller())).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: KLING_RETIRED_MESSAGE_ZH });
    expect(h.deductCredits).not.toHaveBeenCalled();
    expect(h.addCredits).not.toHaveBeenCalled();
    expect(h.recordCreation).not.toHaveBeenCalled();
    expect(h.storagePut).not.toHaveBeenCalled();
    expect(h.request).not.toHaveBeenCalled();
  });
  it("在途查询：imageGen.getTask / omniVideo.getTask 停用后照常返回上游结果", async () => {
    h.request.mockResolvedValue({ code: 0, data: { task_id: "t-old", task_status: "succeed", task_result: { images: [{ url: "https://x/i.png" }] } } });
    const c = caller();
    await expect(c.imageGen.getTask({ taskId: "t-old" })).resolves.toEqual(expect.objectContaining({ task_status: "succeed" }));
    await expect(c.omniVideo.getTask({ taskId: "t-old" } as any)).resolves.toEqual(expect.objectContaining({ task_id: "t-old" }));
    expect(h.deductCredits).not.toHaveBeenCalled();
  });
  it("KLING_RETIRED=0 恢复：imageGen.create 重新扣费并建任务（替身）", async () => {
    vi.stubEnv("KLING_RETIRED", "0");
    const r = await caller().imageGen.create({ prompt: "p" } as any);
    expect(r).toEqual({ success: true, taskId: "t-up" });
    expect(h.deductCredits).toHaveBeenCalledTimes(1);
    expect(h.request).toHaveBeenCalledTimes(1);
  });
});

describe("自动路由与队列处置", () => {
  it("停用时视频通道链剔除可灵，其余通道保持原顺序", () => {
    for (const tier of ["free", "beta", "paid", "supervisor"] as const) {
      const chain = getTierProviderChain(tier, "video");
      expect(chain.some((p) => /kling/.test(p))).toBe(false);
      expect(chain.length).toBeGreaterThan(0);
    }
    expect(getTierProviderChain("free", "video")).toEqual(["veo_3_1", "cometapi"]);
    expect(getTierProviderChain("paid", "image")).toEqual(["nano-banana-pro", "nano-banana-flash"]);
  });
  it("KLING_RETIRED=0 恢复原链", () => {
    vi.stubEnv("KLING_RETIRED", "0");
    expect(getTierProviderChain("free", "video")).toEqual(["kling_beijing", "fal_kling_video", "veo_3_1", "cometapi"]);
  });
  it("withoutKlingProviders 只剔除可灵", () => {
    expect(withoutKlingProviders(["kling", "seedance", "kling-cn", "fal_kling_video", "veo_3_1"], {})).toEqual(["seedance", "veo_3_1"]);
    expect(withoutKlingProviders(["kling", "seedance"], { KLING_RETIRED: "0" })).toEqual(["kling", "seedance"]);
  });
  it("队列里停用前已入队的可灵单被拒后直接失败，不重排", () => {
    const job = { type: "image", input: { action: "kling_image" }, attempts: 0 };
    expect(resolveFailedJobDisposition(job, new KlingRetiredError())).toBe("fail");
    expect(resolveFailedJobDisposition(job, new Error("Kling image generation failed"))).toBe("requeue");
  });
});

describe("旧工作流的可灵开关", () => {
  it("停用时不许再打开动作控制/口型同步/角色元素（在任何读写库之前拒绝）", async () => {
    const c = workflowRouter.createCaller({ user: { id: 7, role: "user" } } as any);
    for (const flags of [{ motionControl: true, lipsync: false, elements: false }, { motionControl: false, lipsync: true, elements: false }, { motionControl: false, lipsync: false, elements: true }]) {
      await expect(c.updateStudioControls({ workflowId: 1, ...flags })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: KLING_RETIRED_MESSAGE_ZH });
    }
  });
});
