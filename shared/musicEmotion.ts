import { z } from "zod";
/** 情绪可保持或变化，不强迫每段都有反转。 */
export const musicEmotionTurnSchema = z.object({
  fromZh: z.string().trim().min(1).max(500),
  toZh: z.string().trim().min(1).max(500),
  triggerZh: z.string().trim().min(1).max(1000),
  musicZh: z.string().trim().min(1).max(1000),
  visualZh: z.string().trim().min(1).max(1000),
}).strict();
export const musicEmotionArcSchema = z.array(z.object({
  sectionZh: z.string().trim().min(1).max(200),
  emotion: musicEmotionTurnSchema,
}).strict()).min(1);
export type MusicEmotionTurn = z.infer<typeof musicEmotionTurnSchema>;
export const MUSIC_EMOTION_INSTRUCTIONS = `每个源素材sections条目必须有emotion:{fromZh,toZh,triggerZh,musicZh,visualZh}：写清段初到段末的情绪、真实触发证据及音乐如何承接。没有明显变化可写保持，并说明依据；不虚构每段反转。有视频的视觉事实须来自原生读片；仅音频时visualZh明确标为画面建议，不能冒充看到的画面。
每套concept必须有emotionalArc:[{sectionZh,emotion:{fromZh,toZh,triggerZh,musicZh,visualZh}}]，逐段规划开场、主歌、预副歌、副歌、桥段及结尾中实际采用的段落；重复副歌逐次说明含义/强度如何变化，第一遍不要默认满强度。每次转折要由具体歌词/人物行动/音乐事件触发，包含配器进出、音区/唱法、动态与画面行动如何配合，不只写“激动/高潮”。无实际新歌时不得编造精确秒位。BPM可按中文唱词气口、律动与情绪建议，不锁死原参考速度，不保证生成后精确遵循。情绪理解与设计为可修订判断，不承诺爆款。`;
export function assertNewMusicEmotionCoverage(proposal: {
  sections: Array<{ emotion?: MusicEmotionTurn }>;
  concepts: Array<{ emotionalArc?: z.infer<typeof musicEmotionArcSchema> }>;
}) {
  if (proposal.sections.some(s => !s.emotion) || proposal.concepts.some(c => !c.emotionalArc?.length))
    throw Error("新方案缺少逐段情绪转折，完整响应已保留");
}
