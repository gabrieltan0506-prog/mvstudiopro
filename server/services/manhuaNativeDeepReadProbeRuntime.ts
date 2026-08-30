import { createHash, randomUUID } from "node:crypto";
import {
  NATIVE_DEEP_READ_GENERATION_CONFIG,
  NATIVE_DEEP_READ_RETRY_TEMPERATURES,
  assertNativeDeepReadPreparedMedia,
} from "./manhuaNativeDeepReadRunner.js";
import type { NativeProbeManifest } from "./manhuaNativeDeepReadProbeManifest.js";
import {
  validateNativeProbeGenerationConfig,
  type NativeProbeGenerationConfigValidation,
} from "./manhuaNativeDeepReadProbeChecks.js";

export type NativeProbeRequestAudit = {
  /** 无法序列化时没有可核对的请求字节，明确为空，不伪造摘要。 */
  requestSha256: string | null;
  request: unknown;
  validation: NativeProbeGenerationConfigValidation;
};

export type NativeProbeTransportEvent = {
  callId: string;
  stage: "visual_model";
  status: "started" | "completed" | "failed";
  observedAtMs: number;
};

const HIDDEN_SECRET = "[敏感字段已隐藏]";
const HIDDEN_URL = "[签名地址已隐藏]";
const sensitiveKey = /^(?:headers?|authorization|proxyauthorization|cookie|setcookie|apikey|accesskey|secretkey|accesskeyid|secretaccesskey|privatekey|clientsecret|password|credentials?|serviceaccount|token|accesstoken|refreshtoken|idtoken|sessiontoken)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type NativeProbeMediaVersion = { bucket: string; objectName: string; generation: string; etag?: string };
type NativeProbeMediaEvidence = { objectName: string; bytes: number; sha256: string; generation: string };
type NativeProbeMediaDeps = {
  stat: (gsUri: string) => Promise<NativeProbeMediaVersion>;
  sign: (gsUri: string) => string | Promise<string>;
  probe: (signedUrl: string) => Promise<string>;
  persist: (input: { segmentIndex: number; kind: "raw" | "parsed"; text: string }) => Promise<NativeProbeMediaEvidence>;
};

/**
 * 已有分片也执行生产媒体验收；全部通过才返回可供注入的事实。
 * 这里只证明媒体时长、局部零位、音轨与字节，不证明素材相对源片的绝对内容偏移。
 */
