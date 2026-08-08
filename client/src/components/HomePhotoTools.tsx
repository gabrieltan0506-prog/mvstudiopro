import { useEffect, useRef, useState } from "react";
import {
  Download,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Palette,
  Sparkles,
  Upload,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { uploadOneCanvasAsset } from "@/lib/canvasUpload";
import { withFlyHealthGate } from "@/lib/flyHealthGate";
import {
  buildUpscaleConfirmation,
  detectImageBlurRisk,
} from "@/lib/imageBlurDetection";
import {
  flyHealthProbeOriginForUrl,
  withLongJobsFlyDirect,
} from "@/lib/longJobsFlyOrigin";
import {
  HOME_OLD_PHOTO_RESTORE_CREDITS,
  HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION,
  HOME_PHOTO_ANIMATE_DURATIONS,
  HOME_PHOTO_ANIMATE_RESOLUTIONS,
  homePhotoAnimateCredits,
  type HomePhotoAnimateDuration,
  type HomePhotoAnimateResolution,
} from "@shared/homePhotoTools";
import { imageUpscaleTotalCredits } from "@shared/plans";

type PhotoAspect = "square" | "portrait" | "landscape";
type ImageResult = { url: string; label: string; credits: number };
type ActiveOperation = "upload" | "upscale" | "restore" | "animate";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const UPSCALE_2X_CREDITS = imageUpscaleTotalCredits(
  "homePhotoUpscaleBase",
  "x2"
);
const UPSCALE_4X_CREDITS = imageUpscaleTotalCredits(
  "homePhotoUpscaleBase",
  "x4"
);

async function detectPhotoAspect(file: File): Promise<PhotoAspect> {
  try {
    const bitmap = await createImageBitmap(file);
    const ratio = bitmap.width / Math.max(1, bitmap.height);
    bitmap.close();
    if (ratio > 1.18) return "landscape";
    if (ratio < 0.85) return "portrait";
    return "square";
  } catch {
    return "square";
  }
}

function resultDownloadName(label: string, extension: "png" | "mp4") {
  return `${label.replace(/\s+/g, "-")}-${Date.now()}.${extension}`;
}

export default function HomePhotoTools() {
  const { isAuthenticated, refresh } = useAuth({ autoFetch: true });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceAspect, setSourceAspect] = useState<PhotoAspect>("square");
  const [uploading, setUploading] = useState(false);
  const [upscaleBusy, setUpscaleBusy] = useState<"x2" | "x4" | null>(null);
  const [upscaleResult, setUpscaleResult] = useState<ImageResult | null>(null);
  const [restoreResult, setRestoreResult] = useState<ImageResult | null>(null);
  const [motionPrompt, setMotionPrompt] = useState("");
  const [duration, setDuration] = useState<HomePhotoAnimateDuration>(5);
  const [resolution, setResolution] = useState<HomePhotoAnimateResolution>(
    HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION
  );
  const [animateBusy, setAnimateBusy] = useState(false);
  const [videoResult, setVideoResult] = useState<ImageResult | null>(null);
  const operationLockRef = useRef<ActiveOperation | null>(null);
  const [activeOperation, setActiveOperation] =
    useState<ActiveOperation | null>(null);

  const getSignedUrl = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  const upscaleMutation = trpc.vertexImage.upscale.useMutation();
  const restoreMutation = trpc.homePhotoTools.restoreOldPhoto.useMutation();

  useEffect(() => {
    return () => {
      if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function requireReadyPhoto(): boolean {
    if (!isAuthenticated) {
      toast.error("请先登录后再使用照片工具");
      window.location.href = "/login";
      return false;
    }
    if (!sourceUrl) {
      toast.error("请先上传一张照片");
      fileInputRef.current?.click();
      return false;
    }
    return true;
  }

  function beginOperation(operation: ActiveOperation): boolean {
    if (operationLockRef.current) return false;
    operationLockRef.current = operation;
    setActiveOperation(operation);
    return true;
  }

  function endOperation(operation: ActiveOperation) {
    if (operationLockRef.current !== operation) return;
    operationLockRef.current = null;
    setActiveOperation(null);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请上传 JPG、PNG 或 WebP 图片");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("图片不能超过 10MB");
      return;
    }
    if (!beginOperation("upload")) return;

    setUploading(true);
    setUpscaleResult(null);
    setRestoreResult(null);
    setVideoResult(null);
    try {
      const aspect = await detectPhotoAspect(file);
      const asset = await uploadOneCanvasAsset({
        file,
        index: 0,
        getSignedUploadUrl: input => getSignedUrl.mutateAsync(input),
      });
      if (asset.kind !== "image" || !asset.url)
        throw new Error("上传结果不是有效图片");
      setSourceUrl(asset.url);
      setPreviewUrl(asset.previewUrl || asset.url);
      setSourceName(file.name);
      setSourceAspect(aspect);
      toast.success("照片上传完成");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "照片上传失败");
    } finally {
      setUploading(false);
      endOperation("upload");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function runUpscale(factor: "x2" | "x4") {
    if (!requireReadyPhoto()) return;
    const credits = factor === "x2" ? UPSCALE_2X_CREDITS : UPSCALE_4X_CREDITS;
    if (!beginOperation("upscale")) return;
    setUpscaleBusy(factor);
    try {
      const assessment = await detectImageBlurRisk(previewUrl || sourceUrl);
      const confirmed = window.confirm(buildUpscaleConfirmation({
        factorLabel: factor === "x2" ? "2×" : "4×",
        credits,
        assessment,
      }));
      if (!confirmed) return;
      const result = await upscaleMutation.mutateAsync({
        imageUrl: sourceUrl,
        upscaleFactor: factor,
        baseCreditKey: "homePhotoUpscaleBase",
        qualityWarningAccepted: assessment.isLikelyBlurry,
        sourceBlurScore: assessment.score,
      });
      if (!result.success || !result.imageUrl)
        throw new Error(result.error || "高清放大失败");
      const label = `高清放大 ${factor === "x2" ? "2×" : "4×"}`;
      setUpscaleResult({
        url: result.imageUrl,
        label,
        credits: result.creditsUsed,
      });
      setSourceUrl(result.imageUrl);
      setPreviewUrl(result.imageUrl);
      setSourceName(`${label}结果（当前素材）`);
      refresh();
      toast.success(`${label}完成，已自动作为下一步素材`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "高清放大失败";
      if (/abort|Failed to fetch|NetworkError|load failed|connection closed/i.test(message)) {
        toast.error("连接中断（服务可能正在更新）。若已扣积分将自动退回，请稍后重试");
      } else {
        toast.error(message);
      }
    } finally {
      setUpscaleBusy(null);
      endOperation("upscale");
    }
  }

  async function runRestore() {
    if (!requireReadyPhoto()) return;
    if (
      !window.confirm(
        `确认修复并自然上色，扣除 ${HOME_OLD_PHOTO_RESTORE_CREDITS} 积分吗？`
      )
    )
      return;
    if (!beginOperation("restore")) return;
    try {
      const result = await restoreMutation.mutateAsync({
        imageUrl: sourceUrl,
        aspect: sourceAspect,
      });
      if (!result.success || !result.imageUrl)
        throw new Error(result.error || "老照片修复失败");
      setRestoreResult({
        url: result.imageUrl,
        label: "老照片修复上色",
        credits: result.creditsUsed,
      });
      setSourceUrl(result.imageUrl);
      setPreviewUrl(result.imageUrl);
      setSourceName("老照片修复上色结果（当前素材）");
      setSourceAspect(result.aspect || sourceAspect);
      refresh();
      toast.success(
        result.autoCropApplied
          ? "已自动裁切照片边界并完成修复，上色图已作为下一步素材"
          : "老照片修复上色完成，已自动作为下一步素材"
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "老照片修复失败");
    } finally {
      endOperation("restore");
    }
  }

  async function runAnimation() {
    if (!requireReadyPhoto()) return;
    const credits = homePhotoAnimateCredits(duration, resolution);
    if (
      !window.confirm(
        `确认生成 ${resolution} · ${duration} 秒照片动画并扣除 ${credits} 积分吗？`
      )
    )
      return;
    if (!beginOperation("animate")) return;
    setAnimateBusy(true);
    setVideoResult(null);
    try {
      const endpoint = withLongJobsFlyDirect("/api/jobs?op=homePhotoAnimate");
      const probeOrigin = flyHealthProbeOriginForUrl(endpoint);
      const response = await withFlyHealthGate(probeOrigin, () =>
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            imageUrl: sourceUrl,
            prompt: motionPrompt.trim(),
            duration,
            resolution,
            aspectRatio:
              sourceAspect === "portrait"
                ? "9:16"
                : sourceAspect === "landscape"
                  ? "16:9"
                  : "1:1",
          }),
        }),
      );
      const raw = await response.text();
      let created: {
        ok?: boolean;
        async?: boolean;
        taskId?: string;
        status?: string;
        videoUrl?: string;
        creditsUsed?: number;
        resolution?: HomePhotoAnimateResolution;
        error?: string;
      } = {};
      try {
        created = JSON.parse(raw) as typeof created;
      } catch {
        throw new Error(`照片动画生成失败：${raw.slice(0, 120)}`);
      }
      if (!response.ok || !created.ok) {
        throw new Error(created.error || "照片动画生成失败");
      }

      let videoUrl = String(created.videoUrl || "").trim();
      let creditsUsed = Number(created.creditsUsed || credits);
      let resultResolution = created.resolution || resolution;

      // 异步任务：短轮询状态，避免单条长连接被部署掐断后整单作废
      if (!videoUrl && created.taskId) {
        const statusEndpoint = withLongJobsFlyDirect(
          `/api/jobs?op=homePhotoAnimateStatus&taskId=${encodeURIComponent(created.taskId)}`,
        );
        const deadline = Date.now() + 20 * 60_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 5_000));
          const statusRes = await fetch(statusEndpoint, {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          });
          const statusRaw = await statusRes.text();
          let statusJson: {
            ok?: boolean;
            status?: string;
            videoUrl?: string;
            creditsUsed?: number;
            resolution?: HomePhotoAnimateResolution;
            error?: string;
          } = {};
          try {
            statusJson = JSON.parse(statusRaw) as typeof statusJson;
          } catch {
            continue;
          }
          if (!statusRes.ok || !statusJson.ok) {
            throw new Error(statusJson.error || "照片动画进度查询失败");
          }
          if (statusJson.status === "succeeded" && statusJson.videoUrl) {
            videoUrl = String(statusJson.videoUrl).trim();
            creditsUsed = Number(statusJson.creditsUsed || creditsUsed);
            resultResolution = statusJson.resolution || resultResolution;
            break;
          }
          if (statusJson.status === "failed") {
            throw new Error(statusJson.error || "照片动画生成失败，积分已自动退回");
          }
        }
      }

      if (!videoUrl) {
        throw new Error("照片动画仍在生成中，请稍后在「我的作品」查看，或稍后再试");
      }

      setVideoResult({
        url: videoUrl,
        label: `照片人物动画 ${resultResolution} · ${duration} 秒`,
        credits: creditsUsed,
      });
      refresh();
      toast.success("照片人物动画生成完成");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "照片动画生成失败";
      toast.error(message || "照片动画生成失败");
    } finally {
      setAnimateBusy(false);
      endOperation("animate");
    }
  }

  const resultBlock = (result: ImageResult | null) =>
    result ? (
      <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/25">
        <img
          src={result.url}
          alt={result.label}
          className="aspect-video w-full object-contain"
        />
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs text-white/65">
          <span>
            {result.label} · 实扣 {result.credits} 积分
          </span>
          <a
            href={result.url}
            download={resultDownloadName(result.label, "png")}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-cyan-300 hover:text-cyan-200"
          >
            <Download className="h-3.5 w-3.5" /> 下载
          </a>
        </div>
      </div>
    ) : null;

  return (
    <section
      id="photo-tools"
      className="mx-auto w-full max-w-[1120px] scroll-mt-24 px-5 py-20"
    >
      <div className="mx-auto max-w-3xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/8 px-3 py-1 text-xs font-bold tracking-[0.14em] text-cyan-200">
          <Sparkles className="h-3.5 w-3.5" /> 照片工具箱
        </div>
        <h2 className="mt-5 text-3xl font-black tracking-tight text-white sm:text-4xl">
          让回忆重新穿越，也重新有生命
        </h2>
        <p className="mt-4 text-sm leading-7 text-white/55 sm:text-base">
          一张旧照片，不只可以变清晰，也可以重新有颜色、重新有生命。上传照片，一键高清放大
          2×/4×，
          修复划痕与褪色并自然上色；再写下一句你想看到的动作，让照片里的人轻轻转身、微笑、挥手，
          把停在过去的一瞬，变成今天还能播放的记忆。
        </p>
        <p className="mt-2 text-xs text-white/35">
          手机拍到桌面或相框也无需手动裁切；每一步的结果会自动成为下一步素材。
        </p>
      </div>

      <div className="mt-10 rounded-3xl border border-white/10 bg-white/[0.035] p-4 shadow-[0_24px_90px_rgba(17,24,39,0.35)] sm:p-6">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={event => void handleFile(event.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={activeOperation !== null}
          className="group flex min-h-40 w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed border-white/15 bg-black/20 transition hover:border-cyan-300/35 hover:bg-cyan-300/[0.04] disabled:opacity-60"
        >
          {previewUrl ? (
            <div className="flex w-full flex-col items-center gap-3 p-4 sm:flex-row sm:text-left">
              <img
                src={previewUrl}
                alt="已上传照片"
                className="h-28 w-28 rounded-xl border border-white/10 object-cover"
              />
              <div>
                <div className="font-bold text-white">
                  {sourceName || "已上传照片"}
                </div>
                <div className="mt-1 text-xs text-white/45">
                  已安全上传 · 点击可更换照片
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
              {uploading ? (
                <Loader2 className="h-8 w-8 animate-spin text-cyan-300" />
              ) : (
                <Upload className="h-8 w-8 text-cyan-300" />
              )}
              <div className="font-bold text-white">
                {uploading ? "正在上传照片…" : "上传一张照片开始"}
              </div>
              <div className="text-xs text-white/40">
                支持 JPG、PNG、WebP，最大 10MB
              </div>
            </div>
          )}
        </button>

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <article
            id="photo-tools-upscale"
            className="scroll-mt-24 rounded-2xl border border-white/10 bg-[#10101d] p-5"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-cyan-400/10 p-2.5 text-cyan-300">
                <Maximize2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-white">高清放大</h3>
                <p className="mt-1 text-xs leading-5 text-white/45">
                  智能提升尺寸与细节，尽量保持人物、文字与构图不变。
                </p>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {(["x2", "x4"] as const).map(factor => {
                const credits =
                  factor === "x2" ? UPSCALE_2X_CREDITS : UPSCALE_4X_CREDITS;
                return (
                  <button
                    key={factor}
                    type="button"
                    onClick={() => void runUpscale(factor)}
                    disabled={activeOperation !== null}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/8 text-sm font-bold text-cyan-100 transition hover:bg-cyan-300/15 disabled:opacity-45"
                  >
                    {upscaleBusy === factor ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {factor === "x2" ? "放大 2×" : "放大 4×"} · {credits} 积分
                  </button>
                );
              })}
            </div>
            {resultBlock(upscaleResult)}
          </article>

          <article
            id="photo-tools-restore"
            className="scroll-mt-24 rounded-2xl border border-white/10 bg-[#10101d] p-5"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-amber-400/10 p-2.5 text-amber-300">
                <Palette className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-white">老照片修复上色</h3>
                <p className="mt-1 text-xs leading-5 text-white/45">
                  自动识别纸质照片边界，再修复划痕、折痕与褪色，锁定原人物身份和构图，自然恢复年代色彩。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void runRestore()}
              disabled={activeOperation !== null}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/8 text-sm font-bold text-amber-100 transition hover:bg-amber-300/15 disabled:opacity-45"
            >
              {restoreMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImageIcon className="h-4 w-4" />
              )}
              修复并上色 · {HOME_OLD_PHOTO_RESTORE_CREDITS} 积分
            </button>
            {resultBlock(restoreResult)}
          </article>
        </div>

        <article
          id="photo-tools-animate"
          className="mt-4 scroll-mt-24 rounded-2xl border border-violet-300/15 bg-[linear-gradient(135deg,rgba(124,58,237,0.12),rgba(15,15,28,0.96))] p-5 sm:p-6"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-violet-400/12 p-2.5 text-violet-300">
              <Video className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-white">让照片人物动起来</h3>
              <p className="mt-1 text-xs leading-5 text-white/45">
                填写你想看到的动作，选择时长与清晰度，快速成片并按秒计费。
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_auto]">
            <textarea
              value={motionPrompt}
              disabled={activeOperation !== null}
              onChange={event =>
                setMotionPrompt(event.target.value.slice(0, 500))
              }
              placeholder="例如：人物看向镜头，露出温和的微笑并轻轻挥手；保持脸部、服装和背景稳定。"
              className="min-h-28 w-full resize-y rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-white/25 focus:border-violet-300/40"
            />
            <div className="grid grid-cols-3 gap-2 lg:w-80">
              {HOME_PHOTO_ANIMATE_DURATIONS.map(seconds => (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => setDuration(seconds)}
                  disabled={activeOperation !== null}
                  className={`rounded-xl border px-3 py-3 text-center transition ${
                    duration === seconds
                      ? "border-violet-300/55 bg-violet-400/18 text-white"
                      : "border-white/10 bg-white/5 text-white/55 hover:bg-white/8"
                  }`}
                >
                  <span className="block text-sm font-bold">{seconds} 秒</span>
                  <span className="mt-1 block text-[11px]">
                    {homePhotoAnimateCredits(seconds, resolution)} 积分
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-semibold text-white/45">
              输出清晰度
            </span>
            {HOME_PHOTO_ANIMATE_RESOLUTIONS.map(item => (
              <button
                key={item}
                type="button"
                onClick={() => setResolution(item)}
                disabled={activeOperation !== null}
                className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
                  resolution === item
                    ? "border-violet-300/55 bg-violet-400/18 text-white"
                    : "border-white/10 bg-white/5 text-white/55 hover:bg-white/8"
                }`}
              >
                {item}
                {item === "1080p" ? " · +20%" : " · 默认"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void runAnimation()}
            disabled={activeOperation !== null}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#8b5cf6,#ec4899)] px-5 text-sm font-black text-white shadow-lg shadow-violet-950/30 transition hover:brightness-110 disabled:opacity-50"
          >
            {animateBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Video className="h-4 w-4" />
            )}
            {animateBusy
              ? "正在让照片动起来，请保持页面开启…"
              : `生成 ${resolution} · ${duration} 秒照片动画 · ${homePhotoAnimateCredits(duration, resolution)} 积分`}
          </button>
          {videoResult ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-white/10 bg-black/30">
              <video
                src={videoResult.url}
                controls
                playsInline
                className="max-h-[560px] w-full bg-black object-contain"
              />
              <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs text-white/65">
                <span>
                  {videoResult.label} · 实扣 {videoResult.credits} 积分
                </span>
                <a
                  href={videoResult.url}
                  download={resultDownloadName(videoResult.label, "mp4")}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-violet-300 hover:text-violet-200"
                >
                  <Download className="h-3.5 w-3.5" /> 下载视频
                </a>
              </div>
            </div>
          ) : null}
          <p className="mt-3 text-center text-[11px] text-white/35">
            成片功能沿用正式会员权限；生成失败会自动退回本次积分。
          </p>
        </article>
      </div>
    </section>
  );
}
