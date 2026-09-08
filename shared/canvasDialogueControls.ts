/** 沿用既有对白编译器的控制标签；阶段名称不参与朗读文本编译。 */
export const CANVAS_DIALOGUE_EMOTION_TAGS = [
  "crying", "sad", "angry", "shouting", "amazed", "panicked", "trembling", "whispers",
  "excited", "sarcastic", "scornful", "curious", "tired", "mischievously", "empathetic",
  "reluctantly", "serious", "very slowly", "very fast",
] as const;
const tags = new Set<string>(CANVAS_DIALOGUE_EMOTION_TAGS);

/** 中文选择仅映射现有控制，不扩展供应商合同，也不替用户改变声线。 */
export const CANVAS_DIALOGUE_EMOTION_LABELS: Record<typeof CANVAS_DIALOGUE_EMOTION_TAGS[number], string> = {
  crying: "哭泣", sad: "悲伤", angry: "愤怒", shouting: "高声呼喊",
  amazed: "惊讶", panicked: "惊慌", trembling: "声音颤抖", whispers: "轻声耳语",
  excited: "兴奋", sarcastic: "讽刺", scornful: "轻蔑", curious: "好奇",
  tired: "疲惫", mischievously: "俏皮", empathetic: "关切安抚",
  reluctantly: "不情愿", serious: "坚定严肃", "very slowly": "放慢语速", "very fast": "加快语速",
};
export const CANVAS_DIALOGUE_CONTROL_GROUPS = [
  { labelZh: "情绪", tags: ["serious", "empathetic", "angry", "sad", "amazed", "panicked", "excited", "curious", "tired", "sarcastic", "scornful", "mischievously", "reluctantly"] },
  { labelZh: "表达方式", tags: ["crying", "shouting", "trembling", "whispers", "very slowly", "very fast"] },
] as const;

export function toggleCanvasDialogueControl(emotion: string, tag: typeof CANVAS_DIALOGUE_EMOTION_TAGS[number]): string {
  const control = `[${tag}]`;
  // 只修改用户点选项，保留其他标签顺序及不认识的旧内容，后者仍由原生成门禁拒绝。
  return emotion.includes(control) ? emotion.split(control).join("").trim() : `${emotion.trim()}${control}`;
}

export function assertCanvasDialogueInputControls(input: string): void {
  const remainder = input.replace(/\[([^\[\]]+)\]/g, (_match, name: string) => {
    if (!tags.has(name)) throw new Error("语气标签不在支持范围，请选择已列出的表演标签");
    return "";
  });
  if (/[\[\]]/.test(remainder)) throw new Error("语气标签括号不完整，请检查后再生成");
  if (!remainder.trim()) throw new Error("请填写要朗读的台词");
}

export function compileCanvasDialogueInput(textZh: string, emotion: string): string {
  const controls = emotion.trim();
  if (controls.replace(/\[([^\[\]]+)\]/g, "").trim()) {
    throw new Error("语气只接受表演标签，如 [serious][empathetic]；不要填写需要朗读的说明文字");
  }
  const compiled = `${controls}${textZh.trim()}`;
  assertCanvasDialogueInputControls(compiled);
  if (compiled.length > 4000) throw new Error("本句配音文本超过处理上限，请缩短后再生成");
  return compiled;
}
