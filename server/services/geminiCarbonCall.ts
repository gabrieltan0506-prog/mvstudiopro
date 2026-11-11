/**
 * Gemini 4 Carbon 共用调用层（1111）：文字 / 多模态 generateContent，三通道 fallback。
 *
 * 站长口径：Carbon 只走 EvoLink、Gemini API、Vertex，**不接 OpenRouter**；属贵档，只在用户主动选择时调用。
 * 缺省通道顺序 Vertex → Gemini API → EvoLink（站长 1111 指定）；流式调用，有心跳就等、创建失败重新创建，env `GEMINI_CARBON_CHANNEL_ORDER` 可改，
 * 调用方也可传 channels（如模板学习只允许 EvoLink / Vertex）。
 *
 * 失败定义（任一即切下一通道）：超时、断线、HTTP 错、上游错误包、空回、MAX_TOKENS（含「先花完思考 token、正文为空」）、
 * 安全拦截、写坏（解析 / 校验不过——先在同通道带原因修复一次，仍不过再切）。
 * 429 / RESOURCE_EXHAUSTED：同通道按 GEMINI_CARBON_RATE_LIMIT_BACKOFF_MS 退避重试（2s / 5s / 10s，共 3 次），仍限流再切。
 *
 * 证据：每通道每发的 request / raw（含 HTTP 状态与完整回包）/ error / decoded / parsed / rejected 经 save 永久保存，
 * 原始与解析分对象；用量（输入 / 输出 / 思考 token）写进 raw 证据、hop-used 与日志。媒体只收 GCS（Vertex 读 gs://，
 * EvoLink 读 V4 签名 https），不内联 base64；签名 URL 不落证据。Gemini API 读媒体需 Files API 上传，本层不做：
 * 带媒体的请求跳过 Gemini API 通道并记录原因。
 *
 * 不改动任何现有直连 Gemini key 的旧调用点；Gemini API 通道是本文件新写的独立请求。
 */
import { createHash, randomUUID } from "node:crypto";
import {
  GEMINI_CARBON_CHANNEL_ORDER_ENV,
  GEMINI_CARBON_DEFAULT_CHANNEL_ORDER,
  EMPTY_GEMINI_USAGE,
  addGeminiUsage,
  estimateGeminiCarbonCostUsd,
  parseGeminiCarbonChannelOrder,
  readGeminiUsage,
  type GeminiCarbonChannel,
  type GeminiCarbonUsage,
} from "../../shared/geminiCarbon";
import { resolveGeminiModel, type GeminiModelDomain } from "../../shared/geminiModelConfig";

/**
 * 限流退避（毫秒），条数即同通道重试次数。与分支 feat/lapian-1111 `server/gemini-audio.ts`
 * `GEMINI_TWO_HOP_RATE_LIMIT_BACKOFF_MS = [2_000, 5_000, 10_000]` 同口径——该分支尚未并入本分支，先定义同值常量，合并后可改为引用。
 */
export const GEMINI_CARBON_RATE_LIMIT_BACKOFF_MS: readonly number[] = [2_000, 5_000, 10_000];
/**
 * 站长 2026-11-11：Carbon 要推理与思考，不能用固定总时长硬掐；改为流式——「有心跳就等，创建失败就重新创建」。
 * - 创建：连接建立并收到第一段数据算创建成功；CREATE_TIMEOUT 内没有任何数据、断线或 502/503/504 算创建失败，
 *   同通道重新创建 CREATE_RETRIES 次，仍失败才切下一通道。
 * - 心跳：创建成功后每收到一段数据（含思考摘要片段）就续等；连续 HEARTBEAT_TIMEOUT 没有任何数据才判失败。
 * - 总上限 TEXT_TIMEOUT 只是防挂死的兜底（30 分钟），不是正常路径上的限制。
 * 三项都可用同名 env 覆盖（GEMINI_CARBON_CREATE_TIMEOUT_MS / _HEARTBEAT_TIMEOUT_MS / _CREATE_RETRIES）。
 */
export const GEMINI_CARBON_TEXT_TIMEOUT_MS = 30 * 60_000;
export const GEMINI_CARBON_CREATE_TIMEOUT_MS = 90_000;
export const GEMINI_CARBON_HEARTBEAT_TIMEOUT_MS = 120_000;
export const GEMINI_CARBON_CREATE_RETRIES = 2;
/**
 * 缺省思考设置：调用方没给 thinkingConfig 时由调用层补上。Gemini 4 Carbon 只认 thinkingLevel（LOW / MEDIUM / HIGH，
 * 给 thinkingBudget 会 400）；includeThoughts 让思考摘要随流回来，既是心跳也是证据。env GEMINI_CARBON_THINKING_LEVEL 可改档。
 */
