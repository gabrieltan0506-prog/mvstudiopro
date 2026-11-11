import { parseNativeDeepReadRelearn, type NativeDeepReadRelearn } from "./manhuaNativeRelearn.js";
import { parseManhuaLocalVideoSourceRef } from "./manhuaLocalVideoUpload.js";
/** 原生精读单任务墙钟与调用数契约；客户端、入队端和 worker 共用。 */
import { isManhua0996SourceUrl } from "./manhuaLearn0996Source.js";
import { MANHUA_LEARN_MAX_DURATION_SEC } from "./manhuaTemplateLearnSeries.js";
import { isGeminiModelId, resolveGeminiModel, type GeminiModelEnv } from "./geminiModelConfig.js";
import { GEMINI_CARBON_MODEL, parseGeminiCarbonChannelOrder } from "./geminiCarbon.js";
/**
 * 0826 拍板：视觉学习整体从新加坡 Qwen 换到 Vertex Gemini 3.1 Pro 从 GCS 直读，
 * 连音轨一次调用出全六栏（实测 360s 段 144s 返回，输入 ≈129k tok）。
 *
 * ⚠️ 1110 起本常量**只作历史身份 / 读取门用途**，不再决定任何新请求用哪个模型：
 *   - 未写读片模型的旧已存任务按它恢复（旧任务当年就是 3.1 Pro）；
 *   - 无后缀系列键 = 3.1 Pro 车道；段缓存指纹与计划确认码里的历史模型身份（改值 = 已付费分片全部失配重买）。
 * 新读片模型一律由 resolveManhuaNativeDeepReadModel()（env 配置，缺省 gemini-3.8-flash）决定。
 */
export const MANHUA_NATIVE_DEEP_READ_MODEL = "gemini-3.1-pro-preview" as const;
export const MANHUA_NATIVE_DEEP_READ_MODEL_LABEL = "Gemini 3.1 Pro" as const;
/**
 * 0903 用户拍板：读片双模型面板可选——3.1 Pro 质量基线 / 3.8 Flash 低成本档。
 * 官方规格（API 元数据实测）两者同为输入 1M tok / 输出 64K tok / generateContent+缓存+批量。
 * 1110：仅作冻结契约 SHA 与历史付费身份；新读片可用模型改由 env 配置决定（见 resolveManhuaNativeDeepReadModel）。
 */
export const MANHUA_NATIVE_LEGACY_READ_MODEL_OPTIONS = [
  "gemini-3.1-pro-preview",
  "gemini-3.8-flash",
] as const;
/** 1014：用户授权增加 Argon；历史模型集合继续用于旧付费契约身份与路由入参校验（旧三代）。 */
export const MANHUA_NATIVE_DEEP_READ_MODEL_OPTIONS = [...MANHUA_NATIVE_LEGACY_READ_MODEL_OPTIONS, "gemini-4-argon"] as const;
/**
 * 新学习可选集（面板偏好按账号保存用）：标准档 3.8 Flash + 整集精读升级档 Carbon。
 * 1111 站长令「把 Argon 改成 Carbon」：Argon 退出新学习可选项；已用 Argon 学过的系列仍按 -g4a 续学与解析（历史身份只增不改）。
 * 服务端实际放行集见 nativeDeepReadAllowedNewReadModels（升级档模型按 env 配置，缺省 gemini-4-carbon）。
 */
export const MANHUA_NATIVE_NEW_READ_MODEL_OPTIONS = ["gemini-3.8-flash", GEMINI_CARBON_MODEL] as const;
/** Argon 历史车道身份（-g4a）：只作已学系列续学 / 旧卡解析，不再出现在新学习可选项。 */
export const MANHUA_NATIVE_ARGON_MODEL = "gemini-4-argon" as const;
/** Carbon 车道身份（-g4c）：整集精读升级档；属贵档，只在站长主动选择时发车。 */
export const MANHUA_NATIVE_CARBON_MODEL = GEMINI_CARBON_MODEL;
/**
 * 3.8 Flash 旧车道身份（系列后缀 -g38f、双通道合同）。1110 起它只是缺省配置值与旧车道身份，
 * 新读片实际模型由 resolveManhuaNativeDeepReadModel() 决定；前端不再据此选模型。
 */
