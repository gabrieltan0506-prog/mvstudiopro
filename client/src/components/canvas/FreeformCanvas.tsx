import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CANVAS_BLOCK_DEFAULT_HEIGHT,
  CANVAS_BLOCK_DEFAULT_WIDTH,
  CANVAS_BLOCK_MAX_HEIGHT,
  CANVAS_BLOCK_MAX_WIDTH,
  CANVAS_BLOCK_MIN_HEIGHT,
  CANVAS_BLOCK_MIN_WIDTH,
  CANVAS_KIND_META,
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
import { runCanvasBlock, type CanvasRunDeps } from "@/lib/canvasRunBlock";
import { CANVAS_UPLOAD_CONCURRENCY, uploadCanvasFilesParallel } from "@/lib/canvasUpload";
import { trpc } from "@/lib/trpc";
import {
  LoaderCircle,
  Plus,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

type FreeformCanvasProps = {
  blocks: CanvasBlock[];
  edges: CanvasEdge[];
  onBlocksChange: (blocks: CanvasBlock[]) => void;
  onEdgesChange: (edges: CanvasEdge[]) => void;
  runDeps: CanvasRunDeps;
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

export default function FreeformCanvas({
  blocks,
  edges,
  onBlocksChange,
  onEdgesChange,
  runDeps,
}: FreeformCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const toolbarFileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadBlockIdRef = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [spawnMenu, setSpawnMenu] = useState<SpawnMenuState>(null);
  const [toolbarMenu, setToolbarMenu] = useState<ToolbarMenuState>(null);
  const [dragState, setDragState] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState>(null);
  const [uploadBusyId, setUploadBusyId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ blockId: string; done: number; total: number } | null>(null);
  const getSignedUrlMutation = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();

  const blockMap = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);

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

      onBlocksChange([...blocks, block]);
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
    const id = spawnFromToolbar("text");
    pendingUploadBlockIdRef.current = id;
    window.setTimeout(() => toolbarFileInputRef.current?.click(), 0);
  }, [spawnFromToolbar]);

  const patchOne = useCallback(
    (id: string, patch: Partial<CanvasBlock>) => {
      onBlocksChange(patchBlock(blocks, id, patch));
    },
    [blocks, onBlocksChange],
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
      const visionImages = collectVisionImages(blockId, blocks, edges);
      const texts = collectUpstreamTexts(blockId, blocks, edges);
      const nearestRef =
        block.kind === "image" || block.kind === "video"
          ? block.refImageUrl || resolveNearestUpstreamImageUrl(blockId, blocks, edges)
          : block.refImageUrl;
      const runBlockPayload =
        nearestRef && nearestRef !== block.refImageUrl
          ? { ...block, refImageUrl: nearestRef }
          : block;
      patchOne(blockId, { status: "running", error: undefined });
      try {
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
    [blocks, edges, patchOne, runDeps],
  );

  const uploadFilesForBlock = useCallback(
    async (blockId: string, files: FileList | File[]) => {
      const fileArr = Array.from(files).filter(
        (f) => f.type.startsWith("image/") || f.type.startsWith("video/") || /\.(png|jpe?g|webp|mp4)$/i.test(f.name),
      );
      if (!fileArr.length) {
        toast.error("请选择图片或视频文件");
        return;
      }

      setUploadBusyId(blockId);
      setUploadProgress({ blockId, done: 0, total: fileArr.length });
      const block = blocks.find((b) => b.id === blockId);

      try {
        const { assets: uploaded, failed } = await uploadCanvasFilesParallel({
          files: fileArr,
          concurrency: CANVAS_UPLOAD_CONCURRENCY,
          getSignedUploadUrl: (input) => getSignedUrlMutation.mutateAsync(input),
          onProgress: (done, total) => setUploadProgress({ blockId, done, total }),
        });

        if (!uploaded.length) {
          throw new Error(failed[0]?.error || "全部上传失败");
        }

        const nextAssets: CanvasUploadedAsset[] = [...(block?.uploadedAssets ?? []), ...uploaded];
        const firstImage = nextAssets.find((a) => !a.fileName.match(/\.mp4$/i));

        patchOne(blockId, {
          uploadedAssets: nextAssets,
          refImageUrl: firstImage?.url ?? block?.refImageUrl,
          outputUrl: firstImage?.url ?? block?.outputUrl,
        });

        if (failed.length) {
          toast.warning(`已上传 ${uploaded.length} 个，${failed.length} 个失败`);
        } else {
          toast.success(`已上传 ${uploaded.length} 个素材`);
        }
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "上传失败");
      } finally {
        setUploadBusyId(null);
        setUploadProgress(null);
      }
    },
    [blocks, getSignedUrlMutation, patchOne],
  );

  useEffect(() => {
    if (!dragState) return;
    const onMove = (e: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left - dragState.offsetX + canvas.scrollLeft;
      const y = e.clientY - rect.top - dragState.offsetY + canvas.scrollTop;
      onBlocksChange(
        patchBlock(blocks, dragState.id, {
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
  }, [blocks, dragState, onBlocksChange]);

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
      onBlocksChange(patchBlock(blocks, resizeState.id, { width, height }));
    };
    const onUp = () => setResizeState(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [blocks, onBlocksChange, resizeState]);

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
    <div className="flex min-h-[720px] gap-0 overflow-hidden rounded-[28px] border border-white/10 bg-[#05080f]/90">
      <input
        ref={toolbarFileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const list = e.target.files;
          e.target.value = "";
          const blockId = pendingUploadBlockIdRef.current;
          pendingUploadBlockIdRef.current = null;
          if (blockId && list?.length) void uploadFilesForBlock(blockId, list);
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

      {/* 无限画布 */}
      <div ref={canvasRef} className="relative flex-1 overflow-auto">
        <svg className="pointer-events-none absolute inset-0 h-[2400px] w-[3600px]">
          {edges.map((e) => renderEdge(e.fromId, e.toId))}
        </svg>
        <div className="relative h-[2400px] w-[3600px]">
          {blocks.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-white/40">
              <Plus className="mb-3 h-10 w-10 opacity-30" />
              <p className="text-sm">点击左侧 + 在加号旁创建方块</p>
              <p className="mt-1 text-xs">可拖动 · 右下角缩放 · 右侧 + 引用上游</p>
            </div>
          ) : null}

          {blocks.map((block) => {
            const meta = CANVAS_KIND_META[block.kind];
            const Icon = meta.icon;
            const selected = selectedId === block.id;
            const visionCount = collectVisionImages(block.id, blocks, edges).length;
            const upstreamHandoff = collectUpstreamHandoff(block.id, blocks, edges);
            const upstreamPreview = upstreamHandoff.map((item) => item.text).join(" · ").slice(0, 120);
            const displayOutputs =
              block.outputUrls?.length ? block.outputUrls : block.outputUrl ? [block.outputUrl] : [];
            const uploadLabel =
              uploadBusyId === block.id && uploadProgress?.blockId === block.id
                ? `上传中 ${uploadProgress.done}/${uploadProgress.total}`
                : "上传素材";
            return (
              <div
                key={block.id}
                className={`absolute flex flex-col overflow-hidden rounded-2xl border bg-gradient-to-br ${meta.color} backdrop-blur-md transition-shadow ${
                  selected ? "border-primary/60 shadow-[0_0_0_2px_rgba(var(--primary),0.25)]" : "border-white/12"
                }`}
                style={{ left: block.x, top: block.y, width: block.width, height: block.height }}
                onClick={() => setSelectedId(block.id)}
              >
                {/* 顶栏：类型 + 运行 + 引用 + 删除 */}
                <div
                  className="flex cursor-grab items-center gap-2 border-b border-white/10 px-3 py-2 active:cursor-grabbing"
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).closest("button,select,textarea,input")) return;
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
                    {SPAWN_KIND_OPTIONS.map((o) => (
                      <option key={o.kind} value={o.kind}>
                        {o.label}
                      </option>
                    ))}
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

                <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr] divide-x divide-white/10">
                  {/* 左：设置 + 提示词 */}
                  <div className="flex min-h-0 flex-col overflow-auto p-3">
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
                            <span className="shrink-0 text-white/45">模型</span>
                            <select
                              value={block.imageModel}
                              onChange={(e) =>
                                patchOne(block.id, { imageModel: e.target.value as CanvasBlock["imageModel"] })
                              }
                              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-white"
                            >
                              {IMAGE_MODEL_OPTIONS.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.label}
                                </option>
                              ))}
                            </select>
                          </label>
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
                        </>
                      ) : null}
                      {block.kind === "video" ? (
                        <label className="flex items-center gap-2 text-[11px] text-white/70">
                          <span className="shrink-0 text-white/45">模型</span>
                          <select
                            value={block.videoModel}
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
                      ) : null}
                      {(block.kind === "text" || block.kind === "copy_organize") && visionCount > 0 ? (
                        <div className="text-[10px] text-white/50">已接入 {visionCount} 张图片</div>
                      ) : null}
                    </div>

                    <div className="mb-1.5 text-[10px] uppercase tracking-wider text-white/40">提示词</div>
                    <textarea
                      value={block.prompt}
                      onChange={(e) => patchOne(block.id, { prompt: e.target.value })}
                      rows={5}
                      className="min-h-[88px] w-full flex-1 resize-none rounded-xl border border-white/10 bg-black/35 px-2.5 py-2 text-xs leading-6 text-white outline-none focus:border-primary/40"
                      placeholder={
                        visionCount > 0 && (block.kind === "text" || block.kind === "copy_organize")
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
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(block.kind === "image" || block.kind === "video") && (
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
                      <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[10px] text-white/70 hover:text-white">
                        <Upload className="h-3 w-3" />
                        {uploadLabel}
                        <input
                          type="file"
                          accept="image/*,video/*"
                          multiple
                          className="hidden"
                          disabled={uploadBusyId === block.id}
                          onChange={(e) => {
                            const list = e.target.files;
                            e.target.value = "";
                            if (list?.length) void uploadFilesForBlock(block.id, list);
                          }}
                        />
                      </label>
                      {block.uploadedAssets.length > 0 ? (
                        <span className="self-center text-[10px] text-emerald-300/80">
                          已上传 {block.uploadedAssets.length} 个
                        </span>
                      ) : null}
                    </div>
                    {block.uploadedAssets.length > 0 ? (
                      <div className="mt-2 max-h-24 overflow-auto rounded-lg border border-white/10 bg-black/20 p-1.5">
                        <div className="flex flex-wrap gap-1">
                          {block.uploadedAssets.map((asset) => (
                            <img
                              key={asset.id}
                              src={asset.previewUrl || asset.url}
                              alt={asset.fileName}
                              title={asset.fileName}
                              className="h-8 w-8 shrink-0 rounded object-cover"
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* 右：输出预览 */}
                  <div className="flex min-h-0 flex-col overflow-auto p-3">
                    <div className="mb-1.5 text-[10px] uppercase tracking-wider text-white/40">输出</div>
                    {block.status === "error" ? (
                      <div className="text-xs text-red-300">{block.error}</div>
                    ) : null}
                    {block.outputText ? (
                      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-white/85">
                        {block.outputText}
                      </pre>
                    ) : null}
                    {block.kind === "image" && displayOutputs.length > 0 ? (
                      <div className={`mt-1 grid gap-1 ${displayOutputs.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
                        {displayOutputs.map((url, idx) => (
                          <img
                            key={`${url}-${idx}`}
                            src={url}
                            alt={`output-${idx + 1}`}
                            className="max-h-[120px] w-full rounded-lg object-contain"
                          />
                        ))}
                      </div>
                    ) : null}
                    {block.outputUrl && block.kind === "video" ? (
                      <video src={block.outputUrl} controls className="mt-1 max-h-[200px] w-full rounded-lg" />
                    ) : null}
                    {!block.outputText && !displayOutputs.length && block.status !== "error" ? (
                      <div className="flex min-h-[100px] flex-1 items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-white/30">
                        运行后显示结果
                      </div>
                    ) : null}
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
            {SPAWN_KIND_OPTIONS.map((opt) => {
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
            {SPAWN_KIND_OPTIONS.map((opt) => {
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
              onClick={openToolbarUpload}
            >
              <Upload className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <div>
                <div className="text-sm font-medium text-white">上传素材</div>
                <div className="text-[11px] text-white/45">图片或视频，可多张</div>
              </div>
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
