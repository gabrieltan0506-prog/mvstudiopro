/**
 * 把无图文字模块并入内容最相关的图章（用户 2026-11-08：图文手册取其精华，不按原书顺序排版，
 * 文字模块并到相关章节内文中）。只做确定性的文本相似度归属，不改写任何文字、不丢模块。
 */
const clean = (s: string) => s
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/〔参考原页[^〕]*〕/g, "")
  .replace(/[#>*|`\-:：，。、；！？（）()［］\[\]「」“”"'·\s\d]/g, "");

function bigrams(text: string) {
  const s = clean(text), out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

function similarity(a: Map<string, number>, b: Map<string, number>, df: Map<string, number>, docs: number) {
  let dot = 0, na = 0, nb = 0;
  const w = (g: string) => Math.log(1 + docs / (1 + (df.get(g) || 0)));
  for (const [g, c] of Array.from(a)) { const x = c * w(g); na += x * x; const y = (b.get(g) || 0) * w(g); dot += x * y; }
  for (const [g, c] of Array.from(b)) { const y = c * w(g); nb += y * y; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** 返回与 images 同长的补充资料数组；每个文字模块恰好并入一章，保留原标题与原文。 */
export function attachKnowledgeTextModules(images: readonly string[], texts: readonly { headline: string; body: string }[]): string[] {
  const result = images.map(() => [] as string[]);
  if (!images.length || !texts.length) return result.map(() => "");
  const imageGrams = images.map(bigrams);
  const textGrams = texts.map(t => bigrams(`${t.headline}\n${t.headline}\n${t.body}`));
  const df = new Map<string, number>();
  for (const grams of [...imageGrams, ...textGrams]) for (const g of Array.from(grams.keys())) df.set(g, (df.get(g) || 0) + 1);
  const docs = imageGrams.length + textGrams.length;
  texts.forEach((text, t) => {
    let best = 0, bestScore = -1;
    imageGrams.forEach((grams, i) => {
      const score = similarity(textGrams[t]!, grams, df, docs);
      if (score > bestScore) { best = i; bestScore = score; }
    });
    result[best]!.push(`### ${text.headline}\n\n${text.body.trim()}`);
  });
  return result.map(parts => parts.join("\n\n"));
}

/** 在候选文本中找与查询内容最相近的一项（同一套二字片段 TF-IDF 相似度）；无候选返回 -1。 */
export function bestKnowledgeTextMatch(candidates: readonly string[], query: string): number {
  if (!candidates.length) return -1;
  const grams = candidates.map(bigrams), q = bigrams(query);
  const df = new Map<string, number>();
  for (const g of [...grams, q]) for (const key of Array.from(g.keys())) df.set(key, (df.get(key) || 0) + 1);
  let best = 0, score = -1;
  grams.forEach((g, i) => { const s = similarity(q, g, df, grams.length + 1); if (s > score) { best = i; score = s; } });
  return best;
}
