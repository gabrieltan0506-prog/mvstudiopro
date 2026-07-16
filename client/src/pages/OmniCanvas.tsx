import React, { useCallback, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import FreeformCanvas from "@/components/canvas/FreeformCanvas";
import type { CanvasBlock, CanvasEdge } from "@/lib/canvasTypes";
import { normalizeCanvasBlock } from "@/lib/canvasTypes";
import type { CanvasRunDeps } from "@/lib/canvasRunBlock";
import { spawnManhuaDramaStudio } from "@/lib/canvasDramaStudio";
import { trpc } from "@/lib/trpc";
import { Clapperboard, Sparkles } from "lucide-react";
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

  return (
    <div className="min-h-dvh bg-transparent text-white">
      <Navbar />
      <main className="px-4 pb-10 pt-24 md:px-6">
        <div className="mx-auto max-w-[1920px]">
          <div className="mb-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
              <Clapperboard className="h-3.5 w-3.5" />
              自由画布 · 漫剧工作室 · 视频反推
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">Gemini Omini 创作画布</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-white/65">
              文本 / 图片 / 视频 / 视频反推 / 整理文案。可一键铺「漫剧工作室」六段链路：故事→角色→节拍→反推→静帧→Seedance。
              参考短片请本机上传（≤120s）；YouTube 勿指望云端抓取。
            </p>
            <div className="mt-3 inline-flex max-w-3xl items-start gap-2 rounded-xl border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-50">
              <span className="mt-0.5 shrink-0 rounded-full border border-amber-300/40 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-100">
                Soon
              </span>
              <span>
                <strong className="font-semibold text-amber-50">Seedance 2.5 Coming soon on MV Studio Pro</strong>
                <span className="text-amber-100/75">
                  {" "}
                  · 文生 / 图生 / 参考生代码已就绪，待 EvoLink 上线后开放；当前请用 Seedance 2.0（默认 15s）。
                </span>
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/35 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-50 hover:bg-rose-500/25"
                onClick={() => {
                  const spawned = spawnManhuaDramaStudio(60, 80);
                  setBlocks(spawned.blocks);
                  setEdges(spawned.edges);
                  saveCanvasState(spawned.blocks, spawned.edges);
                  toast.success("已铺好漫剧工作室六段节点");
                }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                一键漫剧工作室
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
