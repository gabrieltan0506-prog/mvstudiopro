import React, { useCallback, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import FreeformCanvas from "@/components/canvas/FreeformCanvas";
import type { CanvasBlock, CanvasEdge } from "@/lib/canvasTypes";
import type { CanvasRunDeps } from "@/lib/canvasRunBlock";
import { trpc } from "@/lib/trpc";
import { Clapperboard } from "lucide-react";

const LS_KEY = "mv-freeform-canvas-v1";

function loadCanvasState(): { blocks: CanvasBlock[]; edges: CanvasEdge[] } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { blocks: [], edges: [] };
    const parsed = JSON.parse(raw) as { blocks?: CanvasBlock[]; edges?: CanvasEdge[] };
    return { blocks: parsed.blocks || [], edges: parsed.edges || [] };
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

  const handleBlocksChange = useCallback((next: CanvasBlock[]) => {
    setBlocks(next);
    setEdges((cur) => {
      saveCanvasState(next, cur);
      return cur;
    });
  }, []);

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
              自由画布 · 可创建 / 拖动 / 引用生成
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">Omni 创作画布</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-white/65">
              左侧 + 创建方块；方块内左侧写提示词、选模型，右侧看输出；方块右上角 + 可「引用该节点」生成下游方块。
              文本：Gemini 3.1 Pro / GPT 5.5 / GPT 5.4 · 图片：Nano Banana 2 / GPT-Image-2 · 视频：Veo 3.1 / Gemini Omni Flash / Seedance 2.0
            </p>
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
