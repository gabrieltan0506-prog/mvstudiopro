export type PlatformTitleVariant = { id: "a" | "b" | "c"; title: string };

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** 與後端 prompt 主欄位一致的主標題（變體 A 必須與此對齊，避免用戶以為換了選題）。 */
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
 * 第三句主標：從正文開頭或鉤子衍生，與 A/B 盡量錯開語感，供封面择优多一路。
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
 * 同一條選題：發文大標 / 封面主句 **A·B·C 三路**（C 多取自正文開頭或鉤子衍生）。
 * 優先用 Stage2 模型輸出的 titleAlternate 作 B；缺省時用規則補 B 與 C（不另起選題）。
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
 * 粗粒度「封面主句點擊意圖」分數（僅內部排序用，不對用戶報 CTR 或小數）。
 * 分數高者優先作為出圖與列表主標題。
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

/** 在 A/B/C 標題中選封面意圖較高的一句；平手保留最先候選。 */
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
 * 後端 / 列表統一：自動選定一條主標題（不向用戶展示二選一）。
 * 與 buildTitleVariantsFromBlueprint 同源種子，只輸出勝者一條（id 統一為 a）。
 */
export function buildAutoPickedTitleVariantsForBlueprint(bp: Record<string, unknown>, index: number): PlatformTitleVariant[] {
  const pair = buildTitleVariantsFromBlueprint(bp, index);
  const hook = String(bp.hook ?? bp.openingHook ?? bp.contentHook ?? "").replace(/\s+/g, " ").trim();
  const w = pickPreferredTitleVariant(pair, hook);
  return [{ id: "a", title: w.title }];
}

/** 與 {@link buildTitleVariantsFromBlueprint} 同義（舊匯入名）。 */
export const buildTitleVariantsForBlueprint = buildTitleVariantsFromBlueprint;
