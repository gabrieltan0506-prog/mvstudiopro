/** 只记录当前静帧是否确实按所选造型生成，不代替人工画质审查。 */
export type ManhuaKeyartLookState = {
  required: string;
  generatedFor?: string;
  generatedUrl?: string;
};

export function normalizeManhuaKeyartLookState(
  raw: unknown
): ManhuaKeyartLookState | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw))
    return { required: "invalid" };
  const value = raw as Partial<ManhuaKeyartLookState>;
  return {
    required:
      typeof value.required === "string" && value.required
        ? value.required
        : "invalid",
    generatedFor:
      typeof value.generatedFor === "string" ? value.generatedFor : undefined,
    generatedUrl:
      typeof value.generatedUrl === "string" ? value.generatedUrl : undefined,
  };
}

export function isManhuaKeyartLookCurrent(block: {
  manhuaKeyartLookState?: unknown;
  outputUrl?: string | null;
}): boolean {
  const state = normalizeManhuaKeyartLookState(block.manhuaKeyartLookState);
  if (!state) return true;
  return (
    state.required !== "invalid" &&
    Boolean(block.outputUrl) &&
    state.required === state.generatedFor &&
    state.generatedUrl === block.outputUrl
  );
}

/** 静帧只随画面和造型失效；对白、说话人及声音留给成片与 TTS 校验。兼容旧版完整镜头回执。 */
export function isManhuaKeyartSourceCurrent(block: {
  manhuaKeyartSourceState?: unknown;
  outputUrl?: string | null;
}): boolean {
  const state = normalizeManhuaKeyartLookState(block.manhuaKeyartSourceState);
  if (!state) return true;
  if (state.required === "invalid" || !block.outputUrl || state.generatedUrl !== block.outputUrl || !state.generatedFor) return false;
  const visualSource = (raw: string): string => {
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) return raw;
      const visual = { ...value } as Record<string, unknown>;
      for (const key of ["dialogueZh", "dialogueSuppressed", "dialogueSpeakerNameZh", "additionalDialogueCues", "voiceToneZh", "soundZh"]) delete visual[key];
      return JSON.stringify(visual);
    } catch { return raw; }
  };
  return visualSource(state.required) === visualSource(state.generatedFor);
}

export function recordManhuaKeyartLookOutput(
  block: { manhuaKeyartLookState?: unknown },
  outputUrl?: string
): ManhuaKeyartLookState | undefined {
  const state = normalizeManhuaKeyartLookState(block.manhuaKeyartLookState);
  if (!state || !outputUrl) return state;
  return { ...state, generatedFor: state.required, generatedUrl: outputUrl };
}

/** 仅迁移同一张当前产物的地址表示；历史兜底或失败不能获得生成回执。 */
export function remapManhuaKeyartLookOutput(
  block: { manhuaKeyartLookState?: unknown; outputUrl?: string | null },
  mappedCurrentUrl: string | undefined
): ManhuaKeyartLookState | undefined {
  const state = normalizeManhuaKeyartLookState(block.manhuaKeyartLookState);
  if (!state || !block.outputUrl || state.generatedUrl !== block.outputUrl)
    return state;
  return { ...state, generatedUrl: mappedCurrentUrl };
}
