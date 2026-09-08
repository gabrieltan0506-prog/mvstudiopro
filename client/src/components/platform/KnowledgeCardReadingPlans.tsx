import { useEffect, useRef, useState } from "react";
import {
  knowledgeCardReadingConstraintsSchema, quoteKnowledgeCardReadingPlan,
  type KnowledgeCardReadingConstraints, type KnowledgeCardReadingMode, type KnowledgeCardReadingPlan,
} from "@shared/knowledgeCardReadingPlan";

export type KnowledgeCardReadingPlansProps = {
  plan?: KnowledgeCardReadingPlan;
  constraints?: KnowledgeCardReadingConstraints;
  quote?: ReturnType<typeof quoteKnowledgeCardReadingPlan>;
  phase: "idle" | "reading" | "planning" | "ready" | "generating" | "failed";
  progress?: { done: number; total: number };
  error?: string;
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
  const [budget, setBudget] = useState(String(constraints.budgetCredits ?? ""));
  const [target, setTarget] = useState(String(constraints.targetPages ?? ""));
  const [localMode, setLocalMode] = useState<KnowledgeCardReadingMode>("concise");
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [localError, setLocalError] = useState("");
  const [working, setWorking] = useState(false);
  const [submissionUncertain, setSubmissionUncertain] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    setBudget(String(constraints.budgetCredits ?? ""));
    setTarget(String(constraints.targetPages ?? ""));
  }, [constraints.budgetCredits, constraints.targetPages]);
  let computed: ReturnType<typeof quoteKnowledgeCardReadingPlan> | undefined;
  let invalid = false;
  try {
    if (props.plan) computed = quoteKnowledgeCardReadingPlan(props.plan, constraints);
    if (props.quote && JSON.stringify(props.quote) !== JSON.stringify(computed)) invalid = true;
  } catch { invalid = true; }
  const mode = props.plan?.presentation === "single" ? "complete" : props.selectedMode ?? localMode;
  const option = props.plan?.options.find(item => item.mode === mode);
  const price = computed?.options.find(item => item.mode === mode);
  const inputChanged = budget !== String(constraints.budgetCredits ?? "") || target !== String(constraints.targetPages ?? "");
  const busy = working || submissionUncertain || ["reading", "planning", "generating"].includes(props.phase);
  const identity = JSON.stringify([props.plan, constraints, computed, mode, props.phase, budget, target]);
  useEffect(() => { setConfirmation(null); }, [identity]);
  const canGenerate = props.phase === "ready" && !busy && !invalid && !inputChanged && Boolean(option && price?.selectable);
  const run = async (action: () => void | Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setWorking(true);
    setLocalError("");
    try { await action(); }
    catch { setLocalError("本次操作未完成，请先查询已有任务；不要重复提交生成。"); }
    finally { lock.current = false; setWorking(false); }
  };
  const analyze = () => {
    const parsed = knowledgeCardReadingConstraintsSchema.safeParse({
      ...(budget.trim() ? { budgetCredits: Number(budget) } : {}),
      ...(target.trim() ? { targetPages: Number(target) } : {}),
    });
    if (!parsed.success) { setLocalError("请填写非负整数预算；目标页数须为4至80之间的整数。"); return; }
    setConfirmation(null);
    void run(() => props.onAnalyze(parsed.data));
  };
  return <section aria-label="全文阅读与知识卡方案" className="space-y-4 rounded-xl border border-violet-300/20 p-4 text-slate-200">
    <p className="text-sm">先完整阅读图文，再查看方案与报价。读取单元：PDF和图片按页，纯文字按段；知识卡最少4页，确认方案后才开始生成图片。</p>
    {props.readingFeeCharged !== undefined && <p className="text-sm">本次阅读提炼已收{props.readingFeeCharged}积分；下方预算与报价仅计算后续生图费用。</p>}
    <div className="flex flex-wrap gap-3">
      <label className="text-sm">生图预算上限（积分，可选）<input aria-label="预算上限" type="number" min="0" step="1" value={budget} disabled={busy} onChange={e => { setBudget(e.target.value); setConfirmation(null); }} className="ml-2 w-28 rounded bg-slate-900 p-2" /></label>
      <label className="text-sm">目标页数（可选）<input aria-label="目标页数" type="number" min="4" max="80" step="1" value={target} disabled={busy} onChange={e => { setTarget(e.target.value); setConfirmation(null); }} className="ml-2 w-24 rounded bg-slate-900 p-2" /></label>
      <button type="button" className={button} disabled={busy} onClick={analyze}>{props.plan ? "按要求重新规划" : "完整阅读并规划"}</button>
    </div>
    <div role="status" className="text-sm">
      {props.phase === "reading" ? `正在完整阅读图文${props.progress ? `：${props.progress.done}/${props.progress.total}个读取单元` : "…"}` : props.phase === "planning" ? "全文阅读后正在整理方案…" : props.phase === "generating" ? "正在生成已确认的方案…" : !props.plan ? "尚未生成方案，暂无页数与报价。" : null}
    </div>
    {(props.phase === "failed" || props.error) && <p role="alert">本次处理未成功。已有材料和结果请保留；可查询原任务后继续。</p>}
    {props.onResume && <button type="button" className={button} disabled={working} onClick={() => void run(async () => { await props.onResume!(); setSubmissionUncertain(false); })}>查询已有任务</button>}
    {localError && <p role="alert">{localError}</p>}
    {invalid && <p role="alert">方案或报价无法核对，请重新获取方案，当前不能生成。</p>}
    {computed?.reason && <p role="alert">{computed.reason}</p>}
    {inputChanged && <p className="text-sm">预算或页数已调整，请先重新规划并获取报价。</p>}
    {props.plan && !invalid && <>
      <p>{props.plan.reason}</p>
      {props.plan.presentation === "options" && <div role="group" aria-label="选择方案" className="flex flex-wrap gap-2">
        {computed?.options.map(item => <button type="button" key={item.mode} aria-pressed={mode === item.mode} disabled={busy} className={button} onClick={() => { setLocalMode(item.mode); setConfirmation(null); void run(() => props.onSelect(item.mode)); }}>
          {labels[item.mode]} · {item.pageCount}页 · {item.credits}积分
        </button>)}
      </div>}
      {option && price && <article className="space-y-3">
        <h3 className="font-semibold">{props.plan.presentation === "single" ? "完整四页方案" : `${labels[mode]}方案`} · {price.pageCount}页 · {price.credits}积分 · 4K</h3>
        <p>{option.reason}</p>
        <p>保留：{option.kept.join("；")}</p>
        <p>省略：{option.omitted.length ? option.omitted.join("；") : "无"}</p>
        {!!option.sourceExclusions?.length && <details><summary>未采用的原页／文字段与原因</summary><ul>{option.sourceExclusions.map(item => <li key={item.sourcePageId}>{item.sourcePageId}：{item.reason}</li>)}</ul></details>}
        {option.pages.map((page, index) => <details key={page.pageId} className="rounded border border-white/10 p-3">
          <summary>第{index + 1}页 · {page.title}</summary>
          <p>{page.brief}</p><p>来源原页／文字段：{page.sourcePageIds.join("、")}</p><p>图文安排：{page.visualDirections}</p>
        </details>)}
        <button type="button" className={button} disabled={!canGenerate} onClick={() => setConfirmation(identity)}>生成此方案 · {price.pageCount}页 · {price.credits}积分</button>
        {confirmation === identity && canGenerate && <div role="region" aria-label="确认生成方案" className="space-y-3 rounded-lg border border-amber-300/40 p-3">
          <p>确认生成此方案全部{price.pageCount}页4K知识卡，报价共{price.credits}积分？请核对上方逐页内容与取舍。</p>
          <button type="button" className={button} onClick={() => { setConfirmation(null); void run(async () => { try { await props.onGenerate(mode); } catch (error) { setSubmissionUncertain(true); throw error; } }); }}>确认生成 · {price.credits}积分</button>
          <button type="button" className={button} onClick={() => setConfirmation(null)}>取消</button>
        </div>}
      </article>}
    </>}
  </section>;
}
