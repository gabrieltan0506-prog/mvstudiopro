/**
 * Qwen-Audio-3.0-TTS-Plus · Token Plan 对白核心。
 *
 * 只允许两个套餐端点：新加坡优先，北京兜底。上游请求严格锁成该端点已验证的
 * model/input/voice/response_format/seed 五字段；不接受 OpenRouter、百炼按量或
 * workspace base。只有收到明确 HTTP 4xx 拒绝才换区，网络/超时/5xx 等结果未知
 * 一律停止，避免同一段对白被重复合成、重复计费。
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  evaluateManhuaDialogueSilenceDetectLog,
  type ManhuaDialogueVoiceGateResult,
} from "../../shared/manhuaDialogueVoiceGate.js";
import {
  getGcsBucketName,
  signGsUriV4ReadUrl,
  uploadBufferToGcs,
} from "./gcs.js";

const execFileAsync = promisify(execFile);

export const TOKEN_PLAN_DIALOGUE_TTS_MODEL = "qwen-audio-3.0-tts-plus" as const;
export const TOKEN_PLAN_DIALOGUE_TTS_SG_ORIGIN =
  "https://token-plan.ap-southeast-1.maas.aliyuncs.com" as const;
export const TOKEN_PLAN_DIALOGUE_TTS_BEIJING_ORIGIN =
  "https://token-plan.cn-beijing.maas.aliyuncs.com" as const;
export const TOKEN_PLAN_DIALOGUE_TTS_PATH =
  "/compatible-mode/v1/audio/speech" as const;
export const TOKEN_PLAN_DIALOGUE_TTS_SG_ENDPOINT =
  `${TOKEN_PLAN_DIALOGUE_TTS_SG_ORIGIN}${TOKEN_PLAN_DIALOGUE_TTS_PATH}` as const;
export const TOKEN_PLAN_DIALOGUE_TTS_BEIJING_ENDPOINT =
  `${TOKEN_PLAN_DIALOGUE_TTS_BEIJING_ORIGIN}${TOKEN_PLAN_DIALOGUE_TTS_PATH}` as const;

export const TOKEN_PLAN_DIALOGUE_TTS_MAX_BYTES = 16 * 1024 * 1024;
export const TOKEN_PLAN_DIALOGUE_TTS_MIN_BYTES = 256;
export const TOKEN_PLAN_DIALOGUE_TTS_TIMEOUT_MS = 120_000;

export type TokenPlanDialogueTtsRequest = {
  model: typeof TOKEN_PLAN_DIALOGUE_TTS_MODEL;
  input: string;
  voice: string;
  response_format: "mp3";
  seed: number;
};

export type TokenPlanDialogueTtsInput = {
  input: string;
  voice: string;
  /** 只用于 GCS 对象隔离，不会进入上游五字段请求。 */
  ownerUserId: number;
  seed?: number;
  signal?: AbortSignal;
};

export type TokenPlanDialogueTtsRegion = "singapore" | "beijing";

export type TokenPlanDialogueTtsResult = {
  audioUrl: string;
  gcsUri: string;
  bytes: number;
  voice: string;
  generationId: string;
  region: TokenPlanDialogueTtsRegion;
  voiceGate: Extract<ManhuaDialogueVoiceGateResult, { accepted: true }>;
};

type TokenPlanRoute = {
  region: TokenPlanDialogueTtsRegion;
  endpoint: string;
  apiKey: string;
};

type ExecFileResult = { stdout?: string | Buffer; stderr?: string | Buffer };
export type TokenPlanDialogueTtsExecFile = (
  command: "ffprobe" | "ffmpeg",
  args: string[],
  options: { timeout: number; maxBuffer: number; signal?: AbortSignal }
) => Promise<ExecFileResult>;

