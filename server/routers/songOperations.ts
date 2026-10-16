import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { songOperationPrepareSchema, songOperationConfirmSchema } from "../../shared/songOperations";
import { prepareSongOperation, submitSongOperation, getSavedSongOperation, resumeSongOperation } from "../services/songOperations";

export const songOperationsRouter = router({
  prepare: protectedProcedure.input(songOperationPrepareSchema).mutation(({ctx, input}) => prepareSongOperation(ctx.user.id, input)),
  submit: protectedProcedure.input(songOperationConfirmSchema).mutation(({ctx, input}) => submitSongOperation(ctx.user.id, input)),
  get: protectedProcedure.input(z.object({requestId:z.string().uuid()}).strict()).query(async ({ctx, input}) => {
    const result = await getSavedSongOperation(ctx.user.id, input.requestId);
    if (!result) throw new TRPCError({code:"NOT_FOUND",message:"歌曲操作不存在或不属于当前账号"});
    return result;
  }),
  resume: protectedProcedure.input(z.object({requestId:z.string().uuid()}).strict()).mutation(({ctx, input}) => resumeSongOperation(ctx.user.id, input.requestId)),
});
