/**
 * 小说「爆款仿写」原创度自查：比对生成稿与用户上传的底稿。
 * 纯函数、无依赖、不调模型、不联网。
 */

/** 连续相同字符数阈值（归一化后，去掉空白与标点）。 */
export const NOVEL_ORIGINALITY_MIN_RUN = 12;

const MAX_NAME_OVERLAPS = 50;
const MAX_FRAGMENTS = 30;
const FRAGMENT_MAX_CHARS = 80;
const SUMMARY_FRAGMENT_LIMIT = 3;
const SUMMARY_FRAGMENT_CHARS = 30;
/** 同一窗口在底稿中最多记录的起点数，避免高度重复文本拖慢扩展。 */
const MAX_BASE_POSITIONS_PER_WINDOW = 4;

const OVERLAP_STRIP = new RegExp("[\\s\\p{P}\\p{S}]+", "gu");
/** 去掉空白、中英文标点与符号。 */
function normalizeForOverlap(text: string): string {
  // 用构造函数写 u 标志：仓库 tsconfig 目标低于 es6 时字面量 /u 过不了类型检查。
  return String(text || "").replace(OVERLAP_STRIP, "");
}

function charLength(s: string): number {
  return Array.from(s).length;
}

function truncateChars(s: string, max: number, ellipsis = ""): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  return chars.slice(0, max).join("") + ellipsis;
}

/** 返回 text 中出现的底稿专有名词：去重、按首次出现顺序，忽略长度 < 2 的词，最多 50 个。 */
export function findNovelNameOverlaps(text: string, names: string[]): string[] {
  const source = String(text || "");
  if (!source || !Array.isArray(names)) return [];
  const seen = new Set<string>();
  const hits: { name: string; at: number }[] = [];
  for (const raw of names) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name || charLength(name) < 2 || seen.has(name)) continue;
    seen.add(name);
    const at = source.indexOf(name);
    if (at >= 0) hits.push({ name, at });
  }
  hits.sort((a, b) => a.at - b.at);
  return hits.slice(0, MAX_NAME_OVERLAPS).map((h) => h.name);
}

/**
 * 找出 generated 中与 base 完全相同、长度 ≥ minChars 的极大连续片段（归一化后比较）。
 * 做法：base 的 minChars 长度子串建索引，在 generated 上滑窗命中后逐字向右扩展取最长，
 * 然后跳过已覆盖区域，同一处只报最长的一段。
 */
export function findNovelSentenceOverlaps(
  generated: string,
  base: string,
  minChars: number = NOVEL_ORIGINALITY_MIN_RUN,
): { fragment: string }[] {
  const run = Math.max(1, Math.floor(Number(minChars) || NOVEL_ORIGINALITY_MIN_RUN));
  const gen = normalizeForOverlap(generated);
  const src = normalizeForOverlap(base);
  if (gen.length < run || src.length < run) return [];

  const index = new Map<string, number[]>();
  for (let p = 0; p + run <= src.length; p++) {
    const key = src.slice(p, p + run);
    const list = index.get(key);
    if (!list) index.set(key, [p]);
    else if (list.length < MAX_BASE_POSITIONS_PER_WINDOW) list.push(p);
  }

  const out: { fragment: string }[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i + run <= gen.length && out.length < MAX_FRAGMENTS) {
    const starts = index.get(gen.slice(i, i + run));
    if (!starts) {
      i++;
      continue;
    }
    let best = run;
    for (const p of starts) {
      let len = run;
      while (i + len < gen.length && p + len < src.length && gen.charCodeAt(i + len) === src.charCodeAt(p + len)) len++;
      if (len > best) best = len;
    }
    const full = gen.slice(i, i + best);
    if (!seen.has(full)) {
      seen.add(full);
      out.push({ fragment: truncateChars(full, FRAGMENT_MAX_CHARS) });
    }
    i += best;
  }
  return out;
}

/** 给前台的中性原创度提示；都没有命中时返回空串。 */
export function summarizeNovelOriginality(input: {
  names: string[];
  fragments: { fragment: string }[];
  episode?: number;
}): string {
  const names = (input?.names || []).filter((n) => typeof n === "string" && n.trim());
  const fragments = (input?.fragments || []).filter((f) => f && typeof f.fragment === "string" && f.fragment);
  const lines: string[] = [];
  if (names.length) {
    lines.push(`以下名称与底稿重名，建议换成你自己的命名：${names.join("、")}`);
  }
  if (fragments.length) {
    const ep = input?.episode;
    const prefix = typeof ep === "number" && Number.isFinite(ep) ? `第${ep}集` : "";
    const quoted = fragments
      .slice(0, SUMMARY_FRAGMENT_LIMIT)
      .map((f) => `『${truncateChars(f.fragment, SUMMARY_FRAGMENT_CHARS, "…")}』`)
      .join("、");
    lines.push(`${prefix}有${fragments.length}处句子与底稿相同，建议改写：${quoted}`);
  }
  return lines.join("\n");
}
