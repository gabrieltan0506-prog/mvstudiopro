import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { manhuaPrevisSpecSchema, previsSpecKey, type ManhuaPrevisSpec } from "@shared/manhuaPrevis";
import { PREVIS_SCENE_EFFECT_LABELS, type PrevisSceneEffect } from "@shared/manhuaPrevisSceneEffects";

export function createPrevisSceneEffect(kind: PrevisSceneEffect["kind"], actorId: string, id: string, durationSec: number): PrevisSceneEffect {
  const base = { id, actorId };
  switch (kind) {
    case "cape": return { ...base, kind, width: 0.8, length: 1.2, color: "#315FA3", wind: [0.3, 0.6, 0] };
    case "explode": return { ...base, kind, distance: 0.5, startSec: 0, durationSec: Math.min(2, durationSec) };
    case "hologram": return { ...base, kind, color: "#67E8F9", intensity: 1 };
    case "attribute_color": return { ...base, kind, color: "#4F46E5", colorEnd: "#67E8F9" };
    case "label": return { ...base, kind, bone: "head", text: "角色标注", color: "#FFFFFF", offset: [0.8, 0, 0.6], fontSize: 0.12 };
  }
}

const control = "w-full rounded border border-white/15 bg-black/25 px-2 py-1.5 text-xs text-white";
const button = "rounded border border-cyan-300/30 px-2 py-1.5 text-xs text-cyan-50 disabled:opacity-40";

