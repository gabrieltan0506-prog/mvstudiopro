import { createHash } from "node:crypto";
import { parseJsonObject, parseTruncatedJsonObject } from "./manhuaNativeDeepReadRunner.js";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("证据必须为对象");
  return value as RecordValue;
}

/** 与生产使用同一解析器；截断响应只重放可解析前缀，不重买模型调用。 */
export function extractNativeProbeModelJson(payload: unknown): RecordValue {
  const stored = record(payload);
  const envelope = record(JSON.parse(String(stored.responseText || "")));
  const candidate = record((envelope.candidates as unknown[])?.[0]);
  const content = record(candidate.content);
  if (!Array.isArray(content.parts)) throw new Error("原始响应没有内容分片");
  const text = content.parts.map(record).filter((part) => !part.thought)
    .map((part) => String(part.text || "")).join("");
  return candidate.finishReason === "MAX_TOKENS" ? parseTruncatedJsonObject(text) : parseJsonObject(text);
}

/** responseText 是被转义的 JSON 字符串，必须先解信封，不能对外层字符串做正则猜测。 */
export function nativeProbeHasThoughtLeak(payload: unknown): boolean {
  const envelope = record(JSON.parse(String(record(payload).responseText || "")));
  if (!Array.isArray(envelope.candidates)) throw new Error("无法检查思考输出：缺少候选信封");
  return envelope.candidates.map(record).some((candidate) => {
    const content = record(candidate.content);
    if (!Array.isArray(content.parts)) throw new Error("无法检查思考输出：缺少内容分片");
    return content.parts.map(record).some((part) => part.thought === true || /<think>/i.test(String(part.text || "")));
  });
}

/** 按接收顺序和callId核对完整生命周期；同毫秒不重排，重复结束不能虚增或抵消并发。 */
export function measureNativeProbeConcurrency(receipts: readonly RecordValue[]) {
  const active = new Set<string>();
  const seen = new Set<string>();
  let peak = 0;
  const errorsZh: string[] = [];
  for (const receipt of receipts) {
    if (receipt.stage !== "visual_model") continue;
    const id = String(receipt.callId || "");
    if (!id) { errorsZh.push("模型回执缺少callId"); continue; }
    if (receipt.status === "started") {
      if (seen.has(id)) { errorsZh.push(`重复开始：${id}`); continue; }
      seen.add(id); active.add(id); peak = Math.max(peak, active.size);
    } else if (receipt.status === "completed" || receipt.status === "failed") {
      if (!active.delete(id)) errorsZh.push(`无匹配开始或重复结束：${id}`);
    } else errorsZh.push(`未知模型状态：${String(receipt.status)}`);
  }
  if (active.size) errorsZh.push(`尚有${active.size}个模型调用缺少结束回执`);
  return { peak, callCount: seen.size, errorsZh };
}

// 只排除运行器附加的顶层诊断；镜头、字幕、声音、分类等模型字段全部逐值核对。
const addedDiagnosticKeys = new Set(["advisories", "truncated", "gateMarked", "gateMarkedZh", "attemptNumber"]);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  return value;
}
function modelContent(value: RecordValue): string {
  return JSON.stringify(canonical(Object.fromEntries(Object.entries(value)
    .filter(([key]) => !addedDiagnosticKeys.has(key)))));
}

/** 每次可解析的付费响应都要有门禁前独立解析稿，不能只核对最终通过的一发。 */
export function reconcileNativeProbeParsedAttempt(
  rawFact: { objectName: string; payload: unknown },
  parsedFacts: readonly { objectName: string; payload: unknown }[],
): { status: "matched" | "unparseable" | "failed"; reasonZh: string } {
  let expected: RecordValue;
  try { expected = extractNativeProbeModelJson(rawFact.payload); }
  catch { return { status: "unparseable", reasonZh: "原始响应无可解析正文，保留raw，不伪造解析稿" }; }
  try {
    const raw = record(rawFact.payload);
    const matches = parsedFacts.filter((fact) => record(fact.payload).rawAttemptEvidenceObjectName === rawFact.objectName);
    if (matches.length !== 1) throw new Error("可解析响应缺少唯一的门禁前解析稿");
    const parsed = record(matches[0]!.payload);
    for (const key of ["seriesKey", "sourceDigest", "episodeIndex", "segmentIndex", "requestFingerprint", "callId", "attemptNumber"]) {
      if (raw[key] === undefined || parsed[key] !== raw[key]) throw new Error(`解析稿${key}身份不一致`);
    }
    const body = Buffer.from(JSON.stringify(record(parsed.parsed)), "utf8");
    const rawBody = Buffer.from(String(raw.responseText), "utf8");
    if (parsed.parsedBytes !== body.byteLength || parsed.parsedSha256 !== createHash("sha256").update(body).digest("hex")
      || parsed.rawResponseBytes !== rawBody.byteLength || parsed.rawResponseSha256 !== createHash("sha256").update(rawBody).digest("hex")) {
      throw new Error("解析稿或对应raw的字节数/哈希不一致");
    }
    if (JSON.stringify(canonical(expected)) !== JSON.stringify(canonical(parsed.parsed))) throw new Error("门禁前解析稿已被改写");
    return { status: "matched", reasonZh: "每次响应与门禁前解析稿的身份、哈希、内容一致" };
  } catch (error) {
    return { status: "failed", reasonZh: error instanceof Error ? error.message : "解析稿对账失败" };
  }
}

/** 按已保存的准确 raw 对象指针、身份及内容对账；数量相同不是内容相同的证据。 */
export function reconcileNativeProbeSegment(input: {
  entry: unknown;
  rawFacts: readonly { objectName: string; payload: unknown }[];
  seriesKey: string;
  sourceDigest: string;
  segmentIndex: number;
  startSec: number;
  endSec: number;
}): { equal: boolean; reasonZh: string; rawObjectName?: string } {
  try {
    const entry = record(input.entry);
    for (const key of ["seriesKey", "sourceDigest", "segmentIndex", "startSec", "endSec"] as const) {
      if (entry[key] !== input[key]) throw new Error(`解析后证据 ${key} 与本次输入不一致`);
    }
    if (entry.episodeIndex !== 1) throw new Error("解析后证据集号不一致");
    const rawObjectName = entry.rawAttemptEvidenceObjectName;
    if (typeof rawObjectName !== "string" || !rawObjectName) throw new Error("解析后证据缺少准确 raw 对象指针");
    const matches = input.rawFacts.filter((fact) => fact.objectName === rawObjectName);
    if (matches.length !== 1) throw new Error("raw 对象指针缺失或不唯一");
    const raw = record(matches[0]!.payload);
    for (const key of ["seriesKey", "sourceDigest", "episodeIndex", "segmentIndex"] as const) {
      if (raw[key] !== entry[key]) throw new Error(`raw 与解析后证据 ${key} 不一致`);
    }
    if (typeof entry.fingerprint !== "string" || raw.requestFingerprint !== entry.fingerprint) {
      throw new Error("raw 与解析后证据请求指纹不一致");
    }
    if (modelContent(extractNativeProbeModelJson(raw)) !== modelContent(record(entry.raw))) {
      throw new Error("raw 与解析后模型内容不一致，即使条数相同也不得通过");
    }
    return { equal: true, reasonZh: "准确对象、来源身份、请求指纹和模型内容一致", rawObjectName };
  } catch (error) {
    return { equal: false, reasonZh: error instanceof Error ? error.message : "证据对账失败" };
  }
}
