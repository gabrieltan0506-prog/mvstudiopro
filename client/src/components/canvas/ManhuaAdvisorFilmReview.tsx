import { useRef } from "react";
import type { AdvisorFilmReview, AdvisorFilmReviewTarget } from "@shared/manhuaAdvisorFilmReview";
export function ManhuaAdvisorFilmReview(props: { report: AdvisorFilmReview; target: AdvisorFilmReviewTarget; onEdit: (text: string) => void; disabled?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  return <section aria-label="影片审阅结果" className="space-y-3 rounded-xl border border-cyan-300/30 p-3 text-sm">
    <h3 className="font-semibold">{props.target.label} · Gemini Flash审阅</h3>
    <video ref={video} src={props.target.videoUri} controls preload="metadata" className="max-h-72 w-full" />
    <p>{props.report.summary}</p>
    {props.report.findings.map((f,i) => <div key={i} className="space-y-2 border-t border-white/15 pt-2">
      <button className="text-cyan-200 underline" onClick={() => { if (video.current) video.current.currentTime = f.atSec; }}>{f.atSec.toFixed(1)}–{f.endSec.toFixed(1)}秒 · {f.category}</button>
      <p>{f.observation}</p><p>建议：{f.suggestion}</p><p className="text-xs opacity-70">{f.confidence}</p>
      <button disabled={props.disabled} className="rounded border border-cyan-300/40 px-3 py-2 disabled:opacity-40" onClick={() => props.onEdit(`只修改${f.atSec.toFixed(1)}–${f.endSec.toFixed(1)}秒，其余保持原样。${f.suggestion}`)}>让顾问准备视频修改方案</button>
    </div>)}
    <p className="text-xs opacity-70">{props.report.limitations} · 分析建议待你核对；不会自动修改或生成。</p>
  </section>;
}
