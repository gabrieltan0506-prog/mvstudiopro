/**
 * 视频局部修改 · 通道层（VE）：先 BytePlus Seedance 2.5（片段作 reference_video + 提示词），
 * 遇真人/隐私拒绝（InputImageSensitiveContentDetected.PrivacyInformation 等）或通道明确不支持（4xx 无任务号）
 * 立即改走 EvoLink Seedance 2.5 video-edit（输入 4–30s，duration=-1 与原段等长，可带参考图，提交后不可取消）。
 *
 * 复用 byteplusSeedanceVideo / evolinkSeedanceVideo 的组包、提交与单次轮询，不另起调用代码。
 * 证据（product-guardrails §视频/模型 JSON 永久证据）：每个通道的请求体、原始回执、拒绝回执都写到 evidencePrefix 下，
 * 原始与解析分存、只增不删（uploadBufferToGcsIfAbsent）；拒绝且无任务号记「零扣费」。
 * 网络/5xx/未知结果不转交：可能已建单，转交会双扣费。
 * 前台文案不出现通道/模型名：抛出的 error.message 只给业务句，细节在 error.attempts 与日志。
 *
 * 实测（11-10 P1 4s 小段）：BytePlus 因参考图（场景图含人）判真人拒绝、零扣费；EvoLink 同段约 $1.584。
 */
import { createHash } from "node:crypto";
import {
  buildByteplusSeedance25SubmitBody,
  isByteplusFallbackableError,
  isByteplusSeedanceConfigured,
  pollByteplusVideoTaskOnce,
  submitByteplusSeedance25Video,
  BYTEPLUS_SEEDANCE_MAX_POLL_MS,
  BYTEPLUS_SEEDANCE_POLL_INTERVAL_MS,
} from "./byteplusSeedanceVideo.js";
import {
  buildEvolinkSeedanceRequest,
  isEvolinkSeedanceConfigured,
  pollEvolinkVideoTaskOnce,
  submitEvolinkSeedanceVideo,
  EVOLINK_SEEDANCE_MAX_POLL_MS,
  EVOLINK_SEEDANCE_POLL_INTERVAL_MS,
} from "./evolinkSeedanceVideo.js";
import { mirrorSeedanceMp4ToGcsSignedUrl } from "./seedanceVideo.js";
import { getGcsBucketName, uploadBufferToGcsIfAbsent } from "./gcs.js";
import { isTaskHeartbeatStatus } from "./taskHeartbeat.js";

export type VideoEditChannel = "byteplus" | "evolink";

export type RunVideoEditInput = {
  /** 片段视频：已登记来源的 https 签名 URL（上游可读）。 */
  segmentUrl: string;
  promptZh: string;
  referenceImageUrls?: string[];
  /** 片段时长（秒），4–30。 */
  segmentSec: number;
  aspectRatio?: string;
  /** 证据前缀（GCS 对象名，不含 gs://bucket/）；本次所有请求/回执/拒绝写在其下，只增不删。 */
  evidencePrefix: string;
};

export type VideoEditReceipt = { status: number; body: string };

export type VideoEditAttempt = {
  channel: VideoEditChannel;
  /** 提交回执原文（未解析）；连请求都没发出去时为 null。 */
  rawReceipt: VideoEditReceipt | null;
  /** 提交回执解析件（解析失败为 { invalidJson: true }）。 */
  parsed: unknown;
  providerTaskId?: string;
  /** 终态回执（轮询拿到 succeeded/failed 时）。 */
  terminalRawReceipt?: VideoEditReceipt;
  terminalParsed?: unknown;
  /** 上游错误码（如 InputImageSensitiveContentDetected.PrivacyInformation）。 */
  rejectionCode?: string;
  /** 上游是否可能已扣费：拒绝且无任务号＝false（零扣费）；建了单＝true（保守）。 */
  upstreamCharged: boolean;
  error?: string;
};

export type VideoEditEvidenceObject = { objectName: string; bytes: number; sha256: string };

