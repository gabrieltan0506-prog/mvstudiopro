import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure } from "../_core/trpc.js";
import { coverCandidateRequest, enqueueCoverCandidates, getCoverCandidates, selectCoverCandidate, resumeCoverCandidates } from "../jobs/platformCoverCandidates.js";

async function result<T>(call: () => Promise<T>): Promise<T> {
  try { return await call(); } catch (error) {
    console.error("[platformCoverCandidates]", error);
    const message = error instanceof Error ? error.message : "";
    throw new TRPCError({ code: "BAD_REQUEST", message: /^[\u4e00-\u9fff]/.test(message) && !/[{}]|sql|postgres|token|https?:/i.test(message) ? message : "封面处理暂不可用，已保存的候选不会丢失" });
  }
}
export const coverCandidateProcedures = {
  enqueuePlatformCoverCandidates: protectedProcedure.input(coverCandidateRequest).mutation(({ ctx, input }) => result(() => enqueueCoverCandidates(ctx.user.id, ctx.user.role === "admin" || ctx.user.role === "supervisor", input))),
  getPlatformCoverCandidates: protectedProcedure.input(z.object({ sceneId: z.string().min(1).max(128) })).query(({ ctx, input }) => result(() => getCoverCandidates(ctx.user.id, input.sceneId))),
  selectPlatformCoverCandidate: protectedProcedure.input(z.object({ jobId: z.string().min(1).max(64), candidateId: z.enum(["story", "subject", "space"]) })).mutation(({ ctx, input }) => result(() => selectCoverCandidate(ctx.user.id, input.jobId, input.candidateId))),
  resumePlatformCoverCandidates: protectedProcedure.input(z.object({ jobId: z.string().min(1).max(64) })).mutation(({ ctx, input }) => result(() => resumeCoverCandidates(ctx.user.id, input.jobId))),
};
