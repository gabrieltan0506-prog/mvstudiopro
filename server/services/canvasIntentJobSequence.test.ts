/**
 * D 施工单第 6 节「四层计数」离线证据：**真实任务文件层** + 内存意图存储 + 幂等假账本。
 *
 * 复刻 api/jobs 七个建单点共用的序列（不经 HTTP）：
 *   acquireCanvasIntent → 扣费（按 intentId 幂等）→ CAS charged（fencing）→ createCanvasVideoTask(预留 taskId)
 *   → CAS task_created
 * 四层：入口调用数 / 任务文件数 / 有效扣费数 / 上游提交数。
 *
 * 不 mock createCanvasVideoTask 的 fs.link 竞态（施工单明令）；上游提交与账本登记按
 * canvasVideoTask.reconcile.test 同一套 mock（计数用），数据库真实原子性仍在台账里标未验。
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryCanvasIntentStore } from "./canvasIntentStore";

vi.setConfig({ testTimeout: 60_000 });

const evolinkSubmit = vi.fn();
const evolinkPoll = vi.fn();
vi.mock("./evolinkSeedanceVideo.js", () => ({
  EVOLINK_SEEDANCE_MAX_POLL_MS: 1_500_000,
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
  isOpenRouterVideoConfigured: vi.fn(() => false),
  isOpenRouterSubmitRejected: vi.fn(() => false),
  isOpenRouterSubmitUnknown: vi.fn(() => false),
}));
vi.mock("./wavespeedVideoUpscale.js", () => ({
  WAVESPEED_UPSCALE_MAX_POLL_MS: 3_600_000,
  pollWavespeedUpscaleOnce: vi.fn(),
  submitWavespeedVideoUpscale: vi.fn(),
}));
vi.mock("./openrouterSeedanceVideo.js", () => ({ buildOpenRouterSeedanceSubmitBody: vi.fn() }));
vi.mock("./openrouterHailuoVideo.js", () => ({ buildOpenRouterHailuoSubmitBody: vi.fn() }));
vi.mock("./openrouterHappyHorseVideo.js", () => ({
  buildOpenRouterHappyHorseSubmitBody: vi.fn(() => ({ model: "alibaba/happyhorse-1.1" })),
  isOpenRouterHappyHorseConfigured: () => true,
}));
vi.mock("./happyHorseChannels.js", () => ({ submitHappyHorseViaChannels: vi.fn() }));
vi.mock("./openrouterGptImage2.js", () => ({ getOpenRouterApiKey: () => "test-key" }));
vi.mock("./seedanceVideo.js", () => ({ mirrorSeedanceMp4ToGcsSignedUrl: vi.fn(async (u: string) => `mirrored:${u}`) }));
const registerActiveJob = vi.fn(async (..._args: unknown[]) => {});
vi.mock("./paidJobLedger.js", () => ({
  heartbeatActiveJob: vi.fn(async () => {}),
  pauseActiveJob: vi.fn(async () => {}),
  registerActiveJob: (...args: unknown[]) => registerActiveJob(...args),
  refundCreditsOnFailure: vi.fn(async () => ({ refunded: true, creditsRefunded: 0, status: "refunded" })),
  unregisterActiveJob: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../credits.js", () => ({ refundCredits: vi.fn(async () => {}) }));
vi.mock("./wan30Channels.js", () => ({ submitWan30ViaChannels: vi.fn() }));

/** 幂等假账本：同 chargeKey 只扣一次（模拟 stripe_usage_logs 唯一索引 + 读回） */
function fakeLedger() {
  const charged = new Map<string, number>();
  let deductions = 0;
  return {
    charge: (chargeKey: string, credits: number) => {
      if (charged.has(chargeKey)) return { credits: charged.get(chargeKey)!, alreadyCharged: true };
      charged.set(chargeKey, credits);
      deductions += 1;
      return { credits, alreadyCharged: false };
    },
    deductions: () => deductions,
  };
}

