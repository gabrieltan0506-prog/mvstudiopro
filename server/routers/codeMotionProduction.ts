import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { inkSource } from "../services/inkFreeQuota";
import {
  ensureCodeMotionProductionGrant,
  getCodeMotionProductionGrant,
} from "../services/codeMotionProductionGrant";
import {
  prepareCodeMotionProductionVideo,
  submitCodeMotionProductionVideo,
  listCodeMotionProductionVideo,
  adoptCodeMotionProductionVideo,
} from "../services/codeMotionProductionVideo";
import {
  codeMotionRevisionInputSchema,
  quoteCodeMotionRevision,
  prepareCodeMotionRevision,
  submitCodeMotionRevision,
} from "../services/codeMotionRevision";
const project = z.object({ projectId: z.string().uuid() });
const version = project.extend({
  expectedGeneration: z.string().regex(/^\d+$/),
});
export const codeMotionProductionRouter = router({
  revisionQuote: protectedProcedure
    .input(project)
    .query(({ ctx, input }) =>
      quoteCodeMotionRevision(String(ctx.user.id), input.projectId)
    ),
  revisionPrepare: protectedProcedure
    .input(codeMotionRevisionInputSchema)
    .mutation(({ ctx, input }) =>
      prepareCodeMotionRevision(String(ctx.user.id), input)
    ),
  revisionSubmit: protectedProcedure
    .input(codeMotionRevisionInputSchema)
    .mutation(({ ctx, input }) =>
      submitCodeMotionRevision(String(ctx.user.id), input)
    ),
  grant: protectedProcedure
    .input(project)
    .query(({ ctx, input }) =>
      getCodeMotionProductionGrant(String(ctx.user.id), input.projectId)
    ),
  start: protectedProcedure.input(version).mutation(({ ctx, input }) =>
    ensureCodeMotionProductionGrant(String(ctx.user.id), {
      ...input,
      source: inkSource(ctx.req),
    })
  ),
  prepare: protectedProcedure
    .input(version)
    .query(({ ctx, input }) =>
      prepareCodeMotionProductionVideo(String(ctx.user.id), input)
    ),
  submit: protectedProcedure
    .input(
      version.extend({
        confirmedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      })
    )
    .mutation(({ ctx, input }) =>
      submitCodeMotionProductionVideo(String(ctx.user.id), input, ctx.req)
    ),
  list: protectedProcedure
    .input(project)
    .query(({ ctx, input }) =>
      listCodeMotionProductionVideo(String(ctx.user.id), input.projectId)
    ),
  adopt: protectedProcedure
    .input(project.extend({ sceneIndex: z.number().int().min(0).max(5) }))
    .mutation(({ ctx, input }) =>
      adoptCodeMotionProductionVideo(
        String(ctx.user.id),
        input.projectId,
        input.sceneIndex
      )
    ),
});
