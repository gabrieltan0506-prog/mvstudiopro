import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { DEPTH_PANO_MAX_WIDTH, DEPTH_PANO_UPLOAD_ENCODING } from "../../shared/manhuaLayoutDepthPano.js";
import { adminProcedure, router } from "../_core/trpc.js";
import {
  createManhuaWorldTask,
  deleteManhuaWorldTask,
  getManhuaWorldTask,
  listManhuaWorldTasks,
  retryManhuaWorldTask,
} from "../services/manhuaWorldTask.js";

const httpsUrl = z
  .string()
  .url()
  .max(4_096)
  .refine((value) => /^https:\/\//i.test(value), "场景图必须使用 HTTPS 地址");

const modelSchema = z.enum(["marble-1.1-plus", "marble-1.1", "marble-1.0", "marble-1.0-draft"]);

const promptSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), textPrompt: z.string().trim().min(2).max(2_000) }),
  z.object({
    type: z.literal("image"),
    isPano: z.union([z.boolean(), z.literal("auto")]).default("auto"),
    textPrompt: z.string().trim().max(2_000).optional(),
  }),
  /** PR-11 布局可控：深度全景（我们渲的，https）+ 必填文字提示 */
  z.object({
    type: z.literal("layout"),
    depthPanoUrl: httpsUrl,
    /** 深度全景的 gs://（签名 url 会过期；重试/对账时重新签） */
    depthPanoGcsUri: z.string().trim().max(2_048).regex(/^gs:\/\//i).optional(),
    /** WL-D01：结构化深度元数据 = API 字段（z_min/z_max）；0<zMin<zMax、2:1、编码固定，坏的在这里就拒 */
    depthMeta: z
      .object({
        width: z.number().int().min(64).max(DEPTH_PANO_MAX_WIDTH),
        height: z.number().int().min(32),
        zMin: z.number().positive(),
        zMax: z.number().positive(),
        encoding: z.literal(DEPTH_PANO_UPLOAD_ENCODING),
      })
      .refine((m) => m.zMax > m.zMin, { message: "z_min 必须小于 z_max" })
      .refine((m) => m.height * 2 === m.width, { message: "深度全景必须是 2:1" }),
    textPrompt: z.string().trim().min(2).max(2_000),
  }),
]);

export function mapManhuaWorldTaskError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "manhua_world_service_unavailable") {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "3D 世界生成服务暂未配置，请联系管理员" });
  }
  if (message === "manhua_world_task_store_unavailable") {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "3D 世界任务存储暂不可用，请稍后再试" });
  }
  if (message === "manhua_world_retry_reconcile_forbidden") {
    throw new TRPCError({ code: "CONFLICT", message: "任务结果仍待核对，为避免重复计费暂不能重试" });
  }
  if (message === "manhua_world_retry_not_failed") {
    throw new TRPCError({ code: "CONFLICT", message: "只有明确失败的 3D 世界任务可以重试" });
  }
  if (message === "manhua_world_delete_busy") {
    throw new TRPCError({ code: "CONFLICT", message: "任务还在进行中，等它结束再删" });
  }
  if (message === "invalid_manhua_world_task_input") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "3D 世界参数无效：需要场景图 https、稳定版本与非空提示" });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "3D 世界任务处理失败，请稍后再试" });
}

export const manhuaWorldRouter = router({
  /** 场景参考图 → Marble 世界（扣上游 credits，价按模型档；同人同图同模型同提示词幂等） */
  submit: adminProcedure
    .input(
      z.object({
        sceneRef: z.string().trim().min(1).max(160),
        sourceVersion: z.string().trim().min(1).max(4_096),
        sourceImageUrl: httpsUrl,
        sourceImageGcsUri: z.string().trim().regex(/^gs:\/\//).max(4_096).optional(),
        displayName: z.string().trim().min(1).max(120),
        model: modelSchema.default("marble-1.1"),
        prompt: promptSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createManhuaWorldTask({ userId: ctx.user.id, ...input });
      } catch (error) {
        return mapManhuaWorldTaskError(error);
      }
    }),
  retry: adminProcedure.input(z.object({ taskId: z.string().trim().min(8).max(100) })).mutation(async ({ ctx, input }) => {
    try {
      const task = await retryManhuaWorldTask(input.taskId, ctx.user.id);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "3D 世界任务不存在" });
      return task;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      return mapManhuaWorldTaskError(error);
    }
  }),
  getStatus: adminProcedure.input(z.object({ taskId: z.string().trim().min(8).max(100) })).query(async ({ ctx, input }) => {
    try {
      const task = await getManhuaWorldTask(input.taskId, ctx.user.id);
      if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "3D 世界任务不存在" });
      return task;
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      return mapManhuaWorldTaskError(error);
    }
  }),
  listMine: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(200).default(50) }).optional()).query(async ({ ctx, input }) => {
    try {
      return await listManhuaWorldTasks(ctx.user.id, input?.limit ?? 50);
    } catch (error) {
      return mapManhuaWorldTaskError(error);
    }
  }),
  remove: adminProcedure.input(z.object({ taskId: z.string().trim().min(8).max(100) })).mutation(async ({ ctx, input }) => {
    try {
      const ok = await deleteManhuaWorldTask(input.taskId, ctx.user.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "3D 世界任务不存在" });
      return { ok: true };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      return mapManhuaWorldTaskError(error);
    }
  }),
});
