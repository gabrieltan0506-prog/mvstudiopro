/**
 * 画布视频块 / MV 成片「局部修改」「调色」在途任务：提交成功即把任务号记到块数据 / MV 草稿（随原有保存机制落盘，画布块另随云草稿往返），
 * 画布局部修改在入队请求发出前先记「提交中」（只有 requestId），刷新后按 requestId 向服务端核对后补全或清除；
 * 挂载即按记录恢复轮询（同一个 getPostProdJob），完成按新版本写回（原片留在历史）、失败提示后清除；
 * 同一任务按 jobId 只落一次。另放两个面板的实测时长取法。本文件只放纯函数，组件里只做接线。
 */
import { capManhuaMediaHistory } from "@shared/manhuaMediaHistoryCap";
import {
  isVideoToolJobSubmitting,
  sanitizeVideoToolJobRecords,
  videoToolJobSchema,
  videoToolJobSubmittingSchema,
  type VideoToolJob,
  type VideoToolJobKind,
  type VideoToolJobRecord,
  type VideoToolJobSubmitting,
} from "@shared/videoToolJob";
import { readVideoEditJob } from "@/lib/videoEditSubmit";
import { probeVideoUpscaleSource, probeWorkflowVideoSource, type VideoUpscaleSourceMetadata } from "@/lib/videoUpscaleApi";

export type { VideoToolJob, VideoToolJobKind, VideoToolJobRecord, VideoToolJobSubmitting };
export { isVideoToolJobSubmitting };

/** 块上全部在途记录（已入队 + 局部修改提交中）：与云草稿同一校验，坏条目丢弃。 */
export function readVideoToolJobRecords(raw: unknown): VideoToolJobRecord[] {
  return sanitizeVideoToolJobRecords(raw);
}

/** 读块上已入队的追踪记录：逐条校验，坏条目丢弃（旧档或手改不让轮询、渲染出错）；同 jobId 只留一条。 */
export function readVideoToolJobs(raw: unknown): VideoToolJob[] {
  return readVideoToolJobRecords(raw).filter((r): r is VideoToolJob => !isVideoToolJobSubmitting(r));
}

/** 块上「提交中」的局部修改（只有 requestId，待按 requestId 核对）。 */
export function readSubmittingVideoToolJobs(raw: unknown): VideoToolJobSubmitting[] {
  return readVideoToolJobRecords(raw).filter(isVideoToolJobSubmitting);
}

/** 该类任务是否仍在处理（含提交中；同块同类只允许一条在途，防重复提交）。 */
export function pendingVideoToolJob(raw: unknown, kind: VideoToolJobKind): VideoToolJobRecord | undefined {
  return readVideoToolJobRecords(raw).find(j => j.kind === kind);
}

/** 轮询键：已入队按 jobId，提交中按 requestId。 */
export function videoToolJobKey(r: VideoToolJobRecord): string {
  return isVideoToolJobSubmitting(r) ? `submitting:${r.requestId}` : r.jobId;
}

/** 组一条追踪记录（提交成功那一刻）；字段不合法返回 null，调用方不写坏档。 */
export function buildVideoToolJob(input: {
  kind: VideoToolJobKind;
  jobId: string;
  requestId: string;
  sourceUrl: string;
  range?: { startSec: number; endSec: number };
  now?: Date;
}): VideoToolJob | null {
  const parsed = videoToolJobSchema.safeParse({
    kind: input.kind,
    jobId: input.jobId,
    requestId: input.requestId,
    startedAt: (input.now ?? new Date()).toISOString(),
    sourceUrl: input.sourceUrl,
    ...(input.range ? { range: { startSec: input.range.startSec, endSec: input.range.endSec } } : {}),
  });
  return parsed.success ? parsed.data : null;
}

