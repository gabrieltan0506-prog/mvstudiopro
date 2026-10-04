import { useState } from "react";
import { Columns2, PencilLine, FileText } from "lucide-react";
import type { NovelRun } from "@/lib/novelWorkspace";
import { editedNovelRun, type ScriptEdits } from "@/lib/novelScriptEditing";
import { NovelScriptEditor } from "./NovelScriptEditor";
import { NovelTemplateComparison } from "./NovelTemplateComparison";

export function NovelScriptWorkspace({
  runs,
  scriptEdits,
  disabled,
  onAdopt,
  onChange,
}: {
  runs: NovelRun[];
  scriptEdits?: Record<string, ScriptEdits>;
  disabled: boolean;
  onAdopt: (run: NovelRun) => void;
  onChange: (requestId: string, edits: ScriptEdits) => void;
}) {
  const [mode, setMode] = useState<"compare" | "edit">("compare");
  const [requestId, setRequestId] = useState("");
  const current =
    runs.find(r => r.result.requestId === requestId) || runs.at(-1);
  if (!current)
    return (
      <div className="novel-empty novel-script-empty">
        <FileText size={32} />
        <h3>这里会出现可编辑的剧本</h3>
        <p>
          确认小说后，选择上方的单模板或组合生成。原小说保留，生成结果按集审阅后再接入漫剧。
        </p>
      </div>
    );
  const comparable = runs.flatMap(run => {
    try {
      return [editedNovelRun(run, scriptEdits?.[run.result.requestId])];
    } catch {
      return [];
    }
  });
  return (
    <div className="novel-script-workspace">
      <div className="novel-script-toolbar">
        <div className="novel-segmented" role="group" aria-label="剧本工作方式">
          <button
            aria-pressed={mode === "compare"}
            onClick={() => setMode("compare")}
          >
            <Columns2 size={16} />
            比较版本
          </button>
          <button
            aria-pressed={mode === "edit"}
            onClick={() => setMode("edit")}
          >
            <PencilLine size={16} />
            编辑剧本
          </button>
        </div>
        {mode === "edit" && (
          <label>
            编辑版本{" "}
            <select
              aria-label="编辑剧本版本"
              value={current.result.requestId}
              onChange={e => setRequestId(e.target.value)}
            >
              {runs.map((r, i) => (
                <option key={r.result.requestId} value={r.result.requestId}>
                  版本 {i + 1} ·{" "}
                  {r.input.templates
                    .map(t => t.publicId.replace(/^mt_/, "").toUpperCase())
                    .join(" + ")}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="novel-caption">编辑自动保存 · 原生成稿保留</span>
      </div>
      {mode === "compare" ? (
        <>
          {comparable.length !== runs.length && (
            <p className="novel-notice">
              部分编辑稿有空白必填项，暂不参与比较。可切到编辑剧本补齐，原稿已保留。
            </p>
          )}
          <NovelTemplateComparison
            runs={comparable}
            disabled={disabled}
            onEdit={run => {
              setRequestId(run.result.requestId);
              setMode("edit");
            }}
            onAdopt={onAdopt}
          />
        </>
      ) : (
        <NovelScriptEditor
          key={current.result.requestId}
          run={current}
          edits={scriptEdits?.[current.result.requestId]}
          disabled={disabled}
          onAdopt={onAdopt}
          onChange={edits => onChange(current.result.requestId, edits)}
        />
      )}
    </div>
  );
}
