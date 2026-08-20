import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CANVAS_BLOCK_DEFAULT_HEIGHT,
  CANVAS_BLOCK_DEFAULT_WIDTH,
  CANVAS_BLOCK_MAX_HEIGHT,
  CANVAS_BLOCK_MAX_WIDTH,
  CANVAS_BLOCK_MIN_HEIGHT,
  CANVAS_BLOCK_MIN_WIDTH,
  CANVAS_KIND_META,
  CANVAS_UPLOAD_ACCEPT,
  collectDocumentAssets,
  collectUpstreamHandoff,
  collectUpstreamTexts,
  collectVisionImages,
  defaultCanvasBlock,
  DEFAULT_CANVAS_VIDEO_MODEL,
  IMAGE_MODEL_OPTIONS,
  makeCanvasBlockId,
  resolveBlockHandoffText,
  resolveNearestUpstreamImageUrl,
  SPAWN_KIND_OPTIONS,
  TEXT_MODEL_OPTIONS,
  isCanvasProductVideoModel,
  isCanvasSeedance25VideoModel,
  type CanvasBlock,
  type CanvasBlockKind,
  type CanvasEdge,
  type CanvasImageBatchCount,
  type CanvasUploadedAsset,
} from "@/lib/canvasTypes";
import { SEEDANCE_25_PAID_ONLY_LABEL_ZH } from "@shared/seedance25Access";
import { normalizeSeedance25EvolinkMode } from "@shared/seedanceEvolinkModels";
import {
  downgradeUnauthorizedSeedance25Blocks,
  filterCanvasVideoModelOptions,
  resolveCanvasSeedance25Gate,
} from "@/lib/canvasSeedanceGate";
import {
  canUsePaidVideoByPlan,
  PAID_VIDEO_MEMBER_ONLY_LABEL_ZH,
} from "@shared/paidVideoAccess";
import {
  CANVAS_IMAGE_BATCH_OPTIONS,
} from "@/lib/canvasCredits";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  CANVAS_VIDEO_RESOLUTIONS,
  canvasVideoClipCredits,
  normalizeCanvasVideoResolution,
} from "@shared/canvasGenerationPricing";
import { isCanvasUploadableFile, inferCanvasAssetKindFromFileName, takeFilesFromInput, uploadCanvasFilesParallel, uploadOneCanvasAsset, CANVAS_UPLOAD_CONCURRENCY } from "@/lib/canvasUpload";
import { loadCanvasDocumentTexts } from "@/lib/canvasDocumentText";
import { runCanvasBlock, type CanvasRunDeps } from "@/lib/canvasRunBlock";
import {
  collectManhuaEpisodeSegmentPromptsForVoiceGate,
  countManhuaClipAssetEdges,
  expectedMinManhuaClipAssetEdges,
  getBlockEpisodeIndex,
  resolveManhuaClipRelatedAssetNodeIds,
  sanitizeManhuaRecapUpstreamLinks,
  syncManhuaClipAssetEdges,
} from "@/lib/canvasDramaStudio";
import { tryLocalMediaDisplayForBlock } from "@/lib/manhuaLocalMediaStore";
import {
  MANHUA_CLIP_CONTINUITY_HINT_ZH,
  MANHUA_CLIP_CROSS_SEGMENT_TRANSITION_HINT_ZH,
  resolvePreviousSegmentClipUrl,
} from "@shared/manhuaClipContinuity";
import { resolveClipSegmentIndex } from "@shared/manhuaScriptWorkbench";
import {
  parseManhuaAssetImageBindBlock,
  parseManhuaCanvasAssetAtTag,
  sanitizeManhuaClipPromptForUi,
  type ManhuaAssetLockRegistry,
  type ManhuaMentionCandidate,
} from "@shared/manhuaAssetLockRegistry";
import type { ManhuaWriterAssetCanon } from "@shared/manhuaWriterAssetCanon";
import ManhuaPromptMentionEditor from "@/components/ManhuaPromptMentionEditor";
import {
  evaluateManhuaCrossSegmentVoiceGate,
  type ManhuaCharacterVoiceLock,
} from "@shared/manhuaCharacterVoiceLock";
import { resolveClipLocalSegmentIndex } from "@shared/manhuaScriptWorkbench";
import {
  parseManhuaClipDirectorCardSummary,
} from "@shared/manhuaClipDirectorCard";
import { CanvasImageEditMaskPainter } from "@/components/canvas/CanvasImageEditMaskPainter";
import { eraseAiCornerMark } from "@/lib/eraseAiCornerMarkApi";
import {
  fetchVideoUpscaleStatus,
  isVideoUpscaleTerminal,
  probeVideoDurationSec,
  startVideoUpscale,
  videoUpscaleStatusLabel,
} from "@/lib/videoUpscaleApi";
import { canvasVideoUpscaleCredits } from "@shared/canvasGenerationPricing";
import { trpc } from "@/lib/trpc";
import {
  Clapperboard,
  LoaderCircle,
  Maximize2,
  Plus,
  Search,
  Sparkles,
  Upload,
  X,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

/** 左栏节点列表标题（学参考画布：可读名 + 类型，不泄供应商） */
function freeformNodeListLabel(block: CanvasBlock): string {
  const id = String(block.id || "");
  const promptHead = String(block.prompt || "")
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("【"))
    ?.slice(0, 18);
  if (id.startsWith("charsheet-face-")) return `脸·${promptHead || id.replace(/^charsheet-face-/, "").slice(0, 12)}`;
  if (id.startsWith("charsheet-")) return `角色·${promptHead || id.replace(/^charsheet-/, "").slice(0, 12)}`;
  if (id.startsWith("sceneplate-")) return `场景·${promptHead || id.replace(/^sceneplate-/, "").slice(0, 12)}`;
  if (id.startsWith("propsheet-")) return `道具·${promptHead || id.replace(/^propsheet-/, "").slice(0, 12)}`;
  if (id.startsWith("keyart-")) {
    const m = id.match(/s(\d+)/i);
    return m ? `静帧 s${m[1]}` : `静帧·${promptHead || "分镜"}`;
  }
  if (id.startsWith("clip-")) {
    const m = id.match(/g(\d+)/i);
    return m ? `成片 第${String(Number(m[1])).padStart(2, "0")}段` : `成片·${promptHead || "片段"}`;
  }
  return `${CANVAS_KIND_META[block.kind]?.label || "节点"}·${promptHead || id.slice(0, 14)}`;
}

function isCanvasAssetSheetId(id: string): boolean {
  return /^(charsheet-|sceneplate-|propsheet-)/.test(String(id || ""));
}

type BlocksUpdater = CanvasBlock[] | ((prev: CanvasBlock[]) => CanvasBlock[]);

type FreeformCanvasProps = {
  blocks: CanvasBlock[];
  edges: CanvasEdge[];
  onBlocksChange: (blocks: BlocksUpdater) => void;
  onEdgesChange: (edges: CanvasEdge[]) => void;
  runDeps: CanvasRunDeps;
  /** 外部请求选中并滚入视口（成片坞定位） */
  focusBlockId?: string | null;
  onFocusBlockConsumed?: () => void;
  /**
   * media：只渲染图片/视频节点（隐藏文本生成等），突出媒体与 prompt。
   * full：全部节点（自由画布 / 专家排错）。
   */
  presentation?: "full" | "media";
  /** 仅显示该集工厂节点；不传则不过滤 */
  focusEpisode?: number | null;
  /** 限制「添加节点」菜单；默认 SPAWN_KIND_OPTIONS 全量 */
  spawnKinds?: CanvasBlockKind[];
  /** 角色声线参考（按 @角色 挂到定妆卡） */
  characterVoiceLocks?: ManhuaCharacterVoiceLock[];
  onReplaceCharacterVoiceAudio?: (input: {
    characterTag: string;
    audioUrl: string;
    labelZh?: string;
  }) => void;
  /** 嵌入工作台右栏时占满父级高度，由内部画布单独滚动 */
  fillContainer?: boolean;
  /**
   * 漫剧：成片 clip-* 节点的秒轴框接入 @ 资产面板（候选=本集资产库+设定表）。
   * 不传时 clip 节点退回纯文本框（非漫剧画布不受影响）。
   */
  manhuaMention?: {
    registry: ManhuaAssetLockRegistry | null;
    assetCanon: ManhuaWriterAssetCanon | null;
    thumbUrlByAssetId?: Record<string, string>;
    onRequestGenerateAsset?: (candidate: ManhuaMentionCandidate) => void;
  };
  /**
   * 漫剧节点重跑前重编译提示词（设定图/静帧/成片）。
   * 返回 patch 则写入节点后再跑；返回 null 则沿用旧 prompt（自由画布非漫剧节点）。
   */
  compileManhuaRerun?: (block: CanvasBlock) => Promise<{
    prompt: string;
    outputUrl?: undefined;
    outputUrls?: string[];
    status?: "idle";
    error?: undefined;
    changed?: boolean;
    beforePrompt?: string;
    afterPrompt?: string;
  } | null>;
};

type SpawnMenuState = { anchorBlockId: string; x: number; y: number } | null;
type ToolbarMenuState = { x: number; y: number; anchorCenterY: number } | null;
type ResizeState = {
  id: string;
  startW: number;
  startH: number;
  startPointerX: number;
  startPointerY: number;
} | null;

function blockEdgeAnchor(block: CanvasBlock) {
  return { x: block.x + block.width, y: block.y + 44 };
}

function patchBlock(blocks: CanvasBlock[], id: string, patch: Partial<CanvasBlock>) {
  return blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
}

function assetKindLabel(kind: ReturnType<typeof inferCanvasAssetKindFromFileName>) {
  if (kind === "video") return "视频";
  if (kind === "document") return "文档";
  return "图片";
}

/** 关键静帧 / 定妆 / 场景 / 道具：画布只展示图 + ID，不重复整段提示词 */
function isManhuaAssetVisualBlock(block: CanvasBlock): boolean {
  return /^(keyart|charsheet|sceneplate|propplate|propsheet|prop)-/i.test(
    String(block.id || ""),
  );
}

/** 成片节点：把 @角色N 显示成对照表里的人名，避免技术编号墙 */
function friendlyManhuaAssetChipLabel(tag: string, prompt: string): string {
  const hit = parseManhuaAssetImageBindBlock(prompt).find((r) => r.tag === tag);
  const label = String(hit?.labelZh || "").trim();
  if (label) return label;
  if (tag.startsWith("@角色")) return `人物${tag.replace("@角色", "")}`;
  if (tag.startsWith("@场景")) return `场景${tag.replace("@场景", "")}`;
  if (tag.startsWith("@道具")) return `道具${tag.replace("@道具", "")}`;
  if (tag.startsWith("@服装")) return `服装${tag.replace("@服装", "")}`;
  return tag.replace(/^@/, "");
}

/** 成片节点中区：本段垫图缩略图为主，秒轴提示词降级 */
function CanvasClipPadVisualBody({ block }: { block: CanvasBlock }) {
  const prompt = String(block.prompt || "");
  const tags = Array.from(
    new Set(prompt.match(/@(?:角色|场景|道具)\d+/g) || []),
  ).slice(0, 8);
  const urls = Array.from(
    new Set(
      [
        String(block.refImageUrl || "").trim(),
        ...(block.editFusionUrls || []).map((u) => String(u || "").trim()),
        ...(block.outputUrls || []).map((u) => String(u || "").trim()),
        String(block.outputUrl || "").trim(),
      ].filter((u) => /^https?:\/\//i.test(u) || u.startsWith("data:image")),
    ),
  ).slice(0, 8);
  return (
    <div
      data-manhua-clip-pad-visual
      className="mb-2 min-h-0 flex-1 space-y-1.5 overflow-hidden"
    >
      <div className="flex flex-wrap items-center gap-1">
        <span className="rounded bg-cyan-400/30 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-50">
          本段垫图
        </span>
        {tags.map((t) => (
          <span
            key={t}
            className="rounded bg-black/35 px-1.5 py-0.5 text-[10px] text-cyan-100/90"
            title={t}
          >
            {friendlyManhuaAssetChipLabel(t, prompt)}
          </span>
        ))}
        {!tags.length ? (
          <span className="text-[10px] text-white/35">点「审阅成片提示词」后显示本段出场</span>
        ) : null}
      </div>
      {urls.length ? (
        <div className="grid min-h-0 flex-1 grid-cols-3 gap-1 overflow-hidden">
          {urls.map((u, i) => (
            <div
              key={`${u.slice(0, 48)}-${i}`}
              className="relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-black/40"
            >
              <img src={u} alt={`垫图${i + 1}`} className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-[100px] flex-1 items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/25 px-3 text-center text-[11px] leading-relaxed text-white/40">
          先出本段关键静帧，垫图会出现在这里
        </div>
      )}
    </div>
  );
}

function fileNameFromUrl(url: string | null | undefined): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const path = new URL(raw, "https://local.invalid").pathname;
    const base = path.split("/").pop() || "";
    return decodeURIComponent(base).slice(0, 48);
  } catch {
    return raw.slice(0, 48);
  }
}

function CanvasBlockUploadBanner({ block }: { block: CanvasBlock }) {
  const phase = block.uploadPhase ?? "idle";
  const message = block.uploadStatusMessage?.trim();
  const done = block.uploadProgressDone ?? 0;
  const total = block.uploadProgressTotal ?? 0;
  const successCount = block.uploadedAssets.length;
  const failCount = block.uploadFailures?.length ?? 0;

  if (phase === "uploading") {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-amber-400/25 bg-amber-500/15 px-3 py-1.5">
        <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-200" aria-hidden />
        <span className="text-[11px] font-medium text-amber-50">
          {message || (total > 0 ? `正在上传 ${done}/${total}…` : "正在上传…")}
        </span>
      </div>
    );
  }
  if (phase === "done" && successCount > 0) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-emerald-400/25 bg-emerald-500/15 px-3 py-1.5">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
        <span className="truncate text-[11px] font-medium text-emerald-50">
          {message || `上传成功 · ${successCount} 个文件`}
        </span>
      </div>
    );
  }
  if (phase === "error" || failCount > 0) {
    const firstFail = block.uploadFailures?.[0];
    return (
      <div className="flex shrink-0 items-start gap-2 border-b border-red-400/25 bg-red-500/15 px-3 py-1.5">
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" aria-hidden />
        <span className="text-[11px] leading-5 text-red-50">
          {message || firstFail?.error || "上传失败"}
          {firstFail?.fileName ? ` · ${firstFail.fileName}` : ""}
        </span>
      </div>
    );
  }
  return null;
}

