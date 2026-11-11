/**
 * 拉片接口的唯一入口：页面组件只依赖这里导出的强类型函数。
 * tRPC 路由 videoBreakdown（全部需登录）由服务端另行实现；路径已在 trpcTransportRouting 中直连长请求通道。
 */
import { trpc } from "@/lib/trpc";
import { gcsTransferUrl, isGcsTransferUrl } from "@/lib/gcsTransfer";
import type { VideoBreakdownJobView } from "@shared/videoBreakdown";
import { VIDEO_BREAKDOWN_POLL_MS, isVideoBreakdownActive } from "@/lib/videoBreakdownView";

export type VideoBreakdownCreateUploadInput = { fileName: string; contentType: string; bytes: number };
export type VideoBreakdownCreateUploadOutput = { uploadUrl: string; gcsUri: string };
export type VideoBreakdownStartInput = { gcsUri: string; requestId: string };
export type VideoBreakdownStartOutput = { jobId: string };

type Mutation<I, O> = { useMutation: () => { mutateAsync: (input: I) => Promise<O>; isPending: boolean } };
type JobQueryResult = { data?: VideoBreakdownJobView; error: unknown; isLoading: boolean; refetch: () => Promise<unknown> };
type VideoBreakdownRouterClient = {
  createUpload: Mutation<VideoBreakdownCreateUploadInput, VideoBreakdownCreateUploadOutput>;
  start: Mutation<VideoBreakdownStartInput, VideoBreakdownStartOutput>;
  get: {
    useQuery: (
      input: { jobId: string },
      options: { enabled: boolean; retry: boolean; refetchOnWindowFocus: boolean; refetchInterval: (query: { state: { data?: VideoBreakdownJobView } }) => number | false },
    ) => JobQueryResult;
  };
};

// 服务端合入后去掉断言：此刻 AppRouter 里还没有 videoBreakdown，类型缺口只在这一行隔开（运行时 tRPC 代理按路径名调用，不受影响）。
const videoBreakdownClient = (trpc as unknown as { videoBreakdown: VideoBreakdownRouterClient }).videoBreakdown;

export function useVideoBreakdownCreateUpload() {
  return videoBreakdownClient.createUpload.useMutation();
}

export function useVideoBreakdownStart() {
  return videoBreakdownClient.start.useMutation();
}

/** 读取任务；排队/进行中每 3 秒轮询，完成或失败即停。 */
export function useVideoBreakdownJob(jobId: string | null): JobQueryResult {
  return videoBreakdownClient.get.useQuery(
    { jobId: jobId || "" },
    {
      enabled: !!jobId,
      retry: false,
      refetchOnWindowFocus: false,
      refetchInterval: query => (isVideoBreakdownActive(query.state.data) ? VIDEO_BREAKDOWN_POLL_MS : false),
    },
  );
}

/** 浏览器把文件 PUT 到签名地址（带同样的 Content-Type）；GCS 地址按站内惯例经鉴权中转，签名不变。 */
export function putVideoBreakdownFile(params: { uploadUrl: string; file: Blob; contentType: string; onProgress?: (fraction: number) => void; signal?: AbortSignal }): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", gcsTransferUrl(params.uploadUrl), true);
    if (isGcsTransferUrl(params.uploadUrl)) xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", params.contentType);
    xhr.upload.onprogress = event => {
      if (event.lengthComputable && event.total > 0) params.onProgress?.(Math.min(1, event.loaded / event.total));
    };
    xhr.onerror = () => reject(new Error("上传中断，请检查网络后重试。"));
    xhr.onabort = () => reject(new Error("上传已取消。"));
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("视频上传未完成，请重试。")));
    params.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(params.file);
  });
}
