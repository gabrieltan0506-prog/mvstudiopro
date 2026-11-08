import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { MARKETING_PLAN_LABELS, MARKETING_PLAN_STEPS, adoptMarketingPlan, marketingPlanReady,
  type MarketingPlanResult, type MarketingPlanStep } from "@shared/marketingPlan";

import { publicMarketingPlan, marketingPublicError } from "@shared/marketingPlanDisplay";

const stateLabels = { pending: "待开始", running: "生成中", succeeded: "已保存", failed: "需要恢复", unknown: "回执待核对" };
const buttonStyle = "rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40";

/** 三份内容使用服务端原始结果；第三份独立呈现，不覆盖两份模型原文。 */
export function MarketingPlanResults({ result: rawResult, busy, stale, onRetry, onApply }: {
  result: MarketingPlanResult; busy: boolean; stale: boolean;
  onRetry: (step: MarketingPlanStep | "settle" | "resume") => void;
  onApply: (brief: string) => void;
}) {
  const result = publicMarketingPlan(rawResult);
  const [tab, setTab] = useState<MarketingPlanStep>("integrated");
  const [brief, setBrief] = useState(result.steps.integrated.adoptionBrief || "");
  const [message, setMessage] = useState("");
  useEffect(() => setBrief(result.steps.integrated.adoptionBrief || ""), [result.steps.integrated.adoptionBrief]);
  const selected = result.steps[tab];
  return <div className="mt-4 space-y-3">
    <div className="grid gap-2 sm:grid-cols-3" role="tablist" aria-label="营销方案三份结果">
      {MARKETING_PLAN_STEPS.map(step => <button key={step} type="button" role="tab" aria-selected={tab === step}
        className={`${buttonStyle} text-left ${tab === step ? "border-cyan-300/70 bg-cyan-400/10 text-cyan-100" : "text-slate-300"}`}
        onClick={() => setTab(step)}>{MARKETING_PLAN_LABELS[step]}<span className="mt-1 block text-xs opacity-65">{stateLabels[result.steps[step].status]}</span></button>)}
    </div>
    <div role="tabpanel" aria-label={MARKETING_PLAN_LABELS[tab]} className="rounded-xl border border-white/10 bg-black/20 p-4">
      {selected.status !== "succeeded" && <p className="text-sm text-amber-200">{selected.error || (tab === "integrated" ? "两份原稿保存后才开始整合。" : stateLabels[selected.status])}</p>}
      {selected.text && <div className="mt-2 max-h-[34rem] overflow-auto whitespace-pre-wrap break-words text-sm leading-7 text-slate-200">{selected.text}</div>}
      {selected.text && <button type="button" className={`${buttonStyle} mt-3`} onClick={async () => {
        try { await navigator.clipboard.writeText(selected.text!); setMessage("已复制当前这份内容"); }
        catch { setMessage("复制失败，可直接选中文字复制。"); }
      }}>复制这份内容</button>}
      {["failed", "unknown", "running"].includes(selected.status) && !busy && <button type="button" className={`${buttonStyle} ml-2 mt-3`} onClick={() => onRetry(tab)}>仅重试{MARKETING_PLAN_LABELS[tab]}</button>}
    </div>
    {result.billing === "failed" && <div role="alert" className="text-sm text-amber-200">{result.billingError}<button className={`${buttonStyle} ml-2`} type="button" disabled={busy} onClick={() => onRetry("settle")}>仅重试结算</button></div>}
    {marketingPlanReady(result) && <div className="rounded-xl border border-cyan-300/25 p-4">
      <label className="text-sm font-semibold" htmlFor="marketing-adoption-brief">带入选题与内容制作的方案摘要（可修改）</label>
      <textarea id="marketing-adoption-brief" value={brief} onChange={event => setBrief(event.target.value)} maxLength={3000} rows={7}
        className="mt-2 w-full rounded-lg border border-white/20 bg-black/20 p-3 text-sm leading-6" />
      <p className="my-2 text-xs text-slate-400">采用后与原需求一起进入选题、文案和制作；完整方案仍保留在上方。不自动生成封面、视频或发布。</p>
      {stale && <p role="status" className="mb-2 text-sm text-amber-200">需求已变化。这份方案对应旧需求，可查看原文；重新分析后再采用。</p>}
      <button type="button" className={`${buttonStyle} bg-cyan-400/15`} disabled={busy || stale || brief.trim().length < 20}
        onClick={() => onApply(brief)}>采用方案，继续选题与制作</button>
    </div>}
    {message && <p role="status" className="text-xs text-cyan-200">{message}</p>}
  </div>;
}

