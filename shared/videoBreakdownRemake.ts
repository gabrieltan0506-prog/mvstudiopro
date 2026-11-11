/**
 * 「用这套拍法创作新片」：保留拉片得到的分段结构、镜头序列、运镜、光色与节奏，只把主体与场景换成用户自己的。
 * 纯函数（不调模型）：替换【主体一致性】【场景与美术】，保留【镜头序列】【摄影机与构图】【光色与材质】【节奏与声音】；
 * 【生成约束】在原文后追加一句换主体说明，避免镜头序列里残留的原片主体描述把外观拉回原片。
 */
import { z } from "zod";
import { formatVideoBreakdownRecreatePrompt, type VideoBreakdownSegment } from "./videoBreakdown";

export const videoBreakdownRemakeInputSchema = z.object({
  subject: z.string().trim().min(1, "请用一句话写新主体").max(300, "新主体请控制在 300 字以内"),
  scene: z.string().trim().max(300, "新场景请控制在 300 字以内").optional(),
}).strict();
export type VideoBreakdownRemakeInput = z.infer<typeof videoBreakdownRemakeInputSchema>;

export const VIDEO_BREAKDOWN_REMAKE_CONSTRAINT = "本片换成新主体与新场景：主体外观以【主体一致性】为准，场景以【场景与美术】为准；【镜头序列】里出现的原片主体或场景字样只取其动作、走位、运镜与节奏，不沿用原片外观。";

/** 返回换了主体/场景的段（不改原对象）；场景留空时沿用原片场景。 */
export function remakeVideoBreakdownSegment(segment: VideoBreakdownSegment, input: VideoBreakdownRemakeInput): VideoBreakdownSegment {
  const { subject, scene } = videoBreakdownRemakeInputSchema.parse(input);
  const p = segment.recreatePrompt;
  return {
    ...segment,
    recreatePrompt: {
      ...p,
      subject,
      scene: scene?.trim() ? scene.trim() : p.scene,
      constraints: `${p.constraints}；${VIDEO_BREAKDOWN_REMAKE_CONSTRAINT}`,
    },
  };
}

/** 新片提示词文本（与复刻提示词同一格式）。 */
export function formatVideoBreakdownRemakePrompt(segment: VideoBreakdownSegment, input: VideoBreakdownRemakeInput): string {
  return formatVideoBreakdownRecreatePrompt(remakeVideoBreakdownSegment(segment, input));
}
