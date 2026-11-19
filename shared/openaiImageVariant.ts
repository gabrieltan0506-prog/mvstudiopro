/**
 * OpenAI 官方出图模型档位（0909 用户拍板）：
 * - flare：快、日常出图默认；
 * - sunburst：改图精度优先（官方措辞「Sunburst for workflows where editing precision matters most」）。
 * 文档：https://developers.openai.com/api/docs/guides/image-generation
 * 开关随 job payload 走，服务端据此选模型；EvoLink 随档位同样走 gpt-image-2.5，WaveSpeed 兜底仍是 gpt-image-2。
 */
export type OpenAiImageVariant = "flare" | "sunburst";

export const OPENAI_IMAGE_VARIANT_DEFAULT: OpenAiImageVariant = "flare";

/**
 * 图文知识手册配图唯一授权档（站长令 1119：只准 GPT Image 2.6 Sunburst 高质量，禁 Flare）。
 * 手册路径不读前台偏好（偏好为空/缺失时 OPENAI_IMAGE_VARIANT_DEFAULT 会落到 flare）；
 * 服务端按本常量自行绑定，客户端传来的其他档位一律在建占位与扣费之前拒绝。
 * 其他业务（画布等）的默认档不受影响。
 */
export const HANDBOOK_IMAGE_VARIANT = "sunburst" as const satisfies OpenAiImageVariant;
export const HANDBOOK_IMAGE_MODEL = "gpt-image-2.6-sunburst" as const;
export const HANDBOOK_IMAGE_QUALITY = "high" as const;
/** 普通用户只看到档名；精确模型名只在 debug 面板显示。 */
export const HANDBOOK_IMAGE_TIER_LABEL_ZH = "高精度档 · 4K";

/** 手册配图请求的档位门禁：未带档位由服务端绑定授权档；带了其他档位即拒绝。 */
export function handbookImageVariantAuthorized(raw: unknown): boolean {
  return raw === undefined || raw === null || raw === HANDBOOK_IMAGE_VARIANT;
}

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

/** 前台开关三档：flare / sunburst / both（两档各出一张，便于对比；扣两张的费） */
export type OpenAiImageVariantMode = OpenAiImageVariant | "both";
export const OPENAI_IMAGE_VARIANT_MODE_LABEL_ZH: Record<OpenAiImageVariantMode, string> = {
  flare: "Flare · 快",
  sunburst: "Sunburst · 改图精度",
  both: "双档各一张",
};
export function normalizeOpenAiImageVariantMode(raw: unknown): OpenAiImageVariantMode | null {
  const v = String(raw || "").trim().toLowerCase();
  return v === "flare" || v === "sunburst" || v === "both" ? v : null;
}
