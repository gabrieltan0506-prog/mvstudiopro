import { NovelQualityHints } from "./NovelQualityHints";
import { NOVEL_FACETS, novelScriptSchema } from "@shared/novelWorkspace";
import type { NovelRun } from "@/lib/novelWorkspace";
import {
  editedNovelScript,
  scriptFieldKey,
  type ScriptEdits,
} from "@/lib/novelScriptEditing";
export function NovelScriptEditor({
  run,
  edits,
  onChange,
  onAdopt,
  disabled,
}: {
  run: NovelRun;
  edits?: ScriptEdits;
  onChange: (edits: ScriptEdits) => void;
  onAdopt: (run: NovelRun) => void;
  disabled: boolean;
}) {
  const script = editedNovelScript(run, edits),
    valid = novelScriptSchema.safeParse(script).success;
  const field = (
    label: string,
    value: string,
    max: number,
    path: (string | number)[],
    rows = 3
  ) => (
    <label className="mt-3 block text-sm" key={scriptFieldKey(...path)}>
      {label}
      <textarea
        aria-label={label}
        className="mt-1 block w-full rounded-lg border border-white/20 bg-slate-950 p-3 text-slate-100"
        rows={rows}
        maxLength={max}
        value={value}
        onChange={e =>
          onChange({ ...edits, [scriptFieldKey(...path)]: e.target.value })
        }
      />
    </label>
  );
  return (
    <article
      aria-label={`可编辑剧本 ${run.result.requestId}`}
      className="my-5 rounded-xl border border-amber-200/30 p-4"
    >
      <h3 className="text-lg font-semibold">
        {run.input.templates.length > 1 ? "组合剧本" : "单模板剧本"} ·{" "}
        {run.input.templates
          .map(t => t.publicId.replace(/^mt_/, "").toUpperCase())
          .join(" + ")}
      </h3>
      <p className="mt-2 text-sm text-slate-400">
        逐集修改后采用。修改自动保存到本机，纳入完整备份；原生成稿保留。不会重新调用模型。
      </p>
      {field("剧本名称", script.title, 200, ["title"], 1)}
      {script.episodes.map(ep => (
        <details
          key={ep.index}
          open={ep.index === script.episodes[0].index}
          className="mt-4 rounded-lg border border-white/15 p-3"
        >
          <summary className="cursor-pointer font-semibold">
            第{ep.index}集 · {ep.title} · 点击展开编辑
          </summary>
          <NovelQualityHints
            text={[
              ep.opening,
              ep.payoff,
              ep.hook,
              ...ep.scenes.flatMap(scene => NOVEL_FACETS.map(f => scene[f])),
            ].join("\n")}
          />
          {field(`第${ep.index}集标题`, ep.title, 120, [ep.index, "title"], 1)}
          {(["opening", "payoff", "hook"] as const).map((k, i) =>
            field(
              `第${ep.index}集${["开场", "兑现与爽点", "结尾钩子"][i]}`,
              ep[k],
              1200,
              [ep.index, k]
            )
          )}
          {ep.scenes.map(scene => (
            <section
              key={scene.key}
              className="mt-4 border-t border-white/10 pt-2"
            >
              <h4>场次 {scene.key}</h4>
              {NOVEL_FACETS.map(f =>
                field(
                  `第${ep.index}集 ${scene.key} ${f}`,
                  scene[f],
                  f === "对白" ? 3500 : 1800,
                  [ep.index, scene.key, f],
                  f === "对白" ? 6 : 3
                )
              )}
            </section>
          ))}
        </details>
      ))}
      {!valid && (
        <p role="alert" className="mt-3 text-amber-200">
          编辑草稿已保留，请补齐空白内容后再采用；无对白可写“无对白”。
        </p>
      )}
      <button
        disabled={disabled || !valid}
        className="mt-4 rounded-lg bg-amber-200 px-4 py-2 text-slate-950 disabled:opacity-40"
        onClick={() => onAdopt(run)}
      >
        采用这版剧本，进入漫剧工厂
      </button>
      <details className="mt-3 text-sm">
        <summary>查看原生成稿（保留不变）</summary>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap">
          {run.result.text}
        </pre>
      </details>
    </article>
  );
}