export const GEMINI_CARBON_DEFAULT_THINKING_LEVEL = "HIGH";
/** 缺省输出上限：输出含思考 token，给小了会 MAX_TOKENS 空正文（1111 实测）。 */
export const GEMINI_CARBON_DEFAULT_MAX_OUTPUT_TOKENS = 65_536;

export type GeminiCarbonPart = { text: string } | { media: { mimeType: string; gsUri: string; label?: string } };

export type GeminiCarbonFailureKind =
  | "unavailable" | "unsupported" | "timeout" | "network" | "http" | "rate_limited" | "provider_error"
  | "empty" | "max_tokens" | "blocked" | "invalid_output";

/** 单通道失败（已含退避后的最终结论）；reasonZh 只进证据与日志，不得原样回给前台（含通道名）。 */
export class GeminiCarbonChannelError extends Error {
  constructor(
    readonly channel: GeminiCarbonChannel,
    readonly kind: GeminiCarbonFailureKind,
    readonly reasonZh: string,
    readonly status?: number,
    /** 已收到回包的失败（MAX_TOKENS / 拦截 / 空回等）也已计费：用量随错误带回，计入总用量。 */
    readonly usage?: GeminiCarbonUsage,
  ) {
    super(`${channel}：${reasonZh}`);
    this.name = "GeminiCarbonChannelError";
  }
}

/** 全部通道失败：failuresZh 只进证据与日志；面向用户的提示由调用方另写中性文案。 */
export class GeminiCarbonExhaustedError extends Error {
  constructor(readonly failuresZh: string[], readonly usage: GeminiCarbonUsage) {
    super(`Carbon 全部通道失败：${failuresZh.join("；")}`);
    this.name = "GeminiCarbonExhaustedError";
  }
}

export type GeminiCarbonSave = (name: string, value: unknown) => Promise<unknown>;

export type GeminiCarbonDeps = {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  env: Record<string, string | undefined>;
  vertexAuthHeaders: () => Promise<Record<string, string>>;
  vertexProjectId: () => string;
  signGsUri: (gsUri: string, expiresSeconds: number) => string;
  now: () => number;
};

const realDeps = (): GeminiCarbonDeps => ({
  fetch: (...args) => fetch(...args),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  env: process.env as Record<string, string | undefined>,
  vertexAuthHeaders: async () => {
    const { getVertexAuthHeaders } = await import("./vertexMedia");
    return (await getVertexAuthHeaders()) as Record<string, string>;
  },
  vertexProjectId: () => {
    const projectId = String(process.env.VERTEX_PROJECT_ID || "").trim();
    if (!projectId) throw new Error("missing_env_VERTEX_PROJECT_ID");
    return projectId;
  },
  // 真签名函数在 defaultDeps 里延迟加载（gcs 模块在测试替身里不需要）。
  signGsUri: () => { throw new Error("signGsUri 未注入"); },
  now: () => Date.now(),
});

let signImpl: ((gsUri: string, expiresSeconds: number) => string) | undefined;
async function defaultDeps(): Promise<GeminiCarbonDeps> {
  if (!signImpl) signImpl = (await import("./gcs")).signGsUriV4ReadUrl;
  return { ...realDeps(), signGsUri: signImpl };
}

/** 通道顺序：调用方显式给出优先；否则读 env（缺省 Vertex → Gemini API → EvoLink）。allowed 限制可用通道。 */
export function resolveGeminiCarbonChannelOrder(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
  options: { envName?: string; fallback?: readonly GeminiCarbonChannel[]; allowed?: readonly GeminiCarbonChannel[] } = {},
): GeminiCarbonChannel[] {
  const fallback = options.fallback ?? GEMINI_CARBON_DEFAULT_CHANNEL_ORDER;
  const allowed = options.allowed;
  const order = parseGeminiCarbonChannelOrder(env[options.envName ?? GEMINI_CARBON_CHANNEL_ORDER_ENV], fallback, allowed);
  return order;
}

