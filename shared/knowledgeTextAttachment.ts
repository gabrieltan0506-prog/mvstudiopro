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
  // 等价提速：原实现每个「文字模块×图章」对都重扫整张图章的二字片段（图章含整段图外细节，三千多个模块×30 章约 1.6 秒）。
  // 这里先按与 similarity 完全相同的表达式与累加顺序算好每章的范数，并建「片段→(章, 加权计数)」倒排表；
  // 每个模块只扫自身片段，按原顺序把 x*y 累加到各章 dot。缺席的片段原本加的是 x*0=+0，省略不改变浮点结果，
  // 因此得分逐位相同、取最大（并列取靠前）的结果与原实现一致。
  const weight = new Map<string, number>();
  const w = (g: string) => { let v = weight.get(g); if (v === undefined) { v = Math.log(1 + docs / (1 + (df.get(g) || 0))); weight.set(g, v); } return v; };
  const imageNorms = imageGrams.map(grams => { let nb = 0; for (const [g, c] of Array.from(grams)) { const y = c * w(g); nb += y * y; } return nb; });
  const postings = new Map<string, { image: number; count: number }[]>();
  imageGrams.forEach((grams, image) => { for (const [g, count] of Array.from(grams)) { let list = postings.get(g); if (!list) postings.set(g, list = []); list.push({ image, count }); } });
  const dot = new Float64Array(images.length);
  texts.forEach((text, t) => {
    dot.fill(0);
    let na = 0;
    for (const [g, c] of Array.from(textGrams[t]!)) {
      const x = c * w(g); na += x * x;
      const list = postings.get(g);
      if (list) for (const { image, count } of list) dot[image] += x * (count * w(g));
    }
    let best = 0, bestScore = -1;
    for (let i = 0; i < images.length; i++) {
      const nb = imageNorms[i]!;
      const score = na && nb ? dot[i]! / Math.sqrt(na * nb) : 0;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    result[best]!.push(`### ${text.headline}\n\n${text.body.trim()}`);
  });
  return result.map(parts => parts.join("\n\n"));
}

/** 原实现（对照用，测试逐项比对；生产不调用）。 */
export function attachKnowledgeTextModulesReference(images: readonly string[], texts: readonly { headline: string; body: string }[]): string[] {
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

/** 按原书顺序归属的文字模块：anchor = 原书中它前面最近一张图的序号（开头无图时为 0）。 */
export type KnowledgeOrderedTextModule = { headline: string; body: string; anchor: number };

const orderedBlock = (headline: string, body: string) => `### ${headline}\n\n${body.trim()}`;

/** 单个模块比可用页容量还长时按段落切块（段落仍过长才按字数切），标题加「（续n）」；只切不删。 */
function splitOversizedModule(text: KnowledgeOrderedTextModule, limit: number): KnowledgeOrderedTextModule[] {
  const room = Math.max(1000, limit - text.headline.length - 16);
  const paragraphs = text.body.trim().split(/\n\s*\n/).flatMap(p => {
    const out: string[] = [];
    for (let i = 0; i < p.length; i += room) out.push(p.slice(i, i + room));
    return out;
  });
  const chunks: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current && current.length + 2 + p.length > room) { chunks.push(current); current = ""; }
    current = current ? `${current}\n\n${p}` : p;
  }
  if (current) chunks.push(current);
  return chunks.map((body, k) => ({ headline: k ? `${text.headline}（续${k}）` : text.headline, body, anchor: text.anchor }));
}

/**
 * 按原书顺序把文字模块归到图页（站长 2026-11-20 口径：文字归文字，按原书顺序接在图后）。
 * - 自然归属：每个模块归到 anchor（它前面最近的图），保持原书先后；
 * - capacities[i] = 第 i 页还能放的字数（上限减去该页图外细节）。某页超容量时，以它为中心向两侧逐步扩大相邻图页窗口，
 *   直到窗口内文字不超过窗口容量的一半（全书本身更满时按全书比例），再把窗口内文字按原书顺序连续、按各页容量等比例重分；
 *   窗口外各页不动。只移动整块，不改写、不丢、不重排模块；单个模块超出页容量时先按段落切块。
 * 总量超过全部页容量时抛错（出图前即报，不扣费）。
 */
