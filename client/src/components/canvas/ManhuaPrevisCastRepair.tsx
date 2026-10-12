import { useState } from "react";
import { repairManhuaPrevisCast, type PrevisCastCharacter } from "@shared/manhuaPrevisCastRepair";
import type { ManhuaPrevisStudio } from "@shared/manhuaPrevis";

export function ManhuaPrevisCastRepair({ studio, characters, disabled, onApply }: {
  studio: ManhuaPrevisStudio; characters: PrevisCastCharacter[]; disabled: boolean;
  onApply: (next: ManhuaPrevisStudio) => boolean;
}) {
  const [additions, setAdditions] = useState<string[]>([]);
  const [shapes, setShapes] = useState<Record<string, "human" | "horse">>({});
  const [error, setError] = useState("");
  const missing = characters.filter(character => !studio.spec.actors.some(actor => actor.assetRef === character.id || actor.nameZh === character.label));
  return <details className="rounded border border-cyan-300/25 p-3">
    <summary className="cursor-pointer text-xs">核对本段人物与形态</summary>
    <p className="my-2 text-xs text-white/65">漏掉人物时，从已绑定资产补入；形态识别错误可在此纠正。保留原模型、动作与历史。新增人物仍须安排站位和动作，再渲染审片。</p>
    {studio.spec.actors.map(actor => <label key={actor.id} className="my-2 flex items-center justify-between gap-2 text-xs">
      {actor.nameZh}<select aria-label={`${actor.nameZh}的预演形态`} disabled={disabled} value={shapes[actor.id] || actor.shape} className="rounded bg-slate-900 p-1" onChange={event => setShapes(previous => ({ ...previous, [actor.id]: event.target.value as "human" | "horse" }))}>
        <option value="human">人形</option><option value="horse">马形</option>
      </select>
    </label>)}
    {missing.map(character => <label key={character.id} className="my-2 flex items-center gap-2 text-xs">
      <input type="checkbox" disabled={disabled} checked={additions.includes(character.id)} onChange={event => setAdditions(previous => event.target.checked ? [...previous, character.id] : previous.filter(id => id !== character.id))} />补入{character.label}
    </label>)}
    <button type="button" className="rounded border border-cyan-300/30 px-2 py-1 text-xs disabled:opacity-40" disabled={disabled || (!additions.length && !Object.keys(shapes).some(id => shapes[id] !== studio.spec.actors.find(actor => actor.id === id)?.shape))} onClick={() => {
      try {
        const next = repairManhuaPrevisCast(studio, characters, { additions: additions.map(assetRef => ({ assetRef, shape: characters.find(character => character.id === assetRef)?.shape || "human" })), shapes: Object.entries(shapes).map(([actorId, shape]) => ({ actorId, shape })) });
        if (onApply(next)) { setAdditions([]); setShapes({}); setError(""); }
      } catch (failure) { setError(failure instanceof Error ? failure.message : "人物配置未保存"); }
    }}>保存人物核对</button>
    {error && <p role="alert" className="mt-2 text-xs text-amber-200">{error}</p>}
  </details>;
}
