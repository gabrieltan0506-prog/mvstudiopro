export type PlatformTitleVariant = { id: "a" | "b" | "c"; title: string };

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** 与后端 prompt 主栏位一致的主标题（变体 A 必须与此对齐，避免用户以为换了选题）。 */
function canonicalMainTitle(bp: Record<string, unknown>, index: number): string {
  const t =
    bp.title ??
    bp["标题"] ??
    bp["选题标题"] ??
    bp.theme ??
    bp.titleExample ??
    "";
  const s = String(t).replace(/\s+/g, " ").trim();
  return s || `内容方案 ${index + 1}`;
}

function hookSnippet(bp: Record<string, unknown>): string {
  const h =
    bp.hook ??
    bp.openingHook ??
    bp["开头文案钩子"] ??
    bp.contentHook ??
    "";
  return String(h).replace(/\s+/g, " ").trim().slice(0, 32);
}

function copyOpeningSnippet(bp: Record<string, unknown>): string {
  const raw =
    bp.copywriting ??
    bp.body ??
    bp["核心文案方向"] ??
    bp["文案"] ??
    bp["正文"] ??
    "";
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (!s) return "";
  const first = s.split(/[。！？!?；;\n]/)[0] ?? s;
  return String(first).trim().slice(0, 72);
}

/**
 * 第三句主标：从正文开头或钩子衍生，与 A/B 尽量错开语感，供封面择优多一路。
 */
function buildThirdTitleCandidate(bp: Record<string, unknown>, main: string, second: string, index: number): string {
  const hook = hookSnippet(bp);
  const open = copyOpeningSnippet(bp);
  let cand =
    open.length >= 10 && open !== main && open !== second ? clip(open, 88) : "";
  if (!cand) {
    cand = hook
      ? clip(`一文说清：${hook}`, 88)
      : clip(`关于「${clip(main, 36)}」—多数人会忽略的关键`, 88);
  }
  if (cand === main || cand === second) cand = clip(`${main}·换一版开头（${index + 1}）`, 88);
  if (cand === main || cand === second || !cand.trim()) {
    cand = hook ? clip(`为什么${hook}值得现在看？`, 88) : clip(`「${clip(main, 40)}」—实操要点版`, 88);
  }
  return cand;
}

function readTitleAlternate(bp: Record<string, unknown>): string {
  const raw =
    bp.titleAlternate ??
    bp.titleAlt ??
    bp.alternateTitle ??
    bp.secondTitle ??
    bp["标题备选"] ??
    "";
  return String(raw).replace(/\s+/g, " ").trim();
}

/**
 * 同一条选题：发文大标 / 封面主句 **A·B·C 三路**（C 多取自正文开头或钩子衍生）。
 * 优先用 Stage2 模型输出的 titleAlternate 作 B；缺省时用规则补 B 与 C（不另起选题）。
 */
export function buildTitleVariantsFromBlueprint(bp: Record<string, unknown>, index: number): PlatformTitleVariant[] {
  const main = clip(canonicalMainTitle(bp, index), 88);
  const alt = readTitleAlternate(bp);
  if (alt.length >= 4 && alt !== main) {
    const second = clip(alt, 88);
    const third = buildThirdTitleCandidate(bp, main, second, index);
    return [
      { id: "a", title: main },
      { id: "b", title: second },
      { id: "c", title: third },
    ];
  }
  const hook = hookSnippet(bp);
  let second = hook
    ? clip(`为什么${hook}比你想象的更关键？`, 88)
    : clip(`关于「${clip(main, 40)}」，多数人忽略的一点`, 88);
  if (second === main) second = clip(`${main}（换一句开头）`, 88);
  if (!second || second === main) second = clip(`${main}·另一种说法`, 88);
  const third = buildThirdTitleCandidate(bp, main, second, index);
  return [
    { id: "a", title: main },
    { id: "b", title: second },
    { id: "c", title: third },
  ];
}

/**
 * 粗粒度「封面主句点击意图」分数（仅内部排序用，不对用户报 CTR 或小数）。
 * 分数高者优先作为出图与列表主标题。
 */
export function scoreTitleForCoverClickAppeal(title: string, hook: string): number {
  const t = (title || "").replace(/\s+/g, " ").trim();
  const h = (hook || "").replace(/\s+/g, " ").trim();
  let score = 0;
  const len = t.length;
  if (len >= 8 && len <= 44) score += 2;
  else if (len >= 6 && len <= 52) score += 1;
  if (h.length >= 10) score += 1;
  if (/[？?！!]|[0-9]{1,2}|为什么|怎样|如何|别再|千万不要|我以为|其实/.test(t + h)) score += 1;
  if (/痛|亏|秘密|真相|误区|后悔|千万别|居然|居然/.test(t)) score += 1;
  return score;
}

const CTR_BAND_HIGH_MIN_SCORE = 4;

/**
 * 依内部 {@link scoreTitleForCoverClickAppeal} 分成「高 / 中」两档，供封面生成后展示（非承诺实际 CTR）。
 */
export function estimateCoverCtrBand(
  topicHook: string,
  appealHook: string,
): { band: "high" | "medium"; score: number; labelZh: string } {
  const score = scoreTitleForCoverClickAppeal(topicHook, appealHook);
  const high = score >= CTR_BAND_HIGH_MIN_SCORE;
  return {
    band: high ? "high" : "medium",
    score,
    labelZh: high ? "预估点击率：高" : "预估点击率：中",
  };
}

/**
 * 在 A/B/C 中选与基线主标不同、且点击意图分最高者，供「超高点击率封面」再生成。
 */
export function pickHighCtrAlternateTitle(
  variants: PlatformTitleVariant[],
  hookSeed: string,
  baselineTitle: string,
): PlatformTitleVariant {
  const ranked = variants
    .map((v) => ({ v, s: scoreTitleForCoverClickAppeal(v.title, hookSeed) }))
    .sort((a, b) => b.s - a.s);
  const base = baselineTitle.replace(/\s+/g, " ").trim();
  for (const { v } of ranked) {
    if (v.title.replace(/\s+/g, " ").trim() !== base) return v;
  }
  return ranked[0]!.v;
}

/** 在 A/B/C 标题中选封面意图较高的一句；平手保留最先候选。 */
export function pickPreferredTitleVariant(variants: PlatformTitleVariant[], hook: string): PlatformTitleVariant {
  if (variants.length === 0) return { id: "a", title: "" };
  let best = variants[0]!;
  let bestScore = scoreTitleForCoverClickAppeal(best.title, hook);
  for (let i = 1; i < variants.length; i++) {
    const v = variants[i]!;
    const s = scoreTitleForCoverClickAppeal(v.title, hook);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return { id: "a", title: best.title };
}

/**
 * 后端 / 列表统一：自动选定一条主标题（不向用户展示二选一）。
 * 与 buildTitleVariantsFromBlueprint 同源种子，只输出胜者一条（id 统一为 a）。
 */
export function buildAutoPickedTitleVariantsForBlueprint(bp: Record<string, unknown>, index: number): PlatformTitleVariant[] {
  const pair = buildTitleVariantsFromBlueprint(bp, index);
  const hook = String(bp.hook ?? bp.openingHook ?? bp.contentHook ?? "").replace(/\s+/g, " ").trim();
  const w = pickPreferredTitleVariant(pair, hook);
  return [{ id: "a", title: w.title }];
}

/** 与 {@link buildTitleVariantsFromBlueprint} 同义（旧汇入名）。 */
export const buildTitleVariantsForBlueprint = buildTitleVariantsFromBlueprint;