/** 组一条局部修改「提交中」（入队请求发出前）；不合法返回 null。 */
export function buildSubmittingVideoToolJob(input: {
  requestId: string;
  sourceUrl: string;
  range?: { startSec: number; endSec: number };
  now?: Date;
}): VideoToolJobSubmitting | null {
  const parsed = videoToolJobSubmittingSchema.safeParse({
    kind: "edit",
    status: "submitting",
    requestId: input.requestId,
    startedAt: (input.now ?? new Date()).toISOString(),
    sourceUrl: input.sourceUrl,
    ...(input.range ? { range: { startSec: input.range.startSec, endSec: input.range.endSec } } : {}),
  });
  return parsed.success ? parsed.data : null;
}

/** 追加一条已入队记录（同 jobId 不重复记）；同 requestId 的「提交中」就地补全为这条，不另加。 */
export function addVideoToolJob(raw: unknown, job: VideoToolJob): VideoToolJobRecord[] {
  const list = readVideoToolJobRecords(raw);
  if (list.some(j => !isVideoToolJobSubmitting(j) && j.jobId === job.jobId)) return list;
  const at = list.findIndex(j => isVideoToolJobSubmitting(j) && j.kind === job.kind && j.requestId === job.requestId);
  return at < 0 ? sanitizeVideoToolJobRecords([...list, job]) : list.map((j, i) => (i === at ? job : j));
}

/** 记 / 刷新「提交中」：同 requestId 已入队则不动；同 requestId 重试只刷新发起时间，不另加。 */
export function upsertSubmittingVideoToolJob(raw: unknown, pending: VideoToolJobSubmitting): VideoToolJobRecord[] {
  const list = readVideoToolJobRecords(raw);
  if (list.some(j => j.kind === "edit" && j.requestId === pending.requestId && !isVideoToolJobSubmitting(j))) return list;
  const at = list.findIndex(j => isVideoToolJobSubmitting(j) && j.requestId === pending.requestId);
  return at < 0 ? sanitizeVideoToolJobRecords([...list, pending]) : list.map((j, i) => (i === at ? pending : j));
}

/** 清掉某条「提交中」；notAfter 给定时只清发起时间不晚于它的（被拒后用户已用同一 requestId 重试的不清）。清空返回 undefined。 */
export function removeSubmittingVideoToolJob(raw: unknown, requestId: string, notAfter?: number): VideoToolJobRecord[] | undefined {
  const rest = readVideoToolJobRecords(raw).filter(
    j => !(isVideoToolJobSubmitting(j) && j.requestId === requestId && (notAfter == null || !(Date.parse(j.startedAt) > notAfter)))
  );
  return rest.length ? rest : undefined;
}

/** 清掉某任务的追踪；清空后返回 undefined（块上不留空数组）。 */
export function removeVideoToolJob(raw: unknown, jobId: string): VideoToolJobRecord[] | undefined {
  const rest = readVideoToolJobRecords(raw).filter(j => isVideoToolJobSubmitting(j) || j.jobId !== jobId);
  return rest.length ? rest : undefined;
}

/**
 * 「提交中」多久查不到才算没提交成功：服务端受理（核验原片、实测、扣费、建任务）通常几十秒内完成，
 * 留足余量（含换设备时钟差）；之前查不到一律按可能仍在受理继续查，不提前放掉已扣费的任务。
 */
export const VIDEO_TOOL_SUBMIT_GRACE_MS = 3 * 60_000;

/** 按 requestId 查到的任务回执里取任务号（getPostProdJob 同形）。 */
export function readFoundVideoToolJobId(data: unknown): string {
  const jobId = (data as { jobId?: unknown } | null)?.jobId;
  return typeof jobId === "string" ? jobId.trim() : "";
}

/**
 * 「提交中」核对一轮：按 requestId 查服务端任务（局部修改任务号由 requestId 决定性派生）。
 * 查到 → onFound(任务号)，调用方补全成已入队记录，之后按任务号正常轮询；
 * 服务端明确「不存在」且已过宽限 → onMissing（没提交成功，清掉）；未过宽限或其余查询失败按瞬态，下一轮再查。
 */
