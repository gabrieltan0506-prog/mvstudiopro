import { createHash } from "node:crypto";
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  uploadBufferToGcsIfAbsent,
} from "./gcs.js";
import {
  GLM_CHAIN_FALLBACK_MODEL,
  GlmGatewayError,
  invokeGlmJsonChatWithGatewayFallback,
  type GlmGatewayName,
  type GlmRawResponseEvidence,
} from "./bailianChat.js";

const EVIDENCE_BUCKET = "mv-studio-pro-vertex-video-temp";
const EVIDENCE_PREFIX = "manhua-template-learn/segment-selection-evidence/";
const QWEN_GATEWAYS = new Set<GlmGatewayName>(["plan_sg_qwen", "evolink_qwen"]);

export const NATIVE_DEEP_READ_ATTEMPT_SELECTOR_MODEL = GLM_CHAIN_FALLBACK_MODEL;
export const NATIVE_DEEP_READ_ATTEMPT_SELECTOR_CONFIG = Object.freeze({
  gatewayPolicy: "qwen_only" as const,
  maxTokens: 8_192,
  timeoutMs: 30 * 60_000,
  temperature: 0.2,
  requireFinishReasonStop: true,
});
export const NATIVE_DEEP_READ_ATTEMPT_SELECTOR_CONTRACT_SHA256 = createHash("sha256")
  .update(JSON.stringify({
    model: NATIVE_DEEP_READ_ATTEMPT_SELECTOR_MODEL,
    config: NATIVE_DEEP_READ_ATTEMPT_SELECTOR_CONFIG,
    promptVersion: "qwen-segment-three-pick-one-v1",
  }), "utf8")
  .digest("hex");

export type NativeDeepReadAttemptSelectionCandidate = {
  attemptNumber: 1 | 2 | 3;
  temperature: 0.7 | 0.65 | 0.6;
  passedGate: boolean;
  gateReasonZh?: string;
  raw: Record<string, unknown>;
};

export type NativeDeepReadAttemptSelectionEvidence = {
  callId: string;
  requestObjectName: string;
  rawObjectNames: string[];
  parsedObjectName: string;
};

export type NativeDeepReadAttemptSelectionResult = {
  selectedAttemptNumber: 1 | 2 | 3;
  reasonZh: string;
  gateway: Extract<GlmGatewayName, "plan_sg_qwen" | "evolink_qwen">;
  model: string;
  provider?: string;
  providerRequestId?: string;
  finishReason?: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  evidence: NativeDeepReadAttemptSelectionEvidence;
  recoveredPaidEvidence?: boolean;
};

export type NativeDeepReadAttemptSelectionInput = {
  seriesKey: string;
  sourceDigest: string;
  episodeIndex: number;
  segmentIndex: number;
  batchRequestId: string;
  candidates: readonly NativeDeepReadAttemptSelectionCandidate[];
  abortSignal?: AbortSignal;
  onBeforePaidCall?: () => Promise<void>;
};

type SelectorDeps = {
  invoke: typeof invokeGlmJsonChatWithGatewayFallback;
  upload: typeof uploadBufferToGcsIfAbsent;
  download: typeof downloadGcsObjectVersioned;
  getBucket: typeof getGcsBucketName;
};

const defaultDeps: SelectorDeps = {
  invoke: invokeGlmJsonChatWithGatewayFallback,
  upload: uploadBufferToGcsIfAbsent,
  download: downloadGcsObjectVersioned,
  getBucket: getGcsBucketName,
};

function canonicalJson(value: unknown): string {
  const normalize = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(normalize);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]));
    }
    return node;
  };
  return JSON.stringify(normalize(value));
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isNotFound(error: unknown): boolean {
  return /gcs_(?:stat|download)_failed:404/.test(error instanceof Error ? error.message : String(error));
}

function parseSelection(content: string): { selectedAttemptNumber: 1 | 2 | 3; reasonZh: string } {
  const cleaned = String(content || "").trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  const selectedAttemptNumber = Number(parsed.selectedAttemptNumber);
  const reasonZh = String(parsed.reasonZh || "").trim();
  if (![1, 2, 3].includes(selectedAttemptNumber) || !reasonZh) {
    throw new Error("Qwen 三选一结果缺少合法尝试编号或选择理由");
  }
  return { selectedAttemptNumber: selectedAttemptNumber as 1 | 2 | 3, reasonZh: reasonZh.slice(0, 1_000) };
}

