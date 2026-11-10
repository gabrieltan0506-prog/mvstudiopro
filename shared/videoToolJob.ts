/**
 * 视频「局部修改」「调色」在途任务追踪记录：画布视频块 `videoToolJobs` 与 MV 草稿 `finalEditJobs` 共用。
 * 服务端后期任务是真源（getPostProdJob）；这里只存提交成功后拿到的任务号与提交时的上下文，
 * 刷新后据此恢复轮询，完成或失败即清除。不存结果、不存费用。
 *
 * 「提交中」记录（只有局部修改有：计费、服务端按 requestId 幂等）：入队请求发出前先以 requestId 记一条，
 * 回执到了补全任务号；刷新后只有 requestId 时按 requestId 向服务端核对（任务号由 requestId 决定性派生），
 * 查到即补全接着轮询，确认服务端没有这次任务才清除。调色不计费、服务端无请求号幂等，不记提交中。
 */
import { z } from "zod";

const id = z.string().trim().min(1).max(200);

export const videoToolJobRangeSchema = z
  .object({ startSec: z.number().min(0), endSec: z.number().positive() })
  .strict();

export const videoToolJobSchema = z
  .object({
    /** edit = 局部修改（计费，失败或被拒全额退）；grade = 调色（后期 concat，不计费）。 */
    kind: z.enum(["edit", "grade"]),
    jobId: id,
    /** 局部修改：面板确认提交那一次的 requestId（服务端幂等键）；调色：本次点击生成的编号。 */
    requestId: id,
    /** 发起时间（ISO）。 */
    startedAt: z.string().trim().min(1).max(40),
    /** 提交时的成片地址：完成后留在历史，原片不丢。 */
    sourceUrl: z.string().trim().min(1).max(4000),
    /** 局部修改实际提交区间（秒；不足 4 秒为服务端扩展后的值）。 */
    range: videoToolJobRangeSchema.optional(),
  })
  .strict();
export type VideoToolJob = z.infer<typeof videoToolJobSchema>;
export type VideoToolJobKind = VideoToolJob["kind"];

/** 局部修改「提交中」：还没拿到入队回执（可能已扣费），只有 requestId（面板生成的 uuid，服务端按它派生任务号）。 */
export const videoToolJobSubmittingSchema = z
  .object({
    kind: z.literal("edit"),
    status: z.literal("submitting"),
    requestId: z.string().uuid(),
    /** 最近一次发出入队请求的时间（ISO；同一 requestId 重试会刷新）。 */
    startedAt: z.string().trim().min(1).max(40),
    sourceUrl: z.string().trim().min(1).max(4000),
    /** 确认框里的报价区间（已按服务端规则扩到 4 秒）。 */
    range: videoToolJobRangeSchema.optional(),
  })
  .strict();
export type VideoToolJobSubmitting = z.infer<typeof videoToolJobSubmittingSchema>;
export type VideoToolJobRecord = VideoToolJob | VideoToolJobSubmitting;

export const isVideoToolJobSubmitting = (r: VideoToolJobRecord): r is VideoToolJobSubmitting =>
  (r as { status?: unknown }).status === "submitting";

/** 每块在途记录上限（同块同类只一条在途，正常只有一两条；只防坏档撑爆草稿）。 */
export const VIDEO_TOOL_JOBS_MAX = 20;

/**
 * 读 / 写块上的在途记录（本机与云草稿同一把尺，宽进严出）：逐条校验，坏条目丢弃、不整块拒收；
 * 已入队的同 jobId 只留一条；同 requestId 的「提交中」只留一条，已有任务号的同请求压过提交中；
 * 超过上限只截留最新的 VIDEO_TOOL_JOBS_MAX 条并 console.warn。
 */
export function sanitizeVideoToolJobRecords(raw: unknown): VideoToolJobRecord[] {
  if (!Array.isArray(raw)) return [];
  const tracked: VideoToolJob[] = [];
  const submitting: VideoToolJobSubmitting[] = [];
  const out: VideoToolJobRecord[] = [];
  for (const item of raw) {
    const job = videoToolJobSchema.safeParse(item);
    if (job.success) {
      if (tracked.some(j => j.jobId === job.data.jobId)) continue;
      tracked.push(job.data);
      out.push(job.data);
      continue;
    }
    const pending = videoToolJobSubmittingSchema.safeParse(item);
    if (pending.success && !submitting.some(s => s.requestId === pending.data.requestId)) {
      submitting.push(pending.data);
      out.push(pending.data);
    }
  }
  const kept = out.filter(r => !isVideoToolJobSubmitting(r) || !tracked.some(j => j.kind === "edit" && j.requestId === r.requestId));
  if (kept.length <= VIDEO_TOOL_JOBS_MAX) return kept;
  console.warn(`[videoToolJob] 在途记录共 ${kept.length} 条，超过上限 ${VIDEO_TOOL_JOBS_MAX}，只保留最新 ${VIDEO_TOOL_JOBS_MAX} 条`);
  return kept.slice(-VIDEO_TOOL_JOBS_MAX);
}
