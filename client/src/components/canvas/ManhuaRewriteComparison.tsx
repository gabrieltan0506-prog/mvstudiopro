import { useMemo } from "react";
import { compareScriptSentences } from "@/lib/manhuaSentenceDiff";

export function ManhuaRewriteComparison({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => compareScriptSentences(before, after), [before, after]);
  return <div aria-label="逐句差异对比" className="space-y-2">
    <p className="text-xs text-white/65">原稿在左，改写在右。同一行对应比较；红色为删除，绿色为新增，黄色为修改。移动的句子可能显示为删除和新增。</p>
    <div className="max-h-[60vh] overflow-auto rounded-lg border border-white/20" tabIndex={0} aria-label="左右并排剧本，可滚动查看全文">
      <table className="w-full min-w-[520px] table-fixed border-collapse text-left text-sm">
        <thead className="sticky top-0 z-10 bg-slate-900"><tr><th scope="col" className="w-1/2 border-r border-white/20 p-3">套用前 · 完整原稿</th><th scope="col" className="w-1/2 p-3">套用后 · 完整改写</th></tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index} data-diff-kind={row.kind}>
          {(["before", "after"] as const).map(side => {
            const text = row[side];
            const label = row.kind === "same" ? "" : row.kind === "changed" ? "修改" : side === "before" ? "删除" : "新增";
            const color = row.kind === "same" || !text ? "" : row.kind === "changed" ? "bg-amber-400/15 text-amber-100" : side === "before" ? "bg-rose-400/15 text-rose-100" : "bg-emerald-400/15 text-emerald-100";
            return <td key={side} className={`align-top border-b border-r border-white/10 p-3 ${color}`}>
              {text && label && <span className="mb-1 block text-[11px] font-semibold">{label}</span>}
              <span data-diff-text={side} className="whitespace-pre-wrap break-words">{text}</span>
              {!text && <span aria-label="此侧无对应句" className="text-white/30">—</span>}
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
