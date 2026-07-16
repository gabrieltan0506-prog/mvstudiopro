import React, { useCallback, useMemo, useRef, useState } from "react";
import Navbar from "@/components/Navbar";
import FreeformCanvas from "@/components/canvas/FreeformCanvas";
import type { CanvasBlock, CanvasEdge } from "@/lib/canvasTypes";
import { normalizeCanvasBlock } from "@/lib/canvasTypes";
import type { CanvasRunDeps } from "@/lib/canvasRunBlock";
import {
  MANHUA_FACTORY_STAGE_LABEL_ZH,
  MANHUA_FACTORY_STAGE_ORDER,
  applyTopicToFactoryStory,
  runManhuaDramaFactoryPipeline,
  spawnManhuaDramaStudio,
  stageKeyFromBlockId,
  type ManhuaFactoryStageKey,
} from "@/lib/canvasDramaStudio";
import { trpc } from "@/lib/trpc";
import { Clapperboard, Loader2, Play, Sparkles, Square } from "lucide-react";
import { toast } from "sonner";

const LS_KEY = "mv-freeform-canvas-v1";

function loadCanvasState(): { blocks: CanvasBlock[]; edges: CanvasEdge[] } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { blocks: [], edges: [] };
    const parsed = JSON.parse(raw) as { blocks?: CanvasBlock[]; edges?: CanvasEdge[] };
    return {
      blocks: (parsed.blocks || []).map(normalizeCanvasBlock),
      edges: parsed.edges || [],
    };
  } catch {
    return { blocks: [], edges: [] };
  }
}

function saveCanvasState(blocks: CanvasBlock[], edges: CanvasEdge[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ blocks, edges }));
  } catch {
    /* ignore quota */
  }
}

