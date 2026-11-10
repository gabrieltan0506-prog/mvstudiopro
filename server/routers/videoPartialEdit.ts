import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure } from "../_core/trpc.js";
import { videoPartialEditQuoteInputSchema, videoPartialEditRequestSchema } from "../../shared/videoEditPricing.js";
import { hasUnlimitedAccess } from "../services/access-policy.js";

/** 业务友好句原样透出；含技术痕迹的报错收敛为中性句，原文只进日志。 */
async function result<T>(call: () => Promise<T>): Promise<T> {
  try { return await call(); } catch (error) {
    console.error("[videoPartialEdit]", error);
    const message = error instanceof Error ? error.message : "";
    throw new TRPCError({ code: "BAD_REQUEST", message: /^[一-鿿]/.test(message) && !/[{}]|sql|postgres|token|https?:|gs:\/\//i.test(message) ? message : "片段修改暂不可用，请稍后重试" });
  }
}
const waived = (user: { role?: string | null; email?: string | null }) => hasUnlimitedAccess(user);

/** 视频局部修改：只读报价（不扣费）+ 下单（预扣、失败全退）；结果沿用 getPostProdJob 轮询。 */
export const videoPartialEditProcedures = {
  quoteVideoPartialEdit: protectedProcedure.input(videoPartialEditQuoteInputSchema).query(({ ctx, input }) => result(async () => {
    const { quoteVideoPartialEdit, toPublicVideoEditQuote } = await import("../services/videoPartialEdit.js");
    return toPublicVideoEditQuote(await quoteVideoPartialEdit(String(ctx.user.id), waived(ctx.user), input));
  })),
  queueVideoPartialEdit: protectedProcedure.input(videoPartialEditRequestSchema).mutation(({ ctx, input }) => result(async () => {
    const { queueVideoPartialEdit } = await import("../services/videoPartialEdit.js");
    return queueVideoPartialEdit(String(ctx.user.id), waived(ctx.user), input);
  })),
  /**
   * 按 requestId 查本人的局部修改任务（只读、不扣费、不入队）：前端在入队回执前刷新、只剩 requestId 时续查。
   * 回包与 getPostProdJob 同形（含 jobId）；确实无记录才 NOT_FOUND，查询失败抛错交客户端下一轮重试。
   */
  findVideoPartialEditJob: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const { findVideoPartialEditJobByRequest } = await import("../services/videoPartialEdit.js");
      const row = await findVideoPartialEditJobByRequest(String(ctx.user.id), input.requestId);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "片段修改任务不存在" });
      const { buildPostProdJobResponse } = await import("../services/postProdJobResponse.js");
      return buildPostProdJobResponse(row as Parameters<typeof buildPostProdJobResponse>[0]);
    }),
};
