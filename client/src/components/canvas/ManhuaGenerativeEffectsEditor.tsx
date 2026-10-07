import { useEffect, useRef, useState } from "react";
import type { AdvisorEffectsControl, AdvisorEffectsRegistration } from "@shared/manhuaAdvisorEffects";
import { advisorWorkflowRevision } from "@/lib/manhuaAdvisorWorkflowPlan";
import { Loader2 } from "lucide-react";
import { maskMediaProviderDetails } from "@/lib/maskMediaUrls";
import { compileManhuaGenerativeEffectInstruction, MANHUA_GENERATIVE_EFFECT_PRESETS, type ManhuaGenerativeEffectPresetId } from "@/lib/manhuaGenerativeEffects";

/** Parent keys this form by clip + immutable source identity; the existing handler owns fees, intent and candidates. */
export function ManhuaGenerativeEffectsEditor({ clipBlockId, sourceDurationSec, busy, onSubmit, effectsScopeKey = "", sourceIdentity = clipBlockId, onAdvisorEffectsControl }: {
  clipBlockId: string;
  sourceDurationSec?: number;
  busy?: boolean;
  onSubmit: (clipBlockId: string, instruction: string) => void | Promise<unknown>;
  effectsScopeKey?: string;
  sourceIdentity?: string;
  onAdvisorEffectsControl?: AdvisorEffectsRegistration;
}) {
  const [presetId, setPresetId] = useState<ManhuaGenerativeEffectPresetId>("custom");
  const [instructions, setInstructions] = useState<Record<string, string>>(() => Object.fromEntries(MANHUA_GENERATIVE_EFFECT_PRESETS.map(preset => [preset.id, preset.instruction])));
  const [target, setTarget] = useState("");
  const [useRange, setUseRange] = useState(false);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const gate = useRef(false);
  const preset = MANHUA_GENERATIVE_EFFECT_PRESETS.find(item => item.id === presetId)!;
  const instruction = instructions[presetId] || "";
  let compiled = "";
  let validation = "";
  try { compiled = compileManhuaGenerativeEffectInstruction({ presetId, target, instruction, range: useRange ? { startSec, endSec } : undefined }, sourceDurationSec); }
  catch (caught) { validation = caught instanceof Error ? caught.message : "请核对修改要求"; }
  const locked = busy || submitting;
  const submit = async (advisor?: { signal: AbortSignal }) => {
    if (gate.current || busy || !compiled) return;
    advisor?.signal.throwIfAborted();
    gate.current = true; setSubmitting(true); setError(""); setReceipt("");
    try {
      const result = await onSubmit(clipBlockId, compiled);
      setReceipt(typeof result === "string" ? maskMediaProviderDetails(result) : "已交给原片编辑入口，请核对发送内容与费用；结果请查看当前片段任务与候选。");
      return typeof result === "string" ? maskMediaProviderDetails(result) : "已调用原片编辑入口，请以原任务回执为准；未确认生成完成。";
    } catch (caught) { setError(maskMediaProviderDetails(caught instanceof Error ? caught.message : "编辑回执暂未取得，请查看当前片段原任务")); if (advisor) throw caught; }
    finally { gate.current = false; setSubmitting(false); }
  };
  const sourceKey = advisorWorkflowRevision([effectsScopeKey, sourceIdentity, clipBlockId, presetId, target, instruction, useRange, startSec, endSec]);
  const sourceKeyRef = useRef(sourceKey); sourceKeyRef.current = sourceKey;
  const advisorControl = useRef<AdvisorEffectsControl>(async () => "");
  advisorControl.current = async (action, signal) => {
    signal.throwIfAborted();
    if (action.tool !== "generative") throw new Error("此控件只处理生成式编辑");
    if (action.operation === "inspect") return JSON.stringify({ sourceKey, clipId: clipBlockId, sourceDurationSec, presets: MANHUA_GENERATIVE_EFFECT_PRESETS.map(({ id, label, instruction }) => ({ id, label, instruction })), generativeSettings: { presetId, target, instruction, ...(useRange ? { startSec, endSec } : {}) }, compiled, validation, busy: locked, note: "提交进入原视频编辑确认与费用链，不提供精确遮罩或自动跟踪" });
    const assertCurrent = () => { signal.throwIfAborted(); if (action.clipId !== clipBlockId || !action.sourceKey || action.sourceKey !== sourceKeyRef.current) throw new Error("当前片段、原片版本或编辑草案已变化，请重新inspect"); };
    assertCurrent(); if (locked || gate.current) throw new Error("原视频编辑仍在处理，请查询原任务");
    if (action.operation === "configure") {
      const settings = action.generativeSettings;
      if (!settings) throw new Error("缺少生成式修改设置");
      const hasRange = settings.startSec !== undefined || settings.endSec !== undefined;
      if (hasRange && (settings.startSec === undefined || settings.endSec === undefined)) throw new Error("片内时段需同时填写开始和结束秒位");
      compileManhuaGenerativeEffectInstruction({ ...settings, range: hasRange ? { startSec: settings.startSec!, endSec: settings.endSec! } : undefined }, sourceDurationSec);
      if (!window.confirm("将顾问的生成式修改要求填入当前片段？此步不生成，提交时仍核对实际发送内容与费用。")) return "用户取消生成式修改草案。";
      assertCurrent(); setPresetId(settings.presetId); setTarget(settings.target); setInstructions(previous => ({ ...previous, [settings.presetId]: settings.instruction })); setUseRange(hasRange); if (hasRange) { setStartSec(settings.startSec!); setEndSec(settings.endSec!); } setError(""); setReceipt("");
      return "生成式修改草案已填入原入口；请重新inspect再提交，尚未产生生成费用。";
    }
    if (action.operation !== "submit") throw new Error("生成式结果沿原候选入口采用和查询");
    if (!compiled) throw new Error(validation || "修改草案尚未就绪");
    const receipt = await submit({ signal }); if (!receipt) throw new Error("原视频编辑入口未返回回执，请查看原任务"); return receipt;
  };
  useEffect(() => { onAdvisorEffectsControl?.(effectsScopeKey, "generative", (...args) => advisorControl.current(...args)); return () => onAdvisorEffectsControl?.(effectsScopeKey, "generative", null); }, [effectsScopeKey, onAdvisorEffectsControl]);
  return <section className="space-y-3 rounded-md border border-cyan-400/20 bg-cyan-500/[0.06] p-3" data-manhua-generative-effects>
    <h4 className="text-sm font-semibold text-cyan-50">生成式画面修改</h4>
    <p className="text-xs leading-relaxed text-white/60">预设只填写可编辑的修改草案。提交仍进入原有发送内容与费用确认，原片保留，结果作为候选重新质检。生成式编辑不提供精准遮罩或自动追踪，人物身份、遮挡与音画连续性需回看确认。新预设尚未线上验收。</p>
    <div className="flex flex-wrap gap-2" aria-label="生成式特效预设">{MANHUA_GENERATIVE_EFFECT_PRESETS.map(item => <button key={item.id} type="button" aria-pressed={presetId === item.id} disabled={locked} data-generative-preset={item.id} onClick={() => { setPresetId(item.id); setError(""); setReceipt(""); }} className={`rounded border px-2 py-1.5 text-xs disabled:opacity-40 ${presetId === item.id ? "border-cyan-300/60 bg-cyan-500/20 text-cyan-50" : "border-white/15 text-white/65"}`}>{item.label}</button>)}</div>
    <p className="text-[11px] text-white/50">{preset.hint}</p>
    <label className="block text-xs text-white/65">修改对象{presetId === "custom" ? "（可选）" : "（必填）"}<input aria-label="生成式特效修改对象" maxLength={60} value={target} disabled={locked} onChange={event => setTarget(event.target.value)} placeholder="例如：画面左侧持剑角色，或远处的山体" className="mt-1 w-full rounded border border-white/15 bg-black/30 px-2 py-1.5 text-sm text-white" /></label>
    <div className="flex flex-wrap items-center gap-2 text-xs text-white/65"><label className="flex items-center gap-1.5"><input type="checkbox" checked={useRange} disabled={locked} onChange={event => setUseRange(event.target.checked)} />指定原片中的修改时段</label>{useRange ? <><input aria-label="生成式修改开始秒" type="number" min={0} max={sourceDurationSec} step={0.1} value={startSec} disabled={locked} onChange={event => setStartSec(Number(event.target.value))} className="w-20 rounded border border-white/15 bg-black/30 p-1" /><span>至</span><input aria-label="生成式修改结束秒" type="number" min={0} max={sourceDurationSec} step={0.1} value={endSec} disabled={locked} onChange={event => setEndSec(Number(event.target.value))} className="w-20 rounded border border-white/15 bg-black/30 p-1" /><span>秒</span></> : null}{sourceDurationSec ? <span className="text-white/40">原片 {sourceDurationSec.toFixed(2)} 秒</span> : null}</div>
    <label className="block text-xs text-white/65">修改要求<textarea aria-label="生成式特效修改要求" rows={3} value={instruction} disabled={locked} onChange={event => setInstructions(previous => ({ ...previous, [presetId]: event.target.value }))} placeholder="写清本次需要改变的画面" className="mt-1 w-full rounded border border-white/15 bg-black/30 px-2 py-1.5 text-sm text-white" /></label>
    {compiled ? <div className="rounded border border-white/10 bg-black/15 p-2 text-xs leading-relaxed text-white/60"><p className="mb-1 text-white/40">本次完整修改要求 · {compiled.length}/240字</p><p data-generative-instruction-preview>{compiled}</p></div> : <p className="text-xs text-amber-100/75">{validation}</p>}
    <button type="button" data-manhua-action="video-edit-clip" disabled={locked || !compiled} onClick={() => void submit()} className="rounded border border-cyan-400/35 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-50 disabled:opacity-40">{submitting ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}提交编辑</button>
    {error ? <p role="alert" className="text-xs text-amber-200">{error}</p> : null}
    {receipt ? <p role="status" className="text-xs text-white/65">{receipt}</p> : null}
  </section>;
}
