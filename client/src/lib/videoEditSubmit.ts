/**
 * 视频局部修改（Video Edit）前端提交：选区间 + 中文描述 + 可选参考图 → 服务端任务。
 * 来源规范化沿用 videoGradeSubmit：CloudFront 成品先导入为本人 gs://，其余 https/gs 原样交服务端核验归属。
 * 计价、区间自动扩展（不足 4 秒扩到 4 秒）、失败退款全部以服务端为准；本 helper 不扣费。
 * 即时显示用的预估价（estimateVideoEditQuote）直接调 shared/videoEditPricing 的同一组函数，提交仍用服务端报价的 credits。
 * 每次点击提交生成新 requestId（服务端按它做幂等）。
 */
import { importWorkflowVideoSource } from "@/lib/videoUpscaleApi";
import { VIDEO_EDIT_MAX_SEC, VIDEO_EDIT_MIN_SEC, planVideoEditSegment, quoteVideoEdit, type VideoEditQuote as SharedVideoEditQuote } from "@shared/videoEditPricing";

/** 区间规则（服务端同一份常量）：一位小数；不足 4 秒服务端自动扩到 4 秒；单次上限 30 秒。 */
export { VIDEO_EDIT_MAX_SEC, VIDEO_EDIT_MIN_SEC };
export { videoEditPrefillBlockReason } from "./videoEditPrefillGate";
export const VIDEO_EDIT_PROMPT_MAX = 2000;
export const VIDEO_EDIT_REF_MAX = 4;

/** trpc.mvAnalysis.queueVideoPartialEdit 入参（VE1 约定）。 */
export type VideoEditSubmitInput = {
  /** 规范化后的来源：https（系统桶）或本人 gs://；CloudFront 已先导入。 */
  sourceUrl: string;
  startSec: number;
  endSec: number;
  promptZh: string;
  /** 可选参考图（≤4，本作品素材；CloudFront 已先导入）。 */
  referenceImageUrls?: string[];
  /** 每次点击新生成的 uuid；同一次点击的重试复用。 */
  requestId: string;
  /** 用报价 query 的 credits；服务端不符报「价格已变化，请重新确认」。 */
  expectedCredits: number;
};

/** trpc.mvAnalysis.quoteVideoPartialEdit 入参（只读，不扣费）。 */
export type VideoEditQuoteInput = { sourceUrl: string; startSec: number; endSec: number };

/** quoteVideoPartialEdit 出参（VE1 约定）。 */
export type VideoEditQuote = {
  sourceDurationSec: number;
  startSec: number;
  endSec: number;
  segmentSec: number;
  expanded: boolean;
  notice?: string;
  credits: number;
  waived: boolean;
  creditsPerTwoSec: number;
  minSec: number;
  maxSec: number;
  confirmNotice: string;
};

export type VideoEditRequest = {
  videoUrl: string;
  startSec: number;
  endSec: number;
  promptZh: string;
  referenceImageUrls?: string[];
  /** 报价 credits（确认框里给用户看的那个数）。 */
  expectedCredits: number;
  /** 片长（秒）；传入时校验区间不越界。 */
  durationSec?: number;
  /** 同一次点击的重试复用；不传则新生成。 */
  requestId?: string;
};

/** queueVideoPartialEdit 回执：服务端带实际修改区间（不足 4 秒已扩展后的值）。 */
export type VideoEditQueueReceipt = { jobId: string; startSec?: number; endSec?: number };

export type VideoEditSubmitDeps = {
  /** 入队：trpc.mvAnalysis.queueVideoPartialEdit 的 mutateAsync。 */
  submit: (input: VideoEditSubmitInput) => Promise<VideoEditQueueReceipt | string | undefined>;
  /** 测试注入；默认 importWorkflowVideoSource（CloudFront 成品先落本人目录）。 */
  importSource?: (url: string) => Promise<string>;
  /** 测试注入；默认 crypto.randomUUID。 */
  newRequestId?: () => string;
};

const WAVESPEED_CDN = "https://d2h7xmz5gqybh9.cloudfront.net/";
export const roundSec = (n: number) => Math.round(n * 10) / 10;

/**
 * 局部修改用的片长（选区上限、报价区间都按它）：实测秒数保留一位小数、向下取，与服务端选段同一规则（不超过原片），
 * 如 10.08 → 10.0；不向上取整（超分计费的 ceil 秒数不能拿来当片长）。无效为 0。
 */
export function videoEditDurationSec(measuredSec: number | null | undefined): number {
  const n = Number(measuredSec);
  return Number.isFinite(n) && n > 0 ? Math.floor(n * 10 + 1e-6) / 10 : 0;
}

