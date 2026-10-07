import { analyzeImageWorld } from "../services/imageWorldAnalysis";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { resolveRegisteredPostProdMediaSource } from "../services/postProdMediaSource";
import { signGsUriV4ReadUrl } from "../services/gcs";
import { createManhua3dTask } from "../services/manhua3dTask";
import { createManhuaWorldTask } from "../services/manhuaWorldTask";
import {
  imageWorldPlanSchema,
  imageWorldEmptyPrompt,
} from "../../shared/imageWorld";
import { mapManhua3dTaskError } from "./manhua3d";
import { mapManhuaWorldTaskError } from "./manhuaWorld";

const source = z.string().min(1).max(4096);
async function ownedSource(userId: number, uri: string) {
  const canonical = await resolveRegisteredPostProdMediaSource({
    userId: String(userId),
    source: uri,
  });
  if (!canonical.startsWith("gs://"))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请先将图片保存到当前账号的素材库",
    });
  return { canonical, url: signGsUriV4ReadUrl(canonical, 3600) };
}
/** Preserves existing model services, pricing and idempotency; no FAL/Hunyuan adapter. */
export const imageWorldRouter = router({
  source: protectedProcedure
    .input(z.object({ sourceUri: source }).strict())
    .query(({ ctx, input }) => ownedSource(ctx.user.id, input.sourceUri)),
  analysisStatus: protectedProcedure
    .input(
      z
        .object({ requestId: z.string().min(1).max(160), sourceUri: source })
        .strict()
    )
    .query(async ({ ctx, input }) => {
      try {
        return await analyzeImageWorld(ctx.user.id, input, undefined, true);
      } catch {
        throw new TRPCError({
          code: "CONFLICT",
          message: "尚未取回原分析结果，未提交新调用；请稍后再查",
        });
      }
    }),
  analyze: protectedProcedure
    .input(
      z
        .object({ requestId: z.string().min(1).max(160), sourceUri: source })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await analyzeImageWorld(ctx.user.id, input);
      } catch (error) {
        console.error(
          "[image-world] analysis failed",
          error instanceof Error ? error.name : "unknown"
        );
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "分析尚未完成；原请求与已返回证据保留，请查询原任务，不要重复生成",
        });
      }
    }),
  object: adminProcedure
    .input(
      z
        .object({ assetRef: z.string().min(1).max(160), sourceUri: source })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      const image = await ownedSource(ctx.user.id, input.sourceUri);
      try {
        return await createManhua3dTask({
          userId: ctx.user.id,
          assetRef: input.assetRef,
          sourceVersion: image.canonical,
          sourceImageUrl: image.url,
        });
      } catch (e) {
        return mapManhua3dTaskError(e);
      }
    }),
  world: adminProcedure
    .input(
      z
        .object({
          sceneRef: z.string().min(1).max(160),
          sourceUri: source,
          name: z.string().min(1).max(120),
          plan: imageWorldPlanSchema,
          model: z.enum(["marble-1.1", "marble-1.0-draft"]),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      const image = await ownedSource(ctx.user.id, input.sourceUri);
      try {
        return await createManhuaWorldTask({
          userId: ctx.user.id,
          sceneRef: input.sceneRef,
          sourceVersion: image.canonical,
          sourceImageUrl: image.url,
          sourceImageGcsUri: image.canonical,
          displayName: input.name,
          model: input.model,
          prompt: {
            type: "image",
            isPano: "auto",
            textPrompt: imageWorldEmptyPrompt(input.plan),
          },
        });
      } catch (e) {
        return mapManhuaWorldTaskError(e);
      }
    }),
});