export async function verifyNativeProbeManifestMedia(manifest: NativeProbeManifest, deps: NativeProbeMediaDeps) {
  const verified: Array<NativeProbeMediaVersion & {
    gsUri: string;
    media: { durationSec: number; hasAudio: boolean; bytes: number };
    rawEvidence: NativeProbeMediaEvidence;
    parsedEvidence: NativeProbeMediaEvidence;
  }> = [];
  for (const segment of manifest.segments) {
    const label = `第${segment.segmentIndex + 1}片`;
    const io = async <T>(stage: string, action: () => Promise<T>): Promise<T> => {
      try { return await action(); }
      catch {
        // ffprobe/签名错误可能包含完整命令与签名URL，不传原错误或cause到日志。
        throw new Error(`${label}${stage}失败，未启动模型调用`);
      }
    };
    const persist = async (kind: "raw" | "parsed", text: string) => {
      const evidence = await io(`媒体${kind}证据保存`, () => deps.persist({ segmentIndex: segment.segmentIndex, kind, text }));
      if (!evidence.objectName || !evidence.generation
        || evidence.bytes !== Buffer.byteLength(text)
        || evidence.sha256 !== createHash("sha256").update(text).digest("hex")) {
        throw new Error(`${label}媒体证据落盘回执不完整或不匹配，未启动模型调用`);
      }
      return evidence;
    };
    const before = await io("对象版本读取", () => deps.stat(segment.gsUri));
    const signedUrl = await io("媒体签名", async () => deps.sign(segment.gsUri));
    const rawText = await io("媒体探测", () => deps.probe(signedUrl));
    // 原始stdout先可靠保存；坏JSON或共享判据失败也不能丢掉已得到的证据。
    const rawEvidence = await persist("raw", rawText);
    let metadata: unknown;
    try { metadata = JSON.parse(rawText); }
    catch { throw new Error(`${label}媒体元数据JSON无法解析，原文已保留，未启动模型调用`); }
    const measured = assertNativeDeepReadPreparedMedia(metadata, {
      durationSec: segment.endSec - segment.startSec,
      isEpisodeTail: Math.abs(segment.endSec - manifest.sourceDurationSec) < 0.001,
    });
    const format = isRecord(metadata) && isRecord(metadata.format) ? metadata.format : {};
    const bytes = (typeof format.size === "number" || (typeof format.size === "string" && format.size.trim()))
      ? Number(format.size) : NaN;
    if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes !== segment.bytes) {
      throw new Error(`${label}实测媒体字节数与清单不一致，未启动模型调用`);
    }
    if (measured.hasAudio !== segment.hasAudio) {
      throw new Error(`${label}实测音轨存在性与清单不一致，未启动模型调用`);
    }
    const after = await io("对象版本复核", () => deps.stat(segment.gsUri));
    if (after.generation !== before.generation || after.bucket !== before.bucket || after.objectName !== before.objectName) {
      throw new Error(`${label}媒体探测期间对象版本发生变化，未启动模型调用`);
    }
    const media = { ...measured, bytes };
    const parsedEvidence = await persist("parsed", JSON.stringify({
      segmentIndex: segment.segmentIndex, gsUri: segment.gsUri, sourceGeneration: before.generation,
      startSec: segment.startSec, endSec: segment.endSec, media, rawEvidence,
      sourceContentOffsetVerified: false,
    }));
    verified.push({ ...before, gsUri: segment.gsUri, media, rawEvidence, parsedEvidence });
  }
  if (new Set(verified.map((row) => row.media.hasAudio)).size !== 1) {
    throw new Error("各分片实测音轨存在性不一致，未启动模型调用");
  }
  return verified;
}

/** 不读环境凭证、不截断正文；只隐藏鉴权字段、私钥和签名地址。 */
function redactText(text: string): string {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, HIDDEN_SECRET)
    .replace(/\b(?:Bearer|Basic)\s+[^\s"'<>]+/gi, HIDDEN_SECRET)
    .replace(/https?:\/\/[^\s"'<>]+/gi, (urlText) => {
      try {
        const url = new URL(urlText);
        return url.search || url.hash || url.username || url.password ? HIDDEN_URL : urlText;
      } catch {
        return HIDDEN_URL;
      }
    });
}

function redactRequest(value: unknown, key = ""): unknown {
  if (sensitiveKey.test(key.replace(/[^a-z0-9]/gi, ""))) return HIDDEN_SECRET;
  if (typeof value === "string") {
    if (/^file_?uri$/i.test(key) && /^https?:\/\//i.test(value)) return HIDDEN_URL;
    return redactText(value);
  }
  if (Array.isArray(value)) return value.map((item) => redactRequest(item));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([childKey, child]) =>
    [childKey, redactRequest(child, childKey)]));
  return value;
}

function misplacedMediaResolution(body: Record<string, unknown>): boolean {
  if (!Array.isArray(body.contents)) return false;
  return body.contents.some((content) => isRecord(content) && Array.isArray(content.parts)
    && content.parts.some((part) => isRecord(part)
      && ("mediaResolution" in part || "media_resolution" in part)));
}

/**
 * 逐次审计真正发送的 JSON 快照，允许生产梯度中的首发及重试温度。
 * 审计保存失败或参数不符时不发请求；这里不重试、不接触鉴权头。
 */