export type VideoEditRangeCheck = {
  startSec: number;
  endSec: number;
  /** 所选长度（秒，一位小数）。 */
  lengthSec: number;
  /** 不足 4 秒时服务端将自动扩展后的区间（仅提示用，与服务端同一函数算）；够 4 秒为 null。 */
  expandedTo: { startSec: number; endSec: number } | null;
  /** 不可提交的原因；可提交为空串。 */
  problem: string;
};

/**
 * 区间校验（纯函数）：取一位小数；起点<终点；不越过片长；不超过 30 秒。
 * 不足 4 秒不算错，只给出“将自动扩到 4 秒”的预估区间：直接用服务端 planVideoEditSegment
 * （以选段中心向两侧扩到 4 秒，贴片头/片尾往另一侧补）；片长未知时按不贴片尾估。
 */
export function checkVideoEditRange(startSec: number, endSec: number, durationSec?: number): VideoEditRangeCheck {
  const start = roundSec(Number(startSec));
  const end = roundSec(Number(endSec));
  const dur = durationSec != null && Number.isFinite(durationSec) && durationSec > 0 ? videoEditDurationSec(durationSec) : undefined;
  const lengthSec = Number.isFinite(start) && Number.isFinite(end) ? roundSec(end - start) : 0;
  const base = { startSec: start, endSec: end, lengthSec, expandedTo: null };
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { ...base, problem: "请填写起止秒数" };
  if (start < 0) return { ...base, problem: "起点不能早于 0 秒" };
  if (dur != null && end > dur) return { ...base, problem: `终点不能超过片长 ${dur.toFixed(1)} 秒` };
  if (end <= start) return { ...base, problem: "终点需晚于起点" };
  if (lengthSec > VIDEO_EDIT_MAX_SEC) return { ...base, problem: `单次最多修改 ${VIDEO_EDIT_MAX_SEC} 秒，请缩短区间` };
  if (lengthSec >= VIDEO_EDIT_MIN_SEC) return { ...base, problem: "" };
  if (dur != null && dur < VIDEO_EDIT_MIN_SEC) return { ...base, problem: `视频不足 ${VIDEO_EDIT_MIN_SEC} 秒，暂不支持局部修改` };
  try {
    const plan = planVideoEditSegment(dur ?? roundSec(end + VIDEO_EDIT_MIN_SEC), start, end);
    return { ...base, expandedTo: { startSec: plan.startSec, endSec: plan.endSec }, problem: "" };
  } catch (e) {
    return { ...base, problem: e instanceof Error ? e.message : "请调整修改区间" };
  }
}

/**
 * 前端即时预估（拖动时不发请求）：片长须是服务端报价带回的 sourceDurationSec，与服务端同一组函数算区间与积分。
 * 只用于显示；区间不合法返回 null。提交时的 expectedCredits 仍取服务端报价。
 */
export function estimateVideoEditQuote(sourceDurationSec: number, startSec: number, endSec: number, waived: boolean): SharedVideoEditQuote | null {
  try {
    return quoteVideoEdit(planVideoEditSegment(sourceDurationSec, startSec, endSec), waived);
  } catch {
    return null;
  }
}

/** 来源规范化（同 videoGradeSubmit）：只接 https/gs；CloudFront 成品先导入为本人 gs://。 */
export async function normalizeVideoEditSource(url: string, importSource?: (url: string) => Promise<string>): Promise<string> {
  const value = String(url || "").trim();
  if (!/^(?:https:\/\/|gs:\/\/)/.test(value)) throw new Error("请先选择可用的视频");
  return value.startsWith(WAVESPEED_CDN) ? await (importSource ?? importWorkflowVideoSource)(value) : value;
}

export function newVideoEditRequestId(): string {
  return crypto.randomUUID();
}

/** 组装提交参数（纯函数）；校验失败抛中文错误。videoUrl/referenceImageUrls 需已规范化。 */
export function buildVideoEditSubmitInput(req: VideoEditRequest, requestId: string): VideoEditSubmitInput {
  const range = checkVideoEditRange(req.startSec, req.endSec, req.durationSec);
  if (range.problem) throw new Error(range.problem);
  const promptZh = String(req.promptZh || "").trim();
  if (!promptZh) throw new Error("请描述要修改的内容");
  if (promptZh.length > VIDEO_EDIT_PROMPT_MAX) throw new Error(`修改描述请控制在 ${VIDEO_EDIT_PROMPT_MAX} 字以内`);
  const refs = (req.referenceImageUrls ?? []).map(x => String(x || "").trim()).filter(Boolean);
  if (refs.length > VIDEO_EDIT_REF_MAX) throw new Error(`参考图最多 ${VIDEO_EDIT_REF_MAX} 张`);
  if (refs.some(x => !/^(?:https:\/\/|gs:\/\/)/.test(x))) throw new Error("参考图地址不可用，请重新选择");
  const expectedCredits = Number(req.expectedCredits);
  if (!Number.isFinite(expectedCredits) || expectedCredits < 0) throw new Error("尚未取得报价，请稍候再提交");
  if (!requestId) throw new Error("提交编号生成失败，请重试");
  return {
    sourceUrl: req.videoUrl,
    startSec: range.startSec,
    endSec: range.endSec,
    promptZh,
    ...(refs.length ? { referenceImageUrls: refs } : {}),
    requestId,
    expectedCredits,
  };
}

