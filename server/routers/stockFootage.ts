import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { STOCK_FOOTAGE_PURPOSES, stockFootageAdoptInputSchema, stockFootageSearchInputSchema } from "../../shared/stockFootage";
import { stockFootageSuggestKeywordsInputSchema } from "../../shared/stockFootageKeywords";
import { protectedProcedure, router } from "../_core/trpc";
import { adoptStockFootage, getStockAdoption, listStockAdoptions } from "../services/stockFootage/adoption";
import { assertStockKeywordQuota, suggestStockKeywords } from "../services/stockFootage/keywords";
import { StockFootageError, searchPexels } from "../services/stockFootage/pexelsClient";

async function safely<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    if (error instanceof StockFootageError) {
      const code =
        error.kind === "not_configured" ? "PRECONDITION_FAILED"
        : error.kind === "rate_limited" ? "TOO_MANY_REQUESTS"
        : error.kind === "not_found" ? "NOT_FOUND"
        : error.kind === "conflict" ? "CONFLICT"
        : error.kind === "invalid" || error.kind === "too_large" ? "BAD_REQUEST"
        : "SERVICE_UNAVAILABLE";
      throw new TRPCError({ code, message: error.message });
    }
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "素材服务暂不可用，请稍后再试" });
  }
}

export const stockFootageRouter = router({
  /** 服务端代查 Pexels；只返回预览候选，不入库。 */
  search: protectedProcedure.input(stockFootageSearchInputSchema).query(({ input }) => safely(() => searchPexels(input))),
  /** 镜头/段落中文描述 → 英文搜索词（LLM 优先、规则兜底，不计费）；每用户每分钟 ≤30 次。 */
  suggestKeywords: protectedProcedure
    .input(stockFootageSuggestKeywordsInputSchema)
    .query(({ ctx, input }) =>
      safely(async () => {
        assertStockKeywordQuota(ctx.user.id);
        return suggestStockKeywords(input);
      })
    ),
  /** 采用：幂等（requestId），断线后用同一编号再次调用即续做。 */
  adopt: protectedProcedure.input(stockFootageAdoptInputSchema).mutation(({ ctx, input }) => safely(() => adoptStockFootage(ctx.user.id, input))),
  getAdoption: protectedProcedure
    .input(z.object({ requestId: z.string().uuid() }).strict())
    .query(({ ctx, input }) => safely(() => getStockAdoption(ctx.user.id, input.requestId))),
  listAdoptions: protectedProcedure
    .input(
      z.object({
        purpose: z.enum(STOCK_FOOTAGE_PURPOSES).optional(),
        projectId: z.string().trim().min(1).max(200).optional(),
        limit: z.number().int().min(1).max(100).default(30),
      }).strict()
    )
    .query(({ ctx, input }) => safely(() => listStockAdoptions(ctx.user.id, input))),
});
