/**
 * 视频「局部修改」「调色」在途任务追踪记录：画布视频块 `videoToolJobs` 与 MV 草稿 `finalEditJobs` 共用。
 * 服务端后期任务是真源（getPostProdJob）；这里只存提交成功后拿到的任务号与提交时的上下文，
 * 刷新后据此恢复轮询，完成或失败即清除。不存结果、不存费用。
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
