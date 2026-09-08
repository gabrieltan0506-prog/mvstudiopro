import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({
  evolink: vi.fn(), byteplus: vi.fn(), openrouter: vi.fn(), signed: 0,
  byteplusFailure: false, openrouterEnabled: false,
}));
vi.mock("./gcs.js", async importOriginal => ({
  ...await importOriginal<typeof import("./gcs.js")>(),
  getGcsBucketName: () => "test-bucket",
  signGsUriV4ReadUrl: (uri: string) => `https://storage.googleapis.com/${uri.slice(5)}?signature=test-${++h.signed}`,
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
  return { ...actual, isByteplusSeedanceConfigured: () => true, isByteplusFallbackableError: (error: unknown) => error instanceof Error && error.message === "test-fallback",
    submitByteplusSeedance25Video: async (input: Parameters<typeof actual.buildByteplusSeedance25SubmitBody>[0]) => {
      h.byteplus(actual.buildByteplusSeedance25SubmitBody(input));
      if (h.byteplusFailure) throw new Error("test-fallback");
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
  async function create(engine: "seedance25-evolink" | "seedance25-byteplus", audio = "gs://test-bucket/post-prod/7/dialogue.wav") {
    const { createCanvasVideoTask } = await import("./canvasVideoTask");
    const task = await createCanvasVideoTask({ userId: 7, creditsCharged: 0, engine, label: "本机音频交接测试", prompt: "角色说话", audioUrls: [audio], duration: 5, resolution: "720p", workMode: "reference_to_video" });
    let saved: Record<string, unknown> = {};
    await vi.waitFor(async () => {
      saved = JSON.parse(await fs.readFile(path.join(dir, `${task.taskId}.json`), "utf8"));
      expect(["running", "failed"]).toContain(saved.status);
    });
    return saved;
  }
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
  it("BytePlus回落OpenRouter也得到全量已签音频", async () => {
    h.byteplusFailure = true; h.openrouterEnabled = true;
    const task = await create("seedance25-byteplus");
    expect(task.engine).toBe("seedance-openrouter");
    expect(task.audioUrls).toEqual(["gs://test-bucket/post-prod/7/dialogue.wav"]);
    expect(h.openrouter.mock.calls[0][0].input_references).toContainEqual({ type: "audio_url", audio_url: { url: "https://storage.googleapis.com/test-bucket/post-prod/7/dialogue.wav?signature=test-2" } });
  });
  it("worker拒绝越权素材，三个供应商均零提交", async () => {
    h.byteplusFailure = true; h.openrouterEnabled = true;
    const task = await create("seedance25-byteplus", "gs://test-bucket/post-prod/8/stolen.wav");
    expect(task.status).toBe("failed");
    expect(h.evolink).not.toHaveBeenCalled(); expect(h.byteplus).not.toHaveBeenCalled(); expect(h.openrouter).not.toHaveBeenCalled();
  });
});
