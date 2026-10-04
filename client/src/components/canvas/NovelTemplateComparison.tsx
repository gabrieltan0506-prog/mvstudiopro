import { useState } from "react";
import {
  NOVEL_FACETS,
  novelScriptSchema,
  novelModelLabel,
} from "@shared/novelWorkspace";
import { compareScriptSentences } from "@/lib/manhuaSentenceDiff";
import { scriptBaseline, type NovelRun } from "@/lib/novelWorkspace";
const colors = [
  "text-cyan-200 bg-cyan-950/50",
  "text-violet-200 bg-violet-950/50",
  "text-pink-200 bg-pink-950/50",
  "text-yellow-200 bg-yellow-950/50",
  "text-emerald-200 bg-emerald-950/50",
  "text-orange-200 bg-orange-950/50",
];
export function NovelTemplateComparison({ runs }: { runs: NovelRun[] }) {
  const [selected, setSelected] = useState(0),
    [pulse, setPulse] = useState(0);
  const [flash, setFlash] = useState(true);
  const scripts = runs.filter(r => r.input.stage === "script");
  const groups = Array.from(new Set(scripts.map(r => scriptBaseline(r.input))));
  const group = groups[Math.min(selected, Math.max(0, groups.length - 1))];
  const variants = scripts
    .filter(r => scriptBaseline(r.input) === group)
    .map(r => ({
      ...r,
      script: novelScriptSchema.parse(JSON.parse(r.result.text)),
    }));
  const [facet, setFacet] = useState<(typeof NOVEL_FACETS)[number]>("场景");
  const baseline = variants[0]?.script;
  if (!baseline)
    return (
      <p className="text-sm text-slate-400">
        确认小说后，分别生成模板候选，再按同一份小说对照。
      </p>
    );
  const keys = Array.from(
    new Set(
      variants.flatMap(v =>
        v.script.episodes.flatMap(ep =>
          ep.scenes.map(s => `${ep.index}|${s.key}`)
        )
      )
    )
  );
  return (
    <section aria-label="模板比较">
      <details className="mb-4 rounded-xl border border-white/15 p-3" open>
        <summary className="cursor-pointer text-sm font-semibold">
          模板方法如何用进剧本
        </summary>
        <p className="mt-2 text-xs text-slate-400">
          这是生成时的运用说明，请结合下方场次核对实际效果。
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {variants.map(v => (
            <div
              key={v.result.requestId}
              className="min-w-0 rounded-lg bg-white/5 p-3 text-sm"
            >
              {v.result.model && (
                <p className="text-xs text-cyan-200">
                  {novelModelLabel(v.result.model)}
                </p>
              )}
              <p className="font-medium">
                {v.input.templates
                  .map(
                    t =>
                      t.publicId.replace(/^mt_/, "").toUpperCase() +
                      (t.weight === undefined ? "" : ` ${t.weight}%`)
                  )
                  .join(" + ")}
              </p>
              {v.script.applications?.length ? (
                v.script.applications.map((a, i) => (
                  <div key={i} className="mt-3 border-t border-white/10 pt-2">
                    <p className="text-amber-200">
                      {a.publicId.replace(/^mt_/, "").toUpperCase()} ·{" "}
                      {a.method}
                    </p>
                    <p className="mt-1 leading-6 text-slate-200">
                      {a.adaptation}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      对应场次：{a.sceneKeys.join("、")}
                    </p>
                  </div>
                ))
              ) : (
                <p className="mt-2 text-xs text-slate-400">
                  这份已保存的剧本未记录方法运用说明。
                </p>
              )}
            </div>
          ))}
        </div>
      </details>
      <style>{`@keyframes novel-difference{0%,100%{outline-color:transparent}50%{outline-color:currentColor}}.novel-difference{outline:2px solid transparent;animation:novel-difference 1.4s ease-in-out 2}@media(prefers-reduced-motion:reduce){.novel-difference{animation:none}}`}</style>
      <label>
        比较批次
        <select
          className="ml-2 bg-slate-900 p-2"
          value={selected}
          onChange={e => setSelected(Number(e.target.value))}
        >
          {groups.map((_, i) => (
            <option key={i} value={i}>
              小说版本 {i + 1}
            </option>
          ))}
        </select>
      </label>
      <p className="my-3 text-xs text-slate-400">
        仅比较同轮次、同底本、同方向、同一份已确认小说。第一列为文字基准；高亮表示文字变化，不能代替语义或质量审查。不同场次编号另列，避免错位比较。
      </p>
      <div className="flex flex-wrap gap-2">
        {NOVEL_FACETS.map((f, i) => (
          <button
            key={f}
            aria-pressed={facet === f}
            className={`rounded px-3 py-2 ${colors[i]}`}
            onClick={() => {
              setFacet(f);
              setPulse(p => p + 1);
            }}
          >
            {f}
          </button>
        ))}
        <label className="p-2 text-xs">
          <input
            type="checkbox"
            checked={flash}
            onChange={e => setFlash(e.target.checked)}
          />
          差异短暂闪烁
        </label>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="p-3">集次 / 场次</th>
              {variants.map((v, i) => (
                <th key={v.result.requestId} className="min-w-72 p-3 align-top">
                  {i + 1}. {v.input.templates.map(t => t.publicId).join(" + ")}
                  <p className="mt-1 text-xs font-normal">
                    {v.input.templates
                      .map(
                        t =>
                          t.role +
                          (t.weight === undefined ? "" : `（${t.weight}%）`)
                      )
                      .join(" / ")}
                  </p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {baseline.episodes.map(ep => (
              <tr key={`hook${ep.index}`}>
                <th className="p-3">第{ep.index}集 · 留人检查</th>
                {variants.map(v => {
                  const e = v.script.episodes.find(x => x.index === ep.index);
                  return (
                    <td
                      key={v.result.requestId}
                      className="border border-white/10 p-3 align-top"
                    >
                      开场：{e?.opening}
                      <br />
                      兑现：{e?.payoff}
                      <br />
                      追看：{e?.hook}
                    </td>
                  );
                })}
              </tr>
            ))}
            {keys.map(key => {
              const [ep, keyId] = key.split("|");
              const base =
                baseline.episodes
                  .find(e => e.index === Number(ep))
                  ?.scenes.find(s => s.key === keyId)?.[facet] || "";
              return (
                <tr key={`${key}:${facet}`}>
                  <th className="p-3">
                    第{ep}集<br />
                    {keyId}
                    <br />
                    {facet}
                  </th>
                  {variants.map((v, i) => {
                    const value =
                      v.script.episodes
                        .find(e => e.index === Number(ep))
                        ?.scenes.find(s => s.key === keyId)?.[facet] || "";
                    return (
                      <td
                        key={v.result.requestId}
                        className="whitespace-pre-wrap border border-white/10 p-3 align-top leading-7"
                      >
                        {i === 0 ? (
                          <span className="text-slate-200">
                            {value || "此版无该场次"}
                          </span>
                        ) : (
                          compareScriptSentences(base, value).map((row, j) =>
                            row.kind === "removed" ? (
                              <span
                                key={j}
                                className="text-rose-200 line-through"
                                title="该版删去"
                              >
                                {row.before}
                              </span>
                            ) : (
                              <span
                                key={`${j}:${pulse}`}
                                className={
                                  row.kind === "same"
                                    ? "text-slate-200"
                                    : `${colors[NOVEL_FACETS.indexOf(facet)]} ${flash ? "novel-difference" : ""}`
                                }
                              >
                                {row.after}
                              </span>
                            )
                          )
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
