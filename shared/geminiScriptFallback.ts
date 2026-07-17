/**
 * Canvas geminiScript：Pro 瞬时 503/429 时回退 Flash（角色卡历史上易挂）。
 * 对外错误文案仍只说「算力紧张」，不泄漏模型名。
 */

export const GEMINI_SCRIPT_DEFAULT_MODEL = "gemini-3.1-pro-preview";
export const GEMINI_SCRIPT_FALLBACK_MODEL = "gemini-3-flash-preview";

/** Pro 主模型失败后可换的 Flash；非 Pro 不换，避免无意义二次请求 */
export function resolveGeminiScriptFallbackModel(primary: string | undefined | null): string | null {
  const m = String(primary || "").trim();
  if (!m) return GEMINI_SCRIPT_FALLBACK_MODEL;
  if (/gemini-3\.1.*pro/i.test(m) || /^gemini-3\.1-pro/i.test(m)) {
    return GEMINI_SCRIPT_FALLBACK_MODEL;
  }
  return null;
}
