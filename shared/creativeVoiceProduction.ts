import { z } from "zod";
export const creativeVoiceProductionSchema = z.discriminatedUnion("action", [
  z.object({action:z.literal("inspect")}).strict(),
  z.object({action:z.literal("restoreBackup")}).strict(),
  z.object({action:z.literal("media"),operation:z.enum(["inspect","previewImage","finishImage","resumeMedia","applyImage","editVideo"])}).strict(),
  z.object({action:z.literal("applyEpisode"),episode:z.number().int().positive()}).strict(),
  z.object({action:z.literal("prepareEpisode"),episode:z.number().int().positive(),question:z.string().trim().min(2).max(1100)}).strict(),
  z.object({action:z.literal("applyPrevis")}).strict(),
  z.object({action:z.literal("retryPrevis")}).strict(),
  z.object({action:z.literal("world"),assetId:z.string().min(1).max(200)}).strict(),
  z.object({action:z.literal("generateWorld")}).strict(),
  z.object({action:z.literal("retryWorld"),assetId:z.string().min(1).max(200)}).strict(),
  z.object({action:z.literal("assets")}).strict(),
  z.object({action:z.literal("image2d"),anchorId:z.string().min(1).max(200)}).strict(),
  z.object({action:z.literal("model3d"),assetId:z.string().min(1).max(200)}).strict(),
  z.object({action:z.literal("previs"),clipId:z.string().min(1).max(200)}).strict(),
  z.object({action:z.literal("renderPrevis"),question:z.string().trim().min(2).max(1200)}).strict(),
]);
export type CreativeVoiceProductionAction = z.infer<typeof creativeVoiceProductionSchema>;
