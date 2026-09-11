import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { manhuaPrevisRequestSchema } from "../../shared/manhuaPrevis";
import {
  getPrevisTask,
  listPrevisTasks,
  submitPrevisTask,
  previsCursorSchema,
} from "../services/manhuaPrevisTask";

async function safely<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error) {
    console.error(
      "[manhua-previs] task operation failed",
      error instanceof Error ? error.message : "unknown"
    );
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
