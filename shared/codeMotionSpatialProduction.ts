import { z } from "zod";

export const codeMotionSpatialProductionInputSchema = z
  .object({
    projectId: z.string().uuid(),
    expectedGeneration: z.string().regex(/^\d+$/),
    worldImageId: z.string().uuid(),
    actorImageIds: z.array(z.string().uuid()).min(1).max(4),
    worldPrompt: z.string().trim().min(2).max(2000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.actorImageIds).size !== value.actorImageIds.length)
      ctx.addIssue({ code: "custom", message: "人物参考图不能重复" });
  });
export type CodeMotionSpatialProductionInput = z.infer<
  typeof codeMotionSpatialProductionInputSchema
>;
export const CODE_MOTION_3D_COST_NOTICE =
  "本次生成1个3D场景及所选人物模型，沿用既有3D工作台服务费用，不包含在每日免费制作名额内。提交前核对全部参考图；结果不明时只恢复原任务，不自动重购。";
