import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CANVAS_BLOCK_DEFAULT_HEIGHT,
  CANVAS_BLOCK_DEFAULT_WIDTH,
  CANVAS_BLOCK_MAX_HEIGHT,
  CANVAS_BLOCK_MAX_WIDTH,
  CANVAS_BLOCK_MIN_HEIGHT,
  CANVAS_BLOCK_MIN_WIDTH,
  CANVAS_KIND_META,
  CANVAS_UPLOAD_ACCEPT,
  CANVAS_UPLOAD_FORMAT_HINT,
  collectDocumentAssets,
  collectUpstreamHandoff,
  collectUpstreamTexts,
  collectVisionImages,
  defaultCanvasBlock,
  IMAGE_MODEL_OPTIONS,
  makeCanvasBlockId,
  resolveBlockHandoffText,
  resolveNearestUpstreamImageUrl,
  SPAWN_KIND_OPTIONS,
  TEXT_MODEL_OPTIONS,
  VIDEO_MODEL_OPTIONS,
  type CanvasBlock,
  type CanvasBlockKind,
  type CanvasEdge,
  type CanvasImageBatchCount,
  type CanvasUploadedAsset,
} from "@/lib/canvasTypes";
import {
  CANVAS_IMAGE_BATCH_OPTIONS,
} from "@/lib/canvasCredits";
import { isCanvasUploadableFile, inferCanvasAssetKindFromFileName, takeFilesFromInput, uploadCanvasFilesParallel, uploadOneCanvasAsset, CANVAS_UPLOAD_CONCURRENCY } from "@/lib/canvasUpload";
import { loadCanvasDocumentTexts } from "@/lib/canvasDocumentText";
import { runCanvasBlock, type CanvasRunDeps } from "@/lib/canvasRunBlock";
import {
  collectManhuaEpisodeSegmentPromptsForVoiceGate,
  getBlockEpisodeIndex,
  sanitizeManhuaRecapUpstreamLinks,
} from "@/lib/canvasDramaStudio";
import {
  MANHUA_CLIP_CONTINUITY_HINT_ZH,
  MANHUA_CLIP_CROSS_SEGMENT_TRANSITION_HINT_ZH,
  resolvePreviousSegmentClipUrl,
} from "@shared/manhuaClipContinuity";
import { resolveClipSegmentIndex } from "@shared/manhuaScriptWorkbench";
import {
  parseManhuaCanvasAssetAtTag,
  sanitizeManhuaClipPromptForUi,
} from "@shared/manhuaAssetLockRegistry";
import { parseManhuaSheetPropSubTagsFromPrompt } from "@shared/manhuaSheetPropSubTags";
import {
  evaluateManhuaCrossSegmentVoiceGate,
  type ManhuaCharacterVoiceLock,
} from "@shared/manhuaCharacterVoiceLock";
import { resolveClipLocalSegmentIndex } from "@shared/manhuaScriptWorkbench";
import { resolveOmniMaterialUrl, uploadFileToSignedUrl } from "@/lib/omniCanvasApi";
import {
  formatManhuaClipDirectorCueFaceLine,
  parseManhuaClipDirectorCardSummary,
} from "@shared/manhuaClipDirectorCard";
import { CanvasImageEditMaskPainter } from "@/components/canvas/CanvasImageEditMaskPainter";
import { trpc } from "@/lib/trpc";
import {
  Clapperboard,
  LoaderCircle,
  Plus,
  Sparkles,
  Upload,
  X,
  FileText,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

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

function CanvasBlockPreviewPanel({
  block,
  isUploading,
  displayOutputs,
}: {
  block: CanvasBlock;
  isUploading: boolean;
  displayOutputs: string[];
}) {
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
  const hasUploadContent = uploading || assets.length > 0 || failures.length > 0;
  const progressPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
      {uploading ? (
        <div className="flex min-h-[180px] flex-1 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-amber-400/45 bg-amber-500/15 px-4 py-6 text-center">
          <LoaderCircle className="h-10 w-10 animate-spin text-amber-100" aria-hidden />
          <div className="text-sm font-semibold text-amber-50">
            {message || (total > 0 ? `正在上传 ${done}/${total}` : "正在上传…")}
          </div>
          {total > 0 ? (
            <div className="w-full max-w-[200px]">
              <div className="h-2 overflow-hidden rounded-full bg-amber-950/60">
                <div
                  className="h-full rounded-full bg-amber-300 transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="mt-1 text-[10px] text-amber-200/80">{progressPct}%</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!uploading && failures.length > 0 ? (
        <div className="space-y-1.5 rounded-xl border border-red-400/35 bg-red-500/15 p-2.5">
          <div className="text-[11px] font-semibold text-red-100">上传失败</div>
          {failures.map((fail) => (
            <div key={`preview-fail-${fail.fileName}`} className="text-[10px] leading-5 text-red-50/95">
              <span className="font-medium">{fail.fileName}</span>
              <span className="text-red-200/90"> · {fail.error}</span>
            </div>
          ))}
        </div>
      ) : null}

      {!uploading && assets.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold text-emerald-100">已上传素材</div>
            <div className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] text-emerald-100">
              {assets.length} 个
            </div>
          </div>
          <div className="space-y-2">
            {assets.map((asset) => {
              const kind = asset.kind ?? inferCanvasAssetKindFromFileName(asset.fileName) ?? "image";
              const previewSrc = asset.previewUrl || asset.url;
              return (
                <div
                  key={asset.id}
                  className="overflow-hidden rounded-lg border border-emerald-400/20 bg-black/40"
                >
                  {kind === "image" ? (
                    <img
                      src={previewSrc}
                      alt={asset.fileName}
                      className="max-h-[180px] w-full bg-black/50 object-contain"
                    />
                  ) : kind === "video" ? (
                    <video
                      src={previewSrc}
                      controls
                      playsInline
                      className="max-h-[180px] w-full bg-black"
                    />
                  ) : (
                    <div className="flex items-center gap-3 px-3 py-5">
                      <FileText className="h-9 w-9 shrink-0 text-amber-200" aria-hidden />
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-medium text-white/95">{asset.fileName}</div>
                        <div className="text-[10px] text-amber-200/80">文档 · 已上传成功</div>
                      </div>
                    </div>
                  )}
                  <div className="border-t border-white/10 bg-black/30 px-2 py-1 text-[10px] text-white/65">
                    <span className="truncate">{asset.fileName}</span>
                    <span className="text-emerald-300/90"> · 上传成功</span>
                  </div>
                </div>
              );
            })}
          </div>
          {(block.kind === "image" || block.kind === "video" || block.kind === "video_reverse") &&
          !hasGeneratedOutput ? (
            <p className="text-center text-[10px] text-emerald-200/90">素材已就绪，点击顶部「运行」开始生成</p>
          ) : null}
        </div>
      ) : null}

      {block.status === "error" && block.error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-100">
          生成失败：{block.error}
        </div>
      ) : null}

      {hasGeneratedOutput ? (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-white/40">生成结果</div>
          {block.outputText ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-2 text-[11px] leading-5 text-white/85">
              {block.outputText}
            </pre>
          ) : null}
          {block.kind === "image" && displayOutputs.length > 0 ? (
            <div className={`grid gap-1.5 ${displayOutputs.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
              {displayOutputs.map((url, idx) => (
                <img
                  key={`${url}-${idx}`}
                  src={url}
                  alt={`output-${idx + 1}`}
                  className="max-h-[160px] w-full rounded-lg border border-white/10 object-contain"
                />
              ))}
            </div>
          ) : null}
          {block.outputUrl && block.kind === "video" ? (
            <video src={block.outputUrl} controls className="max-h-[180px] w-full rounded-lg border border-white/10" />
          ) : null}
        </div>
      ) : null}

      {!uploading && !hasUploadContent && !hasGeneratedOutput && block.status !== "error" ? (
        <div className="flex min-h-[180px] flex-1 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/15 bg-black/25 px-4 text-center">
          <Upload className="h-9 w-9 text-white/25" aria-hidden />
          <p className="text-xs font-medium text-white/45">上传后在此预览</p>
          <p className="text-[10px] leading-5 text-white/30">左侧点「上传素材」· 支持图片 / 视频 / 文档</p>
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
  onReplaceCharacterVoiceAudio,
  /** 嵌入工作台右栏时占满容器，禁止外层再套一层 overflow 双滚动 */
  fillContainer = false,
}: FreeformCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const toolbarFileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadBlockIdRef = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 外部 focus 时短暂高亮，避免只滚过去却看不见点了哪张 */
  const [pulseHighlightId, setPulseHighlightId] = useState<string | null>(null);
  const [spawnMenu, setSpawnMenu] = useState<SpawnMenuState>(null);
  const [toolbarMenu, setToolbarMenu] = useState<ToolbarMenuState>(null);
  const [dragState, setDragState] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState>(null);
  const [uploadBusyId, setUploadBusyId] = useState<string | null>(null);
  const [maskBusyId, setMaskBusyId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ blockId: string; done: number; total: number } | null>(null);
  const getSignedUrlMutation = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  const focusMissSinceRef = useRef<number | null>(null);

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

  /** absolute 节点不撑开滚动区；按节点包围盒扩世界，才能滚到竖排底部 */
  const worldSize = useMemo(() => {
    let w = 3600;
    let h = 2400;
    for (const b of visibleBlocks) {
      w = Math.max(w, Math.ceil(b.x + b.width + 200));
      h = Math.max(h, Math.ceil(b.y + b.height + 200));
    }
    return { w, h };
  }, [visibleBlocks]);

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
      const pad = 28;
      const fitsX = block.width + pad * 2 <= canvas.clientWidth;
      const fitsY = block.height + pad * 2 <= canvas.clientHeight;
      const targetLeft = Math.max(
        0,
        fitsX ? block.x - (canvas.clientWidth - block.width) / 2 : block.x - pad,
      );
      const targetTop = Math.max(
        0,
        fitsY ? block.y - (canvas.clientHeight - block.height) / 2 : block.y - pad,
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
    const x = canvas.scrollLeft + (canvas.clientWidth - width) / 2 + stagger * 22;
    const y = canvas.scrollTop + (canvas.clientHeight - height) / 2 + stagger * 18;
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
      const x = canvas.scrollLeft + 24 + stagger * 20;
      const y =
        canvas.scrollTop + (anchorCenterY - canvasRect.top) - height / 2 + stagger * 14;
      const minX = canvas.scrollLeft + 8;
      const minY = canvas.scrollTop + 8;
      const maxX = canvas.scrollLeft + canvas.clientWidth - width - 8;
      const maxY = canvas.scrollTop + canvas.clientHeight - height - 8;
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
      const visionImages = collectVisionImages(blockId, safeBlocks, safeEdges);
      const nearestRef =
        block.kind === "image" || block.kind === "video"
          ? block.refImageUrl || resolveNearestUpstreamImageUrl(blockId, safeBlocks, safeEdges)
          : block.refImageUrl;
      let runBlockPayload =
        nearestRef && nearestRef !== block.refImageUrl
          ? { ...block, refImageUrl: nearestRef }
          : block;
      // 手点 clip：上一段成片（全集连续编号 g07←g06）供末帧/视频参考
      if (block.id.startsWith("clip-") && !runBlockPayload.refVideoUrl) {
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
          block.kind === "text" || block.kind === "copy_organize"
            ? await loadCanvasDocumentTexts(collectDocumentAssets(blockId, safeBlocks, safeEdges))
            : [];
        const texts = [...collectUpstreamTexts(blockId, safeBlocks, safeEdges), ...docTexts];
        const out = await runCanvasBlock(runDeps, runBlockPayload, { visionImages, texts });
        patchOne(blockId, {
          status: "done",
          outputText: out.outputText,
          outputUrl: out.outputUrl,
          outputUrls: out.outputUrls ?? (out.outputUrl ? [out.outputUrl] : block.outputUrls),
        });
        toast.success("生成完成");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "生成失败";
        patchOne(blockId, { status: "error", error: msg });
        toast.error(msg);
      }
    },
    [blocks, edges, onBlocksChange, onEdgesChange, patchOne, runDeps],
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
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left - dragState.offsetX + canvas.scrollLeft;
      const y = e.clientY - rect.top - dragState.offsetY + canvas.scrollTop;
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
      const dw = e.clientX - resizeState.startPointerX;
      const dh = e.clientY - resizeState.startPointerY;
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
    return (
      <path
        key={`${fromId}-${toId}`}
        d={`M ${from.x} ${from.y} C ${mx} ${from.y}, ${mx} ${y2}, ${x2} ${y2}`}
        fill="none"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth={2}
      />
    );
  };

  return (
    <div
      data-freeform-canvas-root
      className={`flex gap-0 overflow-hidden rounded-[28px] border border-white/10 bg-[#05080f]/90 ${
        fillContainer ? "h-full min-h-0 w-full" : "min-h-[720px]"
      }`}
    >
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

      {/* 左侧工具栏 */}
      <aside className="flex w-14 shrink-0 flex-col items-center gap-3 border-r border-white/10 bg-black/30 py-4">
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
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-lg transition hover:scale-105"
        >
          <Plus className="h-5 w-5" />
        </button>
      </aside>

      {/* 无限画布：唯一滚动层；世界尺寸随节点包围盒扩展 */}
      <div
        ref={canvasRef}
        data-freeform-canvas-scroll
        className="relative min-h-0 flex-1 overflow-auto"
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
        <div className="relative h-[2400px] w-[3600px]">
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
            const uploadLabel = isUploading
              ? `上传中 ${uploadProgress?.blockId === block.id ? `${uploadProgress.done}/${uploadProgress.total}` : "…"}`
              : "上传素材";
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
                    const canvas = canvasRef.current!;
                    setDragState({
                      id: block.id,
                      offsetX: e.clientX - rect.left,
                      offsetY: e.clientY - rect.top,
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
                {(() => {
                  const assetAt = parseManhuaCanvasAssetAtTag(block.prompt);
                  const isAssetSheet =
                    Boolean(assetAt) ||
                    /^(charsheet|sceneplate|propplate|propsheet|prop)-/.test(
                      String(block.id || ""),
                    );
                  if (!isAssetSheet) return null;
                  const roleWall = String(block.id || "").startsWith("charsheet-")
                    ? "角色墙"
                    : String(block.id || "").startsWith("sceneplate-")
                      ? "场景墙"
                      : "道具墙";
                  const labelFromPrompt =
                    String(block.prompt || "").match(
                      /【画布资产@】@(?:角色|场景|道具)\d+=([^\n]+)/,
                    )?.[1] ||
                    String(block.prompt || "")
                      .split("\n")
                      .find((ln) => ln.trim() && !ln.includes("【画布资产@】"))
                      ?.trim()
                      .slice(0, 18) ||
                    "";
                  const sheetPropSubs = String(block.id || "").startsWith("charsheet-")
                    ? parseManhuaSheetPropSubTagsFromPrompt(block.prompt)
                    : [];
                  const voiceLock =
                    String(block.id || "").startsWith("charsheet-") && assetAt
                      ? characterVoiceLocks.find((v) => v.characterTag === assetAt)
                      : undefined;
                  return (
                    <div className="space-y-1 border-b border-violet-400/25 bg-violet-500/[0.08] px-3 py-2 text-[10px] leading-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-violet-400/30 px-1.5 py-0.5 text-[9px] font-semibold text-violet-50">
                          {roleWall}
                        </span>
                        <span className="rounded bg-cyan-500/25 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-cyan-50">
                          {assetAt || "@待编号"}
                        </span>
                        {labelFromPrompt ? (
                          <span className="truncate text-white/75">{labelFromPrompt}</span>
                        ) : null}
                      </div>
                      {sheetPropSubs.length ? (
                        <div className="flex flex-wrap gap-1">
                          {sheetPropSubs.map((s) => (
                            <span
                              key={`${s.subTag}-${s.propTag}`}
                              className="rounded border border-amber-300/35 bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9px] text-amber-50/95"
                              title={`${s.labelZh} · 跨集锁 ${s.propTag}`}
                            >
                              {s.subTag}
                              <span className="mx-0.5 text-white/35">=</span>
                              {s.propTag}
                              <span className="ml-1 font-sans text-white/55">{s.labelZh}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {String(block.id || "").startsWith("charsheet-") && assetAt ? (
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          {voiceLock?.audioUrl ? (
                            <audio
                              controls
                              preload="none"
                              src={voiceLock.audioUrl}
                              className="h-7 max-w-full flex-1"
                            />
                          ) : (
                            <span className="text-white/40">未挂声线参考</span>
                          )}
                          {onReplaceCharacterVoiceAudio ? (
                            <label className="cursor-pointer rounded border border-emerald-400/35 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-50/90 hover:bg-emerald-500/20">
                              {voiceLock ? "换声样" : "上传声样"}
                              <input
                                type="file"
                                accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,.mp3,.wav"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  e.target.value = "";
                                  if (!file || !assetAt) return;
                                  void (async () => {
                                    try {
                                      const safeName = (file.name || "voice.mp3").replace(
                                        /[^a-z0-9._-]/gi,
                                        "-",
                                      );
                                      const signed = await getSignedUrlMutation.mutateAsync({
                                        fileName: file.name || "voice.mp3",
                                        mimeType: file.type || "audio/mpeg",
                                        objectName: `canvas/audio/${Date.now()}-${safeName}`,
                                      });
                                      await uploadFileToSignedUrl({
                                        file,
                                        uploadUrl: signed.uploadUrl,
                                        headers: signed.requiredHeaders,
                                      });
                                      if (!signed.gcsUri) {
                                        throw new Error("上传成功但未拿到存储地址");
                                      }
                                      const audioUrl = await resolveOmniMaterialUrl(signed.gcsUri);
                                      if (!/^https:\/\//i.test(audioUrl)) {
                                        throw new Error("上传成功但未拿到可播放地址");
                                      }
                                      onReplaceCharacterVoiceAudio({
                                        characterTag: assetAt,
                                        audioUrl,
                                        labelZh: labelFromPrompt || assetAt,
                                      });
                                      toast.message("声样已更新", {
                                        description: `${assetAt} 已换参考音`,
                                      });
                                    } catch (err) {
                                      toast.message(
                                        err instanceof Error ? err.message : "声样上传失败",
                                      );
                                    }
                                  })();
                                }}
                              />
                            </label>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="text-white/45">
                        {sheetPropSubs.length
                          ? "定妆特写格已编全局道具号；跨集同号锁定，勿另造"
                          : "画布展开资产：静帧 / 成片导戏用此编号锁定"}
                      </div>
                    </div>
                  );
                })()}
                {String(block.id || "").startsWith("keyart-") ? (
                  <div className="border-b border-white/10 px-3 py-1.5 text-[10px] leading-4 text-white/65">
                    {block.imageMode === "edit" && block.refImageUrl ? (
                      <>
                        <span className="font-semibold text-emerald-200/90">垫图锁</span>
                        <span className="ml-1 text-white/55">
                          {(String(block.prompt || "").match(/@(?:角色|场景|道具)\d+/g) || []).join(" ") ||
                            "已挂垫图改图"}
                        </span>
                      </>
                    ) : (
                      <span className="text-amber-200/85">未垫图改图（须改图+参考图）· 不可出成片</span>
                    )}
                  </div>
                ) : null}
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
                              {padLocked ? "垫图锁✓" : "垫图锁缺失"}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                                imageBindLocked
                                  ? "bg-emerald-500/30 text-emerald-50"
                                  : "bg-amber-500/25 text-amber-50"
                              }`}
                            >
                              {imageBindLocked ? "Image对照✓" : "Image对照缺失"}
                            </span>
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
                                className="rounded bg-black/35 px-1.5 py-0.5 font-mono text-[10px] text-cyan-100/90"
                              >
                                {t}
                              </span>
                            ))}
                            {extra > 0 ? (
                              <span className="text-white/40">+{extra}</span>
                            ) : null}
                          </div>
                          {card.microExpressionZh ? (
                            <div className="text-white/70">
                              微表情：{card.microExpressionZh}
                            </div>
                          ) : null}
                          {card.cueRows.length ? (
                            <ul className="space-y-0.5 font-mono text-[9px] leading-snug text-white/65">
                              {card.cueRows.slice(0, 4).map((row, idx) => (
                                <li key={`${row.startSec}-${idx}`}>
                                  {formatManhuaClipDirectorCueFaceLine(row)}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <div className="text-white/45">
                              段成片导戏单将显示在此（秒位 · @角色 · @场景 · 表情）
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ) : null}

                <div
                  className={`grid min-h-0 flex-1 divide-x divide-white/10 ${
                    mediaOnly ? "grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]" : "grid-cols-[1fr_1fr]"
                  }`}
                >
                  {/* 左：设置 + 提示词 */}
                  <div className="flex min-h-0 flex-col overflow-auto p-3">
                    {!mediaOnly ? (
                    <div className="mb-2 space-y-2 rounded-xl border border-white/10 bg-black/25 p-2">
                      <div className="text-[10px] uppercase tracking-wider text-white/40">方块设置</div>
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
                            <span className="shrink-0 text-white/45">模型</span>
                            <select
                              value={
                                block.videoModel === "seedance-2.0"
                                  ? "seedance-2.0"
                                  : "seedance-2.0-fast"
                              }
                              onChange={(e) =>
                                patchOne(block.id, { videoModel: e.target.value as CanvasBlock["videoModel"] })
                              }
                              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white"
                            >
                              {VIDEO_MODEL_OPTIONS.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="text-[10px] leading-5 text-white/50">
                            {block.videoModel === "seedance-2.0"
                              ? "成片·标准：多图参考 + 运镜/动作/对白，约 4–15s"
                              : "成片·快速：多图参考 + 运镜/动作/对白，更快更省"}
                          </div>
                          <div className="rounded-lg border border-dashed border-amber-400/30 bg-amber-500/5 px-2 py-1.5 text-[10px] leading-5 text-amber-100/85">
                            Seedance 2.5 Coming soon on MV Studio Pro
                          </div>
                        </>
                      ) : null}
                      {block.kind === "video_reverse" ? (
                        <div className="text-[10px] leading-5 text-white/50">
                          浏览器本地抽帧 → Gemini 3.1 Pro 拉片（≤120s）。输出分镜表 + Seedance 微动句。YouTube 请用本机脚本下载后上传。
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
                      <div className="mb-2 flex flex-wrap items-center gap-2">
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
                        <label
                          htmlFor={`canvas-upload-${block.id}`}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-[10px] ${
                            isUploading
                              ? "border-amber-400/35 bg-amber-500/10 text-amber-100"
                              : "border-white/10 bg-black/40 text-white/70"
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
                          id={`canvas-upload-${block.id}`}
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
                      </div>
                    )}

                    {!mediaOnly ? (
                    <div className="mb-2 shrink-0 space-y-2">
                      <div className="text-[10px] uppercase tracking-wider text-white/40">素材上传</div>
                      <div className="flex flex-wrap gap-2">
                        {(block.kind === "image" ||
                          block.kind === "video" ||
                          block.kind === "video_reverse") && (
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
                        )}
                        <label
                          htmlFor={`canvas-upload-full-${block.id}`}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-[10px] hover:text-white ${
                            isUploading
                              ? "border-amber-400/35 bg-amber-500/10 text-amber-100 pointer-events-none opacity-60"
                              : "border-white/10 bg-black/40 text-white/70"
                          }`}
                        >
                          {isUploading ? (
                            <LoaderCircle className="h-3 w-3 animate-spin" />
                          ) : (
                            <Upload className="h-3 w-3" />
                          )}
                          {uploadLabel}
                        </label>
                        <input
                          id={`canvas-upload-full-${block.id}`}
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
                      </div>
                      <p className="text-[10px] leading-5 text-white/40">{CANVAS_UPLOAD_FORMAT_HINT}</p>
                    </div>
                    ) : null}

                    <div className="mb-1.5 text-[10px] uppercase tracking-wider text-white/40">提示词</div>
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
                      rows={mediaOnly ? 6 : 4}
                      className="min-h-[72px] w-full shrink-0 resize-none rounded-xl border border-white/10 bg-black/35 px-2.5 py-2 text-xs leading-6 text-white outline-none focus:border-primary/40"
                      placeholder={
                        documentCount > 0 && (block.kind === "text" || block.kind === "copy_organize")
                          ? "例：请把文档中 part1 与 part2 去重，整理成语意通顺、条理分明的详尽正文…"
                          : visionCount > 0 && (block.kind === "text" || block.kind === "copy_organize")
                            ? "例：帮我识别所有图片内容，归纳整理成文档，重复部分去掉，标题清晰、内容详尽…"
                            : meta.hint
                      }
                    />
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

                  {/* 右：素材预览 + 生成结果（方块内主视觉） */}
                  <div className="flex min-h-0 flex-col p-3">
                    <div className="mb-2 shrink-0 text-[10px] uppercase tracking-wider text-white/40">
                      {isUploading || (block.uploadPhase ?? "idle") === "uploading"
                        ? "上传中"
                        : block.uploadedAssets.length > 0
                          ? "素材预览"
                          : "预览 / 输出"}
                    </div>
                    <CanvasBlockPreviewPanel
                      block={block}
                      isUploading={isUploading}
                      displayOutputs={displayOutputs}
                    />
                  </div>
                </div>

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
  );
}
