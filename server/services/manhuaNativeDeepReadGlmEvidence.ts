import { createHash, randomUUID } from "node:crypto";
import { getGcsBucketName, uploadBufferToGcsIfAbsent } from "./gcs.js";
import type { GlmGatewayName, GlmRawResponseEvidence } from "./bailianChat.js";

/** 来源只接收调用方已有身份；legacy直调缺失字段明确留空，禁止猜集号。 */
export type NativeDeepReadGlmEvidenceContext = {
  seriesKey?: string;
  sourceDigest?: string;
  episodeIndex?: number;
  batchRequestId?: string;
  callId?: string;
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
};
const defaultDeps: NativeDeepReadGlmEvidenceDeps = {
  upload: uploadBufferToGcsIfAbsent,
  getBucket: getGcsBucketName,
};

/** 本轮授权仅覆盖现有桶；不提供公开链接、不读取或保存传输鉴权信息。 */
const EVIDENCE_BUCKET = "mv-studio-pro-vertex-video-temp";

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
  };
  const prefix = `manhua-template-learn/episode-glm-evidence/${callId}`;
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
