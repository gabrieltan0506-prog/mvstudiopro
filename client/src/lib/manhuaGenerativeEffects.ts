/** These presets prepare editable instructions for the existing video-edit path, not additional model capabilities. */
export const MANHUA_GENERATIVE_EFFECT_PRESETS = [
  { id: "custom", label: "自定义修改", instruction: "", hint: "直接描述要改的画面，原片与编辑候选分别保留。" },
  { id: "transformation", label: "角色变身", instruction: "让修改对象逐步变为能量化战斗形态，以连续的光纹扩散和外观变化表现转化过程；保留可识别的面部身份与原有动作节奏。", hint: "适合整体形态变化，生成结果仍需检查身份和动作。" },
  { id: "spirit", label: "灵体与材质", instruction: "将修改对象的表面转为半透明灵体材质，边缘泛起柔和光晕，内部带有流动微光；保持原片形状、表情、运动方向与接触关系。", hint: "通过画面编辑描述材质变化，不是三维模型材质参数。" },
  { id: "environment", label: "环境重构", instruction: "让修改对象所在的背景环境逐步化为漂浮光粒，再重组成超现实空间；保留前景主体、镜头运动和原片事件节奏。", hint: "请写清变化的背景对象，避免把整片主体也列为修改目标。" },
  { id: "stylized", label: "风格化冲击", instruction: "围绕修改对象的动作加入手绘式冲击线、能量轮廓和短促光闪，强化动作爆发瞬间；保持动作起落、主体轮廓和镜头时序。", hint: "效果由模型重新生成，精确位置与时刻需回看候选确认。" },
] as const;
export type ManhuaGenerativeEffectPresetId = typeof MANHUA_GENERATIVE_EFFECT_PRESETS[number]["id"];
export type ManhuaGenerativeEffectDraft = {
  presetId: ManhuaGenerativeEffectPresetId;
  target: string;
  instruction: string;
  range?: { startSec: number; endSec: number };
};

export function compileManhuaGenerativeEffectInstruction(draft: ManhuaGenerativeEffectDraft, sourceDurationSec?: number): string {
  const target = draft.target.replace(/\s+/g, " ").trim();
  const instruction = draft.instruction.replace(/\s+/g, " ").trim();
  if (!instruction) throw new Error("请填写本次修改要求");
  if (draft.presetId !== "custom" && !target) throw new Error("请写清特效作用的角色或环境对象");
  if (target.length > 60) throw new Error("修改对象请控制在60字以内");
  let range = "";
  if (draft.range) {
    const { startSec, endSec } = draft.range;
    if (![startSec, endSec].every(Number.isFinite) || startSec < 0 || endSec <= startSec) throw new Error("请填写有效的片内开始和结束秒位");
    if (!(sourceDurationSec && Number.isFinite(sourceDurationSec))) throw new Error("请等待原片读取时长后再指定时段");
    if (endSec > sourceDurationSec + 1e-9) throw new Error("修改时段超过原片时长");
    range = `时段：原片${startSec}—${endSec}秒。`;
  }
  const result = [target ? `修改对象：${target}。` : "", range, instruction].join("");
  if (result.length > 240) throw new Error(`完整修改要求共${result.length}字，请精简到240字以内；不会自动截断`);
  return result;
}