export const MANHUA_NATIVE_CURRENT_READ_MODEL = "gemini-3.8-flash" as const;
/**
 * 1110：读片模型不再是封闭枚举——旧三代（3.1 Pro / 3.8 Flash / Argon）之外，env 配置出来的任何
 * 合法 Gemini 模型标识都可用；已存任务按其保存的模型恢复。
 */
export type ManhuaNativeDeepReadModelId = string;
export const MANHUA_NATIVE_DEEP_READ_MODEL_LABELS: Record<ManhuaNativeDeepReadModelId, string> = {
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
  "gemini-3.8-flash": "Gemini 3.8 Flash",
  "gemini-4-argon": "Gemini 4 Argon",
  "gemini-4-carbon": "Gemini 4 Carbon",
};

/** 1110：新读片首读模型（env：MANHUA_DEEP_READ_MODEL → GEMINI_DEFAULT_MODEL → gemini-3.8-flash）。 */
export function resolveManhuaNativeDeepReadModel(env?: GeminiModelEnv): ManhuaNativeDeepReadModelId {
  return resolveGeminiModel("manhuaDeepRead", env);
}

/**
 * 1110：单片首读梯度全部未过门禁后的升级重读模型
 * （env：MANHUA_DEEP_READ_ESCALATION_MODEL → MANHUA_DEEP_READ_MODEL → GEMINI_DEFAULT_MODEL → gemini-3.8-flash）。
 * 与本片首读模型相同即不升级；不再写死 3.1 Pro。
 */
export function resolveManhuaNativeDeepReadEscalationModel(env?: GeminiModelEnv): ManhuaNativeDeepReadModelId {
  return resolveGeminiModel("manhuaDeepReadEscalation", env);
}

/**
 * 1111：整集精读升级档模型（env：MANHUA_DEEP_READ_UPGRADE_MODEL → GEMINI_CARBON_MODEL → 领域缺省 gemini-4-carbon）。
 * 只在新学习时由站长主动选择；不参与任何缺省路径。
 */
export function resolveManhuaNativeDeepReadUpgradeModel(env?: GeminiModelEnv): ManhuaNativeDeepReadModelId {
  return resolveGeminiModel("manhuaDeepReadUpgrade", env);
}

/**
 * Carbon 车道：Carbon 身份本身，或当前配置的升级档模型（换配置后在途 Carbon 任务仍按 Carbon 车道走）。
 * 「当前合同」模型（配置的首读模型 / 3.8 Flash 旧车道）永远不算 Carbon 车道。
 */
export function isNativeDeepReadCarbonLaneModel(model: unknown, env?: GeminiModelEnv): boolean {
  if (typeof model !== "string" || isNativeDeepReadCurrentContractModel(model, env)) return false;
  return model === MANHUA_NATIVE_CARBON_MODEL || model === resolveManhuaNativeDeepReadUpgradeModel(env);
}

export type NativeDeepReadCarbonRoute = "evolink" | "vertex";
/** Carbon 车道读片通道顺序 env；缺省 EvoLink → Vertex。 */
export const NATIVE_DEEP_READ_CARBON_ROUTES_ENV = "MANHUA_DEEP_READ_CARBON_ROUTES" as const;
/**
 * Carbon 车道读原生视频的通道顺序（缺省 EvoLink → Vertex；1111 实测 Carbon 在 Vertex global 90 秒无回应，
 * Vertex 复测通过后可设 "vertex,evolink" 调回首位）。
 * **不含 Gemini API**：读视频需 Files API 上传或可公开拉取的地址，精读不做；env 里写了也忽略。
 */
export function nativeDeepReadCarbonRoutes(env?: GeminiModelEnv): NativeDeepReadCarbonRoute[] {
  const source = env ?? (typeof process !== "undefined" && process?.env ? (process.env as GeminiModelEnv) : {});
  return parseGeminiCarbonChannelOrder(source[NATIVE_DEEP_READ_CARBON_ROUTES_ENV], ["evolink", "vertex"], ["evolink", "vertex"]) as NativeDeepReadCarbonRoute[];
}

/**
 * 「当前合同」模型（3.8 Flash 起的双通道：Vertex 上游失败即转 EvoLink；EvoLink 读片不记降级）：
 * 配置的缺省读片模型，以及 3.8 Flash 旧车道（已入队 / 续跑的 -g38f 任务按原合同恢复）。
 * 1110 前写死为「=== gemini-3.8-flash」，现与配置的缺省模型比较。
 */
