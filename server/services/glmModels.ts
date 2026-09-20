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
 * 只走这两家：OpenRouter（锁 Z.AI 自营）与 EvoLink。阿里云百炼的智谱 GLM 不接（0911 用户令）。
 *
 * @see https://evolink.ai/docs/en/api-manual/language-series/glm/chat-completions/chat-completions-reference
 */

/**
 * OpenRouter 主路。0920 用户令「都换掉吧」：GLM-5.3 → **GLM-5.3 Flash**。
 * 实测 Z.AI 原生档 tag 仍是 `z-ai/fp8`，$0.15/M in · $0.50/M out（5.3 是 $1.4 / $4.4），ctx 1,048,576。
 * 使用方：微信视频号挖掘（`weixinChannelsMiner`）、平台选题（`platformTopicShortlist`）。
 */
export const GLM_53_OPENROUTER_MODEL = "z-ai/glm-5.3-flash" as const;
/** EvoLink 兜底（同款，0920 一并换 Flash） */
export const GLM_53_EVOLINK_MODEL = "glm-5.3-flash" as const;
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

/**
 * 🔒 **停用但必须继续认得的旧 id**（0920）。
 *
 * 0920 把常量整体换成 Flash 后，`isGlm53Model("z-ai/glm-5.3")` 立刻变 false，
 * 于是队列里/存量任务里带着旧 id 的请求**不再套 Z.AI 自营 provider 锁**，
 * 也不再按 GLM 口径透传 max_tokens —— 那就是 0829 账单实证的那个形态：
 * 不钉 provider 会抽到 Fireworks 之类的中转商，多烧数倍思考 token。
 * **识别名单只增不减**，与网关白名单同一条规矩（停用 ≠ 撤销识别）。
 */
export const GLM_53_LEGACY_MODEL_IDS: readonly string[] = ["z-ai/glm-5.3", "glm-5.3"];

/** 这个模型名是不是 GLM 5.3 系（含 flash、含 EvoLink 与 OpenRouter 两种写法、含停用的旧 id） */
export function isGlm53Model(modelId?: string | null): boolean {
  const v = String(modelId || "").trim().toLowerCase();
  return v === GLM_53_OPENROUTER_MODEL || v === GLM_53_EVOLINK_MODEL
    || v === GLM_53_FLASH_OPENROUTER_MODEL || v === GLM_53_FLASH_EVOLINK_MODEL
    || GLM_53_LEGACY_MODEL_IDS.includes(v);
}

/** GLM 5.3 的思考档：只有 low/high/max 真正生效，其余一律按 high 发 */
export function glm53ReasoningEffort(requested?: string | null): "low" | "high" | "max" {
  const v = String(requested || "").trim().toLowerCase();
  return v === "low" || v === "max" ? v : "high";
}
