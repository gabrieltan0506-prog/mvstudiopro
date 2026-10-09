import { gcsTransferUrl } from "@/lib/gcsTransfer";
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
import { usePhotoAnimationTask } from "@/lib/usePhotoAnimationTask";
import HomePhotoVideoUpscale from "./HomePhotoVideoUpscale";
import HomePhotoFlow from "./HomePhotoFlow";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  uploadPhotoTemporaryMedia,
  cachePhotoTemporaryMedia,
} from "@/lib/photoTemporaryMedia";
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
  HOME_PHOTO_VIDEO_MODELS,
  HOME_PHOTO_VIDEO_MODEL_LABELS,
  type HomePhotoVideoModel,
  homePhotoAnimateCredits,
  type HomePhotoAnimateDuration,
  type HomePhotoAnimateResolution,
} from "@shared/homePhotoTools";
import { imageUpscaleTotalCredits } from "@shared/plans";

type PhotoAspect = "square" | "portrait" | "landscape";
type ImageResult = {
  url: string;
  label: string;
  credits: number;
  aspect?: PhotoAspect;
};
type PhotoTool = "upscale" | "restore" | "animate";
type SourceChoice = "original" | "upscale" | "restore";
type ActiveOperation = "upload" | "upscale" | "restore" | "animate";

