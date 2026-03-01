import Navbar from "@/components/Navbar";
import { createJob, getJob, type JobStatus } from "@/lib/jobs";
import { useAuth } from "@/_core/hooks/useAuth";
import { Loader2, Download, Image as ImageIcon, Video, PlayCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type ImageEngine = "free" | "pro" | "kling_image";
type VideoProvider = "kling_beijing" | "veo_3_1" | "seedance";
type VideoTaskState = "idle" | "queued" | "submitted" | "processing" | "succeed" | "failed";

function statusClass(status: VideoTaskState) {
  if (status === "succeed") return "text-green-400";
  if (status === "failed") return "text-red-400";
  if (status === "processing" || status === "submitted") return "text-blue-400";
  if (status === "queued") return "text-yellow-400";
  return "text-gray-400";
}

export default function TestLab() {
  const [authOk, setAuthOk] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setAuthOk(!!d?.ok))
      .catch(() => setAuthOk(false));
  }, []);

  const { user, isAuthenticated, loading } = useAuth();
  const [imagePrompt, setImagePrompt] = useState("一位未来感女性角色，电影级布光，细节清晰");
  const [imageEngine, setImageEngine] = useState<ImageEngine>("free");
  const [imageLoading, setImageLoading] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);

  const [videoPrompt, setVideoPrompt] = useState("城市夜景中，角色缓慢走近镜头，电影质感");
  const [videoProvider, setVideoProvider] = useState<VideoProvider>("kling_beijing");
  const [videoTaskId, setVideoTaskId] = useState<string>("");
  const [videoStatus, setVideoStatus] = useState<VideoTaskState>("idle");
  const [videoError, setVideoError] = useState<string>("");
  const videoPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  if (authOk === null) {
    return <div className="p-6">加载中…</div>;
  }
  if (!authOk) {
    return <div className="p-6 text-red-600">请先登录</div>;
  }

  const videoShortUrl = useMemo(() => {
    if (!videoTaskId) return "";
    return `/api/v/${encodeURIComponent(videoTaskId)}`;
  }, [videoTaskId]);

  const stopPolling = useCallback(() => {
    if (videoPollRef.current) {
      clearInterval(videoPollRef.current);
      videoPollRef.current = null;
    }
  }, []);

  const startVideoPolling = useCallback((taskId: string) => {
    stopPolling();
    videoPollRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/jobs?task_id=${encodeURIComponent(taskId)}`, {
          method: "GET",
          credentials: "include",
        });
        const data = (await response.json().catch(() => ({}))) as any;
        const status = String(data?.status || data?.task_status || "");

        if (status === "succeed") {
          setVideoStatus("succeed");
          stopPolling();
          return;
        }
        if (status === "failed") {
          setVideoStatus("failed");
          setVideoError(String(data?.error || data?.task_status_msg || "任务失败"));
          stopPolling();
          return;
        }
        if (status === "processing") {
          setVideoStatus("processing");
          return;
        }
        if (status === "submitted") {
          setVideoStatus("submitted");
          return;
        }
        setVideoStatus("queued");
      } catch (error: any) {
        setVideoStatus("failed");
        setVideoError(error?.message || "轮询失败");
        stopPolling();
      }
    }, 2500);
  }, [stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleGenerateImage = useCallback(async () => {
    if (!imagePrompt.trim()) {
      toast.error("请输入图像提示词");
      return;
    }
    if (!isAuthenticated || !user?.id) {
      toast.error("请先通过右上角登录（Dev Admin）后再测试");
      return;
    }

    setImageLoading(true);
    setImageUrls([]);
    try {
      const input =
        imageEngine === "kling_image"
          ? {
              action: "kling_image",
              params: {
                prompt: imagePrompt.trim(),
                model: "kling-v2-1",
                resolution: "1k",
                aspectRatio: "1:1",
                count: 1,
              },
            }
          : {
              action: "virtual_idol",
              params: {
                style: "realistic",
                gender: "neutral",
                description: imagePrompt.trim(),
                quality: imageEngine === "free" ? "free" : "2k",
              },
            };

      const { jobId } = await createJob({
        type: "image",
        userId: String(user.id),
        input,
      } as any);

      const startedAt = Date.now();
      while (Date.now() - startedAt < 120000) {
        const job = await getJob(jobId);
        const status = String(job.status || "") as JobStatus;
        if (status === "succeeded") {
          const urls = Array.isArray((job.output as any)?.images)
            ? ((job.output as any).images as string[])
            : typeof (job.output as any)?.imageUrl === "string"
            ? [String((job.output as any).imageUrl)]
            : [];
          setImageUrls(urls);
          setImageLoading(false);
          return;
        }
        if (status === "failed") {
          throw new Error(String(job.error || "图像生成失败"));
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error("图像任务超时");
    } catch (error: any) {
      setImageLoading(false);
      toast.error(error?.message || "图像生成失败");
    }
  }, [imageEngine, imagePrompt, isAuthenticated, user?.id]);

  const handleGenerateVideo = useCallback(async () => {
    if (!videoPrompt.trim()) {
      toast.error("请输入视频提示词");
      return;
    }

    setVideoStatus("queued");
    setVideoError("");
    setVideoTaskId("");
    stopPolling();

    try {
      const response = await fetch(`/api/jobs?provider=${encodeURIComponent(videoProvider)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          prompt: videoPrompt.trim(),
          duration: "10",
          aspectRatio: "21:9",
          mode: "pro",
          resolution: "1080p",
        }),
      });
      const data = (await response.json().catch(() => ({}))) as any;
      if (!response.ok) {
        throw new Error(String(data?.error || `请求失败 (${response.status})`));
      }
      const taskId = String(data?.task_id || data?.taskId || "").trim();
      if (!taskId) {
        throw new Error("未返回 task_id");
      }

      setVideoTaskId(taskId);
      setVideoStatus("submitted");
      startVideoPolling(taskId);
    } catch (error: any) {
      setVideoStatus("failed");
      setVideoError(error?.message || "视频任务提交失败");
    }
  }, [videoPrompt, videoProvider, startVideoPolling, stopPolling]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Navbar />
      <main className="container mx-auto px-4 pt-24 pb-12 space-y-8">
        <section>
          <h1 className="text-3xl font-bold">一键测试台</h1>
          <p className="text-sm text-gray-400 mt-2">用于快速验收图像与视频生成链路，不影响核心业务逻辑。</p>
          {!loading && !isAuthenticated && (
            <p className="mt-3 text-sm text-amber-400">当前未登录，图像测试需要登录后才能提交任务。</p>
          )}
        </section>

        <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 space-y-4">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <ImageIcon className="h-5 w-5 text-cyan-400" />
              <span>图像测试（nano-banana-flash 1K）</span>
            </div>
            <textarea
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              rows={4}
              className="w-full rounded-md bg-gray-950 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-cyan-500"
              placeholder="输入图像提示词"
            />
            <div className="flex items-center gap-3">
              <select
                value={imageEngine}
                onChange={(e) => setImageEngine(e.target.value as ImageEngine)}
                className="rounded-md bg-gray-950 border border-gray-700 px-3 py-2 text-sm"
              >
                <option value="free">免费（nano-banana-flash）</option>
                <option value="pro">付费（nano-banana-pro）</option>
                <option value="kling_image">付费（kling_image）</option>
              </select>
              <button
                onClick={handleGenerateImage}
                disabled={imageLoading}
                className="inline-flex items-center gap-2 rounded-md bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 px-4 py-2 text-sm font-medium"
              >
                {imageLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                生成图像
              </button>
            </div>
            {imageEngine === "free" && (
              <p className="text-xs text-amber-300">免费模式可能带浮水印（用于验收流程）。</p>
            )}

            <div className="space-y-2">
              <p className="text-sm text-gray-300">结果</p>
              {imageUrls.length === 0 ? (
                <div className="rounded-md border border-dashed border-gray-700 p-4 text-sm text-gray-500">暂无结果</div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {imageUrls.map((url) => (
                    <div key={url} className="rounded-md border border-gray-800 overflow-hidden bg-black">
                      <img src={url} alt="生成结果" className="w-full h-36 object-cover" />
                      <a
                        href={url}
                        download
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-center gap-1 text-xs py-2 border-t border-gray-800 hover:bg-gray-800"
                      >
                        <Download className="h-3.5 w-3.5" />
                        下载
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 space-y-4">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Video className="h-5 w-5 text-fuchsia-400" />
              <span>视频测试（Kling / Veo / Seedance）</span>
            </div>
            <textarea
              value={videoPrompt}
              onChange={(e) => setVideoPrompt(e.target.value)}
              rows={4}
              className="w-full rounded-md bg-gray-950 border border-gray-700 px-3 py-2 text-sm focus:outline-none focus:border-fuchsia-500"
              placeholder="输入视频提示词"
            />
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={videoProvider}
                onChange={(e) => setVideoProvider(e.target.value as VideoProvider)}
                className="rounded-md bg-gray-950 border border-gray-700 px-3 py-2 text-sm"
              >
                <option value="kling_beijing">Kling</option>
                <option value="veo_3_1">Veo3.1（若已接）</option>
                <option value="seedance">Seedance（若已接）</option>
              </select>
              <span className="text-xs text-gray-400">默认：21:9 / 10秒 / 1080p</span>
              <button
                onClick={handleGenerateVideo}
                className="inline-flex items-center gap-2 rounded-md bg-fuchsia-600 hover:bg-fuchsia-500 px-4 py-2 text-sm font-medium"
              >
                <PlayCircle className="h-4 w-4" />
                生成视频
              </button>
            </div>

            <div className="rounded-md border border-gray-800 bg-gray-950/60 p-3 space-y-1">
              <p className="text-sm">
                状态：
                <span className={`ml-2 font-semibold ${statusClass(videoStatus)}`}>{videoStatus}</span>
              </p>
              {videoTaskId && <p className="text-xs text-gray-500 font-mono">task_id: {videoTaskId}</p>}
              {videoError && <p className="text-xs text-red-400">{videoError}</p>}
            </div>

            {videoStatus === "succeed" && videoShortUrl && (
              <div className="space-y-2">
                <p className="text-sm text-gray-300">播放（短链）</p>
                <video controls src={videoShortUrl} className="w-full rounded-md border border-gray-800 bg-black max-h-72" />
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
