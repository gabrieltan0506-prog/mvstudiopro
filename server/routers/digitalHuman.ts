import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { digitalHumanSceneInputSchema } from "../../shared/digitalHumanStudio";
import {
  queueDigitalHumanScene,
  getDigitalHumanScene,
} from "../services/digitalHumanScene";

import { findExistingManhuaWorldImageTask } from "../services/manhuaWorldTask";
import {
  findExistingManhua3dImageTask,
  readExistingManhua3dTask,
} from "../services/manhua3dTask";

export const digitalHumanRouter = router({
  getModel: adminProcedure
    .input(z.object({ taskId: z.string().trim().min(8).max(100) }))
    .query(({ ctx, input }) =>
      readExistingManhua3dTask(input.taskId, ctx.user.id)
    ),
  getExistingWorld: adminProcedure
    .input(
      z.object({
        sceneRef: z.string().trim().min(1).max(160),
        sourceVersion: z.string().trim().min(1).max(4096),
        model: z.enum([
          "marble-1.1-plus",
          "marble-1.1",
          "marble-1.0",
          "marble-1.0-draft",
        ]),
        textPrompt: z.string().max(2000),
      })
    )
    .query(({ ctx, input }) =>
      findExistingManhuaWorldImageTask({
        userId: ctx.user.id,
        sceneRef: input.sceneRef,
        sourceVersion: input.sourceVersion,
        model: input.model,
        prompt: { type: "image", isPano: false, textPrompt: input.textPrompt },
      })
    ),
  getExistingModel: adminProcedure
    .input(
      z.object({
        assetRef: z.string().trim().min(1).max(160),
        sourceVersion: z.string().trim().min(1).max(4096),
      })
    )
    .query(({ ctx, input }) =>
      findExistingManhua3dImageTask({ userId: ctx.user.id, ...input })
    ),
  getScene: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      getDigitalHumanScene(ctx.user.id, input.requestId)
    ),
  createScene: protectedProcedure
    .input(digitalHumanSceneInputSchema)
    .mutation(({ ctx, input }) => queueDigitalHumanScene(ctx.user.id, input)),
});