export type TokenPlanDialogueTtsDependencies = {
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  maxAudioBytes?: number;
  inspectAudio?: (
    audio: Buffer,
    options: { signal?: AbortSignal }
  ) => Promise<ManhuaDialogueVoiceGateResult>;
  uploadAudio?: typeof uploadBufferToGcs;
  signAudioUrl?: typeof signGsUriV4ReadUrl;
  now?: () => Date;
  createId?: () => string;
};

export class TokenPlanDialogueTtsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenPlanDialogueTtsConfigurationError";
  }
}

export class TokenPlanDialogueTtsExplicitRejectionError extends Error {
  constructor(
    readonly region: TokenPlanDialogueTtsRegion,
    readonly status: number
  ) {
    super(`token_plan_tts_explicit_rejection:${region}:http_${status}`);
    this.name = "TokenPlanDialogueTtsExplicitRejectionError";
  }
}

export class TokenPlanDialogueTtsUnknownResultError extends Error {
  constructor(
    readonly region: TokenPlanDialogueTtsRegion,
    readonly status?: number
  ) {
    super(
      `token_plan_tts_result_unknown:${region}${status ? `:http_${status}` : ""}`
    );
    this.name = "TokenPlanDialogueTtsUnknownResultError";
  }
}

export class TokenPlanDialogueTtsOutputRejectedError extends Error {
  constructor(readonly reason: string) {
    super(`token_plan_tts_output_rejected:${reason}`);
    this.name = "TokenPlanDialogueTtsOutputRejectedError";
  }
}

/** 套餐兼容端点实测只收这五个字段，禁止把后制参数混入上游请求。 */
export function buildTokenPlanDialogueTtsRequest(
  params: TokenPlanDialogueTtsInput
): TokenPlanDialogueTtsRequest {
  const input = String(params.input || "").trim();
  if (!input)
    throw new TokenPlanDialogueTtsConfigurationError(
      "token_plan_tts_input_empty"
    );
  const voice = String(params.voice || "").trim();
  if (!voice)
    throw new TokenPlanDialogueTtsConfigurationError(
      "token_plan_tts_voice_empty"
    );
  return {
    model: TOKEN_PLAN_DIALOGUE_TTS_MODEL,
    input: input.slice(0, 4000),
    voice,
    response_format: "mp3",
    seed: Number.isFinite(params.seed) ? Math.floor(Number(params.seed)) : 0,
  };
}

/**
 * WAN_PLAN_BASE 只作为生产配置核对项，不允许把请求导向别的百炼产品。
 * 可接受固定 origin 或已带 `/compatible-mode/v1` 的同一 base；其余全部拒绝。
 */
export function assertBeijingTokenPlanBase(rawBase: string): string {
  const raw =
    String(rawBase || "").trim() || TOKEN_PLAN_DIALOGUE_TTS_BEIJING_ORIGIN;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TokenPlanDialogueTtsConfigurationError(
      "WAN_PLAN_BASE 不是合法 URL"
    );
  }
  const pathName = parsed.pathname.replace(/\/+$/, "") || "/";
  const allowedPath = pathName === "/" || pathName === "/compatible-mode/v1";
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "token-plan.cn-beijing.maas.aliyuncs.com" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !allowedPath
  ) {
    throw new TokenPlanDialogueTtsConfigurationError(
      "WAN_PLAN_BASE 必须严格指向北京 Token Plan compatible-mode 端点"
    );
  }
  return TOKEN_PLAN_DIALOGUE_TTS_BEIJING_ORIGIN;
}

export function resolveTokenPlanDialogueTtsRoutes(
  env: NodeJS.ProcessEnv = process.env
): TokenPlanRoute[] {
  const routes: TokenPlanRoute[] = [];
  const singaporeKey = String(env.DASHSCOPE_SG_PLAN_KEY || "").trim();
  if (singaporeKey) {
    routes.push({
      region: "singapore",
      endpoint: TOKEN_PLAN_DIALOGUE_TTS_SG_ENDPOINT,
      apiKey: singaporeKey,
    });
  }

  const beijingKey = String(env.WAN_PLAN_API_KEY || "").trim();
  if (beijingKey) {
    const origin = assertBeijingTokenPlanBase(String(env.WAN_PLAN_BASE || ""));
    routes.push({
      region: "beijing",
      endpoint: `${origin}${TOKEN_PLAN_DIALOGUE_TTS_PATH}`,
      apiKey: beijingKey,
    });
  }
  if (!routes.length) {
    throw new TokenPlanDialogueTtsConfigurationError(
      "Token Plan TTS 未配置：需要 DASHSCOPE_SG_PLAN_KEY 或 WAN_PLAN_API_KEY"
    );
  }
  return routes;
}

