/**
 * 合并媒体版本并去重。最新结果始终在首位，既有成片保留用于 A/B 与撤销。
 * 只接受可播放的 http(s) 地址，避免把空值或本地临时指针写进云草稿。
 */
export function mergeManhuaMediaVersions(
  newest: readonly (string | null | undefined)[],
  previous: readonly (string | null | undefined)[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...newest, ...previous]) {
    const url = String(value || "").trim();
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

const VIDEO_EDIT_SECTION_RE = /\n*【视频编辑指令】[^\n]*(?:\n|$)/g;

/** 在保留原导演提示词的前提下，仅替换一条有界的视频编辑指令。 */
export function applyManhuaVideoEditInstruction(
  prompt: string | null | undefined,
  instructionZh: string,
): string {
  const base = String(prompt || "").replace(VIDEO_EDIT_SECTION_RE, "\n").trim();
  const instruction = String(instructionZh || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  if (!instruction) return base;
  return `${base}\n\n【视频编辑指令】${instruction}`.trim();
}
