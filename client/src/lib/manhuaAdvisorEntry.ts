/** 只有实际进入漫剧模式才接管入口；同一路由的选择页和自由画布仍保留原工具。 */
export function isManhuaAdvisorPage(path: string, active = false): boolean {
  return active && path.split(/[?#]/)[0].replace(/\/+$/, "") === "/canvas";
}

let active = false;
const listeners = new Set<() => void>();
export const getManhuaAdvisorScope = () => active;
export function subscribeManhuaAdvisorScope(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** 仅由真实画布模式的宿主发布；不读取可能过期的 localStorage 选择。 */
export function publishManhuaAdvisorScope(next: boolean) {
  if (next === active) return;
  active = next;
  listeners.forEach((listener) => listener());
}

export const MANHUA_ADVISOR_STAGE_LABELS = {
  outline: "剧本大纲",
  assets: "资产设定",
  storyboard: "分镜",
  edit: "成片",
  final: "终审",
} as const;
