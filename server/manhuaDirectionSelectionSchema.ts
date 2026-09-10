import { z } from "zod";

/**
 * 导演包选卡入参（主卡 + 场次副卡）。
 * 审查 P0：zod 4 的 `z.record(z.enum)` 是穷举语义，选了任意一张副卡就会因为其它四类缺失被 400；
 * 副卡本来就是「有就盖、没有走主卡」，必须 partialRecord。未知卡由服务端按内置卡库过滤。
 */
export const MANHUA_DIRECTION_SCENE_TYPE_ENUM = z.enum(["action", "dialogue", "reveal", "emotion", "transition"]);
export const MANHUA_DIRECTION_STAGE_ENUM = z.enum(["story", "assets", "storyboard", "keyframe", "clip", "review"]);

export const manhuaDirectionSceneOverrideSchema = z.object({
  cardId: z.string().max(80),
  stages: z.array(MANHUA_DIRECTION_STAGE_ENUM).max(6).optional(),
});

export const manhuaDirectionSelectionInputSchema = z.object({
  mainCardId: z.string().max(80),
  sceneOverrides: z.partialRecord(MANHUA_DIRECTION_SCENE_TYPE_ENUM, manhuaDirectionSceneOverrideSchema).optional(),
});

export type ManhuaDirectionSelectionInput = z.infer<typeof manhuaDirectionSelectionInputSchema>;