export function createNativeProbeAuditedPost<T>(
  post: (body: unknown, signal?: AbortSignal) => Promise<T>,
  recordAudit: (audit: NativeProbeRequestAudit) => void | Promise<void>,
  /** 仅允许同步追加本地事件数组；不得在此执行网络、日志或其他副作用。 */
  onTransportEvent?: (event: NativeProbeTransportEvent) => void,
): (body: unknown, signal?: AbortSignal) => Promise<T> {
  return async (body, signal) => {
    let serialized: string | undefined;
    let snapshot: unknown;
    try {
      serialized = JSON.stringify(body);
      if (serialized === undefined) throw new Error("请求体为空");
      snapshot = JSON.parse(serialized) as unknown;
    } catch {
      const validation = validateNativeProbeGenerationConfig(undefined, NATIVE_DEEP_READ_GENERATION_CONFIG, []);
      validation.errorsZh.unshift("实际请求无法序列化为 JSON，未发送");
      await recordAudit({ requestSha256: null, request: null, validation });
      throw new Error("探针请求无法序列化，审计已记录，未发送");
    }
    const request = isRecord(snapshot) ? snapshot : {};
    const config = isRecord(request.generationConfig) ? request.generationConfig : {};
    const temperature = config.temperature;
    const allowed = typeof temperature === "number" && Number.isFinite(temperature)
      && (NATIVE_DEEP_READ_RETRY_TEMPERATURES as readonly number[]).includes(temperature);
    const expected = { ...NATIVE_DEEP_READ_GENERATION_CONFIG, temperature };
    const validation = validateNativeProbeGenerationConfig(config, expected,
      typeof temperature === "number" ? [temperature] : []);
    if (!allowed) validation.errorsZh.push("实际温度不在生产冻结重试梯度内");
    if (misplacedMediaResolution(request)) validation.errorsZh.push("当前探针只允许 generationConfig 中的媒体分辨率，不得移入或重复放入 Part");
    if (Object.keys(request).some((key) => sensitiveKey.test(key.replace(/[^a-z0-9]/gi, "")))) {
      validation.errorsZh.push("请求体不得包含鉴权头或凭证字段");
    }
    if (validation.errorsZh.length) {
      validation.status = "fail";
      validation.actualZh += " · 请求发送检查=失败";
    }
    // 先固定拒因，再交给可注入的记录器，记录器不能修改判定后绕过门禁。
    const rejection = validation.status === "pass" ? null : `探针实际请求不合规：${validation.errorsZh.join("；")}`;
    await recordAudit({
      requestSha256: createHash("sha256").update(serialized, "utf8").digest("hex"),
      request: redactRequest(snapshot),
      validation: redactRequest(validation) as NativeProbeGenerationConfigValidation,
    });
    if (rejection) throw new Error(rejection);
    const callId = randomUUID();
    const transportEvent = (status: NativeProbeTransportEvent["status"]) => {
      onTransportEvent?.({ callId, stage: "visual_model", status, observedAtMs: Date.now() });
    };
    // 传输区间不包含审计存储和响应取证；不能用较宽的账单回执区间冒充真实在途。
    transportEvent("started");
    let response: T;
    try {
      response = await post(snapshot, signal);
    } catch (error) {
      transportEvent("failed");
      throw error;
    }
    transportEvent("completed");
    return response;
  };
}

/** 只核对镜像标签声明；不冒充镜像内容、工作树或 GitHub HEAD 已经验证。 */
export function assertNativeProbeImage(expectedCommit: unknown, imageRef: unknown): { commit: string; imageRef: string } {
  if (typeof expectedCommit !== "string" || !/^[a-f0-9]{40}$/i.test(expectedCommit)) {
    throw new Error("探针必须显式指定完整的 40 位提交 SHA");
  }
  if (typeof imageRef !== "string" || !imageRef) throw new Error("无法确认 FLY_IMAGE_REF，禁止推定镜像等于 HEAD");
  const match = /^[^\s@]+:sha-([a-f0-9]{40})(?:@sha256:[a-f0-9]{64})?$/i.exec(imageRef);
  if (!match || match[1]!.toLowerCase() !== expectedCommit.toLowerCase()) {
    throw new Error("镜像必须带与指定提交一致的 sha-<40位SHA> 标签；probe 标签不能证明提交身份");
  }
  return { commit: expectedCommit.toLowerCase(), imageRef };
}

