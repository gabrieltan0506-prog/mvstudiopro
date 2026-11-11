/**
 * 1111 拉片（视频创作拆解）tRPC 路由：契约见 shared/videoBreakdown.ts，实现见 server/services/videoBreakdown.ts。
 * 全部 protectedProcedure；归属按本人前缀核验（上传对象 uploads/u<uid>/video-breakdown/…，任务 video-breakdown/<uid>/<jobId>/…）。
 * 计费：CREDIT_COSTS.videoBreakdown（占位 20 积分/次，待用户定价）；管理员/supervisor 0 扣；失败全额退；同 requestId 幂等。
 */
import { TRPCError } from "@trpc/server";
import type { VideoBreakdownJobView } from "../../shared/videoBreakdown";
import { protectedProcedure, router } from "../_core/trpc";
import {
  VideoBreakdownError,
  createVideoBreakdownUpload,
  getVideoBreakdown,
  startVideoBreakdown,
  videoBreakdownCreateUploadInputSchema,
  videoBreakdownGetInputSchema,
  videoBreakdownStartInputSchema,
} from "../services/videoBreakdown";

/** 业务错误原样给前台（文案已是业务句）；其余一律通用句，原始错误只进服务端日志。 */
function toTrpcError(error: unknown, scope: string): TRPCError {
  if (error instanceof TRPCError) return error;
  if (error instanceof VideoBreakdownError) return new TRPCError({ code: error.code, message: error.message });
  console.error(`[videoBreakdown] ${scope}_error`, error instanceof Error ? error.name : "error");
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "拉片暂不可用，请稍后重试" });
}

export const videoBreakdownRouter = router({
  /** 签名直传：返回 { uploadUrl, gcsUri, requiredHeaders?, contentType }；PUT 时须带 Content-Type 与 requiredHeaders（大小上限签在链接里）。 */
  createUpload: protectedProcedure
    .input(videoBreakdownCreateUploadInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await createVideoBreakdownUpload(ctx.user, input);
      } catch (error) {
        throw toTrpcError(error, "create_upload");
      }
    }),
  /** 开单（幂等：同 requestId 返回同一 jobId，不重复扣费）；后台执行，不阻塞请求。 */
  start: protectedProcedure
    .input(videoBreakdownStartInputSchema)
    .mutation(async ({ ctx, input }): Promise<{ jobId: string }> => {
      try {
        const { jobId } = await startVideoBreakdown(ctx.user, input);
        return { jobId };
      } catch (error) {
        throw toTrpcError(error, "start");
      }
    }),
  /** 查询：片段与原片地址每次现签（1 小时）。 */
  get: protectedProcedure
    .input(videoBreakdownGetInputSchema)
    .query(async ({ ctx, input }): Promise<VideoBreakdownJobView> => {
      try {
        return await getVideoBreakdown(ctx.user, input);
      } catch (error) {
        throw toTrpcError(error, "get");
      }
    }),
});
