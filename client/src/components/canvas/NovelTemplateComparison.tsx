import { useState } from "react";
import { PencilLine, ArrowRight } from "lucide-react";
import {
  NOVEL_FACETS,
  novelScriptSchema,
  novelModelLabel,
} from "@shared/novelWorkspace";
import { compareScriptSentences } from "@/lib/manhuaSentenceDiff";
import { scriptBaseline, type NovelRun } from "@/lib/novelWorkspace";
const colors = [
  "novel-diff-scene",
  "novel-diff-person",
  "novel-diff-look",
  "novel-diff-light",
  "novel-diff-mood",
  "novel-diff-dialogue",
];
export function NovelTemplateComparison({
  runs,
  onAdopt,
  onEdit,
  disabled,
}: {
  runs: NovelRun[];
  onAdopt?: (run: NovelRun) => void;
  onEdit?: (run: NovelRun) => void;
  disabled?: boolean;
}) {
  const [groupIndex, setGroupIndex] = useState(0);
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [episode, setEpisode] = useState(0);
  const [flash, setFlash] = useState(false);
  const scripts = runs.filter(r => r.input.stage === "script");
  const groups = Array.from(new Set(scripts.map(r => scriptBaseline(r.input))));
  const group = groups[Math.min(groupIndex, Math.max(0, groups.length - 1))];
  const variants = scripts
    .filter(r => scriptBaseline(r.input) === group)
    .map(r => ({
      ...r,
      script: novelScriptSchema.parse(JSON.parse(r.result.text)),
    }));
  if (!variants.length)
    return (
      <p className="novel-notice">
        确认小说后生成候选剧本，再按同一份小说对照。
      </p>
    );
  const left = variants.find(r => r.result.requestId === leftId) || variants[0];
  const right =
    variants.find(
      r =>
        r.result.requestId === rightId &&
        r.result.requestId !== left.result.requestId
    ) || variants.find(r => r.result.requestId !== left.result.requestId);
  const shown = right ? [left, right] : [left];
  const episodeIds = Array.from(
    new Set(shown.flatMap(r => r.script.episodes.map(ep => ep.index)))
  ).sort((a, b) => a - b);
  const currentEpisode = episodeIds.includes(episode) ? episode : episodeIds[0];
  const baseline = left.script.episodes.find(ep => ep.index === currentEpisode);
  const scenes = Array.from(
    new Set(
      shown.flatMap(
        r =>
          r.script.episodes
            .find(ep => ep.index === currentEpisode)
            ?.scenes.map(s => s.key) || []
      )
    )
  );
  const versionLabel = (r: NovelRun) =>
    r.input.templates
      .map(
        t =>
          `${t.publicId.replace(/^mt_/, "").toUpperCase()}${t.weight === undefined ? "" : ` ${t.weight}%`}`
      )
      .join(" / ");
  return (
    <section aria-label="模板比较" className="novel-comparison">
      <div className="novel-comparison-controls">
        {groups.length > 1 && (
          <label>
            小说批次{" "}
            <select
              aria-label="比较批次"
              value={Math.min(groupIndex, groups.length - 1)}
              onChange={e => {
                setGroupIndex(Number(e.target.value));
                setEpisode(0);
              }}
            >
              {groups.map((_, i) => (
                <option key={i} value={i}>
                  小说版本 {i + 1}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="novel-episode-tabs" aria-label="比较集数">
          {episodeIds.map(i => (
            <button
              key={i}
              aria-pressed={currentEpisode === i}
              onClick={() => setEpisode(i)}
            >
              第{i}集
            </button>
          ))}
        </div>
        <label className="novel-caption">
          <input
            type="checkbox"
            checked={flash}
            onChange={e => setFlash(e.target.checked)}
          />{" "}
          差异短暂闪烁
        </label>
      </div>
      <p className="novel-caption mb-4">
        相同文字保持原色；变化按场景、人物、妆容、灯光、氛围、对白标注。高亮仅表示文字变化，不代表质量高低。
      </p>
      <div
        className={`novel-compare-columns ${right ? "" : "novel-single-version"}`}
      >
        {shown.map((v, column) => {
          const ep = v.script.episodes.find(e => e.index === currentEpisode);
          return (
            <article
              className="novel-version"
              key={v.result.requestId}
              aria-label={`候选剧本 ${column === 0 ? "A" : "B"}`}
            >
              <header className="novel-version-header">
                <div>
                  <h3>版本 {column === 0 ? "A" : "B"}</h3>
                  <select
                    aria-label={`对照版本 ${column === 0 ? "A" : "B"}`}
                    value={v.result.requestId}
                    onChange={e =>
                      column === 0
                        ? setLeftId(e.target.value)
                        : setRightId(e.target.value)
                    }
                  >
                    {variants
                      .filter(
                        r =>
                          column === 0 ||
                          r.result.requestId !== left.result.requestId
                      )
                      .map(r => (
                        <option
                          key={r.result.requestId}
                          value={r.result.requestId}
                        >
                          {versionLabel(r)} · 候选{variants.indexOf(r) + 1}
                        </option>
                      ))}
                  </select>
                </div>
                {onEdit && (
                  <button className="novel-button" onClick={() => onEdit(v)}>
                    <PencilLine size={14} />
                    编辑本版
                  </button>
                )}
              </header>
              <div className="novel-version-content">
                <h4>
                  第{currentEpisode}集 · {ep?.title || "此版未包含该集"}
                </h4>
                {ep && (
                  <details className="novel-payoff">
                    <summary>开场、兑现与追看点</summary>
                    <p>开场：{ep.opening}</p>
                    <p>兑现：{ep.payoff}</p>
                    <p>追看：{ep.hook}</p>
                  </details>
                )}
                {scenes.map(key => (
                  <section className="novel-compare-scene" key={key}>
                    <h5>场次 {key}</h5>
                    {NOVEL_FACETS.map((facet, fi) => {
                      const base =
                        baseline?.scenes.find(s => s.key === key)?.[facet] ||
                        "";
                      const value =
                        ep?.scenes.find(s => s.key === key)?.[facet] || "";
                      const rows =
                        column === 0 ? [] : compareScriptSentences(base, value);
                      const changed =
                        right !== undefined &&
                        (column === 0
                          ? base !==
                            (right.script.episodes
                              .find(e => e.index === currentEpisode)
                              ?.scenes.find(s => s.key === key)?.[facet] || "")
                          : value !== base);
                      return (
                        <div
                          className={`novel-facet ${changed ? colors[fi] : ""}`}
                          key={facet}
                        >
                          <span className="novel-facet-label">
                            {facet}
                            {changed ? " · 有差异" : ""}
                          </span>
                          <p>
                            {column === 0
                              ? value || "此版无该场次"
                              : rows.map((row, i) =>
                                  row.kind === "removed" ? (
                                    <del key={i} title="本版删去">
                                      {row.before}
                                    </del>
                                  ) : (
                                    <span
                                      key={`${i}:${flash}`}
                                      className={
                                        row.kind === "same"
                                          ? "novel-same"
                                          : `novel-changed ${flash ? "novel-difference" : ""}`
                                      }
                                    >
                                      {row.after}
                                    </span>
                                  )
                                )}
                          </p>
                        </div>
                      );
                    })}
                  </section>
                ))}
                <details className="novel-applications">
                  <summary>模板运用依据</summary>
                  <p className="novel-caption">
                    这是生成时的运用说明；修改后请以当前正文为准。
                  </p>
                  {v.script.applications?.map((a, i) => (
                    <div key={i}>
                      <h5>
                        {a.publicId.replace(/^mt_/, "").toUpperCase()} ·{" "}
                        {a.method}
                      </h5>
                      <p>{a.adaptation}</p>
                      <small>对应场次：{a.sceneKeys.join("、")}</small>
                    </div>
                  ))}
                  {!v.script.applications?.length && (
                    <p>这份剧本未记录方法运用说明。</p>
                  )}
                  {v.result.model && (
                    <small>{novelModelLabel(v.result.model)}</small>
                  )}
                </details>
              </div>
              {onAdopt && (
                <footer>
                  <button
                    className="novel-button novel-primary"
                    disabled={disabled}
                    onClick={() => onAdopt(v)}
                  >
                    采用此版，接入当前漫剧
                    <ArrowRight size={16} />
                  </button>
                </footer>
              )}
            </article>
          );
        })}
      </div>
      {!right && (
        <p className="novel-notice">
          当前只有一版。可直接编辑采用，也可调整模板后生成另一版比较。
        </p>
      )}
    </section>
  );
}
