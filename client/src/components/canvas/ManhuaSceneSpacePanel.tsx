import React from "react";
import type { ManhuaCustomAssetRef } from "@shared/manhuaCustomAssetRefs";
import { manhuaSceneSpaceState, type ManhuaSceneSpace, type ManhuaSpatialScope } from "@shared/manhuaSceneSpace";

/** 已有空间绑定保留；创作者用自然语言提要求，坐标只留在内部契约。 */
export function ManhuaSceneSpacePanel({ asset, actors = [], scopes = [], disabled, onOpenAdvisor }: {
  asset: ManhuaCustomAssetRef;
  disabled?: boolean;
  actors?: readonly { id: string; labelZh: string }[];
  scopes?: readonly (ManhuaSpatialScope & { labelZh: string })[];
  onChange: (space: ManhuaSceneSpace) => void;
  onOpenAdvisor?: () => void;
}) {
  const space = asset.sceneSpace;
  const stale = manhuaSceneSpaceState(asset) === "stale" || Boolean(space?.actorPositions?.some(position => !actors.some(actor => actor.id === position.actorId) || !scopes.some(scope => scope.episode === position.scope.episode && scope.segmentIndex === position.scope.segmentIndex && scope.sourceRevision === position.scope.sourceRevision && scope.shotId === position.scope.shotId)));
  return <section className="space-y-2 rounded border border-cyan-300/20 p-3 text-xs" data-manhua-scene-space>
    <strong>场景空间与人物关系</strong>
    <p className="text-white/65">{space ? `已有 ${space.zones.length} 个空间区域、${space.actorPositions?.length ?? 0} 个人物位置绑定；原记录保留。` : "描述人物与场景的相对位置，让创作顾问安排布局。"}</p>
    {space?.sourceNoteZh && <p className="whitespace-pre-wrap text-white/75">{space.sourceNoteZh}</p>}
    {stale && <p role="status" className="text-amber-100">部分人物、镜段或参考图版本已变化；旧记录保留，当前生成不会采用失效绑定。</p>}
    <button type="button" disabled={disabled || !onOpenAdvisor} onClick={onOpenAdvisor} className="min-h-10 rounded border border-cyan-300/40 px-3 text-cyan-100 disabled:opacity-40">向创作顾问描述场景要求</button>
  </section>;
}
