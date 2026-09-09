/**
 * OpenAI 官方出图模型档位（0909 用户拍板）：
 * - flare：快、日常出图默认；
 * - sunburst：改图精度优先（官方措辞「Sunburst for workflows where editing precision matters most」）。
 * 文档：https://developers.openai.com/api/docs/guides/image-generation
 * 开关随 job payload 走，服务端据此选模型；WaveSpeed / EvoLink 兜底通道与此无关（它们仍是 gpt-image-2）。
 */
export type OpenAiImageVariant = "flare" | "sunburst";

export const OPENAI_IMAGE_VARIANT_DEFAULT: OpenAiImageVariant = "flare";

export const OPENAI_IMAGE_MODEL_BY_VARIANT: Record<OpenAiImageVariant, string> = {
  flare: "gpt-image-2.5-flare",
  sunburst: "gpt-image-2.5-sunburst",
};

export const OPENAI_IMAGE_VARIANT_LABEL_ZH: Record<OpenAiImageVariant, string> = {
  flare: "Flare · 快",
  sunburst: "Sunburst · 改图精度",
};

/** 前台记忆用的 localStorage 键（画布与知识卡共用同一开关） */
export const OPENAI_IMAGE_VARIANT_STORAGE_KEY = "mv.openaiImageVariant";

export function normalizeOpenAiImageVariant(raw: unknown): OpenAiImageVariant | null {
  const v = String(raw || "").trim().toLowerCase();
  return v === "flare" || v === "sunburst" ? v : null;
}
