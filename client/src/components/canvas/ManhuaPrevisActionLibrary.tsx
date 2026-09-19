import { useState } from "react";
import { PREVIS_ACTION_LABELS, type ManhuaPrevisStudio } from "@shared/manhuaPrevis";
import { addPrevisLibraryAction, PREVIS_LIBRARY_ACTIONS } from "@/lib/manhuaPrevisActionLibrary";

export function ManhuaPrevisActionLibrary({ spec, disabled, onChange }: {
  spec: ManhuaPrevisStudio["spec"];
  disabled: boolean;
  onChange: (spec: ManhuaPrevisStudio["spec"]) => boolean;
}) {
  const [actorId, setActorId] = useState("");
  const [selected, setSelected] = useState<(typeof PREVIS_LIBRARY_ACTIONS)[number]>("guard");
  const [message, setMessage] = useState("");
  const actors = spec.actors.filter(a => a.shape === "human");
  const target = actors.find(a => a.id === actorId) ?? actors[0];
  const proposed = target ? addPrevisLibraryAction(spec, target.id, selected) : undefined;
  const added = proposed?.spec?.actors.find(a => a.id === target?.id)?.actions.find(a => !target?.actions.includes(a));
  const explanations = { idle: "保持当前站位", guard: "抬臂保护，再回收", strike: "蓄力、出手、回收；不是接触受力验收", bow: "俯身行礼，再起身" };
  return <section className="space-y-2 rounded border border-cyan-300/20 p-3" data-previs-action-library>
    <p className="text-xs text-cyan-100">添加基础动作</p>
    <p className="text-xs text-white/60">下方为动作参数示意，不是渲染预览。添加只保存配置，不会提交或采用视频。走位等复杂动作请在专业参数中配置。</p>
    <label className="text-xs">添加给 <select aria-label="动作库角色" value={target?.id ?? ""} disabled={disabled || !actors.length} onChange={e => {setActorId(e.target.value);setMessage("");}}>
      {actors.map(a => <option key={a.id} value={a.id}>{a.nameZh || a.id}</option>)}
    </select></label>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {PREVIS_LIBRARY_ACTIONS.map(kind => <div key={kind} className="rounded border border-white/15 p-2">
        <p className="text-xs text-white/60">{explanations[kind]}</p>
        <button type="button" disabled={disabled} aria-pressed={selected === kind} className="mt-1 w-full rounded border px-2 py-1 text-xs aria-pressed:border-cyan-300" onClick={() => {setSelected(kind);setMessage("");}}>{PREVIS_ACTION_LABELS[kind]}</button>
      </div>)}
    </div>
    <p className="text-xs" data-previs-action-window>{target ? `${target.nameZh || target.id} · ${added ? `${added.startSec}—${added.endSec}秒` : proposed?.error || "无法添加"}` : "请先在专业参数中添加人物。"}</p>
    <button type="button" disabled={disabled || !target || !proposed?.spec} className="rounded border border-cyan-300/40 px-3 py-2 text-xs" onClick={() => {
      if (disabled || !target) return;
      const result = addPrevisLibraryAction(spec, target.id, selected);
      if (!result.spec) {setMessage(result.error || "未添加动作");return;}
      if (onChange(result.spec) === false) {setMessage("配置未保存，未添加动作。");return;}
      setMessage(`已给${target.nameZh || target.id}添加${PREVIS_ACTION_LABELS[selected]}；尚未提交渲染。`);
    }}>添加所选动作</button>
    {message ? <p role="status" className="text-xs">{message}</p> : null}
  </section>;
}
