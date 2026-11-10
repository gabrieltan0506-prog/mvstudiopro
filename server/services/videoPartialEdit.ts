/**
 * 视频局部修改（产品功能）：选段 → 裁出片段（不变速）→ 编辑通道（runVideoEditWithFallback，
 * 通道选择/拒绝码/零扣费回执由通道模块负责）→ 用原片段音轨替回 → 后期 concat 按原秒点拼回。
 * 复用：post_prod 任务（requestId 派生稳定 jobId、不自动重做）、deductCreditsAmount+chargeKey 幂等、
 * refundCredits+refundKey 幂等退款、concatClips trims。结果另存新文件，原片不动。
 * 证据（请求、各通道原始/解析回执、退款、结果）写入 GCS 且只写不删。
 * 对外文案不出现模型/通道名；通道信息只进 output.debug。
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildVideoEditSpliceConcat,
  planVideoEditSegment,
  quoteVideoEdit,
  videoEditCredits,
  videoPartialEditJobSchema,
  videoPartialEditRequestSchema,
  type VideoEditQuote,
  type VideoPartialEditJob,
} from "../../shared/videoEditPricing";

// ─── 通道契约（R3 实现；此处只声明形状，便于替身注入） ───────────────
export type VideoEditChannelAttempt = {
  channel: string;
  rawReceipt?: unknown;
  parsed?: unknown;
  rejectionCode?: string;
  upstreamCharged?: boolean;
};
export type VideoEditChannelInput = {
  segmentUrl: string;
  promptZh: string;
  referenceImageUrls: string[];
  segmentSec: number;
  aspectRatio: string;
  evidencePrefix: string;
  signal?: AbortSignal;
  /** 通道建单成功后立刻回调（轮询之前），供重启后只续查原单。 */
  onUpstreamSubmitted?: (handle: VideoEditUpstreamHandle) => Promise<void> | void;
};
export type VideoEditUpstreamHandle = { channel: string; providerTaskId: string; submittedAt: string };
export type VideoEditChannelResult = {
  videoUrl: string;
  channel: string;
  providerTaskId?: string;
  attempts?: VideoEditChannelAttempt[];
};
export type RunVideoEditWithFallback = (input: VideoEditChannelInput) => Promise<VideoEditChannelResult>;

export const VIDEO_PARTIAL_EDIT_FAILED_MESSAGE = "片段修改未完成，积分已全额退回，原片未受影响";
export const VIDEO_PARTIAL_EDIT_PENDING_MESSAGE = "片段修改结果待核对，请勿重复提交；如未出片将退回积分";

export function videoPartialEditTaskId(userId: string, requestId: string) {
  return `vpe_${createHash("sha256").update(JSON.stringify([userId, requestId])).digest("hex").slice(0, 48)}`;
}
export function videoPartialEditChargeKey(userId: string, requestId: string) {
  return `videoPartialEdit/${userId}/${requestId}`;
}
export function videoPartialEditEvidencePrefix(userId: string, jobId: string) {
  return `post-prod/${String(userId).replace(/[^0-9a-zA-Z_-]/g, "")}/video-edit-evidence/${jobId}`;
}

type SourceMeta = { durationSec: number; width: number; height: number; fps: number; hasAudio: boolean };
type JobRow = { id: string; userId: string; type: string; status: string; input: unknown };
type DeductResult = { success: boolean; cost: number; source: string };

export type VideoPartialEditQueueDeps = {
  resolveSource(userId: string, source: string): Promise<string>;
  probeSource(gsUri: string): Promise<SourceMeta>;
  load(id: string): Promise<JobRow | null>;
  insert(id: string, userId: string, input: VideoPartialEditJob): Promise<void>;
  deduct(userId: number, amount: number, desc: string, chargeKey: string): Promise<DeductResult>;
  refund(userId: number, amount: number, reason: string, refundKey: string): Promise<void>;
  writeEvidence(objectName: string, value: unknown): Promise<void>;
};