export function isExplicitTokenPlanDialogueTtsRejection(
  status: number
): boolean {
  return Number.isInteger(status) && status >= 400 && status < 500;
}

/** 流式收包；即使 Content-Length 缺失或造假也不能突破上限。 */
export async function readTokenPlanDialogueAudioBounded(
  response: Response,
  maxBytes = TOKEN_PLAN_DIALOGUE_TTS_MAX_BYTES
): Promise<Buffer> {
  const requestedLimit = Number(maxBytes);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(
        TOKEN_PLAN_DIALOGUE_TTS_MAX_BYTES,
        Math.max(TOKEN_PLAN_DIALOGUE_TTS_MIN_BYTES, Math.floor(requestedLimit))
      )
    : TOKEN_PLAN_DIALOGUE_TTS_MAX_BYTES;
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new TokenPlanDialogueTtsOutputRejectedError("audio_too_large");
  }
  if (!response.body) {
    throw new TokenPlanDialogueTtsOutputRejectedError("audio_body_missing");
  }

  const chunks: Buffer[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw new TokenPlanDialogueTtsOutputRejectedError("audio_too_large");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (total < TOKEN_PLAN_DIALOGUE_TTS_MIN_BYTES) {
    throw new TokenPlanDialogueTtsOutputRejectedError(
      "audio_empty_or_too_small"
    );
  }
  return Buffer.concat(chunks, total);
}

export function buildTokenPlanDialogueSilenceDetectArgs(
  audioPath: string
): string[] {
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "info",
    "-i",
    audioPath,
    "-vn",
    "-af",
    "silencedetect=noise=-40dB:d=0.12",
    "-f",
    "null",
    "-",
  ];
}

async function defaultExecuteFile(
  command: "ffprobe" | "ffmpeg",
  args: string[],
  options: { timeout: number; maxBuffer: number; signal?: AbortSignal }
): Promise<ExecFileResult> {
  return execFileAsync(command, args, options) as Promise<ExecFileResult>;
}

