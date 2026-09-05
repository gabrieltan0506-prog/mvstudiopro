/**
 * 分镜台词写回节拍/反推正文，供成片注入读取；静帧路径不读字面。
 */

const DIALOGUE_SECTION = "## 分镜台词";
/** 表内持久化 tombstone：区分“用户明确清空”与“本镜没有覆盖、继续继承剧本”。 */
export const MANHUA_DIALOGUE_SILENCE_TOKEN = "<无对白>";

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

/** 只修改传入镜号，保留同表其它镜的覆盖/清空状态。 */
export function patchShotDialogueSection(
  text: string,
  patch: Record<number, string>,
): string {
  const merged = { ...parseShotDialogueTable(text), ...patch };
  return upsertShotDialogueSection(text, merged);
}

export function applyShotDialoguesFromText<
  T extends { index: number; dialogueZh?: string; dialogueSuppressed?: boolean },
>(
  shots: T[],
  text: string,
): Array<T & { dialogueSuppressed?: boolean }> {
  const map = parseShotDialogueTable(text);
  if (!Object.keys(map).length) return shots;
  return shots.map((s) => {
    if (!Object.prototype.hasOwnProperty.call(map, s.index)) return s;
    const line = map[s.index];
    if (line === MANHUA_DIALOGUE_SILENCE_TOKEN) {
      return { ...s, dialogueZh: undefined, dialogueSuppressed: true };
    }
    return line ? { ...s, dialogueZh: line, dialogueSuppressed: false } : s;
  });
}