export default function OmniCanvas() {
  const initial = useMemo(() => loadCanvasState(), []);
  const [blocks, setBlocks] = useState<CanvasBlock[]>(initial.blocks);
  const [edges, setEdges] = useState<CanvasEdge[]>(initial.edges);
  const [factoryBusy, setFactoryBusy] = useState(false);
  const [factoryTopic, setFactoryTopic] = useState("");
  const [factoryProgress, setFactoryProgress] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  const optimizeCopyMutation = trpc.mvAnalysis.optimizeCustomCopy.useMutation();

  const runDeps = useMemo<CanvasRunDeps>(
    () => ({
      optimizeCopy: async ({ sourceText, optimizationBrief }) => {
        const res = await optimizeCopyMutation.mutateAsync({ sourceText, optimizationBrief });
        return res.result.optimizedMarkdown;
      },
    }),
    [optimizeCopyMutation],
  );

  const handleBlocksChange = useCallback(
    (next: CanvasBlock[] | ((prev: CanvasBlock[]) => CanvasBlock[])) => {
      setBlocks((cur) => {
        const resolved = typeof next === "function" ? next(cur) : next;
        setEdges((edges) => {
          saveCanvasState(resolved, edges);
          return edges;
        });
        return resolved;
      });
    },
    [],
  );

  const handleEdgesChange = useCallback((next: CanvasEdge[]) => {
    setEdges(next);
    setBlocks((cur) => {
      saveCanvasState(cur, next);
      return cur;
    });
  }, []);

  const stageChipStatus = useMemo(() => {
    return MANHUA_FACTORY_STAGE_ORDER.map((stage) => {
      const b = blocks.find((x) => x.id.startsWith(`${stage}-`));
      return {
        stage,
        label: MANHUA_FACTORY_STAGE_LABEL_ZH[stage],
        status: b?.status || ("idle" as const),
      };
    });
  }, [blocks]);

  const ensureStudioSpawned = useCallback(
    (topic?: string) => {
      const hasFactory = ["story", "bible", "beats"].every((s) =>
        blocks.some((b) => b.id.startsWith(`${s}-`)),
      );
      if (hasFactory) {
        const nextBlocks = topic ? applyTopicToFactoryStory(blocks, topic) : blocks;
        if (topic) {
          setBlocks(nextBlocks);
          saveCanvasState(nextBlocks, edges);
        }
        return { blocks: nextBlocks, edges };
      }
      const spawned = spawnManhuaDramaStudio({ originX: 60, originY: 80, topic });
      setBlocks(spawned.blocks);
      setEdges(spawned.edges);
      saveCanvasState(spawned.blocks, spawned.edges);
      return spawned;
    },
    [blocks, edges],
  );

  const stopFactory = useCallback(() => {
    abortRef.current?.abort();
    toast.message("正在取消漫剧工厂…");
  }, []);

  const runFactory = useCallback(
    async (untilStage: ManhuaFactoryStageKey, opts?: { forceFromStage?: ManhuaFactoryStageKey }) => {
      if (factoryBusy) return;
      const ac = new AbortController();
      abortRef.current = ac;
      setFactoryBusy(true);
      setFactoryProgress("准备中…");
      try {
        const spawned = ensureStudioSpawned(factoryTopic);
        toast.message(
          untilStage === "reverse"
            ? "漫剧工厂：故事→角色→节拍→反推"
            : untilStage === "keyart"
              ? "漫剧工厂：跑到关键静帧"
              : "漫剧工厂全自动：含静帧 + Seedance（约 15s）",
        );
        const result = await runManhuaDramaFactoryPipeline({
          deps: runDeps,
          blocks: spawned.blocks,
          edges: spawned.edges,
          untilStage,
          forceFromStage: opts?.forceFromStage,
          skipDone: true,
          signal: ac.signal,
          onBlocksChange: (next) => {
            setBlocks(next);
            setEdges((eds) => {
              saveCanvasState(next, eds);
              return eds;
            });
          },
          onStageStart: (_id, index, total, label) => {
            setFactoryProgress(`${index + 1}/${total} · ${label}`);
            toast.message(`工厂 ${index + 1}/${total}`, { description: label });
          },
          onStageSkip: (_id, label) => {
            setFactoryProgress(`跳过已完成 · ${label}`);
          },
        });
        if (result.errors.length) {
          const errStage = stageKeyFromBlockId(result.errors[0]!.id);
          toast.error(
            `完成 ${result.completedIds.length} 段` +
              (result.skippedIds.length ? `、跳过 ${result.skippedIds.length}` : "") +
              `，中断于${errStage ? MANHUA_FACTORY_STAGE_LABEL_ZH[errStage] : "未知"}：${result.errors[0]?.message || ""}`,
          );
        } else {
          toast.success(
            `漫剧工厂完成：新跑 ${result.completedIds.length}` +
              (result.skippedIds.length ? ` · 跳过 ${result.skippedIds.length}` : ""),
          );
        }
        setFactoryProgress("");
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "漫剧工厂失败");
        setFactoryProgress("");
      } finally {
        abortRef.current = null;
        setFactoryBusy(false);
      }
    },
    [ensureStudioSpawned, factoryBusy, factoryTopic, runDeps],
  );

  return (
    <div className="min-h-dvh bg-transparent text-white">
      <Navbar />
      <main className="px-4 pb-10 pt-24 md:px-6">
        <div className="mx-auto max-w-[1920px]">
          <div className="mb-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
              <Clapperboard className="h-3.5 w-3.5" />
              自由画布 · 漫剧工厂 · 视频反推
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">Gemini Omini 创作画布</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-white/65">
              输入题材后自动串联：故事→角色→节拍→编导反推→静帧→Seedance（约 15s）。
              已完成步骤会跳过，可从失败处续跑。参考短片请本机上传（≤120s）。
            </p>

            <div className="mt-3 max-w-3xl">
              <label className="block text-[11px] uppercase tracking-wider text-white/40">题材一句（工厂入口）</label>
              <input
                value={factoryTopic}
                onChange={(e) => setFactoryTopic(e.target.value)}
                disabled={factoryBusy}
                placeholder="例：星际车站离别，青涩校园情侣，15 秒竖屏虐心"
                className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-emerald-400/50"
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {stageChipStatus.map((s) => (
                <span
                  key={s.stage}
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    s.status === "done"
                      ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
                      : s.status === "running"
                        ? "border-sky-400/40 bg-sky-500/15 text-sky-100"
                        : s.status === "error"
                          ? "border-red-400/40 bg-red-500/15 text-red-100"
                          : "border-white/10 bg-white/5 text-white/55"
                  }`}
                >
                  {s.label}
                </span>
              ))}
            </div>
            {factoryProgress ? (
              <div className="mt-2 text-xs text-sky-200/90">进度：{factoryProgress}</div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={factoryBusy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/35 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-50 hover:bg-rose-500/25 disabled:opacity-50"
                onClick={() => {
                  const spawned = spawnManhuaDramaStudio({
                    originX: 60,
                    originY: 80,
                    topic: factoryTopic,
                  });
                  setBlocks(spawned.blocks);
                  setEdges(spawned.edges);
                  saveCanvasState(spawned.blocks, spawned.edges);
                  toast.success("已铺好漫剧工厂六段节点");
                }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                铺节点
              </button>
              <button
                type="button"
                disabled={factoryBusy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-50 hover:bg-emerald-500/30 disabled:opacity-50"
                onClick={() => void runFactory("reverse")}
              >
                {factoryBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                自动跑到反推
              </button>
              <button
                type="button"
                disabled={factoryBusy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/35 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-50"
                onClick={() => void runFactory("keyart")}
              >
                {factoryBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                跑到静帧
              </button>
              <button
                type="button"
                disabled={factoryBusy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/35 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-50 hover:bg-amber-500/25 disabled:opacity-50"
                onClick={() => {
                  if (!window.confirm("将跑完整链路（静帧 + Seedance≈15s），耗时与积分较高。继续？")) return;
                  void runFactory("clip");
                }}
              >
                {factoryBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                全自动到成片
              </button>
              <button
                type="button"
                disabled={factoryBusy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 disabled:opacity-50"
                onClick={() => void runFactory("clip", { forceFromStage: "reverse" })}
                title="从反推起强制重跑，前面已完成步骤仍跳过"
              >
                从反推续跑
              </button>
              {factoryBusy ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-400/40 bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-500/25"
                  onClick={stopFactory}
                >
                  <Square className="h-3.5 w-3.5" />
                  取消
                </button>
              ) : null}
            </div>
          </div>

          <FreeformCanvas
            blocks={blocks}
            edges={edges}
            onBlocksChange={handleBlocksChange}
            onEdgesChange={handleEdgesChange}
            runDeps={runDeps}
          />
        </div>
      </main>
    </div>
  );
}
