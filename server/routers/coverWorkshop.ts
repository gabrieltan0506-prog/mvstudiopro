import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { coverRequestSchema } from "../../shared/coverWorkshop";
import {
  prepareCover,
  submitCover,
  getCover,
  listCovers,
  recoverCover,
} from "../services/coverWorkshop";
const identity = z.object({ id: z.string().uuid() });
export const coverWorkshopRouter = router({
  prepare: protectedProcedure
    .input(coverRequestSchema)
    .mutation(async ({ ctx, input }) => {
      await prepareCover(String(ctx.user.id), input);
      return getCover(String(ctx.user.id), input.id);
    }),
  submit: protectedProcedure
    .input(identity.extend({ fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }))
    .mutation(({ ctx, input }) =>
      submitCover(String(ctx.user.id), input.id, input.fingerprint)
    ),
  get: protectedProcedure
    .input(identity)
    .query(({ ctx, input }) => getCover(String(ctx.user.id), input.id)),
  list: protectedProcedure
    .input(z.object({ accountId: z.string() }))
    .query(({ ctx, input }) => {
      if (input.accountId !== String(ctx.user.id))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "账号已切换，请刷新当前账号的封面记录",
        });
      return listCovers(String(ctx.user.id));
    }),
  recover: protectedProcedure
    .input(identity.extend({ index: z.number().int().min(0).max(2) }))
    .mutation(({ ctx, input }) =>
      recoverCover(String(ctx.user.id), input.id, input.index)
    ),
});