export function isNativeDeepReadCurrentContractModel(model: unknown, env?: GeminiModelEnv): boolean {
  return model === MANHUA_NATIVE_CURRENT_READ_MODEL || model === resolveManhuaNativeDeepReadModel(env);
}

/**
 * 段缓存指纹里的模型身份：3.1 Pro 与 3.8 Flash 历史上一律按缺省（3.1 Pro）身份计算、靠系列后缀分车道——
 * 改了就是已付费分片全部失配重买，必须保持「不写模型」；Argon 及 1110 起配置出来的新模型一律写入模型，
 * 换模型 = 新指纹，绝不吃别的模型的已付费结果。
 */
export function nativeDeepReadSegmentCacheIdentityModel(model: ManhuaNativeDeepReadModelId): ManhuaNativeDeepReadModelId | undefined {
  return (MANHUA_NATIVE_LEGACY_READ_MODEL_OPTIONS as readonly string[]).includes(model) ? undefined : model;
}

/** 车道后缀（历史持久身份，只增不改）：3.1 Pro 无后缀，3.8 Flash「-g38f」，Argon「-g4a」，Carbon「-g4c」（1111）。 */
const LEGACY_SERIES_SUFFIX_BY_MODEL: Readonly<Record<string, string>> = {
  "gemini-3.8-flash": "-g38f",
  "gemini-4-argon": "-g4a",
  [GEMINI_CARBON_MODEL]: "-g4c",
};
/** 1110 配置模型车道：「-gm-<去掉 gemini- 前缀、点号换下划线>」，可逆；换模型即新车道，不与旧车道混卡。 */
const CONFIGURED_SERIES_SUFFIX_MARKER = "-gm-";

function nativeDeepReadSeriesSuffix(readModel: ManhuaNativeDeepReadModelId): string {
  const legacy = LEGACY_SERIES_SUFFIX_BY_MODEL[readModel];
  if (legacy) return legacy;
  if (!isGeminiModelId(readModel)) throw new Error("读片模型标识无效，未生成系列键");
  return `${CONFIGURED_SERIES_SUFFIX_MARKER}${readModel.slice("gemini-".length).replace(/\./g, "_")}`;
}

/** 平行剧集库后缀；40 字符上限内先截基名再拼。所有 seriesKey 解析点都必须过这一层。 */
export function nativeDeepReadSeriesKeyForModel(
  baseSeriesKey: string,
  readModel?: ManhuaNativeDeepReadModelId,
): string {
  if (!readModel || readModel === MANHUA_NATIVE_DEEP_READ_MODEL) return baseSeriesKey;
  const suffix = nativeDeepReadSeriesSuffix(readModel);
  if (baseSeriesKey.endsWith(suffix)) return baseSeriesKey;
  return `${baseSeriesKey.slice(0, 40 - suffix.length)}${suffix}`;
}

/** 系列持久身份决定续跑模型，不能被另一个页面的新偏好接管。 */
export function nativeDeepReadModelForSeriesKey(seriesKey: string): ManhuaNativeDeepReadModelId {
  const at = seriesKey.lastIndexOf(CONFIGURED_SERIES_SUFFIX_MARKER);
  if (at >= 0) {
    const decoded = `gemini-${seriesKey.slice(at + CONFIGURED_SERIES_SUFFIX_MARKER.length).replace(/_/g, ".")}`;
    if (isGeminiModelId(decoded)) return decoded;
  }
  return seriesKey.endsWith("-g4c") ? MANHUA_NATIVE_CARBON_MODEL
    : seriesKey.endsWith("-g4a") ? "gemini-4-argon" : seriesKey.endsWith("-g38f") ? "gemini-3.8-flash" : MANHUA_NATIVE_DEEP_READ_MODEL;
}

/**
 * 已存任务 / worker 恢复用：旧三代照认，1110 起 env 配置出来的合法 Gemini 模型标识也认（已入队任务按保存的模型恢复，
 * 换配置不改在途任务）。空值 = 未写模型的旧任务 = 3.1 Pro（历史身份）。
 */
