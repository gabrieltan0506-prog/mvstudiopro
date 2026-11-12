/**
 * 审稿改稿的大纲偏离兜底核对（代码规则，不调用模型）。
 * 从本集大纲条目取关键词/专名：引号内词，以及大纲与原稿共同出现的 2–4 字高频词；
 * 若某词在未修改版出现、在最终修改版完全消失，记为「可能偏离大纲」的提示项。
 */
import type { NovelOutlineImpact } from "./novelWorkspace";

/** 从整份大纲里取第 N 集的条目（「第N集：…」到下一集或下一段标题前）；取不到返回空串。 */
export function extractEpisodeOutline(outline: string, chapterIndex: number) {
  if (!outline) return "";
  const head = new RegExp(`(^|\\n)\\s*第\\s*${chapterIndex}\\s*集[：:\\s]`);
  const m = head.exec(outline);
  if (!m) return "";
  const start = m.index + m[1].length;
  const rest = outline.slice(start);
  const next = /\n\s*第\s*\d+\s*集[：:\s]/.exec(rest.slice(1));
  return (next ? rest.slice(0, next.index + 1) : rest).trim();
}

export type NovelOutlineDriftHint = { term: string; originalCount: number };

const QUOTED = /[“「『"《]([^”」』"》\n]{2,8})[”」』"》]/g;
/** 含这些虚字的 n-gram 不当专名。 */
const FUNCTION_CHARS = /[的了着过们是在和与就都也又把被让给对从向说道很不这那其之而以及并或个]/;
const LABELS = new Set(["剧情", "本集", "兑现", "片尾", "钩子", "本集兑现", "片尾钩子"]);

const count = (text: string, term: string) => {
  let n = 0;
  for (let at = text.indexOf(term); at >= 0; at = text.indexOf(term, at + term.length)) n++;
  return n;
};

/** 本集大纲条目里值得核对的关键词（专名、物件、地名等）。 */
export function outlineKeyTerms(item: string, original: string, limit = 8) {
  const terms = new Map<string, number>();
  for (const m of Array.from(item.matchAll(QUOTED))) {
    const term = m[1].trim();
    const n = count(original, term);
    if (term && n > 0) terms.set(term, n);
  }
  const grams = new Map<string, number>();
  const runs: string[] = item.match(/[一-鿿]{2,}/g) ?? [];
  for (const run of runs)
    for (let len = 2; len <= 4; len++)
      for (let i = 0; i + len <= run.length; i++) {
        const g = run.slice(i, i + len);
        if (grams.has(g) || LABELS.has(g) || FUNCTION_CHARS.test(g)) continue;
        const n = count(original, g);
        if (n >= 2) grams.set(g, n);
      }
  // 只留「极大」词：被更长且同频的词包含的短词去掉（「沈昭」与「沈昭跪」同频时留长的没有意义，反之亦然）。
  const maximal = Array.from(grams.entries()).filter(
    ([g, n]) =>
      !Array.from(grams.entries()).some(
        ([h, k]) => h !== g && h.includes(g) && k === n
      )
  );
  maximal.sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  for (const [g, n] of maximal) {
    if (terms.size >= limit) break;
    if (!Array.from(terms.keys()).some(t => t.includes(g))) terms.set(g, n);
  }
  return Array.from(terms.entries()).map(([term, n]) => ({ term, originalCount: n }));
}

/** 在未修改版出现、最终修改版完全消失的大纲关键词。 */
export function detectOutlineDrift(
  item: string,
  original: string,
  revised: string
): NovelOutlineDriftHint[] {
  if (!item.trim()) return [];
  return outlineKeyTerms(item, original).filter(t => !revised.includes(t.term));
}

export type NovelOutlineAlert = "none" | "partial" | "major";
/** 界面提醒级别：模型申报 major 或 ≥3 条 → major；partial 或代码核对有提示 → partial。 */
export function novelOutlineAlertLevel(
  impact: NovelOutlineImpact | undefined,
  hints: NovelOutlineDriftHint[]
): NovelOutlineAlert {
  if (impact && (impact.level === "major" || impact.items.length >= 3)) return "major";
  if ((impact && impact.level === "partial") || hints.length) return "partial";
  return "none";
}
