export function buildVoicePrompt(input: {
  dialogueText?: string;
  style?: string;
  language?: string;
}) {
  const language = String(input.language || "中文").trim() || "中文";
  const style = String(input.style || "电影预告片旁白").trim() || "电影预告片旁白";

  return [
    `${language}旁白。`,
    `风格：${style}。`,
    "声音要求：低沉、清晰、富有张力、节奏稳定、情绪推进明确。",
    "适配电影级叙事与预告片表达。",
  ].join(" ");
}
