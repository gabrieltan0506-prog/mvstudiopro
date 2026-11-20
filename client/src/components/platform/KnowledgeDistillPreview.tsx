import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";

export type KnowledgeDistillLive = { jobId: string; readyBatches: number; stageAt?: Record<string, string>; done?: boolean };
type Segment = { index: number; pages: Array<{ headline: string; body: string }> };

/**
 * 提炼进行中的分段预览（1119 F2）：只读、按原顺序、明确标注「非最终稿」。
 * 按已就绪分组数增量读取（每次最多 8 组），中断或缺页时从原游标重试；
 * 提炼结束（done）即停止读取并收起，最终稿仍以提炼完成后的正文为准。
 */
export function KnowledgeDistillPreview({ live }: { live: KnowledgeDistillLive | null }) {
  if (!live || live.done) return null;
  return <PreviewPages key={live.jobId} jobId={live.jobId} readyBatches={live.readyBatches} />;
}

function PreviewPages({ jobId, readyBatches }: { jobId: string; readyBatches: number }) {
  const utils = trpc.useUtils();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [kind, setKind] = useState<"distilled" | "source">("distilled");
  const [error, setError] = useState("");
  const fromBatch = segments.length;
  const hasMore = fromBatch < readyBatches;
  useEffect(() => {
    if (!hasMore) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let retryDelay = 1500;
    const load = async () => {
      try {
        const result = await utils.editableLayout.distillPreview.fetch({ jobId, fromBatch }, { staleTime: 0, retry: false });
        if (!active) return;
        setKind(result.kind);
        setError("");
        if (result.segments.length) {
          setSegments(previous => [...previous, ...result.segments]);
          return;
        }
      } catch {
        if (!active) return;
        setError("预览暂未取回，正在重试。提炼照常进行。");
      }
      // 空页可能是乱序完工留下的缺口；稍后从原游标重试。
      timer = setTimeout(load, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 15000);
    };
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [jobId, fromBatch, hasMore, utils]);
  if (!segments.length && !error) return null;
  return (
    <details aria-label="提炼进行中预览" className="rounded-xl border border-amber-300/25 bg-amber-300/5 px-3 py-2 text-xs text-[#c9c0e6]/85">
      <summary className="cursor-pointer font-semibold text-amber-100/90">
        {kind === "source" ? "已读取的原文" : "已完成的分段"}（{segments.length} 组 · 非最终稿，仅供预览）
      </summary>
      {error && <p className="mt-1 text-amber-200/80">{error}</p>}
      <div className="mt-2 max-h-72 overflow-auto">
        {segments.map(segment => (
          <article key={segment.index} className="my-2 border-b border-white/5 pb-2">
            {segment.pages.map((page, i) => (
              <div key={i}><strong className="text-white/85">{page.headline}</strong><pre className="whitespace-pre-wrap">{page.body}</pre></div>
            ))}
          </article>
        ))}
      </div>
    </details>
  );
}

/** Debug 面板：分段计时（只在 debug 打开时由父级渲染）。 */
export const KNOWLEDGE_DISTILL_STAGE_LABELS: Array<[string, string]> = [
  ["jobCreated", "建单"], ["runnerStarted", "worker 开工"], ["textReady", "页文字就绪"], ["contactSheetsReady", "拼页缩略图就绪"],
  ["triageDone", "挑页/分诊完成"], ["firstDistillRequest", "首段提炼开始"], ["lastDistillReport", "末段提炼回报"], ["distillOutputReady", "提炼产出写入"],
];
export function KnowledgeDistillStageTimes({ stageAt }: { stageAt?: Record<string, string> }) {
  if (!stageAt) return null;
  const base = Date.parse(stageAt.jobCreated || stageAt.runnerStarted || "");
  return (
    <table aria-label="提炼分段计时" className="text-[11px]">
      <tbody>
        {KNOWLEDGE_DISTILL_STAGE_LABELS.map(([key, label]) => (
          <tr key={key}><td className="pr-3">{label}</td><td className="pr-3 font-mono">{stageAt[key] || "—"}</td>
            <td className="font-mono">{stageAt[key] && Number.isFinite(base) ? `+${Math.round((Date.parse(stageAt[key]) - base) / 1000)}s` : ""}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