export async function resolveSubmittingVideoToolJobsOnce<J extends VideoToolJobSubmitting>(input: {
  jobs: readonly J[];
  findByRequest: (requestId: string) => Promise<unknown>;
  onFound: (job: J, jobId: string) => void;
  onMissing: (job: J) => void;
  now?: () => number;
  graceMs?: number;
  isCancelled?: () => boolean;
}): Promise<void> {
  const grace = input.graceMs ?? VIDEO_TOOL_SUBMIT_GRACE_MS;
  for (const job of input.jobs) {
    if (input.isCancelled?.()) return;
    let data: unknown;
    try {
      data = await input.findByRequest(job.requestId);
    } catch (error) {
      if (input.isCancelled?.()) return;
      const age = (input.now ?? Date.now)() - Date.parse(job.startedAt);
      if (isPostProdJobNotFound(error) && !(age <= grace)) input.onMissing(job);
      continue;
    }
    if (input.isCancelled?.()) return;
    const jobId = readFoundVideoToolJobId(data);
    if (jobId) input.onFound(job, jobId);
  }
}

export type VideoToolJobResult = {
  url: string;
  gcsUri?: string;
  durationSec?: number;
  editedRange?: { startSec: number; endSec: number };
};
export type VideoToolJobSettled = ({ status: "succeeded" } & VideoToolJobResult) | { status: "failed"; message: string };
export type VideoToolJobOutcome = { status: "active" } | VideoToolJobSettled;

/**
 * getPostProdJob 回执归一（局部修改与调色同一读法：成功 output.url；失败 error）。
 * 失败文案用服务端中性句原文——局部修改失败或被拒时就是「积分已全额退回」那句；进程失联、结果待核对等情形服务端句子
 * 另有说明，这里不替它宣称已退。回执带退款数额时照面板补一句。成功但还没有可用地址按处理中继续查。
 */
export function readVideoToolJobOutcome(kind: VideoToolJobKind, data: unknown): VideoToolJobOutcome {
  const status = String((data as { status?: unknown } | null)?.status ?? "").toLowerCase();
  if (status === "cancelled" || status === "canceled")
    return { status: "failed", message: kind === "edit" ? "局部修改任务已取消" : "调色任务已取消" };
  const view = readVideoEditJob(data);
  if (!view || view.status === "active") return { status: "active" };
  if (view.status === "succeeded")
    return {
      status: "succeeded",
      url: view.url!,
      ...(view.gcsUri ? { gcsUri: view.gcsUri } : {}),
      ...(view.durationSec ? { durationSec: view.durationSec } : {}),
      ...(view.editedRange ? { editedRange: view.editedRange } : {}),
    };
  const raw = (data as { error?: unknown }).error;
  const base = typeof raw === "string" && raw.trim() ? raw.trim() : kind === "edit" ? "局部修改未成功" : "调色失败";
  return { status: "failed", message: `${base}${view.refundedCredits != null ? `（已退回 ${view.refundedCredits} 积分）` : ""}` };
}

/** 服务端明确「任务不存在」（404）才算终态；其余查询失败一律按瞬态，下一轮再查。 */
export function isPostProdJobNotFound(error: unknown): boolean {
  const e = error as { data?: { code?: unknown }; shape?: { data?: { code?: unknown } } } | null;
  return e?.data?.code === "NOT_FOUND" || e?.shape?.data?.code === "NOT_FOUND";
}

/**
 * 轮询一轮：逐条查服务端任务；终态交给 onSettled，处理中不动。挂载时与定时器共用（刷新恢复即挂载后的第一轮）。
 */
export async function pollVideoToolJobsOnce<J extends { jobId: string; kind: VideoToolJobKind }>(input: {
  jobs: readonly J[];
  fetchJob: (jobId: string) => Promise<unknown>;
  onSettled: (job: J, outcome: VideoToolJobSettled) => void;
  isCancelled?: () => boolean;
}): Promise<void> {
  for (const job of input.jobs) {
    if (input.isCancelled?.()) return;
    let data: unknown;
    try {
      data = await input.fetchJob(job.jobId);
    } catch (error) {
      if (input.isCancelled?.()) return;
      if (isPostProdJobNotFound(error))
        input.onSettled(job, {
          status: "failed",
          message: job.kind === "edit" ? "未找到这次局部修改的任务记录，已停止跟踪" : "未找到这次调色的任务记录，已停止跟踪",
        });
      continue;
    }
    if (input.isCancelled?.()) return;
    const outcome = readVideoToolJobOutcome(job.kind, data);
    if (outcome.status !== "active") input.onSettled(job, outcome);
  }
}

