import { TRPCError } from "@trpc/server";
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
};
