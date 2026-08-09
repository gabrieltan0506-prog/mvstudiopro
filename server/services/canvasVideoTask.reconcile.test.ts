import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 超时对账状态机 + 幂等的回归（实测 4K 要 968s，旧默认 900s 直接误杀退分）：
 *  - 越过 maxPollMs 且上游已受理 → timed_out_pending_reconcile 继续轮询，不退分；
 *    晚到的成功照常入账（这是真金白银：上游不可取消，退了分片子还会出来）
 *  - 对账窗口内上游明确失败 → 恰好一次退分
 *  - 对账窗口也尽了 → reconcile_manual 停轮询等人工，不自动退分
 *  - 轮询抛错是瞬态，不得当终态失败退分
 *  - idempotencyKey 同键重复创建返回同一任务；既有任务 failed 后放行重开
 *
 * 时间推进不用 fake timers（worker interval 会竞态），改为直接回拨任务文件里的
 * createdAt / timedOutAt——超时判定只读这两个字段与 Date.now() 的差。
 */

// 用例体内 await import 大模块，导入成本计入用例预算，全量并发下 5s 默认线会被踩爆
vi.setConfig({ testTimeout: 60_000 });

const EVOLINK_MAX = 1_500_000;
const RECONCILE_MIN = 300_000; // CANVAS_VIDEO_RECONCILE_EXTRA_MS 的下限 clamp

const evolinkSubmit = vi.fn();
const evolinkPoll = vi.fn();
vi.mock("./evolinkSeedanceVideo.js", () => ({
  EVOLINK_SEEDANCE_MAX_POLL_MS: 1_500_000,
  // worker tick = min(两个 interval)，给大值让后台 worker 在测试期内不插手
  EVOLINK_SEEDANCE_POLL_INTERVAL_MS: 600_000,
  isEvolinkSeedanceConfigured: () => true,
  submitEvolinkSeedanceVideo: (...args: unknown[]) => evolinkSubmit(...args),
  pollEvolinkVideoTaskOnce: (...args: unknown[]) => evolinkPoll(...args),
}));

vi.mock("./byteplusSeedanceVideo.js", () => ({
  BYTEPLUS_SEEDANCE_MAX_POLL_MS: 1_500_000,
  isByteplusFallbackableError: () => false,
  isByteplusSeedanceConfigured: () => false,
  pollByteplusVideoTaskOnce: vi.fn(),
  submitByteplusSeedance25Video: vi.fn(),
}));

vi.mock("./openrouterVideoCore.js", () => ({
  OPENROUTER_VIDEO_MAX_POLL_MS: 1_500_000,
  OPENROUTER_VIDEO_POLL_INTERVAL_MS: 600_000,
  mirrorOpenRouterVideoSourceUrl: vi.fn(async (u: string) => `mirrored:${u}`),
  pollOpenRouterVideoJobOnce: vi.fn(),
  submitOpenRouterVideoJob: vi.fn(),
}));

vi.mock("./wavespeedVideoUpscale.js", () => ({
  WAVESPEED_UPSCALE_MAX_POLL_MS: 3_600_000,
  pollWavespeedUpscaleOnce: vi.fn(),
  submitWavespeedVideoUpscale: vi.fn(),
}));

vi.mock("./openrouterSeedanceVideo.js", () => ({ buildOpenRouterSeedanceSubmitBody: vi.fn() }));
vi.mock("./openrouterHailuoVideo.js", () => ({ buildOpenRouterHailuoSubmitBody: vi.fn() }));
vi.mock("./openrouterHappyHorseVideo.js", () => ({ buildOpenRouterHappyHorseSubmitBody: vi.fn() }));
vi.mock("./openrouterGptImage2.js", () => ({ getOpenRouterApiKey: () => "test-key" }));
vi.mock("./seedanceVideo.js", () => ({
  mirrorSeedanceMp4ToGcsSignedUrl: vi.fn(async (u: string) => `mirrored:${u}`),
}));

