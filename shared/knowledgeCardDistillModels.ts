/**
 * 图文卡提炼/读图模型（两档，2026-09-08 用户拍板：四档改两档）。
 * - Evolink GPT-5.6 Sol（档名「精细」）；EvoLink 失败→OpenAI 官方同模型兜底
 * - Evolink Qwen3.8 Max（档名「轻量」）；EvoLink 失败→百炼新加坡套餐同模型兜底
 *
 * 页费含提炼/读图+出图；旧「超凡」（Claude）与「均衡」（Kimi）两档已下架，
 * 旧值仍可解析（历史 receipt / localStorage），一律迁到本档位表。
 *
 * @see https://evolink.ai/gpt-5-6
 * @see https://evolink.ai/docs/cn/api-manual/language-series/qwen3.8-max/qwen3.8-max-chat
 */

/** Evolink GPT-5.6 Sol */
export const KNOWLEDGE_CARD_DISTILL_MODEL_SOL = "gpt-5.6-sol" as const;
/** Evolink Qwen3.8 Max（勿用 OpenRouter slug） */
export const KNOWLEDGE_CARD_DISTILL_MODEL_QWEN = "qwen3.8-max" as const;

/** @deprecated 旧默认 Terra；resolve 时迁到 Sol */
export const KNOWLEDGE_CARD_DISTILL_MODEL_TERRA = "gpt-5.6-terra" as const;
/** @deprecated 旧 OpenRouter Qwen slug；resolve 时迁到 Evolink qwen3.8-max */
export const KNOWLEDGE_CARD_DISTILL_MODEL_QWEN_OR = "qwen/qwen3.8-max" as const;
/** @deprecated 旧「超凡」档（Claude Opus 5）已下架；resolve 时迁到 Sol */
export const KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE_RETIRED = "claude-opus-5" as const;
/** @deprecated 旧「均衡」档（Kimi K3）已下架；resolve 时迁到 Sol */
export const KNOWLEDGE_CARD_DISTILL_MODEL_KIMI_RETIRED = "moonshotai/kimi-k3" as const;

/** 所有仍接受的输入 id（含已下架旧值，供路由 schema 与迁移用） */
export const KNOWLEDGE_CARD_DISTILL_MODEL_ACCEPTED_INPUTS = [
  KNOWLEDGE_CARD_DISTILL_MODEL_SOL,
  KNOWLEDGE_CARD_DISTILL_MODEL_QWEN,
  KNOWLEDGE_CARD_DISTILL_MODEL_TERRA,
  KNOWLEDGE_CARD_DISTILL_MODEL_QWEN_OR,
  KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE_RETIRED,
  KNOWLEDGE_CARD_DISTILL_MODEL_KIMI_RETIRED,
] as const;

/**
 * 每页积分：前 8 页满价 / 第 9 页起折扣。价目不变（0908 只减档不改价）。
 */
export const KNOWLEDGE_CARD_PAGE_CREDITS_BY_MODEL = {
  [KNOWLEDGE_CARD_DISTILL_MODEL_QWEN]: { full: 24, discount: 19 },
  [KNOWLEDGE_CARD_DISTILL_MODEL_SOL]: { full: 30, discount: 24 },
} as const;

/**
 * 提炼费（一次性，与页费分开收）。
 *
 * 只在**纯文本且超过 `KNOWLEDGE_CARD_SKIP_DISTILL_MAX_CHARS`** 时向用户明示并收取；
 * 上传文档的路径不收，那里提炼是抽文的必要环节、成本已含在页费里。
 */
export const KNOWLEDGE_CARD_DISTILL_FEE_BY_MODEL = {
  [KNOWLEDGE_CARD_DISTILL_MODEL_QWEN]: 30,
  [KNOWLEDGE_CARD_DISTILL_MODEL_SOL]: 50,
} as const;

export function knowledgeCardDistillFeeForModel(raw?: string | null): number {
  return KNOWLEDGE_CARD_DISTILL_FEE_BY_MODEL[resolveKnowledgeCardDistillModel(raw)];
}

export const KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS = [
  {
    id: KNOWLEDGE_CARD_DISTILL_MODEL_SOL,
    labelZh: "提炼·精细",
    creditsFull: KNOWLEDGE_CARD_PAGE_CREDITS_BY_MODEL[KNOWLEDGE_CARD_DISTILL_MODEL_SOL].full,
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

function mapKnownModelId(v: string): KnowledgeCardDistillModelId | null {
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_SOL) return KNOWLEDGE_CARD_DISTILL_MODEL_SOL;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN) return KNOWLEDGE_CARD_DISTILL_MODEL_QWEN;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN_OR) return KNOWLEDGE_CARD_DISTILL_MODEL_QWEN;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_TERRA) return KNOWLEDGE_CARD_DISTILL_MODEL_SOL;
  // 下架档位：按「就近不降质」迁到精细档（超凡 → 精细；均衡 → 精细）
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE_RETIRED) return KNOWLEDGE_CARD_DISTILL_MODEL_SOL;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_KIMI_RETIRED) return KNOWLEDGE_CARD_DISTILL_MODEL_SOL;
  return null;
}

export function resolveKnowledgeCardDistillModel(raw?: string | null): KnowledgeCardDistillModelId {
  const direct = mapKnownModelId(String(raw || "").trim());
  if (direct) return direct;
  const envDefault = String(
    (typeof process !== "undefined" && process.env?.KNOWLEDGE_CARD_DISTILL_MODEL) || "",
  ).trim();
  return mapKnownModelId(envDefault) || KNOWLEDGE_CARD_DISTILL_MODEL_SOL;
}

export function knowledgeCardPageCreditsForModel(raw?: string | null): { full: number; discount: number } {
  const id = resolveKnowledgeCardDistillModel(raw);
  return KNOWLEDGE_CARD_PAGE_CREDITS_BY_MODEL[id];
}
