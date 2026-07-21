/**
 * 分镜台词写回节拍/反推正文，供成片注入读取；静帧路径不读字面。
 */

const DIALOGUE_SECTION = "## 分镜台词";

export function parseShotDialogueTable(text: string): Record<number, string> {
  const out: Record<number, string> = {};
  const body = String(text || "");
  const section = body.match(/##\s*分镜台词\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/i);
  const chunk = section?.[1] || "";
  if (!chunk.trim()) return out;
  for (const line of chunk.split(/\r?\n/)) {
    const m = line.match(/^\|\s*(\d{1,2})\s*\|\s*([^|]*)\|/);
    if (!m?.[1]) continue;
    const idx = Math.max(1, parseInt(m[1], 10));
    const cell = String(m[2] || "")
      .trim()
      .replace(/^[「『"“]|[」』"”]$/g, "")
      .slice(0, 80);
    if (cell) out[idx] = cell;
  }
  return out;
}

/** 把台词 map 合并进反推/节拍正文（替换旧「分镜台词」段） */
export function upsertShotDialogueSection(
  text: string,
  dialogues: Record<number, string>,
): string {
  const base = String(text || "")
    .replace(/\n*##\s*分镜台词\s*\n[\s\S]*?(?=\n##\s|\n*$)/i, "")
    .trimEnd();
  const rows = Object.entries(dialogues)
    .map(([k, v]) => ({
      index: Number(k),
      line: String(v || "")
        .trim()
        .replace(/\|/g, "｜")
        .slice(0, 80),
    }))
    .filter((r) => Number.isFinite(r.index) && r.index >= 1 && r.line)
    .sort((a, b) => a.index - b.index);
  if (!rows.length) return base;
  const lines = [
    DIALOGUE_SECTION,
    "",
    "| 镜号 | 台词 |",
    "| --- | --- |",
    ...rows.map((r) => `| ${r.index} | ${r.line} |`),
  ];
  return `${base}\n\n${lines.join("\n")}\n`;
}

export function applyShotDialoguesFromText<T extends { index: number; dialogueZh?: string }>(
  shots: T[],
  text: string,
): T[] {
  const map = parseShotDialogueTable(text);
  if (!Object.keys(map).length) return shots;
  return shots.map((s) => {
    const line = map[s.index];
    return line ? { ...s, dialogueZh: line } : s;
  });
}