export function parseNativeDeepReadModel(value: unknown): ManhuaNativeDeepReadModelId {
  if (value === undefined || value === null || value === "") return MANHUA_NATIVE_DEEP_READ_MODEL;
  const id = String(value).trim();
  if ((MANHUA_NATIVE_DEEP_READ_MODEL_OPTIONS as readonly string[]).includes(id) || isGeminiModelId(id)) {
    return id;
  }
  throw new Error("读片模型标识无效");
}

/**
 * 1110：新任务入口允许的读片模型——env 配置的读片模型；3.8 Flash 旧车道（用户已批准的便宜档）保留可续学。
 * Argon / 3.1 Pro 等 Pro 级车道只有被配置成读片模型时才可新发（Pro 级需用户批准）。
 * 1111：加整集精读升级档（缺省 Carbon，站长主动选择才发）；Argon 不再可新发，旧 -g4a 系列走续学车道。
 */
export function nativeDeepReadAllowedNewReadModels(env?: GeminiModelEnv): ManhuaNativeDeepReadModelId[] {
  return Array.from(new Set([resolveManhuaNativeDeepReadModel(env), MANHUA_NATIVE_CURRENT_READ_MODEL, resolveManhuaNativeDeepReadUpgradeModel(env)]));
}

/** Legacy wire selector retained for saved jobs. Actual structuring and aggregation use FlashX since 2026-10-05. */
export const MANHUA_NATIVE_STRUCTURING_MODEL_OPTIONS = ["glm-5.3"] as const;
export type ManhuaNativeStructuringModelId = "glm-5.3";
export const MANHUA_NATIVE_STRUCTURING_MODEL = "glm-5.3" as const;
export const MANHUA_NATIVE_STRUCTURING_MODEL_LABELS: Record<(typeof MANHUA_NATIVE_STRUCTURING_MODEL_OPTIONS)[number], string> = {
  "glm-5.3": "GLM-5.3 FlashX（并发处理）",
};
export function parseNativeStructuringModel(value: unknown): ManhuaNativeStructuringModelId {
  if (value === undefined || value === null || value === "") return MANHUA_NATIVE_STRUCTURING_MODEL;
  const id = String(value).trim();
  if (id === "glm-5.3") {
    return id as ManhuaNativeStructuringModelId;
  }
  throw new Error("整形模型只允许 GLM-5.3");
}
/** 用户确认：GLM-5.3 整集结构化、系列聚合及同源探针统一使用官方支持的 high。 */
export const MANHUA_NATIVE_GLM_REASONING_EFFORT = "high" as const;

export const NATIVE_DEEP_READ_JOB_PREP_MS = 10 * 60_000;
export const NATIVE_DEEP_READ_JOB_PER_CALL_MS = 35 * 60_000;
export const NATIVE_DEEP_READ_JOB_MAX_WALL_MS = 24 * 60 * 60_000;

/**
 * 用户可选集数不能再被旧的“每次调用均串行 35 分钟”假设卡死。
 * 双音轨两路并行、视觉又按多视频装箱；这里仅保留防失控硬顶，墙钟另行封顶 24 小时。
 */
export const NATIVE_DEEP_READ_JOB_MAX_CALLS = 200;
/** 同源已有任务但本次确认参数不同；客户端必须保留旧运行卡，不得画成失败。 */
export const MANHUA_NATIVE_DEEP_READ_ACTIVE_PARAMS_CONFLICT_CODE =
  "MANHUA_NATIVE_DEEP_READ_ACTIVE_PARAMS_CONFLICT" as const;

/** 默认分片长度，不是单片硬上限；采样率由独立设置控制。 */
export const NATIVE_DEEP_READ_DEFAULT_SEGMENT_SECONDS = 300;
/** 沿用整片两小时策略，不再另外限制分片为 300 秒。 */
export const NATIVE_DEEP_READ_MAX_SEGMENT_SECONDS = MANHUA_LEARN_MAX_DURATION_SEC;
/**
 * 当前默认12fps；用户已要求不继续提高采样率。
 * 分片时长与采样率独立配置，实际请求使用调用方确认的值。
 * 历史镜数和费用应查对应请求及回执，不据镜数推断所有切镜真实或所有帧均被模型处理。
 */
