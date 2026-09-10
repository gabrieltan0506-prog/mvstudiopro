/**
 * 图文卡提炼/读图模型（两档）。
 * - DeepSeek V4 Flash（档名「精细」，0910 用户拍板替掉 GPT-5.6 Sol：整本书提炼费≈一段 30 秒视频，太贵）；
 *   EvoLink 主通道（纯文本 `deepseek-v4-flash`、带图 `deepseek-v4-flash-vision-exp`）→ OpenRouter 同模型兜底
 * - Qwen3.8 Max（档名「轻量」）；百炼新加坡 token plan 主通道，失败→EvoLink 同模型兜底（0909 用户拍板）
 *
 * 页费含提炼/读图+出图；旧「超凡」（Claude）、「均衡」（Kimi）与 GPT-5.6 Sol 已下架，
 * 旧值仍可解析（历史 receipt / localStorage），一律迁到本档位表。
 *
 * @see https://evolink.ai/docs/cn/api-manual/language-series/deepseek-v4-flash/deepseek-v4-flash-chat
 * @see https://evolink.ai/docs/cn/api-manual/language-series/qwen3.8-max/qwen3.8-max-chat
 */

/** DeepSeek V4 Flash（EvoLink id；OpenRouter 兜底 slug 见 server 侧） */
export const KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK = "deepseek-v4-flash" as const;
/** @deprecated GPT-5.6 Sol 已下架（0910 用户令：不要用 Sol）；resolve 时迁到 DeepSeek */
export const KNOWLEDGE_CARD_DISTILL_MODEL_SOL = "gpt-5.6-sol" as const;
/** Evolink Qwen3.8 Max（勿用 OpenRouter slug） */
export const KNOWLEDGE_CARD_DISTILL_MODEL_QWEN = "qwen3.8-max" as const;

/** @deprecated 旧默认 Terra；resolve 时迁到 DeepSeek */
export const KNOWLEDGE_CARD_DISTILL_MODEL_TERRA = "gpt-5.6-terra" as const;
/** @deprecated 旧 OpenRouter Qwen slug；resolve 时迁到 Evolink qwen3.8-max */
export const KNOWLEDGE_CARD_DISTILL_MODEL_QWEN_OR = "qwen/qwen3.8-max" as const;
/** @deprecated 旧「超凡」档（Claude Opus 5）已下架；resolve 时迁到 DeepSeek */
export const KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE_RETIRED = "claude-opus-5" as const;
/** @deprecated 旧「均衡」档（Kimi K3）已下架；resolve 时迁到 DeepSeek */
export const KNOWLEDGE_CARD_DISTILL_MODEL_KIMI_RETIRED = "moonshotai/kimi-k3" as const;

/** 所有仍接受的输入 id（含已下架旧值，供路由 schema 与迁移用） */
export const KNOWLEDGE_CARD_DISTILL_MODEL_ACCEPTED_INPUTS = [
  KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK,
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
  // 0910：精细档换成 DeepSeek，页价先不动（页费大头是出图，提炼只占零头）；改价是用户的事
  [KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK]: { full: 30, discount: 24 },
} as const;

/**
 * 提炼费（一次性，与页费分开收）。
 *
 * 只在**纯文本且超过 `KNOWLEDGE_CARD_SKIP_DISTILL_MAX_CHARS`** 时向用户明示并收取；
 * 上传文档的路径不收，那里提炼是抽文的必要环节、成本已含在页费里。
 */
export const KNOWLEDGE_CARD_DISTILL_FEE_BY_MODEL = {
  [KNOWLEDGE_CARD_DISTILL_MODEL_QWEN]: 30,
  [KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK]: 50,
} as const;

export function knowledgeCardDistillFeeForModel(raw?: string | null): number {
  return KNOWLEDGE_CARD_DISTILL_FEE_BY_MODEL[resolveKnowledgeCardDistillModel(raw)];
}

export const KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS = [
  {
    id: KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK,
    labelZh: "提炼·精细",
    creditsFull: KNOWLEDGE_CARD_PAGE_CREDITS_BY_MODEL[KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK].full,
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
  return v === KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK || v === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN;
}

/** @deprecated 用 isKnowledgeCardDistillEvolinkModel */
export function isKnowledgeCardDistillEvolinkTerra(modelId?: string | null): boolean {
  return String(modelId || "").trim() === KNOWLEDGE_CARD_DISTILL_MODEL_TERRA;
}

function mapKnownModelId(v: string): KnowledgeCardDistillModelId | null {
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK) return KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN) return KNOWLEDGE_CARD_DISTILL_MODEL_QWEN;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN_OR) return KNOWLEDGE_CARD_DISTILL_MODEL_QWEN;
  // 下架档位：迁到精细档（Sol / Terra / 超凡 / 均衡 → DeepSeek）
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_SOL) return KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_TERRA) return KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE_RETIRED) return KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_KIMI_RETIRED) return KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK;
  return null;
}

export function resolveKnowledgeCardDistillModel(raw?: string | null): KnowledgeCardDistillModelId {
  const direct = mapKnownModelId(String(raw || "").trim());
  if (direct) return direct;
  const envDefault = String(
    (typeof process !== "undefined" && process.env?.KNOWLEDGE_CARD_DISTILL_MODEL) || "",
  ).trim();
  return mapKnownModelId(envDefault) || KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK;
}

/** 已下架档位的历史页价：旧 receipt 出图仍按原档结算，不因下架改价 */
const RETIRED_PAGE_CREDITS: Record<string, { full: number; discount: number }> = {
  [KNOWLEDGE_CARD_DISTILL_MODEL_SOL]: { full: 30, discount: 24 },
  [KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE_RETIRED]: { full: 36, discount: 29 },
  [KNOWLEDGE_CARD_DISTILL_MODEL_KIMI_RETIRED]: { full: 27, discount: 22 },
};

export function knowledgeCardPageCreditsForModel(raw?: string | null): { full: number; discount: number } {
  const retired = RETIRED_PAGE_CREDITS[String(raw || "").trim()];
  if (retired) return retired;
  const id = resolveKnowledgeCardDistillModel(raw);
  return KNOWLEDGE_CARD_PAGE_CREDITS_BY_MODEL[id];
}
