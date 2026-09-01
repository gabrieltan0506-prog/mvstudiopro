/**
 * Token Plan 对白 TTS · WebSocket 正门。
 *
 * 0902 实弹定案：两区套餐网关都认 qwen-audio-3.0-tts-plus，但 HTTP
 * compatible-mode 北京报「url error」、新加坡 404——正门是
 * api-ws/v1/inference（run-task → continue-task → finish-task，音频走二进制帧）。
 * 新加坡优先、北京兜底；只有 task-failed（上游明确拒绝）或 task-started 之前的
 * 连接失败才换区；task-started 之后的一切异常都算结果未知，禁止换区，
 * 避免同一句对白重复合成、重复扣套餐额度。
 */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { ManhuaDialogueVoiceGateResult } from "../../shared/manhuaDialogueVoiceGate.js";
import { signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs.js";
import {
  buildTokenPlanDialogueObjectName,
  inspectTokenPlanDialogueAudio,
  TOKEN_PLAN_DIALOGUE_TTS_MAX_BYTES,
  TOKEN_PLAN_DIALOGUE_TTS_MIN_BYTES,
  TokenPlanDialogueTtsConfigurationError,
  TokenPlanDialogueTtsExplicitRejectionError,
  TokenPlanDialogueTtsOutputRejectedError,
  TokenPlanDialogueTtsUnknownResultError,
  type TokenPlanDialogueTtsRegion,
  type TokenPlanDialogueTtsResult,
} from "./tokenPlanDialogueTts.js";

export const TOKEN_PLAN_DIALOGUE_TTS_WS_MODEL =
  "qwen-audio-3.0-tts-plus" as const;
export const TOKEN_PLAN_DIALOGUE_TTS_WS_SG_ENDPOINT =
  "wss://token-plan.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/inference" as const;
export const TOKEN_PLAN_DIALOGUE_TTS_WS_BEIJING_ENDPOINT =
  "wss://token-plan.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference" as const;
/** run-task 送出后迟迟等不到 task-started：尚未开始合成，可安全换区。 */
export const TOKEN_PLAN_DIALOGUE_TTS_WS_START_TIMEOUT_MS = 20_000;
/** task-started 之后的总时限；超时=结果未知，不换区。 */
export const TOKEN_PLAN_DIALOGUE_TTS_WS_TOTAL_TIMEOUT_MS = 120_000;

export type TokenPlanDialogueTtsWsInput = {
  input: string;
  /** 裸音色 id（longanlingxin 等）；带 qwen-audio-3.0-tts-plus- 前缀的自动剥掉 */
  voice: string;
  ownerUserId: number;
  signal?: AbortSignal;
};

export type TokenPlanTtsSocket = {
  send(data: string): void;
  close(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
};

export type TokenPlanTtsSocketFactory = (
  url: string,
  headers: Record<string, string>
) => Promise<TokenPlanTtsSocket> | TokenPlanTtsSocket;

export type TokenPlanDialogueTtsWsDependencies = {
  env?: NodeJS.ProcessEnv;
  socketFactory?: TokenPlanTtsSocketFactory;
  maxAudioBytes?: number;
  inspectAudio?: (
    audio: Buffer,
    options: { signal?: AbortSignal }
  ) => Promise<ManhuaDialogueVoiceGateResult>;
  uploadAudio?: typeof uploadBufferToGcs;
  signAudioUrl?: typeof signGsUriV4ReadUrl;
  now?: () => Date;
  createId?: () => string;
  startTimeoutMs?: number;
  totalTimeoutMs?: number;
};

type WsRoute = {
  region: TokenPlanDialogueTtsRegion;
  endpoint: string;
  apiKey: string;
};

export function resolveTokenPlanDialogueTtsWsRoutes(
  env: NodeJS.ProcessEnv = process.env
): WsRoute[] {
  const routes: WsRoute[] = [];
  const singaporeKey = String(env.DASHSCOPE_SG_PLAN_KEY || "").trim();
  if (singaporeKey) {
    routes.push({
      region: "singapore",
      endpoint: TOKEN_PLAN_DIALOGUE_TTS_WS_SG_ENDPOINT,
      apiKey: singaporeKey,
    });
  }
  const beijingKey = String(env.WAN_PLAN_API_KEY || "").trim();
  if (beijingKey) {
    routes.push({
      region: "beijing",
      endpoint: TOKEN_PLAN_DIALOGUE_TTS_WS_BEIJING_ENDPOINT,
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

/** 面板/OpenRouter 侧的长音色 id 在套餐 WS 里用裸 id。 */
export function normalizeTokenPlanWsVoice(voice: string): string {
  const trimmed = String(voice || "").trim();
  if (!trimmed) {
    throw new TokenPlanDialogueTtsConfigurationError("token_plan_tts_voice_empty");
  }
  const prefix = `${TOKEN_PLAN_DIALOGUE_TTS_WS_MODEL}-`;
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

async function defaultSocketFactory(
  url: string,
  headers: Record<string, string>
): Promise<TokenPlanTtsSocket> {
  // ws 已声明进 dependencies；用 createRequire 加载，避免给全仓引入 @types/ws。
  const requireWs = createRequire(import.meta.url);
  const WebSocketImpl = requireWs("ws") as new (
    url: string,
    options: { headers: Record<string, string> }
  ) => TokenPlanTtsSocket;
  return new WebSocketImpl(url, { headers });
}

/**
 * 单区一发：建连→run-task→(task-started)→continue-task+finish-task→收二进制帧。
 * 抛错分三类：ExplicitRejection（task-failed，可换区）、UnknownResult（started
 * 之后异常，禁止换区）、OutputRejected（音频本身不合格，不换区）。
 */
export async function requestTokenPlanDialogueAudioWs(params: {
  route: WsRoute;
  text: string;
  voice: string;
  socketFactory: TokenPlanTtsSocketFactory;
  maxAudioBytes: number;
  startTimeoutMs: number;
  totalTimeoutMs: number;
  signal?: AbortSignal;
}): Promise<Buffer> {
  const taskId = randomUUID().replace(/-/g, "");
  let socket: TokenPlanTtsSocket;
  try {
    socket = await params.socketFactory(params.route.endpoint, {
      Authorization: `bearer ${params.route.apiKey}`,
    });
  } catch {
    // 连接根本没建起来，一定没开始合成，按明确失败换区。
    throw new TokenPlanDialogueTtsExplicitRejectionError(params.route.region, 0);
  }

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let started = false;
    let settled = false;
    let startTimer: NodeJS.Timeout | undefined;
    let totalTimer: NodeJS.Timeout | undefined;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (startTimer) clearTimeout(startTimer);
      if (totalTimer) clearTimeout(totalTimer);
      try {
        socket.close();
      } catch {
        /* 关闭失败不影响结果判定 */
      }
      fn();
    };
    const failBeforeStart = () =>
      settle(() =>
        reject(
          new TokenPlanDialogueTtsExplicitRejectionError(params.route.region, 0)
        )
      );
    const failUnknown = () =>
      settle(() =>
        reject(new TokenPlanDialogueTtsUnknownResultError(params.route.region))
      );

    startTimer = setTimeout(() => {
      if (!started) failBeforeStart();
    }, params.startTimeoutMs);
    totalTimer = setTimeout(() => {
      if (started) failUnknown();
      else failBeforeStart();
    }, params.totalTimeoutMs);
    params.signal?.addEventListener(
      "abort",
      () => (started ? failUnknown() : failBeforeStart()),
      { once: true }
    );

    socket.on("open", () => {
      try {
        socket.send(
          JSON.stringify({
            header: { action: "run-task", task_id: taskId, streaming: "duplex" },
            payload: {
              task_group: "audio",
              task: "tts",
              function: "SpeechSynthesizer",
              model: TOKEN_PLAN_DIALOGUE_TTS_WS_MODEL,
              parameters: {
                text_type: "PlainText",
                voice: params.voice,
                format: "mp3",
                sample_rate: 22050,
                volume: 50,
                rate: 1,
                pitch: 1,
              },
              input: {},
            },
          })
        );
      } catch {
        failBeforeStart();
      }
    });

    socket.on("message", (data: unknown, isBinary?: unknown) => {
      if (settled) return;
      if (isBinary) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        total += buf.length;
        if (total > params.maxAudioBytes) {
          // 音频超限=产物不合格；合成可能已计费，绝不换区重来。
          settle(() =>
            reject(new TokenPlanDialogueTtsOutputRejectedError("audio_too_large"))
          );
          return;
        }
        chunks.push(buf);
        return;
      }
      let event: { header?: { event?: string; error_message?: string } } = {};
      try {
        event = JSON.parse(String(data));
      } catch {
        return;
      }
      const kind = event?.header?.event;
      if (kind === "task-started") {
        started = true;
        if (startTimer) clearTimeout(startTimer);
        try {
          socket.send(
            JSON.stringify({
              header: {
                action: "continue-task",
                task_id: taskId,
                streaming: "duplex",
              },
              payload: { input: { text: params.text } },
            })
          );
          socket.send(
            JSON.stringify({
              header: {
                action: "finish-task",
                task_id: taskId,
                streaming: "duplex",
              },
              payload: { input: {} },
            })
          );
        } catch {
          failUnknown();
        }
      } else if (kind === "task-failed") {
        // 上游明确拒绝（错误详情不回显进用户可见错误，只在服务端日志）。
        console.error(
          `[token-plan-tts-ws] task-failed region=${params.route.region}:`,
          String(event?.header?.error_message || "").slice(0, 300)
        );
        settle(() =>
          reject(
            new TokenPlanDialogueTtsExplicitRejectionError(
              params.route.region,
              400
            )
          )
        );
      } else if (kind === "task-finished") {
        if (total < TOKEN_PLAN_DIALOGUE_TTS_MIN_BYTES) {
          settle(() =>
            reject(
              new TokenPlanDialogueTtsOutputRejectedError(
                "audio_empty_or_too_small"
              )
            )
          );
          return;
        }
        settle(() => resolve(Buffer.concat(chunks, total)));
      }
    });

    socket.on("error", () => (started ? failUnknown() : failBeforeStart()));
    socket.on("unexpected-response", () => failBeforeStart());
    socket.on("close", () => {
      // 正常完成时 settled 已置位；此处只兜未完成即断连的情形。
      if (!settled) (started ? failUnknown : failBeforeStart)();
    });
  });
}

/**
 * 套餐 WS 完整核心：合成→验声门禁→落 GCS。门禁与对象前缀与 HTTP 版完全一致，
 * resolveTokenPlanDialogueAudioReference 的 gs:// 授权规则原样适用。
 */
export async function synthesizeTokenPlanDialogueWs(
  input: TokenPlanDialogueTtsWsInput,
  dependencies: TokenPlanDialogueTtsWsDependencies = {}
): Promise<TokenPlanDialogueTtsResult> {
  const text = String(input.input || "").trim().slice(0, 4000);
  if (!text) {
    throw new TokenPlanDialogueTtsConfigurationError("token_plan_tts_input_empty");
  }
  const voice = normalizeTokenPlanWsVoice(input.voice);
  const routes = resolveTokenPlanDialogueTtsWsRoutes(
    dependencies.env || process.env
  );
  const socketFactory = dependencies.socketFactory || defaultSocketFactory;
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

  let selected: { route: WsRoute; audio: Buffer } | undefined;
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    try {
      const audio = await requestTokenPlanDialogueAudioWs({
        route,
        text,
        voice,
        socketFactory,
        maxAudioBytes,
        startTimeoutMs:
          dependencies.startTimeoutMs ??
          TOKEN_PLAN_DIALOGUE_TTS_WS_START_TIMEOUT_MS,
        totalTimeoutMs:
          dependencies.totalTimeoutMs ??
          TOKEN_PLAN_DIALOGUE_TTS_WS_TOTAL_TIMEOUT_MS,
        signal: input.signal,
      });
      selected = { route, audio };
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
  const voiceGate = await inspectAudio(selected.audio, { signal: input.signal });
  if (!voiceGate.accepted) {
    throw new TokenPlanDialogueTtsOutputRejectedError(voiceGate.reason);
  }

  const uploadAudio = dependencies.uploadAudio || uploadBufferToGcs;
  const signAudioUrl = dependencies.signAudioUrl || signGsUriV4ReadUrl;
  const objectName = buildTokenPlanDialogueObjectName(
    input.ownerUserId,
    voice,
    (dependencies.now || (() => new Date()))(),
    (dependencies.createId || randomUUID)()
  );
  const { gcsUri } = await uploadAudio({
    objectName,
    buffer: selected.audio,
    contentType: "audio/mpeg",
    signal: input.signal,
  });
  const audioUrl = signAudioUrl(gcsUri, 7 * 24 * 3600);
  return {
    audioUrl,
    gcsUri,
    bytes: selected.audio.length,
    voice,
    generationId: "",
    region: selected.route.region,
    voiceGate,
  };
}
