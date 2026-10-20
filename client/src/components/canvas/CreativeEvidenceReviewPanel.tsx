import { creativeUserText } from "@/lib/creativeUserText";
import type { CreativeEvidenceReview } from "@shared/creativeEvidenceReview";
function DraftPreview({value}:{value:unknown}) {
  const draft=value as {summaryZh?:string;concepts?:Array<{id?:string;titleZh?:string;rationaleZh?:string;brief?:{title?:string;prompt?:string;style?:string};plan?:{shots?:Array<{id?:string;startSec:number;endSec:number;visualPrompt:string;cameraPrompt?:string}>}}>;methods?:Array<{titleZh:string;principleZh:string}>};
  return <div className="max-h-80 overflow-auto space-y-2"><p>{draft?.summaryZh}</p>{draft?.concepts?.map((c,i)=><div key={c.id||i}><strong>{c.brief?.title||c.titleZh||`方案 ${i+1}`}</strong><p>{c.rationaleZh}</p>{c.brief&&<><p className="whitespace-pre-wrap">{c.brief.prompt}</p><p>音乐风格：{c.brief.style}</p></>}{c.plan?.shots?.map((shot,j)=><p key={shot.id||j}>{shot.startSec}–{shot.endSec}秒：{shot.visualPrompt} {shot.cameraPrompt}</p>)}</div>)}{draft?.methods?.map((m,i)=><p key={i}>{m.titleZh}：{m.principleZh}</p>)}</div>;
}
export function CreativeEvidenceReviewPanel({ review }: { review?: CreativeEvidenceReview }) {
  if (!review) return <p className="text-amber-200">历史方案尚无创作顾问审阅回执。</p>;
  return <details open className="rounded border border-white/20 p-2">
    <summary>创作顾问审阅 · {review.verdict === "approved" ? "结果审阅通过" : review.verdict === "revise" ? "需要修订" : "需要重新听看"}</summary>
    <p>{creativeUserText(review.summaryZh)}</p>
    {review.revisionsZh?.map((line,index)=><p key={`revision-${index}`}>联合创作修改：{creativeUserText(line)}</p>)}
    {review.draftProposal != null && <details><summary>查看保留的初稿</summary><DraftPreview value={review.draftProposal}/></details>}
    {review.findings.map(f => <div key={f.id}><strong>{f.severity === "blocking" ? "待处理：" : "提示："}{creativeUserText(f.observationZh)}</strong><p>{creativeUserText(f.suggestionZh)}</p></div>)}
    {review.mediaReview.map((r, i) => <p key={i}>复核 {r.startSec}–{r.endSec} 秒：{creativeUserText(r.questionZh)}</p>)}
    {review.inspirationZh.map((s, i) => <p key={i}>创作灵感：{creativeUserText(s)}</p>)}
    {review.limitationsZh.map((s, i) => <p key={i} className="text-white/60">{creativeUserText(s)}</p>)}
  </details>;
}
