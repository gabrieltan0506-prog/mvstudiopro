/** 声音是分镜和剪辑的常用操作；其余二级工具保留在抽屉。 */
export type ManhuaSecondaryTool = "model3d" | "world3d" | "previs" | "actionTimeline" | "audio";

export const MANHUA_SECONDARY_TOOL_LABEL_ZH: Record<ManhuaSecondaryTool, string> = {
  model3d: "3D 模型",
  world3d: "3D 场景",
  previs: "本段动作白模",
  actionTimeline: "本段动作节奏",
  audio: "配音与背景音乐",
};

export type ManhuaSecondaryToolHome = "cluster" | "drawer";

export function manhuaSecondaryToolHome(
  tool: ManhuaSecondaryTool,
  phase: string,
  immersive = false,
): ManhuaSecondaryToolHome {
  if (immersive) return "drawer";
  if (tool === "audio" && (phase === "storyboard" || phase === "edit")) return "cluster";
  return "drawer";
}

/** 这个阶段要在抽屉里列出哪些工具（顺序固定，不随阶段跳动） */
export function manhuaDrawerSecondaryTools(phase: string, immersive = false): ManhuaSecondaryTool[] {
  return (["model3d", "world3d", "previs", "actionTimeline", "audio"] as const).filter(
    (tool) => manhuaSecondaryToolHome(tool, phase, immersive) === "drawer",
  );
}
