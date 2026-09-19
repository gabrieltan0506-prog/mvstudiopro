/** 合成已有合同只支持直切与淡化；旧草稿保持淡化。 */
export type ManhuaEditTransition = "cut" | "fade";
export function normalizeManhuaEditTransitions(
  raw: unknown
): Record<string, ManhuaEditTransition> {
  const out: Record<string, ManhuaEditTransition> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (
      /^[1-9]\d*$/.test(key) &&
      Number.isSafeInteger(Number(key)) &&
      (value === "cut" || value === "fade")
    )
      out[key] = value;
  }
  return out;
}
export function manhuaEditTransitionOf(
  raw: Record<string, ManhuaEditTransition> | undefined,
  episode: number
): ManhuaEditTransition {
  return raw?.[String(episode)] === "cut" ? "cut" : "fade";
}
/** 合集只有一个转场参数；不同集设置冲突时明确拒绝，不能静默取当前集。 */
export function manhuaAssembleTransitionOf(
  raw: Record<string, ManhuaEditTransition>,
  clips: readonly { episodeIndex: number }[]
): ManhuaEditTransition | null {
  const values = new Set(
    clips.map(c => manhuaEditTransitionOf(raw, c.episodeIndex))
  );
  return values.size > 1 ? null : values.has("cut") ? "cut" : "fade";
}
