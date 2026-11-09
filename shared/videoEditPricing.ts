/**
 * 视频局部修改（产品功能）计价与选段：用户 1109 拍板「每 2 秒 30 积分，不足 2 秒按 2 秒算」，
 * 按实际提交的编辑片段时长计；管理员/supervisor 由扣费层（deductCreditsAmount）免扣。
 * 片段时长受上游编辑输入约束：4–30 秒（等长输出）；不足 4 秒向两侧扩到 4 秒并提示用户。
 */
import { z } from "zod";

export const VIDEO_EDIT_CREDITS_PER_2S = 30;
export const VIDEO_EDIT_MIN_SEC = 4;
export const VIDEO_EDIT_MAX_SEC = 30;
/** 拼回时首尾原片段短于此值即省略（与后期 trims 最短取段一致）。 */
export const VIDEO_EDIT_MIN_KEEP_SEC = 0.1;

const tenth = (n: number) => Math.round(n * 10) / 10;

/** ceil(秒/2)×30；先按 0.1 秒取整，避免 2.0000001 这类浮点误差多收一档。 */
export function videoEditCredits(segmentSec: number): number {
  if (!Number.isFinite(segmentSec) || segmentSec <= 0) throw new Error("片段时长无效");
  return Math.ceil(tenth(segmentSec) / 2 - 1e-9) * VIDEO_EDIT_CREDITS_PER_2S;
}

export type VideoEditSegmentPlan = {
  sourceDurationSec: number;
  requestedStartSec: number;
  requestedEndSec: number;
  startSec: number;
  endSec: number;
  segmentSec: number;
  expanded: boolean;
  notice?: string;
};

/**
 * 选段规整：一位小数；不足 4 秒以选段中心向两侧扩到 4 秒，贴边时整体平移到原片范围内；
 * 原片不足 4 秒或选段超过 30 秒直接拒绝（不悄悄截断）。
 */
export function planVideoEditSegment(sourceDurationSec: number, startSec: number, endSec: number): VideoEditSegmentPlan {
  if (![sourceDurationSec, startSec, endSec].every(Number.isFinite)) throw new Error("片段时间无效");
  const total = Math.floor(sourceDurationSec * 10 + 1e-6) / 10; // 不超过原片
  const s = tenth(startSec), e = tenth(endSec);
  if (s < 0 || e > total + 1e-9 || e - s < 0.1 - 1e-9) throw new Error("修改片段须在原片范围内，且至少 0.1 秒");
  if (total < VIDEO_EDIT_MIN_SEC) throw new Error(`原片不足 ${VIDEO_EDIT_MIN_SEC} 秒，暂不支持局部修改`);
  if (e - s > VIDEO_EDIT_MAX_SEC + 1e-9) throw new Error(`单次修改片段最长 ${VIDEO_EDIT_MAX_SEC} 秒，请缩短选段`);
  let start = s, end = e, expanded = false;
  if (e - s < VIDEO_EDIT_MIN_SEC - 1e-9) {
    expanded = true;
    const pad = (VIDEO_EDIT_MIN_SEC - (e - s)) / 2;
    start = tenth(s - pad);
    end = tenth(start + VIDEO_EDIT_MIN_SEC);
    if (start < 0) { start = 0; end = VIDEO_EDIT_MIN_SEC; }
    if (end > total) { end = total; start = tenth(total - VIDEO_EDIT_MIN_SEC); }
  }
  const segmentSec = tenth(end - start);
  return {
    sourceDurationSec: total,
    requestedStartSec: s,
    requestedEndSec: e,
    startSec: start,
    endSec: end,
    segmentSec,
    expanded,
    ...(expanded ? { notice: `所选片段不足 ${VIDEO_EDIT_MIN_SEC} 秒，已自动扩展为 ${start.toFixed(1)}–${end.toFixed(1)} 秒（按 ${segmentSec.toFixed(1)} 秒计费）` } : {}),
  };
}

export const VIDEO_EDIT_CONFIRM_NOTICE =
  "提交后无法取消；修改失败或未通过内容审核将全额退回积分。修改结果另存为新文件，原片保留。";

