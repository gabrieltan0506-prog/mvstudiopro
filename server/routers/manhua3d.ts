import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc.js";
import {
  createManhua3dTask,
  getManhua3dTask,
} from "../services/manhua3dTask.js";

const httpsUrl = z
  .string()
  .url()
  .max(4_096)
  .refine(value => /^https:\/\//i.test(value), "参考图必须使用 HTTPS 地址");

const optionsSchema = z.object({
  texture: z.boolean().default(true),
  pbr: z.boolean().default(true),
  textureQuality: z.enum(["standard", "detailed"]).default("standard"),
  geometryQuality: z.enum(["standard", "detailed"]).default("standard"),
  textureAlignment: z
    .enum(["original_image", "geometry"])
    .default("original_image"),
  orientation: z.enum(["default", "align_image"]).default("align_image"),
  autoSize: z.boolean().default(false),
  quad: z.boolean().default(false),
});

export function mapManhua3dTaskError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "manhua3d_service_unavailable") {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "三维生成服务暂未配置，请联系管理员",
    });
  }
  if (message === "manhua3d_task_store_unavailable") {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "三维任务存储暂不可用，请稍后再试",
    });
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "三维资产任务处理失败，请稍后再试",
  });
}

export const manhua3dRouter = router({
  submit: adminProcedure
    .input(
      z.object({
        assetRef: z.string().trim().min(1).max(160),
        sourceVersion: z.string().trim().min(1).max(4_096),
        sourceImageUrl: httpsUrl,
        options: optionsSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createManhua3dTask({
          userId: ctx.user.id,
          assetRef: input.assetRef,
          sourceVersion: input.sourceVersion,
          sourceImageUrl: input.sourceImageUrl,
          options: input.options,
        });
      } catch (error) {
        return mapManhua3dTaskError(error);
      }
    }),

  getStatus: adminProcedure
    .input(z.object({ taskId: z.string().trim().min(8).max(100) }))
    .query(async ({ ctx, input }) => {
      try {
        const task = await getManhua3dTask(input.taskId, ctx.user.id);
        if (!task) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "三维资产任务不存在",
          });
        }
        return task;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        return mapManhua3dTaskError(error);
      }
    }),
});
