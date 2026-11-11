/**
 * 爆款仿写（1112）前台小部件：结构对照（模板节拍 → 本作内容）、原创度自查结果，
 * 以及 1112b 的参考分 / 收录结果与「拆书参考模板」勾选列表。
 * 文案全部来自 shared/novelImitationPrompt 的 NOVEL_IMITATION_UI（中性表述，不出现模型 / 通道 / 供应商名）。
 */
import { NOVEL_IMITATION_UI } from "@shared/novelImitationPrompt";
import type { NovelImitationOutline } from "@shared/novelWorkspace";
import { NOVEL_REVIEW_DIMENSIONS } from "@shared/novelCraftReview";
import {
  NOVEL_IMITATION_COLLECT_SCORE,
  NOVEL_IMITATION_LIBRARY_PICK_MAX,
  type NovelImitationLibraryItem,
  type NovelImitationLibraryOutcome,
  type NovelImitationScore,
} from "@shared/novelImitation";

export function NovelImitationStructureMap({
  plan,
  stale,
}: {
  plan: NovelImitationOutline;
  /** 当前大纲已手动修改，与生成时的版本不同。 */
  stale?: boolean;
}) {
  const roles = new Map(plan.structure.map(b => [b.beat.trim(), b]));
  return (
    <details open className="mt-4 rounded border border-slate-600 p-3 text-sm" data-imitation-map>
      <summary className="cursor-pointer font-semibold">{NOVEL_IMITATION_UI.mappingTitle}</summary>
      {stale && (
        <p className="mt-2 text-xs text-slate-400">{NOVEL_IMITATION_UI.mappingStale}</p>
      )}
      <h4 className="mt-3 text-xs text-slate-400">{NOVEL_IMITATION_UI.mappingSkeleton}</h4>
      <ol className="mt-1 list-decimal space-y-1 pl-5">
        {plan.structure.map((b, i) => (
          <li key={i}>
            <strong>{b.beat}</strong>
            <span className="ml-1 rounded bg-amber-200/15 px-1 text-amber-200">{b.function}</span>
            <span className="ml-2 text-slate-300">{b.role}</span>
          </li>
        ))}
      </ol>
      {plan.episodes.map(ep => (
        <div key={ep.index} className="mt-3">
          <h4 className="font-semibold">{NOVEL_IMITATION_UI.mappingEpisode(ep.index, ep.title)}</h4>
          <table className="mt-1 w-full table-fixed border-collapse text-left">
            <thead>
              <tr className="text-xs text-slate-400">
                <th className="w-2/5 border-b border-slate-700 py-1 pr-2">{NOVEL_IMITATION_UI.mappingColumnBeat}</th>
                <th className="border-b border-slate-700 py-1">{NOVEL_IMITATION_UI.mappingColumnContent}</th>
              </tr>
            </thead>
            <tbody>
              {ep.beats.map((b, i) => (
                <tr key={i} className="align-top">
                  <td className="border-b border-slate-800 py-1 pr-2">
                    {b.beat}
                    <span className="ml-1 rounded bg-amber-200/15 px-1 text-xs text-amber-200">{b.function}</span>
                    <div className="text-xs text-slate-400">
                      {roles.get(b.beat.trim())?.role || NOVEL_IMITATION_UI.mappingUnlisted}
                    </div>
                  </td>
                  <td className="border-b border-slate-800 py-1">{b.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </details>
  );
}

/** 原创度自查：只陈述重名与相同句子并给建议，不定性、不拦截、不改稿。 */
export function NovelOriginalityNote({
  names,
  sentences,
  episode,
}: {
  names: readonly string[];
  sentences: readonly string[];
  /** 正文所在集数；大纲不传。 */
  episode?: number;
}) {
  const clear = !names.length && !sentences.length;
  return (
    <div
      className={`mt-2 text-sm ${clear ? "text-slate-400" : "text-amber-200"}`}
      role="status"
      data-originality-check
    >
      <p>
        {NOVEL_IMITATION_UI.originalityTitle}
        {episode ? `（第${episode}集）` : ""}：{clear ? NOVEL_IMITATION_UI.originalityClear : ""}
      </p>
      {!!names.length && <p>{NOVEL_IMITATION_UI.originalityNames(names)}</p>}
      {!!sentences.length && (
        <>
          <p>{NOVEL_IMITATION_UI.originalitySentences}</p>
          <ul className="list-disc pl-5">
            {sentences.map((f, i) => (
              <li key={i}>
                {episode ? `第${episode}集：` : ""}
                {f}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** 拆解完成后：参考分（综合 + 七个维度）与收录结果。 */
export function NovelImitationScoreCard({
  score,
  library,
}: {
  score?: NovelImitationScore;
  library?: NovelImitationLibraryOutcome;
}) {
  return (
    <div className="mt-2 rounded border border-slate-700 p-2 text-sm" data-imitation-score role="status">
      <p className="font-semibold">
        {NOVEL_IMITATION_UI.scoreTitle}：{score ? NOVEL_IMITATION_UI.scoreTotal(score.total) : NOVEL_IMITATION_UI.scoreMissing}
      </p>
      {score && (
        <>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-300">
            {NOVEL_REVIEW_DIMENSIONS.map(d => (
              <li key={d}>
                {d} {score.dimensions[d]}/5
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-300">{score.reason}</p>
          <p className="mt-1 text-xs text-slate-500">{NOVEL_IMITATION_UI.scoreNote}</p>
        </>
      )}
      {library &&
        (library.failed ? (
          <p className="mt-1 text-xs text-amber-200">{NOVEL_IMITATION_UI.collectFailed}</p>
        ) : (
          <p className="mt-1 text-xs" data-imitation-collected>
            {library.alreadyCollected
              ? NOVEL_IMITATION_UI.collectKept
              : NOVEL_IMITATION_UI.collectDone(library.wholeCollected, library.highlightCount)}
          </p>
        ))}
    </div>
  );
}

/** 拆书参考模板：列出公共参考模板，可勾选（最多 3 条）；管理员可删除。 */
export function NovelImitationLibraryPicker({
  items,
  failed,
  picked,
  disabled,
  canDelete,
  onToggle,
  onDelete,
}: {
  items: readonly NovelImitationLibraryItem[];
  failed?: boolean;
  picked: readonly string[];
  disabled?: boolean;
  /** 仅管理员显示删除。 */
  canDelete?: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const max = NOVEL_IMITATION_LIBRARY_PICK_MAX;
  const full = picked.length >= max;
  return (
    <section className="mt-4 text-sm" data-imitation-library aria-label={NOVEL_IMITATION_UI.libraryTitle}>
      <h3 className="font-semibold">
        {NOVEL_IMITATION_UI.libraryTitle}
        <span className="ml-2 text-xs font-normal text-slate-400">{NOVEL_IMITATION_UI.libraryPicked(picked.length, max)}</span>
      </h3>
      <p className="mt-1 text-xs text-slate-400">{NOVEL_IMITATION_UI.libraryHint(NOVEL_IMITATION_COLLECT_SCORE, max)}</p>
      {failed ? (
        <p className="mt-2 text-xs text-amber-200">{NOVEL_IMITATION_UI.libraryLoadFailed}</p>
      ) : !items.length ? (
        <p className="mt-2 text-xs text-slate-400">{NOVEL_IMITATION_UI.libraryEmpty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.map(item => {
            const checked = picked.includes(item.id);
            return (
              <li key={item.id} className="flex items-start gap-2" data-library-item={item.id}>
                <input
                  type="checkbox"
                  aria-label={`${item.title} ${item.kind === "whole" ? NOVEL_IMITATION_UI.libraryKindWhole : NOVEL_IMITATION_UI.libraryKindHighlight}`}
                  checked={checked}
                  disabled={disabled || (!checked && full)}
                  title={!checked && full ? NOVEL_IMITATION_UI.libraryPickLimit(max) : undefined}
                  onChange={e => onToggle(item.id, e.target.checked)}
                />
                <div className="min-w-0 flex-1">
                  <div>
                    <strong>{item.title}</strong>
                    <span className="ml-1 rounded bg-amber-200/15 px-1 text-xs text-amber-200">
                      {item.kind === "whole" ? NOVEL_IMITATION_UI.libraryKindWhole : NOVEL_IMITATION_UI.libraryKindHighlight}
                    </span>
                    {item.total !== undefined && (
                      <span className="ml-1 text-xs text-slate-300">{NOVEL_IMITATION_UI.libraryScore(item.total)}</span>
                    )}
                  </div>
                  {item.feature && <div className="text-xs text-slate-300">{item.feature}</div>}
                  {item.reusableAs && (
                    <div className="text-xs text-slate-400">{NOVEL_IMITATION_UI.libraryReuse(item.reusableAs)}</div>
                  )}
                </div>
                {canDelete && (
                  <button
                    type="button"
                    className="novel-text-link text-xs"
                    disabled={disabled}
                    onClick={() => onDelete(item.id)}
                  >
                    {NOVEL_IMITATION_UI.libraryDelete}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