export function MarketingPlanPanel({ value, onApply, userKey }: { value: string; onApply: (next: string) => void; userKey: string | null }) {
  const [jobId, setJobId] = useState<string>();
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const quota = trpc.mvAnalysis.platformMarketingPlanQuota.useQuery({ scope: userKey || "anonymous" }, { enabled: Boolean(userKey), retry: false });
  const query = trpc.mvAnalysis.getPlatformMarketingPlan.useQuery({ jobId, scope: userKey || "anonymous" }, {
    enabled: Boolean(userKey), retry: false,
    refetchInterval: query => ["queued", "running"].includes(query.state.data?.status || "") ? 2000 : false,
  });
  const generate = trpc.mvAnalysis.enqueuePlatformMarketingPlan.useMutation();
  const retry = trpc.mvAnalysis.retryPlatformMarketingPlan.useMutation();
  const saved = query.data;
  const running = saved?.status === "queued" || saved?.status === "running";
  const busy = generate.isPending || retry.isPending || running;
  const fail = (error: unknown) => setMessage(marketingPublicError(error));
  const run = async () => {
    if (lock.current || busy || !quota.data || !userKey) return;
    lock.current = true; setMessage("");
    try {
      const response = await generate.mutateAsync({ context: value.trim(), expectedCredits: quota.data.nextCredits });
      setJobId(response.jobId);
      await query.refetch();
      setMessage(response.reused ? "已找回相同需求的原任务，没有重复生成。" : "任务已保存，可离开后回来查看。两份原稿分别保存，再生成整合方案。");
    } catch (error) { fail(error); await quota.refetch(); }
    finally { lock.current = false; }
  };
  const retryStep = async (step: MarketingPlanStep | "settle" | "resume") => {
    if (lock.current || busy || !saved) return;
    lock.current = true; setMessage("");
    try { await retry.mutateAsync({ jobId: saved.jobId, step }); await query.refetch(); }
    catch (error) { fail(error); }
    finally { lock.current = false; }
  };
  useEffect(() => { if (saved?.result.billing === "succeeded") void quota.refetch(); }, [saved?.jobId, saved?.result.billing]);
  const lengthOk = value.trim().length >= 8 && value.trim().length <= 8000;
  return <section className="mt-4 rounded-2xl border border-cyan-300/25 bg-[#131024] p-4 text-slate-100" aria-label="营销分析与推广方案">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-base font-bold">从需求到营销推广方案</h3><p className="mt-1 text-xs text-slate-400">两份独立创意，再整理成一份方案；分清事实、假设和行动。</p></div>
      <button type="button" className={`${buttonStyle} border-cyan-300/50 bg-cyan-400/15`} disabled={!userKey || busy || !quota.data || query.isLoading || !lengthOk} onClick={() => void run()}>
        {busy ? "方案生成中…" : "分析需求，生成推广方案"}{quota.data ? ` · ${quota.data.nextCredits === 0 ? "本次免费" : `${quota.data.nextCredits}积分`}` : ""}</button>
    </div>
    <p className="mt-2 text-xs leading-5 text-slate-400">先生成两份独立创意，再合并重复建议并保留不同思路。三份齐备后按显示额度结算一次，失败恢复复用成功原稿。创意覆盖选题、封面、正文/脚本、制作和发布建议。</p>
    {!userKey && <p className="mt-2 text-sm text-amber-200">登录后可生成并保存方案。</p>}
    {userKey && !quota.data && <p role="alert" className="mt-2 text-sm text-amber-200">{quota.isError ? "额度读取失败，暂不提交。" : "正在读取本次额度…"}<button className="ml-2 underline" type="button" onClick={() => void quota.refetch()}>刷新额度</button></p>}
    {!lengthOk && value.trim() && <p className="mt-2 text-xs text-amber-200">需求须为8至8000字，不会截断后提交。</p>}
    {query.isError && <p role="alert" className="mt-2 text-sm text-amber-200">读取方案失败，原任务不会被重新提交。<button type="button" onClick={() => void query.refetch()} className="ml-2 underline">重新读取</button></p>}
    {saved && <MarketingPlanResults key={saved.jobId} result={saved.result} busy={busy} stale={saved.result.context !== value.trim()}
      onRetry={step => void retryStep(step)} onApply={brief => {
        const adopted = adoptMarketingPlan(value, brief);
        if (adopted.error) setMessage(adopted.error);
        else { onApply(adopted.value); setMessage("已保留原需求并加入方案摘要，下一步选择选题。完整三份方案仍在当前任务中。"); }
      }} />}
    {saved?.status === "failed" && !busy && <button type="button" className={`${buttonStyle} mt-3`} onClick={() => void retryStep("resume")}>恢复任务状态（不重发已知成功请求）</button>}
    {message && <p role="status" className="mt-3 text-sm text-cyan-200">{message}</p>}
  </section>;
}
