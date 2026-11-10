/**
 * 1110 用户令「不要写死，随时我想更新或是改模型都可以」：Gemini 模型一律经此集中解析，调用处不写死模型名。
 *
 * 解析顺序：领域覆盖 env（按表内顺序）→ 领域缺省（GEMINI_MODEL_DOMAIN_DEFAULTS，仅表内领域）→ GEMINI_DEFAULT_MODEL → gemini-3.8-flash。
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

/** 各领域可选覆盖；未设时回落领域缺省（仅 GEMINI_MODEL_DOMAIN_DEFAULTS 表内领域）→ GEMINI_DEFAULT_MODEL → gemini-3.8-flash。 */
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
  /** 画布多图看图（canvasVisionMarkdown）与视频反推帧（videoReversePrompt）：两跳 Vertex gs:// → EvoLink 签名 https。 */
  canvasVision: ["CANVAS_VISION_MODEL"],
  /** 漫剧成片智能质检（首镜静帧 + 成片，manhuaClipQualityReview）：同走两跳。 */
  clipQualityReview: ["MANHUA_CLIP_QUALITY_MODEL"],
  /** 漫剧创作顾问·看片（影片审阅：看画面 + 听原片音轨）。 */
  manhuaAdvisorWatch: ["MANHUA_ADVISOR_WATCH_MODEL"],
  /** 漫剧创作顾问·配乐（成片 + 已采用 BGM 的音画配乐分析）。 */
  manhuaAdvisorBgm: ["MANHUA_ADVISOR_BGM_MODEL"],
  /** 漫剧创作顾问·字幕（字幕对齐核对 / 原片剪辑方案）。 */
  manhuaAdvisorSubtitle: ["MANHUA_ADVISOR_SUBTITLE_MODEL"],
  /** invokeLLM `model:"pro"` 且未给 modelName 时的 Gemini 缺省（Vertex / Gemini API 路径）；旧 env VERTEX_GEMINI_MODEL（两档共用）兼容。 */
  llmProTier: ["LLM_GEMINI_PRO_TIER_MODEL", "VERTEX_GEMINI_MODEL"],
  /** invokeLLM 未指定档位 / flash 档且未给 modelName 时的 Gemini 缺省；旧 env VERTEX_GEMINI_MODEL 兼容。 */
  llmFlashTier: ["LLM_GEMINI_FLASH_TIER_MODEL", "VERTEX_GEMINI_MODEL"],
  /** Stage2 专属 Gemini 文案兜底（resolvePlatformStage2GeminiModel）。 */
  platformStage2: ["PLATFORM_STAGE2_GEMINI_MODEL"],
  /** Flash 文案 / 联网摘要 / 生图英文化（gemini35FlashRuntime）；旧 env 链原样保留。 */
  flashCopywriting: [
    "GEMINI_35_FLASH_MODEL",
    "GROWTH_CAMP_EXTRACTOR_MODEL",
    "GEMINI_FLASH_TRANSLATION_MODEL",
    "VERTEX_GEMINI_FLASH_TRANSLATION_MODEL",
    "VERTEX_GEMINI_COVER_TRANSLATION_MODEL",
  ],
  /** 平台 composite（2×4 / 分镜 / 八格）英文化：自身 env 优先，其余同 Flash 文案链。 */
  compositeFlashTranslation: [
    "VERTEX_GEMINI_FLASH_TRANSLATION_MODEL",
    "GEMINI_35_FLASH_MODEL",
    "GROWTH_CAMP_EXTRACTOR_MODEL",
    "GEMINI_FLASH_TRANSLATION_MODEL",
    "VERTEX_GEMINI_COVER_TRANSLATION_MODEL",
  ],
  /** 选题竖封英文化：自身 env 优先，其余同 Flash 文案链。 */
  coverTranslation: [
    "VERTEX_GEMINI_COVER_TRANSLATION_MODEL",
    "GEMINI_35_FLASH_MODEL",
    "GROWTH_CAMP_EXTRACTOR_MODEL",
    "GEMINI_FLASH_TRANSLATION_MODEL",
    "VERTEX_GEMINI_FLASH_TRANSLATION_MODEL",
  ],
  /** 战略封面 / 章节扉页 / 自定义抠图的双语编导（runGemini31ProPreviewText）；旧 env VERTEX_GEMINI_31_PRO_MODEL、VERTEX_GEMINI_MODEL 兼容。 */
  strategicCoverDirector: ["STRATEGIC_COVER_DIRECTOR_GEMINI_MODEL", "VERTEX_GEMINI_31_PRO_MODEL", "VERTEX_GEMINI_MODEL"],
  /** 战略智库辅助生成（报告合成 / 灯塔标题 / 趋势图数据 / 配图场景抽取）。 */
  deepResearchAssist: ["DEEP_RESEARCH_ASSIST_GEMINI_MODEL"],
  /** 成长营 Phase 1 音频 / 关键帧粗筛。 */
  growthCampExtractor: ["GROWTH_CAMP_EXTRACTOR_MODEL"],
  /** 代码动画·原图语义预检（看原图 + 听已采用原声窗 + 看参考影片，一次两跳）。 */
  codeMotionSemantic: ["CODE_MOTION_SEMANTIC_MODEL"],
  /** 代码动画·词拍听音（已采用原声 30 秒窗的词与拍点估计）。 */
  codeMotionTiming: ["CODE_MOTION_TIMING_MODEL"],
  /** 创作顾问问答·联网检索摘要（googleSearch，不阻断主问答）。 */
  platformSkillQa: ["PLATFORM_SKILL_QA_GEMINI_MODEL"],
} as const satisfies Record<string, readonly string[]>;

