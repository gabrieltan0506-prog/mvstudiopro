/**
 * 爆款仿写（1112）前台小部件：结构对照（模板节拍 → 本作内容）与原创度自查结果。
 * 文案全部来自 shared/novelImitationPrompt 的 NOVEL_IMITATION_UI（中性表述，不出现模型 / 通道 / 供应商名）。
 */
import { NOVEL_IMITATION_UI } from "@shared/novelImitationPrompt";
import type { NovelImitationOutline } from "@shared/novelWorkspace";

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
