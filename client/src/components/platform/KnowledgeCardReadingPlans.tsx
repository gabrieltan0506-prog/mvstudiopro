import { KnowledgeCardReadingProgress } from "./KnowledgeCardReadingProgress";
import { useEffect, useRef, useState } from "react";
import {
  quoteKnowledgeCardReadingPlan,
  type KnowledgeCardReadingConstraints, type KnowledgeCardReadingMode, type KnowledgeCardReadingPlan,
} from "@shared/knowledgeCardReadingPlan";

export type KnowledgeCardReadingPlansProps = {
  plan?: KnowledgeCardReadingPlan;
  constraints?: KnowledgeCardReadingConstraints;
  quote?: ReturnType<typeof quoteKnowledgeCardReadingPlan>;
  phase: "idle" | "reading" | "planning" | "ready" | "generating" | "failed";
  progress?: { done: number; total: number; stage?: string; updatedAt?: string; heartbeatAt?: string; jobStatus?: string };
  error?: string;
  generationComplete?: boolean;
  readingFeeCharged?: number;
  selectedMode?: KnowledgeCardReadingMode;
  onAnalyze: (constraints: KnowledgeCardReadingConstraints) => void | Promise<void>;
  onSelect: (mode: KnowledgeCardReadingMode) => void | Promise<void>;
  onGenerate: (mode: KnowledgeCardReadingMode) => void | Promise<void>;
  onResume?: () => void | Promise<void>;
};

const labels = { concise: "精简", balanced: "均衡", complete: "完整" };
const button = "rounded-lg border border-violet-300/30 px-3 py-2 text-sm disabled:opacity-40";

/** 方案与报价来自完整阅读结果；本组件不补写内容，也不重新分页。 */
export function KnowledgeCardReadingPlans(props: KnowledgeCardReadingPlansProps) {
  const constraints = props.constraints ?? {};
  const [localMode, setLocalMode] = useState<KnowledgeCardReadingMode>("concise");
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [localError, setLocalError] = useState("");
  const [working, setWorking] = useState(false);
  const [submissionUncertain, setSubmissionUncertain] = useState(false);
  const lock = useRef(false);
  let computed: ReturnType<typeof quoteKnowledgeCardReadingPlan> | undefined;
  let invalid = false;
  try {
    if (props.plan) computed = quoteKnowledgeCardReadingPlan(props.plan, constraints);
    if (props.quote && JSON.stringify(props.quote) !== JSON.stringify(computed)) invalid = true;
  } catch { invalid = true; }
  const mode = props.plan?.presentation === "single" ? "complete" : props.selectedMode ?? localMode;
  const option = props.plan?.options.find(item => item.mode === mode);
  const price = computed?.options.find(item => item.mode === mode);
  const busy = working || submissionUncertain || ["reading", "planning", "generating"].includes(props.phase);
  const identity = JSON.stringify([props.plan, constraints, computed, mode, props.phase]);
  useEffect(() => { setConfirmation(null); }, [identity]);
  const canGenerate = props.phase === "ready" && !busy && !invalid && Boolean(option && price?.selectable);
  const run = async (action: () => void | Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setWorking(true);
    setLocalError("");
    try { await action(); }
    catch { setLocalError("本次操作未完成，请先查询已有任务；不要重复提交生成。"); }
    finally { lock.current = false; setWorking(false); }
  };
  return <section aria-label="全文阅读与知识卡方案" className="space-y-2 text-slate-200">
    {(props.progress || props.phase === "failed" || props.error || (props.phase === "ready" && props.plan && !invalid)) && <KnowledgeCardReadingProgress progress={props.progress ?? { done: 0, total: 0 }} phase={props.phase} jobStatus={props.progress?.jobStatus} error={props.error} successLabel={props.generationComplete ? "生成成功" : props.phase === "ready" ? "读取成功" : undefined} />}
    {!props.progress && props.phase !== "failed" && !props.error && props.phase !== "ready" && <p role="status">{["reading", "planning", "generating"].includes(props.phase) ? "处理中…" : null}</p>}
    {props.onResume && (busy || props.phase === "failed" || props.error || localError) && <button type="button" className={button} disabled={working} onClick={() => void run(async () => { await props.onResume!(); setSubmissionUncertain(false); })}>查询已有任务</button>}
    {localError && <p role="alert">{localError}</p>}
    {invalid && <p role="alert">方案或报价无法核对，请重新获取方案，当前不能生成。</p>}
    {computed?.reason && <div><p role="alert">原方案不符合预算或页数要求。</p><button type="button" className={button} disabled={busy} onClick={() => void run(() => props.onAnalyze({}))}>重新获取方案</button></div>}
    {props.plan && !invalid && <>
      {<div role="group" aria-label="选择方案" className="flex flex-wrap gap-2">
        {computed?.options.map(item => <button type="button" key={item.mode} aria-pressed={mode === item.mode} disabled={busy} className={button} onClick={() => { setLocalMode(item.mode); setConfirmation(null); void run(() => props.onSelect(item.mode)); }}>
          {labels[item.mode]} {item.pageCount}页
        </button>)}
      </div>}
      {option && price && <article className="space-y-3">
        <h3 className="sr-only">{props.plan.presentation === "single" ? "完整四页方案" : `${labels[mode]}方案`} · {price.pageCount}页 · {price.credits}积分 · 4K</h3>
        <button type="button" className={button} disabled={!canGenerate} onClick={() => setConfirmation(identity)}>生成 · {price.credits}积分</button>
        {confirmation === identity && canGenerate && <div role="region" aria-label="确认生成方案" className="space-y-3 rounded-lg border border-amber-300/40 p-3">
          <p>确认生成此方案全部{price.pageCount}页4K知识卡，报价共{price.credits}积分？</p>
          <button type="button" className={button} onClick={() => { setConfirmation(null); void run(async () => { try { await props.onGenerate(mode); } catch (error) { setSubmissionUncertain(true); throw error; } }); }}>确认生成 · {price.credits}积分</button>
          <button type="button" className={button} onClick={() => setConfirmation(null)}>取消</button>
        </div>}
      </article>}
    </>}
  </section>;
}
