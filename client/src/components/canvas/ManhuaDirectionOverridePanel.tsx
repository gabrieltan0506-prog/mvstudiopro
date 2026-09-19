import { useState } from "react";
import { listManhuaDirectionCards } from "@shared/manhuaDirectionCanonLibrary";
import { manhuaDirectionCardSupportsStage, type ManhuaDirectionCanon, type ManhuaDirectionContext, type ManhuaDirectionOverride } from "@shared/manhuaDirectionCanon";

/** 局部导演决定沿既有Bible保存；草稿不进入生产。 */
export function ManhuaDirectionOverridePanel({ canon, context, onChange }: {
  canon: ManhuaDirectionCanon; context: ManhuaDirectionContext;
  onChange: (overrides: ManhuaDirectionOverride[]) => void;
}) {
  const [requestedScope, setScope] = useState<ManhuaDirectionOverride["scope"]>("shot");
  const scope = requestedScope === "shot" && !context.shotIndex ? (context.segmentIndex ? "segment" : "episode") : requestedScope === "segment" && !context.segmentIndex ? "episode" : requestedScope;
  const matches = (o: ManhuaDirectionOverride) => o.scope === scope && o.episodeIndex === context.episodeIndex &&
    (scope !== "segment" || o.segmentIndex === context.segmentIndex) && (scope !== "shot" || o.shotIndex === context.shotIndex);
  const saved = canon.scopedOverrides?.find(matches);
  const value: ManhuaDirectionOverride = saved || { scope, episodeIndex: context.episodeIndex!,
    ...(scope === "segment" ? { segmentIndex: context.segmentIndex } : {}),
    ...(scope === "shot" ? { shotIndex: context.shotIndex } : {}),
    cardId: canon.mainCardId, reasonZh: "", stages: (["storyboard", "keyframe", "clip"] as const).filter(stage => { const card = canon.cards.find(c => c.id === canon.mainCardId); return card && manhuaDirectionCardSupportsStage(card, stage); }), status: "draft" };
  const write = (patch: Partial<ManhuaDirectionOverride>) => onChange([...(canon.scopedOverrides || []).filter(o => !matches(o)), { ...value, ...patch }]);
  const selectedCard = listManhuaDirectionCards().find(card => card.id === value.cardId);
  const unsupported = value.stages.filter(stage => !selectedCard || !manhuaDirectionCardSupportsStage(selectedCard, stage));
  const field = "min-w-0 w-full rounded border border-white/20 bg-black/20 px-2 py-1 text-xs";
  const scopeLabel = scope === "episode" ? `第${context.episodeIndex}集` : scope === "segment" ? `第${context.episodeIndex}集第${context.segmentIndex}段` : `第${context.episodeIndex}集第${context.shotIndex}镜`;
  return <details className="mt-2 border-t border-white/10 pt-2" data-manhua-direction-override>
    <summary className="cursor-pointer text-xs">局部手法与继承</summary>
    <p className="my-1 text-[10px] text-white/50">系列默认 → 本集 → 本段 → 本镜。草稿保存后需确认采用；撤回后继承上层。</p>
    <select aria-label="导演覆盖范围" className={field} value={scope} onChange={e => setScope(e.target.value as typeof scope)}>
      <option value="episode">本集</option><option value="segment" disabled={!context.segmentIndex}>本段</option><option value="shot" disabled={!context.shotIndex}>本镜</option>
    </select>
    <select aria-label="局部导演手法" className={field + " mt-1"} value={value.cardId} onChange={e => write({ cardId: e.target.value, stages: value.stages.filter(stage => { const card = listManhuaDirectionCards().find(c => c.id === e.target.value); return card && manhuaDirectionCardSupportsStage(card, stage); }), status: "draft" })}>
      {listManhuaDirectionCards().map(card => <option key={card.id} value={card.id}>{card.labelZh}</option>)}
    </select>
    <textarea aria-label="导演覆盖理由" className={field + " mt-1"} placeholder="此处要让观众感到或发现什么，为什么覆盖上层方法" value={value.reasonZh} onChange={e => write({ reasonZh: e.target.value, status: "draft" })}/>
    <div className="my-1 flex flex-wrap gap-2">{([['storyboard', '分镜'], ['keyframe', '关键帧'], ['clip', '成片']] as const).map(([stage, label]) => <label key={stage} className="text-[10px]"><input type="checkbox" checked={value.stages.includes(stage)} disabled={!value.stages.includes(stage) && (!selectedCard || !manhuaDirectionCardSupportsStage(selectedCard, stage))} onChange={e => write({ stages: e.target.checked ? [...value.stages, stage] : value.stages.filter(s => s !== stage), status: "draft" })}/>{label}</label>)}</div>
    <p className="text-[10px] text-white/60">影响：{scopeLabel} · {saved?.status === "approved" ? "已采用" : saved ? "草稿已保存，仍使用上层手法" : "继承上层手法"}</p>
    {unsupported.length > 0 && <p className="text-[10px] text-amber-100">所选阶段没有可执行规律，请重选手法与阶段。</p>}
    <button type="button" className="mr-2 mt-1 rounded border border-violet-200/30 px-2 py-1 text-xs disabled:opacity-40" disabled={!value.reasonZh.trim() || !value.stages.length || unsupported.length > 0} onClick={() => write({ status: "approved" })}>确认采用局部手法</button>
    {saved && <button type="button" className="text-xs text-white/60" onClick={() => onChange((canon.scopedOverrides || []).filter(o => !matches(o)))}>撤回，继承上层</button>}
    <p className="mt-1 text-[10px] text-amber-100/70">旧图与旧片仍保留，不会自动重出。审阅新提示词后再决定是否重新生成。</p>
  </details>;
}
