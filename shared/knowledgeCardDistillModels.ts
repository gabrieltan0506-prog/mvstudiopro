/**
 * 图文卡读档（提炼/读图）模型：用户二选一，Qwen 只做最后一手兜底（0911 用户令）。
 * - DeepSeek V4.1 Flash：EvoLink `deepseek-v4.1-flash` 原生多模态（图文同一个模型）→ OpenRouter
 *   `deepseek/deepseek-v4.1-flash`（锁 DeepSeek 自营，不落转售方）
 * - GLM 5.3 Flash：EvoLink `glm-5.3-flash` 原生视觉、100 万上下文 → OpenRouter `z-ai/glm-5.3-flash`
 * - 选中的那档两家供应商都打不通，才换另一档；两档都失败，最后才走 Qwen3.8 Max
 *   （百炼新加坡 token plan → OpenRouter），Qwen 不再出现在下拉选单里。
 *
 * 页费含读档+出图；旧「超凡」（Claude）、「均衡」（Kimi）、GPT-5.6 Sol 与「轻量」（Qwen）已下架，
 * 旧值仍可解析（历史 receipt / localStorage），一律迁到本档位表，历史 receipt 按原价结算。
 *
 * @see https://evolink.ai/docs/en/api-manual/language-series/deepseek-v4/deepseek-v4-chat
 * @see https://evolink.ai/docs/en/api-manual/language-series/glm/chat-completions/chat-completions-reference
 */

/** DeepSeek V4.1 Flash（EvoLink id；原生多模态，图文共用一个模型） */
export const KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK = "deepseek-v4.1-flash" as const;
/** GLM 5.3 Flash（EvoLink id；原生视觉，OpenRouter 侧 slug 见 server） */
export const KNOWLEDGE_CARD_DISTILL_MODEL_GLM = "glm-5.3-flash" as const;
/** @deprecated 旧 DeepSeek V4 Flash（0911 换 V4.1）；resolve 时迁到 V4.1 */
export const KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK_V4 = "deepseek-v4-flash" as const;
/** @deprecated GPT-5.6 Sol 已下架（0910 用户令：不要用 Sol）；resolve 时迁到 DeepSeek */
export const KNOWLEDGE_CARD_DISTILL_MODEL_SOL = "gpt-5.6-sol" as const;
/**
 * Qwen3.8 Max：0911 起只做两档都失败后的最后兜底，不再是可选档位。
 * 常量保留：兜底链要用它当模型名，历史 receipt / localStorage 也要能解析。
 */
export const KNOWLEDGE_CARD_DISTILL_MODEL_QWEN = "qwen3.8-max" as const;

/** @deprecated 旧默认 Terra；resolve 时迁到 DeepSeek */
export const KNOWLEDGE_CARD_DISTILL_MODEL_TERRA = "gpt-5.6-terra" as const;
/** @deprecated 旧 OpenRouter Qwen slug；resolve 时迁到 GLM 档 */
export const KNOWLEDGE_CARD_DISTILL_MODEL_QWEN_OR = "qwen/qwen3.8-max" as const;
/** @deprecated 旧「超凡」档（Claude Opus 5）已下架；resolve 时迁到 DeepSeek */
export const KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE_RETIRED = "claude-opus-5" as const;
/** @deprecated 旧「均衡」档（Kimi K3）已下架；resolve 时迁到 DeepSeek */
export const KNOWLEDGE_CARD_DISTILL_MODEL_KIMI_RETIRED = "moonshotai/kimi-k3" as const;

/** 所有仍接受的输入 id（含已下架旧值，供路由 schema 与迁移用） */
export const KNOWLEDGE_CARD_DISTILL_MODEL_ACCEPTED_INPUTS = [
  KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK,
  KNOWLEDGE_CARD_DISTILL_MODEL_GLM,
  KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK_V4,
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
  // 0911：档位换模型不改价——GLM 档接的是原「轻量」价位，DeepSeek 档接原「精细」价位。
  // 页费大头是出图，读档只占零头；调价是用户的事。
  [KNOWLEDGE_CARD_DISTILL_MODEL_GLM]: { full: 24, discount: 19 },
  [KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK]: { full: 30, discount: 24 },
} as const;

