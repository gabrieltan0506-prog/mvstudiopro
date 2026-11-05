import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { layoutLibrarySchema } from "../../shared/editableLayout";
import {
  LayoutConflict,
  readLayoutLibrary,
  writeLayoutLibrary,
} from "../services/editableLayoutStore";
export const editableLayoutRouter = router({
  get: protectedProcedure.query(({ ctx }) => readLayoutLibrary(ctx.user.id)),
  save: protectedProcedure
    .input(
      z
        .object({
          library: layoutLibrarySchema,
          expectedGeneration: z.string().regex(/^\d+$/),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await writeLayoutLibrary(
          ctx.user.id,
          input.library,
          input.expectedGeneration
        );
      } catch (e) {
        throw new TRPCError({
          code:
            e instanceof LayoutConflict ? "CONFLICT" : "SERVICE_UNAVAILABLE",
          message: e instanceof Error ? e.message : "排版稿保存失败",
        });
      }
    }),
});
