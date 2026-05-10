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

/** 與 buildTitleVariantsFromBlueprint 相同（舊名保留）。 */
export const buildTitleVariantsForBlueprint = buildTitleVariantsFromBlueprint;

/**
 * 封面這句話對「想不想點進來」的粗判（不報 CTR、不報假小數）。
 * 給用戶一句能不能照拍照發的去向提示。
 */
export function coverAppealHintForCover(title: string, hook: string): string {
  const t = (title || "").replace(/\s+/g, " ").trim();
  const h = (hook || "").replace(/\s+/g, " ").trim();
  let score = 0;
  const len = t.length;
  if (len >= 8 && len <= 44) score++;
  if (h.length >= 10) score++;
  if (/[？?！!]|[0-9]{1,2}|为什么|怎样|如何|别再|千万不要|我以为|其实/.test(t + h)) score++;
  if (score >= 3) {
    return "这句封面话信息够具体，按脚本拍、字够大通常更容易把人点进来；有没有带来咨询或变现，以你这条赛道真实反馈为准。";
  }
  if (score === 2) {
    return "可以首发。封面主句再大一点、对比再强一点，前 3 秒把结论亮出来，更容易拿到第一批互动。";
  }
  return "建议把封面主句再收紧一点（少一点空词、多一点可感知的结果），且正文不用改，调好再发。";
}
