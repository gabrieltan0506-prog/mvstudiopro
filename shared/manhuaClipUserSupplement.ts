/**
 * 段成片提示词分成两层：系统每次从剧本/资产/引擎重编译主体；用户只维护末尾补充。
 * 这样改台词、换引擎、恢复草稿时主体可更新，人工意图不会被 ensure 静默覆盖。
 */
export const MANHUA_CLIP_USER_SUPPLEMENT_MARKER = "【用户补充】";

export function extractManhuaClipUserSupplement(
  prompt: string | null | undefined,
): string {
  const text = String(prompt || "");
  const index = text.lastIndexOf(MANHUA_CLIP_USER_SUPPLEMENT_MARKER);
  if (index < 0) return "";
  return text
    .slice(index + MANHUA_CLIP_USER_SUPPLEMENT_MARKER.length)
    .replace(/^\s*\n?/, "")
    .trim();
}

export function stripManhuaClipUserSupplement(
  prompt: string | null | undefined,
): string {
  const text = String(prompt || "");
  const index = text.lastIndexOf(MANHUA_CLIP_USER_SUPPLEMENT_MARKER);
  return (index < 0 ? text : text.slice(0, index)).trimEnd();
}

export function upsertManhuaClipUserSupplement(
  prompt: string | null | undefined,
  supplement: string | null | undefined,
): string {
  const base = stripManhuaClipUserSupplement(prompt);
  const extra = String(supplement || "").trim();
  return extra
    ? `${base}\n\n${MANHUA_CLIP_USER_SUPPLEMENT_MARKER}\n${extra}`.trim()
    : base;
}

export function mergeManhuaDerivedClipPrompt(
  derivedPrompt: string,
  existingPrompt: string | null | undefined,
): string {
  return upsertManhuaClipUserSupplement(
    stripManhuaClipUserSupplement(derivedPrompt),
    extractManhuaClipUserSupplement(existingPrompt),
  );
}
