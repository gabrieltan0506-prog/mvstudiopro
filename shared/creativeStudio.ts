import { z } from "zod";
import { artMotionSpecSchema } from "./artMotion";
import { imageWorldPlanSchema } from "./imageWorld";
export const creativeStudioActionSchema = z
  .object({
    action: z.literal("creativeStudio"),
    tool: z.enum(["artMotion", "imageWorld"]),
    operation: z.enum(["inspect", "open", "configure"]),
    blockId: z.string().min(1).max(180).optional(),
    revision: z.string().max(80).optional(),
    spec: artMotionSpecSchema.optional(),
    plan: imageWorldPlanSchema.optional(),
  })
  .strict();
export function creativeStudioRevision(value: unknown) {
  const raw = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++)
    hash = Math.imul(hash ^ raw.charCodeAt(i), 16777619);
  return `studio1:${raw.length}:${hash >>> 0}`;
}
export const CREATIVE_STUDIO_HELP =
  "图片拆景与艺术动画已接入当前作品及自由画布。creativeStudio(tool=artMotion或imageWorld,operation=inspect/open/configure)。inspect只读当前真实方案、blockId、revision和素材；open打开对应方案；configure须带inspect返回的blockId与revision，artMotion传完整spec，imageWorld传完整plan。只保存方案，不自动生成、计费或采用。艺术动画提供35种程序场景、8种参数解说，文字/图片/图表/可选音轨可制单支横竖屏影片；预览是同一程序引擎，不是视频模型换画风。图片拆景沿原图分析、用户核对独立实例、生成物件图与空场景底图、原三维服务、查询与明确采用，不混合相邻物件。物件使用现有物件建模通道；场景沿现有空间通道。空间视觉和碰撞网格不等于可编辑物件模型，环境声可在原声音编辑器导入、裁切、试听、采用与合听；原曲生成只用于音乐，不新增环境音生成服务，不会自动购买。付费生成须用户在对应工作台点击确认；未知任务保留原号查询，候选不自动采用。没有实际查看新结果不得声称工作流已验收。";