const realQueueDeps: VideoPartialEditQueueDeps = {
  async resolveSource(userId, source) {
    const { resolveRegisteredPostProdMediaSource } = await import("./postProdMediaSource");
    return resolveRegisteredPostProdMediaSource({ userId, source });
  },
  async probeSource(gsUri) {
    const { runMediaTool } = await import("./postProduction");
    const { signGsUriV4ReadUrl } = await import("./gcs");
    const url = gsUri.startsWith("gs://") ? signGsUriV4ReadUrl(gsUri, 900) : gsUri;
    const { stdout } = await runMediaTool("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", url], AbortSignal.timeout(30_000));
    return parseProbeJson(String(stdout));
  },
  async load(id) {
    const { getJobByIdStrict } = await import("../jobs/repository");
    return (await getJobByIdStrict(id)) as JobRow | null;
  },
  async insert(id, userId, input) {
    const { jobs } = await import("../../drizzle/schema");
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) throw new Error("暂时无法保存任务，请保留原请求编号稍后查询");
    await db.insert(jobs).values({ id, userId, type: "post_prod", provider: "video-partial-edit", status: "queued", input, attempts: 0 })
      .onConflictDoNothing({ target: jobs.id });
  },
  async deduct(userId, amount, desc, chargeKey) {
    const { deductCreditsAmount } = await import("../credits");
    return deductCreditsAmount(userId, amount, "videoPartialEdit", desc, { chargeKey });
  },
  async refund(userId, amount, reason, refundKey) {
    const { refundCredits } = await import("../credits");
    await refundCredits(userId, amount, reason, { refundKey });
  },
  writeEvidence: writeEvidenceJson,
};

export async function writeEvidenceJson(objectName: string, value: unknown) {
  const { uploadBufferToGcsIfAbsent } = await import("./gcs");
  // 只写不删：同名已存在即保留首份（幂等重入不覆盖原始证据）
  await uploadBufferToGcsIfAbsent({ objectName, buffer: Buffer.from(JSON.stringify(value, null, 2)), contentType: "application/json" });
}

export function parseProbeJson(stdout: string): SourceMeta {
  const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; width?: number; height?: number; avg_frame_rate?: string; duration?: string }> };
  const v = (info.streams || []).find(s => s.codec_type === "video");
  const a = (info.streams || []).find(s => s.codec_type === "audio");
  const [n, d] = String(v?.avg_frame_rate || "0/1").split("/").map(Number);
  const durationSec = Number(v?.duration) > 0 ? Number(v?.duration) : Number(info.format?.duration) || 0;
  if (!v || !(durationSec > 0) || !v.width || !v.height) throw new Error("读取原片信息失败，请换一个成片");
  return { durationSec, width: v.width, height: v.height, fps: d > 0 ? n / d : 0, hasAudio: Boolean(a) };
}

/** 只读报价：服务端实测源时长，不信客户端；不扣费、不建任务。 */
export async function quoteVideoPartialEdit(
  userId: string,
  waived: boolean,
  input: { sourceUrl: string; startSec: number; endSec: number },
  deps: Pick<VideoPartialEditQueueDeps, "resolveSource" | "probeSource"> = realQueueDeps,
): Promise<VideoEditQuote & { videoUri: string; meta: SourceMeta }> {
  const videoUri = await deps.resolveSource(userId, input.sourceUrl);
  const meta = await deps.probeSource(videoUri);
  const plan = planVideoEditSegment(meta.durationSec, input.startSec, input.endSec);
  return { ...quoteVideoEdit(plan, waived), videoUri, meta };
}

function publicQuote(q: VideoEditQuote & { videoUri?: string; meta?: SourceMeta }): VideoEditQuote {
  const { videoUri: _v, meta: _m, ...rest } = q;
  return rest;
}
export { publicQuote as toPublicVideoEditQuote };

/**
 * 下单：归属核验（原片与参考图）→ 实测报价须等于客户端确认价 → 预扣（chargeKey 幂等）→ 入队。
 * 同一 requestId 重试返回原任务，不重复扣费；入库失败当场退款。
 */