/**
 * 右侧窄栏：上传只留按钮区对应的文件名列表 + 紧凑生成结果。
 * 不再占半屏空预览，空间留给左侧提示词。
 */
function CanvasBlockPreviewPanel({
  block,
  isUploading,
  displayOutputs,
}: {
  block: CanvasBlock;
  isUploading: boolean;
  displayOutputs: string[];
}) {
  const openPreview = React.useContext(CanvasImagePreviewCtx);
  const phase = block.uploadPhase ?? "idle";
  const uploading = isUploading || phase === "uploading";
  const done = block.uploadProgressDone ?? 0;
  const total = block.uploadProgressTotal ?? 0;
  const message = block.uploadStatusMessage?.trim();
  const failures = block.uploadFailures ?? [];
  const assets = block.uploadedAssets;
  const hasGeneratedOutput =
    Boolean(block.outputText?.trim()) ||
    displayOutputs.length > 0 ||
    (block.kind === "video" && Boolean(block.outputUrl));
  const progressPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-auto">
      {uploading ? (
        <div className="rounded-lg border border-amber-400/35 bg-amber-500/10 px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-amber-50">
            <LoaderCircle className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
            <span className="truncate">
              {message || (total > 0 ? `上传中 ${done}/${total}` : "上传中…")}
            </span>
          </div>
          {total > 0 ? (
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-amber-950/50">
              <div
                className="h-full rounded-full bg-amber-300 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {!uploading && failures.length > 0 ? (
        <div className="space-y-1 rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1.5">
          {failures.map((fail) => (
            <div key={`preview-fail-${fail.fileName}`} className="truncate text-[10px] text-red-50/95">
              {fail.fileName}
              <span className="text-red-200/80"> · 失败</span>
            </div>
          ))}
        </div>
      ) : null}

      {!uploading && assets.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2 py-1.5">
          {assets.map((asset) => {
            const kind = asset.kind ?? inferCanvasAssetKindFromFileName(asset.fileName) ?? "image";
            return (
              <li
                key={asset.id}
                className="flex min-w-0 items-start gap-1 text-[10px] leading-4 text-emerald-50/95"
                title={asset.fileName}
              >
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-300" aria-hidden />
                <span className="min-w-0 flex-1 break-all">
                  {asset.fileName}
                  <span className="text-emerald-200/70"> · {assetKindLabel(kind)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {block.status === "error" && block.error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1.5 text-[10px] leading-4 text-red-100">
          {block.error}
        </div>
      ) : null}

      {hasGeneratedOutput ? (
        <div className="space-y-1.5">
          <div className="text-[9px] uppercase tracking-wider text-white/35">结果</div>
          {block.outputText ? (
            <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded-md border border-white/10 bg-black/30 p-1.5 text-[10px] leading-4 text-white/80">
              {block.outputText}
            </pre>
          ) : null}
          {block.kind === "image" && displayOutputs.length > 0 ? (
            <div className={`grid gap-1 ${displayOutputs.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {displayOutputs.map((url, idx) => (
                <div key={`${url}-${idx}`} className="relative">
                  <img
                    src={url}
                    alt={`output-${idx + 1}`}
                    title="双击放大"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      openPreview?.({ url, labelZh: `结果${idx + 1}` });
                    }}
                    className="max-h-20 w-full cursor-zoom-in rounded-md border border-white/10 object-cover"
                  />
                  <CanvasImageZoomButton url={url} labelZh={`结果${idx + 1}`} />
                </div>
              ))}
            </div>
          ) : null}
          {block.outputUrl && block.kind === "video" ? (
            <div className="space-y-1">
              <div className="truncate text-[10px] text-white/55" title={block.outputUrl}>
                {fileNameFromUrl(block.outputUrl) || "成片已生成"}
              </div>
              <video
                src={block.outputUrl}
                controls
                className="max-h-24 w-full rounded-md border border-white/10"
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {!uploading && assets.length === 0 && !hasGeneratedOutput && block.status !== "error" ? (
        <p className="text-[10px] leading-4 text-white/30">上传后显示文件名</p>
      ) : null}
    </div>
  );
}

type CanvasImagePreview = { url: string; labelZh?: string };

/** 画布节点里点「放大」用；节点拖动逻辑在 pointerdown，所以放大只挂按钮与双击 */
const CanvasImagePreviewCtx = React.createContext<((p: CanvasImagePreview) => void) | null>(null);

function CanvasImageZoomButton({ url, labelZh }: CanvasImagePreview) {
  const openPreview = React.useContext(CanvasImagePreviewCtx);
  if (!openPreview) return null;
  return (
    <button
      type="button"
      title="放大看"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        openPreview({ url, labelZh });
      }}
      className="absolute bottom-1.5 right-1.5 z-[2] rounded-md border border-white/25 bg-black/70 p-1 text-white/85 hover:bg-black/85"
    >
      <Maximize2 className="h-3.5 w-3.5" />
    </button>
  );
}

/** 关键静帧 / 场景 / 道具 / 定妆：只留图 + ID */
function CanvasAssetVisualBody({
  block,
  displayOutputs,
}: {
  block: CanvasBlock;
  displayOutputs: string[];
}) {
  const openPreview = React.useContext(CanvasImagePreviewCtx);
  const assetAt = parseManhuaCanvasAssetAtTag(block.prompt);
  const idChip =
    assetAt ||
    (String(block.id || "").match(/^(keyart|charsheet|sceneplate|propplate|propsheet|prop)-(.+)$/i)?.[0]
      ? String(block.id)
      : block.id);
  const shortId = assetAt || String(block.id || "").replace(/^[a-z]+-/i, "").slice(0, 22);
  const roleWall = String(block.id || "").startsWith("charsheet-")
    ? "角色"
    : String(block.id || "").startsWith("sceneplate-")
      ? "场景"
      : String(block.id || "").startsWith("keyart-")
        ? "关键静帧"
        : "道具";
  const imgUrl =
    displayOutputs[0] ||
    block.outputUrl ||
    block.refImageUrl ||
    block.uploadedAssets.find((a) => (a.kind ?? "image") === "image")?.url ||
    "";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-violet-400/30 px-1.5 py-0.5 text-[9px] font-semibold text-violet-50">
          {roleWall}
        </span>
        <span
          className="rounded bg-cyan-500/25 px-1.5 py-0.5 text-[11px] font-semibold text-cyan-50"
          title={idChip}
        >
          {assetAt
            ? friendlyManhuaAssetChipLabel(assetAt, String(block.prompt || ""))
            : shortId}
        </span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-black/40">
        {imgUrl ? (
          <>
            <img
              src={imgUrl}
              alt={shortId}
              title="双击放大"
              onDoubleClick={(e) => {
                e.stopPropagation();
                openPreview?.({ url: imgUrl, labelZh: shortId });
              }}
              onError={(e) => {
                const el = e.currentTarget;
                if (el.dataset.localRetry === "1") return;
                el.dataset.localRetry = "1";
                void tryLocalMediaDisplayForBlock(String(block.id || ""), "output").then((local) => {
                  if (local) el.src = local;
                });
              }}
              className="h-full w-full cursor-zoom-in object-contain"
            />
            <CanvasImageZoomButton url={imgUrl} labelZh={shortId} />
          </>
        ) : (
          <div className="flex h-full min-h-[120px] items-center justify-center text-[11px] text-white/35">
            暂无图片
          </div>
        )}
      </div>
      {block.status === "error" && block.error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-100">
          {block.error}
        </div>
      ) : null}
    </div>
  );
}

export default function FreeformCanvas({
  blocks,
  edges,
  onBlocksChange,
  onEdgesChange,
  runDeps,
  focusBlockId,
  onFocusBlockConsumed,
  presentation = "full",
  focusEpisode = null,
  spawnKinds,
  characterVoiceLocks = [],
  onReplaceCharacterVoiceAudio: _onReplaceCharacterVoiceAudio,
  /** 嵌入工作台右栏时占满容器，禁止外层再套一层 overflow 双滚动 */
  fillContainer = false,
  manhuaMention,
  compileManhuaRerun,
}: FreeformCanvasProps) {
  void _onReplaceCharacterVoiceAudio;
  const canvasRef = useRef<HTMLDivElement>(null);
  const toolbarFileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadBlockIdRef = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 外部 focus 时短暂高亮，避免只滚过去却看不见点了哪张 */
  const [pulseHighlightId, setPulseHighlightId] = useState<string | null>(null);
  const [spawnMenu, setSpawnMenu] = useState<SpawnMenuState>(null);
  const [toolbarMenu, setToolbarMenu] = useState<ToolbarMenuState>(null);
  const [dragState, setDragState] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [imagePreview, setImagePreview] = useState<CanvasImagePreview | null>(null);
  const openImagePreview = useCallback((p: CanvasImagePreview) => setImagePreview(p), []);
  const [resizeState, setResizeState] = useState<ResizeState>(null);
  const [uploadBusyId, setUploadBusyId] = useState<string | null>(null);
  const [eraseCornerBusyId, setEraseCornerBusyId] = useState<string | null>(null);
  // 高清放大：报价面板展开的 block、探测到的真实时长（计费按秒，展示与提交同源）、提交中锁
  const [upscalePanelBlockId, setUpscalePanelBlockId] = useState<string | null>(null);
  const [upscaleProbedSec, setUpscaleProbedSec] = useState<Record<string, number>>({});
  const [upscaleBusyId, setUpscaleBusyId] = useState<string | null>(null);
  const [maskBusyId, setMaskBusyId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ blockId: string; done: number; total: number } | null>(null);
  /** 左栏：画布节点列表 / 资产设定卡（对照参考图 IA，不抄皮肤） */
  const [leftRailTab, setLeftRailTab] = useState<"canvas" | "assets">("canvas");
  const [leftRailQuery, setLeftRailQuery] = useState("");
  /** 嵌入右栏时默认收起左轨，给竖排缩略更多横向空间 */
  const [leftRailCollapsed, setLeftRailCollapsed] = useState(Boolean(fillContainer));
  const [viewportPct, setViewportPct] = useState(100);
  /** 世界缩放：让本集全部节点缩进可视区（≠节点自身 width/height） */
  const [viewScale, setViewScale] = useState(1);
  const getSignedUrlMutation = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  const subQuery = trpc.stripe.getSubscription.useQuery(undefined, { retry: false });
  const userPlan = (subQuery.data?.plan || "free") as string;
  const { user: authUser, loading: authLoading } = useAuth();
  const userRole = (authUser as { role?: string } | null)?.role ?? null;
  /**
   * 与服务端 `assertSeedance25PaidAccess` 同一套 `resolveSeedance25Access`（到点 + 会员 + 内部
   * 角色一起判），避免前端只判 plan 导致「能选但 403」。`nowMs` 每分钟刷新一次，避免页面挂着
   * 跨过上线时刻却因组件不重渲染而一直读到旧结果（不能算模块级常量或只 mount 时算一次）。
   */
  const [seedance25NowMs, setSeedance25NowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setSeedance25NowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const seedance25Gate = useMemo(
    () => resolveCanvasSeedance25Gate({ plan: userPlan, role: userRole, now: seedance25NowMs }),
    [userPlan, userRole, seedance25NowMs],
  );
  const canUseSeedance25 = seedance25Gate.allowed;
  /** plan/role 还没回来时先按无权限渲染，避免虚假放开；两者都到齐后闸门才是最终结果 */
  const seedance25AccessSettled = !subQuery.isLoading && !authLoading;
  /** 成片一律限正式会员（服务端同口径）；订阅信息还没回来时不提前泼冷水 */
  const canUsePaidVideo = subQuery.isLoading || canUsePaidVideoByPlan(userPlan);
  const videoModelOptions = useMemo(
    () => filterCanvasVideoModelOptions(canUseSeedance25),
    [canUseSeedance25],
  );
  const runDepsWithPlan = useMemo(
    () => ({ ...runDeps, userPlan, userRole }),
    [runDeps, userPlan, userRole],
  );
  const focusMissSinceRef = useRef<number | null>(null);
  const viewScaleRef = useRef(1);
  viewScaleRef.current = viewScale;

  /** 无权限（未到点/非会员/邀请码用户）草稿里若残留加长档，降回快速 */
  useEffect(() => {
    if (!seedance25AccessSettled) return;
    const next = downgradeUnauthorizedSeedance25Blocks(blocks, canUseSeedance25);
    if (!next) return;
    onBlocksChange(next);
  }, [blocks, canUseSeedance25, onBlocksChange, seedance25AccessSettled]);

  const mediaOnly = presentation === "media";
  const spawnOptions = useMemo(() => {
    if (!spawnKinds?.length) {
      return mediaOnly
        ? SPAWN_KIND_OPTIONS.filter((o) => o.kind === "image" || o.kind === "video")
        : SPAWN_KIND_OPTIONS;
    }
    const allow = new Set(spawnKinds);
    return SPAWN_KIND_OPTIONS.filter((o) => allow.has(o.kind));
  }, [mediaOnly, spawnKinds]);

  const visibleBlocks = useMemo(() => {
    let list = blocks;
    if (typeof focusEpisode === "number" && focusEpisode >= 1) {
      list = list.filter((b) => (getBlockEpisodeIndex(b) ?? 1) === focusEpisode);
    }
    if (mediaOnly) {
      list = list.filter((b) => b.kind === "image" || b.kind === "video");
    }
    return list;
  }, [blocks, focusEpisode, mediaOnly]);

  const visibleIdSet = useMemo(() => new Set(visibleBlocks.map((b) => b.id)), [visibleBlocks]);

  const visibleEdges = useMemo(
    () => edges.filter((e) => visibleIdSet.has(e.fromId) && visibleIdSet.has(e.toId)),
    [edges, visibleIdSet],
  );

  const blockMap = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);

  const leftRailNodes = useMemo(() => {
    const q = leftRailQuery.trim().toLowerCase();
    let list = visibleBlocks;
    if (leftRailTab === "assets") {
      list = list.filter((b) => isCanvasAssetSheetId(b.id));
    }
    if (q) {
      list = list.filter((b) => {
        const label = freeformNodeListLabel(b).toLowerCase();
        return label.includes(q) || b.id.toLowerCase().includes(q) || String(b.prompt || "").toLowerCase().includes(q);
      });
    }
    return list;
  }, [visibleBlocks, leftRailTab, leftRailQuery]);

  const focusNodeFromList = useCallback((id: string) => {
    setSelectedId(id);
    setPulseHighlightId(id);
    requestAnimationFrame(() => {
      const root = canvasRef.current;
      if (!root) return;
      const el = root.querySelector(
        `[data-canvas-block-id="${CSS.escape(id)}"]`,
      ) as HTMLElement | null;
      el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    });
    window.setTimeout(() => {
      setPulseHighlightId((cur) => (cur === id ? null : cur));
    }, 1600);
  }, []);

  /** absolute 节点不撑开滚动区；按节点包围盒扩世界，才能滚到竖排底部 */
  const worldSize = useMemo(() => {
    let w = 800;
    let h = 600;
    for (const b of visibleBlocks) {
      w = Math.max(w, Math.ceil(b.x + b.width + 48));
      h = Math.max(h, Math.ceil(b.y + b.height + 48));
    }
    return { w, h };
  }, [visibleBlocks]);

  const contentBounds = useMemo(() => {
    if (!visibleBlocks.length) return { minX: 0, minY: 0, w: 1, h: 1 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of visibleBlocks) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.width);
      maxY = Math.max(maxY, b.y + b.height);
    }
    return {
      minX: Number.isFinite(minX) ? minX : 0,
      minY: Number.isFinite(minY) ? minY : 0,
      w: Math.max(1, maxX - minX),
      h: Math.max(1, maxY - minY),
    };
  }, [visibleBlocks]);

  const fitAllInView = useCallback(() => {
    const el = canvasRef.current;
    if (!el || !visibleBlocks.length) {
      setViewScale(1);
      return;
    }
    const pad = 20;
    const availW = Math.max(80, el.clientWidth - pad * 2);
    const availH = Math.max(80, el.clientHeight - pad * 2);
    const scale = Math.min(1, availW / contentBounds.w, availH / contentBounds.h);
    pendingZoomAnchorRef.current = null; // 看全图接管滚动位，丢弃未完成的缩放锚点
    setViewScale(Math.max(0.12, Math.round(scale * 1000) / 1000));
    el.scrollTo({ left: 0, top: 0 });
  }, [contentBounds.h, contentBounds.w, visibleBlocks.length]);

  const pendingZoomAnchorRef = useRef<{
    worldX: number;
    worldY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  /** 锚定缩放：clamp 后换算滚动位，让 anchor（默认视口中心）下的世界点保持不动 */
  const applyZoom = useCallback((next: number, anchor?: { clientX: number; clientY: number }) => {
    const el = canvasRef.current;
    if (!el) return;
    const prev = Math.max(0.01, viewScaleRef.current || 1);
    const clamped = Math.min(2.5, Math.max(0.12, Math.round(next * 1000) / 1000));
    if (clamped === prev) return;
    const rect = el.getBoundingClientRect();
    const offsetX = anchor ? anchor.clientX - rect.left : el.clientWidth / 2;
    const offsetY = anchor ? anchor.clientY - rect.top : el.clientHeight / 2;
    const worldX = (el.scrollLeft + offsetX) / prev;
    const worldY = (el.scrollTop + offsetY) / prev;
    // 连续缩放天然合并：后一次覆盖前一次的待恢复锚点，DOM 撑大后在 layoutEffect 里统一恢复
    pendingZoomAnchorRef.current = { worldX, worldY, offsetX, offsetY };
    setViewScale(clamped);
  }, []);

  /** viewScale 提交、容器已按新尺寸撑大后，同步恢复锚点下的滚动位（避免 rAF 与连续缩放/看全图竞态） */
  useLayoutEffect(() => {
    const el = canvasRef.current;
    const anchor = pendingZoomAnchorRef.current;
    if (!el || !anchor) return;
    pendingZoomAnchorRef.current = null;
    el.scrollLeft = anchor.worldX * viewScale - anchor.offsetX;
    el.scrollTop = anchor.worldY * viewScale - anchor.offsetY;
  }, [viewScale]);

  /** Ctrl/⌘+滚轮 与触控板双指捏合（浏览器上报为 ctrlKey wheel）缩放；普通滚轮维持平移 */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0022);
      applyZoom((viewScaleRef.current || 1) * factor, { clientX: e.clientX, clientY: e.clientY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const update = () => {
      const scaledW = worldSize.w * viewScale;
      const scaledH = worldSize.h * viewScale;
      const pctW = el.clientWidth / Math.max(1, scaledW);
      const pctH = el.clientHeight / Math.max(1, scaledH);
      const pct = Math.round(Math.min(pctW, pctH) * 100);
      setViewportPct(Math.max(1, Math.min(100, pct)));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [worldSize.w, worldSize.h, visibleBlocks.length, viewScale]);

  /** 嵌入右栏：节点增减或容器尺寸变化时自动「看全图」 */
  useEffect(() => {
    if (!fillContainer) return;
    const el = canvasRef.current;
    if (!el) return;
    const run = () => fitAllInView();
    run();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(run) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [fillContainer, fitAllInView, leftRailCollapsed, visibleBlocks.length]);

  useEffect(() => {
    if (!focusBlockId) {
      focusMissSinceRef.current = null;
      return;
    }
    const block = blockMap.get(focusBlockId);
    if (!block) {
      // 审阅刚铺节点时 layout 尚未进 state：等下一轮，勿立刻 consume
      if (focusMissSinceRef.current == null) focusMissSinceRef.current = Date.now();
      if (Date.now() - focusMissSinceRef.current > 2500) {
        focusMissSinceRef.current = null;
        onFocusBlockConsumed?.();
      }
      return;
    }
    focusMissSinceRef.current = null;
    setSelectedId(focusBlockId);
    setPulseHighlightId(focusBlockId);
    const canvas = canvasRef.current;
    if (canvas) {
      const scale = viewScaleRef.current || 1;
      const pad = 28;
      const bw = block.width * scale;
      const bh = block.height * scale;
      const bx = block.x * scale;
      const by = block.y * scale;
      const fitsX = bw + pad * 2 <= canvas.clientWidth;
      const fitsY = bh + pad * 2 <= canvas.clientHeight;
      const targetLeft = Math.max(
        0,
        fitsX ? bx - (canvas.clientWidth - bw) / 2 : bx - pad,
      );
      const targetTop = Math.max(
        0,
        fitsY ? by - (canvas.clientHeight - bh) / 2 : by - pad,
      );
      canvas.scrollTo({ left: targetLeft, top: targetTop, behavior: "smooth" });
    }
    // 双 rAF：等世界尺寸/布局 paint 后再 DOM 居中
    let cancelled = false;
    const raf = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (cancelled) return;
        const el = document.querySelector(
          `[data-canvas-block-id="${CSS.escape(focusBlockId)}"]`,
        ) as HTMLElement | null;
        el?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      });
    });
    const pulseTimer = window.setTimeout(() => {
      setPulseHighlightId((id) => (id === focusBlockId ? null : id));
    }, 4000);
    onFocusBlockConsumed?.();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      window.clearTimeout(pulseTimer);
    };
  }, [focusBlockId, blockMap, onFocusBlockConsumed]);

  const getViewportSpawnPosition = useCallback((width: number, height: number, staggerIndex: number) => {
    const canvas = canvasRef.current;
    const stagger = staggerIndex % 5;
    if (!canvas) {
      return { x: 120 + stagger * 24, y: 120 + stagger * 20 };
    }
    const scale = Math.max(0.01, viewScaleRef.current || 1);
    const x = (canvas.scrollLeft + canvas.clientWidth / 2) / scale - width / 2 + stagger * 22;
    const y = (canvas.scrollTop + canvas.clientHeight / 2) / scale - height / 2 + stagger * 18;
    return { x: Math.max(8, x), y: Math.max(8, y) };
  }, []);

  /** 左侧 + 创建：方块出现在加号旁的可见区域，而非画布中央/下方 */
  const getToolbarAdjacentSpawnPosition = useCallback(
    (anchorCenterY: number, width: number, height: number, staggerIndex: number) => {
      const canvas = canvasRef.current;
      const stagger = staggerIndex % 5;
      if (!canvas) {
        return { x: 120 + stagger * 24, y: 120 + stagger * 20 };
      }
      const canvasRect = canvas.getBoundingClientRect();
      const scale = Math.max(0.01, viewScaleRef.current || 1);
      const x = (canvas.scrollLeft + 24) / scale + stagger * 20;
      const y =
        (canvas.scrollTop + (anchorCenterY - canvasRect.top)) / scale - height / 2 + stagger * 14;
      const minX = (canvas.scrollLeft + 8) / scale;
      const minY = (canvas.scrollTop + 8) / scale;
      const maxX = (canvas.scrollLeft + canvas.clientWidth - 8) / scale - width;
      const maxY = (canvas.scrollTop + canvas.clientHeight - 8) / scale - height;
      return {
        x: Math.max(minX, Math.min(x, maxX)),
        y: Math.max(minY, Math.min(y, maxY)),
      };
    },
    [],
  );

  const addBlock = useCallback(
    (kind: CanvasBlockKind, opts?: { x?: number; y?: number; parentId?: string }) => {
      const id = makeCanvasBlockId(kind);
      const block = defaultCanvasBlock(kind, 0, 0, opts?.parentId);
      block.id = id;
      const parent = opts?.parentId ? blockMap.get(opts.parentId) : undefined;
      const handoff = parent ? resolveBlockHandoffText(parent) : "";
      if (handoff) {
        const snippet = handoff.slice(0, 2000);
        block.prompt = block.prompt.trim()
          ? `${block.prompt.trim()}\n\n${snippet}`
          : snippet;
      }
      if (parent?.outputUrl && (kind === "image" || kind === "video")) {
        block.refImageUrl = parent.outputUrl;
      } else if (parent?.outputUrls?.[0] && (kind === "image" || kind === "video")) {
        block.refImageUrl = parent.outputUrls[0];
      }

      if (opts?.x != null && opts?.y != null) {
        block.x = opts.x;
        block.y = opts.y;
      } else if (parent) {
        block.x = parent.x + parent.width + 40;
        block.y = parent.y + 32;
      } else {
        const pos = getViewportSpawnPosition(block.width, block.height, blocks.length);
        block.x = pos.x;
        block.y = pos.y;
      }

      onBlocksChange((prev) => {
        const next = [...prev, block];
        return next;
      });
      if (opts?.parentId) {
        onEdgesChange([...edges, { fromId: opts.parentId, toId: id }]);
      }
      setSelectedId(id);
      return id;
    },
    [blockMap, blocks, edges, getViewportSpawnPosition, onBlocksChange, onEdgesChange],
  );

  const spawnFromToolbar = useCallback(
    (kind: CanvasBlockKind) => {
      const anchorY = toolbarMenu?.anchorCenterY;
      const pos =
        anchorY != null
          ? getToolbarAdjacentSpawnPosition(
              anchorY,
              CANVAS_BLOCK_DEFAULT_WIDTH,
              CANVAS_BLOCK_DEFAULT_HEIGHT,
              blocks.length,
            )
          : undefined;
      setToolbarMenu(null);
      return addBlock(kind, pos ? { x: pos.x, y: pos.y } : undefined);
    },
    [addBlock, blocks.length, getToolbarAdjacentSpawnPosition, toolbarMenu],
  );

  const openToolbarUpload = useCallback(() => {
    const id = spawnFromToolbar("image");
    pendingUploadBlockIdRef.current = id;
    window.setTimeout(() => toolbarFileInputRef.current?.click(), 0);
  }, [spawnFromToolbar]);

  /** 自由画布：一键铺「静帧 → 成片」可读链（不再铺文本节点） */
  const spawnImageVideoChain = useCallback(() => {
    setToolbarMenu(null);
    const image = defaultCanvasBlock("image", 120, 120);
    image.id = makeCanvasBlockId("image");
    image.prompt = "可拍画面：场景、人物动作、运镜清晰";
    const video = defaultCanvasBlock("video", 520, 120, image.id);
    video.id = makeCanvasBlockId("video");
    onBlocksChange((prev) => [...prev, image, video]);
    onEdgesChange([...edges, { fromId: image.id, toId: video.id }]);
    setSelectedId(image.id);
  }, [edges, onBlocksChange, onEdgesChange]);

  const patchOne = useCallback(
    (id: string, patch: Partial<CanvasBlock>) => {
      onBlocksChange((prev) => patchBlock(prev, id, patch));
    },
    [onBlocksChange],
  );

  const removeBlock = useCallback(
    (id: string) => {
      onBlocksChange(blocks.filter((b) => b.id !== id));
      onEdgesChange(edges.filter((e) => e.fromId !== id && e.toId !== id));
      if (selectedId === id) setSelectedId(null);
    },
    [blocks, edges, onBlocksChange, onEdgesChange, selectedId],
  );

  const eraseCornerMarkForBlock = useCallback(
    async (blockId: string) => {
      const block = blocks.find((b) => b.id === blockId);
      const src = String(block?.outputUrl || "").trim();
      if (!block || !/^https:\/\//i.test(src) || !/\.(mp4|mov|webm|m4v)(\?|$)/i.test(src)) {
        toast.error("请先生成成片后再清除角标");
        return;
      }
      if (eraseCornerBusyId) return;
      setEraseCornerBusyId(blockId);
      try {
        const out = await eraseAiCornerMark({ videoUrl: src });
        const prevUrls = Array.isArray(block.outputUrls) ? block.outputUrls : [];
        patchOne(blockId, {
          outputUrl: out.videoUrl,
          outputUrls: Array.from(new Set([out.videoUrl, ...prevUrls, src])).slice(0, 8),
          status: "done",
          error: undefined,
        });
        toast.success("已清除左上角标");
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "清除角标失败");
      } finally {
        setEraseCornerBusyId(null);
      }
    },
    [blocks, eraseCornerBusyId, patchOne],
  );

  const openUpscalePanel = useCallback(
    async (blockId: string) => {
      const block = blocks.find((b) => b.id === blockId);
      // 只认真实成片 outputUrl；refImageUrl 垫图不进这个操作区（外层渲染条件已挡）
      const src = String(block?.outputUrl || "").trim();
      if (!block || !/^https:\/\//i.test(src)) {
        toast.error("请先生成成片再做高清放大");
        return;
      }
      setUpscalePanelBlockId(blockId);
      if (!upscaleProbedSec[blockId]) {
        const sec = await probeVideoDurationSec(src);
        if (sec) {
          setUpscaleProbedSec((prev) => ({ ...prev, [blockId]: sec }));
        } else {
          toast.error("读取视频时长失败，请稍后重试");
          setUpscalePanelBlockId((cur) => (cur === blockId ? null : cur));
        }
      }
    },
    [blocks, upscaleProbedSec],
  );

  const startUpscaleForBlock = useCallback(
    async (blockId: string, target: "2k" | "4k") => {
      const block = blocks.find((b) => b.id === blockId);
      const src = String(block?.outputUrl || "").trim();
      const sec = upscaleProbedSec[blockId];
      if (!block || !/^https:\/\//i.test(src) || !sec) return;
      if (upscaleBusyId) return;
      setUpscaleBusyId(blockId);
      try {
        const started = await startVideoUpscale({
          videoUrl: src,
          target,
          durationSec: sec,
          episodeIndex: Number(block.episodeIndex) > 0 ? Number(block.episodeIndex) : undefined,
          sourceResolution: block.videoResolution || "720p",
        });
        // 任务字段随画布持久化 → 刷新后由下面的轮询 effect 自动恢复
        patchOne(blockId, {
          upscaleTaskId: started.taskId,
          upscaleStatus: started.status,
          upscaleTarget: target,
          upscaleError: undefined,
          upscaleCreditsUsed: started.creditsUsed,
        });
        setUpscalePanelBlockId(null);
        toast.success(`高清放大已提交（${target.toUpperCase()} · ${started.creditsUsed} 积分）`);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "高清放大提交失败");
      } finally {
        setUpscaleBusyId(null);
      }
    },
    [blocks, patchOne, upscaleBusyId, upscaleProbedSec],
  );

  // 活跃超分任务统一轮询（含刷新恢复：字段随画布持久化，挂载即接管）。
  // deps 用任务键串而不是 blocks 引用，避免每次画布重渲都重建 interval。
  const activeUpscaleKey = blocks
    .filter((b) => b.upscaleTaskId && b.upscaleStatus && !isVideoUpscaleTerminal(b.upscaleStatus))
    .map((b) => `${b.id}:${b.upscaleTaskId}:${b.upscaleStatus}`)
    .join(",");
  useEffect(() => {
    if (!activeUpscaleKey) return;
    const entries = activeUpscaleKey.split(",").map((item) => {
      const [blockId, taskId] = item.split(":");
      return { blockId, taskId };
    });
    let cancelled = false;
    const tick = () => {
      for (const { blockId, taskId } of entries) {
        void (async () => {
          try {
            const snap = await fetchVideoUpscaleStatus(taskId);
            if (cancelled) return;
            patchOne(blockId, {
              upscaleStatus: snap.status,
              // 结果只写独立字段，原片 outputUrl 一个字节都不动
              ...(snap.videoUrl ? { upscaledVideoUrl: snap.videoUrl } : {}),
              upscaleError: snap.status === "failed" ? snap.error : undefined,
              ...(snap.creditsUsed ? { upscaleCreditsUsed: snap.creditsUsed } : {}),
            });
            if (snap.status === "succeeded" && snap.videoUrl) {
              toast.success("高清放大完成，原片已保留");
            }
          } catch {
            // 查询失败视为瞬态，下一轮再试；终态判定只信服务端
          }
        })();
      }
    };
    tick();
    const timer = window.setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeUpscaleKey, patchOne]);

  const runBlock = useCallback(
    async (blockId: string) => {
      const block = blocks.find((b) => b.id === blockId);
      if (!block) return;
      // 与工厂管线对齐：切断 recap→story 误连，避免手点节点吃到前情提要图
      const { blocks: safeBlocks, edges: safeEdges } = sanitizeManhuaRecapUpstreamLinks(blocks, edges);
      if (
        safeEdges.length !== edges.length ||
        blocks.some((b) => b.id.startsWith("story-") && Boolean(b.parentId?.startsWith("recap_card-")))
      ) {
        onBlocksChange(safeBlocks);
        onEdgesChange(safeEdges);
      }
      // 漫剧节点重跑：按当前字段/资产重编译 prompt，旧产物进暂存（禁止复用旧稿）
      let workingBlock = block;
      if (compileManhuaRerun) {
        const mustRecompile =
          /^(charsheet|sceneplate|propsheet|propplate|clip)-/i.test(block.id);
        try {
          const compiled = await compileManhuaRerun(block);
          if (mustRecompile && !compiled?.prompt?.trim()) {
            toast.error("重跑前重编译失败：无法按当前字段生成新提示词", {
              description: "请先确认编剧表/可拍表已齐，或改走工作台「重出」。未扣费。",
            });
            return;
          }
          if (compiled?.prompt?.trim()) {
            const patch = {
              prompt: compiled.prompt,
              outputUrl: compiled.outputUrl,
              outputUrls: compiled.outputUrls ?? block.outputUrls,
              status: compiled.status ?? block.status,
              error: compiled.error,
            };
            workingBlock = { ...block, ...patch };
            onBlocksChange((prev) => patchBlock(prev, blockId, patch));
            if (compiled.changed) {
              const beforeHead = String(compiled.beforePrompt || "").trim().slice(0, 80);
              const afterHead = String(compiled.afterPrompt || compiled.prompt || "")
                .trim()
                .slice(0, 80);
              toast.message("已按当前字段重编译提示词", {
                description:
                  beforeHead && afterHead && beforeHead !== afterHead
                    ? `前：${beforeHead}… → 后：${afterHead}…`
                    : "旧成图已暂存，可在节点历史输出里回看",
              });
            }
          }
        } catch (compileErr: unknown) {
          const msg = compileErr instanceof Error ? compileErr.message : "重编译失败";
          toast.error(`重跑前重编译失败：${msg}`);
          return;
        }
      }
      const visionImages = collectVisionImages(blockId, safeBlocks, safeEdges);
      const nearestRef =
        workingBlock.kind === "image" || workingBlock.kind === "video"
          ? workingBlock.refImageUrl ||
            resolveNearestUpstreamImageUrl(blockId, safeBlocks, safeEdges)
          : workingBlock.refImageUrl;
      let runBlockPayload =
        nearestRef && nearestRef !== workingBlock.refImageUrl
          ? { ...workingBlock, refImageUrl: nearestRef }
          : workingBlock;
      // 手点 clip：上一段成片（全集连续编号 g07←g06）供末帧/视频参考
      if (workingBlock.id.startsWith("clip-") && !runBlockPayload.refVideoUrl) {
        const ep = getBlockEpisodeIndex(runBlockPayload) ?? 1;
        const seg = resolveClipSegmentIndex(runBlockPayload.id, runBlockPayload.prompt);
        const prevClipUrl = resolvePreviousSegmentClipUrl(safeBlocks, ep, seg);
        if (prevClipUrl) {
          const basePrompt = String(runBlockPayload.prompt || "");
          runBlockPayload = {
            ...runBlockPayload,
            refVideoUrl: prevClipUrl,
            prompt: [
              basePrompt,
              !basePrompt.includes("镜头连续性") ? MANHUA_CLIP_CONTINUITY_HINT_ZH : "",
              !basePrompt.includes("跨段转场")
                ? MANHUA_CLIP_CROSS_SEGMENT_TRANSITION_HINT_ZH
                : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          };
        }
      }
      patchOne(blockId, { status: "running", error: undefined });
      try {
        const docTexts =
          workingBlock.kind === "text" || workingBlock.kind === "copy_organize"
            ? await loadCanvasDocumentTexts(collectDocumentAssets(blockId, safeBlocks, safeEdges))
            : [];
        const texts = [...collectUpstreamTexts(blockId, safeBlocks, safeEdges), ...docTexts];
        const out = await runCanvasBlock(runDepsWithPlan, runBlockPayload, { visionImages, texts });
        const stashUrls = Array.isArray(workingBlock.outputUrls) ? workingBlock.outputUrls : [];
        patchOne(blockId, {
          status: "done",
          outputText: out.outputText,
          outputUrl: out.outputUrl,
          outputUrls: out.outputUrls ??
            (out.outputUrl
              ? Array.from(new Set([out.outputUrl, ...stashUrls])).slice(0, 8)
              : stashUrls),
          // 手点重跑也要写回尾帧锚点（否则下一段续拍拿不到起幅）。
          // 无条件写入：本次没抽到尾帧时必须清掉旧值——残留 v1 的尾帧会让
          // 下一段拿旧片画面当起幅（审阅结论必须修#5）
          lastFrameUrl: out.lastFrameUrl,
          // 重跑出了新片：旧质检报告（连同旧的「仍采用」授权）作废，按未质检状态重新走
          ...(blockId.startsWith("clip-") ? { manhuaClipQuality: undefined } : {}),
          ...(out.seedance25ThreadId ? { seedance25ThreadId: out.seedance25ThreadId } : {}),
          ...(out.seedance25WebThreadLink
            ? { seedance25WebThreadLink: out.seedance25WebThreadLink }
            : {}),
        });
        toast.success("生成完成");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "生成失败";
        patchOne(blockId, { status: "error", error: msg });
        toast.error(msg);
      }
    },
    [
      blocks,
      edges,
      onBlocksChange,
      onEdgesChange,
      patchOne,
      runDepsWithPlan,
      compileManhuaRerun,
    ],
  );

  const uploadFilesForBlock = useCallback(
    async (blockId: string, files: FileList | File[]) => {
      const allFiles = Array.isArray(files) ? [...files] : Array.from(files);
      const fileArr = allFiles.filter(isCanvasUploadableFile);
      const rejected = allFiles.filter((f) => !isCanvasUploadableFile(f));

      const patchUpload = (patch: Partial<CanvasBlock>) => {
        onBlocksChange((prev) => patchBlock(prev, blockId, patch));
      };

      if (rejected.length) {
        const rejectedFailures = rejected.map((f) => ({
          fileName: f.name,
          error: "不支持的文件格式",
        }));
        patchUpload({
          uploadPhase: "error",
          uploadFailures: rejectedFailures,
          uploadStatusMessage: `格式不支持：${rejected.map((f) => f.name).join("、")}`,
        });
        toast.error(`以下文件格式不支持：${rejected.map((f) => f.name).join("、")}`);
      }
      if (!fileArr.length) {
        if (!rejected.length) toast.error("请选择可上传的文件");
        return;
      }

      setUploadBusyId(blockId);
      setUploadProgress({ blockId, done: 0, total: fileArr.length });
      patchUpload({
        uploadPhase: "uploading",
        uploadProgressDone: 0,
        uploadProgressTotal: fileArr.length,
        uploadStatusMessage: `正在上传 0/${fileArr.length}…`,
        uploadFailures: undefined,
      });

      try {
        const { assets: uploaded, failed } = await uploadCanvasFilesParallel({
          files: fileArr,
          concurrency: CANVAS_UPLOAD_CONCURRENCY,
          getSignedUploadUrl: (input) => getSignedUrlMutation.mutateAsync(input),
          onProgress: (done, total) => {
            setUploadProgress({ blockId, done, total });
            patchUpload({
              uploadProgressDone: done,
              uploadProgressTotal: total,
              uploadStatusMessage: `正在上传 ${done}/${total}…`,
            });
          },
        });

        onBlocksChange((prev) => {
          const block = prev.find((b) => b.id === blockId);
          if (!block) return prev;
          const nextAssets: CanvasUploadedAsset[] = [...(block.uploadedAssets ?? []), ...uploaded];
          const firstImage = nextAssets.find(
            (a) => (a.kind ?? inferCanvasAssetKindFromFileName(a.fileName)) === "image",
          );
          const firstVideo = nextAssets.find(
            (a) => (a.kind ?? inferCanvasAssetKindFromFileName(a.fileName)) === "video",
          );
          const allFailed = !uploaded.length && failed.length > 0;
          const partialFailed = uploaded.length > 0 && failed.length > 0;
          return patchBlock(prev, blockId, {
            uploadedAssets: nextAssets,
            uploadFailures: failed.length ? failed : undefined,
            refImageUrl: firstImage?.url ?? block.refImageUrl,
            refVideoUrl: firstVideo?.url ?? block.refVideoUrl,
            uploadPhase: allFailed ? "error" : "done",
            uploadProgressDone: undefined,
            uploadProgressTotal: undefined,
            uploadStatusMessage: allFailed
              ? `全部上传失败（${failed.length} 个）`
              : partialFailed
                ? `成功 ${uploaded.length} 个，失败 ${failed.length} 个`
                : `已成功上传 ${uploaded.length} 个文件`,
          });
        });

        if (!uploaded.length && failed.length) {
          toast.error(`全部上传失败（${failed.length} 个）`);
        } else if (failed.length) {
          toast.warning(`成功 ${uploaded.length} 个，失败 ${failed.length} 个`);
        } else {
          toast.success(`已成功上传 ${uploaded.length} 个文件`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "上传失败";
        patchUpload({
          uploadPhase: "error",
          uploadFailures: fileArr.map((f) => ({ fileName: f.name, error: msg })),
          uploadProgressDone: undefined,
          uploadProgressTotal: undefined,
          uploadStatusMessage: msg,
        });
        toast.error(msg);
      } finally {
        setUploadBusyId(null);
        setUploadProgress(null);
      }
    },
    [getSignedUrlMutation, onBlocksChange],
  );

  const uploadEditMaskForBlock = useCallback(
    async (blockId: string, blob: Blob) => {
      setMaskBusyId(blockId);
      try {
        const file = new File([blob], `edit-mask-${Date.now()}.png`, { type: "image/png" });
        const asset = await uploadOneCanvasAsset({
          file,
          index: 0,
          getSignedUploadUrl: (input) => getSignedUrlMutation.mutateAsync(input),
        });
        patchOne(blockId, { editMaskUrl: asset.url });
        toast.success("遮罩已保存 · 跑生成时只改涂抹区域");
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "遮罩上传失败");
      } finally {
        setMaskBusyId(null);
      }
    },
    [getSignedUrlMutation, patchOne],
  );

  useEffect(() => {
    if (!dragState) return;
    const onMove = (e: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const scale = Math.max(0.01, viewScaleRef.current || 1);
      const rect = canvas.getBoundingClientRect();
      const x =
        (e.clientX - rect.left + canvas.scrollLeft) / scale - dragState.offsetX;
      const y =
        (e.clientY - rect.top + canvas.scrollTop) / scale - dragState.offsetY;
      onBlocksChange((prev) =>
        patchBlock(prev, dragState.id, {
          x: Math.max(8, x),
          y: Math.max(8, y),
        }),
      );
    };
    const onUp = () => setDragState(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragState, onBlocksChange]);

  useEffect(() => {
    if (!resizeState) return;
    const onMove = (e: PointerEvent) => {
      const scale = Math.max(0.01, viewScaleRef.current || 1);
      const dw = (e.clientX - resizeState.startPointerX) / scale;
      const dh = (e.clientY - resizeState.startPointerY) / scale;
      const width = Math.min(
        CANVAS_BLOCK_MAX_WIDTH,
        Math.max(CANVAS_BLOCK_MIN_WIDTH, Math.round(resizeState.startW + dw)),
      );
      const height = Math.min(
        CANVAS_BLOCK_MAX_HEIGHT,
        Math.max(CANVAS_BLOCK_MIN_HEIGHT, Math.round(resizeState.startH + dh)),
      );
      onBlocksChange((prev) => patchBlock(prev, resizeState.id, { width, height }));
    };
    const onUp = () => setResizeState(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onBlocksChange, resizeState]);

  const renderEdge = (fromId: string, toId: string) => {
    const a = blockMap.get(fromId);
    const b = blockMap.get(toId);
    if (!a || !b) return null;
    const from = blockEdgeAnchor(a);
    const x2 = b.x;
    const y2 = b.y + 44;
    const mx = (from.x + x2) / 2;
    const isAssetBind =
      isCanvasAssetSheetId(fromId) && String(toId).startsWith("clip-");
    return (
      <path
        key={`${fromId}-${toId}`}
        d={`M ${from.x} ${from.y} C ${mx} ${from.y}, ${mx} ${y2}, ${x2} ${y2}`}
        fill="none"
        stroke={isAssetBind ? "rgba(103, 232, 249, 0.45)" : "rgba(255,255,255,0.16)"}
        strokeWidth={isAssetBind ? 2.5 : 2}
      />
    );
  };

  return (
    <CanvasImagePreviewCtx.Provider value={openImagePreview}>
    <div
      data-freeform-canvas-root
      className={`flex gap-0 overflow-hidden rounded-[28px] border border-white/10 bg-[#05080f]/90 ${
        fillContainer ? "h-full min-h-0 w-full" : "min-h-[720px]"
      }`}
    >
      {imagePreview ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-6"
          onClick={() => setImagePreview(null)}
        >
          <div className="flex max-h-full w-full max-w-4xl flex-col items-center gap-2">
            <img
              src={imagePreview.url}
              alt=""
              onClick={(e) => e.stopPropagation()}
              className="max-h-[80vh] w-auto max-w-full rounded-xl border border-white/15 object-contain"
            />
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-2 rounded-lg bg-black/70 px-3 py-1.5"
            >
              <span className="text-[12px] font-semibold text-white/90">
                {imagePreview.labelZh || "放大预览"}
              </span>
              <a
                href={imagePreview.url}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-white/20 px-2 py-0.5 text-[11px] text-white/80 hover:bg-white/[0.08]"
              >
                原图新窗口
              </a>
              <button
                type="button"
                onClick={() => setImagePreview(null)}
                className="rounded border border-white/20 px-2 py-0.5 text-[11px] text-white/80 hover:bg-white/[0.08]"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <input
        ref={toolbarFileInputRef}
        type="file"
        accept={CANVAS_UPLOAD_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = takeFilesFromInput(e.target);
          const blockId = pendingUploadBlockIdRef.current;
          pendingUploadBlockIdRef.current = null;
          if (blockId && picked.length) void uploadFilesForBlock(blockId, picked);
        }}
      />

      {/* 左侧：+ 工具 + 画布/资产节点列表（对照参考图 IA） */}
      {leftRailCollapsed ? (
        <aside className="flex w-11 shrink-0 flex-col items-center gap-2 border-r border-white/10 bg-black/35 py-2.5">
          <button
            type="button"
            title="展开节点列表"
            onClick={() => setLeftRailCollapsed(false)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/80 hover:bg-white/15"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="添加功能"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setToolbarMenu({
                x: rect.right + 8,
                y: rect.top,
                anchorCenterY: rect.top + rect.height / 2,
              });
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black shadow-lg transition hover:scale-105"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="看全图"
            onClick={() => fitAllInView()}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-cyan-300/35 bg-cyan-500/15 text-cyan-50 hover:bg-cyan-500/25"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </aside>
      ) : (
      <aside className="flex w-[13.5rem] shrink-0 flex-col border-r border-white/10 bg-black/35">
        <div className="flex items-center gap-2 border-b border-white/10 px-2.5 py-2.5">
          <button
            type="button"
            title="添加功能"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setToolbarMenu({
                x: rect.right + 8,
                y: rect.top,
                anchorCenterY: rect.top + rect.height / 2,
              });
            }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-lg transition hover:scale-105"
          >
            <Plus className="h-4 w-4" />
          </button>
          <div className="flex min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 p-0.5">
            {(
              [
                ["canvas", "画布"],
                ["assets", "资产"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setLeftRailTab(id)}
                className={`min-w-0 flex-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition ${
                  leftRailTab === id
                    ? "bg-white/15 text-white"
                    : "text-white/45 hover:text-white/75"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            title="收起列表"
            onClick={() => setLeftRailCollapsed(true)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-white/50 hover:bg-white/[0.06] hover:text-white/80"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="border-b border-white/10 px-2.5 py-2">
          <label className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/40 px-2 py-1.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-white/35" />
            <input
              value={leftRailQuery}
              onChange={(e) => setLeftRailQuery(e.target.value)}
              placeholder={leftRailTab === "assets" ? "搜设定卡" : "搜节点"}
              className="min-w-0 flex-1 bg-transparent text-[11px] text-white outline-none placeholder:text-white/30"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
          {leftRailNodes.length === 0 ? (
            <p className="px-2 py-6 text-center text-[11px] text-white/35">
              {leftRailTab === "assets" ? "暂无角色/场景/道具卡" : "暂无节点"}
            </p>
          ) : (
            leftRailNodes.map((b) => {
              const meta = CANVAS_KIND_META[b.kind];
              const Icon = meta.icon;
              const active = selectedId === b.id;
              const thumb =
                b.outputUrl || b.outputUrls?.[0] || b.refImageUrl || "";
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => focusNodeFromList(b.id)}
                  className={`mb-1 flex w-full items-center gap-2 rounded-xl px-1.5 py-1.5 text-left transition ${
                    active
                      ? "bg-cyan-400/15 ring-1 ring-cyan-300/40"
                      : "hover:bg-white/[0.06]"
                  }`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/40">
                    {thumb && (b.kind === "image" || b.kind === "video") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Icon className="h-3.5 w-3.5 text-white/55" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-medium text-white/90">
                      {freeformNodeListLabel(b)}
                    </div>
                    <div className="truncate text-[10px] text-white/35">{meta.label}</div>
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-white/10 px-3 py-2 text-[10px] text-white/40">
          共 {leftRailNodes.length}
          {leftRailQuery.trim() || leftRailTab === "assets"
            ? ` / ${visibleBlocks.length}`
            : ""}{" "}
          节点
        </div>
      </aside>
      )}

      {/* 无限画布：唯一滚动层；世界尺寸随节点包围盒扩展 */}
      <div className="relative min-h-0 flex-1">
      <div
        ref={canvasRef}
        data-freeform-canvas-scroll
        className="absolute inset-0 overflow-auto"
      >
        <div
          className="relative"
          style={{
            width: Math.ceil(worldSize.w * viewScale),
            height: Math.ceil(worldSize.h * viewScale),
          }}
        >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: worldSize.w,
            height: worldSize.h,
            transform: `scale(${viewScale})`,
          }}
        >
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-0"
          style={{ width: worldSize.w, height: worldSize.h }}
        />
        <svg
          className="pointer-events-none absolute left-0 top-0"
          width={worldSize.w}
          height={worldSize.h}
        >
          {visibleEdges.map((e) => renderEdge(e.fromId, e.toId))}
        </svg>
        <div className="relative" style={{ width: worldSize.w, height: worldSize.h }}>
          {visibleBlocks.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-white/40">
              <Plus className="mb-3 h-10 w-10 opacity-30" />
              <p className="text-sm">
                {mediaOnly ? "本集尚无静帧 / 成片节点" : "点击左侧 + 在加号旁创建方块"}
              </p>
              <p className="mt-1 text-xs">
                {mediaOnly
                  ? "先在工作台生成片段，或切到「全部节点」查看文本链"
                  : "可拖动 · 右下角缩放 · 右侧 + 引用上游"}
              </p>
            </div>
          ) : null}

          {visibleBlocks.map((block) => {
            const meta = CANVAS_KIND_META[block.kind];
            const Icon = meta.icon;
            const selected = selectedId === block.id;
            const pulsed = pulseHighlightId === block.id;
            const visionCount = collectVisionImages(block.id, blocks, edges).length;
            const documentCount = collectDocumentAssets(block.id, blocks, edges).length;
            const upstreamHandoff = collectUpstreamHandoff(block.id, blocks, edges);
            const upstreamPreview = upstreamHandoff.map((item) => item.text).join(" · ").slice(0, 120);
            const displayOutputs =
              block.outputUrls?.length ? block.outputUrls : block.outputUrl ? [block.outputUrl] : [];
            const isUploading = uploadBusyId === block.id;
            return (
              <div
                key={block.id}
                data-canvas-block-id={block.id}
                data-canvas-block-pulse={pulsed ? "true" : "false"}
                className={`absolute flex flex-col overflow-hidden rounded-2xl border bg-gradient-to-br ${meta.color} backdrop-blur-md transition-shadow ${
                  pulsed
                    ? "z-30 border-cyan-300 shadow-[0_0_0_3px_rgba(34,211,238,0.65)] ring-2 ring-cyan-200/80"
                    : selected
                      ? "z-20 border-cyan-300/70 shadow-[0_0_0_2px_rgba(34,211,238,0.35)]"
                      : "border-white/12"
                }`}
                style={{ left: block.x, top: block.y, width: block.width, height: block.height }}
                onClick={() => setSelectedId(block.id)}
              >
                {/* 顶栏：类型 + 运行 + 引用 + 删除 */}
                <div
                  className="flex cursor-grab items-center gap-2 border-b border-white/10 px-3 py-2 active:cursor-grabbing"
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).closest("button,select,textarea,input,label")) return;
                    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                    const scale = Math.max(0.01, viewScaleRef.current || 1);
                    setDragState({
                      id: block.id,
                      // 屏幕偏移换算到世界坐标，配合 viewScale 拖动
                      offsetX: (e.clientX - rect.left) / scale,
                      offsetY: (e.clientY - rect.top) / scale,
                    });
                    e.preventDefault();
                  }}
                >
                  <Icon className="h-4 w-4 shrink-0 text-white/80" />
                  <select
                    value={block.kind}
                    onChange={(e) => patchOne(block.id, { kind: e.target.value as CanvasBlockKind })}
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white"
                  >
                    {(() => {
                      const base = mediaOnly ? spawnOptions : SPAWN_KIND_OPTIONS;
                      const kinds = base.some((o) => o.kind === block.kind)
                        ? base
                        : [
                            {
                              kind: block.kind,
                              label: CANVAS_KIND_META[block.kind].label,
                              hint: CANVAS_KIND_META[block.kind].hint,
                            },
                            ...base,
                          ];
                      return kinds.map((o) => (
                        <option key={o.kind} value={o.kind}>
                          {o.label}
                        </option>
                      ));
                    })()}
                  </select>
                  <button
                    type="button"
                    disabled={block.status === "running"}
                    onClick={() => void runBlock(block.id)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary/90 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                  >
                    {block.status === "running" ? (
                      <LoaderCircle className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    运行
                  </button>
                  <button
                    type="button"
                    title="引用该节点生成"
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setSpawnMenu({ anchorBlockId: block.id, x: rect.right + 8, y: rect.top });
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white hover:bg-white/20"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeBlock(block.id)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/40 hover:bg-red-500/20 hover:text-red-300"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <CanvasBlockUploadBanner block={block} />
                {isManhuaAssetVisualBlock(block) ? (
                  <>
                    {String(block.id || "").startsWith("keyart-") ? (
                      <div className="border-b border-white/10 px-3 py-1 text-[10px] leading-4 text-white/65">
                        {block.imageMode === "edit" && block.refImageUrl ? (
                          <>
                            <span className="font-semibold text-emerald-200/90">垫图锁</span>
                            <span className="ml-1 font-mono text-white/55">
                              {(String(block.prompt || "").match(/@(?:角色|场景|道具)\d+/g) || []).join(
                                " ",
                              ) || "已挂"}
                            </span>
                          </>
                        ) : (
                          <span className="text-amber-200/85">未垫图改图 · 不可出成片</span>
                        )}
                      </div>
                    ) : null}
                    <CanvasAssetVisualBody block={block} displayOutputs={displayOutputs} />
                  </>
                ) : (
                  <>
                {String(block.id || "").startsWith("clip-") ? (
                  <div
                    data-manhua-clip-director-face
                    className="space-y-1.5 border-b border-cyan-400/25 bg-cyan-500/[0.07] px-3 py-2 text-[10px] leading-4 text-cyan-50/90"
                  >
                    {(() => {
                      const card = parseManhuaClipDirectorCardSummary(block.prompt);
                      const seg =
                        card.segmentIndex ??
                        resolveClipSegmentIndex(block.id, block.prompt);
                      const dur = card.durationSec ?? 15;
                      const chips = [
                        ...card.castTags.slice(0, 4),
                        ...card.sceneTags.slice(0, 2),
                      ];
                      const extra =
                        card.castTags.length + card.sceneTags.length - chips.length;
                      const padLocked =
                        Boolean(String(block.refImageUrl || "").trim()) ||
                        /【垫图】|【像素垫图锁/.test(String(block.prompt || ""));
                      const imageBindLocked = /【资产·Image对照】/.test(
                        String(block.prompt || ""),
                      );
                      const bindRowCount = parseManhuaAssetImageBindBlock(
                        String(block.prompt || ""),
                      ).length;
                      const assetEdgeCount = countManhuaClipAssetEdges(edges, block.id);
                      const assetEdgeMin = expectedMinManhuaClipAssetEdges(bindRowCount);
                      const epIdx = getBlockEpisodeIndex(block) ?? 1;
                      const localSeg = resolveClipLocalSegmentIndex(
                        block.id,
                        block.prompt,
                        epIdx,
                      );
                      const voiceGate = evaluateManhuaCrossSegmentVoiceGate({
                        localSegmentIndex: localSeg,
                        currentPrompt: String(block.prompt || ""),
                        episodeSegmentPrompts:
                          collectManhuaEpisodeSegmentPromptsForVoiceGate(blocks, epIdx),
                        voiceLocks: characterVoiceLocks,
                      });
                      return (
                        <>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-cyan-400/30 px-1.5 py-0.5 font-semibold text-cyan-50">
                              第{String(seg).padStart(2, "0")}段 · {dur}s
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                                padLocked
                                  ? "bg-emerald-500/30 text-emerald-50"
                                  : "bg-amber-500/25 text-amber-50"
                              }`}
                            >
                              {padLocked ? "垫图已挂" : "待挂垫图"}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                                imageBindLocked
                                  ? "bg-emerald-500/30 text-emerald-50"
                                  : "bg-amber-500/25 text-amber-50"
                              }`}
                            >
                              {imageBindLocked ? "出场对照已挂" : "出场对照未挂"}
                            </span>
                            {assetEdgeMin > 0 ? (
                              <span
                                className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                                  assetEdgeCount >= assetEdgeMin
                                    ? "bg-emerald-500/30 text-emerald-50"
                                    : "bg-amber-500/25 text-amber-50"
                                }`}
                                title="成片与角色/场景/道具设定卡的连线数"
                              >
                                资产边 {assetEdgeCount}/{assetEdgeMin}
                              </span>
                            ) : null}
                            <span
                              className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                                voiceGate.requiredTags.length === 0
                                  ? "bg-white/10 text-white/45"
                                  : voiceGate.missingTags.length === 0
                                    ? "bg-emerald-500/30 text-emerald-50"
                                    : "bg-white/10 text-white/45"
                              }`}
                              title={
                                voiceGate.requiredTags.length
                                  ? voiceGate.missingTags.length === 0
                                    ? `已挂声线：${voiceGate.requiredTags.join("、")}`
                                    : voiceGate.messageZh || "声线可选，缺音不挡出片"
                                  : "声线可选；初登场常无参考音"
                              }
                            >
                              {voiceGate.requiredTags.length === 0
                                ? "声线·可选"
                                : voiceGate.missingTags.length === 0
                                  ? "声线已挂"
                                  : "声线未挂·不挡"}
                            </span>
                            {chips.map((t) => (
                              <span
                                key={t}
                                className="rounded bg-black/35 px-1.5 py-0.5 text-[10px] text-cyan-100/90"
                                title={t}
                              >
                                {friendlyManhuaAssetChipLabel(t, String(block.prompt || ""))}
                              </span>
                            ))}
                            {extra > 0 ? (
                              <span className="text-white/40">+{extra}</span>
                            ) : null}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                ) : null}

                <div
                  className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(7.5rem,9rem)] divide-x divide-white/10"
                >
                  {/* 左：设置 + 提示词（主区） */}
                  <div className="flex min-h-0 flex-col overflow-hidden p-3">
                    {!mediaOnly ? (
                    <div className="mb-2 space-y-2 rounded-xl border border-white/10 bg-black/25 p-2">
                      <div className="text-[10px] tracking-wider text-white/40">节点设置</div>
                      {block.kind === "text" || block.kind === "copy_organize" ? (
                        <label className="flex items-center gap-2 text-[11px] text-white/70">
                          <span className="shrink-0 text-white/45">模型</span>
                          <select
                            value={block.textModel}
                            onChange={(e) =>
                              patchOne(block.id, { textModel: e.target.value as CanvasBlock["textModel"] })
                            }
                            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white"
                          >
                            {TEXT_MODEL_OPTIONS.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {block.kind === "image" ? (
                        <>
                          <label className="flex items-center gap-2 text-[11px] text-white/70">
                            <span className="shrink-0 text-white/45">模式</span>
                            <select
                              value={block.imageMode || "generate"}
                              onChange={(e) => {
                                const nextEdit = e.target.value === "edit";
                                patchOne(block.id, {
                                  imageMode: nextEdit ? "edit" : "generate",
                                  ...(nextEdit
                                    ? {
                                        imageModel: "gpt-image-2" as const,
                                        refImageUrl:
                                          block.outputUrl ||
                                          block.outputUrls?.[0] ||
                                          block.refImageUrl,
                                      }
                                    : {}),
                                });
                              }}
                              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white"
                            >
                              <option value="generate">文生图</option>
                              <option value="edit">微调这张图</option>
                            </select>
                          </label>
                          <div className="flex items-center gap-2 text-[11px] text-white/70">
                            <span className="shrink-0 text-white/45">引擎</span>
                            <span className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white/85">
                              {IMAGE_MODEL_OPTIONS[0]?.label || "官方出图"}
                            </span>
                          </div>
                          <label className="flex items-center gap-2 text-[11px] text-white/70">
                            <span className="shrink-0 text-white/45">张数</span>
                            <select
                              value={block.imageBatchCount || 1}
                              onChange={(e) =>
                                patchOne(block.id, {
                                  imageBatchCount: Number(e.target.value) as CanvasImageBatchCount,
                                })
                              }
                              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white"
                            >
                              {CANVAS_IMAGE_BATCH_OPTIONS.map((o) => (
                                <option key={o.count} value={o.count}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {block.imageMode === "edit" ? (
                            <div className="space-y-2">
                              <div className="rounded-lg border border-rose-400/25 bg-rose-500/10 px-2 py-1.5 text-[10px] leading-5 text-rose-50/90">
                                <div className="font-semibold text-rose-100">怎么用 · 微调</div>
                                <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-rose-50/85">
                                  <li>先有一张八九成像的底图（上传或文生图结果）。</li>
                                  <li>提示词只写「要改的那一点」，并写清「其他保持不变」。例：丝带改成红色，脸与发型不动。</li>
                                  <li>可选：画笔涂抹只改局部；或勾选更多参考图做融合（妆造/道具参考）。</li>
                                  <li>整张都不对时，请重新生成或换角色，不要连续微调十几轮。</li>
                                </ol>
                                {(block.outputUrl || block.refImageUrl || block.outputUrls?.[0]) && (
                                  <button
                                    type="button"
                                    className="mt-1.5 block text-[10px] font-semibold text-[#8cefff] underline"
                                    onClick={() =>
                                      patchOne(block.id, {
                                        imageMode: "edit",
                                        refImageUrl:
                                          block.outputUrl || block.outputUrls?.[0] || block.refImageUrl,
                                        prompt: block.prompt?.trim()
                                          ? block.prompt
                                          : "微调画面：保持人物身份与构图，只优化光影与小细节，其他保持不变。",
                                      })
                                    }
                                  >
                                    用当前结果作为微调底图
                                  </button>
                                )}
                              </div>
                              {(() => {
                                const baseUrl =
                                  block.refImageUrl ||
                                  block.outputUrl ||
                                  block.outputUrls?.[0] ||
                                  block.uploadedAssets?.find((a) => a.kind === "image")?.url;
                                if (!baseUrl) {
                                  return (
                                    <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] text-white/45">
                                      请先上传或生成底图，再打开画笔遮罩。
                                    </div>
                                  );
                                }
                                return (
                                  <CanvasImageEditMaskPainter
                                    baseImageUrl={baseUrl}
                                    uploading={maskBusyId === block.id}
                                    hasSavedMask={Boolean(block.editMaskUrl)}
                                    onClearMaskUrl={() => patchOne(block.id, { editMaskUrl: undefined })}
                                    onExportMask={(blob) => void uploadEditMaskForBlock(block.id, blob)}
                                  />
                                );
                              })()}
                              {(() => {
                                const baseUrl =
                                  block.refImageUrl ||
                                  block.outputUrl ||
                                  block.outputUrls?.[0] ||
                                  "";
                                const imageAssets = (block.uploadedAssets || []).filter(
                                  (a) =>
                                    (a.kind ?? inferCanvasAssetKindFromFileName(a.fileName)) === "image" &&
                                    a.url &&
                                    a.url !== baseUrl &&
                                    a.url !== block.editMaskUrl,
                                );
                                if (!imageAssets.length) {
                                  return (
                                    <div className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-[10px] leading-5 text-white/45">
                                      <span className="font-semibold text-white/65">多图融合</span>
                                      ：再上传 1～几张参考图（妆造/道具/光影），勾选后写入提示词一起微调。
                                    </div>
                                  );
                                }
                                const selected = new Set(block.editFusionUrls || []);
                                return (
                                  <div className="rounded-lg border border-sky-400/25 bg-sky-500/10 px-2 py-1.5 text-[10px] leading-5 text-sky-50/90">
                                    <div className="font-semibold text-sky-100">多图融合（可选）</div>
                                    <div className="mt-0.5 text-sky-50/75">
                                      勾选要参考的图；提示词写清「参考哪张做什么」。例：参考图 B 的耳环，脸保持底图。
                                    </div>
                                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                                      {imageAssets.slice(0, 12).map((a) => {
                                        const on = selected.has(a.url);
                                        return (
                                          <button
                                            key={a.id}
                                            type="button"
                                            title={a.fileName}
                                            onClick={() => {
                                              const next = new Set(block.editFusionUrls || []);
                                              if (on) next.delete(a.url);
                                              else if (next.size < 15) next.add(a.url);
                                              patchOne(block.id, { editFusionUrls: Array.from(next) });
                                            }}
                                            className={`relative h-12 w-12 overflow-hidden rounded-md border ${
                                              on
                                                ? "border-sky-300 ring-2 ring-sky-400/60"
                                                : "border-white/15 opacity-80 hover:opacity-100"
                                            }`}
                                          >
                                            <img src={a.previewUrl || a.url} alt="" className="h-full w-full object-cover" />
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      {block.kind === "video" ? (
                        <>
                          <label className="flex items-center gap-2 text-[11px] text-white/70">
                            <span className="shrink-0 text-white/45">成片档位</span>
                            <select
                              value={
                                isCanvasProductVideoModel(block.videoModel)
                                  ? block.videoModel
                                  : DEFAULT_CANVAS_VIDEO_MODEL
                              }
                              onChange={(e) => {
                                const next = e.target.value as CanvasBlock["videoModel"];
                                if (isCanvasSeedance25VideoModel(next) && !canUseSeedance25) {
                                  toast.error(seedance25Gate.message || SEEDANCE_25_PAID_ONLY_LABEL_ZH);
                                  return;
                                }
                                patchOne(block.id, { videoModel: next });
                              }}
                              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white"
                            >
                              {videoModelOptions.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="text-[10px] leading-5 text-white/50">
                            {(block.videoModel || DEFAULT_CANVAS_VIDEO_MODEL) === "seedance-2.0-mini"
                              ? "Seedance 2.0 mini（草稿档）：最省，多图参考，最长约 15s；不支持 1080p"
                              : block.videoModel === "seedance-2.0"
                                ? "Seedance 2.0：多图参考 + 运镜/动作/对白，最长约 15s"
                                : block.videoModel === "seedance-2.5"
                                  ? "Seedance 2.5：官方五模式，最长约 30s；正式会员可用"
                                  : block.videoModel === "minimax-hailuo-3"
                                    ? "Minimax H3：2K 成片，多图参考，固定 15s"
                                    : block.videoModel === "happyhorse-1.1"
                                      ? "Happy Horse 1.1：首帧图生，最长 15s"
                                      : block.videoModel === "wan-3.0"
                                        ? "Wan 3.0（公测）：多图参考 + 参考音频，可直出 30s；排队时间较长，适合不赶时间的镜头"
                                        : "Seedance 2.0 fast：多图参考 + 运镜/动作/对白，更快更省，最长约 15s"}
                          </div>
                          {/* 画质只对标准档开放：快速档定位是便宜快，H3 固定 2K，2.5 固定 720p */}
                          {block.videoModel === "seedance-2.0" ? (
                            <label className="flex items-center gap-2 text-[11px] text-white/70">
                              <span className="shrink-0 text-white/45">画质</span>
                              <select
                                value={normalizeCanvasVideoResolution(block.videoResolution)}
                                onChange={(e) =>
                                  patchOne(block.id, {
                                    videoResolution: normalizeCanvasVideoResolution(e.target.value),
                                  })
                                }
                                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white"
                              >
                                {CANVAS_VIDEO_RESOLUTIONS.map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                    {" · "}
                                    {canvasVideoClipCredits({ resolution: r })} 积分/段
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                          <div className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-[10px] font-medium tracking-wide text-white/70">
                            {block.aspectRatio || "9:16"}
                            {" · "}
                            {parseManhuaClipDirectorCardSummary(block.prompt).durationSec ?? 15}s
                            {" · "}
                            1 条
                            {String(block.id).startsWith("clip-")
                              ? ` · 资产边 ${countManhuaClipAssetEdges(edges, block.id)}`
                              : ""}
                          </div>
                          {/* 服务端对所有成片档都验会员，前端先说清楚，别让人等到扣费闸门才知道 */}
                          {!canUsePaidVideo ? (
                            <div className="rounded-lg border border-dashed border-amber-400/30 bg-amber-500/5 px-2 py-1.5 text-[10px] leading-5 text-amber-100/85">
                              {PAID_VIDEO_MEMBER_ONLY_LABEL_ZH}
                            </div>
                          ) : null}
                          {block.videoModel === "seedance-2.5" && canUseSeedance25 ? (
                            <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-2">
                              <label className="flex items-center gap-2 text-[11px] text-white/70">
                                <span className="shrink-0 text-white/45">工作模式</span>
                                <select
                                  value={normalizeSeedance25EvolinkMode(block.seedance25WorkMode)}
                                  onChange={(e) =>
                                    patchOne(block.id, {
                                      seedance25WorkMode: e.target
                                        .value as CanvasBlock["seedance25WorkMode"],
                                    })
                                  }
                                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white"
                                >
                                  <option value="text_to_video">文生视频</option>
                                  <option value="image_to_video">图生视频（1–2 张）</option>
                                  <option value="reference_to_video">多模态参考生成</option>
                                  <option value="video_edit">视频编辑</option>
                                  <option value="video_extend">视频延长</option>
                                </select>
                              </label>
                              <div className="text-[10px] leading-5 text-white/45">
                                {(() => {
                                  const mode = normalizeSeedance25EvolinkMode(
                                    block.seedance25WorkMode,
                                  );
                                  if (mode === "text_to_video") {
                                    return "只使用提示词生成视频，不发送画布上的参考素材。";
                                  }
                                  if (mode === "image_to_video") {
                                    return "使用画布链路中的前 1–2 张图片生成视频，可表达首帧与尾帧。";
                                  }
                                  if (mode === "reference_to_video") {
                                    return "综合图片、视频与音频参考生成；适合漫剧角色、场景和声线锁定。";
                                  }
                                  if (mode === "video_edit") {
                                    return "按提示词编辑参考视频；必须先出片或上传并勾选至少一条视频。";
                                  }
                                  return "接着参考视频向后续写 4–30 秒；必须先出片或上传并勾选视频。";
                                })()}
                              </div>
                              <div>
                                <div className="mb-1 text-[10px] text-white/45">
                                  秒级分镜（可选，一行一段：0-5 | 画面）
                                </div>
                                <textarea
                                  value={block.seedance25TimestampStoryboard || ""}
                                  onChange={(e) =>
                                    patchOne(block.id, {
                                      seedance25TimestampStoryboard: e.target.value,
                                    })
                                  }
                                  rows={3}
                                  placeholder={"0-5 | 环绕半周展空间\n5-15 | 推近面部对白"}
                                  className="w-full resize-y rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] leading-5 text-white placeholder:text-white/30"
                                />
                              </div>
                              {(() => {
                                const vids = (block.uploadedAssets || []).filter(
                                  (a) =>
                                    a.kind === "video" ||
                                    /\.(mp4|mov|webm)(\?|$)/i.test(a.url || a.fileName || ""),
                                );
                                const auds = (block.uploadedAssets || []).filter(
                                  (a) =>
                                    a.kind === "audio" ||
                                    /\.(mp3|wav|m4a|aac)(\?|$)/i.test(a.url || a.fileName || ""),
                                );
                                const selectedV = new Set(block.seedance25RefVideoUrls || []);
                                const selectedA = new Set(block.seedance25RefAudioUrls || []);
                                const toggle = (
                                  set: Set<string>,
                                  url: string,
                                  max: number,
                                  key: "seedance25RefVideoUrls" | "seedance25RefAudioUrls",
                                ) => {
                                  const next = new Set(set);
                                  if (next.has(url)) next.delete(url);
                                  else if (next.size < max) next.add(url);
                                  patchOne(block.id, { [key]: Array.from(next) });
                                };
                                return (
                                  <div className="space-y-1.5">
                                    <div className="text-[10px] text-white/45">
                                      参考视频（最多 10）· 先上传 MP4 再勾选
                                      {block.seedance25WorkMode === "video_edit" ||
                                      block.seedance25WorkMode === "video_extend"
                                        ? "——勾选的第 1 条是被编辑/延长的主片，其余作参考"
                                        : ""}
                                      {block.outputUrl ? " · 已有成片也可直接编辑/延长" : ""}
                                    </div>
                                    {vids.length ? (
                                      <div className="flex flex-wrap gap-1.5">
                                        {vids.slice(0, 10).map((a) => {
                                          const on = selectedV.has(a.url);
                                          return (
                                            <button
                                              key={a.id}
                                              type="button"
                                              title={a.fileName}
                                              onClick={() =>
                                                toggle(
                                                  selectedV,
                                                  a.url,
                                                  10,
                                                  "seedance25RefVideoUrls",
                                                )
                                              }
                                              className={`max-w-[9rem] truncate rounded-md border px-2 py-1 text-[10px] ${
                                                on
                                                  ? "border-sky-300/80 bg-sky-500/15 text-sky-50"
                                                  : "border-white/15 text-white/70"
                                              }`}
                                            >
                                              {a.fileName || "视频"}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <div className="text-[10px] text-white/35">
                                        尚无上传视频；可用上方上传区添加 MP4
                                      </div>
                                    )}
                                    <div className="text-[10px] text-white/45">
                                      参考音频（最多 10）· 上传 MP3/WAV 后勾选
                                    </div>
                                    {auds.length ? (
                                      <div className="flex flex-wrap gap-1.5">
                                        {auds.slice(0, 10).map((a) => {
                                          const on = selectedA.has(a.url);
                                          return (
                                            <button
                                              key={a.id}
                                              type="button"
                                              title={a.fileName}
                                              onClick={() =>
                                                toggle(
                                                  selectedA,
                                                  a.url,
                                                  10,
                                                  "seedance25RefAudioUrls",
                                                )
                                              }
                                              className={`max-w-[9rem] truncate rounded-md border px-2 py-1 text-[10px] ${
                                                on
                                                  ? "border-emerald-300/80 bg-emerald-500/15 text-emerald-50"
                                                  : "border-white/15 text-white/70"
                                              }`}
                                            >
                                              {a.fileName || "音频"}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <div className="text-[10px] text-white/35">
                                        尚无上传音频；可与图片一并上传
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              {block.outputUrl &&
                              /\.(mp4|mov|webm|m4v)(\?|$)/i.test(block.outputUrl) ? (
                                <div className="space-y-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      patchOne(block.id, {
                                        seedance25WorkMode: "video_extend",
                                        seedance25RefVideoUrls: Array.from(
                                          new Set([
                                            ...(block.seedance25RefVideoUrls || []),
                                            block.outputUrl!,
                                          ]),
                                        ).slice(0, 10),
                                      })
                                    }
                                    className="w-full rounded-lg border border-white/15 bg-white/[0.04] px-2 py-1.5 text-[11px] text-white/80 hover:bg-white/[0.08]"
                                  >
                                    用当前成片再延长一轮
                                  </button>
                                  <button
                                    type="button"
                                    disabled={eraseCornerBusyId === block.id}
                                    onClick={() => void eraseCornerMarkForBlock(block.id)}
                                    className="w-full rounded-lg border border-amber-300/35 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-50/90 hover:bg-amber-500/15 disabled:opacity-50"
                                    title="后期修补左上角标，不裁画面；非上游无标导出"
                                  >
                                    {eraseCornerBusyId === block.id
                                      ? "正在清除角标…"
                                      : "清除左上角标（后期修补）"}
                                  </button>
                                  {/* 高清放大：结果写独立字段，原片保留；任务随画布持久化可刷新恢复 */}
                                  {block.upscaleTaskId &&
                                  block.upscaleStatus &&
                                  !isVideoUpscaleTerminal(block.upscaleStatus) ? (
                                    <div className="rounded-lg border border-sky-300/30 bg-sky-500/10 px-2 py-1.5 text-[10px] leading-4 text-sky-100/90">
                                      高清放大（{(block.upscaleTarget || "").toUpperCase()}）·
                                      {videoUpscaleStatusLabel(block.upscaleStatus)}
                                    </div>
                                  ) : null}
                                  {block.upscaleStatus === "failed" ? (
                                    <div className="rounded-lg border border-rose-300/30 bg-rose-500/10 px-2 py-1.5 text-[10px] leading-4 text-rose-100/90">
                                      放大失败：{block.upscaleError || "请重试"}（积分已退回）
                                    </div>
                                  ) : null}
                                  {block.upscaleStatus === "reconcile_manual" ? (
                                    <div className="rounded-lg border border-orange-300/30 bg-orange-500/10 px-2 py-1.5 text-[10px] leading-4 text-orange-100/90">
                                      放大超时且暂无法确认结果，已转人工核对——不会白扣积分
                                    </div>
                                  ) : null}
                                  {block.upscaledVideoUrl ? (
                                    <a
                                      href={block.upscaledVideoUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block w-full rounded-lg border border-emerald-300/35 bg-emerald-500/10 px-2 py-1.5 text-center text-[11px] text-emerald-50/90 hover:bg-emerald-500/15"
                                      title="高清版单独存放，原片未被覆盖"
                                    >
                                      打开高清版（{(block.upscaleTarget || "").toUpperCase()}）
                                    </a>
                                  ) : null}
                                  {upscalePanelBlockId === block.id ? (
                                    (() => {
                                      const sec = upscaleProbedSec[block.id];
                                      const freeform = !(Number(block.episodeIndex) > 0);
                                      return (
                                        <div className="space-y-1 rounded-lg border border-white/15 bg-white/[0.04] p-2">
                                          <div className="text-[10px] text-white/60">
                                            {sec
                                              ? `视频约 ${sec} 秒 · 按秒计费${freeform ? "" : "（整集批发价）"}`
                                              : "读取视频时长中…"}
                                          </div>
                                          {sec ? (
                                            <div className="grid grid-cols-2 gap-1">
                                              {(["2k", "4k"] as const).map((t) => (
                                                <button
                                                  key={t}
                                                  type="button"
                                                  disabled={upscaleBusyId === block.id}
                                                  onClick={() =>
                                                    void startUpscaleForBlock(block.id, t)
                                                  }
                                                  className="rounded-lg border border-sky-300/35 bg-sky-500/10 px-2 py-1.5 text-[11px] text-sky-50/90 hover:bg-sky-500/15 disabled:opacity-50"
                                                >
                                                  {t.toUpperCase()} ·{" "}
                                                  {canvasVideoUpscaleCredits(t, sec, { freeform })}{" "}
                                                  积分
                                                </button>
                                              ))}
                                            </div>
                                          ) : null}
                                        </div>
                                      );
                                    })()
                                  ) : !block.upscaleTaskId ||
                                    (block.upscaleStatus &&
                                      isVideoUpscaleTerminal(block.upscaleStatus)) ? (
                                    <button
                                      type="button"
                                      onClick={() => void openUpscalePanel(block.id)}
                                      className="w-full rounded-lg border border-sky-300/35 bg-sky-500/10 px-2 py-1.5 text-[11px] text-sky-50/90 hover:bg-sky-500/15"
                                      title="WaveSpeed 高清放大，按秒计费；结果单独存放不覆盖原片"
                                    >
                                      {block.upscaledVideoUrl
                                        ? "重新高清放大（2K / 4K）"
                                        : "高清放大（2K / 4K）"}
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                              {block.seedance25WebThreadLink ? (
                                <a
                                  href={block.seedance25WebThreadLink}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="block truncate text-[10px] text-sky-200/80 underline-offset-2 hover:underline"
                                  title="超时或拉取失败时先打开这里确认是否已出片，勿重复点生成"
                                >
                                  查看本轮创作记录（先确认再重试）
                                </a>
                              ) : null}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      {block.kind === "video_reverse" ? (
                        <div className="text-[10px] leading-5 text-white/50">
                          在浏览器本地抽帧后自动拉片（约 2 分钟内）。输出分镜表与微动成片句。网络视频请先下载到本机再上传。
                        </div>
                      ) : null}
                      {(block.kind === "text" ||
                        block.kind === "copy_organize" ||
                        block.kind === "video_reverse") &&
                      (visionCount > 0 || documentCount > 0) ? (
                        <div className="text-[10px] text-white/50">
                          {[
                            visionCount > 0 ? `已接入 ${visionCount} 张图片` : "",
                            documentCount > 0 ? `已接入 ${documentCount} 份文档` : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      ) : null}
                    </div>
                    ) : (
                      <div className="mb-2 shrink-0">
                        <select
                          value={block.aspectRatio}
                          onChange={(e) =>
                            patchOne(block.id, { aspectRatio: e.target.value as "9:16" | "16:9" })
                          }
                          className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[10px] text-white"
                        >
                          <option value="9:16">9:16</option>
                          <option value="16:9">16:9</option>
                        </select>
                      </div>
                    )}

                    {(block.kind === "image" ||
                      block.kind === "video" ||
                      block.kind === "video_reverse") &&
                    !mediaOnly ? (
                      <div className="mb-2 shrink-0">
                        <select
                          value={block.aspectRatio}
                          onChange={(e) =>
                            patchOne(block.id, { aspectRatio: e.target.value as "9:16" | "16:9" })
                          }
                          className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[10px] text-white"
                        >
                          <option value="9:16">9:16</option>
                          <option value="16:9">16:9</option>
                        </select>
                      </div>
                    ) : null}

                    {String(block.id || "").startsWith("clip-") ? (
                      <CanvasClipPadVisualBody block={block} />
                    ) : null}
                    <div className="mb-1.5 shrink-0 text-[10px] tracking-wider text-white/40">
                      {String(block.id || "").startsWith("clip-") ? "秒轴说明（可微调）" : "提示词"}
                    </div>
                    {String(block.id || "").startsWith("clip-") && manhuaMention ? (
                      <ManhuaPromptMentionEditor
                        segmentIndex={resolveClipSegmentIndex(block.id, block.prompt)}
                        value={sanitizeManhuaClipPromptForUi(block.prompt)}
                        onChange={(next) => {
                          const cleaned = sanitizeManhuaClipPromptForUi(next);
                          patchOne(block.id, { prompt: cleaned });
                          /**
                           * @ 选完只改对照表不够：人/场/道节点都要接到这段成片，
                           * 否则画布上永远只剩静帧→成片一条线，看着像没锁。
                           */
                          if (manhuaMention.registry) {
                            const fromIds = resolveManhuaClipRelatedAssetNodeIds({
                              clipPrompt: cleaned,
                              blocks,
                              registry: manhuaMention.registry,
                            });
                            onEdgesChange(
                              syncManhuaClipAssetEdges(edges, block.id, fromIds),
                            );
                          }
                        }}
                        rows={6}
                        placeholder="写清谁在做什么、镜头怎么动；敲 @ 锁本集人物/场景/道具"
                        registry={manhuaMention.registry}
                        assetCanon={manhuaMention.assetCanon}
                        thumbUrlByAssetId={manhuaMention.thumbUrlByAssetId}
                        onRequestGenerateAsset={manhuaMention.onRequestGenerateAsset}
                      />
                    ) : (
                    <textarea
                      value={
                        block.id.startsWith("clip-")
                          ? sanitizeManhuaClipPromptForUi(block.prompt)
                          : block.prompt
                      }
                      onChange={(e) => {
                        const next = e.target.value;
                        patchOne(block.id, {
                          prompt: block.id.startsWith("clip-")
                            ? sanitizeManhuaClipPromptForUi(next)
                            : next,
                        });
                      }}
                      className={
                        String(block.id || "").startsWith("clip-")
                          ? "h-28 w-full shrink-0 resize-y rounded-xl border border-white/10 bg-black/35 px-2.5 py-2 text-[11px] leading-5 text-white/85 outline-none focus:border-primary/40"
                          : "min-h-0 w-full flex-1 resize-none rounded-xl border border-white/10 bg-black/35 px-2.5 py-2 text-xs leading-6 text-white outline-none focus:border-primary/40"
                      }
                      placeholder={
                        String(block.id || "").startsWith("clip-")
                          ? "写清谁在做什么、镜头怎么动；人物与场景跟上方垫图走"
                          : documentCount > 0 && (block.kind === "text" || block.kind === "copy_organize")
                            ? "例：请把文档中 part1 与 part2 去重，整理成语意通顺、条理分明的详尽正文…"
                            : visionCount > 0 && (block.kind === "text" || block.kind === "copy_organize")
                              ? "例：帮我识别所有图片内容，归纳整理成文档，重复部分去掉，标题清晰、内容详尽…"
                              : meta.hint
                      }
                    />
                    )}
                    {upstreamHandoff.length ? (
                      <div
                        className="mt-2 rounded-lg border border-sky-400/25 bg-sky-500/10 px-2 py-1.5 text-[10px] leading-5 text-sky-100/90"
                        title={upstreamHandoff.map((item, i) => `[${i + 1}] ${item.text}`).join("\n\n")}
                      >
                        已连接 {upstreamHandoff.length} 个上游方块（含多级连线）· 运行时将自动引用
                        {upstreamPreview ? `：${upstreamPreview}${upstreamHandoff.map((item) => item.text).join(" · ").length > 120 ? "…" : ""}` : ""}
                      </div>
                    ) : null}
                  </div>

                  {/* 右：窄栏上传按钮 + 文件名 + 紧凑结果 */}
                  <div className="flex min-h-0 w-full flex-col gap-1.5 p-2">
                    <label
                      htmlFor={`canvas-upload-rail-${block.id}`}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      className={`inline-flex shrink-0 cursor-pointer items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[10px] font-medium ${
                        isUploading
                          ? "pointer-events-none border-amber-400/35 bg-amber-500/10 text-amber-100 opacity-70"
                          : "border-white/15 bg-white/10 text-white/85 hover:bg-white/15"
                      }`}
                    >
                      {isUploading ? (
                        <LoaderCircle className="h-3 w-3 animate-spin" />
                      ) : (
                        <Upload className="h-3 w-3" />
                      )}
                      上传
                    </label>
                    <input
                      id={`canvas-upload-rail-${block.id}`}
                      type="file"
                      accept={CANVAS_UPLOAD_ACCEPT}
                      multiple
                      className="sr-only"
                      disabled={isUploading}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const picked = takeFilesFromInput(e.target);
                        if (picked.length) void uploadFilesForBlock(block.id, picked);
                      }}
                    />
                    <CanvasBlockPreviewPanel
                      block={block}
                      isUploading={isUploading}
                      displayOutputs={displayOutputs}
                    />
                  </div>
                </div>

                  </>
                )}

                {selected ? (
                  <button
                    type="button"
                    aria-label="缩放方块"
                    className="absolute bottom-0 right-0 z-10 h-5 w-5 cursor-se-resize rounded-tl-lg border border-white/20 bg-white/15 hover:bg-white/25"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setResizeState({
                        id: block.id,
                        startW: block.width,
                        startH: block.height,
                        startPointerX: e.clientX,
                        startPointerY: e.clientY,
                      });
                      e.preventDefault();
                    }}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
        </div>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2">
        <button
          type="button"
          onClick={() => fitAllInView()}
          className="pointer-events-auto rounded-full border border-cyan-300/40 bg-cyan-500/20 px-3 py-1 text-[11px] font-semibold text-cyan-50 shadow-lg backdrop-blur hover:bg-cyan-500/30"
        >
          看全图
        </button>
        <button
          type="button"
          aria-label="缩小"
          onClick={() => applyZoom((viewScaleRef.current || 1) / 1.25)}
          className="pointer-events-auto rounded-full border border-white/15 bg-black/70 px-3 py-1 text-[13px] font-semibold leading-none text-white/85 shadow-lg backdrop-blur hover:bg-white/15"
        >
          −
        </button>
        <button
          type="button"
          title="点击复位 100%"
          onClick={() => applyZoom(1)}
          className="pointer-events-auto rounded-full border border-white/15 bg-black/70 px-3 py-1 text-[11px] font-medium text-white/75 shadow-lg backdrop-blur hover:bg-white/15"
        >
          视野 {viewportPct}% · {Math.round(viewScale * 100)}%
        </button>
        <button
          type="button"
          aria-label="放大"
          onClick={() => applyZoom((viewScaleRef.current || 1) * 1.25)}
          className="pointer-events-auto rounded-full border border-white/15 bg-black/70 px-3 py-1 text-[13px] font-semibold leading-none text-white/85 shadow-lg backdrop-blur hover:bg-white/15"
        >
          +
        </button>
      </div>
      </div>

      {/* 引用生成菜单 */}
      {spawnMenu ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            aria-label="关闭菜单"
            onClick={() => setSpawnMenu(null)}
          />
          <div
            className="fixed z-50 w-56 rounded-2xl border border-white/15 bg-[#121826] p-2 shadow-2xl"
            style={{ left: spawnMenu.x, top: spawnMenu.y }}
          >
            <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-white/40">引用该节点生成</div>
            {spawnOptions.map((opt) => {
              const Icon = CANVAS_KIND_META[opt.kind].icon;
              return (
                <button
                  key={opt.kind}
                  type="button"
                  className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left hover:bg-white/10"
                  onClick={() => {
                    const parent = blockMap.get(spawnMenu.anchorBlockId);
                    addBlock(opt.kind, {
                      parentId: spawnMenu.anchorBlockId,
                      x: (parent?.x ?? 0) + (parent?.width ?? CANVAS_BLOCK_DEFAULT_WIDTH) + 40,
                      y: (parent?.y ?? 0) + 32,
                    });
                    setSpawnMenu(null);
                  }}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <div className="text-sm font-medium text-white">{opt.label}</div>
                    <div className="text-[11px] text-white/45">{opt.hint}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      ) : null}

      {/* 左侧 + 功能菜单 */}
      {toolbarMenu ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default bg-transparent"
            aria-label="关闭菜单"
            onClick={() => setToolbarMenu(null)}
          />
          <div
            className="fixed z-50 w-60 rounded-2xl border border-white/15 bg-[#121826] p-2 shadow-2xl"
            style={{ left: toolbarMenu.x, top: toolbarMenu.y }}
          >
            <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-white/40">添加方块</div>
            {spawnOptions.map((opt) => {
              const Icon = CANVAS_KIND_META[opt.kind].icon;
              return (
                <button
                  key={opt.kind}
                  type="button"
                  className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left hover:bg-white/10"
                  onClick={() => {
                    spawnFromToolbar(opt.kind);
                  }}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <div className="text-sm font-medium text-white">{opt.label}</div>
                    <div className="text-[11px] text-white/45">{opt.hint}</div>
                  </div>
                </button>
              );
            })}
            <div className="my-1 h-px bg-white/10" />
            <button
              type="button"
              className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left hover:bg-white/10"
              onClick={spawnImageVideoChain}
            >
              <Clapperboard className="mt-0.5 h-4 w-4 shrink-0 text-fuchsia-300" />
              <div>
                <div className="text-sm font-medium text-white">静帧→成片</div>
                <div className="text-[11px] text-white/45">一键铺图片与视频链</div>
              </div>
            </button>
            <button
              type="button"
              className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left hover:bg-white/10"
              onClick={openToolbarUpload}
            >
              <Upload className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <div>
                <div className="text-sm font-medium text-white">上传素材</div>
                <div className="text-[11px] text-white/45">图片、视频或文档（PDF/TXT/MD）</div>
              </div>
            </button>
          </div>
        </>
      ) : null}
    </div>
    </CanvasImagePreviewCtx.Provider>
  );
}