export type VideoEditQuote = VideoEditSegmentPlan & {
  credits: number;
  waived: boolean;
  creditsPerTwoSec: number;
  minSec: number;
  maxSec: number;
  confirmNotice: string;
};

export function quoteVideoEdit(plan: VideoEditSegmentPlan, waived: boolean): VideoEditQuote {
  return {
    ...plan,
    credits: waived ? 0 : videoEditCredits(plan.segmentSec),
    waived,
    creditsPerTwoSec: VIDEO_EDIT_CREDITS_PER_2S,
    minSec: VIDEO_EDIT_MIN_SEC,
    maxSec: VIDEO_EDIT_MAX_SEC,
    confirmNotice: VIDEO_EDIT_CONFIRM_NOTICE,
  };
}

/** 拼回用后期 concat 参数：前段原片 + 编辑段 + 后段原片，不变速、不加转场，总时长 = 原片时长。 */
export function buildVideoEditSpliceConcat(input: {
  sourceUri: string;
  editedUri: string;
  startSec: number;
  endSec: number;
  sourceDurationSec: number;
  width: number;
  height: number;
  fps: number;
}): { clips: string[]; trims: Array<{ startSec: number; endSec: number }>; width: number; height: number; fps: number; totalSec: number } {
  const { sourceUri, editedUri, startSec, endSec, sourceDurationSec } = input;
  if (!(startSec >= 0 && endSec > startSec && endSec <= sourceDurationSec + 1e-6)) throw new Error("拼回片段超出原片范围");
  const clips: string[] = [], trims: Array<{ startSec: number; endSec: number }> = [];
  if (startSec >= VIDEO_EDIT_MIN_KEEP_SEC) { clips.push(sourceUri); trims.push({ startSec: 0, endSec: startSec }); }
  clips.push(editedUri); trims.push({ startSec: 0, endSec: tenth(endSec - startSec) });
  if (sourceDurationSec - endSec >= VIDEO_EDIT_MIN_KEEP_SEC) { clips.push(sourceUri); trims.push({ startSec: endSec, endSec: sourceDurationSec }); }
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const totalSec = trims.reduce((sum, t) => sum + (t.endSec - t.startSec), 0);
  return { clips, trims, width: even(input.width), height: even(input.height), fps: Math.min(60, Math.max(12, Math.round(input.fps))), totalSec };
}

const mediaSource = z.string().trim().min(1).max(2048);
export const videoPartialEditRequestSchema = z.object({
  sourceUrl: mediaSource,
  startSec: z.number().finite().min(0).max(3600),
  endSec: z.number().finite().positive().max(3600),
  promptZh: z.string().trim().min(1).max(2000),
  referenceImageUrls: z.array(mediaSource).max(4).optional(),
  requestId: z.string().uuid(),
  expectedCredits: z.number().int().min(0),
}).strict();
export type VideoPartialEditRequest = z.infer<typeof videoPartialEditRequestSchema>;

export const videoPartialEditQuoteInputSchema = z.object({
  sourceUrl: mediaSource,
  startSec: z.number().finite().min(0).max(3600),
  endSec: z.number().finite().positive().max(3600),
}).strict();

/** post_prod 任务输入（入队后不可变）：选段已规整、价格已锁、归属已核验为 gs://。 */
export const videoPartialEditJobSchema = z.object({
  scopeKey: z.string().max(128).optional(),
  action: z.literal("video_partial_edit"),
  requestId: z.string().uuid(),
  params: z.object({
    videoUri: mediaSource,
    referenceImageUris: z.array(mediaSource).max(4).default([]),
    promptZh: z.string().trim().min(1).max(2000),
    sourceDurationSec: z.number().finite().positive(),
    startSec: z.number().finite().min(0),
    endSec: z.number().finite().positive(),
    segmentSec: z.number().finite().min(VIDEO_EDIT_MIN_SEC).max(VIDEO_EDIT_MAX_SEC),
    expanded: z.boolean(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().finite().positive(),
    hasAudio: z.boolean(),
    charge: z.object({
      credits: z.number().int().min(0),
      chargeKey: z.string().min(1).max(120),
      source: z.string().max(32),
    }).strict(),
  }).strict(),
}).strict();
export type VideoPartialEditJob = z.infer<typeof videoPartialEditJobSchema>;