export const NATIVE_DEEP_READ_DEFAULT_VIDEO_FPS = 12;
/** Google VideoMetadata.fps 的接口范围为 (0, 24]。 */
export const NATIVE_DEEP_READ_MAX_VIDEO_FPS = 24;

export function parseNativeDeepReadVideoFps(value: unknown): number {
  if (value === undefined) return NATIVE_DEEP_READ_DEFAULT_VIDEO_FPS;
  if (
    (typeof value !== "number" && typeof value !== "string")
    || (typeof value === "string" && !value.trim())
  ) {
    throw new Error(`视频采样 fps 必须大于 0 且不超过 ${NATIVE_DEEP_READ_MAX_VIDEO_FPS}`);
  }
  const fps = Number(value);
  if (!Number.isFinite(fps) || fps <= 0 || fps > NATIVE_DEEP_READ_MAX_VIDEO_FPS) {
    throw new Error(`视频采样 fps 必须大于 0 且不超过 ${NATIVE_DEEP_READ_MAX_VIDEO_FPS}`);
  }
  return fps;
}

export function parseNativeDeepReadSegmentSeconds(value: unknown): number {
  if (value === undefined) return NATIVE_DEEP_READ_DEFAULT_SEGMENT_SECONDS;
  if (
    (typeof value !== "number" && typeof value !== "string")
    || (typeof value === "string" && !value.trim())
  ) {
    throw new Error(`分片时长必须为 1–${NATIVE_DEEP_READ_MAX_SEGMENT_SECONDS} 的整数秒`);
  }
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > NATIVE_DEEP_READ_MAX_SEGMENT_SECONDS) {
    throw new Error(`分片时长必须为 1–${NATIVE_DEEP_READ_MAX_SEGMENT_SECONDS} 的整数秒`);
  }
  return seconds;
}

export const NATIVE_DEEP_READ_JOB_FIELDS = [
  "nativeDeepReadConfirmed",
  "nativeRelearn",
  "localVideoUploadId",
  "nativePlanHash",
  "nativeMaxCalls",
  "nativePlanLimit",
  "nativePlanSeriesKey",
  "nativeSegmentSeconds",
  "nativeVideoFps",
  "nativeStandaloneSource",
  "nativeReadModel",
  "nativeReadTier",
  "nativeResumeSeriesKey",
  "nativeStructuringModel",
  "nativeStructuringGateway",
  "nativeStructuringOnly",
  "nativeStructuringEpisodeIndex",
  "nativeStructuringPreviousJobId",
] as const;

export type NativeDeepReadJobConfirmation = {
  relearn?: NativeDeepReadRelearn;
  url: string;
  localVideoUploadId?: string;
  /** 旧任务的精确计划指纹；新面板直接入队时为空，由 worker 在任务内生成执行计划。 */
  planHash?: string;
  maxCalls: number;
  planLimit: number;
  segmentSeconds: number;
  videoFps: number;
  /**
   * 0901 用户令「整支即全集」：抖音大量全集长视频仍挂 mixId 但合集列表被风控/收编，
   * 勾选后跳过合集展开，按独立长视频单集学习（身份仍只绑 awemeId）。
   */
  standaloneSource: boolean;
  /** 0903 双模型：读片主模型，面板可选；缺省＝3.1 Pro。 */
  readModel: ManhuaNativeDeepReadModelId;
  /** 0905：整形首发模型；缺省 GLM-5.3。 */
  structuringModel: ManhuaNativeStructuringModelId;
  structuringGateway: "openrouter" | "evolink_glm";
  structuringOnly?: boolean;
  structuringEpisodeIndex?: number;
  structuringPreviousJobId?: string;
  /** 与 planHash 成对出现，仅用于兼容已经入队的旧任务。 */
  seriesKey?: string;
  learnLlm: "gpt" | "claude" | "deepseek";
};

