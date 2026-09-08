import { useEffect, useRef, useState } from "react";
import {
  applyKnowledgeCardReviewSuggestions,
  ruleScanKnowledgeCardText,
  validateKnowledgeCardReviewIssues,
  type KnowledgeCardTextReviewIssue,
} from "@shared/knowledgeCardTextReview";
export type KnowledgeCardTextReviewResult = {
  issues: KnowledgeCardTextReviewIssue[];
  summary: string;
  checkedChars: number;
};
type SavedReview = {
  version: 1;
  checkedSource: string;
  issues: KnowledgeCardTextReviewIssue[];
  summary: string;
  pendingId?: string;
  originalBeforeApply?: string;
  lastApplied?: string;
};
export type KnowledgeCardTextReviewPanelProps = {
  sourceText: string;
  storageKey: string;
  disabled?: boolean;
  onApply: (text: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onReview?: (
    source: string,
    requestId: string
  ) => Promise<KnowledgeCardTextReviewResult>;
  onResume?: (requestId: string) => Promise<KnowledgeCardTextReviewResult>;
};
const empty = (): SavedReview => ({
  version: 1,
  checkedSource: "",
  issues: [],
  summary: "",
});
function validateSaved(raw: unknown): SavedReview {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("校对草稿格式损坏");
  const item = raw as SavedReview;
  if (
    item.version !== 1 ||
    typeof item.checkedSource !== "string" ||
    typeof item.summary !== "string" ||
    !Array.isArray(item.issues) ||
    (item.pendingId !== undefined &&
      (typeof item.pendingId !== "string" || !item.pendingId.trim())) ||
    (item.originalBeforeApply === undefined) !==
      (item.lastApplied === undefined) ||
    (item.originalBeforeApply !== undefined &&
      (typeof item.originalBeforeApply !== "string" ||
        typeof item.lastApplied !== "string"))
  )
    throw new Error("校对草稿格式损坏");
  applyKnowledgeCardReviewSuggestions(
    item.checkedSource,
    item.checkedSource,
    item.issues,
    []
  );
  return item;
}
export function KnowledgeCardTextReviewPanel(
  props: KnowledgeCardTextReviewPanelProps
) {
  const [saved, setSaved] = useState<SavedReview>(empty);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(true);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const epoch = useRef(0);
  const activeKey = useRef(props.storageKey);
  const busyCallback = useRef(props.onBusyChange);
  busyCallback.current = props.onBusyChange;
  useEffect(() => {
    epoch.current++;
    activeKey.current = props.storageKey;
    const wasRunning = running.current;
    running.current = false;
    setBusy(false);
    if (wasRunning) busyCallback.current?.(false);
    setSelected([]);
    setError("");
    setBlocked(true);
    setSaved(empty());
    try {
      const raw = localStorage.getItem(props.storageKey);
      setSaved(raw ? validateSaved(JSON.parse(raw)) : empty());
      setBlocked(false);
    } catch {
      setError(
        "已保存的校对草稿无法读取，已停止覆盖；请保留原稿后检查浏览器存储。"
      );
    }
    return () => {
      epoch.current++;
      const wasRunning = running.current;
      running.current = false;
      if (wasRunning) busyCallback.current?.(false);
    };
  }, [props.storageKey]);
  function persist(next: SavedReview) {
    localStorage.setItem(props.storageKey, JSON.stringify(next));
    setSaved(next);
  }
  function saveFailed() {
    setError(
      "校对记录保存失败，未提交新检查或修改正文；请释放浏览器存储空间后重试。"
    );
  }
  async function check(resume = false) {
    if (
      running.current ||
      blocked ||
      props.disabled ||
      (!resume && saved.pendingId) ||
      (resume && (!saved.pendingId || !props.onResume))
    )
      return;
    if (
      !resume &&
      (!props.sourceText.trim() || props.sourceText.length > 50000)
    ) {
      setError("每框请提供1至50000字符的原文后再检查。");
      return;
    }
    let next = saved;
    if (!resume) {
      const issues = ruleScanKnowledgeCardText(props.sourceText);
      next = {
        ...saved,
        checkedSource: props.sourceText,
        issues,
        summary: "规则初筛仅提示疑点，不能保证发现全部错字、语义或逻辑问题。",
        pendingId: props.onReview ? crypto.randomUUID() : undefined,
      };
      try {
        persist(next);
      } catch {
        saveFailed();
        return;
      }
      setSelected([]);
      setError("");
      if (!props.onReview) return;
    }
    const currentEpoch = epoch.current;
    const key = props.storageKey;
    running.current = true;
    setBusy(true);
    busyCallback.current?.(true);
    setError("");
    try {
      const result = resume
        ? await props.onResume!(next.pendingId!)
        : await props.onReview!(next.checkedSource, next.pendingId!);
      if (currentEpoch !== epoch.current || key !== activeKey.current) return;
      if (
        !result ||
        typeof result.summary !== "string" ||
        !result.summary.trim() ||
        result.checkedChars !== next.checkedSource.length
      )
        throw new Error("检查回执不完整，保留原任务等待核对");
      const modelIssues = validateKnowledgeCardReviewIssues(
        next.checkedSource,
        result.issues,
        "model"
      );
      const issues = [
        ...ruleScanKnowledgeCardText(next.checkedSource),
        ...modelIssues,
      ];
      applyKnowledgeCardReviewSuggestions(
        next.checkedSource,
        next.checkedSource,
        issues,
        []
      );
      const complete = {
        ...next,
        issues,
        summary: result.summary,
        pendingId: undefined,
      };
      persist(complete);
      setSelected([]);
    } catch (failure) {
      if (currentEpoch !== epoch.current || key !== activeKey.current) return;
      if ((failure as { terminal?: boolean })?.terminal === true) {
        try {
          persist({ ...next, pendingId: undefined });
        } catch {
          saveFailed();
          return;
        }
        setError("本次检查已明确失败，原文保持不变，可重新检查。");
      } else
        setError(
          "检查结果尚未确认，原文和任务记录已保留；请查询原检查任务，不要重新提交。"
        );
    } finally {
      if (currentEpoch === epoch.current && key === activeKey.current) {
        running.current = false;
        setBusy(false);
        busyCallback.current?.(false);
      }
    }
  }
  const stale = props.sourceText !== saved.checkedSource;
  function apply() {
    if (
      props.disabled ||
      running.current ||
      blocked ||
      saved.pendingId ||
      stale ||
      !selected.length
    )
      return;
    try {
      const text = applyKnowledgeCardReviewSuggestions(
        props.sourceText,
        saved.checkedSource,
        saved.issues,
        selected
      );
      const next = {
        ...saved,
        originalBeforeApply: props.sourceText,
        lastApplied: text,
      };
      persist(next);
      props.onApply(text);
      setSelected([]);
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "应用失败，原文未修改"
      );
    }
  }
  function undo() {
    if (
      props.disabled ||
      running.current ||
      blocked ||
      saved.pendingId ||
      saved.originalBeforeApply === undefined ||
      props.sourceText !== saved.lastApplied
    )
      return;
    try {
      const original = saved.originalBeforeApply;
      // 先确认存储可写；保留撤回记录，父级保存失败时仍可再次恢复原文。
      persist(saved);
      props.onApply(original);
      setSelected([]);
      setError("");
    } catch {
      saveFailed();
    }
  }
  const button =
    "rounded-lg border border-white/15 px-3 py-2 text-xs text-violet-100 disabled:opacity-40";
  return (
    <section
      aria-label="正文校对"
      className="mt-3 space-y-2 rounded-lg border border-white/10 p-3"
    >
      <h4 className="text-sm text-slate-100">正文校对</h4>
      <p className="text-xs text-slate-400">
        规则初筛只提示疑点，不能保证发现全部错字、语义和逻辑问题。检查不会自动改写原文；有明确建议的条目需勾选后才应用。不确定或逻辑疑点请人工确认。
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={
            props.disabled ||
            busy ||
            blocked ||
            Boolean(saved.pendingId) ||
            !props.sourceText.trim()
          }
          onClick={() => void check()}
        >
          {props.onReview ? "检查文本" : "规则初筛"}
        </button>
        {saved.pendingId && (
          <button
            type="button"
            className={button}
            disabled={props.disabled || busy || blocked || !props.onResume}
            onClick={() => void check(true)}
          >
            查询原检查任务
          </button>
        )}
        <button
          type="button"
          className={button}
          disabled={
            props.disabled ||
            busy ||
            blocked ||
            Boolean(saved.pendingId) ||
            stale ||
            !selected.length
          }
          onClick={apply}
        >
          应用勾选建议
        </button>
        {saved.originalBeforeApply !== undefined && (
          <button
            type="button"
            className={button}
            disabled={
              props.disabled ||
              busy ||
              blocked ||
              Boolean(saved.pendingId) ||
              props.sourceText !== saved.lastApplied
            }
            onClick={undo}
          >
            撤回上次应用
          </button>
        )}
      </div>
      {busy && (
        <p role="status" className="text-xs text-slate-300">
          正在核对原文…
        </p>
      )}
      {saved.pendingId && (
        <p className="text-xs text-amber-200">
          检查任务已登记。结果未知时只查询原任务，不自动重新检查。
        </p>
      )}
      {saved.checkedSource && stale && (
        <p className="text-xs text-amber-200">
          正文已变化，校对结果已过期，不能应用旧建议。
        </p>
      )}
      {saved.summary && (
        <p className="text-xs text-slate-300">{saved.summary}</p>
      )}
      {saved.checkedSource && !saved.issues.length && !saved.pendingId && (
        <p className="text-xs text-slate-400">
          本次未标记疑点，不代表原文一定正确。
        </p>
      )}
      <ul className="space-y-2">
        {saved.issues.map(issue => (
          <li
            key={issue.id}
            className="rounded border border-white/10 p-2 text-xs text-slate-300"
          >
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                aria-label={`选择建议 ${issue.id}`}
                disabled={
                  props.disabled ||
                  busy ||
                  blocked ||
                  Boolean(saved.pendingId) ||
                  stale ||
                  issue.suggestion === undefined
                }
                checked={selected.includes(issue.id)}
                onChange={event =>
                  setSelected(current =>
                    event.target.checked
                      ? [...current, issue.id]
                      : current.filter(id => id !== issue.id)
                  )
                }
              />
              <span>
                {issue.source === "rules" ? "规则疑点" : "文本检查"} ·{" "}
                {
                  {
                    ocr: "识别疑点",
                    typo: "错字或标点",
                    fluency: "语句流畅",
                    logic: "逻辑疑点",
                  }[issue.kind]
                }{" "}
                · 位置{issue.start + 1}–{issue.end}
                <br />
                原文：
                <span className="whitespace-pre-wrap">{issue.original}</span>
                {issue.suggestion !== undefined && (
                  <>
                    <br />
                    建议：
                    <span className="whitespace-pre-wrap">
                      {issue.suggestion || "（删除此处）"}
                    </span>
                  </>
                )}
                <br />
                {issue.reason}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </section>
  );
}
