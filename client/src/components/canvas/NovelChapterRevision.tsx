import { NOVEL_REVIEW_DIMENSIONS } from "@shared/novelCraftReview";
import { novelTextLength } from "@shared/novelWorkspace";
import { summarizeNovelProseLint } from "@shared/novelProseLint";
import {
  parseNovelRevisionEntry,
  type NovelRevisionEntry,
} from "@/lib/novelWorkspace";

/** 每集「审稿改稿」结果：七维评分、审稿意见、结论，未修改版 / 最终修改版两栏对照。 */
export function NovelChapterRevisionPanel({
  entries,
  disabled,
  onAdopt,
}: {
  entries: NovelRevisionEntry[];
  disabled: boolean;
  onAdopt: (requestId: string) => void;
}) {
  if (!entries.length) return null;
  const ordered = [...entries].reverse();
  return (
    <section className="mt-3 space-y-3 text-sm" aria-label="审稿改稿结果">
      {ordered.map((entry, n) => {
        const parsed = parseNovelRevisionEntry(entry);
        const label = `审稿改稿 · ${new Date(entry.savedAt).toLocaleString()}${entry.adoptedAt ? " · 已采用" : ""}`;
        if (!parsed)
          return (
            <p key={entry.requestId} className="text-amber-200">
              {label}：记录无法读取，原始记录已保留。
            </p>
          );
        const { review, revised, original } = parsed;
        const revisedText = revised ? `${revised.title}\n\n${revised.text}` : "";
        return (
          <details
            key={entry.requestId}
            open={n === 0}
            className="rounded-xl border border-white/10 p-3"
          >
            <summary>{label}</summary>
            {entry.failure && (
              <p className="mt-2 text-amber-200" role="status">
                {entry.failure}
              </p>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {NOVEL_REVIEW_DIMENSIONS.map(d => (
                <div
                  key={d}
                  className="rounded-lg border border-white/10 px-2 py-1 text-center"
                >
                  <div className="text-xs opacity-70">{d}</div>
                  <div className="text-base font-semibold">
                    {review.scores[d]}
                    <span className="text-xs opacity-60">/5</span>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2">
              <strong>结论：</strong>
              {review.verdict}
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              {review.issues.map((issue, k) => (
                <li key={k}>
                  <span className="opacity-70">【{issue.dimension}】</span>
                  「{issue.quote}」—— {issue.problem}
                  <div className="opacity-80">改法：{issue.fix}</div>
                </li>
              ))}
            </ol>
            {review.keep.length > 0 && (
              <p className="mt-2 opacity-80">保留亮点：{review.keep.join("；")}</p>
            )}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <article>
                <h4 className="font-semibold">
                  未修改版 · {novelTextLength(original)}字
                </h4>
                <NovelProseLintLine text={original} />
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap">
                  {original}
                </pre>
              </article>
              <article>
                <h4 className="font-semibold">
                  最终修改版
                  {revised ? ` · ${novelTextLength(revised.text)}字` : ""}
                </h4>
                {revised ? (
                  <>
                    <NovelProseLintLine text={revisedText} />
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap">
                      {revisedText}
                    </pre>
                    {revised.changes.length > 0 && (
                      <details className="mt-1">
                        <summary>改动说明（{revised.changes.length}）</summary>
                        <ul className="list-disc pl-5">
                          {revised.changes.map((c, k) => (
                            <li key={k}>
                              {c.issue}：{c.what}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </>
                ) : (
                  <p className="opacity-70">改稿未完成，本集正文未改动。</p>
                )}
              </article>
            </div>
            {revised && (
              <button
                type="button"
                className="mt-2 underline"
                disabled={disabled}
                onClick={() => onAdopt(entry.requestId)}
              >
                采用最终修改版
              </button>
            )}
          </details>
        );
      })}
    </section>
  );
}

/** 套话句式与高频虚词的确定性检测结果（代码规则，不调用模型）；只作复核提示。 */
function NovelProseLintLine({ text }: { text: string }) {
  const lint = summarizeNovelProseLint(text);
  return (
    <p className="mb-1 text-xs opacity-80">
      套话句式 {lint.blocking} 处 · 高频虚词每千字 {lint.advisoryPerThousand}
      {lint.advisoryOverLimit ? "（偏多）" : ""}
      {lint.samples.length > 0 ? `：${lint.samples.map(h => `「${h.match}」`).join(" ")}` : ""}
    </p>
  );
}
