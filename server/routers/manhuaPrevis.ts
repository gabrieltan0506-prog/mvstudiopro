import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { manhuaPrevisRequestSchema } from "../../shared/manhuaPrevis";
import {
  getPrevisTask,
  listPrevisTasks,
  submitPrevisTask,
  previsCursorSchema,
  PrevisRejectedError,
} from "../services/manhuaPrevisTask";

async function safely<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error) {
    console.error(
      "[manhua-previs] task operation failed",
      error instanceof Error ? error.message : "unknown"
    );
    // 明确拒绝：任务没建，把原因交给前端并让它放弃该请求编号；歧义失败仍按「保留编号再查」处理。
    if (error instanceof PrevisRejectedError)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `白模未提交：${error.message}`,
      });
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "白模任务暂未确认，请核对配置或查询原任务；不要重复提交",
    });
  }
}
export const manhuaPrevisRouter = router({
  submit: adminProcedure
    .input(manhuaPrevisRequestSchema)
    .mutation(({ ctx, input }) =>
      safely(() => submitPrevisTask(ctx.user.id, input))
    ),
  get: adminProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      safely(() => getPrevisTask(ctx.user.id, input.requestId))
    ),
  list: adminProcedure
    .input(
      z.object({
        scopeId: z.string().uuid(),
        clipId: z.string().min(1).max(160),
        before: previsCursorSchema.optional(),
      })
    )
    .query(({ ctx, input }) =>
      safely(() =>
        listPrevisTasks(ctx.user.id, input.scopeId, input.clipId, input.before)
      )
    ),
});
