/**
 * 视频局部修改 · 重启后的自动续查与对账。
 *
 * 背景：局部修改执行中途遇到部署/机器重启，任务会停在「待核对」——积分不退也不续查。
 * 本模块在服务启动后定时扫描未结清的局部修改任务，按下表处理（每个任务一轮只做一步）：
 *
 * | 情况                                             | 处理                                             |
 * | ------------------------------------------------ | ------------------------------------------------ |
 * | 有上游任务号，上游已出片                         | 镜像 → 替回音轨 → 拼回 → 留证 → 标成功，不退款   |
 * | 有上游任务号，上游明确失败/取消                  | 全额退款（refundKey 幂等）→ 标失败               |
 * | 有上游任务号，仍在生成且未超过上限时长           | 释放租约，下一轮继续只查该任务号                 |
 * | 有上游任务号，超过上限时长（默认 2 小时）仍未知  | 保持待核对并留证，不退款，不再自动处理           |
 * | 没有任务号，证据确认没有建过上游单               | 全额退款 → 标失败                                |
 * | 没有任务号，但发过请求且结果不明                 | 保持待核对并留证（可能已建单，不退）             |
 *
 * 硬约束：
 * - 本文件不引入任何提交函数，只查询已有任务号——上游单提交后不可取消，重投会双扣。
 * - 同一任务同一时刻只有一个处理者：数据库条件更新抢租约（lease token），所有终态写入都带租约校验；
 *   正常 worker 仍在跑的任务（心跳新鲜）不会被领走。
 * - 退款只走既有 settleVideoPartialEditRefund（refundKey 幂等），退款前再校验一次租约。
 * - 证据只写不删；查询到的终态回执原始/解析分别落盘。
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { videoPartialEditJobSchema, type VideoPartialEditJob } from "../../shared/videoEditPricing";
import {
  settleVideoPartialEditRefund,
  spliceVideoPartialEditResult,
  videoPartialEditEvidencePrefix,
  writeEvidenceJson,
  VIDEO_PARTIAL_EDIT_FAILED_MESSAGE,
  VIDEO_PARTIAL_EDIT_PENDING_MESSAGE,
  type VideoEditUpstreamHandle,
  type VideoPartialEditRenderDeps,
} from "./videoPartialEdit";

export const VIDEO_PARTIAL_EDIT_PROVIDER = "video-partial-edit";
/** 上游任务号最长续查时长：超过仍无终态即转人工待核对。 */
export const VPE_RECOVERY_MAX_WAIT_MS = 2 * 60 * 60_000;
/** 租约时长；收尾（ffmpeg 拼回）期间定时续租。 */
export const VPE_RECOVERY_LEASE_MS = 10 * 60_000;
/** running 行的心跳超过这个时长才视为执行者已不在（正常心跳 30 秒一次，失联时限 10 分钟）。 */
export const VPE_RECOVERY_STALE_RUNNING_MS = 12 * 60_000;
export const VPE_RECOVERY_TICK_MS = 30_000;
/** 出片后的本地收尾最多尝试几轮；用尽按原口径全额退款。 */
export const VPE_RECOVERY_SPLICE_MAX_ATTEMPTS = 2;

type Channel = "byteplus" | "evolink";
export type VideoPartialEditUpstream = { channel: Channel; providerTaskId: string; submittedAt: string };

export type VpeRecoveryState = {
  leaseToken?: string;
  leaseUntilMs?: number;
  settled?: "succeeded" | "refunded" | "manual";
  settledAt?: string;
  reason?: string;
  lastCheckedAt?: string;
  lastStatus?: string;
  spliceFailures?: number;
  upstream?: VideoPartialEditUpstream | null;
};

export type VpeRecoveryRow = {
  id: string;
  userId: string;
  status: string;
  input: unknown;
  output: unknown;
  error?: string | null;
  createdAt?: Date | string | null;
};

export type VpePollSnapshot =
  | { state: "completed"; sourceUrl: string }
  | { state: "failed"; error: string }
  | { state: "running"; status: string };
type Receipt = { status: number; body: string };

/** 任务行的读写：全部是条件更新，租约不对就一行不改。 */
export type VpeRecoveryStore = {
  listCandidates(nowMs: number): Promise<VpeRecoveryRow[]>;
  /** 抢租约；抢不到（已结清 / 别人持有 / 正常 worker 仍在跑）返回 null。 */
  claim(id: string, token: string, nowMs: number): Promise<VpeRecoveryRow | null>;
  renew(id: string, token: string, nowMs: number): Promise<boolean>;
  /** 仍未知：放回待下一轮（保留状态与原文案）。 */
  release(id: string, token: string, state: VpeRecoveryState): Promise<boolean>;
  settleSucceeded(id: string, token: string, output: Record<string, unknown>): Promise<boolean>;
  settleFailed(id: string, token: string, error: string, state: VpeRecoveryState): Promise<boolean>;
};

