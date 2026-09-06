import { z } from "zod";

/** 项目指纹只标识已确认剧本；用户身份始终由服务端会话确定。 */
export const manhuaPilotScopeSchema = z
  .object({
    projectVersion: z.string().regex(/^[a-f0-9]{64}$/),
    episodeIndex: z.number().int().min(1).max(9999),
    videoModel: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[a-zA-Z0-9._-]+$/),
  })
  .strict();

export const manhuaPilotSubmissionSchema = manhuaPilotScopeSchema
  .omit({ videoModel: true })
  .extend({
    segmentIndex: z.number().int().min(1).max(9999),
    intent: z.enum(["pilot", "full"]),
  })
  .strict();

export const manhuaPilotDecisionSchema = manhuaPilotScopeSchema
  .extend({
    taskId: z.string().min(1).max(180),
    decision: z.enum(["approve", "reject"]),
  })
  .strict();

export const manhuaPilotReviewStateSchema = z
  .object({
    status: z.enum([
      "not_started",
      "submitting",
      "reconcile_manual",
      "generated",
      "approved",
      "rejected",
      "failed",
    ]),
    taskId: z.string().min(1).max(180).optional(),
    outputUrl: z
      .string()
      .url()
      .max(16384)
      .refine(url => url.startsWith("https://"))
      .optional(),
    updatedAt: z.string().max(80).optional(),
  })
  .superRefine((state, ctx) => {
    if (
      ["generated", "approved", "rejected"].includes(state.status) &&
      (!state.taskId || !state.outputUrl)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "已生成的试片必须有任务和视频身份",
      });
    }
  });

export type ManhuaPilotScope = z.infer<typeof manhuaPilotScopeSchema>;
export type ManhuaPilotSubmission = z.infer<typeof manhuaPilotSubmissionSchema>;
export type ManhuaPilotDecision = z.infer<typeof manhuaPilotDecisionSchema>;
export type ManhuaPilotReviewState = z.infer<
  typeof manhuaPilotReviewStateSchema
>;

export function manhuaPilotScopeKey(
  userId: string | number,
  scope: ManhuaPilotScope
): string {
  const parsed = manhuaPilotScopeSchema.parse(scope);
  if (!String(userId).trim()) throw new Error("试片审核需要登录身份");
  return JSON.stringify([
    String(userId),
    parsed.projectVersion,
    parsed.episodeIndex,
    parsed.videoModel,
  ]);
}

/** 客户端只是预检；服务端仍须在扣费和创建任务前用持久记录再次校验。 */
export function assertManhuaPilotSubmissionAllowed(
  state: ManhuaPilotReviewState,
  submission: Pick<ManhuaPilotSubmission, "intent" | "segmentIndex">,
  durationSec: number
): void {
  if (submission.intent === "full") {
    if (state.status !== "approved")
      throw new Error("请先审阅并批准本集当前生成档的 10 秒试片");
    return;
  }
  if (submission.segmentIndex !== 1 || durationSec !== 10) {
    throw new Error("试片只能生成第 1 段的前 10 秒");
  }
  if (state.status === "reconcile_manual") {
    throw new Error(
      "原试片提交结果需要核对，暂不能重新生成；请联系管理员核对原任务"
    );
  }
  if (["submitting", "generated", "approved"].includes(state.status)) {
    throw new Error("已有试片任务或审核结果，请先核对并审阅，不要重复生成");
  }
}