export async function queueVideoPartialEdit(
  userId: string,
  waived: boolean,
  raw: unknown,
  deps: VideoPartialEditQueueDeps = realQueueDeps,
) {
  const req = videoPartialEditRequestSchema.parse(raw);
  const id = videoPartialEditTaskId(userId, req.requestId);
  const existing = await deps.load(id);
  if (existing) return receiptFrom(existing, userId);

  const quote = await quoteVideoPartialEdit(userId, waived, req, deps);
  const referenceImageUris: string[] = [];
  for (const ref of req.referenceImageUrls ?? []) referenceImageUris.push(await deps.resolveSource(userId, ref));
  if (req.expectedCredits !== quote.credits) throw new Error(`价格已变化（当前 ${quote.credits} 积分），请重新确认`);
  const chargeKey = videoPartialEditChargeKey(userId, req.requestId);
  const prefix = videoPartialEditEvidencePrefix(userId, id);
  const deduct = await deps.deduct(Number(userId), quote.credits,
    `视频局部修改（${quote.segmentSec.toFixed(1)}s）[chargeKey:${chargeKey}]`, chargeKey);
  if (!deduct.success) throw new Error("积分不足，未提交");
  const job: VideoPartialEditJob = videoPartialEditJobSchema.parse({
    action: "video_partial_edit",
    requestId: req.requestId,
    params: {
      videoUri: quote.videoUri,
      referenceImageUris,
      promptZh: req.promptZh,
      sourceDurationSec: quote.sourceDurationSec,
      startSec: quote.startSec,
      endSec: quote.endSec,
      segmentSec: quote.segmentSec,
      expanded: quote.expanded,
      width: quote.meta.width,
      height: quote.meta.height,
      fps: quote.meta.fps,
      hasAudio: quote.meta.hasAudio,
      charge: { credits: deduct.cost, chargeKey, source: deduct.source },
    },
  });
  try {
    await deps.writeEvidence(`${prefix}/request.json`, { jobId: id, userId, at: new Date().toISOString(), request: req, quote: publicQuote(quote), job });
    await deps.insert(id, userId, job);
    const row = await deps.load(id);
    if (!row) throw new Error("任务回执尚未确认");
    return { ...receiptFrom(row, userId), quote: publicQuote(quote) };
  } catch (error) {
    // 任务未落库 → 预扣全退（refundKey 幂等），不留扣费无任务的悬账
    if (!(await deps.load(id).catch(() => null))) {
      await settleVideoPartialEditRefund(userId, id, job, "入队失败", deps);
      throw new Error("任务暂时无法保存，积分已退回，请稍后重试");
    }
    throw error;
  }
}

function receiptFrom(row: JobRow, userId: string) {
  const stored = videoPartialEditJobSchema.safeParse(row.input);
  if (row.userId !== userId || row.type !== "post_prod" || !stored.success) throw new Error("同一请求编号不能用于不同作品或修改内容");
  const p = stored.data.params;
  return { jobId: row.id, status: row.status, credits: p.charge.credits, startSec: p.startSec, endSec: p.endSec, segmentSec: p.segmentSec, expanded: p.expanded };
}

/** 全额退款：仅对实际扣到的积分（管理员/免扣不退）；refundKey 防重复退；退款记录永久留证。 */
export async function settleVideoPartialEditRefund(
  userId: string,
  jobId: string,
  job: VideoPartialEditJob,
  reason: string,
  deps: Pick<VideoPartialEditQueueDeps, "refund" | "writeEvidence"> = realQueueDeps,
) {
  const { credits, chargeKey, source } = job.params.charge;
  const refundable = credits > 0 && source !== "admin" && source !== "none";
  const refundKey = `refund/${chargeKey}`.slice(0, 120);
  if (refundable) await deps.refund(Number(userId), credits, `视频局部修改未完成退款：${reason}`.slice(0, 200), refundKey);
  await deps.writeEvidence(`${videoPartialEditEvidencePrefix(userId, jobId)}/refund.json`, {
    jobId, userId, at: new Date().toISOString(), credits: refundable ? credits : 0, refunded: refundable, refundKey, chargeKey, reason,
  });
  return { credits: refundable ? credits : 0, refunded: refundable };
}

