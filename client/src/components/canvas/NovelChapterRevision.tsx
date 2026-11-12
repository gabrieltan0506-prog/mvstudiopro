import { Fragment, useMemo, useRef, useState } from "react";
import { NOVEL_REVIEW_DIMENSIONS } from "@shared/novelCraftReview";
import {
  locateNovelQuote,
  novelModelLabel,
  novelTextLength,
} from "@shared/novelWorkspace";
import { summarizeNovelProseLint } from "@shared/novelProseLint";
import { novelReviewLaneLabel } from "@shared/novelReviewCompare";
import { diffNovelText, type NovelDiffSegment } from "@shared/novelTextDiff";
import type { NovelOutlineAlert } from "@shared/novelOutlineDrift";
import {
  novelRevisionOutlineAlert,
  parseNovelRevisionEntry,
  type NovelRevisionEntry,
  type NovelWorkspace,
} from "@/lib/novelWorkspace";

type OutlineState = Pick<NovelWorkspace, "outline" | "outlineApproved">;

/** 每集「审稿改稿」结果：七维评分、审稿意见、结论，未修改版 / 最终修改版两栏对照（改动高亮）。 */
export function NovelChapterRevisionPanel({
  entries,
  disabled,
  outlineState,
  onAdopt,
}: {
  entries: NovelRevisionEntry[];
  disabled: boolean;
  outlineState?: OutlineState;
  onAdopt: (requestId: string, outlineAlert: NovelOutlineAlert) => void;
}) {
  const [showDiff, setShowDiff] = useState(true);
  if (!entries.length) return null;
  const ordered = [...entries].reverse();
  return (
    <section className="mt-3 space-y-3 text-sm" aria-label="审稿改稿结果">
      <label className="inline-flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={showDiff}
          onChange={e => setShowDiff(e.target.checked)}
        />
        显示改动高亮
      </label>
      {ordered.map((entry, n) => (
        <RevisionEntry
          key={entry.requestId}
          entry={entry}
          open={n === 0}
          disabled={disabled}
          showDiff={showDiff}
          outlineState={outlineState || { outline: "", outlineApproved: "" }}
          onAdopt={onAdopt}
        />
      ))}
    </section>
  );
}

