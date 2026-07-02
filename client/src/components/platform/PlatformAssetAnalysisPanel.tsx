import React, { useCallback, useMemo, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  GROWTH_CAMP_IMAGE_PIPELINE_DEBUG_NOTE,
  isGrowthCampImageFile,
  newPlatformImageAssetId,
  normalizeGrowthCampImageMime,
  readFileAsDataUrl,
  runGrowthCampImageAnalysis,
  type ImagePipelineDebugState,
  type PlatformImageAsset,
} from "@/lib/growthCampImagePipeline";
import type { GrowthAnalysisScores } from "@shared/growth";
import { CREDIT_COSTS, platformAssetAnalysisTotalCredits } from "@shared/plans";
import { FileUp, Image, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";

type PlatformAssetAnalysisPanelProps = {
  debugMode: boolean;
  supervisorAccess: boolean;
  disabled?: boolean;
};

export default function PlatformAssetAnalysisPanel({
  debugMode,
  supervisorAccess,
  disabled = false,
}: PlatformAssetAnalysisPanelProps) {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [assets, setAssets] = useState<PlatformImageAsset[]>([]);
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stage, setStage] = useState<"idle" | "uploading" | "analyzing" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<GrowthAnalysisScores | null>(null);
  const [imagePipelineDebug, setImagePipelineDebug] = useState<ImagePipelineDebugState>({});

  const getVideoUploadSignedUrlMutation = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  const checkAccessMutation = trpc.usage.checkFeatureAccess.useMutation();
  const growthSystemStatusQuery = trpc.mvAnalysis.getGrowthSystemStatus.useQuery(undefined, {
    enabled: debugMode && supervisorAccess,
    refetchInterval: debugMode ? 30_000 : false,
  });

  const allAssetsReady = useMemo(
    () => assets.length > 0 && assets.every((a) => a.ready),
    [assets],
  );

  const readyAssetCount = useMemo(() => assets.filter((a) => a.ready).length, [assets]);
  const analysisCost = useMemo(
    () => platformAssetAnalysisTotalCredits(readyAssetCount),
    [readyAssetCount],
  );
  const unitCost = CREDIT_COSTS.growthCampGrowth;

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
    setError(null);
    setAnalysis(null);
    setImagePipelineDebug({});

    try {
      const result = await runGrowthCampImageAnalysis({
        assets,
        context: context.trim() || undefined,
        userId: user?.id ? String(user.id) : undefined,
        getSignedUploadUrl: (input) => getVideoUploadSignedUrlMutation.mutateAsync(input),
        onUploadProgress: (percent) => {
          setUploadProgress(percent);
          if (percent >= 100) setStage("analyzing");
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
      const msg = analysisError instanceof Error ? analysisError.message : "图片分析失败";
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
  ]);

  const stageLabel =
    stage === "uploading"
      ? `正在上传素材… ${uploadProgress}%`
      : stage === "analyzing"
        ? "正在 GPT-5.5 视觉分析，约需 30–90 秒…"
        : null;

  return (
    <>
      <p className="mb-5 text-sm leading-relaxed text-[#c9c0e6]/80">
        上传封面、2×4 分镜等 PNG/JPG 素材（可多次添加，张数不限），系统用 GPT-5.5 做视觉与商业战略分析。
        每张素材 <strong className="text-[#6ee7b7]">{unitCost} 积分</strong>，按实际上传张数合计。
        本步骤<strong className="text-[#6ee7b7]">不调用成长营套话快照</strong>，结果可直接用于后续「优化自定义文案」。
        {debugMode ? (
          <span className="block mt-2 text-[11px] text-emerald-200/70">{GROWTH_CAMP_IMAGE_PIPELINE_DEBUG_NOTE}</span>
        ) : null}
      </p>

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
          <span className="text-xs text-[#c9c0e6]/50">可多次添加封面、分镜等；建议单张 &lt; 8MB</span>
        </div>

        {readyAssetCount > 0 ? (
          <p className="mt-3 text-[11px] text-[#c9c0e6]/60">
            当前 <strong className="text-white/85">{readyAssetCount}</strong> 张 · 合计{" "}
            <strong className="text-[#6ee7b7]">{analysisCost} 积分</strong>
            {readyAssetCount > 1 ? (
              <span className="text-white/40">（{unitCost} × {readyAssetCount}）</span>
            ) : null}
          </p>
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
        ) : (
          <div className="mt-4 flex flex-col items-center justify-center gap-2 py-8 text-[#c9c0e6]/40">
            <Image className="h-8 w-8 opacity-40" />
            <span className="text-xs">尚未添加素材</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {supervisorAccess ? (
          <p className="text-[11px] text-emerald-200/80">Supervisor / Admin：本次分析免扣积分</p>
        ) : readyAssetCount > 0 ? (
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
        {(analysis || error || assets.length > 0) && !busy ? (
          <button
            type="button"
            onClick={() => {
              setAssets([]);
              setAnalysis(null);
              setError(null);
              setContext("");
              setImagePipelineDebug({});
              setStage("idle");
              setUploadProgress(0);
            }}
            className="inline-flex items-center gap-1 text-xs text-[#c9c0e6]/60 hover:text-white transition"
          >
            <Trash2 className="h-3.5 w-3.5" />
            清除
          </button>
        ) : null}
      </div>

      {busy && stageLabel ? (
        <div className="mt-5 flex items-center gap-2 rounded-2xl border border-[#6ee7b7]/15 bg-[rgba(52,211,153,0.05)] px-4 py-3 text-sm text-[#6ee7b7]/80">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#34d399]" />
          {stageLabel}
        </div>
      ) : null}

      {error ? (
        <div className="mt-5 rounded-2xl border border-red-500/25 bg-[rgba(239,68,68,0.08)] px-4 py-3 text-sm text-red-300">
          ❌ {error}
        </div>
      ) : null}

      {analysis ? (
        <div className="mt-6 space-y-4 rounded-2xl border border-[#6ee7b7]/25 bg-[rgba(52,211,153,0.06)] p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-[#6ee7b7]/80">视觉分析结果</div>
          {analysis.summary ? (
            <p className="text-sm leading-7 text-white/90 whitespace-pre-wrap">{analysis.summary}</p>
          ) : null}
          {analysis.visualSummary ? (
            <div>
              <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-1">画面摘要</div>
              <p className="text-sm leading-7 text-white/85 whitespace-pre-wrap">{analysis.visualSummary}</p>
            </div>
          ) : null}
          {analysis.strengths?.length ? (
            <div>
              <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-1">优势</div>
              <ul className="list-disc pl-5 space-y-1 text-sm text-white/85">
                {analysis.strengths.map((item, i) => (
                  <li key={`strength-${i}`}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {analysis.improvements?.length ? (
            <div>
              <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-1">改进建议</div>
              <ul className="list-disc pl-5 space-y-1 text-sm text-white/85">
                {analysis.improvements.map((item, i) => (
                  <li key={`improve-${i}`}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {analysis.platforms?.length ? (
            <div className="text-xs text-[#8cefff]/80">
              推荐平台：{analysis.platforms.join(" · ")}
            </div>
          ) : null}
          {analysis.titleSuggestions?.length ? (
            <div>
              <div className="text-[11px] font-semibold text-[#c9c0e6]/60 mb-1">标题建议</div>
              <ul className="space-y-1 text-sm text-[#fde047]/90">
                {analysis.titleSuggestions.slice(0, 5).map((title, i) => (
                  <li key={`title-${i}`}>· {title}</li>
                ))}
              </ul>
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
              {String(imagePipelineDebug.job?.status || "-")} / 轮询{" "}
              {String(imagePipelineDebug.job?.pollCount ?? "-")} 次
            </div>
            <div>
              6. 分析：{String(imagePipelineDebug.analysis?.status || "idle")} / Provider{" "}
              {String(imagePipelineDebug.analysis?.provider || "-")} / Model{" "}
              {String(imagePipelineDebug.analysis?.model || "-")}
            </div>
            <div>
              7. 图片数：{String(imagePipelineDebug.analysis?.imageCount ?? assets.length)} / 降级{" "}
              {String(imagePipelineDebug.analysis?.fallback ?? "-")}
            </div>
            <div>8. 失败原因：{String(imagePipelineDebug.analysis?.error || error || "-")}</div>
          </div>

          {growthSystemStatusQuery.data ? (
            <div className="mt-4 rounded-xl border border-fuchsia-200/15 bg-black/20 px-3 py-2">
              <div className="font-semibold text-fuchsia-100">Growth 系统状态</div>
              <div className="mt-2 space-y-1 text-white/65">
                <div>
                  运行模式：{String(growthSystemStatusQuery.data.runtimeControl?.mode || "-")} / Burst{" "}
                  {String(growthSystemStatusQuery.data.runtimeControl?.burst || "-")}
                </div>
                <div>
                  服务健康：{String(growthSystemStatusQuery.data.serviceHealth?.label || "-")} · 真值来源{" "}
                  {String(growthSystemStatusQuery.data.truthStore?.source || "-")}
                </div>
              </div>
            </div>
          ) : growthSystemStatusQuery.isLoading ? (
            <div className="mt-4 text-white/45">正在拉取 Growth 系统状态…</div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