export type RunVideoEditResult = {
  videoUrl: string;
  /** 成片镜像的 gs:// 地址（能解析时）。 */
  videoGsUri?: string;
  channel: VideoEditChannel;
  providerTaskId: string;
  attempts: VideoEditAttempt[];
  /** 已写入的证据对象（按写入顺序）。 */
  evidence: VideoEditEvidenceObject[];
};

export class VideoEditFailedError extends Error {
  constructor(
    message: string,
    readonly attempts: VideoEditAttempt[],
    readonly evidence: VideoEditEvidenceObject[],
    readonly detail?: string,
  ) {
    super(message);
    this.name = "VideoEditFailedError";
  }
}

type Persist = (r: VideoEditReceipt) => Promise<void>;

export type VideoEditDeps = {
  byteplusConfigured: () => boolean;
  evolinkConfigured: () => boolean;
  buildByteplusBody: typeof buildByteplusSeedance25SubmitBody;
  buildEvolinkBody: typeof buildEvolinkSeedanceRequest;
  submitByteplus: (input: Parameters<typeof submitByteplusSeedance25Video>[0]) => Promise<{ byteplusTaskId: string; immediateSourceUrl?: string }>;
  pollByteplus: (taskId: string, persist: Persist) => ReturnType<typeof pollByteplusVideoTaskOnce>;
  submitEvolink: (input: Parameters<typeof submitEvolinkSeedanceVideo>[0]) => Promise<{ evolinkTaskId: string; immediateSourceUrl?: string }>;
  pollEvolink: (taskId: string, persist: Persist) => ReturnType<typeof pollEvolinkVideoTaskOnce>;
  mirror: (sourceUrl: string) => Promise<string>;
  bucket: () => string;
  upload: (input: { bucket: string; objectName: string; buffer: Buffer; contentType: string }) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  pollIntervalMs: { byteplus: number; evolink: number };
  maxPollMs: { byteplus: number; evolink: number };
};

const realDeps: VideoEditDeps = {
  byteplusConfigured: isByteplusSeedanceConfigured,
  evolinkConfigured: isEvolinkSeedanceConfigured,
  buildByteplusBody: buildByteplusSeedance25SubmitBody,
  buildEvolinkBody: buildEvolinkSeedanceRequest,
  submitByteplus: submitByteplusSeedance25Video,
  pollByteplus: (taskId, persist) => pollByteplusVideoTaskOnce(taskId, "局部修改", persist),
  submitEvolink: submitEvolinkSeedanceVideo,
  pollEvolink: (taskId, persist) => pollEvolinkVideoTaskOnce(taskId, "局部修改", persist),
  mirror: url => mirrorSeedanceMp4ToGcsSignedUrl(url),
  bucket: getGcsBucketName,
  upload: ({ bucket, objectName, buffer, contentType }) => uploadBufferToGcsIfAbsent({ bucket, objectName, buffer, contentType }),
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  now: () => Date.now(),
  pollIntervalMs: { byteplus: BYTEPLUS_SEEDANCE_POLL_INTERVAL_MS, evolink: EVOLINK_SEEDANCE_POLL_INTERVAL_MS },
  maxPollMs: { byteplus: BYTEPLUS_SEEDANCE_MAX_POLL_MS, evolink: EVOLINK_SEEDANCE_MAX_POLL_MS },
};

/** 前台口径：不带通道/模型名。 */
export const VIDEO_EDIT_FAILED_ZH = "局部修改生成失败，请稍后重试";
export const VIDEO_EDIT_UNAVAILABLE_ZH = "局部修改服务暂不可用，请稍后重试";

const PRIVACY_CODE_RE = /InputImageSensitiveContentDetected\.PrivacyInformation|InputVideoSensitiveContentDetected[.\w]*|[A-Za-z]+SensitiveContentDetected[.\w]*/;

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return { invalidJson: true };
  }
}

function errorCodeOf(body: string | undefined, message: string): string | undefined {
  const json = body ? (parseJson(body) as { error?: { code?: unknown } }) : undefined;
  const code = typeof json?.error?.code === "string" ? json.error.code : "";
  if (code) return code;
  return PRIVACY_CODE_RE.exec(message)?.[0];
}

