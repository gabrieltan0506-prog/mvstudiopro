import { useMemo, useState } from "react";
import {
  NOVEL_REVIEW_COMPARE_LANES,
  buildNovelReviewOverride,
  compareNovelReviews,
  defaultNovelReviewSelection,
  novelReviewLaneLabel,
  novelReviewLaneSelection,
  novelReviewScoreTable,
  type NovelReviewCompareItem,
} from "@shared/novelReviewCompare";
import {
  novelModelLabel,
  type NovelReviewLane,
  type NovelReviewOverride,
} from "@shared/novelWorkspace";
import {
  novelReviewCompareResults,
  parseNovelReviewCompareLane,
  type NovelReviewCompareEntry,
} from "@/lib/novelWorkspace";

export type NovelReviewCompareAction = { kind: "selected" } | { kind: "lane"; lane: NovelReviewLane };

/**
 * 多线路审稿对比（1112）：打分表（分歧大标记）、共同指出、仅某条线路指出，勾选意见后改稿。
 * 聚类、打分与综合意见全部由 shared/novelReviewCompare 的纯函数计算，本组件只负责展示与勾选。
 */
export function NovelReviewComparePanel({
  entry,
  currentText,
  disabled,
  rewriteLabel,
  onRetry,
  onRevise,
}: {
  entry: NovelReviewCompareEntry;
  /** 本集当前正文：与对比时不同即不能按对比意见改稿（意见定位以对比时的正文为准）。 */
  currentText: string;
  disabled: boolean;
  /** 改稿线路（沿用现有「改稿线路」下拉）的显示名。 */
  rewriteLabel: string;
  onRetry: (lane: NovelReviewLane) => void;
  onRevise: (override: NovelReviewOverride, action: NovelReviewCompareAction) => void;
}) {
  const lanes = useMemo(
    () =>
      [...entry.lanes].sort(
        (a, b) =>
          NOVEL_REVIEW_COMPARE_LANES.findIndex(l => l.value === a.lane) -
          NOVEL_REVIEW_COMPARE_LANES.findIndex(l => l.value === b.lane)
      ),
    [entry.lanes]
  );
  const results = useMemo(() => novelReviewCompareResults(entry), [entry.lanes]);
  const comparison = useMemo(() => compareNovelReviews(entry.original, results), [entry.original, results]);
  const table = useMemo(() => novelReviewScoreTable(results), [results]);
  const basis = results.map(r => r.requestId).join(",");
  const [selection, setSelection] = useState<{ basis: string; keys: Set<string> }>();
  const keys =
    selection?.basis === basis ? selection.keys : new Set(defaultNovelReviewSelection(comparison));
  const toggle = (key: string, on: boolean) => {
    const next = new Set(keys);
    if (on) next.add(key);
    else next.delete(key);
    setSelection({ basis, keys: next });
  };
  const stale = currentText !== entry.original;
  const built = buildNovelReviewOverride(entry.original, results, keys);
  const blocked = disabled || stale;
  const pendingCount = lanes.filter(l => l.status === "pending").length;

  const issueLine = (item: NovelReviewCompareItem, showLane: boolean) => (
    <label key={item.key} className="flex items-start gap-2" data-review-item={item.key}>
      <input
        type="checkbox"
        aria-label={`采用${novelReviewLaneLabel(item.lane)}第${item.index + 1}条意见`}
        checked={item.range ? keys.has(item.key) : false}
        disabled={blocked || !item.range}
        onChange={e => toggle(item.key, e.target.checked)}
      />
      <span>
        {showLane && <strong>{novelReviewLaneLabel(item.lane)}：</strong>}
        <span className="opacity-70">【{item.issue.dimension}】</span>
        {!showLane && <>「{item.issue.quote}」</>}
        {!item.range && <span className="text-xs text-amber-200">（未能定位原文）</span>}
        —— {item.issue.problem}
        <span className="block opacity-80">改法：{item.issue.fix}</span>
      </span>
    </label>
  );

  return (
    <section
      className="mt-3 space-y-3 rounded-xl border border-white/10 p-3 text-sm"
      aria-label="多线路审稿对比"
      data-review-compare={entry.compareId}
    >
      <h4 className="font-semibold">
        多线路审稿对比 · {new Date(entry.createdAt).toLocaleString()}
      </h4>
      <ul className="flex flex-wrap gap-3" aria-label="各线路进度">
        {lanes.map(l => {
          const parsed = parseNovelReviewCompareLane(l);
          const actual = parsed?.model ? novelModelLabel(parsed.model) : "";
          const label = novelReviewLaneLabel(l.lane);
          return (
            <li key={l.lane} data-lane-status={l.status}>
              {label}：
              {l.status === "pending" && "审稿中…"}
              {l.status === "succeeded" &&
                (parsed ? `已完成${actual && actual !== label && actual !== "创作线路" ? `（实际由${actual}完成）` : ""}` : "结果无法读取，原始记录已保留")}
              {l.status === "failed" && (
                <>
                  <span className="text-amber-200">{l.failure || "未完成"}</span>
                  <button
                    type="button"
                    className="ml-2 underline"
                    disabled={disabled}
                    onClick={() => onRetry(l.lane)}
                  >
                    重试{label}
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {pendingCount > 0 && (
        <p className="text-xs opacity-70" role="status">
          还有 {pendingCount} 条线路在审稿，完成后自动出现在下表；刷新页面会接着查询，不会重复提交。
        </p>
      )}
      {stale && (
        <p className="text-amber-200" role="status">
          本集正文在对比后有修改，意见可能已对不上原文；如需按对比意见改稿，请重新对比。
        </p>
      )}
      {results.length > 0 && (
        <table className="w-full table-fixed border-collapse text-center" aria-label="各线路打分">
          <thead>
            <tr>
              <th className="text-left">维度</th>
              {lanes.map(l => (
                <th key={l.lane}>
                  <div>{novelReviewLaneLabel(l.lane)}</div>
                  {parseNovelReviewCompareLane(l) && (
                    <button
                      type="button"
                      className="text-xs underline"
                      aria-label={`只用${novelReviewLaneLabel(l.lane)}的意见改稿`}
                      disabled={blocked}
                      onClick={() => {
                        const only = buildNovelReviewOverride(
                          entry.original,
                          results,
                          novelReviewLaneSelection(entry.original, results, l.lane)
                        );
                        if ("override" in only) onRevise(only.override, { kind: "lane", lane: l.lane });
                      }}
                    >
                      只用这条线路的意见改稿
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.map(row => (
              <tr key={row.dimension} data-divergent={row.divergent ? "true" : undefined}>
                <td className="text-left">
                  {row.dimension}
                  {row.divergent && (
                    <span className="ml-1 rounded bg-amber-500/20 px-1 text-xs text-amber-200">分歧大</span>
                  )}
                </td>
                {lanes.map(l => (
                  <td key={l.lane}>{row.scores[l.lane] ?? "—"}</td>
                ))}
              </tr>
            ))}
            <tr data-verdict-row>
              <td className="text-left">结论</td>
              {lanes.map(l => (
                <td key={l.lane} className="text-left text-xs">
                  {parseNovelReviewCompareLane(l)?.review.verdict ?? "—"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
      {results.length > 0 && (
        <>
          <section aria-label="共同指出">
            <h5 className="font-semibold">共同指出（{comparison.shared.length} 处）</h5>
            {comparison.shared.length === 0 && <p className="opacity-70">各线路没有指出同一处问题。</p>}
            <ol className="mt-1 space-y-2">
              {comparison.shared.map(cluster => (
                <li key={cluster.id} className="rounded-lg border border-white/10 p-2" data-shared-cluster={cluster.id}>
                  <p>
                    原文「{cluster.quote}」
                    <span className="ml-2 text-xs opacity-70">
                      {cluster.lanes.map(novelReviewLaneLabel).join("、")}都指出
                    </span>
                  </p>
                  <div
                    className="mt-1 grid gap-2"
                    style={{ gridTemplateColumns: `repeat(${cluster.lanes.length}, minmax(0, 1fr))` }}
                  >
                    {cluster.lanes.map(lane => (
                      <div key={lane} className="space-y-1">
                        {cluster.items.filter(i => i.lane === lane).map(i => issueLine(i, true))}
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <section aria-label="仅某条线路指出">
            <h5 className="font-semibold">仅某条线路指出</h5>
            <div
              className="mt-1 grid gap-3"
              style={{ gridTemplateColumns: `repeat(${results.length}, minmax(0, 1fr))` }}
            >
              {results.map(r => (
                <div key={r.lane} data-unique-lane={r.lane}>
                  <h6 className="font-semibold">
                    {novelReviewLaneLabel(r.lane)}（{comparison.unique[r.lane].length} 条）
                  </h6>
                  <div className="space-y-1">
                    {comparison.unique[r.lane].map(i => issueLine(i, false))}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <div className="flex flex-wrap items-center gap-3">
            <span>
              已选 {built.issueCount} 处（同一处合并计一条）· 改稿线路：{rewriteLabel}
            </span>
            <button
              type="button"
              className="rounded border px-3 py-1"
              disabled={blocked || !("override" in built)}
              onClick={() => {
                if ("override" in built) onRevise(built.override, { kind: "selected" });
              }}
            >
              按所选意见改稿
            </button>
            {"error" in built && <span className="text-xs text-amber-200">{built.error}</span>}
          </div>
        </>
      )}
    </section>
  );
}

/** 开始对比前：勾选参与的线路（至少 2 条），显示合计参考价。 */
export function NovelReviewCompareStart({
  chapterIndex,
  selected,
  credits,
  disabled,
  minLanes,
  onChange,
  onStart,
  onCancel,
}: {
  chapterIndex: number;
  selected: NovelReviewLane[];
  credits: number;
  disabled: boolean;
  minLanes: number;
  onChange: (lanes: NovelReviewLane[]) => void;
  onStart: () => void;
  onCancel: () => void;
}) {
  return (
    <fieldset className="mt-2 rounded-xl border border-white/10 p-3 text-sm" aria-label={`第${chapterIndex}集多线路审稿对比`}>
      <legend>选择参与对比的线路（至少 {minLanes} 条；只审稿，不改动正文）</legend>
      <div className="flex flex-wrap gap-4">
        {NOVEL_REVIEW_COMPARE_LANES.map(l => (
          <label key={l.value} className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              aria-label={`对比${l.label}`}
              checked={selected.includes(l.value)}
              disabled={disabled}
              onChange={e =>
                onChange(
                  NOVEL_REVIEW_COMPARE_LANES.map(x => x.value).filter(v =>
                    v === l.value ? e.target.checked : selected.includes(v)
                  )
                )
              }
            />
            {l.label}
            {l.note && <span className="text-xs opacity-70">（{l.note}）</span>}
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs opacity-80">
        合计参考价 {credits} 积分（每条线路按一次审稿计）
      </p>
      <div className="mt-2 flex gap-3">
        <button
          type="button"
          className="rounded border px-3 py-1"
          disabled={disabled || selected.length < minLanes}
          onClick={onStart}
        >
          开始对比
        </button>
        <button type="button" className="underline" onClick={onCancel}>
          取消
        </button>
      </div>
    </fieldset>
  );
}
