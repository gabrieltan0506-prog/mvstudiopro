export function buildVoicePrompt(input: {
  dialogueText?: string;
  style?: string;
  language?: string;
}) {
  const language = String(input.language || "中文").trim() || "中文";
  const style = String(input.style || "电影预告片旁白").trim() || "电影预告片旁白";
  const hasText = Boolean(String(input.dialogueText || "").trim());
  const base = `${language}，${style}，低沉清晰富有张力，语速稳定，强调史诗感与情绪推进。`;
  return hasText ? base : `${base} 无台词时保持自然呼吸与稳定节奏。`;
}