function channelConfigured(channel: GeminiCarbonChannel, env: Record<string, string | undefined>): boolean {
  if (channel === "evolink") return Boolean(String(env.EVOLINK_API_KEY || "").trim());
  if (channel === "gemini_api") return Boolean(String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim());
  const hasCredentials = Boolean(String(env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim() || String(env.GOOGLE_APPLICATION_CREDENTIALS || "").trim());
  return hasCredentials && Boolean(String(env.VERTEX_PROJECT_ID || "").trim());
}

/** 通道中文名：只进证据与服务端日志。 */
export const GEMINI_CARBON_CHANNEL_LABEL_ZH: Record<GeminiCarbonChannel, string> = {
  evolink: "EvoLink",
  gemini_api: "Gemini API",
  vertex: "Vertex",
};

export type GeminiCarbonRequest = {
  model: string;
  systemInstruction?: string;
  parts: GeminiCarbonPart[];
  generationConfig: Record<string, unknown>;
};

export type GeminiCarbonChannelResult = {
  channel: GeminiCarbonChannel;
  model: string;
  status: number;
  payload: unknown;
  text: string;
  finishReason?: string;
  usage: GeminiCarbonUsage;
  elapsedMs: number;
  rateLimitRetries: number;
  /** 流式：首段数据到达耗时与收到的网络分段数（心跳观测用）。 */
  firstDataMs?: number | null;
  segments?: number;
};

function requestHasMedia(request: GeminiCarbonRequest): boolean {
  return request.parts.some((part) => "media" in part);
}

function buildBody(request: GeminiCarbonRequest, mediaUri: (gsUri: string) => string) {
  const parts = request.parts.flatMap((part) => {
    if ("text" in part) return [{ text: part.text }];
    if (!/^gs:\/\/[^/]+\/.+/.test(part.media.gsUri)) throw new Error("Carbon 媒体只收 GCS gs:// 对象（不收内联或外链）");
    return [
      ...(part.media.label ? [{ text: part.media.label }] : []),
      { fileData: { mimeType: part.media.mimeType, fileUri: mediaUri(part.media.gsUri) } },
    ];
  });
  return {
    ...(request.systemInstruction ? { systemInstruction: { parts: [{ text: request.systemInstruction }] } } : {}),
    contents: [{ role: "user", parts }],
    generationConfig: request.generationConfig,
  };
}

/** 证据里的请求摘要：媒体只记 gs://，不记签名 URL。 */
function requestEvidence(request: GeminiCarbonRequest) {
  return {
    model: request.model,
    systemInstruction: request.systemInstruction,
    parts: request.parts.map((part) => ("text" in part ? { text: part.text } : { media: { mimeType: part.media.mimeType, gsUri: part.media.gsUri, label: part.media.label } })),
    generationConfig: request.generationConfig,
  };
}

/** 正文：拼接非思考 part 的 text。 */
export function readGeminiCarbonText(payload: unknown): string {
  const parts = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }> } | null)
    ?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts) ? parts.filter((part) => part?.thought !== true).map((part) => String(part?.text ?? "")).join("").trim() : "";
}

function isRateLimited(status: number, payload: unknown): boolean {
  if (status === 429) return true;
  const error = (payload as { error?: { status?: unknown; code?: unknown } } | null)?.error;
  return String(error?.status || "").toUpperCase() === "RESOURCE_EXHAUSTED" || Number(error?.code) === 429;
}

/** 流式等待中断：create = 创建期内没有任何数据；heartbeat = 已有数据后心跳中断；ceiling = 触及总上限。 */
class GeminiCarbonStreamStall extends Error {
  constructor(readonly phase: "create" | "heartbeat" | "ceiling") { super(phase); this.name = "GeminiCarbonStreamStall"; }
}
/** 流式过程中的网络错误：gotData 区分「创建失败」与「中途断流」。 */
class GeminiCarbonStreamBroken extends Error {
  constructor(readonly gotData: boolean, readonly causeMessage: string) { super(causeMessage); this.name = "GeminiCarbonStreamBroken"; }
}

const positiveInt = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && String(value ?? "").trim() !== "" ? Math.floor(n) : fallback;
};

/**
 * 把流式回包还原成与非流式同形的单个回包：逐段拼接正文与思考摘要，finishReason / usageMetadata / promptFeedback 取最后出现的。
 * 兼容三种形态：SSE（data: 行）、JSON 数组（未带 alt=sse 的流式）、单个 JSON 对象（网关不支持流式时的整包）。无法解析返回 null。
 */
