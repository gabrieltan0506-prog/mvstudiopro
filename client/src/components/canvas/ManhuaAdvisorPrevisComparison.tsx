import { createPortal } from "react-dom";
import { trpc } from "@/lib/trpc";
import { manhuaPrevisMediaUrl } from "@/lib/manhuaPrevisMediaUrl";
import type { PrevisResponse } from "./ManhuaPrevisStudio";
import { useState, useRef, useEffect } from "react";
import { advisorPrevisCandidateSchema, applyAdvisorPrevisPatch, validateAdvisorPrevisReceipt, advisorPrevisTrialSchema, type AdvisorPrevisTrial, type AdvisorPrevisReceipt, type AdvisorPrevisCandidate, type AdvisorPrevisVideoSource, advisorPrevisSpecJson } from "@shared/manhuaAdvisorPrevisEdit";
import { manhuaPrevisSpecSchema, PREVIS_ACTION_LABELS, type ManhuaPrevisSpec } from "@shared/manhuaPrevis";

function Configuration({ spec }: { spec: ManhuaPrevisSpec }) {
  return <div className="space-y-3 text-xs leading-5">
    {spec.piggyback?.setDown && <p>完整放下：{spec.piggyback.setDown.startSec}秒开始降低 → {spec.piggyback.setDown.groundSec}秒落地坐稳 → {spec.piggyback.setDown.releaseSec}秒松手 → {spec.piggyback.setDown.endSec}秒起身；乘员留在原地。</p>}
    {spec.interactions?.filter(e=>e.kind==="support_walk").map(e=><p key={e.id}>搀扶：{spec.actors.find(a=>a.id===e.actorId)?.nameZh}扶着{spec.actors.find(a=>a.id===e.targetActorId)?.nameZh}；{e.startSec}秒抬手，{e.contactSec}秒扶稳，保持搭肩与扶臂接触至{e.endSec}秒。</p>)}
    <ol className="list-decimal pl-4">{spec.cameras.map((c, i) => <li key={i} className="mb-2">
      <b>{c.startSec.toFixed(2)}—{c.endSec.toFixed(2)}秒 · {c.lens}{c.endLens && c.endLens !== c.lens ? `→${c.endLens}` : ""}mm</b>
      <p>机位 {c.position.join("，")}{c.endPosition ? ` → ${c.endPosition.join("，")}` : ""}；看向 {c.target.join("，")}{c.endTarget ? ` → ${c.endTarget.join("，")}` : ""}</p>
      {!!c.orbitDeg && <p>环绕 {c.orbitDeg}°{c.orbitRise ? ` · ${c.orbitRise > 0 ? "升高" : "下沉"}${Math.abs(c.orbitRise)}米` : ""}</p>}
    </li>)}</ol>
    {spec.actors.map(a => <section key={a.id} className="border-t border-white/10 pt-2"><b>{a.nameZh}</b>
      <p>路径：{a.motionRoute?.map(n => `${n.timeSec.toFixed(2)}秒 (${n.position.join("，")}) 朝向${n.facingDeg}°`).join(" → ") || `${a.start.join("，")} → ${a.end.join("，")}`}</p>
      {a.hitReaction && <p>受击：{a.hitReaction.startSec}—{a.hitReaction.endSec}秒，{a.hitReaction.contactSec}秒受击；出手者：{spec.actors.find(b=>b.id===a.hitReaction!.sourceActorId)?.nameZh}</p>}
      <p>动作：{a.actions.map(v => `${v.startSec.toFixed(2)}—${v.endSec.toFixed(2)}秒 ${PREVIS_ACTION_LABELS[v.kind]}`).join("；") || "无独立动作"}</p>
    </section>)}
  </div>;
}
export function ManhuaAdvisorPrevisComparison({ candidate, storageKey, autoStart, previewHost, disabled, onPrepare, onApply, onRevise, onPreviewReady }: {
  previewHost?: HTMLElement | null;
  candidate: AdvisorPrevisCandidate; storageKey: string | null; autoStart: boolean; disabled?: boolean;
  onRevise?: () => void;
  onPreviewReady?: (source: AdvisorPrevisVideoSource) => void;
  onPrepare?: (value: AdvisorPrevisCandidate) => AdvisorPrevisTrial;
  onApply?: (trial: AdvisorPrevisTrial, receipt: AdvisorPrevisReceipt) => boolean;
}) {
  const submit = trpc.manhuaPrevis.submit.useMutation({ retry: false });
  const utils = trpc.useUtils();
  const [initial] = useState(() => {
    try {
      const id = storageKey && localStorage.getItem(storageKey);
      const raw = id && localStorage.getItem(`${storageKey}:${id}`);
      const trial = raw ? advisorPrevisTrialSchema.parse(JSON.parse(raw)) : null;
      return { trial: trial && JSON.stringify(trial.candidate) === JSON.stringify(advisorPrevisCandidateSchema.parse(candidate)) ? trial : null, issue: "" };
    } catch { return { trial: null, issue: "上次试看记录无法读取，已停止自动提交，原记录保留。" }; }
  });
  const [trial, setTrial] = useState<AdvisorPrevisTrial | null>(initial.trial);
  const [receipt, setReceipt] = useState<AdvisorPrevisReceipt | null>(null);
  const [status, setStatus] = useState(initial.trial ? "正在恢复原试看任务" : "调度提案已准备好，可以继续修改或生成试看");
  const [error, setError] = useState(initial.issue);
  const [watched, setWatched] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [applied, setApplied] = useState(false);
  const busy = useRef(false), started = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  let before: ManhuaPrevisSpec | undefined, after: ManhuaPrevisSpec | undefined, issue = "";
  try { before = manhuaPrevisSpecSchema.parse(JSON.parse(candidate.target.specJson)); after = applyAdvisorPrevisPatch(before, candidate.patch); }
  catch (e) { issue = e instanceof Error ? e.message : "候选未通过检查"; }
  const currentHost = previewHost?.dataset.clipId === candidate.target.clipId ? previewHost : null;
  function consume(value: PrevisResponse | null, active: AdvisorPrevisTrial) {
    if (!alive.current) return;
    if (!value) { setStatus("暂未查到原请求，请确认原请求；不会自动新建。"); return; }
    if (value.status === "succeeded") {
      const verified = validateAdvisorPrevisReceipt(active.request, value);
      onPreviewReady?.({ target: active.candidate.target, requestId: active.request.requestId, specJson: advisorPrevisSpecJson(active.request.spec) });
      setReceipt(verified); setStatus("试看已生成，工作流尚未修改"); setError("");
    } else if (value.status === "failed") { setStatus("试看失败，工作流未修改"); setError(value.error || "请调整需求后重新咨询"); }
    else { setStatus(value.status === "queued" ? "独立试看排队中，工作流未修改" : "独立试看渲染中，工作流未修改"); setError(""); }
  }
  async function start(existing?: AdvisorPrevisTrial) {
    if (busy.current || disabled || issue || initial.issue) return;
    if (!currentHost) { setError("请在当前片段的3D页面内生成试看，视频将显示在本页预览。"); return; }
    if (!storageKey || !onPrepare) { setError("请先确认当前项目并从本段白模打开创作顾问，再生成试看。"); return; }
    busy.current = true;
    try {
      const next = existing || onPrepare(candidate);
      // 只保存顾问试看恢复记录；不调用工作流写回或采用。
      localStorage.setItem(`${storageKey}:${next.request.requestId}`, JSON.stringify(next));
      localStorage.setItem(storageKey, next.request.requestId);
      setTrial(next); setStatus("正在提交独立试看，原场景保持原版本"); setError("");
      consume(await submit.mutateAsync(next.request), next);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "提交结果未确认，请查询原任务"); }
    finally { busy.current = false; }
  }
  useEffect(() => {
    if (!autoStart || started.current || initial.trial || initial.issue || disabled || issue || !currentHost) return;
    started.current = true; void start();
  }, [autoStart, disabled, issue, currentHost]);
  useEffect(() => {
    if (!trial || receipt || !alive.current) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const value = await utils.manhuaPrevis.get.fetch({ requestId: trial.request.requestId }); if (!cancelled) consume(value, trial); if (value?.status === "succeeded" || value?.status === "failed") return; }
      catch { if (!cancelled) setError("查询暂不可用，保留原试看编号，不会新建任务。"); }
      if (!cancelled) timer = setTimeout(poll, 10000);
    };
    void poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [trial?.request.requestId, Boolean(receipt)]);
  async function apply() {
    if (!trial || !receipt || !watched || !reviewed || busy.current || disabled) return;
    busy.current = true;
    try {
      const latest = validateAdvisorPrevisReceipt(trial.request, await utils.manhuaPrevis.get.fetch({ requestId: trial.request.requestId }));
      if (onApply?.(trial, latest)) { setApplied(true); setError(""); }
    } catch (e) { setError(e instanceof Error ? e.message : "原试看回执无法核验，未应用"); }
    finally { busy.current = false; }
  }
  return <section aria-label="白模调度修改对比" className="space-y-3 rounded-xl border border-cyan-300/35 bg-cyan-400/5 p-3">
    <h3 className="font-semibold text-cyan-100">调度提案与试看 · 可反复修改</h3>
    <p className="whitespace-pre-wrap text-sm leading-6">{candidate.patch.summaryZh}</p>
    <p role="status" className="text-sm text-cyan-100">{status}</p>
    {(!storageKey || !onPrepare) && <p role="alert" className="text-xs text-amber-100">请先确认当前项目并从本段白模打开创作顾问。</p>}
    {(issue || error) && <p role="alert" className="text-xs text-amber-100">{issue || error}</p>}
    {currentHost && (trial || error) && createPortal(<section aria-label="3D页面白模视频预览" className="mb-4 space-y-2 rounded-xl border border-cyan-300/40 bg-black/20 p-3">
      <h3 className="font-semibold text-cyan-100">顾问白模试看</h3>
      <p role="status" className="text-sm">{status}</p>
      {trial && <p className="text-xs text-white/70">{trial.request.audio ? `对白 ${trial.request.audio.dialogueCount} 句 · BGM ${trial.request.audio.bgmCount} 条` : "此版本为无声动作试看"}</p>}
      {error && <p role="alert" className="text-sm text-amber-100">{error}</p>}
      {receipt && <video key={receipt.output.requestId} aria-label="顾问独立白模试看" controls playsInline preload="metadata" className="max-h-[60vh] w-full bg-black" src={manhuaPrevisMediaUrl(receipt.output.url)} onPlay={() => setWatched(true)} />}
      <p className="text-xs text-white/60">当前是独立试看，应用前不会改写本段配置；正式视频参考仍需逐帧与常速审片。</p>
    </section>, currentHost)}
    {trial && <p className="text-xs text-white/50">试看编号：{trial.request.requestId}</p>}
    {!issue && !receipt && <button type="button" disabled={disabled || submit.isPending || Boolean(initial.issue) || !storageKey || !onPrepare} onClick={() => void start(trial || undefined)} className="min-h-10 rounded border border-cyan-300/40 px-3 text-sm">{trial ? "确认原试看请求（不新建）" : "按这个方案生成试看"}</button>}
    {before && after && <details><summary className="cursor-pointer py-2 text-sm">查看修改前后 · {before.durationSec}秒 / {before.actors.length}个角色</summary>
      <div className="grid gap-4 md:grid-cols-2"><div><h4 className="mb-2 font-semibold">修改前</h4><Configuration spec={before} /></div><div><h4 className="mb-2 font-semibold text-cyan-200">试看配置</h4><Configuration spec={after} /></div></div>
    </details>}
    {onRevise && <button type="button" onClick={onRevise} className="min-h-10 rounded border border-white/30 px-3 text-sm">继续修改这版方案</button>}
    <p className="text-xs text-white/60">不满意可继续聊天修改。只有点击应用才写入本段配置与试看版本；原配置可撤销。正式视频参考仍需逐帧审片后采用。</p>
    {receipt && !applied && <><label className="flex gap-2 text-xs"><input type="checkbox" checked={reviewed} disabled={!watched} onChange={e => setReviewed(e.target.checked)} />我已观看这版试看，满意并确认应用到本段</label>
      <button type="button" disabled={!watched || !reviewed || disabled || !onApply} onClick={() => void apply()} className="min-h-10 rounded bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">应用这版到工作流</button></>}
    {applied && <p role="status" className="text-sm text-cyan-200">已按你的确认应用，原版本保留，可在本段白模继续审片。</p>}
  </section>;
}
