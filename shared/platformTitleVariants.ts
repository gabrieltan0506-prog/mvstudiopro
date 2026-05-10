export type PlatformTitleVariant = { id: "a" | "b"; title: string };

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
 * 同一條選題、同一套正文與鉤子：僅「發文大標 / 封面主句」兩種說法。
 * 優先用 Stage2 模型輸出的 titleAlternate；缺省時用規則補第二句（不另起選題）。
 */
export function buildTitleVariantsFromBlueprint(bp: Record<string, unknown>, index: number): PlatformTitleVariant[] {
  const main = clip(canonicalMainTitle(bp, index), 88);
  const alt = readTitleAlternate(bp);
  if (alt.length >= 4 && alt !== main) {
    return [
      { id: "a", title: main },
      { id: "b", title: clip(alt, 88) },
    ];
  }
  const hook = hookSnippet(bp);
  let second = hook
    ? clip(`为什么${hook}比你想象的更关键？`, 88)
    : clip(`关于「${clip(main, 40)}」，多数人忽略的一点`, 88);
  if (second === main) second = clip(`${main}（换一句开头）`, 88);
  if (!second || second === main) second = clip(`${main}·另一种说法`, 88);
  return [
    { id: "a", title: main },
    { id: "b", title: second },
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

/** 在 A/B 兩句標題中選封面意圖較高的一句；平手保留 A。 */
export function pickPreferredTitleVariant(variants: PlatformTitleVariant[], hook: string): PlatformTitleVariant {
  if (variants.length === 0) return { id: "a", title: "" };
  const a = variants[0]!;
  if (variants.length === 1) return { id: "a", title: a.title };
  const b = variants[1]!;
  const sa = scoreTitleForCoverClickAppeal(a.title, hook);
  const sb = scoreTitleForCoverClickAppeal(b.title, hook);
  if (sb > sa) return { id: "a", title: b.title };
  return { id: "a", title: a.title };
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