export function mergeGeminiCarbonStream(rawText: string): unknown {
  const dataLines = rawText.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter((line) => line && line !== "[DONE]");
  let chunks: unknown[];
  if (dataLines.length) {
    chunks = dataLines.flatMap((line) => { try { return [JSON.parse(line) as unknown]; } catch { return []; } });
  } else {
    try {
      const parsed = JSON.parse(rawText) as unknown;
      if (!Array.isArray(parsed)) return parsed;
      chunks = parsed;
    } catch { return null; }
  }
  if (!chunks.length) return null;
  if (chunks.length === 1) return chunks[0];
  let text = "";
  let thoughts = "";
  let finishReason: unknown;
  let usageMetadata: unknown;
  let promptFeedback: unknown;
  let error: unknown;
  for (const chunk of chunks as Array<{ error?: unknown; promptFeedback?: unknown; usageMetadata?: unknown; candidates?: Array<{ finishReason?: unknown; content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }> }>) {
    if (chunk?.error) error = chunk.error;
    if (chunk?.promptFeedback) promptFeedback = chunk.promptFeedback;
    if (chunk?.usageMetadata) usageMetadata = chunk.usageMetadata;
    const candidate = chunk?.candidates?.[0];
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part?.text !== "string") continue;
      if (part.thought === true) thoughts += part.text; else text += part.text;
    }
  }
  const hasCandidate = Boolean(text || thoughts || finishReason);
  return {
    ...(error ? { error } : {}),
    candidates: hasCandidate ? [{
      content: { role: "model", parts: [...(thoughts ? [{ text: thoughts, thought: true }] : []), ...(text ? [{ text }] : [])] },
      ...(finishReason ? { finishReason } : {}),
    }] : [],
    ...(usageMetadata ? { usageMetadata } : {}),
    ...(promptFeedback ? { promptFeedback } : {}),
    streamChunks: chunks.length,
  };
}

