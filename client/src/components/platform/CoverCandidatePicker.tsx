import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { COVER_DESIGNS } from "@shared/platformCoverCandidates";
import TrialWatermarkImage from "@/components/TrialWatermarkImage";

/** 同一套选择器用于扩写与执行卡，服务端保存采用状态，刷新后恢复。 */
export function CoverCandidatePicker({ sceneId, enabled, onAdopt, isTrial = false }: {
  sceneId: string; enabled: boolean; onAdopt: (url: string) => void; isTrial?: boolean;
}) {
  const [originals, setOriginals] = useState(false);
  const query = trpc.mvAnalysis.getPlatformCoverCandidates.useQuery({ sceneId }, {
    enabled,
    refetchInterval: query => ["queued", "running"].includes(query.state.data?.status ?? "") ? 3000 : false,
  });
  const adopt = trpc.mvAnalysis.selectPlatformCoverCandidate.useMutation();
  const resume = trpc.mvAnalysis.resumePlatformCoverCandidates.useMutation();
  const adopted = query.data?.adoptedUrl;
  useEffect(() => { if (adopted) onAdopt(adopted); }, [adopted]);
  const set = query.data?.set;
  if (!set) return <div className="my-3 rounded-lg border border-white/10 p-3 text-xs text-gray-400">
    <p className="font-medium text-white">本次制作三张封面供选择</p>
    <p className="my-1">依据这条已确认稿件和人物参考制作，每张独立调色，生成后由你选择采用。</p>
    {COVER_DESIGNS.map(d => <p key={d.id} className="mt-1"><b>{d.label}：</b>{d.direction}</p>)}
  </div>;
  const busy = ["queued", "running"].includes(query.data?.status ?? "");
  const recoverable = set.candidates.some(c => c.status === "pending" || c.status === "grading" || c.status === "generating" || c.billing === "refund_pending");
  return <section className="my-4 rounded-xl border border-white/15 bg-black/20 p-3" aria-label="三张精修封面候选">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div><h4 className="text-sm font-semibold text-white">选择这条内容的封面</h4><p className="text-xs text-gray-400">{busy ? "正在制作三张候选，已有封面保持不变" : "预览原图与精修结果，再选择采用；未选择不会替换现有封面"}</p></div>
      <button type="button" aria-pressed={originals} onClick={() => setOriginals(v => !v)} className="rounded border border-white/20 px-2 py-1 text-xs">{originals ? "查看精修图" : "对照生成原图"}</button>
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {set.candidates.map(c => <article key={c.id} className="overflow-hidden rounded-lg border border-white/15">
        {(originals ? c.originalUrl : c.imageUrl) ? <a href={isTrial ? undefined : originals ? c.originalUrl : c.imageUrl} target="_blank" rel="noreferrer" aria-label={`放大查看${c.label}${originals ? "原图" : "精修图"}`}><TrialWatermarkImage src={(originals ? c.originalUrl : c.imageUrl)!} isTrial={isTrial} alt={`${c.label} · ${originals ? "生成原图" : "独立调色结果"}`} objectFit="contain" className="aspect-[9/16] w-full object-contain bg-black/40" /></a>
          : <div className="flex aspect-[9/16] items-center justify-center bg-black/40 p-3 text-center text-xs text-gray-400">{c.status === "grading" ? "原图已保存，等待调色" : c.status === "failed" || c.status === "uncertain" ? "该候选未交付" : "候选制作中"}</div>}
        <div className="space-y-2 p-2"><p className="text-xs font-medium">{c.label}</p>
          {c.error && <p role="status" className="text-xs text-amber-200">{c.error}</p>}
          <button type="button" disabled={busy || adopt.isPending || c.status !== "ready"} className="w-full rounded bg-white/10 px-2 py-2 text-xs disabled:opacity-40"
            onClick={async () => { try { const result = await adopt.mutateAsync({ jobId: set.jobId, candidateId: c.id as "story" | "subject" | "space" }); onAdopt(result.imageUrl); await query.refetch(); toast.success("已采用并保存这张封面"); } catch (e) { toast.error(e instanceof Error ? e.message : "采用失败，原封面保持不变"); } }}>
            {set.selectedId === c.id ? "已采用" : "采用这张封面"}
          </button>
        </div>
      </article>)}
    </div>
    {!busy && recoverable && <button type="button" disabled={resume.isPending} className="mt-3 rounded border border-white/20 px-3 py-2 text-xs" onClick={async () => {
      try { await resume.mutateAsync({ jobId: set.jobId }); await query.refetch(); toast.success("已继续未完成项，已有原图仅恢复后期"); }
      catch (e) { toast.error(e instanceof Error ? e.message : "暂时无法恢复"); }
    }}>继续未完成项（已有原图只恢复后期）</button>}
    <p className="mt-3 text-[11px] text-gray-500">独立后期包含肤色范围校正、局部明暗及曲线调色。请对照检查肤色、文字和内容一致性。</p>
  </section>;
}
