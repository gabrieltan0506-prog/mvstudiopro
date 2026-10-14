import { z } from "zod";
import { digitalHumanProductionRequestSchema } from "../../shared/digitalHumanProduction";
import { queueDigitalHumanProduction, getDigitalHumanProduction } from "../services/digitalHumanProductionTask";
import { TRPCError } from "@trpc/server";
import { digitalHumanDraftSchema } from "../../shared/digitalHumanStudio";
import { DigitalHumanDraftConflict, readDigitalHumanCloudDraft, writeDigitalHumanCloudDraft } from "../services/digitalHumanDraftStore";
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
  queueProduction: protectedProcedure.input(digitalHumanProductionRequestSchema).mutation(({ ctx, input }) => queueDigitalHumanProduction(ctx.user.id, input)),
  getProduction: protectedProcedure.input(z.object({ requestId: z.string().uuid() }).strict()).query(({ ctx, input }) => getDigitalHumanProduction(ctx.user.id, input.requestId)),
  getDraft: protectedProcedure.query(({ ctx }) => readDigitalHumanCloudDraft(ctx.user.id)),
  saveDraft: protectedProcedure.input(z.object({ draft: digitalHumanDraftSchema, expectedGeneration: z.string().regex(/^\d+$/) }).strict())
    .mutation(async ({ ctx, input }) => {
      try { return await writeDigitalHumanCloudDraft(ctx.user.id, input.draft, input.expectedGeneration); }
      catch (e) { throw new TRPCError({ code: e instanceof DigitalHumanDraftConflict ? "CONFLICT" : "SERVICE_UNAVAILABLE", message: e instanceof Error ? e.message : "数字人稿件保存失败" }); }
    }),
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
