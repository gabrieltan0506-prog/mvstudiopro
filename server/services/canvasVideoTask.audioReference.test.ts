import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({
  normalizeVideo: vi.fn(async (url: string, _userId?: number, _record?: any, _save?: any) => url),
  normalizeImage: vi.fn(async (url: string) => url),
  inkCheck: vi.fn(async()=>{}), inkReceipts:new Map<string,Buffer>(), evolinkUnknown:false, h3: vi.fn(), h3Unknown: false, evolink: vi.fn(), byteplus: vi.fn(), openrouter: vi.fn(), signed: 0,
  byteplusFailure: false, byteplusUnknown: false, byteplusRejected: false, byteplusPollFailed: false, byteplusPollReason: "InputImageSensitiveContentDetected.PrivacyInformation", openrouterEnabled: false,
}));
vi.mock("./codeMotionProductionVideo",()=>({assertCodeMotionProductionVideoTask:h.inkCheck}));
vi.mock("./codeMotionStore",()=>({codeMotionStorage:{write:async(name:string,body:Buffer)=>{h.inkReceipts.set(name,body);return "1";},read:async(name:string)=>h.inkReceipts.has(name)?{body:h.inkReceipts.get(name),generation:"1"}:null}}));
vi.mock("./seedanceReferenceVideoSize.js", async original => ({ ...await original<typeof import("./seedanceReferenceVideoSize.js")>(), normalizeSeedanceReferenceVideo: h.normalizeVideo }));
vi.mock("./seedanceReferenceImageSize.js", () => ({ normalizeSeedanceReferenceImage: h.normalizeImage }));
vi.mock("./hailuoReferencePreflight.js", () => ({ preflightH3ReferenceMedia: vi.fn(async () => {}) }));
vi.mock("./evolinkHailuoVideo.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./evolinkHailuoVideo.js")>();
  return { ...actual, submitEvolinkH3: async (input: Parameters<typeof actual.buildEvolinkH3Body>[0]) => {
    h.h3(actual.buildEvolinkH3Body(input));
    if (h.h3Unknown) throw Object.assign(new Error("unknown"), { kind: "unknown" });
    return { evolinkTaskId: "h3-local-test" };
  } };
});
vi.mock("./gcs.js", async importOriginal => ({
  ...await importOriginal<typeof import("./gcs.js")>(),
  getGcsBucketName: () => "test-bucket",
  signGsUriV4ReadUrl: (uri: string) => `https://storage.googleapis.com/${uri.slice(5)}?signature=test-${++h.signed}`,
  signGcsObjectPathV4ReadUrl: (bucket: string, objectPath: string) =>
    `https://storage.googleapis.com/${bucket}/${objectPath}?signature=test-path-${++h.signed}`,
}));
vi.mock("../db", () => ({ getDb: async () => null }));
vi.mock("./postProdMediaSource.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./postProdMediaSource.js")>();
  return { ...actual, resolveRegisteredPostProdMediaSource: (input: { userId: string; source: string }) => actual.resolveRegisteredPostProdMediaSource(input, {
    getBucket: () => "test-bucket", verifyOwnership: async () => false, loadSucceededJobOutputObjects: async () => new Set(),
  }) };
});
vi.mock("./evolinkSeedanceVideo.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./evolinkSeedanceVideo.js")>();
  return { ...actual, EVOLINK_SEEDANCE_POLL_INTERVAL_MS: 600000, isEvolinkSeedanceConfigured: () => true,
    submitEvolinkSeedanceVideo: async (input: Parameters<typeof actual.buildEvolinkSeedanceRequest>[0]) => {
      const request = actual.buildEvolinkSeedanceRequest(input); h.evolink(request);
      if(h.evolinkUnknown)throw new Error("fake-provider-network-response-lost");
      if(input.persistSubmitReceipt)await input.persistSubmitReceipt({status:200,body:JSON.stringify({id:"ev-local-test",status:"pending"})});
      return { evolinkTaskId: "ev-local-test", model: request.body.model, mode: "reference_to_video" };
    }, pollEvolinkVideoTaskOnce: async () => ({ state: "running", status: "processing" }),
  };
});
vi.mock("./byteplusSeedanceVideo.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./byteplusSeedanceVideo.js")>();
  return { ...actual, isByteplusSeedanceConfigured: () => true,
    submitByteplusSeedance25Video: async (input: Parameters<typeof actual.buildByteplusSeedance25SubmitBody>[0]) => {
      h.byteplus(actual.buildByteplusSeedance25SubmitBody(input));
      if (h.byteplusFailure) throw Object.assign(new Error("InputImageSensitiveContentDetected.PrivacyInformation"), { kind: "rejected" });
      if (h.byteplusUnknown) throw new Error("fetch failed");
      if (h.byteplusRejected) throw Object.assign(new Error("AccountOverdue"), { kind: "rejected" });
      return { byteplusTaskId: "bp-local-test", model: input.version === "2.0-mini" ? "dreamina-seedance-2-0-mini-260615" : "seedance-2.5", mode: "reference_to_video" };
    }, pollByteplusVideoTaskOnce: async () => h.byteplusPollFailed ? ({ state: "failed", error: h.byteplusPollReason }) : ({ state: "running", status: "processing" }),
  };
});
vi.mock("./openrouterVideoCore.js", async importOriginal => ({
  ...await importOriginal<typeof import("./openrouterVideoCore.js")>(),
  OPENROUTER_VIDEO_POLL_INTERVAL_MS: 600000,
  isOpenRouterVideoConfigured: () => h.openrouterEnabled,
  submitOpenRouterVideoJob: async (body: unknown) => { h.openrouter(body); return { openRouterJobId: "or-local-test", pollingUrl: "https://example.test/poll", model: "seedance-2.5" }; },
  pollOpenRouterVideoJobOnce: async () => ({ state: "running", status: "processing" }),
}));
vi.mock("./paidJobLedger.js", () => ({
  heartbeatActiveJob: vi.fn(async () => {}), pauseActiveJob: vi.fn(async () => {}), registerActiveJob: vi.fn(async () => {}),
  refundCreditsOnFailure: vi.fn(async () => ({ refunded: true })), unregisterActiveJob: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../credits.js", () => ({ refundCredits: vi.fn(async () => {}) }));

describe("真实任务写盘到供应商请求的音频交接", () => {
  let dir = "";
  const priorDir = process.env.CANVAS_VIDEO_TASK_DIR;
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    h.evolink.mockReset(); h.byteplus.mockReset(); h.openrouter.mockReset();
    h.h3.mockReset(); h.h3Unknown = false; h.evolinkUnknown=false;h.inkReceipts.clear();
    h.normalizeVideo.mockReset().mockImplementation(async (url: string) => url);
    h.normalizeImage.mockReset().mockImplementation(async (url: string) => url);
    h.signed = 0; h.byteplusFailure = false; h.byteplusUnknown = false; h.byteplusRejected = false; h.byteplusPollFailed = false; h.byteplusPollReason = "InputImageSensitiveContentDetected.PrivacyInformation"; h.openrouterEnabled = false;
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "video-audio-ref-test-"));
    process.env.CANVAS_VIDEO_TASK_DIR = dir;
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("测试不允许联网"); }));
  });
  afterEach(async () => {
    if (priorDir === undefined) delete process.env.CANVAS_VIDEO_TASK_DIR; else process.env.CANVAS_VIDEO_TASK_DIR = priorDir;
    vi.unstubAllGlobals();
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  async function create(engine: "seedance25-evolink" | "seedance25-byteplus" | "hailuo-evolink", audio = "gs://test-bucket/post-prod/7/dialogue.wav") {
    const { createCanvasVideoTask } = await import("./canvasVideoTask");
    const task = await createCanvasVideoTask({ userId: 7, creditsCharged: 0, engine, label: "本机音频交接测试", prompt: "角色说话", audioUrls: [audio], duration: 5, resolution: engine === "hailuo-evolink" ? "768p" : "720p", workMode: "reference_to_video" });
    let saved: Record<string, unknown> = {};
    await vi.waitFor(async () => {
      saved = JSON.parse(await fs.readFile(path.join(dir, `${task.taskId}.json`), "utf8"));
      expect(["running", "failed", "reconcile_manual"]).toContain(saved.status);
    });
    return saved;
  }
  it("H3音频身份写盘、请求现签，原句柄阻止重复建单", async () => {
    const task = await create("hailuo-evolink");
    expect(task.audioUrls).toEqual(["gs://test-bucket/post-prod/7/dialogue.wav"]);
    expect(task.evolinkTaskId).toBe("h3-local-test");
    expect(h.h3.mock.calls[0][0].audio_urls[0]).toContain("signature=test-");
    const { canvasVideoTaskNeedsSubmit } = await import("./canvasVideoTask");
    expect(canvasVideoTaskNeedsSubmit(task as never)).toBe(false);
    expect(h.openrouter).not.toHaveBeenCalled();
  });
  it("H3未知提交进入对账，不回落OpenRouter", async () => {
    h.h3Unknown = true;
    const task = await create("hailuo-evolink");
    expect(task.status).toBe("reconcile_manual");
    expect(h.h3).toHaveBeenCalledTimes(1);
    expect(h.openrouter).not.toHaveBeenCalled();
    const { refundCreditsOnFailure } = await import("./paidJobLedger.js");
    expect(refundCreditsOnFailure).not.toHaveBeenCalled();
  });
  it("H3提交后进程恢复无句柄时不重复生成或退款", async () => {
    const task = await create("hailuo-evolink");
    expect(task.h3SubmissionStartedAt).toBeTruthy();
    delete task.evolinkTaskId;
    task.status = "running";
    await fs.writeFile(path.join(dir, `${task.taskId}.json`), JSON.stringify(task));
    const { getCanvasVideoTask } = await import("./canvasVideoTask");
    const restored = await getCanvasVideoTask(String(task.taskId), 7);
    expect(restored?.status).toBe("reconcile_manual");
    expect(h.h3).toHaveBeenCalledTimes(1);
    const { refundCreditsOnFailure } = await import("./paidJobLedger.js");
    expect(refundCreditsOnFailure).not.toHaveBeenCalled();
  });

  async function createMini(key = "mini-stable") {
    const { createCanvasVideoTask } = await import("./canvasVideoTask");
    const task = await createCanvasVideoTask({ userId: 7, creditsCharged: 39, engine: "seedance-mini-byteplus", label: "Mini假服务回归", prompt: "虚构人物同行", imageUrls: ["https://example.test/character.png"], audioUrls: ["gs://test-bucket/post-prod/7/dialogue.wav"], duration: 15, resolution: "480p", seedanceVersion: "2.0-mini", workMode: "reference_to_video", idempotencyKey: key });
    let saved: Record<string, unknown> = {};
    await vi.waitFor(async () => {
      saved = JSON.parse(await fs.readFile(path.join(dir, `${task.taskId}.json`), "utf8"));
      expect(["running", "failed", "reconcile_manual"]).toContain(saved.status);
    });
    return saved;
  }
  it("Mini首发BytePlus，同键重送/刷新不重建且保持音频归属", async () => {
    const task = await createMini();
    expect(h.byteplus.mock.calls[0][0].body).toMatchObject({ model: "dreamina-seedance-2-0-mini-260615", duration: 15, resolution: "480p" });
    expect(task.audioUrls).toEqual(["gs://test-bucket/post-prod/7/dialogue.wav"]);
    expect(task.engine).toBe("seedance-mini-byteplus");
    expect(task.model).toBe("dreamina-seedance-2-0-mini-260615");
    expect((await createMini()).taskId).toBe(task.taskId);
    const { getCanvasVideoTask } = await import("./canvasVideoTask");
    await getCanvasVideoTask(String(task.taskId), 7);
    expect(h.byteplus).toHaveBeenCalledTimes(1);
    expect(h.evolink).not.toHaveBeenCalled();
  });
  it("Mini明确隐私拒绝才回落同Mini，不切2.5", async () => {
    h.byteplusFailure = true;
    const task = await createMini();
    expect(task.engine).toBe("seedance-mini-evolink");
    expect(h.evolink.mock.calls[0][0].body.model).toBe("seedance-2.0-mini-reference-to-video");
    expect(h.openrouter).not.toHaveBeenCalled();
  });
  it("Mini受理后终态隐私拒绝也回落同Mini", async () => {
    const task = await createMini(); h.byteplusPollFailed = true;
    const { getCanvasVideoTask } = await import("./canvasVideoTask");
    expect((await getCanvasVideoTask(String(task.taskId), 7))?.engine).toBe("seedance-mini-evolink");
    expect(h.evolink.mock.calls[0][0].body.model).toBe("seedance-2.0-mini-reference-to-video");
  });
  it("2.5明确拒绝转EvoLink，保留原音轨", async () => {
    h.byteplusRejected = true;
    const task = await create("seedance25-byteplus");
    expect(task.engine).toBe("seedance25-evolink");
    expect(task.status).toBe("running");
    expect(task.evolinkTaskId).toBe("ev-local-test");
    expect(task.audioUrls).toEqual(["gs://test-bucket/post-prod/7/dialogue.wav"]);
    expect(h.evolink.mock.calls[0][0].body.audio_urls[0]).toContain("https://storage.googleapis.com/test-bucket/post-prod/7/dialogue.wav");
    expect(h.byteplus).toHaveBeenCalledTimes(1);
    expect(h.evolink).toHaveBeenCalledTimes(1);
  });

  it("2.5 上游非人脸失败终态只转交一次 EvoLink", async () => {
    const task = await create("seedance25-byteplus");
    h.byteplusPollFailed = true; h.byteplusPollReason = "InvalidParameter: video pixel count";
    const { getCanvasVideoTask } = await import("./canvasVideoTask");
    expect((await getCanvasVideoTask(String(task.taskId), 7))?.engine).toBe("seedance25-evolink");
    await getCanvasVideoTask(String(task.taskId), 7);
    expect(h.evolink).toHaveBeenCalledTimes(1);
    expect(h.byteplus).toHaveBeenCalledTimes(1);
  });

  it("Mini余额明确拒绝不回落，同键failed不重建", async () => {
    h.byteplusRejected = true;
    expect((await createMini()).status).toBe("failed");
    await createMini();
    expect(h.byteplus).toHaveBeenCalledTimes(1); expect(h.evolink).not.toHaveBeenCalled();
  });
  it("Mini未知创建转对账，不回落/退款/重建", async () => {
    h.byteplusUnknown = true;
    const task = await createMini();
    expect(task.status).toBe("reconcile_manual");
    await createMini();
    expect(h.byteplus).toHaveBeenCalledTimes(1); expect(h.evolink).not.toHaveBeenCalled();
    const { refundCreditsOnFailure, pauseActiveJob } = await import("./paidJobLedger.js");
    expect(refundCreditsOnFailure).not.toHaveBeenCalled(); expect(pauseActiveJob).toHaveBeenCalled();
  });
  it("Mini创建后崩溃缺句柄，恢复只对账", async () => {
    const task = await createMini(); delete task.byteplusTaskId; task.status = "running";
    await fs.writeFile(path.join(dir, `${task.taskId}.json`), JSON.stringify(task));
    const { getCanvasVideoTask } = await import("./canvasVideoTask");
    expect((await getCanvasVideoTask(String(task.taskId), 7))?.status).toBe("reconcile_manual");
    expect(h.byteplus).toHaveBeenCalledTimes(1); expect(h.evolink).not.toHaveBeenCalled();
  });
  it("写实素材不跳过已配置BytePlus", async () => {
    const { resolveSeedance25CanvasEngine } = await import("./canvasVideoTask");
    expect(resolveSeedance25CanvasEngine("reference_to_video", { photoreal: true })).toBe("seedance25-byteplus");
    expect(resolveSeedance25CanvasEngine("reference_to_video", { provider: "evolink" })).toBe("seedance25-evolink");
  });
  it("EvoLink最终body是HTTPS，任务持久化仍为GS", async () => {
    const task = await create("seedance25-evolink");
    expect(task.audioUrls).toEqual(["gs://test-bucket/post-prod/7/dialogue.wav"]);
    expect(h.evolink.mock.calls[0][0].body.audio_urls).toEqual(["https://storage.googleapis.com/test-bucket/post-prod/7/dialogue.wav?signature=test-1"]);
  });
  it("白模放大在途先持久化原单，未达标不建BytePlus或Evo单", async () => {
    const { ReferenceVideoPending } = await import("./seedanceReferenceVideoSize.js");
    h.normalizeVideo.mockImplementation(async (_url, _userId, record, save) => {
      record.predictionId = "test-reference-upscale";
      await save();
      throw new ReferenceVideoPending("白模视频正在WaveSpeed高清放大");
    });
    const { createCanvasVideoTask } = await import("./canvasVideoTask");
    const created = await createCanvasVideoTask({ userId: 7, creditsCharged: 0, engine: "seedance25-byteplus", label: "旧白模预处理", prompt: "虚构角色", videoUrls: ["https://example.test/white-model.mp4"], duration: 5, workMode: "reference_to_video" });
    await vi.waitFor(async () => {
      const saved = JSON.parse(await fs.readFile(path.join(dir, `${created.taskId}.json`), "utf8"));
      expect(saved.lastTransientError).toContain("WaveSpeed");
      expect(Object.values(saved.seedanceReferenceVideoUpscales)[0]).toMatchObject({ predictionId: "test-reference-upscale" });
      expect(saved.status).not.toBe("failed");
    });
    expect(h.byteplus).not.toHaveBeenCalled(); expect(h.evolink).not.toHaveBeenCalled();
  });
  it("图片自动放大结果进入BytePlus及拒绝后的EvoLink，视频参考不被当作图片", async () => {
    h.byteplusFailure = true;
    h.normalizeImage.mockResolvedValue("https://example.test/normalized-960x540.png");
    const { createCanvasVideoTask } = await import("./canvasVideoTask");
    const task = await createCanvasVideoTask({ userId: 7, creditsCharged: 0, engine: "seedance25-byteplus", label: "尺寸回归", prompt: "虚构角色", imageUrl: "https://example.test/480x270.png", imageUrls: ["https://example.test/480x270.png"], videoUrls: ["https://example.test/white-model.mp4"], duration: 5, workMode: "reference_to_video" });
    await vi.waitFor(() => expect(h.evolink).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(h.byteplus.mock.calls[0][0])).toContain("normalized-960x540.png");
    expect(JSON.stringify(h.evolink.mock.calls[0][0])).toContain("normalized-960x540.png");
    expect(h.normalizeImage.mock.calls.every(([url]) => !url.endsWith(".mp4"))).toBe(true);
    const saved = JSON.parse(await fs.readFile(path.join(dir, `${task.taskId}.json`), "utf8"));
    expect(saved.imageUrls).toEqual(["https://example.test/480x270.png"]);
  });
  it("BytePlus最终content包含已签音频", async () => {
    const task = await create("seedance25-byteplus");
    expect(task.audioUrls).toEqual(["gs://test-bucket/post-prod/7/dialogue.wav"]);
    expect(h.byteplus.mock.calls[0][0].body.content).toContainEqual({ type: "audio_url", audio_url: { url: "https://storage.googleapis.com/test-bucket/post-prod/7/dialogue.wav?signature=test-1" }, role: "reference_audio" });
  });
  it("BytePlus回落EvoLink重新签名且不覆盖持久身份", async () => {
    h.byteplusFailure = true;
    const task = await create("seedance25-byteplus");
    expect(task.engine).toBe("seedance25-evolink");
    expect(task.audioUrls).toEqual(["gs://test-bucket/post-prod/7/dialogue.wav"]);
    expect(h.evolink.mock.calls[0][0].body.audio_urls[0]).toContain("signature=test-2");
  });
  it("人脸拒绝即使OpenRouter可用仍只转EvoLink并保留音频", async () => {
    h.byteplusFailure = true; h.openrouterEnabled = true;
    const task = await create("seedance25-byteplus");
    expect(task.engine).toBe("seedance25-evolink");
    expect(task.audioUrls).toEqual(["gs://test-bucket/post-prod/7/dialogue.wav"]);
    expect(h.openrouter).not.toHaveBeenCalled();
    expect(h.evolink.mock.calls[0][0].body.audio_urls[0]).toContain("signature=test-2");
  });
  it("延长模式把本人旧成片的过期签名换成供应商可读新链", async () => {
    const old = "https://storage.googleapis.com/test-bucket/growth-camp/videos/old.mp4?X-Goog-Date=20260901T000000Z&X-Goog-Expires=3600&X-Goog-Signature=expired";
    await fs.writeFile(path.join(dir, "cv_prior.json"), JSON.stringify({
      taskId: "cv_prior", userId: 7, status: "succeeded", creditsCharged: 0,
      engine: "seedance25-evolink", label: "旧成片", prompt: "旧", duration: 10,
      videoUrl: old, createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
    }));
    const { createCanvasVideoTask } = await import("./canvasVideoTask");
    const created = await createCanvasVideoTask({
      userId: 7, creditsCharged: 0, engine: "seedance25-evolink", label: "续片",
      prompt: "正向延长十秒", videoUrls: [old], duration: 10, resolution: "720p",
      workMode: "video_extend",
    });
    await vi.waitFor(() => expect(h.evolink).toHaveBeenCalledTimes(1));
    expect(h.evolink.mock.calls[0][0].body.video_urls).toEqual([
      "https://storage.googleapis.com/test-bucket/growth-camp/videos/old.mp4?signature=test-path-1",
    ]);
    const saved = JSON.parse(await fs.readFile(path.join(dir, `${created.taskId}.json`), "utf8"));
    expect(saved.videoUrls).toEqual([old]);
  });
  it("未登记的同桶视频在供应商调用前拒绝", async () => {
    const stolen = "https://storage.googleapis.com/test-bucket/growth-camp/videos/stolen.mp4?X-Goog-Signature=forged";
    const { createCanvasVideoTask } = await import("./canvasVideoTask");
    const created = await createCanvasVideoTask({
      userId: 7, creditsCharged: 0, engine: "seedance25-evolink", label: "越权续片",
      prompt: "正向延长十秒", videoUrls: [stolen], duration: 10, resolution: "720p",
      workMode: "video_extend",
    });
    await vi.waitFor(async () => {
      const saved = JSON.parse(await fs.readFile(path.join(dir, `${created.taskId}.json`), "utf8"));
      expect(saved.status).toBe("failed");
      expect(saved.error).toMatch(/尚未登记/);
    });
    expect(h.evolink).not.toHaveBeenCalled();
  });
  it("base64视频在供应商调用前拒绝", async () => {
    const { createCanvasVideoTask } = await import("./canvasVideoTask");
    const created = await createCanvasVideoTask({
      userId: 7, creditsCharged: 0, engine: "seedance25-evolink", label: "错误视频输入",
      prompt: "正向延长十秒", videoUrls: ["data:video/mp4;base64,AAAA"], duration: 10,
      resolution: "720p", workMode: "video_extend",
    });
    await vi.waitFor(async () => {
      const saved = JSON.parse(await fs.readFile(path.join(dir, `${created.taskId}.json`), "utf8"));
      expect(saved.status).toBe("failed");
      expect(saved.error).toMatch(/必须使用可读取的 URL/);
    });
    expect(h.evolink).not.toHaveBeenCalled();
  });
  it("worker拒绝越权素材，三个供应商均零提交", async () => {
    h.byteplusFailure = true; h.openrouterEnabled = true;
    const task = await create("seedance25-byteplus", "gs://test-bucket/post-prod/8/stolen.wav");
    expect(task.status).toBe("failed");
    expect(h.evolink).not.toHaveBeenCalled(); expect(h.byteplus).not.toHaveBeenCalled(); expect(h.openrouter).not.toHaveBeenCalled();
  });
  async function createInk(key="ink-fixed") {
    const {createCanvasVideoTask}=await import("./canvasVideoTask");
    const task=await createCanvasVideoTask({userId:7,creditsCharged:0,engine:"seedance-mini-evolink",label:"映客未知回执技术探针",prompt:"技术图自然移动",imageUrls:["https://example.test/reference.png"],audioUrls:["gs://test-bucket/post-prod/7/reference-five-seconds.wav"],duration:5,resolution:"480p",seedanceVersion:"2.0-mini",workMode:"reference_to_video",idempotencyKey:key,inkProduction:{projectId:"11111111-1111-4111-8111-111111111111",grantId:"22222222-2222-4222-8222-222222222222",kind:"video",index:0,requestId:key,digest:"a".repeat(64)}});
    let saved:any;await vi.waitFor(async()=>{saved=JSON.parse(await fs.readFile(path.join(dir,`${task.taskId}.json`),"utf8"));expect(["running","reconcile_manual","failed"]).toContain(saved.status);});return saved;
  }
  it("INK创建未知只对账，原id恢复不重投且不退款",async()=>{
    h.evolinkUnknown=true;const task=await createInk();expect(task.status).toBe("reconcile_manual");expect(task.inkProductionSubmissionStartedAt).toBeTruthy();await createInk();const {getCanvasVideoTask}=await import("./canvasVideoTask");await getCanvasVideoTask(task.taskId,7);expect(h.evolink).toHaveBeenCalledTimes(1);expect(h.inkCheck).toHaveBeenCalledTimes(1);const {refundCreditsOnFailure}=await import("./paidJobLedger.js");expect(refundCreditsOnFailure).not.toHaveBeenCalled();
  },30000);
  it("INK实际provider body包含5秒480p和短参考音，原始与parsed回执均保存；崩溃缺handle不重投",async()=>{
    const task=await createInk();expect(h.evolink.mock.calls[0][0].body).toMatchObject({duration:5,quality:"480p",model:"seedance-2.0-mini-reference-to-video"});expect(h.evolink.mock.calls[0][0].body.audio_urls).toEqual([expect.stringContaining("reference-five-seconds.wav")]);const names=Array.from(h.inkReceipts.keys());expect(names.some(n=>n.endsWith("submit-raw.json"))).toBe(true);expect(names.some(n=>n.endsWith("submit-parsed.json"))).toBe(true);expect(task.inkProductionEvidence.raw).toMatchObject({sha256:expect.stringMatching(/^[a-f0-9]{64}$/),bytes:expect.any(Number)});expect(task.inkProductionEvidence.parsed.objectName).toContain("submit-parsed.json");delete task.evolinkTaskId;task.status="running";await fs.writeFile(path.join(dir,`${task.taskId}.json`),JSON.stringify(task));const {getCanvasVideoTask}=await import("./canvasVideoTask");expect((await getCanvasVideoTask(task.taskId,7))?.status).toBe("reconcile_manual");expect(h.evolink).toHaveBeenCalledTimes(1);
  });

  async function createInkByteplus(key="ink-paid-byteplus") {
    const {createCanvasVideoTask}=await import("./canvasVideoTask");
    const task=await createCanvasVideoTask({userId:7,creditsCharged:130,engine:"seedance25-byteplus",label:"映客付费假服务探针",prompt:"杯中蒸汽升起",imageUrls:["https://example.test/cup.png"],audioUrls:["gs://test-bucket/post-prod/7/reference-five-seconds.wav"],duration:5,resolution:"720p",workMode:"reference_to_video",idempotencyKey:key,
      inkProduction:{projectId:"11111111-1111-4111-8111-111111111111",grantId:"22222222-2222-4222-8222-222222222222",kind:"video",index:0,requestId:key,digest:"a".repeat(64)}});
    let saved:any;await vi.waitFor(async()=>{saved=JSON.parse(await fs.readFile(path.join(dir,`${task.taskId}.json`),"utf8"));expect(["running","failed","reconcile_manual"]).toContain(saved.status);});return saved;
  }
  it("INK paid BytePlus unknown result has a durable marker and never falls back, resubmits or refunds",async()=>{
    h.byteplusUnknown=true;const task=await createInkByteplus();expect(task.status).toBe("reconcile_manual");expect(task.inkProductionByteplusSubmissionStartedAt).toBeTruthy();
    await createInkByteplus();const {getCanvasVideoTask}=await import("./canvasVideoTask");await getCanvasVideoTask(task.taskId,7);
    expect(h.byteplus).toHaveBeenCalledTimes(1);expect(h.evolink).not.toHaveBeenCalled();
    const {refundCreditsOnFailure}=await import("./paidJobLedger.js");expect(refundCreditsOnFailure).not.toHaveBeenCalled();
  });
  it("INK paid explicit BytePlus rejection uses the existing EvoLink fallback with all audio references once",async()=>{
    h.byteplusRejected=true;const task=await createInkByteplus();expect(task.engine).toBe("seedance25-evolink");expect(task.fallbackReason).toContain("AccountOverdue");
    await createInkByteplus();expect(h.byteplus).toHaveBeenCalledTimes(1);expect(h.evolink).toHaveBeenCalledTimes(1);
    expect(h.evolink.mock.calls[0][0].body.audio_urls).toEqual([expect.stringContaining("reference-five-seconds.wav")]);
  });
  it("INK paid BytePlus process recovery without a handle does not submit again",async()=>{
    const task=await createInkByteplus();delete task.byteplusTaskId;task.status="running";await fs.writeFile(path.join(dir,`${task.taskId}.json`),JSON.stringify(task));
    const {getCanvasVideoTask}=await import("./canvasVideoTask");expect((await getCanvasVideoTask(task.taskId,7))?.status).toBe("reconcile_manual");
    expect(h.byteplus).toHaveBeenCalledTimes(1);expect(h.evolink).not.toHaveBeenCalled();const {refundCreditsOnFailure}=await import("./paidJobLedger.js");expect(refundCreditsOnFailure).not.toHaveBeenCalled();
  });

});