// ─── worker ───────────────────────────────────────────────
export type VideoPartialEditRenderDeps = {
  runVideoEditWithFallback: RunVideoEditWithFallback;
  /** 裁段（不变速）并上传，返回可供上游读取的签名链与本地文件。 */
  cutSegment(input: { videoUri: string; startSec: number; endSec: number; fps: number; dir: string; signal: AbortSignal; userId: string }): Promise<{ url: string; gcsUri: string; filePath: string }>;
  /** 编辑段画面 + 原片段音轨（等长、不变速），返回 gs://。 */
  restoreSegmentAudio(input: { editedUrl: string; segmentFile: string; segmentSec: number; hasAudio: boolean; dir: string; signal: AbortSignal; userId: string }): Promise<{ gcsUri: string; durationSec: number }>;
  concat(params: ReturnType<typeof buildVideoEditSpliceConcat>, userId: string, signal: AbortSignal): Promise<{ gcsUri: string; url: string; bytes: number; durationSec: number }>;
  /**
   * 流复制拼回（可选）：未改的前后段按关键帧原样复制，只把切点附近少量帧与编辑段编码一次，音轨整条取原片。
   * 原片不满足条件或校验不过返回 { ok:false, reason }，由整片重编码路径（restoreSegmentAudio + concat）接手。
   */
  spliceStreamCopy?(input: { videoUri: string; editedUrl: string; startSec: number; endSec: number; dir: string; signal: AbortSignal; userId: string }): Promise<
    | { ok: true; gcsUri: string; url: string; bytes: number; durationSec: number; editedUri: string; stats: Record<string, unknown> }
    | { ok: false; reason: string }>;
  /** 参考图 gs:// → 上游可读签名链（不传 base64）。 */
  signRead(gsUri: string): Promise<string> | string;
  /** 可选：上游任务号一出现就落任务行与证据（重启续查用）；失败不打断本次出片。 */
  onUpstreamSubmitted?(input: { jobId: string; userId: string; handle: VideoEditUpstreamHandle }): Promise<void>;
} & Pick<VideoPartialEditQueueDeps, "refund" | "writeEvidence">;

function aspectOf(width: number, height: number) {
  const r = width / height;
  return r >= 1.5 ? "16:9" : r <= 0.67 ? "9:16" : r >= 1.15 ? "4:3" : r <= 0.87 ? "3:4" : "1:1";
}

function attemptsOf(value: unknown): VideoEditChannelAttempt[] {
  const list = (value as { attempts?: unknown } | null)?.attempts;
  return Array.isArray(list) ? (list as VideoEditChannelAttempt[]) : [];
}

async function persistAttempts(prefix: string, attempts: VideoEditChannelAttempt[], write: VideoPartialEditRenderDeps["writeEvidence"]) {
  // 原始与解析分别落盘，条数一一对应，不截断
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i], tag = `attempt-${i + 1}-${String(a.channel || "unknown").replace(/[^a-z0-9_-]/gi, "")}`;
    await write(`${prefix}/${tag}-raw.json`, { channel: a.channel, rawReceipt: a.rawReceipt ?? null });
    await write(`${prefix}/${tag}-parsed.json`, { channel: a.channel, parsed: a.parsed ?? null, rejectionCode: a.rejectionCode ?? null, upstreamCharged: a.upstreamCharged ?? null });
  }
  await write(`${prefix}/attempts-index.json`, { count: attempts.length, channels: attempts.map(a => a.channel) });
}

/**
 * 出片之后的收尾（正常执行与重启续查共用）：原片段音轨替回 → 按原秒点拼回 → 时长核对 → 结果留证。
 * 不调用任何上游通道。
 */