/** 同源任务只有整份确认契约一致时才可复用，不能让新面板参数接管旧 jobId。 */
export function sameNativeDeepReadJobConfirmation(
  left: NativeDeepReadJobConfirmation,
  right: NativeDeepReadJobConfirmation,
): boolean {
  return left.relearn?.seriesKey === right.relearn?.seriesKey
    && left.relearn?.episodeIndex === right.relearn?.episodeIndex
    && left.relearn?.requestId === right.relearn?.requestId
    && left.url === right.url
    && left.localVideoUploadId === right.localVideoUploadId
    && left.planHash === right.planHash
    && left.maxCalls === right.maxCalls
    && left.planLimit === right.planLimit
    && left.segmentSeconds === right.segmentSeconds
    && left.videoFps === right.videoFps
    && left.standaloneSource === right.standaloneSource
    && left.readModel === right.readModel
    && left.structuringOnly === right.structuringOnly
    && left.structuringEpisodeIndex === right.structuringEpisodeIndex
    && left.structuringPreviousJobId === right.structuringPreviousJobId
    && left.structuringModel === right.structuringModel
    && left.structuringGateway === right.structuringGateway
    && left.seriesKey === right.seriesKey
    && left.learnLlm === right.learnLlm;
}

export function hasNativeDeepReadJobFields(params: Record<string, unknown>): boolean {
  return NATIVE_DEEP_READ_JOB_FIELDS.some((key) =>
    Object.prototype.hasOwnProperty.call(params, key));
}

/** API 入口与 worker 共用的单次确认契约；任何旁路字段都关闭式拒绝。 */
export function parseNativeDeepReadJobConfirmation(
  params: Record<string, unknown>,
  options: { extraSourceHosts?: readonly string[] } = {},
): NativeDeepReadJobConfirmation {
  const url = String(params.url || "").trim();
  if (Object.prototype.hasOwnProperty.call(params, "localVideoUploadId")
    && (typeof params.localVideoUploadId !== "string" || !params.localVideoUploadId.trim())) {
    throw new Error("本地上传标识必须是非空字符串");
  }
  const localVideoUploadId = String(params.localVideoUploadId || "").trim();
  const localSource = parseManhuaLocalVideoSourceRef(url);
  const planHash = String(params.nativePlanHash || "").trim();
  const maxCalls = Number(params.nativeMaxCalls);
  const planLimit = Number(params.nativePlanLimit);
  const batchSize = Number(params.batchSize);
  const seriesKey = String(params.nativePlanSeriesKey || "").trim();
  const segmentSeconds = parseNativeDeepReadSegmentSeconds(params.nativeSegmentSeconds);
  const videoFps = parseNativeDeepReadVideoFps(params.nativeVideoFps);
  const standaloneRaw = params.nativeStandaloneSource;
  if (standaloneRaw !== undefined && standaloneRaw !== true && standaloneRaw !== false
    && standaloneRaw !== "true" && standaloneRaw !== "false") {
    throw new Error("整支即全集开关必须为布尔值");
  }
  const standaloneSource = standaloneRaw === true || standaloneRaw === "true";
  const readModel = parseNativeDeepReadModel(params.nativeReadModel);
  const structuringModel = parseNativeStructuringModel(params.nativeStructuringModel);
  const structuringGateway = params.nativeStructuringGateway ?? "openrouter";
  if (structuringGateway !== "openrouter" && structuringGateway !== "evolink_glm") throw new Error("整形路由只允许 OpenRouter 或 EvoLink");
  const structuringOnly = params.nativeStructuringOnly === true;
  const structuringEpisodeIndex = Number(params.nativeStructuringEpisodeIndex);
  const structuringPreviousJobId = String(params.nativeStructuringPreviousJobId || "").trim();
  if ((params.nativeStructuringOnly !== undefined && typeof params.nativeStructuringOnly !== "boolean")
    || (structuringOnly && (!Number.isInteger(structuringEpisodeIndex) || structuringEpisodeIndex < 1 || structuringEpisodeIndex > 999
      || !/^[a-z0-9-]{1,128}$/i.test(structuringPreviousJobId) || planLimit !== 1 || !params.nativeStructuringModel))
    || (!structuringOnly && (params.nativeStructuringEpisodeIndex !== undefined || params.nativeStructuringPreviousJobId !== undefined))) {
    throw new Error("仅重新整形必须指定原任务和唯一集号，并明确选择整形模型");
  }
  const relearn = parseNativeDeepReadRelearn(params.nativeRelearn);
  if (relearn && (structuringOnly || planLimit !== 1)) throw new Error("重学仅允许本次确认的单集");
  const hasLegacyPlanConfirmation = Boolean(planHash || seriesKey);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("原生精读来源链接无效");
  }
  if (
    params.nativeDeepReadConfirmed !== true
    || (localVideoUploadId
      ? !localSource || localSource.uploadId !== localVideoUploadId || planLimit !== 1 || !standaloneSource
      : parsedUrl.protocol !== "https:" || (
        !/(?:^|\.)douyin\.com$/i.test(parsedUrl.hostname)
        && !isManhua0996SourceUrl(url, options.extraSourceHosts)
      ))
    || !Number.isInteger(maxCalls)
    || maxCalls < 1
    || maxCalls > NATIVE_DEEP_READ_JOB_MAX_CALLS
    || !Number.isInteger(planLimit)
    || planLimit < 1
    || planLimit > 200
    || batchSize !== planLimit
    || (
      hasLegacyPlanConfirmation
      && (!/^[0-9a-f]{16}$/.test(planHash) || !/^[0-9A-Za-z_-]{1,40}$/.test(seriesKey))
    )
    || String(params.gcsUri || "").trim()
    || params.refreshPreviewFrames === true
    || params.retrySkippedEpisodes === true
  ) {
    throw new Error("原生精读确认参数不完整或相互冲突");
  }
  return {
    url,
    ...(relearn ? { relearn } : {}),
    ...(localVideoUploadId ? { localVideoUploadId } : {}),
    planHash: planHash || undefined,
    maxCalls,
    planLimit,
    segmentSeconds,
    videoFps,
    standaloneSource,
    readModel,
    structuringModel,
    structuringGateway,
    ...(structuringOnly ? { structuringOnly: true, structuringEpisodeIndex, structuringPreviousJobId } : {}),
    seriesKey: seriesKey || undefined,
    learnLlm:
      params.learnLlm === "claude" || params.learnLlm === "deepseek"
        ? params.learnLlm
        : "gpt",
  };
}

