/**
 * GLM 5.3 系列的**唯一**模型名与供应商锁定定义（0911 用户令）。
 *
 * 背景：`deepseek/deepseek-v4-pro-0813` 三天后下架，全站调用它的地方一律换成 GLM 5.3；
 * OpenRouter 侧同一 slug 会被路由到二十多家转售方，参数支持与产出质量不一致，
 * 所以主路锁 Z.AI 自营（allow_fallbacks:false ——宁可这跳直接失败换下一家，也不静默落到别家），
 * 换不动再落 EvoLink 的同款 `glm-5.3`。
 *
 * 参数契约（EvoLink 官方文档）：glm-5.3 / glm-5.3-flash **恒开思考、关不掉**，
 * reasoning_effort 只有 low / high / max 真正生效（medium→high、xhigh→max、minimal/none→low，
 * 不报错但会被降级）；输出上限 131,072（思维链计入）；只有 glm-5.3-flash 吃图。
 *
 * 第三家（阿里云百炼「ZHIPU/GLM-5.3」，智谱直供）参数同口径：`enable_thinking: true` +
 * `reasoning_effort`（max 默认 / high / low），支持 `stream: true` 与 `stream_options.include_usage`，
 * 思考过程走 `delta.reasoning_content`。它只在**华北 2（北京）**地域可用，本仓已验证北京域读不到
 * 我们的 GCS 签名图，所以读图链不接它；纯文本档要接的话另配北京 Key 与业务空间域名。
 * 本仓现有调用一律非流式（要整份 JSON 一次解析），流式是可用能力、不是当前口径。
 *
 * @see https://evolink.ai/docs/en/api-manual/language-series/glm/chat-completions/chat-completions-reference
 * @see https://help.aliyun.com/zh/model-studio/glm-zhipu
 */

/** OpenRouter 主路（文本旗舰，131 万上下文） */
export const GLM_53_OPENROUTER_MODEL = "z-ai/glm-5.3" as const;
/** EvoLink 兜底（同款文本旗舰） */
export const GLM_53_EVOLINK_MODEL = "glm-5.3" as const;
/** 原生视觉的 Flash 版（读图链用） */
export const GLM_53_FLASH_OPENROUTER_MODEL = "z-ai/glm-5.3-flash" as const;
export const GLM_53_FLASH_EVOLINK_MODEL = "glm-5.3-flash" as const;

/** OpenRouter 上把 GLM 锁到 Z.AI 自营 */
export const OPENROUTER_GLM_PROVIDER_LOCK = {
  order: ["Z.AI"],
  allow_fallbacks: false,
  require_parameters: true,
} as const;

/** OpenRouter 上把 DeepSeek 锁到 DeepSeek 自营 */
export const OPENROUTER_DEEPSEEK_PROVIDER_LOCK = {
  order: ["DeepSeek"],
  allow_fallbacks: false,
} as const;

/** 这个模型名是不是 GLM 5.3 系（含 flash、含 EvoLink 与 OpenRouter 两种写法） */
export function isGlm53Model(modelId?: string | null): boolean {
  const v = String(modelId || "").trim().toLowerCase();
  return v === GLM_53_OPENROUTER_MODEL || v === GLM_53_EVOLINK_MODEL
    || v === GLM_53_FLASH_OPENROUTER_MODEL || v === GLM_53_FLASH_EVOLINK_MODEL;
}

/** GLM 5.3 的思考档：只有 low/high/max 真正生效，其余一律按 high 发 */
export function glm53ReasoningEffort(requested?: string | null): "low" | "high" | "max" {
  const v = String(requested || "").trim().toLowerCase();
  return v === "low" || v === "max" ? v : "high";
}
