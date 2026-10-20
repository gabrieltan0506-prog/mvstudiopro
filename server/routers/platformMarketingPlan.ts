import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure } from "../_core/trpc.js";
import { marketingContextSchema } from "../../shared/marketingPlan.js";
import { enqueueMarketingPlan, getMarketingPlan, marketingPlanQuota, retryMarketingPlan } from "../jobs/platformMarketingPlan.js";

import { publicMarketingPlan, marketingPublicError } from "../../shared/marketingPlanDisplay.js";

const exempt = (role: string) => role === "admin" || role === "supervisor";
/** 只返回可读业务错误，不把数据库或供应商原始响应带到浏览器。 */
async function userResult<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new TRPCError({ code: "BAD_REQUEST", message: marketingPublicError(message, "营销方案服务暂不可用，已保存的结果不会丢失。") });
  }
}
export const marketingPlanProcedures = {
  platformMarketingPlanQuota: protectedProcedure.input(z.object({ scope: z.string().max(64) })).query(({ ctx }) => userResult(() => marketingPlanQuota(ctx.user.id, exempt(ctx.user.role)))),
  enqueuePlatformMarketingPlan: protectedProcedure.input(z.object({ context: marketingContextSchema, expectedCredits: z.number().int().nonnegative() }))
    .mutation(({ ctx, input }) => userResult(() => enqueueMarketingPlan(ctx.user.id, exempt(ctx.user.role), input.context, input.expectedCredits))),
  getPlatformMarketingPlan: protectedProcedure.input(z.object({ jobId: z.string().min(1).max(64).optional(), scope: z.string().max(64) }))
    .query(({ ctx, input }) => userResult(async () => {
      const saved = await getMarketingPlan(ctx.user.id, input?.jobId);
      return saved ? { jobId: saved.jobId, status: saved.status, result: publicMarketingPlan(saved.result) } : null;
    })),
  retryPlatformMarketingPlan: protectedProcedure.input(z.object({ jobId: z.string().min(1).max(64), step: z.enum(["deepseek", "glm", "integrated", "settle", "resume"]) }))
    .mutation(({ ctx, input }) => userResult(() => retryMarketingPlan(ctx.user.id, input.jobId, input.step))),
};
