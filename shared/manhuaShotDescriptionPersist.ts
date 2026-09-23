/** 当前镜画面描述覆盖表；原稿不改写，旧稿没有此段时保持原样。 */
const SECTION = "## 分镜画面描述";

export function parseShotDescriptionTable(text: string): Record<number, string> {
  const out: Record<number, string> = {};
  const section = String(text || "").match(/##\s*分镜画面描述\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i);
  for (const line of (section?.[1] || "").split(/\r?\n/)) {
    const match = line.match(/^\|\s*(\d+)\s*\|\s*([^|]*)\|/);
    if (!match?.[1]) continue;
    const value = String(match[2] || "").trim();
    if (value) out[Number(match[1])] = value;
  }
  return out;
}

export function patchShotDescriptionSection(text: string, patch: Record<number, string>): string {
  const base = String(text || "")
    .replace(/\n*##\s*分镜画面描述\s*\n[\s\S]*?(?=\n##\s|\n*$)/i, "")
    .trimEnd();
  const rows = Object.entries({ ...parseShotDescriptionTable(text), ...patch })
    .map(([index, value]) => ({ index: Number(index), value: String(value || "").trim().replace(/\s*\r?\n\s*/g, " ").replace(/\|/g, "｜") }))
    .filter(row => Number.isInteger(row.index) && row.index >= 1 && row.value)
    .sort((a, b) => a.index - b.index);
  if (!rows.length) return base;
  return `${base}\n\n${SECTION}\n\n| 镜号 | 画面描述 |\n| --- | --- |\n${rows.map(row => `| ${row.index} | ${row.value} |`).join("\n")}\n`;
}

export function applyShotDescriptionsFromText<T extends { index: number; actionZh?: string }>(shots: T[], text: string): T[] {
  const descriptions = parseShotDescriptionTable(text);
  return shots.map(shot => descriptions[shot.index] ? { ...shot, actionZh: descriptions[shot.index] } : shot);
}
