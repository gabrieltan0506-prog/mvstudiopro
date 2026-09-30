/** 只规范提示词中的秒位文字；音轨、裁切和任务数值保留原始精度。 */
export function formatManhuaPromptSecond(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** 旧草稿与新稿走同一规则；对白、链接及焦距等其他数值不改。 */
export function normalizeManhuaPromptSeconds(text: string): string {
  return text.replace(
    /\{[^}]*\}|「[^」]*」|『[^』]*』|“[^”]*”|"[^"\n]*"|https?:\/\/[^\s]+|\d+(?:\.\d+)?\s*[–—-]\s*\d+(?:\.\d+)?\s*(?:s\b|秒)|\d+\.\d{2,}(?=\s*(?:s\b|秒))/g,
    (match) => /^(?:\{|「|『|“|"|https?:)/.test(match) ? match
      : match.replace(/\d+(?:\.\d+)?/g, value => formatManhuaPromptSecond(Number(value))),
  );
}
