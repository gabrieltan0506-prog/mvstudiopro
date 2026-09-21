import { manhuaPrevisSpecSchema, type ManhuaPrevisStudio, type PrevisActionKind } from "@shared/manhuaPrevis";

/** 仅收录现有白模渲染器已支持的基础动作；参数示意不代表渲染预览。 */
export const PREVIS_LIBRARY_ACTIONS = ["idle", "guard", "strike", "bow", "walk", "cough"] as const;

/** 只在现有空档中添加动作，不改站位、不挤动旧动作或延长片长。 */
export function addPrevisLibraryAction(
  spec: ManhuaPrevisStudio["spec"],
  actorId: string,
  kind: (typeof PREVIS_LIBRARY_ACTIONS)[number],
): { spec?: ManhuaPrevisStudio["spec"]; error?: string } {
  if (!(PREVIS_LIBRARY_ACTIONS as readonly PrevisActionKind[]).includes(kind)) return { error: "暂不支持这个基础动作。" };
  const actor = spec.actors.find(a => a.id === actorId);
  if (!actor || actor.shape !== "human") return { error: "请先选择一个人物角色。" };
  if (actor.actions.length >= 12) return { error: "这个角色已达到 12 个动作，请先整理已有动作。" };
  const minimumDuration = kind === "cough" ? 1.2 : 0.5;
  let start = 0;
  let end = spec.durationSec;
  for (const action of [...actor.actions].sort((a, b) => a.startSec - b.startSec)) {
    if (action.startSec - start >= minimumDuration) { end = action.startSec; break; }
    start = Math.max(start, action.endSec);
  }
  if (kind !== "walk" && end - start < minimumDuration) return { error: kind === "cough" ? "咳嗽需要至少 1.2 秒空档，才能完成掩口和缓气；请调整已有动作。" : "片长内没有至少半秒的空档；请在专业参数中调整已有动作。" };
  if (kind === "walk") {
    // 轨迹的静止边不能被前后移动合并跨过；只在真实移动边与动作空档的交集中排步态。
    const route = actor.motionRoute;
    const movement = route?.length
      ? route.slice(1).flatMap((node, i) => node.position.some((v, k) => v !== route[i].position[k])
        ? [[route[i].timeSec, node.timeSec]] : [])
      : actor.start.some((v, k) => v !== actor.end[k]) ? [[actor.moveStartSec, actor.moveEndSec]] : [];
    const gaps: number[][] = [];
    let cursor = 0;
    for (const action of [...actor.actions].sort((a, b) => a.startSec - b.startSec)) {
      if (action.startSec > cursor) gaps.push([cursor, action.startSec]);
      cursor = Math.max(cursor, action.endSec);
    }
    if (cursor < spec.durationSec) gaps.push([cursor, spec.durationSec]);
    const windows = gaps.flatMap(gap => movement.map(move => [Math.max(0, gap[0], move[0]), Math.min(spec.durationSec, gap[1], move[1])]))
      .filter(([from, to]) => to - from >= 0.5).sort((a, b) => a[0] - b[0]);
    if (!windows.length) return { error: "没有至少半秒的真实位移空档；请先在专业参数设置起止站位或移动轨迹，行走不会自动改变站位。" };
    [start, end] = windows[0];
  }
  const added = { kind, startSec: start, endSec: Math.min(end, start + 2) };
  const next = { ...spec, actors: spec.actors.map(a => a.id === actorId ? { ...a, actions: [...a.actions, added].sort((a, b) => a.startSec - b.startSec) } : a) };
  const result = manhuaPrevisSpecSchema.safeParse(next);
  if (!result.success) return { error: result.error.issues[0]?.message || "请先修正白模配置。" };
  return { spec: next };
}