export type VpeRecoveryDeps = {
  store: VpeRecoveryStore;
  channelReady(channel: Channel): boolean;
  /** 只查询已有任务号；终态回执经 persist 交回留证。 */
  poll(handle: VideoPartialEditUpstream, persist: (r: Receipt) => Promise<void>): Promise<VpePollSnapshot>;
  mirror(sourceUrl: string): Promise<string>;
  listEvidence(prefix: string): Promise<string[]>;
  readEvidence(objectName: string): Promise<unknown>;
  writeEvidence(objectName: string, value: unknown): Promise<void>;
  refund: VideoPartialEditRenderDeps["refund"];
  render(): Promise<Pick<VideoPartialEditRenderDeps, "cutSegment" | "restoreSegmentAudio" | "concat" | "spliceStreamCopy">>;
  /** 本地媒体收尾与其他后期任务共用资源互斥。 */
  withResources<T>(jobId: string, signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T>;
  now(): number;
  signal: AbortSignal;
  maxWaitMs?: number;
};

export type VpeRecoveryOutcome = "skipped" | "succeeded" | "refunded" | "manual" | "pending";

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function readVideoPartialEditUpstream(value: unknown): VideoPartialEditUpstream | null {
  const row = record(value);
  const channel = String(row?.channel || "");
  const providerTaskId = String(row?.providerTaskId || "").trim();
  if ((channel !== "byteplus" && channel !== "evolink") || !providerTaskId) return null;
  const submittedAt = String(row?.submittedAt || "");
  return { channel, providerTaskId, submittedAt: Number.isFinite(Date.parse(submittedAt)) ? submittedAt : "" };
}

function recoveryStateOf(output: unknown): VpeRecoveryState {
  return (record(record(output)?.vpeRecovery) ?? {}) as VpeRecoveryState;
}

const CHANNEL_OBJECT_RE = /\/channel\/[0-9a-z]+-\d+-(byteplus|evolink)-(request|submit|upstream|rejection)-(raw|parsed)\.json$/;

export type VpeUpstreamResolution =
  | { kind: "handle"; handle: VideoPartialEditUpstream; source: string }
  | { kind: "none"; reason: string }
  | { kind: "ambiguous"; reason: string };

/**
 * 判定这单在上游的落点：任务行里的任务号优先，其次证据前缀里的任务号记录/提交回执。
 * 没有任务号时，只有「每个发出过的请求都有零扣费的明确拒绝」才算确认无上游单。
 */
export async function resolveVideoPartialEditUpstream(
  row: Pick<VpeRecoveryRow, "output">,
  prefix: string,
  deps: Pick<VpeRecoveryDeps, "listEvidence" | "readEvidence">,
): Promise<VpeUpstreamResolution> {
  const names = (await deps.listEvidence(prefix)).slice().sort();
  const channelObjects = names.flatMap(name => {
    const m = CHANNEL_OBJECT_RE.exec(name);
    return m ? [{ name, channel: m[1] as Channel, phase: m[2]!, kind: m[3]! }] : [];
  });
  const of = (channel: Channel, phase: string, kind: string) =>
    channelObjects.filter(o => o.channel === channel && o.phase === phase && o.kind === kind);

  const handles: Array<{ handle: VideoPartialEditUpstream; source: string }> = [];
  const fromRow = readVideoPartialEditUpstream(record(row.output)?.vpeUpstream);
  if (fromRow) handles.push({ handle: fromRow, source: "job-row" });
  for (const name of names.filter(n => /\/upstream-(byteplus|evolink)-[^/]+\.json$/.test(n))) {
    const handle = readVideoPartialEditUpstream(record(await deps.readEvidence(name))?.handle);
    if (handle) handles.push({ handle, source: name });
  }
  for (const channel of ["byteplus", "evolink"] as const) {
    for (const o of of(channel, "upstream", "raw")) {
      const handle = readVideoPartialEditUpstream(record(await deps.readEvidence(o.name))?.raw);
      if (handle) handles.push({ handle, source: o.name });
    }
    if (handles.some(h => h.handle.channel === channel)) continue;
    // 旧任务没有任务号记录：从提交回执原文里取（2xx 且带 id 才算建单）
    for (const o of of(channel, "submit", "raw")) {
      const doc = record(await deps.readEvidence(o.name));
      const receipt = record(doc?.raw);
      const status = Number(receipt?.status);
      const body = record(typeof receipt?.body === "string" ? receipt.body : null);
      const id = String(body?.id || "").trim();
      if (status >= 200 && status < 300 && id) {
        handles.push({ handle: { channel, providerTaskId: id, submittedAt: String(doc?.recordedAt || "") }, source: o.name });
      }
    }
  }

  const zeroChargeRejected = async (channel: Channel) => {
    for (const o of of(channel, "rejection", "parsed")) {
      if (record(record(await deps.readEvidence(o.name))?.parsed)?.upstreamCharged === false) return true;
    }
    return false;
  };
  const requested = (channel: Channel) => of(channel, "request", "raw").length > 0;

  const evolink = handles.filter(h => h.handle.channel === "evolink").pop();
  if (evolink) return { kind: "handle", ...evolink };
  // 第二通道发过请求却没有任务号：除非有零扣费的明确拒绝，否则可能已建单
  if (requested("evolink") && !(await zeroChargeRejected("evolink"))) {
    return { kind: "ambiguous", reason: "第二通道已发出请求但没有任务号与明确拒绝回执" };
  }
  const byteplus = handles.filter(h => h.handle.channel === "byteplus").pop();
  if (byteplus) return { kind: "handle", ...byteplus };
  if (requested("byteplus") && !(await zeroChargeRejected("byteplus"))) {
    return { kind: "ambiguous", reason: "首通道已发出请求但没有任务号与明确拒绝回执" };
  }
  return { kind: "none", reason: requested("byteplus") || requested("evolink") ? "所有请求均被明确拒绝且未建单" : "提交前中断，未向上游发出请求" };
}

function terminalStatusOf(receipt: Receipt | undefined): string {
  return String(record(receipt?.body ?? null)?.status || "").toLowerCase();
}

/** 处理单个任务；抢不到租约即跳过。任何一步抛错都只释放租约，下一轮再来，不做结算。 */
export async function recoverVideoPartialEditJob(candidate: VpeRecoveryRow, deps: VpeRecoveryDeps): Promise<VpeRecoveryOutcome> {
  const { store } = deps;
  const token = randomUUID();
  const row = await store.claim(candidate.id, token, deps.now());
  if (!row) return "skipped";
  const jobId = row.id, userId = String(row.userId);
  const prefix = videoPartialEditEvidencePrefix(userId, jobId);
  const passId = `${deps.now().toString(36)}-${token.slice(0, 8)}`;
  const prior = recoveryStateOf(row.output);
  const note = (name: string, value: Record<string, unknown>) =>
    deps.writeEvidence(`${prefix}/recovery/${passId}-${name}.json`, { jobId, userId, at: new Date(deps.now()).toISOString(), ...value });
  const base = (): VpeRecoveryState => ({ ...prior, leaseToken: token, leaseUntilMs: 0, lastCheckedAt: new Date(deps.now()).toISOString() });
  const pending = async (lastStatus: string, extra: VpeRecoveryState = {}): Promise<VpeRecoveryOutcome> => {
    await store.release(jobId, token, { ...base(), ...extra, lastStatus });
    return "pending";
  };
  const manual = async (reason: string, upstream: VideoPartialEditUpstream | null): Promise<VpeRecoveryOutcome> => {
    await note("manual", { status: "pending_reconcile", refunded: false, reason, upstream });
    const ok = await store.settleFailed(jobId, token, VIDEO_PARTIAL_EDIT_PENDING_MESSAGE,
      { ...base(), settled: "manual", settledAt: new Date(deps.now()).toISOString(), reason, upstream });
    return ok ? "manual" : "skipped";
  };
  const refund = async (job: VideoPartialEditJob, reason: string, upstream: VideoPartialEditUpstream | null): Promise<VpeRecoveryOutcome> => {
    // 退款前再确认租约仍在自己手里：丢了说明别的处理者已接手，本轮不动钱
    if (!(await store.renew(jobId, token, deps.now()))) return "skipped";
    const settled = await settleVideoPartialEditRefund(userId, jobId, job, `重启续查：${reason}`, deps);
    await note("refund", { ...settled, reason, upstream });
    const ok = await store.settleFailed(jobId, token, VIDEO_PARTIAL_EDIT_FAILED_MESSAGE,
      { ...base(), settled: "refunded", settledAt: new Date(deps.now()).toISOString(), reason, upstream });
    return ok ? "refunded" : "skipped";
  };

  try {
    const parsed = videoPartialEditJobSchema.safeParse(record(row.input));
    if (!parsed.success) return await manual("任务参数无法解析", null);
    const job = parsed.data;

    const resolved = await resolveVideoPartialEditUpstream(row, prefix, deps);
    if (resolved.kind === "ambiguous") return await manual(resolved.reason, null);
    if (resolved.kind === "none") return await refund(job, resolved.reason, null);

    const handle = resolved.handle;
    if (handle.providerTaskId.startsWith("immediate-")) return await manual("上游即时回执没有可续查的任务号", handle);
    if (!deps.channelReady(handle.channel)) return await pending("channel_not_ready", { upstream: handle });

    let terminal: Receipt | undefined;
    const snap = await deps.poll(handle, async receipt => {
      terminal = receipt;
      // 终态回执：原始与解析分别落盘
      await note("terminal-raw", { channel: handle.channel, providerTaskId: handle.providerTaskId, raw: receipt });
      await note("terminal-parsed", { channel: handle.channel, providerTaskId: handle.providerTaskId, status: receipt.status, parsed: record(receipt.body) ?? { invalidJson: true } });
    });

    const submittedMs = Date.parse(handle.submittedAt) || Date.parse(String(row.createdAt ?? "")) || deps.now();
    const expired = deps.now() - submittedMs > (deps.maxWaitMs ?? VPE_RECOVERY_MAX_WAIT_MS);

    if (snap.state === "running") {
      if (expired) return await manual(`上游任务超过续查上限仍无终态（${snap.status}）`, handle);
      return await pending(snap.status, { upstream: handle });
    }

    if (snap.state === "failed") {
      // 只认上游回执里明确的失败/取消；其余（配置缺失、完成但无成片地址等）不退，留人工
      const status = terminalStatusOf(terminal);
      if (["failed", "cancelled", "canceled"].includes(status)) return await refund(job, `上游任务${status}：${snap.error}`.slice(0, 160), handle);
      return await manual(`上游回执无法判定成败：${snap.error}`.slice(0, 160), handle);
    }

    // ── 上游已出片：镜像 → 裁原片段 → 替回音轨 → 拼回 → 留证 → 标成功 ──
    let videoUrl: string;
    try {
      videoUrl = await deps.mirror(snap.sourceUrl);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (expired) return await manual(`上游已出片但成片无法取回：${detail}`.slice(0, 160), handle);
      return await pending("mirror_failed", { upstream: handle });
    }
    const renewTimer = setInterval(() => { void store.renew(jobId, token, deps.now()).catch(() => {}); }, Math.floor(VPE_RECOVERY_LEASE_MS / 4));
    renewTimer.unref?.();
    const dir = await mkdtemp(path.join(tmpdir(), "vpe-recover-"));
    let output: Awaited<ReturnType<typeof spliceVideoPartialEditResult>>;
    try {
      const render = await deps.render();
      const p = job.params;
      output = await deps.withResources(jobId, deps.signal, async signal => {
        const segment = await render.cutSegment({ videoUri: p.videoUri, startSec: p.startSec, endSec: p.endSec, fps: p.fps, dir, signal, userId });
        return spliceVideoPartialEditResult({
          job, userId, jobId, segment, dir, signal,
          edited: { videoUrl, channel: handle.channel, providerTaskId: handle.providerTaskId, attempts: [] },
        }, { restoreSegmentAudio: render.restoreSegmentAudio, concat: render.concat, spliceStreamCopy: render.spliceStreamCopy, writeEvidence: deps.writeEvidence });
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (deps.signal.aborted) return await pending("splice_interrupted", { upstream: handle });
      const failures = (prior.spliceFailures ?? 0) + 1;
      await note(`splice-failure-${failures}`, { stage: "splice", detail, upstream: handle });
      if (failures < VPE_RECOVERY_SPLICE_MAX_ATTEMPTS) return await pending("splice_failed", { upstream: handle, spliceFailures: failures });
      return await refund(job, `拼回失败：${detail}`.slice(0, 160), handle);
    } finally {
      clearInterval(renewTimer);
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    const done = await store.settleSucceeded(jobId, token, {
      ...output,
      vpeUpstream: handle,
      vpeRecovery: { ...prior, leaseToken: token, leaseUntilMs: 0, settled: "succeeded", settledAt: new Date(deps.now()).toISOString(), upstream: handle } satisfies VpeRecoveryState,
    });
    await note("succeeded", { settled: done, refunded: false, upstream: handle, gcsUri: output.gcsUri });
    return done ? "succeeded" : "skipped";
  } catch (error) {
    // 证据列举/数据库/查询抖动：不结算，放回下一轮
    console.warn(`[videoPartialEdit] recovery deferred ${jobId}`, error);
    await store.release(jobId, token, { ...base(), lastStatus: "deferred" }).catch(() => {});
    return "pending";
  }
}

export async function recoverVideoPartialEditJobsOnce(deps: VpeRecoveryDeps): Promise<Record<VpeRecoveryOutcome, number>> {
  const result: Record<VpeRecoveryOutcome, number> = { skipped: 0, succeeded: 0, refunded: 0, manual: 0, pending: 0 };
  for (const row of await deps.store.listCandidates(deps.now())) {
    if (deps.signal.aborted) break;
    result[await recoverVideoPartialEditJob(row, deps)] += 1;
  }
  return result;
}

// ─── 正式执行：上游任务号落任务行（renderVideoPartialEdit 的 onUpstreamSubmitted） ───────────────
export async function recordVideoPartialEditUpstream(input: { jobId: string; userId: string; handle: VideoEditUpstreamHandle }) {
  const { jobId, userId, handle } = input;
  const safeId = String(handle.providerTaskId).replace(/[^0-9a-zA-Z_.-]/g, "_").slice(0, 120);
  // 先留证（任务行写不进去时恢复器仍能从证据前缀取回任务号），再写任务行
  await writeEvidenceJson(`${videoPartialEditEvidencePrefix(userId, jobId)}/upstream-${handle.channel}-${safeId}.json`, { jobId, userId, handle });
  const { patchPostProdProgressStrict } = await import("../jobs/repository");
  const { persistManhuaBgmCheckpointWithRetry } = await import("../jobs/manhuaBgmRecovery");
  await persistManhuaBgmCheckpointWithRetry(() => patchPostProdProgressStrict(jobId, { vpeUpstream: handle }));
}

// ─── 正式依赖 ───────────────────────────────────────────────
async function realStore(): Promise<VpeRecoveryStore> {
  const { jobs } = await import("../../drizzle/schema");
  const { getDb } = await import("../db");
  const { and, asc, eq, sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot recover video partial edit jobs");
  const out = sql`coalesce(${jobs.output}::jsonb, '{}'::jsonb)`;
  const rec = sql`coalesce(${jobs.output}::jsonb->'vpeRecovery', '{}'::jsonb)`;
  const mine = and(eq(jobs.type, "post_prod"), eq(jobs.provider, VIDEO_PARTIAL_EDIT_PROVIDER));
  const unsettled = sql`(${rec}->>'settled') is null`;
  // 可处理：失败但未退款未结清；或 running 且心跳早已停（正常 worker 仍在跑的不碰）
  const candidate = (nowMs: number) => and(mine, unsettled,
    sql`coalesce((${rec}->>'leaseUntilMs')::bigint, 0) < ${nowMs}`,
    sql`(
      (${jobs.status} = 'failed' and coalesce(${jobs.error}, '') <> ${VIDEO_PARTIAL_EDIT_FAILED_MESSAGE})
      or (${jobs.status} = 'running' and coalesce((${out}->>'postProdHeartbeatAt')::timestamptz, ${jobs.updatedAt})
        < ${new Date(nowMs - VPE_RECOVERY_STALE_RUNNING_MS).toISOString()}::timestamptz)
    )`);
  const held = (id: string, token: string) => and(eq(jobs.id, id), mine, unsettled, sql`(${rec}->>'leaseToken') = ${token}`);
  const merged = (state: VpeRecoveryState) => sql`${out} || ${JSON.stringify({ vpeRecovery: state })}::jsonb`;
  const columns = { id: jobs.id, userId: jobs.userId, status: jobs.status, input: jobs.input, output: jobs.output, error: jobs.error, createdAt: jobs.createdAt };
  return {
    async listCandidates(nowMs) {
      return (await db.select(columns).from(jobs).where(candidate(nowMs)).orderBy(asc(jobs.createdAt)).limit(50)) as VpeRecoveryRow[];
    },
    async claim(id, token, nowMs) {
      const lease = JSON.stringify({ leaseToken: token, leaseUntilMs: nowMs + VPE_RECOVERY_LEASE_MS });
      const rows = await db.update(jobs)
        .set({ output: sql`${out} || jsonb_build_object('vpeRecovery', ${rec} || ${lease}::jsonb)` })
        .where(and(eq(jobs.id, id), candidate(nowMs))).returning(columns);
      return (rows[0] as VpeRecoveryRow | undefined) ?? null;
    },
    async renew(id, token, nowMs) {
      const lease = JSON.stringify({ leaseUntilMs: nowMs + VPE_RECOVERY_LEASE_MS });
      const rows = await db.update(jobs)
        .set({ output: sql`${out} || jsonb_build_object('vpeRecovery', ${rec} || ${lease}::jsonb)` })
        .where(held(id, token)).returning({ id: jobs.id });
      return rows.length === 1;
    },
    async release(id, token, state) {
      const rows = await db.update(jobs).set({ output: merged(state) }).where(held(id, token)).returning({ id: jobs.id });
      return rows.length === 1;
    },
    async settleSucceeded(id, token, output) {
      const rows = await db.update(jobs)
        .set({ status: "succeeded", output: output as any, provider: VIDEO_PARTIAL_EDIT_PROVIDER, error: null, updatedAt: new Date() })
        .where(held(id, token)).returning({ id: jobs.id });
      return rows.length === 1;
    },
    async settleFailed(id, token, error, state) {
      const rows = await db.update(jobs).set({ status: "failed", error, output: merged(state), updatedAt: new Date() })
        .where(held(id, token)).returning({ id: jobs.id });
      return rows.length === 1;
    },
  };
}

async function realDeps(signal: AbortSignal): Promise<VpeRecoveryDeps> {
  const [gcs, byteplus, evolink, seedance, edit, resources, credits] = await Promise.all([
    import("./gcs"), import("./byteplusSeedanceVideo"), import("./evolinkSeedanceVideo"), import("./seedanceVideo"),
    import("./videoPartialEdit"), import("./postProdResources"), import("../credits"),
  ]);
  return {
    store: await realStore(),
    channelReady: channel => (channel === "byteplus" ? byteplus.isByteplusSeedanceConfigured() : evolink.isEvolinkSeedanceConfigured()),
    poll: (handle, persist) => handle.channel === "byteplus"
      ? byteplus.pollByteplusVideoTaskOnce(handle.providerTaskId, "局部修改", persist)
      : evolink.pollEvolinkVideoTaskOnce(handle.providerTaskId, "局部修改", persist),
    mirror: url => seedance.mirrorSeedanceMp4ToGcsSignedUrl(url),
    listEvidence: prefix => gcs.listGcsObjectNamesByPrefix({ prefix, allPages: true }),
    async readEvidence(objectName) {
      const { buffer } = await gcs.downloadGcsObject({ gcsUri: `gs://${gcs.getGcsBucketName()}/${objectName}` });
      return JSON.parse(buffer.toString("utf8"));
    },
    writeEvidence: writeEvidenceJson,
    async refund(userId, amount, reason, refundKey) { await credits.refundCredits(userId, amount, reason, { refundKey }); },
    render: () => edit.videoPartialEditRenderDeps(),
    withResources: (jobId, sig, work) => resources.withPostProdResources(jobId, sig, { phase: "video_edit_recovery" }, work),
    now: () => Date.now(),
    signal,
  };
}

let timer: ReturnType<typeof setInterval> | undefined;
let ticking = false;
let shutdown: AbortController | undefined;

/** 服务启动后调用：立即扫一轮，之后每 30 秒续查一轮（仍在生成的上游任务靠它推进）。 */
export function startVideoPartialEditRecovery() {
  if (timer) return;
  shutdown = new AbortController();
  const signal = shutdown.signal;
  const tick = async () => {
    if (ticking || signal.aborted) return;
    ticking = true;
    try {
      const result = await recoverVideoPartialEditJobsOnce(await realDeps(signal));
      if (result.succeeded || result.refunded || result.manual || result.pending) console.log("[videoPartialEdit] startup recovery", result);
    } catch (error) {
      console.warn("[videoPartialEdit] startup recovery unavailable", error);
    } finally {
      ticking = false;
    }
  };
  void tick();
  timer = setInterval(() => { void tick(); }, VPE_RECOVERY_TICK_MS);
  timer.unref?.();
}

export function stopVideoPartialEditRecovery() {
  if (timer) clearInterval(timer);
  timer = undefined;
  shutdown?.abort(new Error("服务更新中，续查已暂停"));
}