export type GeminiModelDomain = keyof typeof GEMINI_MODEL_DOMAIN_ENVS;
export type GeminiModelEnv = Record<string, string | undefined>;

/**
 * 领域缺省（1110c）：以下领域原先把模型写死在调用处，本次只搬进此表、行为不变。
 * 表内领域的 env 全未设时取此值，且**优先于 GEMINI_DEFAULT_MODEL**——改全局缺省不会静默换掉这些领域。
 * 用户口径 Gemini 一律 3.8 Flash、Pro 级需批准：拍板后删掉对应条目即回落全局缺省；或在 Fly 设该领域 env 立即生效。
 */
export const GEMINI_MODEL_DOMAIN_DEFAULTS = {
  llmProTier: "gemini-3.1-pro-preview",
  llmFlashTier: "gemini-2.5-flash",
  platformStage2: "gemini-3.1-pro-preview",
  flashCopywriting: "gemini-3-flash-preview",
  compositeFlashTranslation: "gemini-3-flash-preview",
  coverTranslation: "gemini-3-flash-preview",
  strategicCoverDirector: "gemini-3.1-pro-preview",
  deepResearchAssist: "gemini-3.1-pro",
  growthCampExtractor: "gemini-3.5-flash",
} as const satisfies Partial<Record<GeminiModelDomain, string>>;

/** 某领域在全部 env 未设时的缺省模型（表内领域取领域缺省，否则为全局兜底 gemini-3.8-flash）。 */
export function geminiModelDomainDefault(domain: GeminiModelDomain): string {
  return (GEMINI_MODEL_DOMAIN_DEFAULTS as Partial<Record<GeminiModelDomain, string>>)[domain] ?? GEMINI_DEFAULT_MODEL_FALLBACK;
}

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
  const pinned = (GEMINI_MODEL_DOMAIN_DEFAULTS as Partial<Record<GeminiModelDomain, string>>)[domain];
  const candidates: Array<readonly [from: string, raw: unknown]> = [
    ...GEMINI_MODEL_DOMAIN_ENVS[domain].map((name) => [name, source[name]] as const),
    ...(pinned ? [["领域缺省", pinned] as const] : []),
    [GEMINI_DEFAULT_MODEL_ENV, source[GEMINI_DEFAULT_MODEL_ENV]] as const,
  ];
  for (const [name, raw] of candidates) {
    const value = String(raw ?? "").trim();
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