export const NATIVE_PROBE_ATTESTATION_REQUIRED_PATHS = [
  "shared/manhuaNativeDeepReadJob.ts",
  "server/services/manhuaNativeDeepReadPlan.ts",
  "server/services/manhuaNativeDeepReadRunner.ts",
  "server/services/manhuaNativeDeepReadGlmEvidence.ts",
  "server/services/bailianChat.ts",
  "server/services/manhuaNativeDeepReadProbeChecks.ts",
  "server/services/manhuaNativeDeepReadProbeManifest.ts",
  "server/services/manhuaNativeDeepReadProbeRuntime.ts",
  "server/services/manhuaNativeDeepReadProbeEvidence.ts",
  "scripts/manhua-native-two-segment-douyin-probe.mts",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "tsconfig.native-probe.json",
] as const;

function allowedAttestationPath(path: string): boolean {
  if (["package.json", "pnpm-lock.yaml", "tsconfig.json", "tsconfig.native-probe.json"].includes(path)) return true;
  return /^(?:server|shared|scripts)\/(?:[a-z0-9_.-]+\/)*[a-z0-9_.-]+\.(?:ts|mts|js|json)$/i.test(path)
    && path.split("/").every((part) => part !== "." && part !== "..");
}

/**
 * 清单可信性由调用方在生成时核实 GitHub PR HEAD 与 clean tree，本函数不访问网络。
 * 对清单覆盖的运行时源码逐字节验 SHA；不回传源码、原始错误或凭证。
 * manifestSha256 对规范化 JSON 计算：commit/hash 小写、files 按 path 排序。
 */
export async function verifyNativeProbeSourceAttestation(
  value: unknown,
  expectedCommit: unknown,
  readSource: (relativePath: string) => Promise<Buffer>,
): Promise<{ commit: string; filesChecked: number; manifestSha256: string }> {
  if (typeof expectedCommit !== "string" || !/^[a-f0-9]{40}$/i.test(expectedCommit)) {
    throw new Error("源码核验必须指定完整的 40 位提交 SHA");
  }
  if (!isRecord(value) || value.schemaVersion !== 1
    || Object.keys(value).some((key) => !["schemaVersion", "commit", "files"].includes(key))
    || typeof value.commit !== "string" || !/^[a-f0-9]{40}$/i.test(value.commit)
    || !Array.isArray(value.files) || value.files.length === 0) {
    throw new Error("源码清单格式错误：必须为 schemaVersion=1、完整 commit 与非空 files");
  }
  const commit = value.commit.toLowerCase();
  if (commit !== expectedCommit.toLowerCase()) throw new Error("源码清单提交与指定 PR 提交不一致");
  const seen = new Set<string>();
  const files: Array<{ path: string; sha256: string }> = [];
  for (const [index, row] of Array.from(value.files.entries())) {
    if (!isRecord(row) || Object.keys(row).some((key) => !["path", "sha256"].includes(key))
      || typeof row.path !== "string" || !allowedAttestationPath(row.path)) {
      throw new Error(`源码清单第 ${index + 1} 条路径不在允许范围`);
    }
    if (seen.has(row.path)) throw new Error(`源码清单路径重复：${row.path}`);
    if (typeof row.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(row.sha256)) {
      throw new Error(`源码清单 SHA-256 非法：${row.path}`);
    }
    seen.add(row.path);
    files.push({ path: row.path, sha256: row.sha256.toLowerCase() });
  }
  const missing = NATIVE_PROBE_ATTESTATION_REQUIRED_PATHS.filter((path) => !seen.has(path));
  if (missing.length) throw new Error(`源码清单缺少关键文件：${missing.join("、")}`);
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  for (const file of files) {
    let bytes: Buffer;
    try {
      bytes = await readSource(file.path);
      if (!Buffer.isBuffer(bytes)) throw new Error("非字节读取结果");
    } catch {
      throw new Error(`源码文件缺失或不可读取：${file.path}`);
    }
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
      throw new Error(`源码 SHA-256 不匹配：${file.path}`);
    }
  }
  const normalized = JSON.stringify({ schemaVersion: 1, commit, files });
  return {
    commit,
    filesChecked: files.length,
    manifestSha256: createHash("sha256").update(normalized, "utf8").digest("hex"),
  };
}
