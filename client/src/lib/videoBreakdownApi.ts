/**
 * 拉片接口的唯一入口：页面组件只依赖这里导出的函数。
 * tRPC 路由 videoBreakdown（全部需登录）；路径已在 trpcTransportRouting 中整组直连长请求通道。
 */
import { trpc } from "@/lib/trpc";
import { gcsTransferUrl, isGcsTransferUrl } from "@/lib/gcsTransfer";
import { VIDEO_BREAKDOWN_POLL_MS, isVideoBreakdownActive } from "@/lib/videoBreakdownView";

export function useVideoBreakdownCreateUpload() {
  return trpc.videoBreakdown.createUpload.useMutation();
}

export function useVideoBreakdownStart() {
  return trpc.videoBreakdown.start.useMutation();
}

/** 读取任务；排队/进行中每 3 秒轮询，完成或失败即停。 */
export function useVideoBreakdownJob(jobId: string | null) {
  return trpc.videoBreakdown.get.useQuery(
    { jobId: jobId || "" },
    {
      enabled: !!jobId,
      retry: false,
      refetchOnWindowFocus: false,
      refetchInterval: query => (isVideoBreakdownActive(query.state.data) ? VIDEO_BREAKDOWN_POLL_MS : false),
    },
  );
}

/**
 * 浏览器把文件 PUT 到签名地址：必须带签名时的 Content-Type 与全部 requiredHeaders（大小上限签在链接里，缺头存储拒收）。
 * GCS 地址按站内惯例经鉴权中转（server/routers/gcsTransfer.ts 原样转发 content-type / content-length / x-goog-* 头，签名不变）。
 */
export function putVideoBreakdownFile(params: {
  uploadUrl: string;
  file: Blob;
  contentType: string;
  requiredHeaders?: Record<string, string>;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", gcsTransferUrl(params.uploadUrl), true);
    if (isGcsTransferUrl(params.uploadUrl)) xhr.withCredentials = true;
    for (const [header, value] of videoBreakdownUploadHeaders(params.contentType, params.requiredHeaders)) xhr.setRequestHeader(header, value);
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

/** 上传请求头：Content-Type 用签名时的值；requiredHeaders 全部带上（其中若也有 Content-Type，以签名值为准）。 */
export function videoBreakdownUploadHeaders(contentType: string, requiredHeaders?: Record<string, string>): Array<[string, string]> {
  const extra = Object.entries(requiredHeaders || {}).filter(([key, value]) => key.trim() && typeof value === "string");
  const signedType = extra.find(([key]) => key.toLowerCase() === "content-type")?.[1];
  return [["Content-Type", signedType || contentType], ...extra.filter(([key]) => key.toLowerCase() !== "content-type")];
}
