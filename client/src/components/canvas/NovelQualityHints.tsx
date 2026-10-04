import { inspectNovelQuality } from "@shared/novelQuality";
export function NovelQualityHints({ text }: { text: string }) {
  const issues = inspectNovelQuality(text);
  return issues.length ? (
    <aside
      aria-label="稿件核对提示"
      className="mt-3 space-y-2 rounded-lg border border-amber-200/40 p-3 text-sm text-amber-200"
    >
      <p>发现待核对处，全文已保留，可直接编辑：</p>
      {issues.map((issue, i) => (
        <div key={i}>
          <p>{issue.message}</p>
          {issue.excerpt && <blockquote>「{issue.excerpt}」</blockquote>}
        </div>
      ))}
      <p className="text-xs">
        仅检查部分可识别模式，不代表其余因果、人物与视听安排已通过审阅。不会自动重写或重新付费生成。
      </p>
    </aside>
  ) : null;
}