const finiteSec = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/**
 * 局部修改提交：校验 → 来源与参考图规范化（CloudFront 先导入）→ 入队，返回 jobId 与所用 requestId；
 * 回执带区间时另给 editedRange（服务端实际修改区间，不足 4 秒已扩展）。
 * requestId：调用方每次点击「确认提交」传入新 uuid（或不传由此生成）；同一次点击的重试传回同一个。
 */
export async function submitVideoEdit(
  req: VideoEditRequest,
  deps: VideoEditSubmitDeps
): Promise<{ jobId: string; requestId: string; editedRange?: { startSec: number; endSec: number } }> {
  buildVideoEditSubmitInput({ ...req, videoUrl: "https://placeholder.invalid/", referenceImageUrls: [] }, "check");
  const importSource = deps.importSource ?? importWorkflowVideoSource;
  const videoUrl = await normalizeVideoEditSource(req.videoUrl, importSource);
  const refs: string[] = [];
  for (const ref of req.referenceImageUrls ?? []) {
    const v = String(ref || "").trim();
    if (v) refs.push(v.startsWith(WAVESPEED_CDN) ? await importSource(v) : v);
  }
  const requestId = req.requestId || (deps.newRequestId ?? newVideoEditRequestId)();
  const input = buildVideoEditSubmitInput({ ...req, videoUrl, referenceImageUrls: refs }, requestId);
  const res = await deps.submit(input);
  const jobId = typeof res === "string" ? res : res?.jobId;
  if (!jobId) throw new Error("尚未取得修改任务编号，请稍后在任务记录中查看");
  const receipt = typeof res === "object" ? res : undefined;
  const editedRange =
    receipt && finiteSec(receipt.startSec) && finiteSec(receipt.endSec) ? { startSec: receipt.startSec, endSec: receipt.endSec } : undefined;
  return { jobId, requestId, ...(editedRange ? { editedRange } : {}) };
}

/** getPostProdJob 结果归一（VE1 约定：成功 output.url；失败 error 中性句 + output.refund）。 */
export type VideoEditJobView = {
  status: "active" | "succeeded" | "failed";
  url?: string;
  gcsUri?: string;
  durationSec?: number;
  editedRange?: { startSec: number; endSec: number };
  creditsCharged?: number;
  error?: string;
  refundedCredits?: number;
  /** 仅 debugMode 显示。 */
  debug?: { channel?: string; rejection?: unknown };
};


export function readVideoEditJob(data: unknown): VideoEditJobView | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const status = String(d.status ?? "").toLowerCase();
  const out = d.output && typeof d.output === "object" ? (d.output as Record<string, unknown>) : {};
  if (status === "succeeded") {
    const url = typeof out.url === "string" && out.url ? out.url : undefined;
    if (!url) return { status: "active" };
    const range = out.editedRange as { startSec?: unknown; endSec?: unknown } | undefined;
    return {
      status: "succeeded",
      url,
      ...(typeof out.gcsUri === "string" ? { gcsUri: out.gcsUri } : {}),
      ...(typeof out.durationSec === "number" ? { durationSec: out.durationSec } : {}),
      ...(range && typeof range.startSec === "number" && typeof range.endSec === "number" ? { editedRange: { startSec: range.startSec, endSec: range.endSec } } : {}),
      ...(typeof out.creditsCharged === "number" ? { creditsCharged: out.creditsCharged } : {}),
      ...(out.debug && typeof out.debug === "object" ? { debug: out.debug as VideoEditJobView["debug"] } : {}),
    };
  }
  if (status === "failed" || status === "error") {
    const refund = out.refund as { credits?: unknown; refunded?: unknown } | undefined;
    return {
      status: "failed",
      error: typeof d.error === "string" && d.error ? d.error : "修改未成功",
      ...(refund?.refunded === true && typeof refund.credits === "number" ? { refundedCredits: refund.credits } : {}),
      ...(out.debug && typeof out.debug === "object" ? { debug: out.debug as VideoEditJobView["debug"] } : {}),
    };
  }
  return { status: "active" };
}

/** 报价读取：拿不到 credits 返回 null。 */
export function readVideoEditQuote(data: unknown): VideoEditQuote | null {
  if (!data || typeof data !== "object") return null;
  const q = data as VideoEditQuote;
  return typeof q.credits === "number" && Number.isFinite(q.credits) ? q : null;
}