type VideoBlockLike = { outputUrl?: string; outputUrls?: string[]; videoToolJobs?: unknown; status?: string; error?: string };

/** 同一存储对象（签名参数每次查询都会变）。 */
const objectKey = (url: string) => url.split(/[?#]/)[0];

/**
 * 完成写回（纯函数，在 onBlocksChange 的 updater 里对最新块执行）：新版本放 outputUrls 最前并设为当前，
 * 提交时的成片与当前成片都留在历史（原片保留）；同一产物已在历史里不重复加；该任务的追踪同批清掉。
 */
export function applyVideoToolJobResult<B extends VideoBlockLike>(
  block: B,
  jobId: string,
  url: string,
  fallbackSourceUrl?: string
): { block: B; added: boolean } {
  const track = readVideoToolJobs(block.videoToolJobs).find(j => j.jobId === jobId);
  const cleared: B = track ? { ...block, videoToolJobs: removeVideoToolJob(block.videoToolJobs, jobId) } : block;
  const next = String(url || "").trim();
  if (!/^https:\/\//i.test(next)) return { block: cleared, added: false };
  const prev = Array.isArray(block.outputUrls) ? block.outputUrls : [];
  const current = String(block.outputUrl || "").trim();
  if ([current, ...prev].some(u => objectKey(String(u || "").trim()) === objectKey(next))) return { block: cleared, added: false };
  const source = track?.sourceUrl ?? fallbackSourceUrl;
  return {
    block: {
      ...cleared,
      outputUrl: next,
      outputUrls: capManhuaMediaHistory([next, ...prev, ...[current, source].filter(Boolean)], next),
      status: "done",
      error: undefined,
    },
    added: true,
  };
}

/** 探针回执取实测时长：只认 durationExactSec（原始浮点）；向上取整的 durationSec 是计费秒，不能当片长。 */
export function measuredExactSec(meta: Pick<VideoUpscaleSourceMetadata, "durationExactSec"> | null | undefined): number | undefined {
  const n = Number(meta?.durationExactSec);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * 调色面板成片秒：一位小数四舍五入（与提交时分段校验 checkMontageSegments 同一规则：10.08 → 10.1，末段到此；不是取整到 11）。
 * 局部修改的片长另用 videoEditDurationSec（一位小数向下取，同服务端选段）。
 */
export function videoGradePanelSec(exactSec: number | null | undefined): number | undefined {
  const n = Number(exactSec);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : undefined;
}

const WAVESPEED_CDN = "https://d2h7xmz5gqybh9.cloudfront.net/";

/**
 * 面板用实测时长（原始浮点秒）：本站成片走服务端实读，与报价、提交时同一把尺；
 * 高清版（CloudFront）要到提交时才导入，此前只能在浏览器读元数据。读不到返回 undefined。
 */
export async function measureVideoToolExactSec(
  url: string,
  deps: {
    probeServer?: (url: string) => Promise<VideoUpscaleSourceMetadata>;
    probeBrowser?: (url: string) => Promise<VideoUpscaleSourceMetadata | null>;
  } = {}
): Promise<number | undefined> {
  const u = String(url || "").trim();
  if (!/^https:\/\//i.test(u)) return undefined;
  try {
    const meta = u.startsWith(WAVESPEED_CDN)
      ? await (deps.probeBrowser ?? probeVideoUpscaleSource)(u)
      : await (deps.probeServer ?? probeWorkflowVideoSource)(u);
    return measuredExactSec(meta);
  } catch {
    return undefined;
  }
}