/** Scene effects share the existing previs spec/history/save/render path; this component only edits a draft. */
export function ManhuaPrevisSceneEffectsEditor({ spec, disabled, onApply }: {
  spec: ManhuaPrevisSpec;
  disabled?: boolean;
  onApply: (spec: ManhuaPrevisSpec) => boolean;
}) {
  const [effects, setEffects] = useState<PrevisSceneEffect[]>(() => spec.sceneEffects || []);
  const [baseKey, setBaseKey] = useState(() => previsSpecKey(spec));
  const [error, setError] = useState("");
  const currentKey = previsSpecKey(spec);
  const changedSource = currentKey !== baseKey;
  const dirty = JSON.stringify(effects) !== JSON.stringify(spec.sceneEffects || []);
  const tooLarge = spec.durationSec > 8 || spec.actors.length > 3;
  const replace = (next: PrevisSceneEffect) => setEffects(previous => previous.map(effect => effect.id === next.id ? next : effect));
  const save = () => {
    if (disabled || changedSource) return;
    const parsed = manhuaPrevisSpecSchema.safeParse({ ...spec, sceneEffects: effects.length ? effects : undefined });
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join("；")); return; }
    if (!onApply(parsed.data)) { setError("当前白模配置尚未保存，请处理工作台提示后再试"); return; }
    setBaseKey(previsSpecKey(parsed.data)); setEffects(parsed.data.sceneEffects || []); setError("");
  };
  return <details className="space-y-2 rounded border border-cyan-300/20 p-3" data-previs-scene-effects>
    <summary className="cursor-pointer text-sm font-medium text-cyan-50">场景特效 · 布料、分件、材质与标注</summary>
    <p className="text-xs leading-relaxed text-white/65">效果在本段白模三维场景中渲染，并随采用的白模作为视频生成参考；正式视频仍需审片，不保证逐像素复现。配置保存后，从下方原有入口渲染新候选。尚未线上验收。</p>
    <p className="text-[11px] text-white/50">每段最多4项、3个角色、8秒；披风最多1件。披风与分件需分开预演。同一角色只能选择一种材质效果，同类效果不重复添加。</p>
    {tooLarge ? <p className="text-xs text-amber-200">当前方案为{spec.durationSec}秒、{spec.actors.length}个角色。请先在现有白模方案中调整到支持范围，再增加场景特效；不会自动裁短或删角色。</p> : null}
    {changedSource ? <div className="space-y-1 text-xs text-amber-200"><p>当前白模方案已更新，尚未保存的特效草案仍保留。请载入当前配置后再修改。</p><button type="button" className={button} disabled={disabled} onClick={() => { setEffects(spec.sceneEffects || []); setBaseKey(currentKey); setError(""); }}>载入当前白模配置</button></div> : null}
    <div className="flex flex-wrap gap-2">{(Object.keys(PREVIS_SCENE_EFFECT_LABELS) as PrevisSceneEffect["kind"][]).map(kind => {
      const actor = spec.actors.find(item => kind !== "cape" || item.shape === "human");
      return <button key={kind} type="button" className={button} disabled={disabled || changedSource || tooLarge || effects.length >= 4 || !actor || (kind === "cape" && effects.some(effect => effect.kind === "cape"))} onClick={() => { if (actor) setEffects(previous => [...previous, createPrevisSceneEffect(kind, actor.id, crypto.randomUUID(), spec.durationSec)]); setError(""); }}><Plus className="mr-1 inline h-3 w-3" />{PREVIS_SCENE_EFFECT_LABELS[kind]}</button>;
    })}</div>
    <div className="space-y-2">{effects.map((effect, index) => <fieldset key={effect.id} disabled={disabled || changedSource} className="space-y-2 rounded border border-white/15 bg-black/10 p-2">
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-white">{index + 1}. {PREVIS_SCENE_EFFECT_LABELS[effect.kind]}</span><button type="button" className="text-white/50" aria-label={`移除${PREVIS_SCENE_EFFECT_LABELS[effect.kind]}`} onClick={() => setEffects(previous => previous.filter(item => item.id !== effect.id))}><Trash2 className="h-3.5 w-3.5" /></button></div>
      <label className="block text-[11px] text-white/65">作用角色<select className={`${control} mt-1`} value={effect.actorId} onChange={event => replace({ ...effect, actorId: event.target.value })}>{spec.actors.filter(actor => effect.kind !== "cape" || actor.shape === "human").map(actor => <option key={actor.id} value={actor.id}>{actor.nameZh}</option>)}</select></label>
      {effect.kind === "cape" ? <>
        <div className="grid grid-cols-3 gap-2"><label className="text-[11px] text-white/65">宽度<input aria-label="披风宽度" className={control} type="number" min={0.2} max={2} step={0.05} value={effect.width} onChange={event => replace({ ...effect, width: Number(event.target.value) })} /></label><label className="text-[11px] text-white/65">长度<input aria-label="披风长度" className={control} type="number" min={0.2} max={3} step={0.05} value={effect.length} onChange={event => replace({ ...effect, length: Number(event.target.value) })} /></label><label className="text-[11px] text-white/65">颜色<input className={`${control} h-8`} type="color" value={effect.color} onChange={event => replace({ ...effect, color: event.target.value })} /></label></div>
        <div className="grid grid-cols-3 gap-2">{(["侧向风力", "前后风力", "升降风力"] as const).map((label, axis) => <label key={label} className="text-[11px] text-white/65">{label}<input className={control} type="number" min={-3} max={3} step={0.1} value={effect.wind[axis]} onChange={event => { const wind: [number, number, number] = [...effect.wind]; wind[axis] = Number(event.target.value); replace({ ...effect, wind }); }} /></label>)}</div>
        <p className="text-[11px] text-white/45">使用本段人物挂点与碰撞体模拟披风。保存配置不等于仿真通过，需渲染后检查穿插与运动。</p>
      </> : effect.kind === "explode" ? <>
        <div className="grid grid-cols-3 gap-2">{([{ key: "distance", label: "展开距离", min: 0.05, max: 2, step: 0.05 }, { key: "startSec", label: "开始秒", min: 0, max: 8, step: 0.05 }, { key: "durationSec", label: "持续秒", min: 1 / 24, max: 8, step: 0.05 }] as const).map(field => <label key={field.key} className="text-[11px] text-white/65">{field.label}<input className={control} type="number" min={field.min} max={field.max} step={field.step} value={effect[field.key]} onChange={event => replace({ ...effect, [field.key]: Number(event.target.value) })} /></label>)}</div>
        <p className="text-[11px] text-amber-100/80">只让模型中已有的独立部件沿径向展开。单一网格不支持，不会自动切碎或补造内部结构；实际部件由渲染时核对。</p>
      </> : effect.kind === "hologram" ? <div className="grid grid-cols-2 gap-2"><label className="text-[11px] text-white/65">轮廓颜色<input className={`${control} h-8`} type="color" value={effect.color} onChange={event => replace({ ...effect, color: event.target.value })} /></label><label className="text-[11px] text-white/65">发光强度<input className={control} type="number" min={0.1} max={2} step={0.1} value={effect.intensity} onChange={event => replace({ ...effect, intensity: Number(event.target.value) })} /></label></div>
        : effect.kind === "label" ? <>
          <div className="grid grid-cols-2 gap-2"><label className="text-[11px] text-white/65">跟随部位<select aria-label="标注跟随骨骼" className={control} value={effect.bone} onChange={event => replace({ ...effect, bone: event.target.value as Extract<PrevisSceneEffect, { kind: "label" }>["bone"] })}><option value="head">头部</option><option value="spine">胸部</option><option value="pelvis">骨盆</option><option value="hand-1">左手</option><option value="hand1">右手</option></select></label><label className="text-[11px] text-white/65">标注文字<input aria-label="骨骼标注文字" className={control} type="text" maxLength={32} value={effect.text} onChange={event => replace({ ...effect, text: event.target.value })} /></label></div>
          <div className="grid grid-cols-2 gap-2"><label className="text-[11px] text-white/65">文字与引线颜色<input className={`${control} h-8`} type="color" value={effect.color} onChange={event => replace({ ...effect, color: event.target.value })} /></label><label className="text-[11px] text-white/65">文字大小<input aria-label="骨骼标注字号" className={control} type="number" min={0.06} max={0.4} step={0.01} value={effect.fontSize} onChange={event => replace({ ...effect, fontSize: Number(event.target.value) })} /></label></div>
          <div className="grid grid-cols-3 gap-2">{(["横向 X", "前后 Y", "高度 Z"] as const).map((label, axis) => <label key={label} className="text-[11px] text-white/65">{label}偏移<input aria-label={`骨骼标注${label}偏移`} className={control} type="number" min={-2} max={2} step={0.05} value={effect.offset[axis]} onChange={event => { const offset: [number, number, number] = [...effect.offset]; offset[axis] = Number(event.target.value); replace({ ...effect, offset }); }} /></label>)}</div>
          <p className="text-[11px] text-white/45">中文标注与引线跟随所选骨骼，最多32字；位置与遮挡以渲染候选为准。</p>
        </>
        : <div className="grid grid-cols-2 gap-2"><label className="text-[11px] text-white/65">下部颜色<input className={`${control} h-8`} type="color" value={effect.color} onChange={event => replace({ ...effect, color: event.target.value })} /></label><label className="text-[11px] text-white/65">上部颜色<input className={`${control} h-8`} type="color" value={effect.colorEnd} onChange={event => replace({ ...effect, colorEnd: event.target.value })} /></label></div>}
    </fieldset>)}</div>
    {error ? <p role="alert" className="text-xs text-amber-200">{error}</p> : null}
    <button type="button" className={button} disabled={disabled || changedSource || !dirty} onClick={save}>保存场景特效配置</button>
  </details>;
}