/** https://storage.googleapis.com/<bucket>/<object>?X-Goog-... → gs://<bucket>/<object>。 */
export function signedGcsUrlToGsUri(url: string): string | undefined {
  const m = /^https:\/\/storage\.googleapis\.com\/([^/?#]+)\/([^?#]+)/i.exec(String(url || ""));
  return m ? `gs://${m[1]}/${decodeURIComponent(m[2]!)}` : undefined;
}

/**
 * 视频局部修改：BytePlus 优先，真人/隐私或不支持即转 EvoLink video-edit。
 * 成功返回成片签名 URL 与每个通道的尝试记录；失败抛 VideoEditFailedError（error.attempts 同形）。
 */
export async function runVideoEditWithFallback(
  input: RunVideoEditInput,
  deps: VideoEditDeps = realDeps,
): Promise<RunVideoEditResult> {
  const attempts: VideoEditAttempt[] = [];
  const evidence: VideoEditEvidenceObject[] = [];
  const fail = (detail: string, message = VIDEO_EDIT_FAILED_ZH): never => {
    throw new VideoEditFailedError(message, attempts, evidence, detail);
  };

  const segmentUrl = String(input.segmentUrl || "").trim();
  const promptZh = String(input.promptZh || "").trim();
  const prefix = String(input.evidencePrefix || "").trim().replace(/^\/+|\/+$/g, "");
  const segmentSec = Number(input.segmentSec);
  if (!/^https:\/\//i.test(segmentUrl)) fail("segmentUrl must be https", "片段地址不可用，未提交");
  if (!promptZh) fail("empty prompt", "请先写清要修改的内容，未提交");
  if (!prefix || prefix.includes("..")) fail("evidencePrefix required", "证据目录缺失，未提交");
  if (!Number.isFinite(segmentSec) || segmentSec < 4 || segmentSec > 30) fail(`segmentSec=${input.segmentSec}`, "局部修改片段需在 4–30 秒之间，未提交、未扣费");
  const referenceImageUrls = Array.from(new Set((input.referenceImageUrls || []).map(u => String(u || "").trim()).filter(u => /^https:\/\//i.test(u))));

  // 证据：<prefix>/<runId>-<序号>-<通道>-<阶段>-{raw|parsed}.json；同名不覆盖
  const runId = deps.now().toString(36);
  let seq = 0;
  const bucket = deps.bucket();
  const write = async (name: string, value: unknown) => {
    const buffer = Buffer.from(JSON.stringify(value));
    const objectName = `${prefix}/${name}`;
    await deps.upload({ bucket, objectName, buffer, contentType: "application/json" });
    evidence.push({ objectName, bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex") });
  };
  const recordPair = async (channel: VideoEditChannel, phase: string, raw: unknown, parsed: unknown) => {
    const n = String(++seq).padStart(2, "0");
    await write(`${runId}-${n}-${channel}-${phase}-raw.json`, { channel, phase, recordedAt: new Date(deps.now()).toISOString(), raw });
    await write(`${runId}-${n}-${channel}-${phase}-parsed.json`, { channel, phase, parsed });
  };
  const recordReceipt = (channel: VideoEditChannel, phase: string, r: VideoEditReceipt) =>
    recordPair(channel, phase, r, { status: r.status, response: parseJson(r.body) });

  const pollUntilDone = async (
    channel: VideoEditChannel,
    taskId: string,
    attempt: VideoEditAttempt,
  ): Promise<{ ok: true; sourceUrl: string } | { ok: false; error: string }> => {
    const persist: Persist = async r => {
      attempt.terminalRawReceipt = r;
      attempt.terminalParsed = parseJson(r.body);
      await recordReceipt(channel, "terminal", r);
    };
    let lastHeartbeat = deps.now();
    while (deps.now() - lastHeartbeat < deps.maxPollMs[channel]) {
      const snap = channel === "byteplus" ? await deps.pollByteplus(taskId, persist) : await deps.pollEvolink(taskId, persist);
      if (snap.state === "completed") return { ok: true, sourceUrl: snap.sourceUrl };
      if (snap.state === "failed") return { ok: false, error: snap.error };
      if (isTaskHeartbeatStatus(snap.status)) lastHeartbeat = deps.now();
      await deps.sleep(deps.pollIntervalMs[channel]);
    }
    return { ok: false, error: `timeout:${taskId}` };
  };

  const finish = async (channel: VideoEditChannel, taskId: string, sourceUrl: string): Promise<RunVideoEditResult> => {
    const videoUrl = await deps.mirror(sourceUrl);
    const videoGsUri = signedGcsUrlToGsUri(videoUrl);
    await recordPair(channel, "result", { taskId, sourceUrl, videoUrl }, { taskId, videoGsUri: videoGsUri ?? null });
    return { videoUrl, ...(videoGsUri ? { videoGsUri } : {}), channel, providerTaskId: taskId, attempts, evidence };
  };

  // ── 1. BytePlus：片段作 reference_video + 提示词（时长按片段，不按编辑档的 15s） ──
  let fallbackReason = "byteplus_not_configured";
  if (deps.byteplusConfigured()) {
    const bpInput = {
      prompt: promptZh,
      version: "2.5" as const,
      mode: "reference_to_video" as const,
      videoUrls: [segmentUrl],
      imageUrls: referenceImageUrls,
      duration: Math.round(segmentSec),
      aspectRatio: input.aspectRatio,
      generateAudio: true,
    };
    const attempt: VideoEditAttempt = { channel: "byteplus", rawReceipt: null, parsed: null, upstreamCharged: false };
    attempts.push(attempt);
    let built: ReturnType<typeof deps.buildByteplusBody> | undefined;
    try {
      built = deps.buildByteplusBody(bpInput);
    } catch (e) {
      // 组包即不支持（参数越界等）：没发请求，零扣费，转 EvoLink
      attempt.error = e instanceof Error ? e.message : String(e);
      attempt.rejectionCode = "unsupported_input";
      await recordPair("byteplus", "rejection", { error: attempt.error }, { rejectionCode: attempt.rejectionCode, upstreamCharged: false, zeroCharge: true });
    }
    if (built) {
      await recordPair("byteplus", "request", built.body, { model: built.model, mode: built.mode, duration: built.duration });
      let submitted: { byteplusTaskId: string; immediateSourceUrl?: string } | undefined;
      try {
        submitted = await deps.submitByteplus({
          ...bpInput,
          persistSubmitReceipt: async r => {
            attempt.rawReceipt = r;
            attempt.parsed = parseJson(r.body);
            await recordReceipt("byteplus", "submit", r);
          },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        attempt.error = msg;
        attempt.rejectionCode = errorCodeOf(attempt.rawReceipt?.body, msg);
        const fallbackable = isByteplusFallbackableError(e, true);
        // 明确拒绝（4xx 无任务号）才算零扣费；未知结果保守按可能扣费
        attempt.upstreamCharged = (e as { kind?: string } | null)?.kind !== "rejected" && !fallbackable;
        await recordPair(
          "byteplus",
          "rejection",
          { error: msg, kind: (e as { kind?: string } | null)?.kind ?? null, receipt: attempt.rawReceipt },
          { rejectionCode: attempt.rejectionCode ?? null, upstreamCharged: attempt.upstreamCharged, zeroCharge: !attempt.upstreamCharged, fallback: fallbackable },
        );
        if (!fallbackable) fail(`byteplus submit: ${msg}`);
        fallbackReason = attempt.rejectionCode || "byteplus_rejected";
      }
      if (submitted) {
        attempt.providerTaskId = submitted.byteplusTaskId;
        attempt.upstreamCharged = true;
        const done = submitted.immediateSourceUrl
          ? { ok: true as const, sourceUrl: submitted.immediateSourceUrl }
          : await pollUntilDone("byteplus", submitted.byteplusTaskId, attempt);
        if (done.ok) return finish("byteplus", submitted.byteplusTaskId, done.sourceUrl);
        attempt.error = done.error;
        attempt.rejectionCode = errorCodeOf(attempt.terminalRawReceipt?.body, done.error);
        const privacy = !done.error.startsWith("timeout:") && isByteplusFallbackableError(new Error(done.error));
        await recordPair(
          "byteplus",
          "rejection",
          { error: done.error, taskId: submitted.byteplusTaskId, receipt: attempt.terminalRawReceipt ?? null },
          { rejectionCode: attempt.rejectionCode ?? null, upstreamCharged: true, zeroCharge: false, fallback: privacy },
        );
        // 建单后真人/隐私终态失败才转交；超时/其他失败不转交（可能仍在跑，转交会双扣）
        if (!privacy) fail(`byteplus terminal: ${done.error}`);
        fallbackReason = attempt.rejectionCode || "byteplus_privacy";
      }
    }
  }

  // ── 2. EvoLink video-edit：duration=-1 与原段等长，可带参考图；提交后不可取消 ──
  if (!deps.evolinkConfigured()) fail(`evolink not configured (after ${fallbackReason})`, VIDEO_EDIT_UNAVAILABLE_ZH);
  const evInput = {
    prompt: promptZh,
    version: "2.5" as const,
    mode: "video_edit" as const,
    videoUrls: [segmentUrl],
    imageUrls: referenceImageUrls,
    duration: -1,
    aspectRatio: input.aspectRatio,
    generateAudio: true,
    // 1110 用户定：转 EvoLink 时保持内容过滤（不放宽真人限制、不加 10%）；被拦按失败全额退积分
    contentFilter: true,
  };
  const ev: VideoEditAttempt = { channel: "evolink", rawReceipt: null, parsed: null, upstreamCharged: false };
  attempts.push(ev);
  let evBuilt: ReturnType<typeof deps.buildEvolinkBody>;
  try {
    evBuilt = deps.buildEvolinkBody(evInput);
  } catch (e) {
    ev.error = e instanceof Error ? e.message : String(e);
    await recordPair("evolink", "rejection", { error: ev.error }, { rejectionCode: "invalid_input", upstreamCharged: false, zeroCharge: true });
    return fail(`evolink build: ${ev.error}`);
  }
  await recordPair("evolink", "request", { ...evBuilt.body, fallbackReason }, { model: evBuilt.model, mode: evBuilt.mode, duration: evBuilt.duration });
  let evSubmitted: { evolinkTaskId: string; immediateSourceUrl?: string };
  try {
    evSubmitted = await deps.submitEvolink({
      ...evInput,
      persistSubmitReceipt: async r => {
        ev.rawReceipt = r;
        ev.parsed = parseJson(r.body);
        await recordReceipt("evolink", "submit", r);
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ev.error = msg;
    ev.rejectionCode = errorCodeOf(ev.rawReceipt?.body, msg);
    ev.upstreamCharged = (e as { kind?: string } | null)?.kind !== "rejected";
    await recordPair(
      "evolink",
      "rejection",
      { error: msg, receipt: ev.rawReceipt },
      { rejectionCode: ev.rejectionCode ?? null, upstreamCharged: ev.upstreamCharged, zeroCharge: !ev.upstreamCharged },
    );
    return fail(`evolink submit: ${msg}`);
  }
  ev.providerTaskId = evSubmitted.evolinkTaskId;
  ev.upstreamCharged = true;
  const evDone = evSubmitted.immediateSourceUrl
    ? { ok: true as const, sourceUrl: evSubmitted.immediateSourceUrl }
    : await pollUntilDone("evolink", evSubmitted.evolinkTaskId, ev);
  if (evDone.ok) return finish("evolink", evSubmitted.evolinkTaskId, evDone.sourceUrl);
  ev.error = evDone.error;
  ev.rejectionCode = errorCodeOf(ev.terminalRawReceipt?.body, evDone.error);
  await recordPair(
    "evolink",
    "rejection",
    { error: evDone.error, taskId: evSubmitted.evolinkTaskId, receipt: ev.terminalRawReceipt ?? null },
    { rejectionCode: ev.rejectionCode ?? null, upstreamCharged: true, zeroCharge: false },
  );
  return fail(`evolink terminal: ${evDone.error}`);
}