export function buildNativeDeepReadAttemptSelectionPrompt(input: {
  episodeIndex: number;
  segmentIndex: number;
  candidates: readonly NativeDeepReadAttemptSelectionCandidate[];
}): { system: string; user: string } {
  if (input.candidates.length !== 3
    || input.candidates.some((row, index) => row.attemptNumber !== index + 1)) {
    throw new Error("Qwen 三选一必须收到按 0.7/0.65/0.6 排列的三份完整数据");
  }
  return {
    system: `你是影视原生精读分片的可用性裁判。输入是同一视频分片在三档温度下产生的三份候选数据；候选可能没有通过基础 schema 或内容门禁，但你仍必须从三份中选出一份。
必须且只能选一份综合可用性最强的原稿，不是审美选美，也不能只看单项分数。不改写、不合并、不补充任何原数据。
必须逐份同时审查：结构与时间轴有效性、画面覆盖完整度、逐镜观察具体度、字幕与重点时刻证据质量、音轨覆盖及所有声音事件是否在声明区间。passedGate 和 gateReasonZh 是必须纳入判断的代码证据。选中理由必须说明该稿在这些方面为何最可用，不得用空泛的“整体更好”代替。
只返回 JSON：{"selectedAttemptNumber":1|2|3,"reasonZh":"简体中文选择理由"}。`,
    user: `第 ${input.episodeIndex} 集第 ${input.segmentIndex + 1} 片三份候选如下：\n${JSON.stringify(input.candidates)}`,
  };
}

function selectionCallId(input: NativeDeepReadAttemptSelectionInput): string {
  const digest = sha256(canonicalJson({
    seriesKey: input.seriesKey,
    sourceDigest: input.sourceDigest,
    episodeIndex: input.episodeIndex,
    segmentIndex: input.segmentIndex,
    candidates: input.candidates,
    config: NATIVE_DEEP_READ_ATTEMPT_SELECTOR_CONFIG,
  }));
  return `native-segment-selection-${digest}`;
}

