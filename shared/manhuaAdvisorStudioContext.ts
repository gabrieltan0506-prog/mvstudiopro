import { z } from "zod";

export const MANHUA_ADVISOR_STUDIO_LABELS = {
  model3d: "3D人物与模型", world3d: "3D场景", previs: "白模视频",
  actionTimeline: "动作节奏", audio: "对白、BGM与音效", edit: "后期剪辑", postprod: "视频后期",
} as const;
export const manhuaAdvisorStudioContextSchema = z.object({
  tool: z.enum(["model3d", "world3d", "previs", "actionTimeline", "audio", "edit", "postprod"]),
  task: z.enum(["concat", "enhance", "subtitle", "bgm", "loudness", "vfx"]).optional(),
  episodeIndex: z.number().int().positive(),
  segmentIndex: z.number().int().positive().optional(),
  clipId: z.string().min(1).max(180).optional(),
  assetId: z.string().min(1).max(180).optional(),
}).strict();
export type ManhuaAdvisorStudioContext = z.infer<typeof manhuaAdvisorStudioContextSchema>;

/** 切集的渲染间隙不借用上一集的工具对象，也不据工具选择改变制作阶段。 */
export function currentAdvisorStudioContext(value: ManhuaAdvisorStudioContext | null | undefined, episodeIndex: number) {
  return value?.episodeIndex === episodeIndex ? value : undefined;
}