/**
 * 模板学习成本统计口径汇率：1 USD = 7 CNY（用户 2026-08-13 拍板，见 kb/billing.md）。
 * 读片成本表、GLM 整形、系列聚合共用这一处；只用于成本估算展示，不参与任何用户积分扣费。
 */
export const NATIVE_DEEP_READ_PRICE_USD_TO_CNY = 7;

/** 读片配置拒因：不含模型名（前端不显示模型名）。 */
export const NATIVE_DEEP_READ_READ_MODEL_REJECTED_ZH = "所选读片模型未在服务端配置中启用，未建立学习任务" as const;
/** 续学绑定拒因：不含模型名。 */
export const NATIVE_DEEP_READ_RESUME_SERIES_MISMATCH_ZH = "续学系列身份与本次计划不一致，未发出模型请求" as const;
const NATIVE_DEEP_READ_SERIES_KEY_PATTERN = /^[0-9A-Za-z_-]{1,40}$/;

/**
 * 1111 精读档位：standard（缺省，配置的首读模型）/ upgrade（整集精读升级档，缺省 Carbon，更慢、成本更高）。
 * 前端只发档位，不发模型名。
 */
export const NATIVE_DEEP_READ_READ_TIERS = ["standard", "upgrade"] as const;
export type NativeDeepReadReadTier = (typeof NATIVE_DEEP_READ_READ_TIERS)[number];
export function parseNativeDeepReadReadTier(value: unknown): NativeDeepReadReadTier {
  if (value === undefined || value === null || value === "") return "standard";
  if (value === "standard" || value === "upgrade") return value;
  throw new Error("精读档位无效");
}

/** 客户端续学时随确认参数带上的系列键；只是「声明」，是否真已入库由服务端核实后才作数。 */
export function readNativeDeepReadResumeSeriesKey(params: Record<string, unknown>): string | undefined {
  const raw = params.nativeResumeSeriesKey;
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string" || !NATIVE_DEEP_READ_SERIES_KEY_PATTERN.test(raw)) throw new Error("续学系列标识无效");
  return raw;
}

/**
 * 续学车道模型：系列键写明的模型（-g38f / -g4a / -gm-…）。无后缀的历史 3.1 Pro 车道自 0903 起不再接新读片，
 * 返回 undefined（沿用既有行为：按配置模型另起车道，不拿新模型写进旧系列，也不重启 Pro 车道）。
 */
export function nativeDeepReadResumeLaneModel(seriesKey: string): ManhuaNativeDeepReadModelId | undefined {
  const model = nativeDeepReadModelForSeriesKey(seriesKey);
  return model === MANHUA_NATIVE_DEEP_READ_MODEL ? undefined : model;
}