export function attachKnowledgeTextModulesInBookOrder(capacities: readonly number[], texts: readonly KnowledgeOrderedTextModule[]): string[] {
  const n = capacities.length;
  if (!n || !texts.length) return capacities.map(() => "");
  const caps = capacities.map(c => Math.max(0, c));
  const largest = Math.max(...caps);
  const units = texts.flatMap(t => {
    const anchor = Math.min(n - 1, Math.max(0, t.anchor));
    const block = orderedBlock(t.headline, t.body);
    return block.length + 2 > largest ? splitOversizedModule({ ...t, anchor }, largest) : [{ ...t, anchor }];
  }).map(t => ({ text: orderedBlock(t.headline, t.body), anchor: t.anchor }));
  const size = units.map(u => u.text.length + 2);
  const assign = units.map(u => u.anchor);
  const load = new Float64Array(n);
  units.forEach((_, u) => { load[assign[u]!] += size[u]!; });
  const totalLoad = size.reduce((a, b) => a + b, 0), totalCap = caps.reduce((a, b) => a + b, 0);
  if (totalLoad > totalCap) throw new Error(`图外文字合计约 ${totalLoad.toLocaleString()} 字，超过全部 ${n} 页可容纳的 ${totalCap.toLocaleString()} 字，尚未开始出图、未扣费`);
  const fill = Math.max(0.5, totalLoad / totalCap);
  // 窗口内单元（assign 单调不减，所以是一段连续区间）。
  const range = (l: number, r: number) => {
    let a = assign.findIndex(x => x >= l); if (a < 0) a = units.length;
    let b = a; while (b < units.length && assign[b]! <= r) b++;
    return [a, b] as const;
  };
  const redistribute = (l: number, r: number) => {
    const [a, b] = range(l, r);
    let windowLoad = 0, windowCap = 0;
    for (let u = a; u < b; u++) windowLoad += size[u]!;
    for (let k = l; k <= r; k++) windowCap += caps[k]!;
    if (windowLoad > windowCap * fill) return false;
    const ratio = windowLoad / windowCap;
    const next = new Float64Array(r - l + 1);
    const target: number[] = []; let acc = 0;
    for (let k = l; k <= r; k++) { acc += caps[k]! * ratio; target.push(acc); }
    const placed: number[] = [];
    let k = 0, before = 0;
    for (let u = a; u < b; u++) {
      // 中点落在哪一页的累计目标内就归哪一页；放不下顺延下一页（单调，保持原书顺序）。
      while (k < r - l && before + size[u]! / 2 > target[k]!) k++;
      while (k <= r - l && next[k]! + size[u]! > caps[l + k]!) k++;
      if (k > r - l) return false;
      next[k] += size[u]!; placed.push(l + k); before += size[u]!;
    }
    placed.forEach((page, i) => { assign[a + i] = page; });
    for (let j = l; j <= r; j++) load[j] = next[j - l]!;
    return true;
  };
  for (let i = 0; i < n; i++) {
    if (load[i]! <= caps[i]!) continue;
    let l = i, r = i, grow = 0;
    while (!redistribute(l, r)) {
      if (l === 0 && r === n - 1) throw new Error("图外文字无法按原书顺序装入各页，尚未开始出图、未扣费");
      // 两侧交替扩大；一侧到头就只扩另一侧。
      if ((grow++ % 2 === 0 && r < n - 1) || l === 0) r++; else l--;
    }
    i = Math.max(-1, l - 1);
  }
  const result = capacities.map(() => [] as string[]);
  units.forEach((unit, u) => result[assign[u]!]!.push(unit.text));
  return result.map(parts => parts.join("\n\n"));
}
