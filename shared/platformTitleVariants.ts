export type PlatformTitleVariant = { id: "a" | "b"; title: string };

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function baseTitleFromBlueprint(bp: Record<string, unknown>, index: number): string {
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

/** 兩條可直接上線的標題文案（無模型分數、無隨機造假）。 */
export function buildTitleVariantsForBlueprint(bp: Record<string, unknown>, index: number): PlatformTitleVariant[] {
  const base = baseTitleFromBlueprint(bp, index);
  const hook = hookSnippet(bp);
  let a =
    hook && !base.includes(hook) ? clip(`${base}｜${hook}`, 88) : clip(base, 88);
  let b = hook
    ? clip(`为什么${hook}比你想象的更关键？`, 88)
    : clip(`关于「${clip(base, 40)}」，多数人忽略的一点`, 88);

  if (b === a) {
    b = clip(`${base}（换一句开头）`, 88);
  }
  if (!a) a = base;
  if (!b || b === a) b = clip(`${base}·第二条`, 88);

  return [
    { id: "a", title: a },
    { id: "b", title: b },
  ];
}
