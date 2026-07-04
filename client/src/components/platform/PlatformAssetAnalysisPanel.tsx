import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  extractVideoPreview,
  GROWTH_CAMP_ANALYSIS_MODEL,
  GROWTH_CAMP_IMAGE_PIPELINE_DEBUG_NOTE,
  isGrowthCampImageFile,
  isGrowthCampVideoFile,
  newPlatformImageAssetId,
  normalizeGrowthCampImageMime,
  readFileAsDataUrl,
  runGrowthCampAssetAnalysis,
  type GrowthCampAnalysisProgressUpdate,
  type GrowthCampPartialAnalysis,
  type ImagePipelineDebugState,
  type PlatformImageAsset,
  type PlatformVideoAsset,
} from "@/lib/growthCampImagePipeline";
import AssetAnalysisWaitPanel from "@/components/platform/AssetAnalysisWaitPanel";
import AssetAnalysisResultBlock from "@/components/platform/AssetAnalysisResultBlock";
import type { GrowthAnalysisScores } from "@shared/growth";
import { CREDIT_COSTS, platformAssetAnalysisTotalCredits } from "@shared/plans";
import { sanitizePlatformUserMessage } from "@/lib/platformUserFacingCopy";
import { formatAssetAnalysisForOptimize, type AssetAnalysisHandoffPayload } from "@/lib/platformAssetAnalysisHandoff";
import { PlatformWorkspaceStepHint } from "@/components/platform/PlatformWorkspaceStepHint";
import { FileText, Film, FileUp, Image as ImageIcon, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";

type PlatformAssetAnalysisPanelProps = {
  debugMode: boolean;
  supervisorAccess: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onDeepOptimize?: (payload: AssetAnalysisHandoffPayload) => Promise<{ optimizedMarkdown: string; summary: string }>;
  onGenerateFromText?: (
    text: string,
    kind: "storyboard_sheet_landscape" | "single_page_knowledge_card",
  ) => Promise<void>;
  optimizeCopyCost?: number;
  storyboardCost?: number;
  cardCost?: number;
};

export default function PlatformAssetAnalysisPanel({
  debugMode,
  supervisorAccess,
  disabled = false,
  onBusyChange,
  onDeepOptimize,
  onGenerateFromText,
  optimizeCopyCost = CREDIT_COSTS.platformOptimizeCustomCopy,
  storyboardCost = 60,
  cardCost = 50,
}: PlatformAssetAnalysisPanelProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<PlatformImageAsset[]>([]);
  const [videoAsset, setVideoAsset] = useState<PlatformVideoAsset | null>(null);
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [analysisProgress, setAnalysisProgress] = useState<GrowthCampAnalysisProgressUpdate>({
    percent: 0,
    phase: "upload",
    label: "",
  });
  const [stage, setStage] = useState<"idle" | "uploading" | "analyzing" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<GrowthAnalysisScores | null>(null);
  const [partialAnalyses, setPartialAnalyses] = useState<GrowthCampPartialAnalysis[]>([]);
  const [mergePending, setMergePending] = useState(false);
  const [imagePipelineDebug, setImagePipelineDebug] = useState<ImagePipelineDebugState>({});
  const [optimizeBusy, setOptimizeBusy] = useState(false);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [optimizedMarkdown, setOptimizedMarkdown] = useState<string | null>(null);
  const [optimizeSummary, setOptimizeSummary] = useState<string | null>(null);

  useEffect(() => {
    onBusyChange?.(busy || optimizeBusy || generateBusy);
  }, [busy, optimizeBusy, generateBusy, onBusyChange]);

  const getVideoUploadSignedUrlMutation = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  const checkAccessMutation = trpc.usage.checkFeatureAccess.useMutation();

  const allImagesReady = useMemo(
    () => assets.length === 0 || assets.every((a) => a.ready),
    [assets],
  );
  const videoReady = Boolean(videoAsset?.ready);
  const hasAnyAsset = assets.length > 0 || Boolean(videoAsset);
  const allAssetsReady = hasAnyAsset && allImagesReady && (!videoAsset || videoReady);

  const readyAssetCount = useMemo(() => assets.filter((a) => a.ready).length, [assets]);
  const readyVideoCount = videoReady ? 1 : 0;
  const analysisCost = useMemo(
    () => platformAssetAnalysisTotalCredits(readyAssetCount, readyVideoCount),
    [readyAssetCount, readyVideoCount],
  );
  const unitCost = CREDIT_COSTS.growthCampGrowth;

  const ingestVideo = useCallback((file: File) => {
    if (!isGrowthCampVideoFile(file)) {
      setError("请上传 MP4 参考视频（每次 1 个）");
      return;
    }

    setError(null);
    setAnalysis(null);
    setImagePipelineDebug({});

    const assetId = newPlatformImageAssetId();
    const pending: PlatformVideoAsset = {
      id: assetId,
      file,
      fileName: file.name,
      mimeType: file.type || "video/mp4",
      size: file.size,
      previewUrl: null,
      durationSeconds: 0,
      ready: false,
    };
    setVideoAsset(pending);

    void (async () => {
      try {
        const { previewUrl, durationSeconds } = await extractVideoPreview(file);
        setVideoAsset((prev) =>
          prev?.id === assetId
            ? { ...prev, previewUrl, durationSeconds, ready: true }
            : prev,
        );
      } catch (videoError: unknown) {
        const msg = videoError instanceof Error ? videoError.message : "视频读取失败";
        setVideoAsset((prev) =>
          prev?.id === assetId ? { ...prev, ready: false, readError: msg } : prev,
        );
        setError(msg);
      }
    })();
  }, []);

  const removeVideo = useCallback(() => {
    setVideoAsset(null);
    setError(null);
    setAnalysis(null);
    setImagePipelineDebug({});
  }, []);

  const ingestImages = useCallback((files: File[]) => {
    const valid = files.filter((f) => isGrowthCampImageFile(f));
    if (!valid.length) {
      setError("请上传 PNG 或 JPG 图片（可多选封面、分镜等素材）");
      return;
    }

    setError(null);
    setAnalysis(null);
    setImagePipelineDebug({});

    void (async () => {
      const newAssets = await Promise.all(
        valid.map(async (file) => {
          const assetId = newPlatformImageAssetId();
          const mimeType = normalizeGrowthCampImageMime(file) || "image/jpeg";
          try {
            const dataUrl = await readFileAsDataUrl(file);
            return {
              id: assetId,
              file,
              fileName: file.name,
              mimeType,
              size: file.size,
              previewUrl: dataUrl,
              ready: true,
            } satisfies PlatformImageAsset;
          } catch (fileError: unknown) {
            const msg = fileError instanceof Error ? fileError.message : "图片读取失败";
            return {
              id: assetId,
              file,
              fileName: file.name,
              mimeType,
              size: file.size,
              previewUrl: null,
              ready: false,
              readError: msg,
            } satisfies PlatformImageAsset;
          }
        }),
      );
      setAssets((prev) => [...prev, ...newAssets]);
      const failed = newAssets.filter((a) => !a.ready);
      if (failed.length === newAssets.length) {
        setError("图片读取失败，请重试");
      } else if (failed.length > 0) {
        setError(`${failed.length} 张图片读取失败，其余已添加`);
      }
    })();
  }, []);

  const removeAsset = useCallback((id: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== id));
    setError(null);
    setAnalysis(null);
    setImagePipelineDebug({});
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!allAssetsReady || busy) return;

    if (!supervisorAccess) {
      try {
        const accessCheck = await checkAccessMutation.mutateAsync({ featureType: "analysis" });
        if (!accessCheck.allowed) {
          toast.error("分析次数已用完，请升级套餐或联系管理员");
          return;
        }
      } catch (accessError: unknown) {
        toast.error(accessError instanceof Error ? accessError.message : "无法检查使用权限");
        return;
      }
    }

    setBusy(true);
    setStage("uploading");
    setUploadProgress(0);
    setAnalysisProgress({ percent: 0, phase: "upload", label: "准备上传素材" });
    setError(null);
    setAnalysis(null);
    setPartialAnalyses([]);
    setMergePending(false);
    setImagePipelineDebug({});

    try {
      const result = await runGrowthCampAssetAnalysis({
        images: assets,
        video: videoAsset,
        context: context.trim() || undefined,
        userId: user?.id ? String(user.id) : undefined,
        mergeStrategy: "fast",
        getSignedUploadUrl: (input) => getVideoUploadSignedUrlMutation.mutateAsync(input),
        onUploadProgress: (percent) => {
          setUploadProgress(percent);
          if (percent >= 100) setStage("analyzing");
        },
        onProgressUpdate: (update) => {
          setAnalysisProgress(update);
          if (update.phase === "merge") setMergePending(true);
          if (update.phase === "done") setMergePending(false);
          if (update.phase !== "upload") setStage("analyzing");
        },
        onPartialResult: (partial) => {
          setPartialAnalyses((prev) => {
            if (prev.some((p) => p.id === partial.id)) return prev;
            return [...prev, partial];
          });
        },
        onDebugUpdate: (patch) => {
          setImagePipelineDebug((prev) => {
            const next = typeof patch === "function" ? patch(prev) : patch;
            return { ...prev, ...next };
          });
        },
      });
      setAnalysis(result.analysis);
      setStage("done");
      setUploadProgress(100);
      toast.success("素材视觉分析完成");
    } catch (analysisError: unknown) {
      const raw = analysisError instanceof Error ? analysisError.message : "素材分析失败";
      const msg = sanitizePlatformUserMessage(raw, "素材分析暂时不可用，请稍后重试");
      setError(msg);
      setStage("error");
    } finally {
      setBusy(false);
    }
  }, [
    allAssetsReady,
    assets,
    busy,
    checkAccessMutation,
    context,
    getVideoUploadSignedUrlMutation,
    supervisorAccess,
    user?.id,
    videoAsset,
  ]);

  const stageLabel =
    stage === "uploading"
      ? `正在上传素材… ${uploadProgress}%`
      : stage === "analyzing"
        ? `${analysisProgress.label}${analysisProgress.detail ? ` · ${analysisProgress.detail}` : ""}`
        : null;

  const analysisPreviewAssets = useMemo(
    () => [
      ...(videoAsset?.previewUrl
        ? [{ id: videoAsset.id, previewUrl: videoAsset.previewUrl, fileName: videoAsset.fileName, kind: "video" as const }]
        : []),
      ...assets
        .filter((a) => a.previewUrl)
        .map((a) => ({
          id: a.id,
          previewUrl: a.previewUrl,
          fileName: a.fileName,
          kind: "image" as const,
        })),
    ],
    [assets, videoAsset],
  );

  const displayPercent =
    stage === "uploading"
      ? Math.max(1, Math.min(12, Math.round(uploadProgress * 0.12)))
      : analysisProgress.percent;

  return (
    <>
      <div className="mb-5 grid gap-2 sm:grid-cols-3">
        <PlatformWorkspaceStepHint
          step={1}
          title="上传并分析"
          lines={["添加封面/分镜 PNG/JPG，或 1 个 MP4 参考视频。", "点击「开始视觉分析」，结果只绑定你的素材。"]}
          active={!analysis && !busy}
          done={Boolean(analysis)}
        />
        <PlatformWorkspaceStepHint
          step={2}
          title="深度优化"
          lines={["基于分析改写封面、分镜与发布稿。", `消耗 ${optimizeCopyCost} 积分，引用近期热点、不用旧套话。`]}
          active={Boolean(analysis) && !optimizedMarkdown}
          done={Boolean(optimizedMarkdown)}
        />
        <PlatformWorkspaceStepHint
          step={3}
          title="生成图片"
          lines={["用优化稿直接出分镜或图文卡片。", `分镜 ${storyboardCost} 积分 · 卡片 ${cardCost} 积分。`]}
          active={Boolean(optimizedMarkdown)}
          done={false}
        />
      </div>

      <div className="mb-4">
        <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#c9c0e6]/60 mb-1.5 block">
          业务背景（可选）
        </label>
        <textarea
          className="w-full min-h-[88px] resize-y rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] px-4 py-3 text-sm leading-relaxed text-white placeholder-[#6d6384] focus:border-[#6ee7b7]/50 focus:outline-none focus:ring-1 focus:ring-[#6ee7b7]/30 transition"
          placeholder="例：哈佛医学博士×苏东坡×情绪免疫力；目标平台小红书+视频号；封面主标「别把情绪熬成血管病」…"
          value={context}
          onChange={(e) => setContext(e.target.value)}
          disabled={busy || disabled}
        />
      </div>

      <div className="mb-4 rounded-2xl border border-dashed border-white/15 bg-black/25 p-5">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,.png,.jpg,.jpeg"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            if (files.length) ingestImages(files);
          }}
        />
        <input
          ref={videoFileInputRef}
          type="file"
          accept="video/mp4,.mp4,video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) ingestVideo(file);
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || disabled}
            className="inline-flex items-center gap-2 rounded-full border border-[#6ee7b7]/30 bg-[rgba(52,211,153,0.1)] px-4 py-2 text-sm font-semibold text-[#6ee7b7] transition hover:bg-[rgba(52,211,153,0.18)] disabled:opacity-50"
          >
            <FileUp className="h-4 w-4" />
            添加 PNG / JPG
          </button>
          <button
            type="button"
            onClick={() => videoFileInputRef.current?.click()}
            disabled={busy || disabled}
            className="inline-flex items-center gap-2 rounded-full border border-[#8cefff]/30 bg-[rgba(140,239,255,0.08)] px-4 py-2 text-sm font-semibold text-[#8cefff] transition hover:bg-[rgba(140,239,255,0.15)] disabled:opacity-50"
          >
            <Film className="h-4 w-4" />
            添加 MP4 视频
          </button>
          <span className="text-xs text-[#c9c0e6]/50">
            图片可多张；视频每次 1 个，可与图片一起分析
          </span>
        </div>

        {readyAssetCount + readyVideoCount > 0 ? (
          <p className="mt-3 text-[11px] text-[#c9c0e6]/60">
            当前{" "}
            {readyAssetCount > 0 ? (
              <>
                <strong className="text-white/85">{readyAssetCount}</strong> 张图片
              </>
            ) : null}
            {readyAssetCount > 0 && readyVideoCount > 0 ? " · " : null}
            {readyVideoCount > 0 ? (
              <>
                <strong className="text-white/85">{readyVideoCount}</strong> 个视频
              </>
            ) : null}{" "}
            · 合计 <strong className="text-[#6ee7b7]">{analysisCost} 积分</strong>
            {readyAssetCount + readyVideoCount > 1 ? (
              <span className="text-white/40">
                （{unitCost} × {readyAssetCount + readyVideoCount}）
              </span>
            ) : null}
          </p>
        ) : null}

        {videoAsset ? (
          <div className="mt-4">
            <div
              className={`relative max-w-sm rounded-xl border overflow-hidden ${
                videoAsset.ready ? "border-[#8cefff]/25" : "border-red-400/40"
              }`}
            >
              {videoAsset.previewUrl ? (
                <div className="relative flex min-h-[120px] max-h-[220px] items-center justify-center bg-black/30 p-1.5">
                  <img
                    src={videoAsset.previewUrl}
                    alt={videoAsset.fileName}
                    className="max-h-[208px] w-full object-contain"
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <Film className="h-10 w-10 text-white/50" />
                  </div>
                </div>
              ) : (
                <div className="flex min-h-[120px] items-center justify-center bg-black/40 px-2 py-8 text-center text-xs text-red-300">
                  {videoAsset.readError || "视频读取中…"}
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 py-2">
                <div className="truncate text-[10px] text-white/80">{videoAsset.fileName}</div>
                {videoAsset.durationSeconds > 0 ? (
                  <div className="text-[10px] text-[#8cefff]/70">{videoAsset.durationSeconds}s</div>
                ) : null}
              </div>
              {!busy && !disabled ? (
                <button
                  type="button"
                  onClick={removeVideo}
                  className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1 text-white/80 hover:text-white"
                  aria-label="移除视频"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {assets.length > 0 ? (
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className={`relative rounded-xl border overflow-hidden ${
                  asset.ready ? "border-white/10" : "border-red-400/40"
                }`}
              >
                {asset.previewUrl ? (
                  <div className="flex min-h-[100px] max-h-[220px] items-center justify-center bg-black/30 p-1.5">
                    <img
                      src={asset.previewUrl}
                      alt={asset.fileName}
                      className="max-h-[208px] w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex min-h-[100px] items-center justify-center bg-black/40 px-2 py-8 text-center text-xs text-red-300">
                    {asset.readError || "读取失败"}
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2 py-2">
                  <div className="truncate text-[10px] text-white/80">{asset.fileName}</div>
                </div>
                {!busy && !disabled ? (
                  <button
                    type="button"
                    onClick={() => removeAsset(asset.id)}
                    className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1 text-white/80 hover:text-white"
                    aria-label="移除"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : !videoAsset ? (
          <div className="mt-4 flex flex-col items-center justify-center gap-2 py-8 text-[#c9c0e6]/40">
            <ImageIcon className="h-8 w-8 opacity-40" />
            <span className="text-xs">尚未添加素材</span>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {supervisorAccess ? (
          <p className="text-[11px] text-emerald-200/80">Supervisor / Admin：本次分析免扣积分</p>
        ) : readyAssetCount + readyVideoCount > 0 ? (
          <p className="text-[11px] text-[#c9c0e6]/60">
            开始分析将消耗 <strong className="text-[#6ee7b7]">{analysisCost} 积分</strong>
          </p>
        ) : null}
        <button
          type="button"
          onClick={() => void handleAnalyze()}
          disabled={busy || disabled || !allAssetsReady}
          className="inline-flex items-center gap-2 rounded-full border border-[#6ee7b7]/30 bg-[linear-gradient(135deg,#34d399,#059669)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_6px_24px_rgba(52,211,153,0.22)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              分析中…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {supervisorAccess || analysisCost <= 0
                ? "开始视觉分析"
                : `开始视觉分析（${analysisCost} 积分）`}
            </>
          )}
        </button>
        {(analysis || error || assets.length > 0 || videoAsset) && !busy ? (
          <button
            type="button"
            onClick={() => {
              setAssets([]);
              setVideoAsset(null);
              setAnalysis(null);
              setPartialAnalyses([]);
              setMergePending(false);
              setError(null);
              setContext("");
              setImagePipelineDebug({});
              setStage("idle");
              setUploadProgress(0);
              setOptimizedMarkdown(null);
              setOptimizeSummary(null);
            }}
            className="inline-flex items-center gap-1 text-xs text-[#c9c0e6]/60 hover:text-white transition"
          >
            <Trash2 className="h-3.5 w-3.5" />
            清除
          </button>
        ) : null}
      </div>

      {busy && stage === "uploading" && stageLabel ? (
        <div className="mt-5 flex items-center gap-2 rounded-2xl border border-[#6ee7b7]/15 bg-[rgba(52,211,153,0.05)] px-4 py-3 text-sm text-[#6ee7b7]/80">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#34d399]" />
          {stageLabel}
        </div>
      ) : null}

      {busy && stage === "analyzing" ? (
        <AssetAnalysisWaitPanel
          percent={displayPercent}
          label={analysisProgress.label || stageLabel || "正在分析您的素材…"}
          detail={analysisProgress.detail}
          assets={analysisPreviewAssets}
        />
      ) : null}

      {error ? (
        <div className="mt-5 rounded-2xl border border-red-500/25 bg-[rgba(239,68,68,0.08)] px-4 py-3 text-sm text-red-300">
          ❌ {error}
        </div>
      ) : null}

      {partialAnalyses.length > 1 || (busy && partialAnalyses.length > 0) ? (
        <div className="mt-5 space-y-4">
          {partialAnalyses.map((partial) => (
            <AssetAnalysisResultBlock
              key={partial.id}
              title={partial.kind === "video" ? "参考视频分析" : "封面 / 图片分析"}
              badge={busy ? "已完成 · 可先阅读" : undefined}
              analysis={partial.analysis}
            />
          ))}
          {mergePending ? (
            <div className="flex items-center gap-2 rounded-xl border border-[#49e6ff]/20 bg-[#49e6ff]/5 px-4 py-3 text-sm text-[#8cefff]/90">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              正在汇总综合报告…
            </div>
          ) : null}
        </div>
      ) : null}

      {analysis && partialAnalyses.length > 1 ? (
        <AssetAnalysisResultBlock
          title="综合报告"
          badge="视频 + 图片汇总"
          analysis={analysis}
          className="mt-5"
        />
      ) : null}

      {analysis && partialAnalyses.length <= 1 && !busy ? (
        <AssetAnalysisResultBlock analysis={analysis} className="mt-6" />
      ) : null}

      {analysis && !busy ? (
        <div className="mt-4 space-y-5">
          {analysis.remixExecution?.imageTextNoteGuide?.titleOptions?.length ||
          analysis.remixExecution?.imageTextNoteGuide?.structuredBody ||
          analysis.remixExecution?.imageTextNoteGuide?.coverSetup ? (
            <div className="space-y-3 rounded-xl border border-[#8cefff]/15 bg-[rgba(140,239,255,0.04)] p-4">
              <div className="text-[11px] font-semibold text-[#8cefff]/80">图文笔记改法</div>
              {analysis.remixExecution.imageTextNoteGuide.coverSetup ? (
                <p className="text-sm leading-7 text-white/85 whitespace-pre-wrap">
                  {analysis.remixExecution.imageTextNoteGuide.coverSetup}
                </p>
              ) : null}
              {analysis.remixExecution.imageTextNoteGuide.titleOptions?.length ? (
                <ul className="space-y-1 text-sm text-[#fde047]/90">
                  {analysis.remixExecution.imageTextNoteGuide.titleOptions.slice(0, 5).map((title, i) => (
                    <li key={`note-title-${i}`}>· {title}</li>
                  ))}
                </ul>
              ) : null}
              {analysis.remixExecution.imageTextNoteGuide.structuredBody ? (
                <p className="text-sm leading-7 text-white/85 whitespace-pre-wrap">
                  {analysis.remixExecution.imageTextNoteGuide.structuredBody}
                </p>
              ) : null}
            </div>
          ) : null}

          {onDeepOptimize ? (
            <div className="flex flex-wrap gap-2 pt-1 border-t border-white/10">
              <button
                type="button"
                disabled={disabled || busy || optimizeBusy || generateBusy}
                onClick={() => {
                  void (async () => {
                    setOptimizeBusy(true);
                    try {
                      const payload = formatAssetAnalysisForOptimize(analysis, context);
                      const res = await onDeepOptimize(payload);
                      setOptimizedMarkdown(res.optimizedMarkdown);
                      setOptimizeSummary(res.summary);
                      toast.success("深度优化完成");
                    } catch (e: unknown) {
                      toast.error(e instanceof Error ? e.message : "深度优化失败");
                    } finally {
                      setOptimizeBusy(false);
                    }
                  })();
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#fbbf24]/30 bg-[linear-gradient(135deg,#fbbf24,#f97316)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {optimizeBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                步骤 2 · 深度优化（{optimizeCopyCost} 积分）
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {optimizedMarkdown ? (
        <div className="mt-5 space-y-3 rounded-2xl border border-[#fbbf24]/25 bg-[rgba(251,191,36,0.06)] p-5">
          <div className="text-xs font-semibold text-[#fcd34d]/85">
            步骤 2 完成{optimizeSummary ? ` · ${optimizeSummary}` : ""}
          </div>
          <div className="max-h-48 overflow-auto whitespace-pre-wrap text-sm leading-7 text-white/88">{optimizedMarkdown}</div>
          {onGenerateFromText ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={disabled || busy || optimizeBusy || generateBusy}
                onClick={() => {
                  void (async () => {
                    setGenerateBusy(true);
                    try {
                      await onGenerateFromText(optimizedMarkdown, "storyboard_sheet_landscape");
                      toast.success("分镜图生成完成，请在本 Tab 下方查看");
                    } catch (e: unknown) {
                      toast.error(e instanceof Error ? e.message : "生成失败");
                    } finally {
                      setGenerateBusy(false);
                    }
                  })();
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#49e6ff]/30 bg-[linear-gradient(135deg,#49e6ff,#6a5cff)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {generateBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Film className="h-3.5 w-3.5" />}
                步骤 3 · 生成分镜（{storyboardCost} 积分）
              </button>
              <button
                type="button"
                disabled={disabled || busy || optimizeBusy || generateBusy}
                onClick={() => {
                  void (async () => {
                    setGenerateBusy(true);
                    try {
                      await onGenerateFromText(optimizedMarkdown, "single_page_knowledge_card");
                      toast.success("图文卡片生成完成，请在本 Tab 下方查看");
                    } catch (e: unknown) {
                      toast.error(e instanceof Error ? e.message : "生成失败");
                    } finally {
                      setGenerateBusy(false);
                    }
                  })();
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#ff4fb8]/30 bg-[linear-gradient(135deg,#ff4fb8,#c026d3)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {generateBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                步骤 3 · 生成图文卡片（{cardCost} 积分）
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {debugMode ? (
        <div className="mt-6 rounded-2xl border border-emerald-200/15 bg-black/15 p-4 text-xs text-white/75">
          <div className="text-xs uppercase tracking-[0.16em] text-emerald-100">素材分析 Debug</div>
          <div className="mt-3 space-y-2 leading-6">
            <div>1. 图片素材：{assets.map((a) => a.fileName).join("、") || "-"}</div>
            <div>
              2. 上传：{String(imagePipelineDebug.upload?.status || "idle")} / 进度{" "}
              {String(imagePipelineDebug.upload?.progress ?? uploadProgress ?? "-")}%
            </div>
            <div>3. 上传明细：</div>
            {Array.isArray(imagePipelineDebug.assets) && imagePipelineDebug.assets.length ? (
              <div className="space-y-1 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                {imagePipelineDebug.assets.map((item, index) => (
                  <div key={`img-debug-${index}`}>
                    {String(item.fileName || `图片 ${index + 1}`)} · {String(item.status || "-")}
                    {item.gcsUri ? ` · ${String(item.gcsUri)}` : ""}
                    {item.error ? ` · 错误 ${String(item.error)}` : ""}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-white/55">
                等待上传或尚未开始
              </div>
            )}
            <div>
              4. 派发：路由 {String(imagePipelineDebug.dispatch?.route || "growth_analyze_images")} / 模式{" "}
              {String(imagePipelineDebug.dispatch?.mode || "GROWTH")} / 状态{" "}
              {String(imagePipelineDebug.dispatch?.status || "idle")}
            </div>
            <div>
              5. Job：ID {String(imagePipelineDebug.job?.jobId || "-")} / 状态{" "}
              {String(imagePipelineDebug.job?.serverStatus || imagePipelineDebug.job?.status || "-")} / 轮询{" "}
              {String(imagePipelineDebug.job?.pollCount ?? "-")} 次
              {typeof imagePipelineDebug.job?.elapsedMs === "number"
                ? ` / 已等待 ${Math.round(imagePipelineDebug.job.elapsedMs / 1000)} 秒`
                : ""}
            </div>
            <div>
              6. 分析：{String(imagePipelineDebug.analysis?.status || "idle")}
            </div>
            <div>
              7. 图片数：{String(imagePipelineDebug.analysis?.imageCount ?? assets.length)}
            </div>
            <div>
              8. 失败原因：{sanitizePlatformUserMessage(
                String(imagePipelineDebug.analysis?.error || error || "-"),
                "-",
              )}
            </div>
            <div className="mt-4 rounded-xl border border-fuchsia-200/10 bg-black/15 px-3 py-2 text-white/55">
              Growth 运行控制（live / 回填 / 各平台累计）见页顶 Debug 面板。
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
