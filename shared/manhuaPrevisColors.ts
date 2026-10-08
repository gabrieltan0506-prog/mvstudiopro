/** 与渲染器的角色色板保持一致；按身份排序，不随镜头或演员列表重排变色。 */
export const PREVIS_ACTOR_COLORS = [
  { hex: "#38bdf8", nameZh: "天蓝" },
  { hex: "#fb923c", nameZh: "橙色" },
  { hex: "#c084fc", nameZh: "紫色" },
  { hex: "#facc15", nameZh: "黄色" },
  { hex: "#34d399", nameZh: "绿色" },
  { hex: "#f472b6", nameZh: "粉红" },
] as const;

type ColoredActor = { id: string; colorIndex?: number };
export function assignPrevisActorColors<T extends ColoredActor>(actors: readonly T[], previous: readonly ColoredActor[] = []): T[] {
  const assigned = new Map<string, number>();
  const used = new Set<number>();
  // 先保留已有身份颜色，再给新角色分配空余颜色。
  for (const actor of [...actors].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const color = previous.find(a => a.id === actor.id)?.colorIndex ?? actor.colorIndex;
    if (color !== undefined && Number.isInteger(color) && color >= 0 && color < 6 && !used.has(color)) {
      assigned.set(actor.id, color); used.add(color);
    }
  }
  for (const actor of [...actors].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (assigned.has(actor.id)) continue;
    const color = PREVIS_ACTOR_COLORS.findIndex((_, i) => !used.has(i));
    if (color < 0) throw new Error("白模最多支持六种角色颜色");
    assigned.set(actor.id, color); used.add(color);
  }
  return actors.map(actor => ({ ...actor, colorIndex: assigned.get(actor.id)! }));
}
export function previsActorColor(actorId: string, actors: readonly ColoredActor[]) {
  const actor = assignPrevisActorColors(actors).find(a => a.id === actorId);
  if (!actor) throw new Error("白模角色颜色身份无效");
  return PREVIS_ACTOR_COLORS[actor.colorIndex!];
}
