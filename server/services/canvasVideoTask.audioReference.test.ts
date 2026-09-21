import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({
  h3: vi.fn(), h3Unknown: false, evolink: vi.fn(), byteplus: vi.fn(), openrouter: vi.fn(), signed: 0,
  byteplusFailure: false, openrouterEnabled: false,
}));
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
      return { evolinkTaskId: "ev-local-test", model: "seedance-2.5-reference-to-video", mode: "reference_to_video" };
    }, pollEvolinkVideoTaskOnce: async () => ({ state: "running", status: "processing" }),
  };
});
vi.mock("./byteplusSeedanceVideo.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./byteplusSeedanceVideo.js")>();
  return { ...actual, isByteplusSeedanceConfigured: () => true,
    submitByteplusSeedance25Video: async (input: Parameters<typeof actual.buildByteplusSeedance25SubmitBody>[0]) => {
      h.byteplus(actual.buildByteplusSeedance25SubmitBody(input));
      if (h.byteplusFailure) throw new Error("InputImageSensitiveContentDetected.PrivacyInformation");
      return { byteplusTaskId: "bp-local-test", model: "seedance-2.5", mode: "reference_to_video" };
    }, pollByteplusVideoTaskOnce: async () => ({ state: "running", status: "processing" }),
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
    h.evolink.mockReset(); h.byteplus.mockReset(); h.openrouter.mockReset();
    h.h3.mockReset(); h.h3Unknown = false;
    h.signed = 0; h.byteplusFailure = false; h.openrouterEnabled = false;
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
  it("写实素材不跳过已配置BytePlus", async () => {
    const { resolveSeedance25CanvasEngine } = await import("./canvasVideoTask");
    expect(resolveSeedance25CanvasEngine("reference_to_video", { photoreal: true })).toBe("seedance25-byteplus");
  });
  it("EvoLink最终body是HTTPS，任务持久化仍为GS", async () => {
    const task = await create("seedance25-evolink");
    expect(task.audioUrls).toEqual(["gs://test-bucket/post-prod/7/dialogue.wav"]);
    expect(h.evolink.mock.calls[0][0].body.audio_urls).toEqual(["https://storage.googleapis.com/test-bucket/post-prod/7/dialogue.wav?signature=test-1"]);
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
});