const registerActiveJob = vi.fn(async () => {});
const refundCreditsOnFailure = vi.fn(async () => ({ refunded: true, creditsRefunded: 388, status: "refunded" }));
const pauseActiveJob = vi.fn(async () => {});
const unregisterActiveJob = vi.fn(async () => ({ ok: true }));
vi.mock("./paidJobLedger.js", () => ({
  heartbeatActiveJob: vi.fn(async () => {}),
  pauseActiveJob: (...args: unknown[]) => pauseActiveJob(...args),
  registerActiveJob: (...args: unknown[]) => registerActiveJob(...args),
  refundCreditsOnFailure: (...args: unknown[]) => refundCreditsOnFailure(...args),
  unregisterActiveJob: (...args: unknown[]) => unregisterActiveJob(...args),
}));

vi.mock("../credits.js", () => ({ refundCredits: vi.fn(async () => {}) }));

describe("canvasVideoTask 超时对账 + 幂等", () => {
  let tempDir = "";
  const ORIGINAL_TASK_DIR = process.env.CANVAS_VIDEO_TASK_DIR;
  const ORIGINAL_RECONCILE = process.env.CANVAS_VIDEO_RECONCILE_EXTRA_MS;

  beforeEach(async () => {
    vi.resetModules();
    evolinkSubmit.mockReset();
    evolinkPoll.mockReset();
    registerActiveJob.mockClear();
    refundCreditsOnFailure.mockClear();
    pauseActiveJob.mockClear();
    unregisterActiveJob.mockClear();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-video-task-"));
    process.env.CANVAS_VIDEO_TASK_DIR = tempDir;
    process.env.CANVAS_VIDEO_RECONCILE_EXTRA_MS = String(RECONCILE_MIN);
    // 默认提交行为：立刻受理拿到上游任务号
    evolinkSubmit.mockResolvedValue({ evolinkTaskId: "ev-1", model: "seedance-2.5", mode: "text_to_video" });
    evolinkPoll.mockResolvedValue({ state: "running", status: "processing" });
  });

  afterEach(async () => {
    if (ORIGINAL_TASK_DIR) process.env.CANVAS_VIDEO_TASK_DIR = ORIGINAL_TASK_DIR;
    else delete process.env.CANVAS_VIDEO_TASK_DIR;
    if (ORIGINAL_RECONCILE) process.env.CANVAS_VIDEO_RECONCILE_EXTRA_MS = ORIGINAL_RECONCILE;
    else delete process.env.CANVAS_VIDEO_RECONCILE_EXTRA_MS;
    // create 的 void advanceTask 可能还在写文件（idem 映射/任务 json），与递归删除竞态
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  async function mod() {
    return import("./canvasVideoTask");
  }

  async function until(cond: () => Promise<boolean>, ms = 5000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await cond()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("condition not reached in time");
  }

  async function readTaskFile(taskId: string) {
    const raw = await fs.readFile(path.join(tempDir, `${taskId}.json`), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  }

  async function patchTaskFile(taskId: string, patch: Record<string, unknown>) {
    const task = await readTaskFile(taskId);
    Object.assign(task, patch);
    await fs.writeFile(path.join(tempDir, `${taskId}.json`), JSON.stringify(task));
  }

  function agoIso(ms: number): string {
    return new Date(Date.now() - ms).toISOString();
  }

  async function createRunningTask(m: Awaited<ReturnType<typeof mod>>) {
    const task = await m.createCanvasVideoTask({
      userId: 7,
      creditsCharged: 388,
      engine: "seedance25-evolink",
      label: "测试成片",
      prompt: "一条测试视频",
      duration: 5,
    });
    await until(async () => (await readTaskFile(task.taskId)).status === "running");
    return task.taskId;
  }

  it("968s 后成功：新默认线内不误杀，正常入账", async () => {
    const m = await mod();
    const taskId = await createRunningTask(m);
    // 把创建时间回拨 968s（< 1500s 上限）——4K 实测耗时，旧默认 900s 会在这里误杀
    await patchTaskFile(taskId, { createdAt: agoIso(968_000) });
    evolinkPoll.mockResolvedValue({ state: "completed", sourceUrl: "https://cdn/x.mp4" });
    const task = await m.getCanvasVideoTask(taskId, 7);
    expect(task?.status).toBe("succeeded");
    expect(task?.videoUrl).toBe("mirrored:https://cdn/x.mp4");
    expect(refundCreditsOnFailure).toHaveBeenCalledTimes(0);
    expect(unregisterActiveJob).toHaveBeenCalledWith(taskId, "canvasVideo", "settled");
  });

  it("越线且上游已受理 → 对账态不退分；晚到的成功照常入账", async () => {
    const m = await mod();
    const taskId = await createRunningTask(m);
    await patchTaskFile(taskId, { createdAt: agoIso(EVOLINK_MAX + 1_000) });
    let task = await m.getCanvasVideoTask(taskId, 7);
    expect(task?.status).toBe("timed_out_pending_reconcile");
    expect(refundCreditsOnFailure).toHaveBeenCalledTimes(0);

    // 上游晚点交片
    evolinkPoll.mockResolvedValue({ state: "completed", sourceUrl: "https://cdn/late.mp4" });
    task = await m.getCanvasVideoTask(taskId, 7);
    expect(task?.status).toBe("succeeded");
    expect(task?.videoUrl).toBe("mirrored:https://cdn/late.mp4");
    expect(refundCreditsOnFailure).toHaveBeenCalledTimes(0);
  });

  it("对账窗口内上游明确失败 → 恰好一次退分", async () => {
    const m = await mod();
    const taskId = await createRunningTask(m);
    await patchTaskFile(taskId, { createdAt: agoIso(EVOLINK_MAX + 1_000) });
    let task = await m.getCanvasVideoTask(taskId, 7);
    expect(task?.status).toBe("timed_out_pending_reconcile");

    evolinkPoll.mockResolvedValue({ state: "failed", error: "上游明确失败" });
    task = await m.getCanvasVideoTask(taskId, 7);
    expect(task?.status).toBe("failed");
    expect(refundCreditsOnFailure).toHaveBeenCalledTimes(1);
  });

  it("对账窗口也尽了 → reconcile_manual 停轮询等人工，不自动退分", async () => {
    const m = await mod();
    const taskId = await createRunningTask(m);
    await patchTaskFile(taskId, {
      createdAt: agoIso(EVOLINK_MAX + RECONCILE_MIN + 10_000),
      status: "timed_out_pending_reconcile",
      timedOutAt: agoIso(RECONCILE_MIN + 1_000),
    });
    const task = await m.getCanvasVideoTask(taskId, 7);
    expect(task?.status).toBe("reconcile_manual");
    expect(pauseActiveJob).toHaveBeenCalledWith(taskId, "canvasVideo");
    expect(refundCreditsOnFailure).toHaveBeenCalledTimes(0);
    // 终态：再查不再推进
    const again = await m.getCanvasVideoTask(taskId, 7);
    expect(again?.status).toBe("reconcile_manual");
  });

  it("从未提交到上游的超时任务照旧失败退分（上游没在烧钱，退是安全的）", async () => {
    const m = await mod();
    // 提交永远失败挂起前的状态：手工造一个没有任何上游任务号的超时任务
    evolinkSubmit.mockRejectedValue(new Error("提交挂了"));
    const created = await m.createCanvasVideoTask({
      userId: 7,
      creditsCharged: 388,
      engine: "seedance25-evolink",
      label: "测试成片",
      prompt: "一条测试视频",
      duration: 5,
    });
    await until(async () => {
      const t = await readTaskFile(created.taskId);
      return t.status === "failed";
    });
    // 提交阶段失败 → failTask 已退分一次
    expect(refundCreditsOnFailure).toHaveBeenCalledTimes(1);
  });

  it("轮询抛错是瞬态：不退分、记录 lastTransientError、状态保持活跃", async () => {
    const m = await mod();
    const taskId = await createRunningTask(m);
    evolinkPoll.mockRejectedValue(new Error("ECONNRESET"));
    const task = await m.getCanvasVideoTask(taskId, 7);
    expect(task?.status).toBe("running");
    expect(task?.lastTransientError).toContain("ECONNRESET");
    expect(refundCreditsOnFailure).toHaveBeenCalledTimes(0);

    // 抖动过去后照常成功
    evolinkPoll.mockResolvedValue({ state: "completed", sourceUrl: "https://cdn/ok.mp4" });
    const done = await m.getCanvasVideoTask(taskId, 7);
    expect(done?.status).toBe("succeeded");
  });

  it("幂等：同键重复创建返回同一任务，不重复注册账本", async () => {
    const m = await mod();
    const first = await m.createCanvasVideoTask({
      userId: 7,
      creditsCharged: 388,
      engine: "seedance25-evolink",
      label: "测试成片",
      prompt: "一条测试视频",
      duration: 5,
      idempotencyKey: "client-key-1",
    });
    await until(async () => (await readTaskFile(first.taskId)).status === "running");
    const second = await m.createCanvasVideoTask({
      userId: 7,
      creditsCharged: 388,
      engine: "seedance25-evolink",
      label: "测试成片",
      prompt: "一条测试视频",
      duration: 5,
      idempotencyKey: "client-key-1",
    });
    expect(second.taskId).toBe(first.taskId);
    expect(registerActiveJob).toHaveBeenCalledTimes(1);
    expect(evolinkSubmit).toHaveBeenCalledTimes(1);
  });

  it("幂等：同键并发创建只产生一个任务（wx 原子排他当唯一约束）", async () => {
    const m = await mod();
    const input = {
      userId: 7,
      creditsCharged: 388,
      engine: "seedance25-evolink" as const,
      label: "测试成片",
      prompt: "一条测试视频",
      duration: 5,
      idempotencyKey: "client-key-race",
    };
    const [a, b] = await Promise.all([
      m.createCanvasVideoTask(input),
      m.createCanvasVideoTask(input),
    ]);
    expect(a.taskId).toBe(b.taskId);
  });

  it("幂等：既有任务已 failed（已退分）→ 同键放行重开为新任务", async () => {
    const m = await mod();
    const first = await m.createCanvasVideoTask({
      userId: 7,
      creditsCharged: 388,
      engine: "seedance25-evolink",
      label: "测试成片",
      prompt: "一条测试视频",
      duration: 5,
      idempotencyKey: "client-key-2",
    });
    await until(async () => (await readTaskFile(first.taskId)).status === "running");
    await patchTaskFile(first.taskId, { status: "failed", error: "上游失败" });
    const second = await m.createCanvasVideoTask({
      userId: 7,
      creditsCharged: 388,
      engine: "seedance25-evolink",
      label: "测试成片",
      prompt: "一条测试视频",
      duration: 5,
      idempotencyKey: "client-key-2",
    });
    expect(second.taskId).not.toBe(first.taskId);
    expect(registerActiveJob).toHaveBeenCalledTimes(2);
  });

  it("超分任务走同一状态机：submit 拿 predictionId，结果写 videoUrl、原片字段不动", async () => {
    const m = await mod();
    const { submitWavespeedVideoUpscale, pollWavespeedUpscaleOnce } = await import(
      "./wavespeedVideoUpscale.js"
    );
    (submitWavespeedVideoUpscale as ReturnType<typeof vi.fn>).mockResolvedValue({
      predictionId: "ws-1",
    });
    (pollWavespeedUpscaleOnce as ReturnType<typeof vi.fn>).mockResolvedValue({
      state: "completed",
      sourceUrl: "https://ws/4k.mp4",
    });
    const created = await m.createCanvasVideoTask({
      userId: 7,
      creditsCharged: 688,
      engine: "wavespeed-upscale",
      label: "高清放大·4K（30s）",
      prompt: "",
      duration: 30,
      resolution: "4k",
      upscaleSourceUrl: "https://cdn/origin.mp4",
      upscaleTarget: "4k",
    });
    await until(async () => (await readTaskFile(created.taskId)).status === "succeeded");
    const task = await m.getCanvasVideoTask(created.taskId, 7);
    expect(task?.videoUrl).toBe("mirrored:https://ws/4k.mp4");
    expect(task?.upscaleSourceUrl).toBe("https://cdn/origin.mp4");
    expect(refundCreditsOnFailure).toHaveBeenCalledTimes(0);
  });
});