export async function selectNativeDeepReadAttemptWithQwen(
  input: NativeDeepReadAttemptSelectionInput,
  deps: SelectorDeps = defaultDeps,
): Promise<NativeDeepReadAttemptSelectionResult> {
  if (!/^[0-9A-Za-z_-]{1,40}$/.test(input.seriesKey)
    || !/^[a-f0-9]{64}$/.test(input.sourceDigest)
    || !Number.isSafeInteger(input.episodeIndex) || input.episodeIndex < 1
    || !Number.isSafeInteger(input.segmentIndex) || input.segmentIndex < 0) {
    throw new Error("Qwen 三选一来源身份无效，未调用模型");
  }
  const bucket = deps.getBucket();
  if (bucket !== EVIDENCE_BUCKET) throw new Error("Qwen 三选一证据存储桶不在授权范围，未调用模型");
  const prompt = buildNativeDeepReadAttemptSelectionPrompt(input);
  const callId = selectionCallId(input);
  const prefix = `${EVIDENCE_PREFIX}${callId}`;
  const requestObjectName = `${prefix}/request.json`;
  const parsedObjectName = `${prefix}/parsed.json`;
  const identity = {
    schemaVersion: 1,
    callId,
    seriesKey: input.seriesKey,
    sourceDigest: input.sourceDigest,
    episodeIndex: input.episodeIndex,
    segmentIndex: input.segmentIndex,
  };
  const request = { ...prompt, ...NATIVE_DEEP_READ_ATTEMPT_SELECTOR_CONFIG };

  const download = async (objectName: string) => {
    try {
      return await deps.download({ gcsUri: `gs://${bucket}/${objectName}` });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new Error("Qwen 三选一证据读取失败，已停止以避免重复付费");
    }
  };
  const existingRequest = await download(requestObjectName);
  if (existingRequest) {
    let storedRequest: Record<string, unknown>;
    try {
      storedRequest = JSON.parse(existingRequest.buffer.toString("utf8")) as Record<string, unknown>;
    } catch {
      throw new Error("Qwen 三选一请求证据损坏，已停止以避免重复付费");
    }
    if (canonicalJson(storedRequest) !== canonicalJson({ ...identity, request })) {
      throw new Error("Qwen 三选一请求证据身份不一致，已停止以避免重复付费");
    }
    const existingParsed = await download(parsedObjectName);
    if (!existingParsed) throw new Error("Qwen 三选一请求已留证但终态缺失，已停止以避免重复付费");
    let payload: Record<string, unknown>;
    let selection: ReturnType<typeof parseSelection>;
    try {
      payload = JSON.parse(existingParsed.buffer.toString("utf8")) as Record<string, unknown>;
      selection = parseSelection(JSON.stringify(payload.selection));
    } catch {
      throw new Error("Qwen 三选一终态证据损坏，已停止以避免重复付费");
    }
    const response = payload.response as Record<string, unknown>;
    const gateway = response.gateway as GlmGatewayName;
    if (!QWEN_GATEWAYS.has(gateway) || response.model !== NATIVE_DEEP_READ_ATTEMPT_SELECTOR_MODEL) {
      throw new Error("Qwen 三选一恢复证据通道不一致，已停止");
    }
    const rawObjectNames = Array.isArray(payload.rawObjectNames) ? payload.rawObjectNames.map(String) : [];
    if (rawObjectNames.length < 1) throw new Error("Qwen 三选一终态证据缺少原始回应，已停止");
    return {
      ...selection,
      gateway: gateway as NativeDeepReadAttemptSelectionResult["gateway"],
      model: String(response.model),
      provider: String(response.provider || "").trim() || undefined,
      providerRequestId: String(response.providerRequestId || "").trim() || undefined,
      finishReason: String(response.finishReason || "").trim() || undefined,
      inputTokens: Math.max(0, Number((response.usage as Record<string, unknown> | undefined)?.prompt_tokens) || 0),
      outputTokens: Math.max(0, Number((response.usage as Record<string, unknown> | undefined)?.completion_tokens) || 0),
      reasoningTokens: Math.max(0, Number(((response.usage as Record<string, unknown> | undefined)?.completion_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens) || 0),
      costUsd: Math.max(0, Number((response.usage as Record<string, unknown> | undefined)?.cost) || 0),
      evidence: {
        callId,
        requestObjectName,
        rawObjectNames,
        parsedObjectName,
      },
      recoveredPaidEvidence: true,
    };
  }

  const persist = async (objectName: string, payload: Record<string, unknown>) => {
    const buffer = Buffer.from(JSON.stringify(payload), "utf8");
    let saved: Awaited<ReturnType<typeof uploadBufferToGcsIfAbsent>>;
    try {
      saved = await deps.upload({ bucket, objectName, buffer, contentType: "application/json" });
    } catch {
      throw new Error("Qwen 三选一证据写入失败，已停止以避免重复付费");
    }
    if (!saved.created) throw new Error("Qwen 三选一证据已存在，禁止覆盖或重复调用");
    console.info(`[nativeDeepReadAttemptSelector] ${JSON.stringify({ objectName, bytes: buffer.byteLength, sha256: sha256(buffer) })}`);
  };
  await persist(requestObjectName, { ...identity, request });
  await input.onBeforePaidCall?.();
  const rawObjectNames: string[] = [];
  let parsedSelection: ReturnType<typeof parseSelection> | undefined;
  const response = await deps.invoke({
    ...request,
    abortSignal: input.abortSignal,
    onRawResponse: async (raw: GlmRawResponseEvidence) => {
      const objectName = `${prefix}/raw-${rawObjectNames.length + 1}.json`;
      await persist(objectName, { ...identity, requestObjectName, response: raw });
      rawObjectNames.push(objectName);
    },
    validateContent: (content) => { parsedSelection = parseSelection(content); },
  });
  if (!QWEN_GATEWAYS.has(response.gateway)
    || response.model !== NATIVE_DEEP_READ_ATTEMPT_SELECTOR_MODEL
    || !parsedSelection) {
    throw new Error("Qwen 三选一通道锁失效或没有返回合法选择");
  }
  const result = parsedSelection as ReturnType<typeof parseSelection>;
  const storedResponse = {
    gateway: response.gateway,
    model: response.model,
    provider: response.provider,
    providerRequestId: response.requestId,
    finishReason: response.choices?.[0]?.finish_reason,
    usage: response.usage,
    gatewayTrace: response.gatewayTrace,
  };
  await persist(parsedObjectName, {
    ...identity,
    requestObjectName,
    rawObjectNames,
    selection: result,
    response: storedResponse,
  });
  return {
    ...result,
    gateway: response.gateway as NativeDeepReadAttemptSelectionResult["gateway"],
    model: response.model,
    provider: String(response.provider || "").trim() || undefined,
    providerRequestId: String(response.requestId || "").trim() || undefined,
    finishReason: String(response.choices?.[0]?.finish_reason || "").trim() || undefined,
    inputTokens: Math.max(0, Number(response.usage?.prompt_tokens) || 0),
    outputTokens: Math.max(0, Number(response.usage?.completion_tokens) || 0),
    reasoningTokens: Math.max(0, Number(response.usage?.completion_tokens_details?.reasoning_tokens) || 0),
    costUsd: Math.max(0, Number(response.usage?.cost) || 0),
    evidence: { callId, requestObjectName, rawObjectNames, parsedObjectName },
  };
}

export function nativeDeepReadAttemptSelectionUsageFromError(error: unknown) {
  return error instanceof GlmGatewayError ? error.usage : undefined;
}
