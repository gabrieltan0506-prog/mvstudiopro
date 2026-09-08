import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { CanvasDialogueError, canvasDialogueInputSchema, generateCanvasDialogue, getCanvasDialogue, listCanvasDialogue } from "../services/canvasDialogueOperation";

async function safely<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof CanvasDialogueError) throw new TRPCError({
      code: error.kind === "conflict" ? "CONFLICT" : error.kind === "payment" ? "PAYMENT_REQUIRED" : "SERVICE_UNAVAILABLE", message: error.message,
    });
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "配音操作未能确认，请查询原任务，勿重复生成" });
  }
}

export const canvasAudioRouter = router({
  generateDialogue: protectedProcedure.input(canvasDialogueInputSchema).mutation(({ ctx, input }) => safely(() => generateCanvasDialogue(ctx.user.id, input))),
  getDialogue: protectedProcedure.input(z.object({ billingRequestId: z.string().uuid() })).query(({ ctx, input }) => safely(() => getCanvasDialogue(ctx.user.id, input.billingRequestId))),
  listDialogue: protectedProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(30) })).query(({ ctx, input }) => safely(() => listCanvasDialogue(ctx.user.id, input.limit))),
});
