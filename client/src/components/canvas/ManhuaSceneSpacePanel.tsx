import { inspectManhuaSceneSpace, manhuaSceneSpaceSourceVersion, manhuaSceneSpaceState, type ManhuaSceneSpace } from "@shared/manhuaSceneSpace";
import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";

const field = "min-w-0 rounded border border-white/20 bg-black/20 px-2 py-1 text-xs";
export function ManhuaSceneSpacePanel({ asset, disabled, onChange }: {
  asset: ManhuaCustomAssetRef; disabled?: boolean; onChange: (space: ManhuaSceneSpace) => void;
}) {
  const space = asset.sceneSpace ?? { version: 1 as const, sourceRefId: asset.id, sourceVersion: manhuaSceneSpaceSourceVersion(asset), revision: 1, status: "draft" as const, sourceNoteZh: "", zones: [], passages: [] };
  const state = manhuaSceneSpaceState(asset);
  const issues = inspectManhuaSceneSpace(space);
  const save = (next: ManhuaSceneSpace) => onChange({ ...next, revision: space.revision + 1, status: "draft" });
  const points = new Map(space.zones.map((zone, i) => [zone.id, { x: 70 + (i % 3) * 130, y: 35 + Math.floor(i / 3) * 75 }]));
  return <details data-manhua-scene-space={asset.id} className="rounded border border-cyan-300/20 p-2">
    <summary className="cursor-pointer text-xs">场景空间 · {{ missing: "未规划", draft: "草稿待确认", stale: "来源已变，待复核", approved: "已采用" }[state]} · v{space.revision}</summary>
    <p className="my-2 text-[10px] text-white/50">区域与出入口关系示意，无比例和实测深度。三维世界、碰撞及接地仍需单独验证。</p>
    <label className="block text-xs">来源依据<input aria-label="空间来源依据" className={field + " w-full"} value={space.sourceNoteZh} disabled={disabled} onChange={e => save({ ...space, sourceNoteZh: e.target.value })}/></label>
    {space.zones.length > 0 && <svg role="img" aria-label="场景区域连通示意图（非比例）" viewBox={`0 0 410 ${Math.max(80, Math.ceil(space.zones.length / 3) * 75)}`} className="my-2 w-full">
      <defs><marker id={`arrow-${asset.id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#67e8f9"/></marker></defs>
      {space.passages.map(p => { const a = points.get(p.fromId), b = points.get(p.toId); if (!a || !b || p.fromId === p.toId) return null;
        const dx = b.x - a.x, dy = b.y - a.y;
        const edge = Math.min(dx === 0 ? Infinity : 58 / Math.abs(dx), dy === 0 ? Infinity : 20 / Math.abs(dy));
        return <line key={p.id} x1={a.x + dx * edge} y1={a.y + dy * edge} x2={b.x - dx * edge} y2={b.y - dy * edge} stroke="#67e8f9" strokeWidth="2" markerEnd={`url(#arrow-${asset.id})`} markerStart={p.bidirectional ? `url(#arrow-${asset.id})` : undefined}/>; })}
      {space.zones.map(zone => { const point = points.get(zone.id)!; return <g key={zone.id}><rect x={point.x - 55} y={point.y - 17} width="110" height="34" rx="7" fill="#164e63"/><text x={point.x} y={point.y + 4} textAnchor="middle" fill="white" fontSize="11">{zone.labelZh || "待命名区域"}</text></g>; })}
    </svg>}
    <div className="space-y-2">{space.zones.map(zone => <fieldset key={zone.id} className="rounded border border-white/10 p-2">
      <input aria-label="区域名称" className={field + " w-full"} placeholder="区域名称" value={zone.labelZh} disabled={disabled} onChange={e => save({ ...space, zones: space.zones.map(z => z.id === zone.id ? { ...z, labelZh: e.target.value } : z) })}/>
      <input aria-label="区域固定结构" className={field + " mt-1 w-full"} placeholder="固定结构与地标" value={zone.fixedFeaturesZh} disabled={disabled} onChange={e => save({ ...space, zones: space.zones.map(z => z.id === zone.id ? { ...z, fixedFeaturesZh: e.target.value } : z) })}/>
      <button type="button" disabled={disabled} className="mt-1 text-[10px] text-rose-200" onClick={() => save({ ...space, zones: space.zones.filter(z => z.id !== zone.id), passages: space.passages.filter(p => p.fromId !== zone.id && p.toId !== zone.id) })}>删除区域及关联通路</button>
    </fieldset>)}</div>
    <button type="button" disabled={disabled} className="my-2 text-xs text-cyan-200" onClick={() => save({ ...space, zones: [...space.zones, { id: crypto.randomUUID(), labelZh: "", fixedFeaturesZh: "" }] })}>添加区域</button>
    <div className="space-y-2">{space.passages.map(p => <fieldset key={p.id} className="rounded border border-white/10 p-2">
      <input aria-label="出入口名称" className={field + " w-full"} value={p.labelZh} disabled={disabled} placeholder="门、楼梯或通道名称" onChange={e => save({ ...space, passages: space.passages.map(v => v.id === p.id ? { ...v, labelZh: e.target.value } : v) })}/>
      <div className="my-1 flex flex-wrap gap-1">{(["fromId", "toId"] as const).map(key => <select key={key} aria-label={key === "fromId" ? "通路起点" : "通路终点"} className={field} value={p[key]} disabled={disabled} onChange={e => save({ ...space, passages: space.passages.map(v => v.id === p.id ? { ...v, [key]: e.target.value } : v) })}><option value="">选择区域</option>{space.zones.map(z => <option key={z.id} value={z.id}>{z.labelZh || "待命名"}</option>)}</select>)}</div>
      <label className="text-xs"><input type="checkbox" checked={p.bidirectional} disabled={disabled} onChange={e => save({ ...space, passages: space.passages.map(v => v.id === p.id ? { ...v, bidirectional: e.target.checked } : v) })}/>双向可通行</label>
      <button type="button" disabled={disabled} className="ml-2 text-[10px] text-rose-200" onClick={() => save({ ...space, passages: space.passages.filter(v => v.id !== p.id) })}>删除通路</button>
    </fieldset>)}</div>
    <button type="button" disabled={disabled || space.zones.length < 2} className="my-2 text-xs text-cyan-200" onClick={() => save({ ...space, passages: [...space.passages, { id: crypto.randomUUID(), fromId: "", toId: "", labelZh: "", bidirectional: true }] })}>添加出入口／通道</button>
    {issues.map(issue => <p key={issue} className="text-[10px] text-amber-200">{issue}</p>)}
    <button type="button" disabled={disabled || issues.length > 0 || asset.reviewStatus === "needs_review"} className="mt-2 rounded border border-cyan-300/30 px-2 py-1 text-xs disabled:opacity-40" onClick={() => onChange({ ...space, sourceRefId: asset.id, sourceVersion: manhuaSceneSpaceSourceVersion(asset), revision: space.revision + 1, status: "approved" })}>确认并采用空间关系</button>
    <p className="mt-1 text-[10px] text-white/40">编辑自动存为草稿；确认后由采用本场景的段成片消费。更换来源图会要求重新核对。</p>
  </details>;
}
