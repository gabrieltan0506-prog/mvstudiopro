/**
 * 图文卡提练/OCR 模型（三选一，无主备层级）。
 * - Evolink GPT-5.6 Sol
 * - OpenRouter Kimi K3
 * - Evolink Qwen3.8 Max
 *
 * 页费含提练/OCR+出图；按模型上游成本差异定档（成本约 ×1.65，相对旧 25 不涨太多）。
 *
 * @see https://evolink.ai/gpt-5-6
 * @see https://evolink.ai/docs/cn/api-manual/language-series/qwen3.8-max/qwen3.8-max-chat
 * @see https://openrouter.ai/moonshotai/kimi-k3
 */

/** Evolink GPT-5.6 Sol */
export const KNOWLEDGE_CARD_DISTILL_MODEL_SOL = "gpt-5.6-sol" as const;
/** OpenRouter Kimi K3 */
export const KNOWLEDGE_CARD_DISTILL_MODEL_KIMI = "moonshotai/kimi-k3" as const;
/** Evolink Qwen3.8 Max（勿用 OpenRouter slug） */
export const KNOWLEDGE_CARD_DISTILL_MODEL_QWEN = "qwen3.8-max" as const;

/** @deprecated 旧默认 Terra；resolve 时迁到 Sol */
export const KNOWLEDGE_CARD_DISTILL_MODEL_TERRA = "gpt-5.6-terra" as const;
/** @deprecated 旧 OpenRouter Qwen slug；resolve 时迁到 Evolink qwen3.8-max */
export const KNOWLEDGE_CARD_DISTILL_MODEL_QWEN_OR = "qwen/qwen3.8-max" as const;

/**
 * 每页积分：前 8 页满价 / 第 9 页起折扣。
 * 锚点：旧统一 25/20；轻量略降、精细略涨（约 +20% 封顶）。
 */
export const KNOWLEDGE_CARD_PAGE_CREDITS_BY_MODEL = {
  [KNOWLEDGE_CARD_DISTILL_MODEL_QWEN]: { full: 24, discount: 19 },
  [KNOWLEDGE_CARD_DISTILL_MODEL_KIMI]: { full: 27, discount: 22 },
  [KNOWLEDGE_CARD_DISTILL_MODEL_SOL]: { full: 30, discount: 24 },
} as const;

export const KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS = [
  {
    id: KNOWLEDGE_CARD_DISTILL_MODEL_SOL,
    labelZh: "提练·精细",
    creditsFull: KNOWLEDGE_CARD_PAGE_CREDITS_BY_MODEL[KNOWLEDGE_CARD_DISTILL_MODEL_SOL].full,
  },
  {
    id: KNOWLEDGE_CARD_DISTILL_MODEL_KIMI,
    labelZh: "提练·均衡",
    creditsFull: KNOWLEDGE_CARD_PAGE_CREDITS_BY_MODEL[KNOWLEDGE_CARD_DISTILL_MODEL_KIMI].full,
  },
  {
    id: KNOWLEDGE_CARD_DISTILL_MODEL_QWEN,
    labelZh: "提练·轻量",
    creditsFull: KNOWLEDGE_CARD_PAGE_CREDITS_BY_MODEL[KNOWLEDGE_CARD_DISTILL_MODEL_QWEN].full,
  },
] as const;

export type KnowledgeCardDistillModelId = (typeof KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS)[number]["id"];

export function isKnowledgeCardDistillEvolinkModel(modelId?: string | null): boolean {
  const v = String(modelId || "").trim();
  return v === KNOWLEDGE_CARD_DISTILL_MODEL_SOL || v === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN;
}

/** @deprecated 用 isKnowledgeCardDistillEvolinkModel */
export function isKnowledgeCardDistillEvolinkTerra(modelId?: string | null): boolean {
  return String(modelId || "").trim() === KNOWLEDGE_CARD_DISTILL_MODEL_TERRA;
}

export function resolveKnowledgeCardDistillModel(raw?: string | null): KnowledgeCardDistillModelId {
  const v = String(raw || "").trim();
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_SOL) return KNOWLEDGE_CARD_DISTILL_MODEL_SOL;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_KIMI) return KNOWLEDGE_CARD_DISTILL_MODEL_KIMI;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN) return KNOWLEDGE_CARD_DISTILL_MODEL_QWEN;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_TERRA) return KNOWLEDGE_CARD_DISTILL_MODEL_SOL;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN_OR) return KNOWLEDGE_CARD_DISTILL_MODEL_QWEN;

  const envDefault = String(
    (typeof process !== "undefined" && process.env?.KNOWLEDGE_CARD_DISTILL_MODEL) || "",
  ).trim();
  if (envDefault === KNOWLEDGE_CARD_DISTILL_MODEL_KIMI) return KNOWLEDGE_CARD_DISTILL_MODEL_KIMI;
  if (envDefault === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN || envDefault === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN_OR) {
    return KNOWLEDGE_CARD_DISTILL_MODEL_QWEN;
  }
  if (envDefault === KNOWLEDGE_CARD_DISTILL_MODEL_SOL || envDefault === KNOWLEDGE_CARD_DISTILL_MODEL_TERRA) {
    return KNOWLEDGE_CARD_DISTILL_MODEL_SOL;
  }
  return KNOWLEDGE_CARD_DISTILL_MODEL_SOL;
}

export function knowledgeCardPageCreditsForModel(raw?: string | null): { full: number; discount: number } {
  const id = resolveKnowledgeCardDistillModel(raw);
  return KNOWLEDGE_CARD_PAGE_CREDITS_BY_MODEL[id];
}
