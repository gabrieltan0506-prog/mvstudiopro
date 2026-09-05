import { createHash, randomUUID } from "node:crypto";
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  uploadBufferToGcsIfAbsent,
} from "./gcs.js";
import {
  GLM_MODEL_GATEWAYS,
  type GlmGatewayName,
  type GlmRawResponseEvidence,
} from "./bailianChat.js";

/** 来源只接收调用方已有身份；legacy直调缺失字段明确留空，禁止猜集号。 */
export type NativeDeepReadGlmEvidenceContext = {
  seriesKey?: string;
  sourceDigest?: string;
  episodeIndex?: number;
  batchRequestId?: string;
  callId?: string;
  /** 正式整形调度器分配的首选通道；失败时仍按链序自动切到下一档。 */
  preferredGlmGateway?: string;
  /** 0905 整形开关：GLM 首发链或 Qwen 首发链。 */
  gatewayPolicy?: "structuring_chain" | "structuring_chain_qwen_first";
  /** 稳定调用身份下先回读已付费证据；仅正式可恢复整形使用。 */
  recoverExisting?: boolean;
  /** 请求证据落盘后、真正调用上游前发运行回执；恢复命中时不会调用。 */
  onBeforePaidCall?: () => Promise<void>;
  /** 0905：流式心跳（每 30 秒已收字节数），面板据此显示「还活着」。 */
  onStreamProgress?: (info: { gateway: string; receivedBytes: number; elapsedMs: number }) => void | Promise<void>;
  /** 0905：换档时通知面板（首发档失败原因 + 正在切下一档）。 */
  onGatewayFallback?: (info: { gateway: string; outcome: string; detail?: string }) => void | Promise<void>;
};
export type NativeDeepReadGlmEvidenceReceipt = {
  objectName: string;
  bytes: number;
  sha256: string;
  generation?: string;
};
export type NativeDeepReadGlmRawEvidenceReceipt = NativeDeepReadGlmEvidenceReceipt & {
  gateway: GlmGatewayName;
  model: string;
  httpStatus: number;
  providerRequestId?: string;
  bodyComplete: boolean;
  receivedBytes: number;
};
export type NativeDeepReadGlmEvidence = {
  callId: string;
  request: NativeDeepReadGlmEvidenceReceipt;
  raw: NativeDeepReadGlmRawEvidenceReceipt[];
  parsed: NativeDeepReadGlmEvidenceReceipt;
  selectedRawObjectName: string;
};
export type NativeDeepReadGlmEvidenceDeps = {
  upload: typeof uploadBufferToGcsIfAbsent;
  getBucket: typeof getGcsBucketName;
  download?: typeof downloadGcsObjectVersioned;
};
const defaultDeps: NativeDeepReadGlmEvidenceDeps = {
  upload: uploadBufferToGcsIfAbsent,
  getBucket: getGcsBucketName,
};

/** 本轮授权仅覆盖现有桶；不提供公开链接、不读取或保存传输鉴权信息。 */
const EVIDENCE_BUCKET = "mv-studio-pro-vertex-video-temp";

type NativeDeepReadGlmStoredResponse = {
  gateway: GlmGatewayName;
  model: string;
  provider?: string;
  providerRequestId?: string;
  finishReason?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    cost?: number;
  };
  gatewayTrace?: unknown;
};

export type NativeDeepReadGlmRecoveredEvidence = {
  parsed: Record<string, unknown>;
  response: NativeDeepReadGlmStoredResponse;
  evidence: NativeDeepReadGlmEvidence;
  preferredGlmGateway: string;
};

