/**
 * 二级工具（3D 模型 / 本段动作白模 / 本段动作节奏 / 音轨工作台）该出现在哪里。
 *
 * 线上现状：这四个按钮**全阶段常驻**在顶部主操作簇里，跟「生成关键静帧」挤在一排。
 * 可是它们各自的对象只在特定阶段存在 —— 剧本阶段既没有本段也没有模型，
 * 按下去只能弹个空面板。对照图 06／07 点名：数字参数不常驻、声音只在相关段/镜头显示。
 *
 * 判据沿用仓里已有的那条（见 `manhuaCharacterEntry.ts`）：**就近优先，远端让位**，
 * 但反过来也成立 —— 对象不在场时不能直接删按钮，否则那个阶段就没有通路了。
 * 所以每个工具在任一阶段都**恰好有一个家**：
 *   对象在场的阶段 → 主操作簇（就近，一步可达）
 *   其它阶段       → 「更多操作」抽屉（收纳低频，不占主流程）
 *
 * 判据收口在这里，不散进 JSX：散着写下次一定漏一处。
 */
export type ManhuaSecondaryTool = "model3d" | "world3d" | "previs" | "actionTimeline" | "audio";

export const MANHUA_SECONDARY_TOOL_LABEL_ZH: Record<ManhuaSecondaryTool, string> = {
  model3d: "3D 模型",
  world3d: "3D 场景",
  previs: "本段动作白模",
  actionTimeline: "本段动作节奏",
  audio: "音轨工作台",
};

/** 每个工具的对象真正存在的阶段 */
const NATIVE_PHASES: Record<ManhuaSecondaryTool, readonly string[]> = {
  // 3D 模型挂在人物引用上，人物引用在资产阶段
  model3d: ["assets"],
  // 3D 场景挂在场景表上，同样只在资产阶段成立（对照图 03：场景管理与 3D 入口不该分散在全局）
  world3d: ["assets"],
  // 白模与动作节奏都针对「本段」，段在分镜阶段才成立
  previs: ["storyboard"],
  actionTimeline: ["storyboard"],
  // 声音跟着段与成片走：分镜阶段配段，成片阶段对轨
  audio: ["storyboard", "edit"],
};

export type ManhuaSecondaryToolHome = "cluster" | "drawer";

export function manhuaSecondaryToolHome(
  tool: ManhuaSecondaryTool,
  phase: string,
): ManhuaSecondaryToolHome {
  return NATIVE_PHASES[tool].includes(phase) ? "cluster" : "drawer";
}

/** 这个阶段要在抽屉里列出哪些工具（顺序固定，不随阶段跳动） */
export function manhuaDrawerSecondaryTools(phase: string): ManhuaSecondaryTool[] {
  return (["model3d", "world3d", "previs", "actionTimeline", "audio"] as const).filter(
    (tool) => manhuaSecondaryToolHome(tool, phase) === "drawer",
  );
}
