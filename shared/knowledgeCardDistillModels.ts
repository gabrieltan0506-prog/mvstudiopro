/**
 * 图文卡提练/OCR 可选模型（OpenRouter）。
 * 默认 Qwen3.8 Max；试对比时可切 Kimi K3。
 */

export const KNOWLEDGE_CARD_DISTILL_MODEL_QWEN = "qwen/qwen3.8-max" as const;
export const KNOWLEDGE_CARD_DISTILL_MODEL_KIMI = "moonshotai/kimi-k3" as const;

export const KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS = [
  {
    id: KNOWLEDGE_CARD_DISTILL_MODEL_QWEN,
    labelZh: "Qwen3.8 Max（性价比）",
  },
  {
    id: KNOWLEDGE_CARD_DISTILL_MODEL_KIMI,
    labelZh: "Kimi K3（平台文案同款）",
  },
] as const;

export type KnowledgeCardDistillModelId =
  (typeof KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS)[number]["id"];

export function resolveKnowledgeCardDistillModel(raw?: string | null): KnowledgeCardDistillModelId {
  const v = String(raw || "").trim();
  const hit = KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS.find((o) => o.id === v);
  if (hit) return hit.id;
  const envDefault = String(
    (typeof process !== "undefined" && process.env?.KNOWLEDGE_CARD_DISTILL_MODEL) || "",
  ).trim();
  const envHit = KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS.find((o) => o.id === envDefault);
  return envHit?.id ?? KNOWLEDGE_CARD_DISTILL_MODEL_QWEN;
}
