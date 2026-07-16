import React, { useCallback, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import FreeformCanvas from "@/components/canvas/FreeformCanvas";
import type { CanvasBlock, CanvasEdge } from "@/lib/canvasTypes";
import { normalizeCanvasBlock } from "@/lib/canvasTypes";
import type { CanvasRunDeps } from "@/lib/canvasRunBlock";
import {
  runManhuaDramaFactoryPipeline,
  spawnManhuaDramaStudio,
  type ManhuaFactoryStageKey,
} from "@/lib/canvasDramaStudio";
import { trpc } from "@/lib/trpc";
import { Clapperboard, Loader2, Play, Sparkles } from "lucide-react";
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

  const ensureStudioSpawned = useCallback(() => {
    const hasFactory = ["story", "bible", "beats"].every((s) =>
      blocks.some((b) => b.id.startsWith(`${s}-`)),
    );
    if (hasFactory) return { blocks, edges };
    const spawned = spawnManhuaDramaStudio(60, 80);
    setBlocks(spawned.blocks);
    setEdges(spawned.edges);
    saveCanvasState(spawned.blocks, spawned.edges);
    return spawned;
  }, [blocks, edges]);

  const runFactory = useCallback(
    async (untilStage: ManhuaFactoryStageKey) => {
      if (factoryBusy) return;
      setFactoryBusy(true);
      try {
        const spawned = ensureStudioSpawned();
        toast.message(
          untilStage === "reverse"
            ? "漫剧工厂启动：故事→角色→节拍→反推（文本段）"
            : "漫剧工厂全自动：含静帧 + Seedance（较久/较贵）",
        );
        const result = await runManhuaDramaFactoryPipeline({
          deps: runDeps,
          blocks: spawned.blocks,
          edges: spawned.edges,
          untilStage,
          onBlocksChange: (next) => {
            setBlocks(next);
            setEdges((eds) => {
              saveCanvasState(next, eds);
              return eds;
            });
          },
          onStageStart: (id, index, total) => {
            toast.message(`工厂进度 ${index + 1}/${total}`, { description: id.split("-")[0] });
          },
        });
        if (result.errors.length) {
          toast.error(
            `完成 ${result.completedIds.length} 段，中断：${result.errors[0]?.message || "未知错误"}`,
          );
        } else {
          toast.success(`漫剧工厂完成 ${result.completedIds.length} 段`);
        }
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "漫剧工厂失败");
      } finally {
        setFactoryBusy(false);
      }
    },
    [ensureStudioSpawned, factoryBusy, runDeps],
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
              文本 / 图片 / 视频 / 视频反推 / 整理文案。可一键铺「漫剧工厂」六段并自动串联：故事→角色→节拍→反推→静帧→Seedance。
              参考短片请本机上传（≤120s）；YouTube 勿指望云端抓取。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={factoryBusy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/35 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-50 hover:bg-rose-500/25 disabled:opacity-50"
                onClick={() => {
                  const spawned = spawnManhuaDramaStudio(60, 80);
                  setBlocks(spawned.blocks);
                  setEdges(spawned.edges);
                  saveCanvasState(spawned.blocks, spawned.edges);
                  toast.success("已铺好漫剧工厂六段节点");
                }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                铺节点（不执行）
              </button>
              <button
                type="button"
                disabled={factoryBusy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/35 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-50 hover:bg-emerald-500/30 disabled:opacity-50"
                onClick={() => void runFactory("reverse")}
              >
                {factoryBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                自动跑·文本到反推
              </button>
              <button
                type="button"
                disabled={factoryBusy}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/35 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-50 hover:bg-amber-500/25 disabled:opacity-50"
                onClick={() => {
                  if (
                    !window.confirm(
                      "将自动跑完整链路（含静帧生图 + Seedance 成片），耗时与积分较高。是否继续？",
                    )
                  ) {
                    return;
                  }
                  void runFactory("clip");
                }}
              >
                {factoryBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                全自动到成片
              </button>
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