function evidencePrefix(callId: string): string {
  return `manhua-template-learn/episode-glm-evidence/${callId}`;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

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

function isNotFound(error: unknown): boolean {
  return /gcs_(?:stat|download)_failed:404/.test(error instanceof Error ? error.message : String(error));
}

function assertRecord(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
}

function receiptFromDownload(
  objectName: string,
  downloaded: Awaited<ReturnType<typeof downloadGcsObjectVersioned>>,
): NativeDeepReadGlmEvidenceReceipt {
  return {
    objectName,
    bytes: downloaded.buffer.byteLength,
    sha256: sha256(downloaded.buffer),
    ...(downloaded.generation ? { generation: downloaded.generation } : {}),
  };
}

/**
 * 只按稳定 callId 回读完整的 request + parsed 证据。request 已存在而 parsed 缺失时
 * 关闭式停止：此时无法证明上游是否已经计费，自动重发会造成双烧。
 */
export async function readNativeDeepReadGlmRecoveredEvidence(input: {
  context: NativeDeepReadGlmEvidenceContext;
  expectedRequestWithoutPreferredGateway: Record<string, unknown>;
  deps?: NativeDeepReadGlmEvidenceDeps;
}): Promise<NativeDeepReadGlmRecoveredEvidence | null> {
  const callId = String(input.context.callId || "").trim();
  const seriesKey = String(input.context.seriesKey || "").trim();
  const sourceDigest = String(input.context.sourceDigest || "").trim();
  const episodeIndex = input.context.episodeIndex;
  if (!callId || !seriesKey || !/^[a-f0-9]{64}$/.test(sourceDigest)
    || !Number.isSafeInteger(episodeIndex) || Number(episodeIndex) < 1) {
    throw new Error("整集GLM恢复身份无效，未调用模型");
  }
  const deps = input.deps ?? defaultDeps;
  const bucket = deps.getBucket();
  if (bucket !== EVIDENCE_BUCKET) throw new Error("整集GLM证据存储桶不在本轮授权范围，未调用模型");
  const download = deps.download ?? downloadGcsObjectVersioned;
  const prefix = evidencePrefix(callId);
  const downloadFile = async (file: string) => {
    try {
      return await download({ gcsUri: `gs://${bucket}/${prefix}/${file}.json` });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new Error(`整集GLM ${file}证据读取失败，已停止以避免重复付费`);
    }
  };

  const requestDownloaded = await downloadFile("request");
  if (!requestDownloaded) return null;
  const requestObjectName = `${prefix}/request.json`;
  let requestPayload: Record<string, unknown>;
  try {
    requestPayload = JSON.parse(requestDownloaded.buffer.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("整集GLM request证据损坏，已停止以避免重复付费");
  }
  assertRecord(requestPayload, "整集GLM request证据格式无效，已停止以避免重复付费");
  assertRecord(requestPayload.request, "整集GLM request正文缺失，已停止以避免重复付费");
  const storedPreferred = requestPayload.preferredGlmGateway;
  if (
    requestPayload.schemaVersion !== 1
    || requestPayload.callId !== callId
    || requestPayload.seriesKey !== seriesKey
    || requestPayload.sourceDigest !== sourceDigest
    || requestPayload.episodeIndex !== episodeIndex
    || typeof requestPayload.batchRequestId !== "string"
    || !requestPayload.batchRequestId.trim()
    // 0905 整形链五档（GLM 两档 + Qwen 三档）都可能是首发档，只要求非空字符串
    || typeof storedPreferred !== "string" || !storedPreferred.trim()
    || (input.context.preferredGlmGateway && storedPreferred !== input.context.preferredGlmGateway)
  ) throw new Error("整集GLM request证据身份不一致，已停止以避免重复付费");
  const expectedRequest = {
    ...input.expectedRequestWithoutPreferredGateway,
    preferredGlmGateway: storedPreferred,
  };
  // responseJsonSchema 只影响 Qwen 档的 response_format，不改提示词与冻结参数；比对身份时剔除，旧证据仍可恢复
  const stripSchema = (r: unknown) => { const o = { ...(r as Record<string, unknown>) }; delete o.responseJsonSchema; return o; };
  if (canonicalJson(stripSchema(requestPayload.request)) !== canonicalJson(stripSchema(expectedRequest))) {
    throw new Error("整集GLM request证据与当前冻结请求不一致，已停止以避免重复付费");
  }
  const requestReceipt = receiptFromDownload(requestObjectName, requestDownloaded);

  const parsedDownloaded = await downloadFile("parsed");
  if (!parsedDownloaded) {
    throw new Error("整集GLM请求证据已存在但解析证据缺失，已停止以避免重复付费");
  }
  const parsedObjectName = `${prefix}/parsed.json`;
  let parsedPayload: Record<string, unknown>;
  try {
    parsedPayload = JSON.parse(parsedDownloaded.buffer.toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("整集GLM parsed证据损坏，已停止以避免重复付费");
  }
  assertRecord(parsedPayload, "整集GLM parsed证据格式无效，已停止以避免重复付费");
  assertRecord(parsedPayload.parsed, "整集GLM parsed正文缺失，已停止以避免重复付费");
  assertRecord(parsedPayload.response, "整集GLM parsed响应回执缺失，已停止以避免重复付费");
  const rawEvidence = parsedPayload.rawEvidence;
  const selectedRawObjectName = parsedPayload.selectedRawObjectName;
  if (
    parsedPayload.schemaVersion !== requestPayload.schemaVersion
    || parsedPayload.callId !== callId
    || parsedPayload.seriesKey !== seriesKey
    || parsedPayload.sourceDigest !== sourceDigest
    || parsedPayload.episodeIndex !== episodeIndex
    || parsedPayload.batchRequestId !== requestPayload.batchRequestId
    || parsedPayload.preferredGlmGateway !== storedPreferred
    || canonicalJson(parsedPayload.requestEvidence) !== canonicalJson(requestReceipt)
    || !Array.isArray(rawEvidence) || rawEvidence.length < 1
    || typeof selectedRawObjectName !== "string"
  ) throw new Error("整集GLM parsed证据身份不一致，已停止以避免重复付费");

  const validatedRaw = rawEvidence.map((row, index) => {
    assertRecord(row, "整集GLM raw证据回执无效，已停止以避免重复付费");
    if (
      row.objectName !== `${prefix}/raw-${index + 1}.json`
      || !Number.isSafeInteger(row.bytes) || Number(row.bytes) < 1
      || !/^[a-f0-9]{64}$/.test(String(row.sha256 || ""))
      || !GLM_MODEL_GATEWAYS.has(row.gateway as GlmGatewayName)
      || typeof row.model !== "string" || !row.model.trim()
      || !Number.isSafeInteger(row.httpStatus) || Number(row.httpStatus) < 100 || Number(row.httpStatus) > 599
      || typeof row.bodyComplete !== "boolean"
      || !Number.isSafeInteger(row.receivedBytes) || Number(row.receivedBytes) < 0
    ) throw new Error("整集GLM raw证据回执无效，已停止以避免重复付费");
    return row as NativeDeepReadGlmRawEvidenceReceipt;
  });
  const selectedRaw = validatedRaw.at(-1)!;
  const response = parsedPayload.response as NativeDeepReadGlmStoredResponse;
  if (
    selectedRawObjectName !== selectedRaw.objectName
    || !selectedRaw.bodyComplete
    || response.gateway !== selectedRaw.gateway
    || response.model !== selectedRaw.model
    || !GLM_MODEL_GATEWAYS.has(response.gateway)
  ) throw new Error("整集GLM parsed与原始响应不一致，已停止以避免重复付费");

  return {
    parsed: parsedPayload.parsed,
    response,
    preferredGlmGateway: storedPreferred,
    evidence: {
      callId,
      request: requestReceipt,
      raw: validatedRaw,
      parsed: receiptFromDownload(parsedObjectName, parsedDownloaded),
      selectedRawObjectName,
    },
  };
}

export function createNativeDeepReadGlmEvidenceStore(
  context: NativeDeepReadGlmEvidenceContext = {},
  deps: NativeDeepReadGlmEvidenceDeps = defaultDeps,
) {
  const callId = context.callId ?? randomUUID();
  if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i.test(callId) || callId.length > 128) {
    throw new Error("整集GLM证据调用身份无效，未调用模型");
  }
  const bucket = deps.getBucket();
  if (bucket !== EVIDENCE_BUCKET) throw new Error("整集GLM证据存储桶不在本轮授权范围，未调用模型");
  const identity = {
    schemaVersion: 1,
    callId,
    identityScope: context.episodeIndex === undefined ? "standalone" : "episode",
    seriesKey: context.seriesKey ?? null,
    sourceDigest: context.sourceDigest ?? null,
    episodeIndex: context.episodeIndex ?? null,
    batchRequestId: context.batchRequestId ?? null,
    preferredGlmGateway: context.preferredGlmGateway ?? null,
  };
  const prefix = evidencePrefix(callId);
  let requestEvidence: NativeDeepReadGlmEvidenceReceipt | undefined;
  let rawNumber = 0;
  const rawEvidence: NativeDeepReadGlmRawEvidenceReceipt[] = [];
  const persist = async (file: string, payload: Record<string, unknown>): Promise<NativeDeepReadGlmEvidenceReceipt> => {
    const objectName = `${prefix}/${file}.json`;
    const buffer = Buffer.from(JSON.stringify({ ...identity, ...payload }), "utf8");
    let saved: Awaited<ReturnType<typeof uploadBufferToGcsIfAbsent>>;
    try {
      saved = await deps.upload({ bucket, objectName, buffer, contentType: "application/json" });
    } catch {
      // 上游错误可能带URL/鉴权上下文；不把原始错误或cause写入回执。
      throw new Error(`整集GLM ${file}证据保存失败，停止消费且不得重发模型请求`);
    }
    if (!saved.created) throw new Error(`整集GLM ${file}证据已存在，禁止覆盖`);
    const receipt = { objectName, bytes: buffer.byteLength, sha256: createHash("sha256").update(buffer).digest("hex"),
      ...(saved.generation ? { generation: saved.generation } : {}) };
    console.info(`[nativeDeepReadGlmEvidence] ${JSON.stringify(receipt)}`);
    return receipt;
  };
  const assertRawResponseSaved = () => {
    if (!requestEvidence) throw new Error("整集GLM请求证据尚未保存，禁止处理响应");
    if (!rawEvidence.at(-1)?.bodyComplete) throw new Error("整集GLM完整原始响应尚未保存，禁止解析或消费");
  };
  return {
    callId,
    assertRawResponseSaved,
    writeRequest: async (request: Record<string, unknown>) => {
      requestEvidence = await persist("request", { request });
      return requestEvidence;
    },
    writeRawResponse: async (response: GlmRawResponseEvidence) => {
      if (!requestEvidence) throw new Error("整集GLM请求证据尚未保存，禁止处理响应");
      const receipt = await persist(`raw-${++rawNumber}`, { requestEvidence, response });
      // response整体保存，包含异常UTF-8情况下的bodyBase64原始字节，不重编码丢字节。
      const row = { ...receipt, gateway: response.gateway, model: response.model, httpStatus: response.httpStatus,
        providerRequestId: response.providerRequestId, bodyComplete: response.bodyComplete, receivedBytes: response.receivedBytes };
      rawEvidence.push(row);
      return row;
    },
    writeParsed: async (parsed: Record<string, unknown>, response: { gateway: GlmGatewayName; model: string; [key: string]: unknown }): Promise<NativeDeepReadGlmEvidence> => {
      assertRawResponseSaved();
      const selected = rawEvidence.at(-1)!;
      if (selected.gateway !== response.gateway || selected.model !== response.model) {
        throw new Error("整集GLM解析结果与已保存原始响应网关或模型不一致，停止消费");
      }
      const receipt = await persist("parsed", { requestEvidence, rawEvidence, selectedRawObjectName: selected.objectName, response, parsed });
      return { callId, request: requestEvidence!, raw: rawEvidence.map((row) => ({ ...row })), parsed: receipt,
        selectedRawObjectName: selected.objectName };
    },
  };
}
