/**
 * 图文卡提炼/OCR 模型（四选一，无主备层级）。
 * - Anthropic Claude Opus 5（档名「超凡」，前台不露模型名）
 * - Evolink GPT-5.6 Sol
 * - OpenRouter Kimi K3
 * - Evolink Qwen3.8 Max
 *
 * 页费含提炼/OCR+出图；按模型上游成本差异定档（成本约 ×1.65，相对旧 25 不涨太多）。
 *
 * @see https://evolink.ai/gpt-5-6
 * @see https://evolink.ai/docs/cn/api-manual/language-series/qwen3.8-max/qwen3.8-max-chat
 * @see https://openrouter.ai/moonshotai/kimi-k3
 */

/** Anthropic Claude Opus 5（前台档名「超凡」；2026-08-10 拍板 36/29 页费、提炼费 60） */
export const KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE = "claude-opus-5" as const;
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
  [KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE]: { full: 36, discount: 29 },
  [KNOWLEDGE_CARD_DISTILL_MODEL_QWEN]: { full: 24, discount: 19 },
  [KNOWLEDGE_CARD_DISTILL_MODEL_KIMI]: { full: 27, discount: 22 },
  [KNOWLEDGE_CARD_DISTILL_MODEL_SOL]: { full: 30, discount: 24 },
} as const;

/**
 * 提炼费（一次性，与页费分开收）。
 *
 * 只在**纯文本且超过 `KNOWLEDGE_CARD_SKIP_DISTILL_MAX_CHARS`** 时向用户明示并收取：
 * 这种情形下提炼是「花小钱省大钱」——1 万字直接出图要 9 页 264 积分且整套降到 2K，
 * 提炼后落到 4 页 120 积分且保住 4K，付 50 仍净省近百。上传文档的路径不收，
 * 那里提炼是抽文的必要环节、成本已含在页费里。
 *
 * 三档价差对齐页费的档位语言（轻量最便宜、精细最贵），与上游成本方向一致。
 */
export const KNOWLEDGE_CARD_DISTILL_FEE_BY_MODEL = {
  [KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE]: 60,
  [KNOWLEDGE_CARD_DISTILL_MODEL_QWEN]: 30,
  [KNOWLEDGE_CARD_DISTILL_MODEL_KIMI]: 40,
  [KNOWLEDGE_CARD_DISTILL_MODEL_SOL]: 50,
} as const;

export function knowledgeCardDistillFeeForModel(raw?: string | null): number {
  return KNOWLEDGE_CARD_DISTILL_FEE_BY_MODEL[resolveKnowledgeCardDistillModel(raw)];
}

export const KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS = [
  {
    id: KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE,
    labelZh: "提炼·超凡",
    creditsFull: KNOWLEDGE_CARD_PAGE_CREDITS_BY_MODEL[KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE].full,
  },
  {
    id: KNOWLEDGE_CARD_DISTILL_MODEL_SOL,
    labelZh: "提炼·精细",
    creditsFull: KNOWLEDGE_CARD_PAGE_CREDITS_BY_MODEL[KNOWLEDGE_CARD_DISTILL_MODEL_SOL].full,
  },
  {
    id: KNOWLEDGE_CARD_DISTILL_MODEL_KIMI,
    labelZh: "提炼·均衡",
    creditsFull: KNOWLEDGE_CARD_PAGE_CREDITS_BY_MODEL[KNOWLEDGE_CARD_DISTILL_MODEL_KIMI].full,
  },
  {
    id: KNOWLEDGE_CARD_DISTILL_MODEL_QWEN,
    labelZh: "提炼·轻量",
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
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE) return KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_SOL) return KNOWLEDGE_CARD_DISTILL_MODEL_SOL;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_KIMI) return KNOWLEDGE_CARD_DISTILL_MODEL_KIMI;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN) return KNOWLEDGE_CARD_DISTILL_MODEL_QWEN;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_TERRA) return KNOWLEDGE_CARD_DISTILL_MODEL_SOL;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN_OR) return KNOWLEDGE_CARD_DISTILL_MODEL_QWEN;

  const envDefault = String(
    (typeof process !== "undefined" && process.env?.KNOWLEDGE_CARD_DISTILL_MODEL) || "",
  ).trim();
  if (envDefault === KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE) return KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE;
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