/**
 * 只在新任务入口使用；worker 仍按已保存模型身份恢复，不重标历史 Pro 任务。
 * 1110：未指定模型 = env 配置的读片模型（缺省 gemini-3.8-flash）；显式指定只认 nativeDeepReadAllowedNewReadModels。
 * 续学例外（#1771 回归修复）：options.storedSeriesKey = 服务端已核实「已入库 / 在途」的系列键时，
 * 该系列按其保存的模型续学，不因当前配置改变而拒收；显式模型与系列模型不一致一律拒收（不拿别的模型续这个系列）。
 * 未核实的系列键不得传入：新系列只用配置模型。拒因不含模型名（前端不显示模型名）。
 */
export function parseNewNativeDeepReadJobConfirmation(
  params: Record<string, unknown>,
  options: { extraSourceHosts?: readonly string[]; env?: GeminiModelEnv; storedSeriesKey?: string } = {},
): NativeDeepReadJobConfirmation {
  if (params.nativeStructuringOnly === true) return parseNativeDeepReadJobConfirmation(params, options);
  const tier = parseNativeDeepReadReadTier(params.nativeReadTier);
  const raw = params.nativeReadModel;
  let requested = raw === undefined || raw === null || raw === "" ? undefined : raw;
  const laneModel = options.storedSeriesKey ? nativeDeepReadResumeLaneModel(options.storedSeriesKey) : undefined;
  if (laneModel) {
    // 续学按系列身份走，精读档位不改已入库系列的车道（-g4a / -g4c 等原样续）。
    if (requested !== undefined && requested !== laneModel) throw new Error(NATIVE_DEEP_READ_READ_MODEL_REJECTED_ZH);
    return parseNativeDeepReadJobConfirmation({ ...params, nativeReadModel: laneModel }, options);
  }
  if (tier === "upgrade") {
    // 1111 整集精读升级档：前端只发档位（不发模型名），服务端按配置解析（缺省 Carbon）。
    const upgradeModel = resolveManhuaNativeDeepReadUpgradeModel(options.env);
    if (requested !== undefined && requested !== upgradeModel) throw new Error(NATIVE_DEEP_READ_READ_MODEL_REJECTED_ZH);
    requested = upgradeModel;
  }
  if (requested !== undefined && !(nativeDeepReadAllowedNewReadModels(options.env) as readonly unknown[]).includes(requested)) {
    throw new Error(NATIVE_DEEP_READ_READ_MODEL_REJECTED_ZH);
  }
  return parseNativeDeepReadJobConfirmation({ ...params, nativeReadModel: requested || resolveManhuaNativeDeepReadModel(options.env) }, options);
}

/**
 * worker 发车前的续学绑定：凭「已入库系列」放行的非配置模型，只能落在那一个系列上。
 * 计划解析出的系列与续学系列不同（剧名变化等）且该模型当前不可新发 → 拒收，绝不用非配置模型另起新系列。
 */
export function assertNativeDeepReadResumeSeriesPlan(input: {
  resumeSeriesKey?: string;
  readModel: ManhuaNativeDeepReadModelId;
  planSeriesKey: string;
  env?: GeminiModelEnv;
}): void {
  if (!input.resumeSeriesKey || input.resumeSeriesKey === input.planSeriesKey) return;
  if (nativeDeepReadAllowedNewReadModels(input.env).includes(input.readModel)) return;
  throw new Error(NATIVE_DEEP_READ_RESUME_SERIES_MISMATCH_ZH);
}

export function resolveNativeDeepReadJobTimeoutMs(modelCalls: number): number {
  const calls = Number(modelCalls);
  if (!Number.isInteger(calls) || calls < 1 || calls > NATIVE_DEEP_READ_JOB_MAX_CALLS) {
    throw new Error(`单任务模型请求数必须为 1–${NATIVE_DEEP_READ_JOB_MAX_CALLS}`);
  }
  return Math.min(
    NATIVE_DEEP_READ_JOB_MAX_WALL_MS,
    NATIVE_DEEP_READ_JOB_PREP_MS + calls * NATIVE_DEEP_READ_JOB_PER_CALL_MS,
  );
}