/** 发起一次流式请求并读完：创建期与心跳各自计时，任何一段数据到达都重置心跳。 */
async function fetchGeminiCarbonStream(
  deps: GeminiCarbonDeps,
  target: { url: string; headers: Record<string, string>; body: unknown },
  limits: { createMs: number; heartbeatMs: number; ceilingMs: number; signal?: AbortSignal },
): Promise<{ status: number; rawText: string; segments: number; firstDataMs: number | null }> {
  const controller = new AbortController();
  let stall: GeminiCarbonStreamStall | undefined;
  let gotData = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number, phase: "create" | "heartbeat") => {
    clearTimeout(timer);
    timer = setTimeout(() => { stall = new GeminiCarbonStreamStall(phase); controller.abort(); }, ms);
  };
  const ceiling = setTimeout(() => { stall = new GeminiCarbonStreamStall("ceiling"); controller.abort(); }, limits.ceilingMs);
  const onOuterAbort = () => controller.abort();
  limits.signal?.addEventListener("abort", onOuterAbort, { once: true });
  const started = Date.now();
  try {
    arm(limits.createMs, "create");
    const response = await deps.fetch(target.url, { method: "POST", headers: { ...target.headers, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(target.body), signal: controller.signal });
    let rawText = "";
    let segments = 0;
    let firstDataMs: number | null = null;
    const reader = response.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        if (firstDataMs === null) firstDataMs = Date.now() - started;
        gotData = true;
        segments += 1;
        rawText += decoder.decode(value, { stream: true });
        arm(limits.heartbeatMs, "heartbeat");
      }
      rawText += decoder.decode();
    } else {
      rawText = await response.text();
      if (rawText) { gotData = true; segments = 1; firstDataMs = Date.now() - started; }
    }
    return { status: response.status, rawText, segments, firstDataMs };
  } catch (error) {
    if (limits.signal?.aborted) throw error;
    if (stall) throw stall;
    throw new GeminiCarbonStreamBroken(gotData, String((error as Error)?.message || error).slice(0, 160));
  } finally {
    clearTimeout(timer);
    clearTimeout(ceiling);
    limits.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * 单通道调用（流式；含创建失败的重新创建与 429 同通道退避）。成功 = HTTP 2xx、无错误包、有非空正文、finishReason 不是 MAX_TOKENS / 拦截。
 * 每一发（含重新创建与退避重试）都落证据：raw 存流式原文（rawStream）与还原后的回包（payload）两份；创建失败 / 心跳中断 / 断流落 error。
 */
export async function callGeminiCarbonChannel(
  channel: GeminiCarbonChannel,
  request: GeminiCarbonRequest,
  options: { timeoutMs?: number; signal?: AbortSignal; save: GeminiCarbonSave; slug: string; backoffMs?: readonly number[]; deps?: GeminiCarbonDeps },
): Promise<GeminiCarbonChannelResult> {
  const deps = options.deps ?? (await defaultDeps());
  const env = deps.env;
  const timeoutMs = options.timeoutMs ?? GEMINI_CARBON_TEXT_TIMEOUT_MS;
  const backoff = options.backoffMs ?? GEMINI_CARBON_RATE_LIMIT_BACKOFF_MS;
  if (!channelConfigured(channel, env)) throw new GeminiCarbonChannelError(channel, "unavailable", "未配置");
  if (channel === "gemini_api" && requestHasMedia(request)) {
    throw new GeminiCarbonChannelError(channel, "unsupported", "带媒体请求需 Files API 上传或可公开拉取的地址，本层不做，跳过");
  }
  const model = request.model;
  // 思考：调用方没指定就补缺省（Carbon 只认 thinkingLevel）；includeThoughts 让思考摘要随流返回。
  if (request.generationConfig.thinkingConfig === undefined) {
    const level = String(env.GEMINI_CARBON_THINKING_LEVEL || GEMINI_CARBON_DEFAULT_THINKING_LEVEL).trim().toUpperCase();
    request = { ...request, generationConfig: { ...request.generationConfig, thinkingConfig: { thinkingLevel: /^(LOW|MEDIUM|HIGH)$/.test(level) ? level : GEMINI_CARBON_DEFAULT_THINKING_LEVEL, includeThoughts: true } } };
  }
  const target = async (): Promise<{ url: string; headers: Record<string, string>; body: unknown }> => {
    if (channel === "evolink") {
      const base = String(env.EVOLINK_DIRECT_BASE_URL || "https://direct.evolink.ai").trim().replace(/\/+$/, "") || "https://direct.evolink.ai";
      return {
        url: `${base}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
        headers: { Authorization: `Bearer ${String(env.EVOLINK_API_KEY || "").trim()}` },
        // EvoLink 读不了 gs://，只认签名 https；签名在发请求前现签，不落证据。
        body: buildBody(request, (gsUri) => deps.signGsUri(gsUri, 3600)),
      };
    }
    if (channel === "gemini_api") {
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
        headers: { "x-goog-api-key": String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim() },
        body: buildBody(request, (gsUri) => gsUri),
      };
    }
    const location = String(env.GEMINI_CARBON_VERTEX_LOCATION || env.VERTEX_GEMINI_LOCATION || "global").trim() || "global";
    const host = location === "global" ? "https://aiplatform.googleapis.com" : `https://${location}-aiplatform.googleapis.com`;
    return {
      url: `${host}/v1/projects/${encodeURIComponent(deps.vertexProjectId())}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      headers: await deps.vertexAuthHeaders(),
      body: buildBody(request, (gsUri) => gsUri),
    };
  };
  const createMs = positiveInt(env.GEMINI_CARBON_CREATE_TIMEOUT_MS, GEMINI_CARBON_CREATE_TIMEOUT_MS) || GEMINI_CARBON_CREATE_TIMEOUT_MS;
  const heartbeatMs = positiveInt(env.GEMINI_CARBON_HEARTBEAT_TIMEOUT_MS, GEMINI_CARBON_HEARTBEAT_TIMEOUT_MS) || GEMINI_CARBON_HEARTBEAT_TIMEOUT_MS;
  const createRetries = positiveInt(env.GEMINI_CARBON_CREATE_RETRIES, GEMINI_CARBON_CREATE_RETRIES);
  let createAttempt = 0;
  for (let retry = 0; ; ) {
    options.signal?.throwIfAborted();
    const started = deps.now();
    const evidenceTag = `${options.slug}${retry ? `-retry${retry}` : ""}${createAttempt ? `-recreate${createAttempt}` : ""}`;
    let status = 0;
    let payload: unknown = null;
    let rawText = "";
    let segments = 0;
    let firstDataMs: number | null = null;
    try {
      const outcome = await fetchGeminiCarbonStream(deps, await target(), { createMs, heartbeatMs, ceilingMs: timeoutMs, signal: options.signal });
      ({ status, rawText, segments, firstDataMs } = outcome);
      payload = mergeGeminiCarbonStream(rawText);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const stall = error instanceof GeminiCarbonStreamStall ? error : undefined;
      const broken = error instanceof GeminiCarbonStreamBroken ? error : undefined;
      const createFailed = stall ? stall.phase === "create" : broken ? !broken.gotData : true;
      const reason = stall?.phase === "create" ? `创建失败：${Math.round(createMs / 1000)} 秒内没有任何回应`
        : stall?.phase === "heartbeat" ? `心跳中断：连续 ${Math.round(heartbeatMs / 1000)} 秒没有数据`
        : stall?.phase === "ceiling" ? `触及总上限（${Math.round(timeoutMs / 60_000)} 分钟）`
        : `${createFailed ? "创建失败" : "中途断流"}：${broken?.causeMessage ?? String((error as Error)?.message || error).slice(0, 160)}`;
      const willRecreate = createFailed && createAttempt < createRetries;
      await options.save(`${evidenceTag}-error`, { channel, model, reasonZh: reason, elapsedMs: deps.now() - started, createFailed, willRecreate });
      if (willRecreate) {
        createAttempt += 1;
        console.warn(`[geminiCarbon] ${channel} ${reason}，同通道重新创建（${createAttempt}/${createRetries}）`);
        await deps.sleep(2_000);
        continue;
      }
      throw new GeminiCarbonChannelError(channel, stall ? "timeout" : "network", reason);
    }
    const elapsedMs = deps.now() - started;
    const usage = readGeminiUsage(payload);
    const finishReason = String((payload as { candidates?: Array<{ finishReason?: unknown }> } | null)?.candidates?.[0]?.finishReason ?? "") || undefined;
    await options.save(`${evidenceTag}-raw`, {
      channel, model, status, elapsedMs, firstDataMs, segments, finishReason, usage,
      estimatedCostUsd: estimateGeminiCarbonCostUsd(usage),
      // 原始与还原各存一份：rawStream 是上游原文（流式分段），payload 是还原后的同形回包。
      rawStream: rawText,
      ...(payload === null ? {} : { payload }),
    });
    if (isRateLimited(status, payload)) {
      if (retry < backoff.length) {
        console.warn(`[geminiCarbon] ${channel} 限流（HTTP ${status}），${backoff[retry]}ms 后同通道重试（${retry + 1}/${backoff.length}）`);
        await deps.sleep(backoff[retry]!);
        retry += 1;
        createAttempt = 0;
        continue;
      }
      throw new GeminiCarbonChannelError(channel, "rate_limited", `限流，同通道退避 ${backoff.length} 次仍限流`, status, usage);
    }
    if ((status === 502 || status === 503 || status === 504) && createAttempt < createRetries) {
      createAttempt += 1;
      console.warn(`[geminiCarbon] ${channel} 创建失败（HTTP ${status}），同通道重新创建（${createAttempt}/${createRetries}）`);
      await deps.sleep(2_000);
      continue;
    }
    if (status < 200 || status >= 300) throw new GeminiCarbonChannelError(channel, "http", `HTTP ${status}`, status, usage);
    if (payload === null) throw new GeminiCarbonChannelError(channel, "provider_error", "回包不是 JSON", status, usage);
    const providerError = (payload as { error?: { message?: unknown } }).error;
    if (providerError && !(payload as { candidates?: unknown[] }).candidates?.length) {
      throw new GeminiCarbonChannelError(channel, "provider_error", `上游错误包：${String(providerError.message || "").slice(0, 160)}`, status, usage);
    }
    const text = readGeminiCarbonText(payload);
    if (finishReason === "MAX_TOKENS") {
      throw new GeminiCarbonChannelError(channel, "max_tokens", text ? "输出达上限被截断（MAX_TOKENS）" : "输出上限被思考 token 用完，正文为空（MAX_TOKENS）", status, usage);
    }
    if (finishReason && /SAFETY|PROHIBITED|BLOCKLIST|RECITATION|SPII/.test(finishReason)) {
      throw new GeminiCarbonChannelError(channel, "blocked", `被拦截（${finishReason}）`, status, usage);
    }
    const blockReason = (payload as { promptFeedback?: { blockReason?: unknown } }).promptFeedback?.blockReason;
    if (blockReason) throw new GeminiCarbonChannelError(channel, "blocked", `输入被拦截（${String(blockReason)}）`, status, usage);
    if (!text) throw new GeminiCarbonChannelError(channel, "empty", "空回", status, usage);
    return { channel, model, status, payload, text, finishReason, usage, elapsedMs, rateLimitRetries: retry, firstDataMs, segments };
  }
}

/** 去掉 ```json 围栏后 JSON.parse。 */
export function decodeGeminiCarbonJson(text: string): unknown {
  return JSON.parse(String(text).replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim());
}

export type GeminiCarbonRunInput<T> = {
  /** 用于解析模型的领域（缺省 geminiCarbon）；给 model 则直接用。 */
  domain?: GeminiModelDomain;
  model?: string;
  channels?: readonly GeminiCarbonChannel[];
  systemInstruction?: string;
  prompt: string;
  /** 排在 prompt 之前的 GCS 媒体。 */
  media?: Array<{ mimeType: string; gsUri: string; label?: string }>;
  /** json：要求 application/json 并按 JSON 解码；text：正文原样交 validate。 */
  responseFormat?: "json" | "text";
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  /** 其余 generationConfig（如 thinkingConfig）；调用方显式给出才发送。 */
  extraGenerationConfig?: Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** json 模式的解码（缺省去围栏后 JSON.parse）；调用方有更宽容的解析器时传入（如小说 JSON 的语法修复）。 */
  decode?: (text: string) => unknown;
  /** 解码后校验；抛错 = 写坏（同通道带原因修复一次，仍不过切下一通道）。 */
  validate: (decoded: unknown, text: string) => T | Promise<T>;
  /** 修复提示：缺省在原 prompt 后追加拒因。 */
  repairPrompt?: (reasonZh: string) => string;
  save: GeminiCarbonSave;
  /** 日志标签（不含正文）。 */
  label: string;
  backoffMs?: readonly number[];
  deps?: GeminiCarbonDeps;
};

export type GeminiCarbonRunResult<T> = {
  value: T;
  text: string;
  channel: GeminiCarbonChannel;
  model: string;
  hop: number;
  repaired: boolean;
  usage: GeminiCarbonUsage;
  /** 本次全部发（含失败通道与修复发）的用量合计。 */
  totalUsage: GeminiCarbonUsage;
  estimatedCostUsd: number;
  failuresZh: string[];
  elapsedMs: number;
  payload: unknown;
};

/**
 * 三通道 fallback 主入口：按通道顺序逐个调用 → 解码 → validate；写坏先同通道修复一次，仍不过切下一通道；
 * 通道层失败（超时 / 断线 / HTTP / 空回 / MAX_TOKENS / 拦截 / 限流退避用尽）直接切下一通道。全部失败抛 GeminiCarbonExhaustedError。
 */
export async function runGeminiCarbon<T>(input: GeminiCarbonRunInput<T>): Promise<GeminiCarbonRunResult<T>> {
  const deps = input.deps ?? (await defaultDeps());
  const model = String(input.model || "").trim() || resolveGeminiModel(input.domain ?? "geminiCarbon", deps.env);
  const channels = input.channels?.length ? [...input.channels] : resolveGeminiCarbonChannelOrder(deps.env);
  const format = input.responseFormat ?? "json";
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: input.maxOutputTokens ?? GEMINI_CARBON_DEFAULT_MAX_OUTPUT_TOKENS,
    ...(format === "json" ? { responseMimeType: "application/json" } : {}),
    ...(input.responseSchema ? { responseSchema: input.responseSchema } : {}),
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.extraGenerationConfig ?? {}),
  };
  const media = input.media ?? [];
  const requestFor = (prompt: string): GeminiCarbonRequest => ({
    model,
    systemInstruction: input.systemInstruction,
    parts: [...media.map((m) => ({ media: m })), { text: prompt }],
    generationConfig,
  });
  const failures: string[] = [];
  let totalUsage: GeminiCarbonUsage = { ...EMPTY_GEMINI_USAGE };
  const started = deps.now();
  const promptSha256 = createHash("sha256").update(input.systemInstruction ?? "").update("\u0000").update(input.prompt).digest("hex");
  for (let index = 0; index < channels.length; index += 1) {
    const channel = channels[index]!;
    let reasonZh: string | undefined;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const slug = `hop-${index + 1}-${channel}${attempt > 1 ? "-repair" : ""}`;
      const prompt = reasonZh
        ? (input.repairPrompt?.(reasonZh) ?? `${input.prompt}\n\n上一版输出未通过服务端校验：${reasonZh}。请逐条修正后重新输出完整结果（不得只输出解释或声称已修好）。`)
        : input.prompt;
      const request = requestFor(prompt);
      await input.save(`${slug}-request`, { ...requestEvidence(request), channel, label: input.label, promptSha256, repairOf: reasonZh, timeoutMs: input.timeoutMs ?? GEMINI_CARBON_TEXT_TIMEOUT_MS });
      let result: GeminiCarbonChannelResult;
      try {
        result = await callGeminiCarbonChannel(channel, request, { timeoutMs: input.timeoutMs, signal: input.signal, save: input.save, slug, backoffMs: input.backoffMs, deps });
      } catch (error) {
        if (!(error instanceof GeminiCarbonChannelError)) {
          if (input.signal?.aborted) throw error;
          failures.push(`${GEMINI_CARBON_CHANNEL_LABEL_ZH[channel]}（${String((error as Error)?.message || error).slice(0, 160)}）`);
          await input.save(`${slug}-failed`, { channel, reasonZh: String((error as Error)?.message || error).slice(0, 300) });
          break;
        }
        if (error.usage) totalUsage = addGeminiUsage(totalUsage, error.usage);
        failures.push(`${GEMINI_CARBON_CHANNEL_LABEL_ZH[channel]}${attempt > 1 ? "（修复发）" : ""}（${error.reasonZh}）`);
        await input.save(error.kind === "unavailable" || error.kind === "unsupported" ? `${slug}-skipped` : `${slug}-failed`, { channel, kind: error.kind, reasonZh: error.reasonZh, status: error.status });
        console.warn(`[geminiCarbon] ${input.label} ${channel}${attempt > 1 ? "（修复发）" : ""} 失败：${error.kind}${error.status ? ` HTTP ${error.status}` : ""}，切下一通道`);
        break;
      }
      totalUsage = addGeminiUsage(totalUsage, result.usage);
      try {
        const decoded = format === "json" ? (input.decode ?? decodeGeminiCarbonJson)(result.text) : result.text;
        if (format === "json") await input.save(`${slug}-decoded`, decoded);
        const value = await input.validate(decoded, result.text);
        await input.save(`${slug}-parsed`, value);
        const elapsedMs = deps.now() - started;
        const used = { channel, model, hop: index + 1, repaired: attempt > 1, usage: result.usage, totalUsage, estimatedCostUsd: estimateGeminiCarbonCostUsd(totalUsage), failuresZh: failures, elapsedMs };
        await input.save("hop-used", used);
        console.info(`[geminiCarbon] ${input.label} 通过：${channel} 第${index + 1}通道${attempt > 1 ? "（修复发）" : ""} in=${result.usage.inputTokens} out=${result.usage.outputTokens} thoughts=${result.usage.thoughtsTokens} 合计≈$${used.estimatedCostUsd} ${result.elapsedMs}ms`);
        return { value, text: result.text, channel, model, hop: index + 1, repaired: attempt > 1, usage: result.usage, totalUsage, estimatedCostUsd: used.estimatedCostUsd, failuresZh: failures, elapsedMs, payload: result.payload };
      } catch (error) {
        reasonZh = (error instanceof Error ? error.message : String(error)).slice(0, 600);
        failures.push(`${GEMINI_CARBON_CHANNEL_LABEL_ZH[channel]}${attempt > 1 ? "（修复发）" : ""}（写坏：${reasonZh.slice(0, 200)}）`);
        await input.save(`${slug}-rejected`, { channel, reasonZh, textLength: result.text.length, textHead: result.text.slice(0, 400), textTail: result.text.slice(-400) });
        console.warn(`[geminiCarbon] ${input.label} ${channel}${attempt > 1 ? "（修复发）" : ""} 写坏${attempt > 1 ? "，切下一通道" : "，同通道带原因修复一次"}`);
      }
    }
  }
  await input.save("hop-exhausted", { failuresZh: failures, totalUsage, estimatedCostUsd: estimateGeminiCarbonCostUsd(totalUsage), elapsedMs: deps.now() - started });
  console.warn(`[geminiCarbon] ${input.label} 全部通道失败（${failures.length} 项），in=${totalUsage.inputTokens} out=${totalUsage.outputTokens} thoughts=${totalUsage.thoughtsTokens}`);
  throw new GeminiCarbonExhaustedError(failures, totalUsage);
}

/**
 * 证据落 GCS：`<prefix>/<name>.json`，只增不覆盖（同名已存在即报错，防止覆盖已付费回包）。
 * 用于没有自带证据目录的调用方（小说线路三等）。
 */
export function createGeminiCarbonGcsSaver(prefix: string): GeminiCarbonSave & { prefix: string } {
  const clean = prefix.replace(/\/+$/, "");
  const save = async (name: string, value: unknown) => {
    const { uploadBufferToGcsIfAbsent } = await import("./gcs");
    const buffer = Buffer.from(JSON.stringify(value));
    const objectName = `${clean}/${name}.json`;
    const saved = await uploadBufferToGcsIfAbsent({ objectName, buffer, contentType: "application/json; charset=utf-8" });
    if (!saved.created) throw new Error("Carbon 证据已存在，未覆盖原记录");
    return { objectName, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") };
  };
  return Object.assign(save, { prefix: clean });
}

/** 缺省证据目录：gemini-carbon/<area>/<日期>/<uuid>。 */
export function geminiCarbonEvidencePrefix(area: string, now = new Date()): string {
  return `gemini-carbon/${area.replace(/[^a-zA-Z0-9._/-]+/g, "_")}/${now.toISOString().slice(0, 10)}/${randomUUID()}`;
}
