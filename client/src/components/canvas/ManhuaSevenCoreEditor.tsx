import React, { useEffect, useState } from 'react';
import { MANHUA_SEVEN_CORE_FIELDS, emptyManhuaSevenCoreValues, validateManhuaSevenCoreValues, type ManhuaSevenCoreValues } from '@shared/manhuaSevenCoreSupplement';

export function ManhuaSevenCoreEditor({ shotIndex, initialValues, disabled, onApply, onClear }: {
  shotIndex: number;
  initialValues?: ManhuaSevenCoreValues | null;
  disabled: boolean;
  onApply: (values: ManhuaSevenCoreValues) => void;
  onClear: () => void;
}) {
  const [values, setValues] = useState<ManhuaSevenCoreValues>(() => initialValues ?? emptyManhuaSevenCoreValues());
  const [error, setError] = useState('');
  const savedValues = JSON.stringify(initialValues ?? null);
  useEffect(() => { setValues(JSON.parse(savedValues) ?? emptyManhuaSevenCoreValues()); setError(''); }, [shotIndex, savedValues]);
  return <details className="mt-3 rounded-lg border border-white/10 p-2" data-manhua-seven-core-editor>
    <summary className="cursor-pointer text-xs text-cyan-100">镜 {shotIndex} · 七核心导演要求</summary>
    <p className="my-2 text-[11px] text-white/50">这是文字导演要求，采用后写入本镜补充指令；不会自动生成或自动渲染白模。留空项沿用原导演方案。</p>
    <div className="grid gap-2 sm:grid-cols-2">{MANHUA_SEVEN_CORE_FIELDS.map(field => <label key={field.key} className="text-xs text-white/70">{field.label}
      <textarea aria-label={`本镜${field.label}`} disabled={disabled} value={values[field.key]} rows={2} maxLength={500} onChange={e => setValues(previous => ({ ...previous, [field.key]: e.target.value }))} className="mt-1 w-full rounded bg-slate-900 p-2 text-xs" />
    </label>)}</div>
    {error && <p role="alert" className="my-2 text-xs text-rose-200">{error}</p>}
    <div className="mt-2 flex gap-2">
      <button type="button" disabled={disabled} onClick={() => { try { validateManhuaSevenCoreValues(values); onApply(values); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '采用失败，请重试'); } }} className="rounded bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40">采用到当前镜头</button>
      <button type="button" disabled={disabled || !initialValues} onClick={() => { try { onClear(); setValues(emptyManhuaSevenCoreValues()); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '清除失败，请重试'); } }} className="rounded bg-white/10 px-3 py-2 text-xs disabled:opacity-40">清除本镜七核心</button>
    </div>
    {disabled && <p className="mt-1 text-[11px] text-amber-100">需先建立本段成片节点，且当前没有生成任务。</p>}
  </details>;
}
