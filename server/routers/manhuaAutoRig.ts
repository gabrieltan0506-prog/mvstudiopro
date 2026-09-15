import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { autoRigRequestSchema } from "../../shared/manhuaAutoRig";
import {
  adoptAutoRigTask,
  AutoRigInputError,
  autoRigCursorSchema,
  getAutoRigTask,
  listAutoRigTasks,
  submitAutoRigTask,
} from "../services/manhuaAutoRigTask";

async function safe<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const text = error instanceof Error ? error.message : "";
    throw new TRPCError({
      code:
        error instanceof AutoRigInputError
          ? "BAD_REQUEST"
          : "INTERNAL_SERVER_ERROR",
      message:
        /^[\u4e00-\u9fff]/.test(text) && !text.includes("/")
          ? text
          : "绑骨操作未确认，请查询原任务；原模型保持不变",
    });
  }
}
export const manhuaAutoRigRouter = router({
  submit: adminProcedure
    .input(autoRigRequestSchema)
    .mutation(({ ctx, input }) =>
      safe(() => submitAutoRigTask(ctx.user.id, input))
    ),
  get: adminProcedure
    .input(z.object({ requestId: z.string().uuid() }).strict())
    .query(({ ctx, input }) =>
      safe(() => getAutoRigTask(ctx.user.id, input.requestId))
    ),
  list: adminProcedure
    .input(
      z
        .object({
          assetRef: z.string().trim().min(1).max(160),
          before: autoRigCursorSchema.optional(),
        })
        .strict()
    )
    .query(({ ctx, input }) =>
      safe(() => listAutoRigTasks(ctx.user.id, input.assetRef, input.before))
    ),
  adopt: adminProcedure
    .input(
      z
        .object({
          requestId: z.string().uuid(),
          expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
          qualityReviewed: z.literal(true),
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      safe(() =>
        adoptAutoRigTask(ctx.user.id, input.requestId, input.expectedSha256)
      )
    ),
  restore: adminProcedure
    .input(
      z
        .object({
          requestId: z.string().uuid(),
          expectedSha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      safe(() =>
        adoptAutoRigTask(
          ctx.user.id,
          input.requestId,
          input.expectedSha256,
          true
        )
      )
    ),
});