describe("建单序列四层计数（真实任务文件层）", () => {
  let tempDir = "";
  const ORIGINAL = process.env.CANVAS_VIDEO_TASK_DIR;
  let store: MemoryCanvasIntentStore;

  beforeEach(async () => {
    vi.resetModules();
    evolinkSubmit.mockReset();
    evolinkPoll.mockReset();
    registerActiveJob.mockClear();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "intent-seq-"));
    process.env.CANVAS_VIDEO_TASK_DIR = tempDir;
    evolinkSubmit.mockResolvedValue({ evolinkTaskId: "ev-1", model: "seedance-2.5", mode: "text_to_video" });
    evolinkPoll.mockResolvedValue({ state: "running", status: "processing" });
    store = new MemoryCanvasIntentStore();
  });
  afterEach(async () => {
    if (ORIGINAL) process.env.CANVAS_VIDEO_TASK_DIR = ORIGINAL;
    else delete process.env.CANVAS_VIDEO_TASK_DIR;
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  async function taskFiles(): Promise<string[]> {
    const names = await fs.readdir(tempDir);
    return names.filter((n) => n.startsWith("cv_") && n.endsWith(".json"));
  }

  const TASK_INPUT = {
    engine: "seedance25-evolink" as const,
    label: "测试",
    prompt: "一条测试视频",
    duration: 5,
    aspectRatio: "16:9",
    resolution: "720p",
    generateAudio: true,
    workMode: "text_to_video" as const,
  };

  /**
   * 复刻 api/jobs 站点序列。返回与站点同形的结果：proceed 后是 taskId；否则是裁决回复。
   * `crashAfterCharge` 模拟「扣费后建单前进程死掉」；`holder` 模拟不同执行体。
   */
  async function runSite(input: {
    intentId: string;
    userId?: number;
    holder: string;
    ledger: ReturnType<typeof fakeLedger>;
    taskInput?: Record<string, unknown>;
    crashAfterCharge?: boolean;
    chargeFails?: boolean;
    now?: () => number;
    leaseMs?: number;
  }) {
    const intent = await import("./canvasGenerationIntent");
    const cvt = await import("./canvasVideoTask");
    const userId = input.userId ?? 7;
    const taskInput = input.taskInput ?? TASK_INPUT;
    const decision = await intent.acquireCanvasIntent({
      store, userId, intentId: input.intentId, operation: "seedance25Video",
      requestDigest: intent.computeCanvasTaskInputDigest(taskInput), holderId: input.holder,
      now: input.now, leaseMs: input.leaseMs,
    });
    const step = intent.planCanvasIntentJobStep(decision, input.intentId);
    if (!step.proceed) {
      const kind = step.kind === "reply" ? (step.status === 202 ? "creating" : String(step.status)) : "existing_task";
      return { kind, taskId: step.kind === "existing_task" ? step.taskId : undefined };
    }
    // 扣费：按 intentId 幂等（与 chargeCanvasVideoCredits 的 marker 同性质）
    if (input.chargeFails) {
      // 站点在 !charged.ok 分支：释放占位后返回错误（不扣费不建单）
      await intent.releaseCanvasIntentLease({ store, userId, intentId: input.intentId, holderId: input.holder, now: input.now });
      return { kind: "charge_failed" as const, taskId: undefined };
    }
    const charged = input.ledger.charge(`marker:${userId}:${input.intentId}`, 118);
    const fenced = await intent.updateCanvasIntentStage({ store, userId, intentId: input.intentId, holderId: input.holder, stage: "charged", chargeKey: `marker:${userId}:${input.intentId}`, now: input.now, leaseMs: input.leaseMs });
    if (!fenced) return { kind: "fenced" as const, taskId: undefined };
    if (input.crashAfterCharge) throw new Error("simulated crash after charge");
    const task = await cvt.createCanvasVideoTask({ ...(taskInput as typeof TASK_INPUT), taskId: step.taskId, userId, creditsCharged: charged.credits, idempotencyKey: input.intentId });
    await intent.updateCanvasIntentStage({ store, userId, intentId: input.intentId, holderId: input.holder, stage: "task_created", now: input.now, leaseMs: input.leaseMs });
    return { kind: "created" as const, taskId: task.taskId };
  }

  it("#1 十路并发同意图：1 个任务文件、1 次扣费、≤1 次上游提交；输家拿 creating，事后再来拿 existing_task", async () => {
    const ledger = fakeLedger();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, k) => runSite({ intentId: "gi_seq_1", holder: `h${k}`, ledger })),
    );
    const created = results.filter((r) => r.kind === "created");
    expect(created).toHaveLength(1);
    expect(results.filter((r) => r.kind === "creating")).toHaveLength(9);
    expect(await taskFiles()).toHaveLength(1);
    expect(ledger.deductions()).toBe(1);
    // 上游提交由后台 advance 触发，最多一次（同一任务）
    await new Promise((r) => setTimeout(r, 200));
    expect(evolinkSubmit.mock.calls.length).toBeLessThanOrEqual(1);
    // 事后重试（刷新/重点）：既有任务，不新建不扣费
    const again = await runSite({ intentId: "gi_seq_1", holder: "late", ledger });
    expect(again.kind).toBe("existing_task");
    expect(again.taskId).toBe(created[0]!.taskId);
    expect(await taskFiles()).toHaveLength(1);
    expect(ledger.deductions()).toBe(1);
  });

  it("#8 扣费后建单前崩溃：另一执行体恢复到**同一个** taskId，扣费仍 1 次，任务文件 1 个", async () => {
    const ledger = fakeLedger();
    let t = 1_000_000;
    const now = () => t;
    await expect(runSite({ intentId: "gi_seq_8", holder: "A", ledger, crashAfterCharge: true, now, leaseMs: 1000 })).rejects.toThrow(/crash/);
    expect(await taskFiles()).toHaveLength(0);
    expect(ledger.deductions()).toBe(1);
    const intent = await import("./canvasGenerationIntent");
    const rec = await intent.lookupCanvasIntent({ store, userId: 7, intentId: "gi_seq_8" });
    expect(rec.kind).toBe("ok");
    const reserved = rec.kind === "ok" ? rec.record.taskId : "";
    // 租约未过期时别的执行体只能得到 creating（A 可能只是慢）
    const tooEarly = await runSite({ intentId: "gi_seq_8", holder: "B", ledger, now });
    expect(tooEarly.kind).toBe("creating");
    expect(await taskFiles()).toHaveLength(0);
    // 租约过期后恢复：B 先接管持有权 → charged_pending_task → 用预留 taskId 建单；扣费幂等命中不再扣
    t += 2000;
    const recovered = await runSite({ intentId: "gi_seq_8", holder: "B", ledger, now });
    expect(recovered.kind).toBe("created");
    expect(recovered.taskId).toBe(reserved);
    expect(await taskFiles()).toHaveLength(1);
    expect(ledger.deductions()).toBe(1);
  });

  it("#4 同意图不同输入：conflict，零扣费零任务", async () => {
    const ledger = fakeLedger();
    const a = await runSite({ intentId: "gi_seq_4", holder: "A", ledger });
    expect(a.kind).toBe("created");
    const b = await runSite({ intentId: "gi_seq_4", holder: "B", ledger, taskInput: { ...TASK_INPUT, prompt: "改了提示词" } });
    expect(b.kind).toBe("409");
    expect(ledger.deductions()).toBe(1);
    expect(await taskFiles()).toHaveLength(1);
  });

  it("扣费失败（余额不足/服务异常）后释放占位：充值后立刻重试能接管，不空等 60 秒；总扣费 1 任务 1", async () => {
    const ledger = fakeLedger();
    let t = 1_000_000;
    const now = () => t;
    const failed = await runSite({ intentId: "gi_seq_rel", holder: "A", ledger, chargeFails: true, now });
    expect(failed.kind).toBe("charge_failed");
    expect(ledger.deductions()).toBe(0);
    t += 10; // 几乎立刻重试（不到 60 秒）
    const retry = await runSite({ intentId: "gi_seq_rel", holder: "B", ledger, now });
    expect(retry.kind).toBe("created");
    expect(await taskFiles()).toHaveLength(1);
    expect(ledger.deductions()).toBe(1);
  });

  it("fencing：A 占位后租约过期，B 接管并建单；A 迟到推进 charged 被拒 → A 不建单；总任务 1、扣费 1", async () => {
    const ledger = fakeLedger();
    let t = 1_000_000;
    const now = () => t;
    const intent = await import("./canvasGenerationIntent");
    // A 只占位（模拟卡在扣费前）
    const a = await intent.acquireCanvasIntent({ store, userId: 7, intentId: "gi_seq_f", operation: "seedance25Video", requestDigest: intent.computeCanvasTaskInputDigest(TASK_INPUT), holderId: "A", now, leaseMs: 1000 });
    expect(a.kind).toBe("acquired");
    t += 2000; // A 的租约过期
    const b = await runSite({ intentId: "gi_seq_f", holder: "B", ledger, now });
    expect(b.kind).toBe("created");
    // A 醒来继续：扣费幂等命中，charged CAS 因持有者已是 B 而失败 → 出局，不许建单
    const late = ledger.charge("marker:7:gi_seq_f", 118);
    expect(late.alreadyCharged).toBe(true);
    const fenced = await intent.updateCanvasIntentStage({ store, userId: 7, intentId: "gi_seq_f", holderId: "A", stage: "charged", chargeKey: "marker:7:gi_seq_f", now });
    expect(fenced).toBeNull();
    expect(await taskFiles()).toHaveLength(1);
    expect(ledger.deductions()).toBe(1);
  });
});
