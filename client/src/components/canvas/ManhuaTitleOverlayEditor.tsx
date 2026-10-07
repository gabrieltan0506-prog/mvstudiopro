import { useEffect, useRef, useState } from "react";
import type { AdvisorEffectsAction, AdvisorEffectsControl, AdvisorEffectsRegistration } from "@shared/manhuaAdvisorEffects";
import { advisorWorkflowRevision } from "@/lib/manhuaAdvisorWorkflowPlan";
import { gcsTransferUrl } from "@/lib/gcsTransfer";
import { maskMediaProviderDetails } from "@/lib/maskMediaUrls";
import { compileManhuaTitle, type ManhuaTitlePayload } from "@/lib/manhuaTitleOverlay";

/** Keyed by source by the subtitle card; the existing burn_subtitle callback owns the task. */
export function ManhuaTitleOverlayEditor({ source, busy, onSubmit, scopeKey = "", initialSettings, onAdvisorEffectsControl }: {
  source: string;
  busy: boolean;
  onSubmit: (title: ManhuaTitlePayload) => Promise<string | void>;
  scopeKey?: string;
  initialSettings?: AdvisorEffectsAction["titleSettings"];
  onAdvisorEffectsControl?: AdvisorEffectsRegistration;
}) {
  const [text, setText] = useState(initialSettings?.text || "");
  const [startSec, setStartSec] = useState(initialSettings?.startSec ?? 0);
  const [endSec, setEndSec] = useState(initialSettings?.endSec ?? 2);
  const [fontSize, setFontSize] = useState(initialSettings?.fontSize ?? 32);
  const [alignment, setAlignment] = useState<number>(initialSettings?.alignment ?? 5);
  const [durationSec, setDurationSec] = useState<number>();
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const gate = useRef(false);
  let payload: ManhuaTitlePayload | undefined;
  let validation = "";
  try { payload = compileManhuaTitle({ text, startSec, endSec, fontSize, alignment }, durationSec); }
  catch (caught) { validation = caught instanceof Error ? caught.message : "请检查标题"; }
  const locked = busy || submitting;
  const submit = async (advisor?: { signal: AbortSignal }) => {
    if (gate.current || locked || !payload || !source) return;
    advisor?.signal.throwIfAborted();
    gate.current = true; setSubmitting(true); setError(""); setReceipt("");
    try { const jobId = await onSubmit(payload); setReceipt("标题任务已提交，结果请查看后期任务；原片保留。"); return jobId; }
    catch (caught) { setError(maskMediaProviderDetails(caught instanceof Error ? caught.message : "标题提交失败")); if (advisor) throw caught; }
    finally { gate.current = false; setSubmitting(false); }
  };
  const sourceKey = advisorWorkflowRevision([scopeKey, source, text, startSec, endSec, fontSize, alignment]);
  const currentKey = useRef(sourceKey); currentKey.current = sourceKey;
  const control = useRef<AdvisorEffectsControl>(async () => "");
  control.current = async (action, signal) => {
    signal.throwIfAborted();
    if (action.tool !== "title") throw new Error("此控件只处理片内标题");
    if (action.operation === "inspect") return JSON.stringify({ sourceKey, titleSettings: { text, startSec, endSec, fontSize, alignment }, durationSec, valid: Boolean(payload && source), validation, busy: locked });
    const assertCurrent = () => { signal.throwIfAborted(); if (!action.sourceKey || action.sourceKey !== currentKey.current) throw new Error("标题或原片已变化，请重新inspect"); };
    assertCurrent(); if (locked || gate.current) throw new Error("标题正在提交，请查看原任务");
    if (action.operation === "configure") {
      const settings = action.titleSettings;
      if (!settings) throw new Error("缺少标题设置");
      compileManhuaTitle(settings, durationSec ?? settings.endSec);
      if (!window.confirm("将顾问标题设置填入当前字幕卡？此步不合成，原片保留。")) return "用户取消标题设置。";
      assertCurrent(); setText(settings.text); setStartSec(settings.startSec); setEndSec(settings.endSec); setFontSize(settings.fontSize); setAlignment(settings.alignment); setError(""); setReceipt("");
      return "标题设置已填入原卡，尚未合成；请重新inspect后提交。";
    }
    if (action.operation !== "submit") throw new Error("标题仅支持读取、填参和原入口提交");
    if (!payload || !source) throw new Error(validation || "请先选择原片并填写标题");
    if (!window.confirm("按当前标题、出现时段和位置合成新版本？原片保留。")) return "用户取消标题合成。";
    assertCurrent(); const jobId = await submit({ signal }); if (!jobId) throw new Error("尚未取得标题任务编号，请查看原任务，不自动重试");
    return JSON.stringify({ jobId, status: "queued", note: "尚未验收标题成片" });
  };
  useEffect(() => { onAdvisorEffectsControl?.(scopeKey, "title", (...args) => control.current(...args)); return () => onAdvisorEffectsControl?.(scopeKey, "title", null); }, [scopeKey, onAdvisorEffectsControl]);
  const inputClass = "rounded border border-white/15 bg-black/20 p-2 text-xs";
  return <details className="mt-4 rounded border border-cyan-300/20 p-3" data-manhua-title-editor>
    <summary className="cursor-pointer text-sm font-medium">添加片内标题 · 0积分</summary>
    <p className="mt-2 text-xs text-white/60">使用上方所选成片和现有字幕合成任务。填写标题出现时段，另存带标题版本；不自动修改对白。</p>
    {source ? <video aria-label="标题原片预览" controls playsInline preload="metadata" src={gcsTransferUrl(source)} className="mt-2 max-h-56 w-full object-contain" onLoadedMetadata={event => { setDurationSec(event.currentTarget.duration); setError(""); }} onError={() => { setDurationSec(undefined); setError("无法读取原片，请重新选择可播放的成片"); }} /> : <p className="mt-2 text-xs text-amber-200">请先在上方选择成片。</p>}
    <label className="mt-2 block text-xs">标题文字<textarea aria-label="片内标题文字" maxLength={120} rows={2} value={text} disabled={locked} onChange={event => setText(event.target.value)} placeholder="例如：第三回 · 剑出无声" className={`${inputClass} mt-1 w-full`} /></label>
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><label>开始秒 <input aria-label="标题开始秒" type="number" min={0} max={durationSec} step={0.1} value={startSec} disabled={locked} onChange={event => setStartSec(Number(event.target.value))} className={`${inputClass} w-20`} /></label><label>结束秒 <input aria-label="标题结束秒" type="number" min={0} max={durationSec} step={0.1} value={endSec} disabled={locked} onChange={event => setEndSec(Number(event.target.value))} className={`${inputClass} w-20`} /></label>{durationSec && Number.isFinite(durationSec) ? <span className="text-white/50">原片 {durationSec.toFixed(2)} 秒</span> : null}</div>
    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs"><label>位置 <select aria-label="标题位置" value={alignment} disabled={locked} onChange={event => setAlignment(Number(event.target.value))} className={inputClass}><option value={8}>顶部居中</option><option value={5}>画面正中</option><option value={2}>底部居中</option></select></label><label>字号 <input aria-label="标题字号" type="number" min={8} max={96} step={1} value={fontSize} disabled={locked} onChange={event => setFontSize(Number(event.target.value))} className={`${inputClass} w-20`} /></label></div>
    <p className="mt-2 text-xs text-white/50">白字细黑边，实际字号按字幕渲染画布适配。此处预览为原片，标题结果需在合成完成后查看。尚未线上验收。</p>
    {validation ? <p className="mt-2 text-xs text-amber-100/70">{validation}</p> : null}
    <button type="button" disabled={locked || !payload || !source} onClick={() => void submit()} className="mt-2 rounded border border-cyan-300/30 px-3 py-2 text-xs disabled:opacity-40">{submitting ? "正在提交标题…" : "合成标题版本 · 0积分"}</button>
    {error ? <p role="alert" className="mt-2 text-xs text-amber-200">{error}</p> : null}
    {receipt ? <p role="status" className="mt-2 text-xs text-white/65">{receipt}</p> : null}
  </details>;
}