/**
 * 提炼费（一次性，与页费分开收）。
 *
 * 只在**纯文本且超过 `KNOWLEDGE_CARD_SKIP_DISTILL_MAX_CHARS`** 时向用户明示并收取；
 * 上传文档的路径不收，那里提炼是抽文的必要环节、成本已含在页费里。
 */
export const KNOWLEDGE_CARD_DISTILL_FEE_BY_MODEL = {
  [KNOWLEDGE_CARD_DISTILL_MODEL_GLM]: 30,
  [KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK]: 50,
} as const;

export function knowledgeCardDistillFeeForModel(raw?: string | null): number {
  return KNOWLEDGE_CARD_DISTILL_FEE_BY_MODEL[resolveKnowledgeCardDistillModel(raw)];
}

export const KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS = [
  {
    id: KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK,
    labelZh: "读档·DeepSeek V4.1 Flash",
    creditsFull: KNOWLEDGE_CARD_PAGE_CREDITS_BY_MODEL[KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK].full,
  },
  {
    id: KNOWLEDGE_CARD_DISTILL_MODEL_GLM,
    labelZh: "读档·GLM 5.3 Flash",
    creditsFull: KNOWLEDGE_CARD_PAGE_CREDITS_BY_MODEL[KNOWLEDGE_CARD_DISTILL_MODEL_GLM].full,
  },
] as const;

export type KnowledgeCardDistillModelId = (typeof KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS)[number]["id"];

export function isKnowledgeCardDistillEvolinkModel(modelId?: string | null): boolean {
  const v = String(modelId || "").trim();
  return (
    v === KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK
    || v === KNOWLEDGE_CARD_DISTILL_MODEL_GLM
    || v === KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK_V4
    || v === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN
  );
}

/** @deprecated 用 isKnowledgeCardDistillEvolinkModel */
export function isKnowledgeCardDistillEvolinkTerra(modelId?: string | null): boolean {
  return String(modelId || "").trim() === KNOWLEDGE_CARD_DISTILL_MODEL_TERRA;
}

function mapKnownModelId(v: string): KnowledgeCardDistillModelId | null {
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK) return KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_GLM) return KNOWLEDGE_CARD_DISTILL_MODEL_GLM;
  // 0911：DeepSeek V4 → V4.1（同档换版本）；Qwen 档下架 → 迁到同价位的 GLM 档
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK_V4) return KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN) return KNOWLEDGE_CARD_DISTILL_MODEL_GLM;
  if (v === KNOWLEDGE_CARD_DISTILL_MODEL_QWEN_OR) return KNOWLEDGE_CARD_DISTILL_MODEL_GLM;
  // 下架档位：迁到 DeepSeek 档（Sol / Terra / 超凡 / 均衡）
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
  // 旧「轻量」（Qwen）与旧 DeepSeek V4 的历史 receipt 按原价结算，不因换档改价
  [KNOWLEDGE_CARD_DISTILL_MODEL_QWEN]: { full: 24, discount: 19 },
  [KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK_V4]: { full: 30, discount: 24 },
  [KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE_RETIRED]: { full: 36, discount: 29 },
  [KNOWLEDGE_CARD_DISTILL_MODEL_KIMI_RETIRED]: { full: 27, discount: 22 },
};

export function knowledgeCardPageCreditsForModel(raw?: string | null): { full: number; discount: number } {
  const retired = RETIRED_PAGE_CREDITS[String(raw || "").trim()];
  if (retired) return retired;
  const id = resolveKnowledgeCardDistillModel(raw);
  return KNOWLEDGE_CARD_PAGE_CREDITS_BY_MODEL[id];
}
