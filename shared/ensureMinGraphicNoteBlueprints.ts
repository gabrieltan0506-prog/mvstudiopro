/**
 * Stage2 图文笔记配额：全案至少 N 条 format=图文，便于小红书测流。
 */

export function isGraphicNoteFormat(format: unknown): boolean {
  const f = String(format || "");
  return f.includes("图文") || f.includes("小红书");
}

/**
 * 不足 `minCount` 条图文时，从数组尾部把短视频改标为图文，并同步 xiaohongshu platformVariants。
 */
export function ensureMinGraphicNoteBlueprints<T extends Record<string, unknown>>(
  blueprints: T[],
  minCount = 3,
): T[] {
  const list = Array.isArray(blueprints) ? blueprints.map((b) => ({ ...b })) : [];
  if (list.length === 0) return list;
  const need = Math.min(Math.max(1, Math.floor(minCount)), list.length);
  let graphicCount = list.filter((b) => isGraphicNoteFormat(b.format)).length;
  if (graphicCount >= need) return list;

  for (let i = list.length - 1; i >= 0 && graphicCount < need; i--) {
    if (isGraphicNoteFormat(list[i]!.format)) continue;
    const b = { ...list[i]! } as T;
    (b as Record<string, unknown>).format = "图文";
    const platforms = Array.isArray(b.suitablePlatforms)
      ? (b.suitablePlatforms as unknown[]).map(String)
      : [];
    if (!platforms.some((p) => p.includes("小红书") || /xiaohongshu/i.test(p))) {
      (b as Record<string, unknown>).suitablePlatforms = ["小红书", ...platforms].slice(0, 6);
    }
    if (Array.isArray(b.platformVariants)) {
      (b as Record<string, unknown>).platformVariants = (b.platformVariants as Array<Record<string, unknown>>).map(
        (v) => {
          const pid = String(v?.platform || "");
          if (pid === "xiaohongshu" || pid.includes("小红书")) {
            return { ...v, format: "图文", reuseMainCopy: false };
          }
          return v;
        },
      );
    }
    list[i] = b;
    graphicCount += 1;
  }
  return list;
}
