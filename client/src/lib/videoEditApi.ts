/**
 * 视频局部修改的 trpc 薄封装：类型全部由 AppRouter 推断（不再手写接口形状、不强转）。
 * 服务端约定不变：mvAnalysis.quoteVideoPartialEdit（只读报价）/ queueVideoPartialEdit（下单）/ getPostProdJob（轮询）。
 */
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { readVideoEditJob } from "@/lib/videoEditSubmit";

type MvAnalysisInputs = inferRouterInputs<AppRouter>["mvAnalysis"];
type MvAnalysisOutputs = inferRouterOutputs<AppRouter>["mvAnalysis"];

export type VideoEditQuoteQueryInput = MvAnalysisInputs["quoteVideoPartialEdit"];
export type VideoEditServerQuote = MvAnalysisOutputs["quoteVideoPartialEdit"];
export type VideoEditQueueInput = MvAnalysisInputs["queueVideoPartialEdit"];
export type VideoEditQueueOutput = MvAnalysisOutputs["queueVideoPartialEdit"];
export type VideoEditJobOutput = MvAnalysisOutputs["getPostProdJob"];

export const VIDEO_EDIT_POLL_MS = 4000;

/** 只读报价（不扣费）：区间稳定后才 enabled；失败不自动重试，由面板给「重试」。 */
export function useVideoEditQuoteQuery(input: VideoEditQuoteQueryInput, enabled: boolean) {
  return trpc.mvAnalysis.quoteVideoPartialEdit.useQuery(input, { enabled, retry: false });
}

/** 下单（预扣、失败全退）。 */
export function useVideoEditQueueMutation() {
  return trpc.mvAnalysis.queueVideoPartialEdit.useMutation();
}

/** 任务轮询：进行中每 4 秒一次，成功/失败即停。 */
export function useVideoEditJobQuery(jobId: string) {
  return trpc.mvAnalysis.getPostProdJob.useQuery(
    { jobId },
    {
      enabled: Boolean(jobId),
      refetchInterval: query => ((readVideoEditJob(query.state.data)?.status ?? "active") === "active" ? VIDEO_EDIT_POLL_MS : false),
    }
  );
}
