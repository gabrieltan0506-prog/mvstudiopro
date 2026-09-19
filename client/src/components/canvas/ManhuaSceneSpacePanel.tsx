import React, { useState } from "react";
import {
  inspectManhuaSceneSpace,
  manhuaSceneSpaceSourceVersion,
  manhuaSceneSpaceState,
  type ManhuaSceneSpace,
  type ManhuaSpatialScope,
} from "@shared/manhuaSceneSpace";
import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";

const field =
  "min-w-0 rounded border border-white/20 bg-black/20 px-2 py-1 text-xs";
export function ManhuaSceneSpacePanel({
  asset,
  disabled,
  onChange,
  actors = [],
  scopes = [],
}: {
  actors?: readonly { id: string; labelZh: string }[];
  scopes?: readonly (ManhuaSpatialScope & { labelZh: string })[];
  asset: ManhuaCustomAssetRef;
  disabled?: boolean;
  onChange: (space: ManhuaSceneSpace) => void;
}) {
  const space: ManhuaSceneSpace = asset.sceneSpace ?? {
    version: 1 as const,
    sourceRefId: asset.id,
    sourceVersion: manhuaSceneSpaceSourceVersion(asset),
    revision: 1,
    status: "draft" as const,
    sourceNoteZh: "",
    zones: [],
    passages: [],
  };
  const state = manhuaSceneSpaceState(asset);
  const issues = inspectManhuaSceneSpace(space);
  const save = (next: ManhuaSceneSpace) =>
    onChange({ ...next, revision: space.revision + 1, status: "draft" });
  const scopeKey = (scope: ManhuaSpatialScope) =>
    `${scope.episode}/${scope.segmentIndex}/${scope.shotId ?? ""}/${scope.sourceRevision ?? ""}`;
  const confirmScope = (scope: ManhuaSpatialScope): ManhuaSpatialScope => {
    if (scope.sourceRevision) return scope;
    const current = scopes.find(s => s.episode === scope.episode && s.segmentIndex === scope.segmentIndex && s.shotId === scope.shotId);
    return current?.sourceRevision ? { ...scope, sourceRevision: current.sourceRevision } : scope;
  };
  const bindingIssues = [
    ...(space.actorPositions ?? []),
    ...(space.storyCues ?? []),
  ].some(
    row =>
      !actors.some(actor => actor.id === row.actorId) ||
      (!scopes.length || (scopes.some(scope => scope.episode === row.scope.episode) && !scopes.some(scope => row.scope.sourceRevision ? scopeKey(scope) === scopeKey(row.scope) : scope.episode === row.scope.episode && scope.segmentIndex === row.scope.segmentIndex && scope.shotId === row.scope.shotId)))
  )
    ? ["部分人物、镜段或剧本版本已失效，请重新绑定"]
    : [];
  issues.push(...bindingIssues);
  const scopePicker = (
    scope: ManhuaSpatialScope,
    change: (scope: ManhuaSpatialScope) => void
  ) => (
    <select
      aria-label="绑定镜段"
      className={field}
      disabled={disabled}
      value={scopeKey(scope)}
      onChange={e => {
        const selected = scopes.find(s => scopeKey(s) === e.target.value);
        if (selected)
          change({
            episode: selected.episode,
            segmentIndex: selected.segmentIndex,
            ...(selected.sourceRevision ? { sourceRevision: selected.sourceRevision } : {}),
            ...(selected.shotId ? { shotId: selected.shotId } : {}),
          });
      }}
    >
      <option value="">选择镜段</option>
      {!scopes.some(s => scopeKey(s) === scopeKey(scope)) && (
        <option value={scopeKey(scope)}>{scopes.some(s => s.episode === scope.episode) ? "原镜段已失效" : `第${scope.episode}集第${scope.segmentIndex}段${scope.shotId ? `第${scope.shotId}镜` : ""}（切回该集可编辑绑定）`}</option>
      )}
      {scopes.map(s => (
        <option key={scopeKey(s)} value={scopeKey(s)}>
          {s.labelZh}
        </option>
      ))}
    </select>
  );
  const actorPicker = (actorId: string, change: (id: string) => void) => (
    <select
      aria-label="绑定人物"
      className={field}
      disabled={disabled}
      value={actorId}
      onChange={e => change(e.target.value)}
    >
      <option value="">选择人物</option>
      {actorId && !actors.some(a => a.id === actorId) && (
        <option value={actorId}>原人物已失效</option>
      )}
      {actors.map(a => (
        <option key={a.id} value={a.id}>
          {a.labelZh}
        </option>
      ))}
    </select>
  );
  const [previewScopeKey, setPreviewScopeKey] = useState("");
  const previewScopes = Array.from(new Map((space.actorPositions ?? []).map(p => [scopeKey(p.scope), p.scope])).values());
  const actualPreviewScope = previewScopes.some(scope => scopeKey(scope) === previewScopeKey) ? previewScopeKey : (previewScopes[0] ? scopeKey(previewScopes[0]) : "");
  const diagramHeight = Math.max(80, Math.ceil(space.zones.length / 3) * 75);
  const points = new Map(
    space.zones.map((zone, i) => [
      zone.id,
      { x: 70 + (i % 3) * 130, y: 35 + Math.floor(i / 3) * 75 },
    ])
  );
  return (
    <details
      data-manhua-scene-space={asset.id}
      className="rounded border border-cyan-300/20 p-2"
    >
      <summary className="cursor-pointer text-xs">
        场景空间 ·{" "}
        {
          {
            missing: "未规划",
            draft: "草稿待确认",
            stale: "来源已变，待复核",
            approved: "已采用",
          }[state]
        }{" "}
        · v{space.revision}
      </summary>
      <p className="my-2 text-[10px] text-white/50">
        区域与出入口关系示意，无比例和实测深度。三维世界、碰撞及接地仍需单独验证。
      </p>
      <label className="block text-xs">
        来源依据
        <input
          aria-label="空间来源依据"
          className={field + " w-full"}
          value={space.sourceNoteZh}
          disabled={disabled}
          onChange={e => save({ ...space, sourceNoteZh: e.target.value })}
        />
      </label>
      {previewScopes.length > 0 && <label className="block text-xs">站位预览镜段<select aria-label="站位预览镜段" className={field} value={actualPreviewScope} onChange={e => setPreviewScopeKey(e.target.value)}>{previewScopes.map(scope => <option key={scopeKey(scope)} value={scopeKey(scope)}>第{scope.episode}集第{scope.segmentIndex}段{scope.shotId ? `第${scope.shotId}镜` : ""}</option>)}</select></label>}
      {space.zones.length > 0 && (
        <svg
          role="img"
          aria-label="场景区域连通示意图（非比例）"
          viewBox={`0 0 410 ${diagramHeight}`}
          className="my-2 w-full"
        >
          <defs>
            <marker
              id={`arrow-${asset.id}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#67e8f9" />
            </marker>
          </defs>
          {space.passages.map(p => {
            const a = points.get(p.fromId),
              b = points.get(p.toId);
            if (!a || !b || p.fromId === p.toId) return null;
            const dx = b.x - a.x,
              dy = b.y - a.y;
            const edge = Math.min(
              dx === 0 ? Infinity : 58 / Math.abs(dx),
              dy === 0 ? Infinity : 20 / Math.abs(dy)
            );
            return (
              <line
                key={p.id}
                x1={a.x + dx * edge}
                y1={a.y + dy * edge}
                x2={b.x - dx * edge}
                y2={b.y - dy * edge}
                stroke="#67e8f9"
                strokeWidth="2"
                markerEnd={`url(#arrow-${asset.id})`}
                markerStart={
                  p.bidirectional ? `url(#arrow-${asset.id})` : undefined
                }
              />
            );
          })}
          {space.zones.map(zone => {
            const point = points.get(zone.id)!;
            return (
              <g key={zone.id}>
                <rect
                  x={point.x - 55}
                  y={point.y - 17}
                  width="110"
                  height="34"
                  rx="7"
                  fill="#164e63"
                />
                <text
                  x={point.x}
                  y={point.y + 4}
                  textAnchor="middle"
                  fill="white"
                  fontSize="11"
                >
                  {zone.labelZh || "待命名区域"}
                </text>
              </g>
            );
          })}
          {(space.actorPositions ?? []).filter(p => scopeKey(p.scope) === actualPreviewScope && p.designPosition).map(p => {
            const pos = p.designPosition!;
            const x = 25 + pos.x * 360, y = 25 + pos.y * (diagramHeight - 50);
            return <g key={p.id} data-actor-id={p.actorId} data-design-x={pos.x} data-design-y={pos.y} data-facing-degrees={pos.facingDegrees} opacity={p.visibility === "visible" ? 1 : 0.6}>
              <title>{`${actors.find(a => a.id === p.actorId)?.labelZh || p.actorId}：${p.positionZh}；${p.facingZh}；${p.occlusionZh}（示意坐标，非标定）`}</title>
              <circle cx={x} cy={y} r="7" fill="#fbbf24" stroke="#111827" strokeDasharray={p.visibility === "visible" ? undefined : "2 2"}/>
              <path d="M 0 0 L 0 -17 M -4 -12 L 0 -17 L 4 -12" transform={`translate(${x} ${y}) rotate(${pos.facingDegrees})`} stroke="#fbbf24" strokeWidth="2" fill="none"/>
              <text x={x} y={y + 17} textAnchor={pos.x > 0.8 ? "end" : pos.x < 0.2 ? "start" : "middle"} fill="#fde68a" fontSize="10">{actors.find(a => a.id === p.actorId)?.labelZh || "人物"}·{{ visible: "在画", offscreen: "画外", occluded: "遮挡" }[p.visibility]}</text>
            </g>;
          })}
        </svg>
      )}
      <div className="space-y-2">
        {space.zones.map(zone => (
          <fieldset
            key={zone.id}
            className="rounded border border-white/10 p-2"
          >
            <input
              aria-label="区域名称"
              className={field + " w-full"}
              placeholder="区域名称"
              value={zone.labelZh}
              disabled={disabled}
              onChange={e =>
                save({
                  ...space,
                  zones: space.zones.map(z =>
                    z.id === zone.id ? { ...z, labelZh: e.target.value } : z
                  ),
                })
              }
            />
            <input
              aria-label="区域固定结构"
              className={field + " mt-1 w-full"}
              placeholder="固定结构与地标"
              value={zone.fixedFeaturesZh}
              disabled={disabled}
              onChange={e =>
                save({
                  ...space,
                  zones: space.zones.map(z =>
                    z.id === zone.id
                      ? { ...z, fixedFeaturesZh: e.target.value }
                      : z
                  ),
                })
              }
            />
            <button
              type="button"
              disabled={disabled}
              className="mt-1 text-[10px] text-rose-200"
              onClick={() =>
                save({
                  ...space,
                  zones: space.zones.filter(z => z.id !== zone.id),
                  passages: space.passages.filter(
                    p => p.fromId !== zone.id && p.toId !== zone.id
                  ),
                  actorPositions: space.actorPositions?.filter(
                    p => p.zoneId !== zone.id
                  ),
                  storyCues: space.storyCues?.filter(
                    c =>
                      !space.passages.some(
                        p =>
                          p.id === c.passageId &&
                          (p.fromId === zone.id || p.toId === zone.id)
                      )
                  ),
                })
              }
            >
              删除区域及关联调度
            </button>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled}
        className="my-2 text-xs text-cyan-200"
        onClick={() =>
          save({
            ...space,
            zones: [
              ...space.zones,
              { id: crypto.randomUUID(), labelZh: "", fixedFeaturesZh: "" },
            ],
          })
        }
      >
        添加区域
      </button>
      <div className="space-y-2">
        {space.passages.map(p => (
          <fieldset key={p.id} className="rounded border border-white/10 p-2">
            <input
              aria-label="出入口名称"
              className={field + " w-full"}
              value={p.labelZh}
              disabled={disabled}
              placeholder="门、楼梯或通道名称"
              onChange={e =>
                save({
                  ...space,
                  passages: space.passages.map(v =>
                    v.id === p.id ? { ...v, labelZh: e.target.value } : v
                  ),
                })
              }
            />
            <div className="my-1 flex flex-wrap gap-1">
              {(["fromId", "toId"] as const).map(key => (
                <select
                  key={key}
                  aria-label={key === "fromId" ? "通路起点" : "通路终点"}
                  className={field}
                  value={p[key]}
                  disabled={disabled}
                  onChange={e =>
                    save({
                      ...space,
                      passages: space.passages.map(v =>
                        v.id === p.id ? { ...v, [key]: e.target.value } : v
                      ),
                    })
                  }
                >
                  <option value="">选择区域</option>
                  {space.zones.map(z => (
                    <option key={z.id} value={z.id}>
                      {z.labelZh || "待命名"}
                    </option>
                  ))}
                </select>
              ))}
            </div>
            {(["directionZh", "slopeZh", "designBasisZh"] as const).map(key => (
              <input
                key={key}
                aria-label={
                  {
                    directionZh: "路线方向",
                    slopeZh: "设计坡向",
                    designBasisZh: "路线设计依据",
                  }[key]
                }
                className={field + " mt-1 w-full"}
                placeholder={
                  {
                    directionZh: "方向（如向北至门厅）",
                    slopeZh: "可选坡向（如向北上坡，设计示意）",
                    designBasisZh: "设计依据（剧本位置或参考图标注）",
                  }[key]
                }
                value={p[key] ?? ""}
                disabled={disabled}
                onChange={e =>
                  save({
                    ...space,
                    passages: space.passages.map(v =>
                      v.id === p.id ? { ...v, [key]: e.target.value } : v
                    ),
                  })
                }
              />
            ))}
            <label className="block text-xs">
              设计距离（米，选填，非实测）
              <input
                type="number"
                min="0.01"
                step="any"
                aria-label="设计距离"
                className={field}
                value={p.designDistanceM ?? ""}
                disabled={disabled}
                onChange={e =>
                  save({
                    ...space,
                    passages: space.passages.map(v =>
                      v.id === p.id
                        ? {
                            ...v,
                            designDistanceM:
                              e.target.value && Number(e.target.value) > 0
                                ? Number(e.target.value)
                                : undefined,
                          }
                        : v
                    ),
                  })
                }
              />
            </label>
            <label className="text-xs">
              <input
                type="checkbox"
                checked={p.bidirectional}
                disabled={disabled}
                onChange={e =>
                  save({
                    ...space,
                    passages: space.passages.map(v =>
                      v.id === p.id
                        ? { ...v, bidirectional: e.target.checked }
                        : v
                    ),
                  })
                }
              />
              双向可通行
            </label>
            <button
              type="button"
              disabled={disabled}
              className="ml-2 text-[10px] text-rose-200"
              onClick={() =>
                save({
                  ...space,
                  passages: space.passages.filter(v => v.id !== p.id),
                  storyCues: space.storyCues?.filter(c => c.passageId !== p.id),
                })
              }
            >
              删除通路
            </button>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        disabled={disabled || space.zones.length < 2}
        className="my-2 text-xs text-cyan-200"
        onClick={() =>
          save({
            ...space,
            passages: [
              ...space.passages,
              {
                id: crypto.randomUUID(),
                fromId: "",
                toId: "",
                labelZh: "",
                bidirectional: true,
              },
            ],
          })
        }
      >
        添加出入口／通道
      </button>
      <p className="mt-2 text-xs">人物站位与路线事件（沿用本剧人物、镜段）</p>
      {(space.actorPositions ?? []).map(row => (
        <fieldset
          key={row.id}
          className="my-2 space-y-1 rounded border border-white/10 p-2"
        >
          {scopePicker(row.scope, scope =>
            save({
              ...space,
              actorPositions: space.actorPositions!.map(p =>
                p.id === row.id ? { ...p, scope } : p
              ),
            })
          )}
          {actorPicker(row.actorId, actorId =>
            save({
              ...space,
              actorPositions: space.actorPositions!.map(p =>
                p.id === row.id ? { ...p, actorId } : p
              ),
            })
          )}
          <label className="block text-xs"><input type="checkbox" aria-label="启用示意坐标" disabled={disabled} checked={Boolean(row.designPosition)} onChange={e => save({ ...space, actorPositions: space.actorPositions!.map(p => p.id === row.id ? { ...p, designPosition: e.target.checked ? { x: 0.5, y: 0.5, facingDegrees: 0 } : undefined } : p) })}/>在图上标记示意位置（不代表实测坐标）</label>
          {row.designPosition && <div className="flex flex-wrap gap-2">{(["x", "y", "facingDegrees"] as const).map(key => <label key={key} className="text-xs">{{ x: "横向0–1", y: "纵向0–1", facingDegrees: "朝向角度" }[key]}<input aria-label={{ x: "示意横坐标", y: "示意纵坐标", facingDegrees: "示意朝向角度" }[key]} type="number" min="0" max={key === "facingDegrees" ? 359.99 : 1} step={key === "facingDegrees" ? 1 : 0.01} disabled={disabled} className={field + " w-20"} value={row.designPosition![key]} onChange={e => { const value = Number(e.target.value); if (e.target.value === "" || !Number.isFinite(value) || value < 0 || value > (key === "facingDegrees" ? 359.99 : 1)) return; save({ ...space, actorPositions: space.actorPositions!.map(p => p.id === row.id ? { ...p, designPosition: { ...p.designPosition!, [key]: value } } : p) }); }}/></label>)}<p className="text-[10px] text-white/50">原点为示意图左上；0度向上、顺时针旋转。区域名是剧情归属，图上点为设计标注，不做世界坐标或碰撞推断。</p></div>}
          <select
            aria-label="站位区域"
            className={field}
            disabled={disabled}
            value={row.zoneId}
            onChange={e =>
              save({
                ...space,
                actorPositions: space.actorPositions!.map(p =>
                  p.id === row.id ? { ...p, zoneId: e.target.value } : p
                ),
              })
            }
          >
            <option value="">选择区域</option>
            {space.zones.map(z => (
              <option key={z.id} value={z.id}>
                {z.labelZh}
              </option>
            ))}
          </select>
          {(["positionZh", "facingZh", "occlusionZh", "sourceZh"] as const).map(
            key => (
              <input
                key={key}
                aria-label={{ positionZh: "区域内位置", facingZh: "人物朝向", occlusionZh: "画外去向或遮挡物", sourceZh: "来源依据", eventZh: "剧情事件", emotionZh: "情绪变化", musicNoteZh: "音乐意图" }[key]}
                className={field + " w-full"}
                placeholder={
                  {
                    positionZh: "区域内位置（如门槛外侧）",
                    facingZh: "朝向（如面向北墙）",
                    occlusionZh: "画外去向或遮挡物",
                    sourceZh: "站位依据",
                  }[key]
                }
                value={row[key]}
                disabled={disabled}
                onChange={e =>
                  save({
                    ...space,
                    actorPositions: space.actorPositions!.map(p =>
                      p.id === row.id ? { ...p, [key]: e.target.value } : p
                    ),
                  })
                }
              />
            )
          )}
          <select
            aria-label="在场状态"
            className={field}
            disabled={disabled}
            value={row.visibility}
            onChange={e =>
              save({
                ...space,
                actorPositions: space.actorPositions!.map(p =>
                  p.id === row.id
                    ? {
                        ...p,
                        visibility: e.target.value as typeof row.visibility,
                      }
                    : p
                ),
              })
            }
          >
            <option value="visible">在画</option>
            <option value="offscreen">画外</option>
            <option value="occluded">被遮挡</option>
          </select>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              save({
                ...space,
                actorPositions: space.actorPositions!.filter(
                  p => p.id !== row.id
                ),
              })
            }
            className="text-xs text-rose-200"
          >
            删除站位
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="my-2 text-xs text-cyan-200"
        disabled={
          disabled || !actors.length || !scopes.length || !space.zones.length
        }
        onClick={() =>
          save({
            ...space,
            actorPositions: [
              ...(space.actorPositions ?? []),
              {
                id: crypto.randomUUID(),
                scope: {
                  episode: scopes[0].episode,
                  segmentIndex: scopes[0].segmentIndex,
                  ...(scopes[0].sourceRevision ? { sourceRevision: scopes[0].sourceRevision } : {}),
                  ...(scopes[0].shotId ? { shotId: scopes[0].shotId } : {}),
                },
                actorId: actors[0].id,
                zoneId: space.zones[0].id,
                positionZh: "",
                facingZh: "",
                visibility: "visible",
                occlusionZh: "",
                sourceZh: "",
              },
            ],
          })
        }
      >
        添加人物站位
      </button>
      {(space.storyCues ?? []).map(row => (
        <fieldset
          key={row.id}
          className="my-2 space-y-1 rounded border border-white/10 p-2"
        >
          {scopePicker(row.scope, scope =>
            save({
              ...space,
              storyCues: space.storyCues!.map(c =>
                c.id === row.id ? { ...c, scope } : c
              ),
            })
          )}
          {actorPicker(row.actorId, actorId =>
            save({
              ...space,
              storyCues: space.storyCues!.map(c =>
                c.id === row.id ? { ...c, actorId } : c
              ),
            })
          )}
          <select
            aria-label="事件通路"
            className={field}
            disabled={disabled}
            value={row.passageId}
            onChange={e =>
              save({
                ...space,
                storyCues: space.storyCues!.map(c =>
                  c.id === row.id ? { ...c, passageId: e.target.value } : c
                ),
              })
            }
          >
            <option value="">选择通路</option>
            {space.passages.map(p => (
              <option key={p.id} value={p.id}>
                {p.labelZh}
              </option>
            ))}
          </select>
          {(["eventZh", "emotionZh", "musicNoteZh", "sourceZh"] as const).map(
            key => (
              <input
                key={key}
                aria-label={{ positionZh: "区域内位置", facingZh: "人物朝向", occlusionZh: "画外去向或遮挡物", sourceZh: "来源依据", eventZh: "剧情事件", emotionZh: "情绪变化", musicNoteZh: "音乐意图" }[key]}
                className={field + " w-full"}
                placeholder={
                  {
                    eventZh: "发生的剧情事件",
                    emotionZh: "人物情绪为何改变",
                    musicNoteZh: "音乐意图（不按坡高自动调音量）",
                    sourceZh: "剧情原文依据",
                  }[key]
                }
                value={row[key]}
                disabled={disabled}
                onChange={e =>
                  save({
                    ...space,
                    storyCues: space.storyCues!.map(c =>
                      c.id === row.id ? { ...c, [key]: e.target.value } : c
                    ),
                  })
                }
              />
            )
          )}
          <select
            aria-label="音乐走向"
            className={field}
            disabled={disabled}
            value={row.musicCue}
            onChange={e =>
              save({
                ...space,
                storyCues: space.storyCues!.map(c =>
                  c.id === row.id
                    ? { ...c, musicCue: e.target.value as typeof row.musicCue }
                    : c
                ),
              })
            }
          >
            <option value="rise">蓄力</option>
            <option value="turn">转折</option>
            <option value="fall">收束</option>
            <option value="breath">留白</option>
          </select>
          <button
            type="button"
            disabled={disabled}
            className="text-xs text-rose-200"
            onClick={() =>
              save({
                ...space,
                storyCues: space.storyCues!.filter(c => c.id !== row.id),
              })
            }
          >
            删除事件
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="my-2 ml-2 text-xs text-cyan-200"
        disabled={
          disabled || !actors.length || !scopes.length || !space.passages.length
        }
        onClick={() =>
          save({
            ...space,
            storyCues: [
              ...(space.storyCues ?? []),
              {
                id: crypto.randomUUID(),
                scope: {
                  episode: scopes[0].episode,
                  segmentIndex: scopes[0].segmentIndex,
                  ...(scopes[0].sourceRevision ? { sourceRevision: scopes[0].sourceRevision } : {}),
                  ...(scopes[0].shotId ? { shotId: scopes[0].shotId } : {}),
                },
                actorId: actors[0].id,
                passageId: space.passages[0].id,
                eventZh: "",
                emotionZh: "",
                musicCue: "rise",
                musicNoteZh: "",
                sourceZh: "",
              },
            ],
          })
        }
      >
        添加路线剧情事件
      </button>
      {(!actors.length || !scopes.length) && (
        <p className="text-[10px] text-amber-200">
          已有剧本人物和镜段后可编排站位与事件。
        </p>
      )}
      {issues.map(issue => (
        <p key={issue} className="text-[10px] text-amber-200">
          {issue}
        </p>
      ))}
      <button
        type="button"
        disabled={
          disabled || issues.length > 0 || asset.reviewStatus === "needs_review"
        }
        className="mt-2 rounded border border-cyan-300/30 px-2 py-1 text-xs disabled:opacity-40"
        onClick={() =>
          onChange({
            ...space,
            sourceRefId: asset.id,
            sourceVersion: manhuaSceneSpaceSourceVersion(asset),
            revision: space.revision + 1,
            actorPositions: space.actorPositions?.map(row => ({ ...row, scope: confirmScope(row.scope) })),
            storyCues: space.storyCues?.map(row => ({ ...row, scope: confirmScope(row.scope) })),
            status: "approved",
          })
        }
      >
        确认并采用空间关系
      </button>
      <p className="mt-1 text-[10px] text-white/40">
        编辑自动存为草稿；确认后由采用本场景的段成片消费。更换来源图会要求重新核对。
      </p>
    </details>
  );
}
