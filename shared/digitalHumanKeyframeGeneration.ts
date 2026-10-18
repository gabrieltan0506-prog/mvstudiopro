import { z } from "zod";

export const digitalHumanOriginalPortraitSchema = z.object({
  source: z.string().regex(/^gs:\/\/[^/]+\/uploads\/u[^/]+\//).max(5000),
  name: z.string().min(1).max(200),
}).strict();
export const digitalHumanKeyframeImageDraftSchema = z.object({
  label: z.string().max(120), description: z.string().max(8000),
  startSec: z.number().finite().min(0).optional(), endSec: z.number().finite().positive().optional(),
  adviceRevision: z.string().max(100).optional(),
}).strict();
export const digitalHumanKeyframeGenerationInputSchema = z.object({
  requestId: z.string().uuid(), draftId: z.string().uuid(),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().min(10).max(8000),
  aspectRatio: z.enum(["9:16", "16:9"]),
  portraits: z.array(digitalHumanOriginalPortraitSchema).min(1).max(5),
  scene: z.object({ source: z.string().regex(/^gs:\/\/[^/]+\//).max(5000), name: z.string().min(1).max(200) }).strict().optional(),
  startSec: z.number().finite().min(0).optional(), endSec: z.number().finite().positive().optional(),
  adviceRevision: z.string().max(100).optional(),
}).strict().refine(r => new Set(r.portraits.map(p => p.source)).size === r.portraits.length, "人像参考重复，请保留一份原文件").refine(r => !r.scene || !r.portraits.some(p => p.source === r.scene!.source), "场景图不能与身份图使用同一份文件");
export type DigitalHumanKeyframeGenerationInput = z.infer<typeof digitalHumanKeyframeGenerationInputSchema>;
export const digitalHumanKeyframeGenerationReceiptSchema = z.object({
  request: digitalHumanKeyframeGenerationInputSchema,
  status: z.enum(["submitted", "running", "succeeded", "failed", "unknown"]),
  jobId: z.string().optional(), source: z.string().optional(), message: z.string().optional(),
}).strict();
export function digitalHumanKeyframeGenerationPrompt(r: DigitalHumanKeyframeGenerationInput) {
  // 保留已提交旧请求的字节级提示词，恢复原编号时不能变更输入。
  if (!r.scene) return `生成一张${r.aspectRatio}电影关键分镜图。所有输入图片均为用户指定的同一人物基础参考，直接据此生成，不得把之前生成的分镜当作改图底图。严格保持参考人物的脸型、五官比例、发际线、年龄特征和身材，不美化重塑、不融合成新面孔。参考中的背景、道具与光束不自动带入新画面。服装、动作、空间和构图以以下本镜要求为准。只出现一位该人物，不拼图。\n本镜：${r.label}\n${r.description}`;
  return `生成一张${r.aspectRatio}电影关键分镜图。前${r.portraits.length}张图片为用户指定的同一人物基础参考，直接据此生成，不得把之前生成的分镜当作改图底图。严格保持参考人物的脸型、五官比例、发际线、年龄特征和身材，不美化重塑、不融合成新面孔。参考中的背景、道具与光束不自动带入新画面。${r.scene ? `第${r.portraits.length + 1}张图片是本段已选场景，只用于环境、空间结构和材质，不用于人物身份；保持原场景可辨识，不凭空换房间。` : "未提供场景图，环境仅按下方文字要求生成。"}服装、动作和构图以以下本镜要求为准。只出现一位该人物，不拼图。\n本镜：${r.label}\n${r.description}`;
}
