/** 沿用既有对白编译器的控制标签；阶段名称不参与朗读文本编译。 */
export const CANVAS_DIALOGUE_EMOTION_TAGS = [
  "crying", "sad", "angry", "shouting", "amazed", "panicked", "trembling", "whispers",
  "excited", "sarcastic", "scornful", "curious", "tired", "mischievously", "empathetic",
  "reluctantly", "serious", "very slowly", "very fast",
] as const;
/** 官方富语言标签在文本中的当前位置插入拟声，不改变后续台词语气。 */
export const CANVAS_DIALOGUE_SOUND_TAGS = ["cough", "gasp"] as const;
const tags = new Set<string>([...CANVAS_DIALOGUE_EMOTION_TAGS, ...CANVAS_DIALOGUE_SOUND_TAGS]);

/** 免费的情境演技建议；只产生供应商支持的控制标签，不改用户台词或添加拟声。 */
export function suggestCanvasDialogueEmotion(input: { textZh: string; speakerZh: string; shotZh: string }): { tag: string; reasonZh: string } | undefined {
  const line = input.textZh.replace(/\[[^\]]+\]/g, "").trim();
  if (!line) return undefined;
  if (/好痛|疼死|痛死|痛得/.test(line)) return { tag: "[trembling]", reasonZh: "疼痛中强撑，声线带颤" };
  if (/[？?]/.test(line) && /血|伤|性命|怎么回事|怎麼回事/.test(line))
    return { tag: "[trembling]", reasonZh: "担忧追问，避免平板念句" };
  if (/伤还没好|傷還沒好/.test(line))
    return { tag: "[trembling]", reasonZh: "担心对方受伤，话到嘴边停住" };
  if (/撑得住|撐得住|我没事|我沒事/.test(line))
    return { tag: "[serious]", reasonZh: "压住伤痛作出决定" };
  if (/不伤性命|不傷性命|药只能|藥只能/.test(line))
    return { tag: "[serious]", reasonZh: "医者克制地说明风险" };
  if (/先睡|别怕|別怕|快到了|快到/.test(line))
    return { tag: "[empathetic]", reasonZh: "安抚对方，语气放软" };
  if (/咳|喘/.test(line) && /娘|母/.test(input.speakerZh))
    return { tag: "[tired]", reasonZh: "病中气息虚弱；拟声仍以台词内标签为准" };
  if (/！|!/.test(line) && /冲|快|救/.test(input.shotZh))
    return { tag: "[shouting]", reasonZh: "紧急动作中的喊话" };
  return undefined;
}

/** 旧候选和手动选择保持原样；新句只在未选择语气时自动采用建议。 */
export function resolveCanvasDialogueEmotion(input: {
  textZh: string; speakerZh: string; shotZh: string;
  emotion: string; autoEmotion?: boolean; hasCandidates: boolean;
}): string {
  if (input.autoEmotion === false || input.emotion.trim() || input.hasCandidates) return input.emotion;
  return suggestCanvasDialogueEmotion(input)?.tag || input.emotion;
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