function RevisionEntry({
  entry,
  open,
  disabled,
  showDiff,
  outlineState,
  onAdopt,
}: {
  entry: NovelRevisionEntry;
  open: boolean;
  disabled: boolean;
  showDiff: boolean;
  outlineState: OutlineState;
  onAdopt: (requestId: string, outlineAlert: NovelOutlineAlert) => void;
}) {
  const parsed = useMemo(() => parseNovelRevisionEntry(entry), [entry.outcome]);
  const revisedText = parsed?.revised
    ? `${parsed.revised.title}\n\n${parsed.revised.text}`
    : "";
  const diff = useMemo(
    () => (parsed?.revised ? diffNovelText(parsed.original, revisedText) : null),
    [parsed, revisedText]
  );
  const [flash, setFlash] = useState<{ start: number; end: number; nonce: number }>();
  const originalRef = useRef<HTMLPreElement>(null);
  const label = `审稿改稿 · ${new Date(entry.savedAt).toLocaleString()}${entry.adoptedAt ? " · 已采用" : ""}`;
  if (!parsed)
    return (
      <p className="text-amber-200">{label}：记录无法读取，原始记录已保留。</p>
    );
  const { review, revised, original, models, reviewOrigin } = parsed;
  const alert = novelRevisionOutlineAlert(outlineState, entry);
  const alertLevel = alert.stale ? "none" : alert.level;
  const impact = revised?.outlineImpact;
  const issues = [...review.issues].sort(
    (a, b) => Number(a.located === false) - Number(b.located === false)
  );
  const routes = [
    reviewOrigin
      ? reviewOrigin.sources.length > 1
        ? `审稿：综合${reviewOrigin.sources.map(s => novelReviewLaneLabel(s.lane)).join("、")}的意见`
        : `审稿：只用${novelReviewLaneLabel(reviewOrigin.sources[0].lane)}的意见`
      : "",
    models?.review ? `审稿：${novelModelLabel(models.review)}` : "",
    models?.revise ? `改稿：${novelModelLabel(models.revise)}` : "",
  ].filter(Boolean);
  const focusQuote = (quote: string) => {
    const hit = locateNovelQuote(original, quote);
    if (!hit) return;
    setFlash({ start: hit.start, end: hit.end, nonce: Date.now() });
    requestAnimationFrame(() =>
      originalRef.current
        ?.querySelector("[data-quote-flash]")
        ?.scrollIntoView({ block: "center", behavior: "smooth" })
    );
  };
  return (
    <details open={open} className="rounded-xl border border-white/10 p-3">
      <summary>{label}</summary>
      {routes.length > 0 && (
        <p className="mt-1 text-xs opacity-70">本次线路 · {routes.join(" · ")}</p>
      )}
      {entry.failure && (
        <p className="mt-2 text-amber-200" role="status">
          {entry.failure}
        </p>
      )}
      {revised && alertLevel !== "none" && (
        <div
          className={`novel-plot-change-banner mt-2${alertLevel === "major" ? " is-major" : ""}`}
          role="alert"
        >
          <strong>
            {alertLevel === "major"
              ? "修改版已偏离原大纲，采用前请先核对并更新大纲"
              : "本次修改改动了情节"}
          </strong>
          {impact && impact.items.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {impact.items.map((item, k) => (
                <li key={k}>
                  {item.what}：大纲「{item.before}」→ 修改版「{item.after}」
                </li>
              ))}
            </ul>
          )}
          {alert.hints.length > 0 && (
            <p className="mt-1 text-xs">
              自动核对提示（代码比对，仅供参考）：大纲里的
              {alert.hints.map(h => `「${h.term}」`).join("")}
              在未修改版出现，最终修改版里已不见，可能偏离大纲。
            </p>
          )}
          {alert.item && (
            <blockquote
              className={`novel-outline-alert mt-2 whitespace-pre-wrap rounded p-2${alertLevel === "major" ? " novel-outline-alert-flash" : ""}`}
              aria-label={`第${entry.index + 1}集大纲条目`}
            >
              <span className="text-xs opacity-70">本集大纲条目</span>
              {"\n"}
              {alert.item}
            </blockquote>
          )}
        </div>
      )}
      {revised && !impact && (
        <p className="mt-1 text-xs opacity-60">本条记录未申报大纲影响。</p>
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
        {issues.map((issue, k) => {
          const located = issue.located !== false;
          return (
            <li key={k} className={located ? "" : "opacity-60"}>
              <span className="opacity-70">【{issue.dimension}】</span>
              {located ? (
                <button
                  type="button"
                  className="novel-quote-link"
                  title="定位到未修改版"
                  onClick={() => focusQuote(issue.quote)}
                >
                  「{issue.quote}」
                </button>
              ) : (
                <>
                  「{issue.quote}」<span className="text-xs text-amber-200">（未能定位，未进入改稿清单）</span>
                </>
              )}
              —— {issue.problem}
              <div className="opacity-80">改法：{issue.fix}</div>
            </li>
          );
        })}
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
          <pre ref={originalRef} className="max-h-96 overflow-auto whitespace-pre-wrap">
            <DiffText
              segments={diff?.segments || [{ type: "same", text: original }]}
              side="original"
              highlight={showDiff && !!diff}
              flash={flash}
            />
          </pre>
        </article>
        <article>
          <h4 className="font-semibold">
            最终修改版
            {revised ? ` · ${novelTextLength(revised.text)}字` : ""}
            {diff && (
              <span className="ml-2 text-xs font-normal opacity-80">
                改动约 {Math.round(diff.changeRatio * 100)}%（+{diff.added} 字 / −{diff.removed} 字）
              </span>
            )}
          </h4>
          {revised && diff ? (
            <>
              <NovelProseLintLine text={revisedText} />
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap">
                <DiffText segments={diff.segments} side="revised" highlight={showDiff} />
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
          onClick={() => onAdopt(entry.requestId, alertLevel)}
        >
          采用最终修改版
        </button>
      )}
    </details>
  );
}

/**
 * 按差异片段渲染某一版正文：只加样式不改文字，复制出来与原文逐字相同。
 * flash 为未修改版里的原文区间（审稿意见定位用）。
 */
function DiffText({
  segments,
  side,
  highlight,
  flash,
}: {
  segments: NovelDiffSegment[];
  side: "original" | "revised";
  highlight: boolean;
  flash?: { start: number; end: number; nonce: number };
}) {
  const own = side === "original" ? "removed" : "added";
  const pieces: Array<{ text: string; changed: boolean; flash: boolean }> = [];
  let pos = 0;
  for (const seg of segments) {
    if (seg.type !== "same" && seg.type !== own) continue;
    const changed = seg.type === own;
    const end = pos + seg.text.length;
    const cuts = [pos, end];
    if (flash) {
      if (flash.start > pos && flash.start < end) cuts.push(flash.start);
      if (flash.end > pos && flash.end < end) cuts.push(flash.end);
    }
    cuts.sort((a, b) => a - b);
    for (let k = 0; k < cuts.length - 1; k++) {
      if (cuts[k] === cuts[k + 1]) continue;
      pieces.push({
        text: seg.text.slice(cuts[k] - pos, cuts[k + 1] - pos),
        changed,
        flash: !!flash && cuts[k] >= flash.start && cuts[k + 1] <= flash.end,
      });
    }
    pos = end;
  }
  let flashTagged = false;
  return (
    <>
      {pieces.map((p, k) => {
        const cls = [
          highlight && p.changed
            ? side === "original"
              ? "novel-diff-removed"
              : "novel-diff-added"
            : "",
          p.flash ? "novel-quote-flash" : "",
        ]
          .filter(Boolean)
          .join(" ");
        if (!cls) return <Fragment key={k}>{p.text}</Fragment>;
        const first = p.flash && !flashTagged;
        if (p.flash) flashTagged = true;
        return (
          <span
            key={p.flash ? `${k}-${flash?.nonce}` : k}
            className={cls}
            {...(first ? { "data-quote-flash": "" } : {})}
          >
            {p.text}
          </span>
        );
      })}
    </>
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
