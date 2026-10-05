import { useMemo } from "react";
import { compareScriptSentences, compareScriptCharacters } from "@/lib/manhuaSentenceDiff";
import { splitManhuaEpisodeStoryText } from "@shared/manhuaAdvisorRewrite";

export function ManhuaRewriteComparison({ before, after, afterLabel = "修改稿" }: { before: string; after: string; afterLabel?: string }) {
  const rows = useMemo(() => compareScriptSentences(
    splitManhuaEpisodeStoryText(before).story,
    splitManhuaEpisodeStoryText(after).story,
  ).map(row => ({ ...row, parts: row.kind === "changed" ? compareScriptCharacters(row.before, row.after) : {
    before: [{text: row.before, changed: row.kind === "removed"}],
    after: [{text: row.after, changed: row.kind === "added"}],
  } })), [before, after]);
  return <div aria-label="逐句差异对比" className="space-y-2">
    <p className="text-xs text-white/65">原稿在左，{afterLabel}在右。只高亮改动的字词，相同内容不标记；红色为删去的内容，绿色为新增或改写后的内容。</p>
    <div className="max-h-[60vh] overflow-auto rounded-lg border border-white/20" tabIndex={0} aria-label="左右并排剧本，可滚动查看全文">
      <table className="w-full min-w-[520px] table-fixed border-collapse text-left text-sm">
        <thead className="sticky top-0 z-10 bg-slate-900"><tr><th scope="col" className="w-1/2 border-r border-white/20 p-3">原稿 · 剧情与对白</th><th scope="col" className="w-1/2 p-3">{afterLabel} · 剧情与对白</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index} data-diff-kind={row.kind}>
          {(["before", "after"] as const).map(side => {
            const text = row[side];
            return <td key={side} className="align-top border-b border-r border-white/10 p-3">
              <span data-diff-text={side} className="whitespace-pre-wrap break-words leading-7">{row.parts[side].map((part, partIndex) => part.changed ? <mark key={partIndex} aria-label={side === "before" ? "原稿删改" : "改稿新增"} className={side === "before" ? "rounded-sm bg-rose-400/25 text-rose-100 underline decoration-rose-300/70 decoration-dotted underline-offset-4" : "rounded-sm bg-emerald-400/25 text-emerald-100 underline decoration-emerald-300/70 underline-offset-4"}>{part.text}</mark> : part.text)}</span>
              {!text && <span aria-label="此侧无对应句" className="text-white/30">—</span>}
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