const MAX_IMAGE_BYTES = 30_000_000;
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
  const { user, isAuthenticated, refresh } = useAuth({ autoFetch: true });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceChoices, setSourceChoices] = useState<
    Record<PhotoTool, SourceChoice>
  >({ upscale: "original", restore: "original", animate: "original" });
  const [sourceAspect, setSourceAspect] = useState<PhotoAspect>("square");
  const [uploading, setUploading] = useState(false);
  const [upscaleBusy, setUpscaleBusy] = useState<"x2" | "x4" | null>(null);
  const [upscaleResult, setUpscaleResult] = useState<ImageResult | null>(null);
  const [restoreResult, setRestoreResult] = useState<ImageResult | null>(null);
  const [motionPrompt, setMotionPrompt] = useState("");
  const [duration, setDuration] = useState<HomePhotoAnimateDuration>(5);
  const [modelChoice, setModelChoice] =
    useState<HomePhotoVideoModel>("seedance-2.0");
  const [resolution] = useState<HomePhotoAnimateResolution>(
    HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION
  );
  const [animateBusy, setAnimateBusy] = useState(false);
  const [videoResult, setVideoResult] = useState<ImageResult | null>(null);
  const animation = usePhotoAnimationTask(user?.id, (url, credits, seconds) => {
    setVideoResult({
      url,
      credits,
      label: `照片人物动画 720p · ${seconds} 秒`,
    });
    refresh();
  });
  const operationLockRef = useRef<ActiveOperation | null>(null);
  const [activeOperation, setActiveOperation] =
    useState<ActiveOperation | null>(null);

  const restoreMutation = trpc.homePhotoTools.restoreOldPhoto.useMutation();

  useEffect(() => {
    return () => {
      if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function inputFor(tool: PhotoTool) {
    const selected = sourceChoices[tool];
    const result =
      selected === "upscale"
        ? upscaleResult
        : selected === "restore"
          ? restoreResult
          : null;
    return {
      url: result?.url || sourceUrl,
      preview: result?.url || previewUrl,
      aspect: result?.aspect || sourceAspect,
    };
  }

  function requireReadyPhoto(tool: PhotoTool): boolean {
    if (!isAuthenticated) {
      toast.error("请先登录后再使用照片工具");
      window.location.href = "/login";
      return false;
    }
    if (!inputFor(tool).url) {
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
      toast.error("图片不能超过 30MB");
      return;
    }
    if (!beginOperation("upload")) return;

    setUploading(true);

    try {
      const aspect = await detectPhotoAspect(file);
      const asset = await uploadPhotoTemporaryMedia(file);
      setSourceUrl(asset.url);
      setPreviewUrl(asset.previewUrl || asset.url);
      setSourceName(file.name);
      setSourceAspect(aspect);
      setSourceChoices({
        upscale: "original",
        restore: "original",
        animate: "original",
      });
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
    if (!requireReadyPhoto("upscale")) return;
    const input = inputFor("upscale");
    const credits = factor === "x2" ? UPSCALE_2X_CREDITS : UPSCALE_4X_CREDITS;
    if (!beginOperation("upscale")) return;
    setUpscaleBusy(factor);
    try {
      const assessment = await detectImageBlurRisk(input.preview || input.url);
      const confirmed = window.confirm(
        buildUpscaleConfirmation({
          factorLabel: factor === "x2" ? "2×" : "4×",
          credits,
          assessment,
        })
      );
      if (!confirmed) return;

      // 异步：立刻拿 taskId，后台跑 Gemini；短轮询，避免同步长连接被 120s/部署掐断
      const endpoint = withLongJobsFlyDirect("/api/jobs?op=homePhotoUpscale");
      const probeOrigin = flyHealthProbeOriginForUrl(endpoint);
      const response = await withFlyHealthGate(probeOrigin, () =>
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            imageUrl: input.url,
            upscaleFactor: factor,
            qualityWarningAccepted: assessment.isLikelyBlurry,
            sourceBlurScore: assessment.score,
          }),
        })
      );
      const raw = await response.text();
      let created: {
        ok?: boolean;
        async?: boolean;
        taskId?: string;
        status?: string;
        imageUrl?: string;
        creditsUsed?: number;
        error?: string;
      } = {};
      try {
        created = JSON.parse(raw) as typeof created;
      } catch {
        throw new Error(`高清放大失败：${raw.slice(0, 120)}`);
      }
      if (!response.ok || !created.ok) {
        throw new Error(created.error || "高清放大失败");
      }

      let imageUrl = String(created.imageUrl || "").trim();
      let creditsUsed = Number(created.creditsUsed || credits);

      if (!imageUrl && created.taskId) {
        const statusEndpoint = withLongJobsFlyDirect(
          `/api/jobs?op=homePhotoUpscaleStatus&taskId=${encodeURIComponent(created.taskId)}`
        );
        const deadline = Date.now() + 15 * 60_000;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 5_000));
          const statusRes = await fetch(statusEndpoint, {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          });
          const statusRaw = await statusRes.text();
          let statusJson: {
            ok?: boolean;
            status?: string;
            imageUrl?: string;
            creditsUsed?: number;
            error?: string;
          } = {};
          try {
            statusJson = JSON.parse(statusRaw) as typeof statusJson;
          } catch {
            continue;
          }
          if (!statusRes.ok || !statusJson.ok) {
            throw new Error(statusJson.error || "高清放大进度查询失败");
          }
          if (statusJson.status === "succeeded" && statusJson.imageUrl) {
            imageUrl = String(statusJson.imageUrl).trim();
            creditsUsed = Number(statusJson.creditsUsed || creditsUsed);
            break;
          }
          if (statusJson.status === "failed") {
            throw new Error(statusJson.error || "高清放大失败，积分已自动退回");
          }
        }
      }

      if (!imageUrl) {
        throw new Error(
          "高清放大仍在处理中，请稍后在「我的作品」查看，或稍后再试"
        );
      }

      const label = `高清放大 ${factor === "x2" ? "2×" : "4×"}`;
      setUpscaleResult({
        url: await cachePhotoTemporaryMedia(imageUrl, "image"),
        label,
        credits: creditsUsed,
        aspect: input.aspect,
      });
      refresh();
      toast.success(`${label}完成，可下载或在其他功能中选择此结果`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "高清放大失败";
      if (
        /abort|Failed to fetch|NetworkError|load failed|connection closed/i.test(
          message
        )
      ) {
        toast.error(
          "连接中断（服务可能正在更新）。若已扣积分将自动退回，请稍后重试"
        );
      } else {
        toast.error(message);
      }
    } finally {
      setUpscaleBusy(null);
      endOperation("upscale");
    }
  }

  async function runRestore() {
    if (!requireReadyPhoto("restore")) return;
    const input = inputFor("restore");
    if (
      !window.confirm(
        `确认修复并自然上色，扣除 ${HOME_OLD_PHOTO_RESTORE_CREDITS} 积分吗？`
      )
    )
      return;
    if (!beginOperation("restore")) return;
    try {
      const result = await restoreMutation.mutateAsync({
        imageUrl: input.url,
        aspect: input.aspect,
      });
      if (!result.success || !result.imageUrl)
        throw new Error(result.error || "老照片修复失败");
      setRestoreResult({
        url: await cachePhotoTemporaryMedia(result.imageUrl, "image"),
        label: "老照片修复上色",
        credits: result.creditsUsed,
        aspect: result.aspect || input.aspect,
      });
      refresh();
      toast.success(
        result.autoCropApplied
          ? "已自动裁切照片边界并完成修复，可下载或自行选择使用结果"
          : "老照片修复上色完成，原图保留"
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "老照片修复失败");
    } finally {
      endOperation("restore");
    }
  }

  async function runAnimation() {
    if (!requireReadyPhoto("animate")) return;
    const input = inputFor("animate");
    const credits = homePhotoAnimateCredits(duration, resolution);
    if (
      !window.confirm(
        `确认生成 ${resolution} · ${duration} 秒照片动画并扣除 ${credits} 积分吗？`
      )
    )
      return;
    if (!beginOperation("animate")) return;
    setAnimateBusy(true);
    try {
      await animation.submit(
        {
          imageUrl: input.url,
          prompt: motionPrompt.trim(),
          modelChoice,
          duration,
          resolution,
          aspectRatio:
            input.aspect === "portrait"
              ? "9:16"
              : input.aspect === "landscape"
                ? "16:9"
                : "1:1",
        },
        credits,
        duration
      );
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
      <div className="mt-4 overflow-hidden rounded-xl border border-[var(--hp-line)] bg-[var(--hp-input)]">
        <img
          src={result.url}
          alt={result.label}
          className="aspect-video w-full object-contain"
        />
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs text-[var(--hp-muted)]">
          <span>
            {result.label} · 实扣 {result.credits} 积分
          </span>
          <a
            href={gcsTransferUrl(result.url)}
            download={resultDownloadName(result.label, "png")}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-[var(--hp-accent)] hover:text-[var(--hp-accent)]"
          >
            <Download className="h-3.5 w-3.5" /> 下载
          </a>
        </div>
      </div>
    ) : null;

  function sourceSelector(tool: PhotoTool) {
    return (
      <label className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--hp-muted)]">
        使用照片
        <select
          aria-label={`${tool === "upscale" ? "高清放大" : tool === "restore" ? "修复上色" : "照片动画"}输入照片`}
          value={sourceChoices[tool]}
          disabled={activeOperation !== null}
          onChange={event =>
            setSourceChoices(current => ({
              ...current,
              [tool]: event.target.value as SourceChoice,
            }))
          }
          className="rounded-lg border border-[var(--hp-line)] bg-[var(--hp-input)] px-3 py-2 text-[var(--hp-ink)]"
        >
          <option value="original">
            {sourceName ? `上传原图：${sourceName}` : "请先上传照片"}
          </option>
          {upscaleResult && (
            <option value="upscale">{upscaleResult.label}结果</option>
          )}
          {restoreResult && <option value="restore">修复上色结果</option>}
        </select>
      </label>
    );
  }

  return (
    <section
      id="photo-tools"
      className="mx-auto w-full max-w-[1120px] scroll-mt-24 px-5 py-20"
    >
      <div className="mx-auto max-w-3xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--hp-accent-line)] bg-[var(--hp-accent-soft)] px-3 py-1 text-xs font-bold tracking-[0.14em] text-[var(--hp-accent)]">
          <Sparkles className="h-3.5 w-3.5" /> 图片工具箱
        </div>
        <h2 className="mt-5 text-3xl font-black tracking-tight text-[var(--hp-ink)] sm:text-4xl">
          让回忆重新穿越，也重新有生命
        </h2>
        <p className="mt-4 text-sm leading-7 text-[var(--hp-muted)] sm:text-base">
          上传照片后，自由选择高清放大、修复上色或照片动起来。三个功能都可以单独使用，无需按顺序操作。
        </p>
      </div>

      <div className="mt-10 rounded-3xl border border-[var(--hp-line)] bg-[var(--hp-card)] p-4 shadow-[0_20px_60px_rgba(82,50,29,0.06)] sm:p-6">
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
          className="group flex min-h-40 w-full items-center justify-center overflow-hidden rounded-2xl border border-dashed border-[var(--hp-line)] bg-[var(--hp-input)] transition hover:border-[var(--hp-accent-line)] hover:bg-[var(--hp-accent-soft)] disabled:opacity-60"
        >
          {previewUrl ? (
            <div className="flex w-full flex-col items-center gap-3 p-4 sm:flex-row sm:text-left">
              <img
                src={previewUrl}
                alt="已上传照片"
                className="h-28 w-28 rounded-xl border border-[var(--hp-line)] object-cover"
              />
              <div>
                <div className="font-bold text-[var(--hp-ink)]">
                  {sourceName || "已上传照片"}
                </div>
                <div className="mt-1 text-xs text-[var(--hp-muted)]">
                  已安全上传 · 点击可更换照片
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
              {uploading ? (
                <Loader2 className="h-8 w-8 animate-spin text-[var(--hp-accent)]" />
              ) : (
                <Upload className="h-8 w-8 text-[var(--hp-accent)]" />
              )}
              <div className="font-bold text-[var(--hp-ink)]">
                {uploading ? "正在上传照片…" : "上传一张照片开始"}
              </div>
              <div className="text-xs text-[var(--hp-muted)]">
                支持 JPG、PNG、WebP，最大 30MB；各功能提交限制单独检查
              </div>
            </div>
          )}
        </button>

        <HomePhotoFlow
          originalReady={Boolean(sourceUrl)}
          upscaleReady={Boolean(upscaleResult?.url)}
          restoreReady={Boolean(restoreResult?.url)}
          upscaleBusy={Boolean(upscaleBusy)}
          restoreBusy={restoreMutation.isPending}
          animationStatus={animation.pending?.status === "failed" ? "本次未完成" : animation.pending?.status === "reconcile_manual" ? "需要核对" : animation.pending || animateBusy ? "正在制作" : videoResult ? "已有动画" : ""}
          choices={sourceChoices}
          locked={activeOperation !== null}
          onReuse={(tool, source) => {
            // 仅选中已有素材；沿原确认按钮提交，不在图解入口发起生成或扣分。
            if (activeOperation !== null || !(source === "upscale" ? upscaleResult?.url : restoreResult?.url)) return;
            setSourceChoices(current => ({ ...current, [tool]: source }));
            const target = document.getElementById(`photo-tools-${tool}`);
            target?.scrollIntoView({ block: "start" });
            target?.querySelector<HTMLSelectElement>("select")?.focus({ preventScroll: true });
          }}
        />

        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <article
            id="photo-tools-upscale"
            className="scroll-mt-24 rounded-2xl border border-[var(--hp-line)] bg-[var(--hp-card)] p-5"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-[var(--hp-accent-soft)] p-2.5 text-[var(--hp-accent)]">
                <Maximize2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-[var(--hp-ink)]">高清放大</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--hp-muted)]">
                  智能提升尺寸与细节，尽量保持人物、文字与构图不变。
                </p>
              </div>
            </div>
            {sourceSelector("upscale")}
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
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--hp-accent-line)] bg-[var(--hp-accent-soft)] text-sm font-bold text-[var(--hp-accent)] transition hover:bg-[var(--hp-accent-soft)] disabled:opacity-45"
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
            className="scroll-mt-24 rounded-2xl border border-[var(--hp-line)] bg-[var(--hp-card)] p-5"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-[var(--hp-accent-soft)] p-2.5 text-[var(--hp-warning)]">
                <Palette className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-[var(--hp-ink)]">老照片修复上色</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--hp-muted)]">
                  自动识别纸质照片边界，再修复划痕、折痕与褪色，锁定原人物身份和构图，自然恢复年代色彩。
                </p>
              </div>
            </div>
            {sourceSelector("restore")}
            <button
              type="button"
              onClick={() => void runRestore()}
              disabled={activeOperation !== null}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-[var(--hp-accent-line)] bg-[var(--hp-accent-soft)] text-sm font-bold text-[var(--hp-warning)] transition hover:bg-[var(--hp-accent-soft)] disabled:opacity-45"
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
          className="mt-4 scroll-mt-24 rounded-2xl border border-[var(--hp-accent-line)] bg-[linear-gradient(135deg,var(--hp-card),var(--hp-peach))] p-5 sm:p-6"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-[var(--hp-accent-soft)] p-2.5 text-[var(--hp-accent)]">
              <Video className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-[var(--hp-ink)]">让照片人物动起来</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--hp-muted)]">
                填写你想看到的动作，选择时长与清晰度，快速成片并按秒计费。
              </p>
            </div>
          </div>
          {sourceSelector("animate")}
          <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_auto]">
            <textarea
              value={motionPrompt}
              disabled={activeOperation !== null}
              onChange={event =>
                setMotionPrompt(event.target.value.slice(0, 500))
              }
              placeholder="例如：人物看向镜头，露出温和的微笑并轻轻挥手；保持脸部、服装和背景稳定。"
              className="min-h-28 w-full resize-y rounded-xl border border-[var(--hp-line)] bg-[var(--hp-input)] px-4 py-3 text-sm leading-6 text-[var(--hp-ink)] outline-none placeholder:text-[var(--hp-subtle)] focus:border-[var(--hp-accent-line)]"
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
                      ? "border-[var(--hp-accent-line)] bg-[var(--hp-accent-soft)] text-[var(--hp-ink)]"
                      : "border-[var(--hp-line)] bg-[var(--hp-card)] text-[var(--hp-muted)] hover:bg-[var(--hp-card)]"
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
            <span className="mr-1 text-xs font-semibold text-[var(--hp-muted)]">
              生成模型 · 720p
            </span>
            {HOME_PHOTO_VIDEO_MODELS.map(item => (
              <button
                key={item}
                type="button"
                onClick={() => setModelChoice(item)}
                disabled={activeOperation !== null}
                className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
                  modelChoice === item
                    ? "border-[var(--hp-accent-line)] bg-[var(--hp-accent-soft)] text-[var(--hp-ink)]"
                    : "border-[var(--hp-line)] bg-[var(--hp-card)] text-[var(--hp-muted)] hover:bg-[var(--hp-card)]"
                }`}
              >
                {HOME_PHOTO_VIDEO_MODEL_LABELS[item]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void runAnimation()}
            disabled={
              activeOperation !== null ||
              !animation.ready ||
              Boolean(animation.pending)
            }
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--hp-accent)] px-5 text-sm font-semibold text-[#fff] shadow-sm transition hover:brightness-110 disabled:opacity-50"
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
          {animation.message && (
            <p role="status" className="mt-3 text-sm text-[var(--hp-muted)]">
              {animation.message}
            </p>
          )}
          {animation.pending?.taskId && (
            <p className="mt-1 break-all text-xs text-[var(--hp-muted)]">
              任务编号：{animation.pending.taskId}
            </p>
          )}
          {animation.pending?.status === "failed" && (
            <button
              type="button"
              onClick={animation.clearFailed}
              className="mt-2 text-sm text-[var(--hp-accent)]"
            >
              已查看失败结果，返回生成
            </button>
          )}
          {videoResult ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-[var(--hp-line)] bg-[var(--hp-input)]">
              <video
                src={videoResult.url}
                controls
                playsInline
                className="max-h-[560px] w-full bg-[var(--hp-input)] object-contain"
              />
              <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs text-[var(--hp-muted)]">
                <span>
                  {videoResult.label} · 实扣 {videoResult.credits} 积分
                </span>
                <a
                  href={gcsTransferUrl(videoResult.url)}
                  download={resultDownloadName(videoResult.label, "mp4")}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-[var(--hp-accent)] hover:text-[var(--hp-accent)]"
                >
                  <Download className="h-3.5 w-3.5" /> 下载视频
                </a>
              </div>
            </div>
          ) : null}
          <p className="mt-3 text-center text-[11px] text-[var(--hp-subtle)]">
            成片功能沿用正式会员权限；生成失败会自动退回本次积分。
          </p>
        </article>
      </div>
      <p className="mt-4 text-sm text-[var(--hp-warning)]">
        照片和视频在下载空间保留12小时，请及时下载保存；到期自动删除临时副本。
      </p>
      <HomePhotoVideoUpscale generatedVideoUrl={videoResult?.url} />
    </section>
  );
}