/** ffprobe 证明容器可读，ffmpeg silencedetect 证明存在足量非静音对白。 */
export async function inspectTokenPlanDialogueAudio(
  audio: Buffer,
  options: {
    signal?: AbortSignal;
    executeFile?: TokenPlanDialogueTtsExecFile;
  } = {}
): Promise<ManhuaDialogueVoiceGateResult> {
  const executeFile = options.executeFile || defaultExecuteFile;
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "manhua-dialogue-tts-gate-")
  );
  const audioPath = path.join(tmpDir, "candidate.mp3");
  try {
    await fs.writeFile(audioPath, audio, { signal: options.signal });
    let probe: ExecFileResult;
    try {
      probe = await executeFile(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          audioPath,
        ],
        { timeout: 15_000, maxBuffer: 256 * 1024, signal: options.signal }
      );
    } catch {
      options.signal?.throwIfAborted();
      throw new TokenPlanDialogueTtsOutputRejectedError("ffprobe_failed");
    }
    const durationSeconds = Number(String(probe.stdout || "").trim());
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new TokenPlanDialogueTtsOutputRejectedError(
        "invalid_audio_duration"
      );
    }

    let detect: ExecFileResult;
    try {
      detect = await executeFile(
        "ffmpeg",
        buildTokenPlanDialogueSilenceDetectArgs(audioPath),
        { timeout: 30_000, maxBuffer: 1024 * 1024, signal: options.signal }
      );
    } catch {
      options.signal?.throwIfAborted();
      // 不能拿失败进程留下的半截 stderr 冒充完整检测证据。
      throw new TokenPlanDialogueTtsOutputRejectedError("silencedetect_failed");
    }
    const silenceDetectLog = String(detect.stderr || "");
    if (!silenceDetectLog.trim()) {
      throw new TokenPlanDialogueTtsOutputRejectedError(
        "silencedetect_evidence_missing"
      );
    }
    return evaluateManhuaDialogueSilenceDetectLog({
      silenceDetectLog,
      durationSeconds,
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function requestTokenPlanDialogueAudio(params: {
  route: TokenPlanRoute;
  body: TokenPlanDialogueTtsRequest;
  fetchImpl: typeof fetch;
  maxAudioBytes: number;
  signal?: AbortSignal;
}): Promise<{ audio: Buffer; generationId: string }> {
  let response: Response;
  try {
    response = await params.fetchImpl(params.route.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.route.apiKey}`,
        "Content-Type": "application/json",
        Accept: "audio/mpeg, application/octet-stream",
      },
      body: JSON.stringify(params.body),
      signal: params.signal,
    });
  } catch {
    throw new TokenPlanDialogueTtsUnknownResultError(params.route.region);
  }

  if (!response.ok) {
    // 响应正文可能回显内部信息；路由判断只看已收到的 HTTP 状态，不读、不打印正文。
    await response.body?.cancel().catch(() => undefined);
    if (isExplicitTokenPlanDialogueTtsRejection(response.status)) {
      throw new TokenPlanDialogueTtsExplicitRejectionError(
        params.route.region,
        response.status
      );
    }
    throw new TokenPlanDialogueTtsUnknownResultError(
      params.route.region,
      response.status
    );
  }

  const contentType = String(response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (
    contentType &&
    contentType !== "application/octet-stream" &&
    !contentType.startsWith("audio/")
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new TokenPlanDialogueTtsOutputRejectedError(
      "unexpected_content_type"
    );
  }
  let audio: Buffer;
  try {
    audio = await readTokenPlanDialogueAudioBounded(
      response,
      params.maxAudioBytes
    );
  } catch (error) {
    if (error instanceof TokenPlanDialogueTtsOutputRejectedError) throw error;
    // 2xx 后下载中断，无法知道上游是否已经完成并计费，禁止换区。
    throw new TokenPlanDialogueTtsUnknownResultError(params.route.region);
  }
  return {
    audio,
    generationId: String(
      response.headers.get("x-generation-id") ||
        response.headers.get("x-request-id") ||
        response.headers.get("x-dashscope-request-id") ||
        ""
    ).trim(),
  };
}

export function buildTokenPlanDialogueObjectName(
  ownerUserId: number,
  voice: string,
  now: Date,
  id: string
): string {
  const userId = Math.floor(Number(ownerUserId));
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new TokenPlanDialogueTtsConfigurationError(
      "token_plan_tts_owner_invalid"
    );
  }
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const safeVoice =
    voice.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 96) || "voice";
  const safeId = id.replace(/[^a-zA-Z0-9_-]+/g, "").slice(0, 36) || "audio";
  return `manhua-dialogue-tts/token-plan/u${userId}/${stamp}/${safeVoice}-${safeId}.mp3`;
}

/**
 * 画布草稿持久化 `gs://` 真源，视频提交时才现签；只允许读取当前用户自己的
 * TTS 前缀。普通上传音频仍沿用原 HTTPS，不改变既有素材入口。
 */
export function resolveTokenPlanDialogueAudioReference(input: {
  reference: string;
  ownerUserId: number;
  bucketName?: string;
  sign?: typeof signGsUriV4ReadUrl;
}): string {
  const reference = String(input.reference || "").trim();
  if (/^https:\/\//i.test(reference)) return reference;
  const userId = Math.floor(Number(input.ownerUserId));
  const bucketName = String(input.bucketName || getGcsBucketName()).trim();
  if (!Number.isFinite(userId) || userId <= 0 || !bucketName) {
    throw new TokenPlanDialogueTtsConfigurationError(
      "token_plan_tts_reference_owner_invalid"
    );
  }
  const expectedPrefix = `gs://${bucketName}/manhua-dialogue-tts/token-plan/u${userId}/`;
  if (!reference.startsWith(expectedPrefix) || reference.includes("..")) {
    throw new TokenPlanDialogueTtsConfigurationError(
      "token_plan_tts_reference_forbidden"
    );
  }
  return (input.sign || signGsUriV4ReadUrl)(reference, 24 * 3600);
}

/**
 * 合成、验声、落盘的完整核心。门禁在 upload 前执行，拒收音频不会进入正式 GCS。
 */
export async function synthesizeTokenPlanDialogue(
  input: TokenPlanDialogueTtsInput,
  dependencies: TokenPlanDialogueTtsDependencies = {}
): Promise<TokenPlanDialogueTtsResult> {
  const body = buildTokenPlanDialogueTtsRequest(input);
  const routes = resolveTokenPlanDialogueTtsRoutes(
    dependencies.env || process.env
  );
  const fetchImpl = dependencies.fetchImpl || fetch;
  const requestedMaxAudioBytes = Number(dependencies.maxAudioBytes);
  const maxAudioBytes = Number.isFinite(requestedMaxAudioBytes)
    ? Math.min(
        TOKEN_PLAN_DIALOGUE_TTS_MAX_BYTES,
        Math.max(
          TOKEN_PLAN_DIALOGUE_TTS_MIN_BYTES,
          Math.floor(requestedMaxAudioBytes)
        )
      )
    : TOKEN_PLAN_DIALOGUE_TTS_MAX_BYTES;
  const timeoutSignal = AbortSignal.timeout(TOKEN_PLAN_DIALOGUE_TTS_TIMEOUT_MS);
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeoutSignal])
    : timeoutSignal;

  let selected:
    | { route: TokenPlanRoute; audio: Buffer; generationId: string }
    | undefined;
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    try {
      selected = {
        route,
        ...(await requestTokenPlanDialogueAudio({
          route,
          body,
          fetchImpl,
          maxAudioBytes,
          signal,
        })),
      };
      break;
    } catch (error) {
      const canFallback =
        error instanceof TokenPlanDialogueTtsExplicitRejectionError &&
        index + 1 < routes.length;
      if (!canFallback) throw error;
    }
  }
  if (!selected) {
    throw new TokenPlanDialogueTtsConfigurationError(
      "token_plan_tts_no_route_selected"
    );
  }

  const inspectAudio =
    dependencies.inspectAudio ||
    ((audio, options) => inspectTokenPlanDialogueAudio(audio, options));
  const voiceGate = await inspectAudio(selected.audio, { signal });
  if (!voiceGate.accepted) {
    throw new TokenPlanDialogueTtsOutputRejectedError(voiceGate.reason);
  }

  const uploadAudio = dependencies.uploadAudio || uploadBufferToGcs;
  const signAudioUrl = dependencies.signAudioUrl || signGsUriV4ReadUrl;
  const objectName = buildTokenPlanDialogueObjectName(
    input.ownerUserId,
    body.voice,
    (dependencies.now || (() => new Date()))(),
    (dependencies.createId || randomUUID)()
  );
  // 严格在有效人声门禁通过后才允许产生正式对象。
  const { gcsUri } = await uploadAudio({
    objectName,
    buffer: selected.audio,
    contentType: "audio/mpeg",
    signal,
  });
  const audioUrl = signAudioUrl(gcsUri, 7 * 24 * 3600);
  return {
    audioUrl,
    gcsUri,
    bytes: selected.audio.length,
    voice: body.voice,
    generationId: selected.generationId,
    region: selected.route.region,
    voiceGate,
  };
}
