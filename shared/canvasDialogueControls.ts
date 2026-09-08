/** 沿用既有对白编译器的控制标签；阶段名称不参与朗读文本编译。 */
export const CANVAS_DIALOGUE_EMOTION_TAGS = [
  "crying", "sad", "angry", "shouting", "amazed", "panicked", "trembling", "whispers",
  "excited", "sarcastic", "scornful", "curious", "tired", "mischievously", "empathetic",
  "reluctantly", "serious", "very slowly", "very fast",
] as const;
const tags = new Set<string>(CANVAS_DIALOGUE_EMOTION_TAGS);

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
