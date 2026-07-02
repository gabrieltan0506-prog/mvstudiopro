import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CANVAS_KIND_META,
  collectUpstreamTexts,
  collectVisionImages,
  defaultCanvasBlock,
  IMAGE_MODEL_OPTIONS,
  makeCanvasBlockId,
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
  canvasImageBatchTotalCredits,
  canvasVisionTotalCredits,
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [spawnMenu, setSpawnMenu] = useState<SpawnMenuState>(null);
  const [dragState, setDragState] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const [uploadBusyId, setUploadBusyId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ blockId: string; done: number; total: number } | null>(null);
  const getSignedUrlMutation = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();

  const blockMap = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks]);

  const addBlock = useCallback(
    (kind: CanvasBlockKind, opts?: { x?: number; y?: number; parentId?: string }) => {
      const id = makeCanvasBlockId(kind);
      const x = opts?.x ?? 120 + blocks.length * 36;
      const y = opts?.y ?? 120 + blocks.length * 28;
      const block = defaultCanvasBlock(kind, x, y, opts?.parentId);
      block.id = id;
      const parent = opts?.parentId ? blockMap.get(opts.parentId) : undefined;
      if (parent?.outputText) block.prompt = `${block.prompt}\n\n${parent.outputText.slice(0, 2000)}`;
      if (parent?.outputUrl && (kind === "image" || kind === "video")) {
        block.refImageUrl = parent.outputUrl;
      }
      onBlocksChange([...blocks, block]);
      if (opts?.parentId) {
        onEdgesChange([...edges, { fromId: opts.parentId, toId: id }]);
      }
      setSelectedId(id);
      return id;
    },
    [blockMap, blocks, edges, onBlocksChange, onEdgesChange],
  );

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
      patchOne(blockId, { status: "running", error: undefined });
      try {
        const out = await runCanvasBlock(runDeps, block, { visionImages, texts });
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

  const renderEdge = (fromId: string, toId: string) => {
    const a = blockMap.get(fromId);
    const b = blockMap.get(toId);
    if (!a || !b) return null;
    const x1 = a.x + 420;
    const y1 = a.y + 80;
    const x2 = b.x;
    const y2 = b.y + 80;
    const mx = (x1 + x2) / 2;
    return (
      <path
        key={`${fromId}-${toId}`}
        d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
        fill="none"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth={2}
      />
    );
  };

  return (
    <div className="flex min-h-[720px] gap-0 overflow-hidden rounded-[28px] border border-white/10 bg-[#05080f]/90">
      {/* 左侧工具栏 */}
      <aside className="flex w-14 shrink-0 flex-col items-center gap-3 border-r border-white/10 bg-black/30 py-4">
        <button
          type="button"
          title="添加节点"
          onClick={() => addBlock("text", { x: 160, y: 160 })}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black shadow-lg transition hover:scale-105"
        >
          <Plus className="h-5 w-5" />
        </button>
        <div className="h-px w-8 bg-white/10" />
        {SPAWN_KIND_OPTIONS.map((opt) => {
          const Icon = CANVAS_KIND_META[opt.kind].icon;
          return (
            <button
              key={opt.kind}
              type="button"
              title={opt.label}
              onClick={() => addBlock(opt.kind)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white/70 transition hover:border-primary/40 hover:text-primary"
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
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
              <p className="text-sm">点击左侧 + 创建第一个方块</p>
              <p className="mt-1 text-xs">可自由拖动 · 右侧 + 引用上游生成新方块</p>
            </div>
          ) : null}

          {blocks.map((block) => {
            const meta = CANVAS_KIND_META[block.kind];
            const Icon = meta.icon;
            const selected = selectedId === block.id;
            const visionCount = collectVisionImages(block.id, blocks, edges).length;
            const imageCredits =
              block.kind === "image"
                ? canvasImageBatchTotalCredits(block.imageModel, block.imageBatchCount || 1)
                : 0;
            const visionCredits =
              (block.kind === "text" || block.kind === "copy_organize") && visionCount > 0
                ? canvasVisionTotalCredits(visionCount)
                : 0;
            const displayOutputs =
              block.outputUrls?.length ? block.outputUrls : block.outputUrl ? [block.outputUrl] : [];
            const uploadLabel =
              uploadBusyId === block.id && uploadProgress?.blockId === block.id
                ? `上传中 ${uploadProgress.done}/${uploadProgress.total}`
                : "上传素材";
            return (
              <div
                key={block.id}
                className={`absolute w-[420px] rounded-2xl border bg-gradient-to-br ${meta.color} backdrop-blur-md transition-shadow ${
                  selected ? "border-primary/60 shadow-[0_0_0_2px_rgba(var(--primary),0.25)]" : "border-white/12"
                }`}
                style={{ left: block.x, top: block.y }}
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

                <div className="grid grid-cols-[1fr_1fr] gap-0 divide-x divide-white/10">
                  {/* 左：设置 + 提示词 */}
                  <div className="p-3">
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
                          <div className="text-[10px] text-emerald-300/90">预估积分：{imageCredits}</div>
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
                        <div className="text-[10px] text-amber-300/90">
                          已接入 {visionCount} 张图片 · 预估积分 {visionCredits}
                        </div>
                      ) : null}
                    </div>

                    <div className="mb-1.5 text-[10px] uppercase tracking-wider text-white/40">提示词</div>
                    <textarea
                      value={block.prompt}
                      onChange={(e) => patchOne(block.id, { prompt: e.target.value })}
                      rows={6}
                      className="w-full resize-none rounded-xl border border-white/10 bg-black/35 px-2.5 py-2 text-xs leading-6 text-white outline-none focus:border-primary/40"
                      placeholder={
                        visionCount > 0 && (block.kind === "text" || block.kind === "copy_organize")
                          ? "例：帮我识别所有图片内容，归纳整理成文档，重复部分去掉，标题清晰、内容详尽…"
                          : meta.hint
                      }
                    />
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
                  <div className="p-3">
                    <div className="mb-1.5 text-[10px] uppercase tracking-wider text-white/40">输出</div>
                    {block.status === "error" ? (
                      <div className="text-xs text-red-300">{block.error}</div>
                    ) : null}
                    {block.outputText ? (
                      <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-white/85">
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
                      <div className="flex h-[180px] items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-white/30">
                        运行后显示结果
                      </div>
                    ) : null}
                  </div>
                </div>
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
                      x: (parent?.x ?? 0) + 460,
                      y: (parent?.y ?? 0) + 40,
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
    </div>
  );
}
