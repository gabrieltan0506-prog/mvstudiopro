/**
 * 1110 用户令「不要写死，随时我想更新或是改模型都可以」：Gemini 模型一律经此集中解析，调用处不写死模型名。
 *
 * 解析顺序：领域覆盖 env（按表内顺序）→ GEMINI_DEFAULT_MODEL → gemini-3.8-flash。
 * 每一级读取时 trim，空串 / 全空白视为未设、回落下一级；不是 `gemini-` 开头的合法模型标识同样回落（并 warn），
 * 避免把别的通道的模型名送进 Gemini 端点。只读服务端环境；浏览器端没有 process 时只得缺省值（前端不显示模型名）。
 *
 * 规矩（用户口径）：
 *   - 只管 Gemini；Gemini 只走 Vertex 与 EvoLink。GLM / DeepSeek / Qwen 等别的通道不经此处。
 *   - Pro 级模型需用户事先批准：解析结果名称含 "pro" 时记一条 console.warn（不阻断——用户可能已批准）。
 *
 * 换模型不改代码，只改 Fly 环境变量（用户自己设），例如：
 *   fly secrets set GEMINI_DEFAULT_MODEL=<新模型名> -a mvstudiopro
 *   fly secrets set MANHUA_DEEP_READ_MODEL=<新模型名> -a mvstudiopro   # 只换模板学习精读
 */

export const GEMINI_DEFAULT_MODEL_ENV = "GEMINI_DEFAULT_MODEL" as const;
/** 全局缺省（用户 1109/1110 口径：Gemini 一律 3.8 Flash）。 */
export const GEMINI_DEFAULT_MODEL_FALLBACK = "gemini-3.8-flash" as const;

/** 各领域可选覆盖；未设时回落 GEMINI_DEFAULT_MODEL，再回落 gemini-3.8-flash。 */
export const GEMINI_MODEL_DOMAIN_ENVS = {
  /** 模板学习精读（漫剧原生精读）首读模型。 */
  manhuaDeepRead: ["MANHUA_DEEP_READ_MODEL"],
  /** 模板学习精读：单片首读梯度全部未过门禁后的升级重读模型；未设时同首读模型（同模型即不升级）。 */
  manhuaDeepReadEscalation: ["MANHUA_DEEP_READ_ESCALATION_MODEL", "MANHUA_DEEP_READ_MODEL"],
  /** 听音两跳（Vertex gs:// → EvoLink 签名 https）缺省模型。 */
  audioTwoHop: ["GEMINI_AUDIO_TWO_HOP_MODEL"],
  /** MV 独立听歌（不看剧情只听歌）。 */
  mvSongHearing: ["MV_SONG_HEARING_MODEL"],
  /** 成片调色建议（看成片 + 听音轨）。 */
  montageGradeAdvice: ["MONTAGE_GRADE_ADVICE_MODEL"],
} as const satisfies Record<string, readonly string[]>;

export type GeminiModelDomain = keyof typeof GEMINI_MODEL_DOMAIN_ENVS;
export type GeminiModelEnv = Record<string, string | undefined>;

/** Gemini 模型标识：`gemini-` 开头，仅小写字母、数字、点与连字符（进 URL 路径、GCS 对象名与系列键编码）。 */
export const GEMINI_MODEL_ID_PATTERN = /^gemini-[a-z0-9][a-z0-9.-]{0,62}$/;

export function isGeminiModelId(value: unknown): value is string {
  return typeof value === "string" && GEMINI_MODEL_ID_PATTERN.test(value);
}

/** 名称含 "pro" 即按 Pro 级处理（需用户事先批准）。 */
export function isGeminiProTierModel(model: string): boolean {
  return /pro/i.test(String(model || ""));
}

function readEnv(env?: GeminiModelEnv): GeminiModelEnv {
  if (env) return env;
  return typeof process !== "undefined" && process?.env ? (process.env as GeminiModelEnv) : {};
}

const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/** 仅测试用：清掉「同一条告警只记一次」的记忆。 */
export function resetGeminiModelConfigWarningsForTest(): void {
  warned.clear();
}

/**
 * 解析某领域本次应调用的 Gemini 模型（每次调用现读环境，改 env 重启进程即生效）。
 * 解析到 Pro 级模型时 console.warn（不阻断）。
 */
export function resolveGeminiModel(domain: GeminiModelDomain, env?: GeminiModelEnv): string {
  const source = readEnv(env);
  for (const name of [...GEMINI_MODEL_DOMAIN_ENVS[domain], GEMINI_DEFAULT_MODEL_ENV]) {
    const value = String(source[name] ?? "").trim();
    if (!value) continue;
    if (!isGeminiModelId(value)) {
      warnOnce(`invalid:${name}:${value}`, `[geminiModelConfig] ${name}=${JSON.stringify(value)} 不是合法的 Gemini 模型标识（须 gemini- 开头、小写），已忽略并回落下一级`);
      continue;
    }
    if (isGeminiProTierModel(value)) {
      warnOnce(`pro:${domain}:${value}`, `[geminiModelConfig] ${domain} 解析到 Pro 级模型 ${value}（来自 ${name}）：Pro 级需用户事先批准，请确认已获批准`);
    }
    return value;
  }
  return GEMINI_DEFAULT_MODEL_FALLBACK;
}
