import { useState } from "react";
import { applyAdvisorPrevisCandidate, makeAdvisorPrevisTarget, parseAdvisorPrevisPatch, type AdvisorPrevisCandidate } from "@shared/manhuaAdvisorPrevisEdit";
import { formatPrevisMotionGuide, type ManhuaPrevisStudio } from "@shared/manhuaPrevis";

/** 导入只保存已审方案；仍走原工作流的提交、审片及采用入口。 */
export function ManhuaPrevisPlanImport({ clipId, getCurrentStudio, disabled, onApply }: {
  clipId: string; getCurrentStudio: () => ManhuaPrevisStudio; disabled: boolean;
  onApply: (candidate: AdvisorPrevisCandidate) => boolean;
}) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  const [candidate, setCandidate] = useState<AdvisorPrevisCandidate | null>(null);
  const [proposed, setProposed] = useState("");
  return <details className="rounded border border-cyan-300/25 p-3" data-previs-plan-import>
    <summary className="cursor-pointer text-xs">导入已审动作方案</summary>
    <p className="my-2 text-xs text-white/65">粘贴完整调度候选，先对照原方案与新方案，再确认保存。本步骤不调用模型、不提交渲染。</p>
    <textarea aria-label="已审动作方案 JSON" className="min-h-28 w-full rounded bg-black/30 p-2 text-xs" value={raw} maxLength={120000} disabled={disabled} onChange={e => { setRaw(e.target.value); setCandidate(null); setError(""); }} />
    <button type="button" className="rounded border px-2 py-1 text-xs disabled:opacity-40" disabled={disabled || !raw.trim()} onClick={() => {
      try {
        const studio = getCurrentStudio();
        const next = { target: makeAdvisorPrevisTarget(clipId, studio), patch: parseAdvisorPrevisPatch(raw) };
        const result = applyAdvisorPrevisCandidate(clipId, studio, next);
        setProposed(formatPrevisMotionGuide(result.spec)); setCandidate(next); setError("");
      } catch (e) { setCandidate(null); setError(e instanceof Error ? e.message : "方案解析失败，原配置保留"); }
    }}>检查并对照方案</button>
    {candidate && <div className="my-3 space-y-3">
      <article className="rounded border border-white/20 p-3"><strong className="text-xs">原动作方案</strong><pre className="whitespace-pre-wrap text-xs">{formatPrevisMotionGuide(JSON.parse(candidate.target.specJson))}</pre></article>
      <article className="rounded border border-cyan-300/30 p-3"><strong className="text-xs">拟采用动作方案</strong><p className="text-xs">{candidate.patch.summaryZh}</p><pre className="whitespace-pre-wrap text-xs">{proposed}</pre><details><summary className="text-xs">完整配置</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(candidate.patch, null, 2)}</pre></details></article>
      <button type="button" className="rounded border border-cyan-300/40 px-2 py-1 text-xs disabled:opacity-40" disabled={disabled} onClick={() => {
        if (onApply(candidate)) { setCandidate(null); setRaw(""); }
      }}>确认保存这份动作方案</button>
    </div>}
    {error && <p role="alert" className="text-xs text-amber-200">{error}</p>}
  </details>;
}