export async function spliceVideoPartialEditResult(
  input: {
    job: VideoPartialEditJob; userId: string; jobId: string; dir: string; signal: AbortSignal;
    segment: { gcsUri: string; filePath: string };
    edited: Pick<VideoEditChannelResult, "videoUrl" | "channel" | "providerTaskId" | "attempts">;
  },
  d: Pick<VideoPartialEditRenderDeps, "restoreSegmentAudio" | "concat" | "writeEvidence" | "spliceStreamCopy">,
) {
  const { job, userId, jobId, segment, edited, dir, signal } = input;
  const p = job.params;
  const prefix = videoPartialEditEvidencePrefix(userId, jobId);
  // 优先流复制拼回；不满足条件、出错或时长校验不过 → 回退整片重编码（两条路径都记进 debug）
  const fast = d.spliceStreamCopy
    ? await d.spliceStreamCopy({ videoUri: p.videoUri, editedUrl: edited.videoUrl, startSec: p.startSec, endSec: p.endSec, dir, signal, userId })
      .catch((error: unknown) => {
        if (signal.aborted) throw error;
        return { ok: false as const, reason: `error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300) };
      })
    : { ok: false as const, reason: "unavailable" };
  const fastOk = fast.ok && Math.abs(fast.durationSec - p.sourceDurationSec) <= 0.25 ? fast : null;
  let spliced: { gcsUri: string; url: string; bytes: number; durationSec: number };
  let editedSegmentUri: string;
  let concatParams: ReturnType<typeof buildVideoEditSpliceConcat> | null = null;
  let splice: Record<string, unknown>;
  if (fastOk) {
    spliced = { gcsUri: fastOk.gcsUri, url: fastOk.url, bytes: fastOk.bytes, durationSec: fastOk.durationSec };
    editedSegmentUri = fastOk.editedUri;
    splice = { path: "stream_copy", ...fastOk.stats };
  } else {
    const restored = await d.restoreSegmentAudio({ editedUrl: edited.videoUrl, segmentFile: segment.filePath, segmentSec: p.segmentSec, hasAudio: p.hasAudio, dir, signal, userId });
    concatParams = buildVideoEditSpliceConcat({
      sourceUri: p.videoUri, editedUri: restored.gcsUri, startSec: p.startSec, endSec: p.endSec,
      sourceDurationSec: p.sourceDurationSec, width: p.width, height: p.height, fps: p.fps,
    });
    spliced = await d.concat(concatParams, userId, signal);
    if (Math.abs(spliced.durationSec - p.sourceDurationSec) > 0.25) throw new Error("拼回后总时长与原片不一致");
    editedSegmentUri = restored.gcsUri;
    splice = { path: "reencode", fallbackReason: fast.ok ? "stream_copy_duration_drift" : fast.reason };
  }
  const output = {
    gcsUri: spliced.gcsUri,
    url: spliced.url,
    bytes: spliced.bytes,
    durationSec: spliced.durationSec,
    originalDurationSec: p.sourceDurationSec,
    originalUri: p.videoUri,
    editedRange: { startSec: p.startSec, endSec: p.endSec },
    segmentSec: p.segmentSec,
    expanded: p.expanded,
    creditsCharged: p.charge.credits,
    debug: { channel: edited.channel, providerTaskId: edited.providerTaskId ?? null, attempts: (edited.attempts ?? []).map(a => ({ channel: a.channel, rejectionCode: a.rejectionCode ?? null, upstreamCharged: a.upstreamCharged ?? null })), splice },
  };
  await d.writeEvidence(`${prefix}/result.json`, { jobId, userId, at: new Date().toISOString(), output, concatParams, editedSegmentUri, segmentUri: segment.gcsUri });
  return output;
}

export async function renderVideoPartialEdit(
  rawInput: unknown,
  userId: string,
  jobId: string,
  signal: AbortSignal,
  deps?: VideoPartialEditRenderDeps,
) {
  const job = videoPartialEditJobSchema.parse(rawInput);
  // 正式执行默认把上游任务号写进任务行（实现在恢复模块）；替身注入时按替身自己的回调
  const d = deps ?? { ...(await realRenderDeps()), onUpstreamSubmitted: (await import("./videoPartialEditRecovery")).recordVideoPartialEditUpstream };
  const p = job.params;
  const prefix = videoPartialEditEvidencePrefix(userId, jobId);
  const dir = await mkdtemp(path.join(tmpdir(), "vpe-"));
  let stage = "cut";
  try {
    const segment = await d.cutSegment({ videoUri: p.videoUri, startSec: p.startSec, endSec: p.endSec, fps: p.fps, dir, signal, userId });
    stage = "edit";
    const refs = await Promise.all(p.referenceImageUris.map(uri => (uri.startsWith("gs://") ? d.signRead(uri) : uri)));
    let edited: VideoEditChannelResult;
    try {
      edited = await d.runVideoEditWithFallback({
        segmentUrl: segment.url, promptZh: p.promptZh, referenceImageUrls: refs, segmentSec: p.segmentSec,
        aspectRatio: aspectOf(p.width, p.height), evidencePrefix: `${prefix}/channel`, signal,
        onUpstreamSubmitted: d.onUpstreamSubmitted ? handle => d.onUpstreamSubmitted!({ jobId, userId, handle }) : undefined,
      });
    } catch (error) {
      await persistAttempts(prefix, attemptsOf(error), d.writeEvidence);
      throw error;
    }
    await persistAttempts(prefix, edited.attempts ?? [], d.writeEvidence);
    stage = "splice";
    return await spliceVideoPartialEditResult({ job, userId, jobId, segment, edited, dir, signal }, d);
  } catch (error) {
    // 上游结果未知（已建单但状态不明）不自动退：留证待核对，避免出片后又退成免费
    // 编辑阶段被中止（超时/停机）时上游可能仍在出片，同样按未知处理
    const unknown = (error as { kind?: string } | null)?.kind === "unknown" || (error as { reconcile?: boolean } | null)?.reconcile === true
      || (stage === "edit" && signal.aborted);
    const detail = error instanceof Error ? error.message : String(error);
    if (unknown) {
      await d.writeEvidence(`${prefix}/refund.json`, { jobId, userId, at: new Date().toISOString(), refunded: false, status: "pending_reconcile", stage, detail });
      throw new Error(VIDEO_PARTIAL_EDIT_PENDING_MESSAGE);
    }
    await d.writeEvidence(`${prefix}/failure-${stage}.json`, { jobId, userId, at: new Date().toISOString(), stage, detail, attempts: attemptsOf(error).length });
    await settleVideoPartialEditRefund(userId, jobId, job, `${stage}: ${detail}`, d);
    throw new Error(VIDEO_PARTIAL_EDIT_FAILED_MESSAGE);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}


let channelOverride: RunVideoEditWithFallback | null = null;
/** 通道模块（R3）接入点；未接入前拒绝执行（不会产生上游费用，失败即退款）。 */
export function setVideoEditChannel(run: RunVideoEditWithFallback | null) { channelOverride = run; }
async function resolveChannel(): Promise<RunVideoEditWithFallback> {
  if (channelOverride) return channelOverride;
  // R3 约定在通道模块导出 runVideoEditWithFallback；导出后自动接上，无需改本文件
  const mod = (await import("./byteplusSeedanceVideo")) as unknown as Record<string, unknown>;
  if (typeof mod.runVideoEditWithFallback === "function") return mod.runVideoEditWithFallback as RunVideoEditWithFallback;
  // 未接入：裁段后即失败、全额退款，不产生上游费用
  return async () => { throw Object.assign(new Error("视频编辑通道尚未接入"), { kind: "rejected" }); };
}

async function realRenderDeps(): Promise<VideoPartialEditRenderDeps> {
  const pp = await import("./postProduction");
  return {
    runVideoEditWithFallback: await resolveChannel(),
    refund: realQueueDeps.refund,
    writeEvidence: realQueueDeps.writeEvidence,
    async signRead(uri) {
      const { signGsUriV4ReadUrl } = await import("./gcs");
      return signGsUriV4ReadUrl(uri, 24 * 3600);
    },
    async cutSegment({ videoUri, startSec, endSec, fps, dir, signal, userId }) {
      // 直接按区间读远程原片；远程不可用时回退整片下载再裁（见 videoPartialEditCut）
      const { cutVideoSegmentToFile } = await import("./videoPartialEditCut");
      const { signGsUriV4ReadUrl } = await import("./gcs");
      const cut = await cutVideoSegmentToFile({ videoUri, startSec, endSec, fps, dir, signal }, {
        runMediaTool: pp.runMediaTool, probe: pp.probe,
        download: (uri, file, s) => pp.fetchPostProdSourceToFile(uri, file, { signal: s }),
        signRead: uri => signGsUriV4ReadUrl(uri, 3600),
      });
      if (cut.fallbackReason) console.warn(`[videoPartialEdit] 裁段回退整片下载：${cut.fallbackReason}`);
      const out = cut.filePath;
      const up = await pp.uploadResult({ filePath: out, userId, kind: "video-edit-segment", ext: "mp4", contentType: "video/mp4", signal });
      return { url: up.url, gcsUri: up.gcsUri, filePath: out };
    },
    async restoreSegmentAudio({ editedUrl, segmentFile, segmentSec, hasAudio, dir, signal, userId }) {
      const edited = path.join(dir, "edited.mp4"), out = path.join(dir, "edited-orig-audio.mp4");
      await pp.fetchPostProdSourceToFile(editedUrl, edited, { signal });
      const measured = await pp.probe(edited, signal);
      if (measured.durationSec < segmentSec - 0.3) throw new Error("编辑结果短于所选片段");
      // 画面取编辑结果（尾帧冻结补齐末尾几帧误差，不变速），音轨取原片段，长度锁定为选段时长
      await pp.runMediaTool("ffmpeg", ["-y", "-i", edited, "-i", segmentFile, "-map", "0:v:0",
        ...(hasAudio ? ["-map", "1:a:0", "-c:a", "aac", "-b:a", "192k"] : ["-an"]),
        "-vf", "tpad=stop_mode=clone:stop_duration=1", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
        "-t", segmentSec.toFixed(3), "-movflags", "+faststart", out], signal);
      const up = await pp.uploadResult({ filePath: out, userId, kind: "video-edit-restored", ext: "mp4", contentType: "video/mp4", signal });
      return { gcsUri: up.gcsUri, durationSec: segmentSec };
    },
    async spliceStreamCopy({ videoUri, editedUrl, startSec, endSec, dir, signal, userId }) {
      const { spliceByStreamCopy } = await import("./videoEditSplice");
      // 流复制需要完整原片：裁段若已落过整片则复用，否则此时再下载
      const cached = path.join(dir, "source.mp4");
      const src = (await stat(cached).then(st => st.isFile(), () => false)) ? cached : path.join(dir, "splice-source.mp4");
      if (src !== cached) await pp.fetchPostProdSourceToFile(videoUri, src, { signal });
      const edited = path.join(dir, "splice-edited.mp4");
      await pp.fetchPostProdSourceToFile(editedUrl, edited, { signal });
      const result = await spliceByStreamCopy({ sourceFile: src, editedFile: edited, startSec, endSec, dir }, pp.runMediaTool, signal);
      if (!result.ok) return result;
      const up = await pp.uploadResult({ filePath: result.outPath, userId, kind: "video-edit-spliced", ext: "mp4", contentType: "video/mp4", signal });
      // 编辑通道原始出片另存一份（拼回只取其画面，不再经中间重压）
      const raw = await pp.uploadResult({ filePath: edited, userId, kind: "video-edit-raw", ext: "mp4", contentType: "video/mp4", signal });
      return { ok: true, ...up, durationSec: result.stats.durationSec, editedUri: raw.gcsUri, stats: result.stats };
    },
    async concat(params, userId, signal) {
      const { totalSec: _t, ...concatParams } = params;
      return pp.concatClips(concatParams, userId, { signal });
    },
  };
}

/** 重启续查复用同一套裁段/替回音轨/拼回实现（不含任何提交动作）。 */
export async function videoPartialEditRenderDeps(): Promise<VideoPartialEditRenderDeps> { return realRenderDeps(); }
