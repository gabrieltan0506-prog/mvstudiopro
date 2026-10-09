/** 与渲染器的角色色板保持一致；按身份排序，不随镜头或演员列表重排变色。 */
import { PREVIS_MAX_ACTORS } from "./manhuaPrevisLimits";
const BASE_COLORS = [
  { hex: "#38bdf8", nameZh: "天蓝" },
  { hex: "#fb923c", nameZh: "橙色" },
  { hex: "#c084fc", nameZh: "紫色" },
  { hex: "#facc15", nameZh: "黄色" },
  { hex: "#34d399", nameZh: "绿色" },
  { hex: "#f472b6", nameZh: "粉红" },

 ] as const;
/** 后续颜色按金角扩展，与 Python 同一 HSL 算式及四舍五入。 */
function extraColor(index: number) {
  const h = ((index - 6) * 137.508) % 360;
  const c = (1 - Math.abs(2 * .6 - 1)) * .68;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = .6 - c / 2;
  const rgb = h < 60 ? [c,x,0] : h < 120 ? [x,c,0] : h < 180 ? [0,c,x] : h < 240 ? [0,x,c] : h < 300 ? [x,0,c] : [c,0,x];
  return { hex: "#" + rgb.map(v => Math.floor((v+m)*255+.5).toString(16).padStart(2,"0")).join(""), nameZh: `角色色${index+1}` };
}
export const PREVIS_ACTOR_COLORS = Array.from({length:PREVIS_MAX_ACTORS}, (_,index) => BASE_COLORS[index] ?? extraColor(index));

type ColoredActor = { id: string; colorIndex?: number };
export function assignPrevisActorColors<T extends ColoredActor>(actors: readonly T[], previous: readonly ColoredActor[] = []): T[] {
  const assigned = new Map<string, number>();
  const used = new Set<number>();
  // 先保留已有身份颜色，再给新角色分配空余颜色。
  for (const actor of [...actors].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const color = previous.find(a => a.id === actor.id)?.colorIndex ?? actor.colorIndex;
    if (color !== undefined && Number.isInteger(color) && color >= 0 && color < PREVIS_ACTOR_COLORS.length && !used.has(color)) {
      assigned.set(actor.id, color); used.add(color);
    }
  }
  for (const actor of [...actors].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    if (assigned.has(actor.id)) continue;
    const color = PREVIS_ACTOR_COLORS.findIndex((_, i) => !used.has(i));
    if (color < 0) throw new Error("角色颜色数量超过当前渲染预算可承载范围");
    assigned.set(actor.id, color); used.add(color);
  }
  return actors.map(actor => ({ ...actor, colorIndex: assigned.get(actor.id)! }));
}
export function previsActorColor(actorId: string, actors: readonly ColoredActor[]) {
  const actor = assignPrevisActorColors(actors).find(a => a.id === actorId);
  if (!actor) throw new Error("白模角色颜色身份无效");
  return PREVIS_ACTOR_COLORS[actor.colorIndex!];
}
