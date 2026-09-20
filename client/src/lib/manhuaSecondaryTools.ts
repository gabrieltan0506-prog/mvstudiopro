/** 二级工具统一收进更多操作，主操作区只承接当前制作步骤。 */
export type ManhuaSecondaryTool = "model3d" | "world3d" | "previs" | "actionTimeline" | "audio";

export const MANHUA_SECONDARY_TOOL_LABEL_ZH: Record<ManhuaSecondaryTool, string> = {
  model3d: "3D 模型",
  world3d: "3D 场景",
  previs: "本段动作白模",
  actionTimeline: "本段动作节奏",
  audio: "音轨工作台",
};

export type ManhuaSecondaryToolHome = "cluster" | "drawer";

export function manhuaSecondaryToolHome(
  _tool: ManhuaSecondaryTool,
  _phase: string,
): ManhuaSecondaryToolHome {
  return "drawer";
}

/** 这个阶段要在抽屉里列出哪些工具（顺序固定，不随阶段跳动） */
export function manhuaDrawerSecondaryTools(phase: string): ManhuaSecondaryTool[] {
  return (["model3d", "world3d", "previs", "actionTimeline", "audio"] as const).filter(
    (tool) => manhuaSecondaryToolHome(tool, phase) === "drawer",
  );
}
