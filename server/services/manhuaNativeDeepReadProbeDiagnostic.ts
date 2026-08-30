import { createHash } from "node:crypto";
import type {
  NativeDeepReadSelectedSegmentsParams,
  NativeDeepReadSelectedSegmentsResult,
} from "./manhuaNativeDeepReadRunner.js";
import { parseNativeProbeManifest } from "./manhuaNativeDeepReadProbeManifest.js";
import { assertNativeProbeImage, verifyNativeProbeManifestMedia } from "./manhuaNativeDeepReadProbeRuntime.js";
import {
  extractNativeProbeModelJson,
  reconcileNativeProbeParsedAttempt,
  reconcileNativeProbeSegment,
} from "./manhuaNativeDeepReadProbeEvidence.js";
import { sanitizeSensitiveText } from "./manhuaMediaSanitize.js";

type DiagnosticOptions = { selectedSegmentIndexes: number[] };
type RecordValue = Record<string, unknown>;
export type NativeProbeDiagnosticFact = { objectName: string; bytes: number; sha256: string; generation?: string; payload: unknown };
type SavedEvidence = { objectName: string; bytes: number; sha256: string; generation?: string; created: boolean };
type DiagnosticInput = {
  flyAppName: string | undefined;
  manifest: unknown;
  selectedSegmentIndexes: readonly number[];
  seriesKey: string;
  videoFps: number;
  hintZh?: string;
  segmentModelConcurrency?: number;
  runtimeIdentity: { commit: string; imageRef: string };
  sourceAttestation: { commit: string; filesChecked: number; manifestSha256: string };
  requestAudits: readonly { objectName: string; requestSha256: string | null; status: string }[];
  modelReceipts: readonly RecordValue[];
  transportEvents: readonly RecordValue[];
  onModelReceipt?: NativeDeepReadSelectedSegmentsParams["onModelReceipt"];
};
type DiagnosticDeps = {
  media: Parameters<typeof verifyNativeProbeManifestMedia>[1];
  runSelected: (params: NativeDeepReadSelectedSegmentsParams) => Promise<NativeDeepReadSelectedSegmentsResult>;
  /** 调用方必须使用不可覆盖写入；回执按实际JSON字节核对。 */
  persist: (relativeName: string, payload: unknown) => Promise<SavedEvidence>;
  collect: (kind: "raw" | "parsed_attempt") => Promise<NativeProbeDiagnosticFact[]>;
};
function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}
function indexes(value: readonly number[]): number[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3
    || value.some((index) => !Number.isSafeInteger(index) || index < 0)
    || new Set(value).size !== value.length) {
    throw new Error("--segment-indexes 必须为1至3个不重复的非负整数原段号");
  }
  return [...value].sort((a, b) => a - b);
}

/** 不读取文件、环境凭证或网络；诊断参数不完整时绝不退回整集入口。 */
export function parseNativeProbeDiagnosticOptions(argv: readonly string[], flyAppName: string | undefined): DiagnosticOptions | null {
  const flags = argv.filter((arg) => arg === "--gemini-only" || arg.startsWith("--gemini-only="));
  const selections = argv.filter((arg) => arg === "--segment-indexes" || arg.startsWith("--segment-indexes="));
  if (!flags.length && !selections.length) return null;
  if (flags.length !== 1 || flags[0] !== "--gemini-only") throw new Error("诊断必须且只能显式使用一次 --gemini-only");
  if (selections.length !== 1 || !/^--segment-indexes=(?:0|[1-9]\d*)(?:,(?:0|[1-9]\d*))*$/.test(selections[0]!)) {
    throw new Error("--segment-indexes 必须且只能使用一次 --segment-indexes=0 或 0,1 形式");
  }
  const selectedSegmentIndexes = indexes(selections[0]!.slice("--segment-indexes=".length).split(",").map(Number));
  const manifests = argv.filter((arg) => arg === "--gcs-manifest" || arg.startsWith("--gcs-manifest="));
  if (manifests.length !== 1 || !/^--gcs-manifest=.+$/.test(manifests[0]!)) {
    throw new Error("选片诊断必须显式提供唯一的 --gcs-manifest=<完整清单>，不解析或重拉片源");
  }
  const allowed = new Set(["gemini-only", "segment-indexes", "gcs-manifest", "execute", "segment-seconds", "fps",
    "expected-commit", "source-attestation", "model-concurrency"]);
  const seen = new Set<string>();
  for (const arg of argv) {
    const name = /^--([^=]+)(?:=|$)/.exec(arg)?.[1];
    if (!name || !allowed.has(name)) throw new Error(`选片诊断不接受参数：${arg.split("=")[0]}`);
    if (seen.has(name)) throw new Error(`选片诊断参数重复：--${name}`);
    seen.add(name);
    if (name === "gemini-only" || name === "execute") {
      if (arg !== `--${name}`) throw new Error(`--${name} 不接受赋值`);
    } else if (!arg.startsWith(`--${name}=`) || !arg.slice(name.length + 3)) {
      throw new Error(`--${name} 缺少显式参数值`);
    }
    if (name === "model-concurrency" && (!/^[1-9]\d*$/.test(arg.slice(name.length + 3))
      || !Number.isSafeInteger(Number(arg.slice(name.length + 3))))) {
      throw new Error("--model-concurrency 必须为正整数");
    }
  }
  if (argv.includes("--execute") && flyAppName !== "mvstudiopro") {
    throw new Error("付费探针只允许在 Fly 容器内运行；本机禁止读取清单后直连上游");
  }
  return { selectedSegmentIndexes };
}

/** 先验完整清单，再选择原段；末片及未选片仍属于原集身份。 */
export function resolveNativeProbeDiagnosticScope(value: unknown, requestedIndexes: readonly number[]) {
  const manifest = parseNativeProbeManifest(value);
  const selectedSegmentIndexes = indexes(requestedIndexes);
  if (selectedSegmentIndexes.some((index) => index >= manifest.segments.length)) {
    throw new Error("--segment-indexes 超出完整清单原段号范围");
  }
  return { manifest, selectedSegmentIndexes, selectedSegments: selectedSegmentIndexes.map((index) => manifest.segments[index]!) };
}

function evidenceCounts(value: unknown) {
  const raw = record(value);
  const rows = (field: unknown): unknown[] => Array.isArray(field) ? field : [];
  const audio = rows(raw.audioResolution);
  const tracks = audio.flatMap((chunk) => rows(record(record(chunk).analysis).audioTrack));
  return { shots: rows(raw.shots).length, subtitles: rows(raw.subtitles).length,
    keyMoments: rows(raw.keyMoments).length, audioResolution: audio.length,
    audioTracks: tracks.length, audioCues: tracks.flatMap((track) => rows(record(track).cues)).length };
}

/** 仅核对已持久化原始用量与逐次回执；成功结果和部分非零用量都不能证明总用量完整。 */
function reconcileDiagnosticUsage(input: DiagnosticInput, rawFacts: readonly NativeProbeDiagnosticFact[]) {
  const unresolvedAttempts: Array<{ callId: string | null; scope: string; reasonZh: string }> = [];
  const unresolved = (scope: string, callId: string | null, reasonZh: string) => {
    unresolvedAttempts.push({ callId, scope, reasonZh });
  };
  const groups = (events: readonly RecordValue[], scope: string) => {
    const grouped = new Map<string, RecordValue[]>();
    for (const event of events) {
      // 生产Runner会附带本地advisory解析回执；它不发送请求，不消耗上游token。
      if (scope === "model" && event.stage === "visual_parse" && event.route === "local_schema_gate") continue;
      if (event.stage !== "visual_model" || typeof event.callId !== "string" || !event.callId
        || !["started", "completed", "failed"].includes(String(event.status))) {
        unresolved(scope, typeof event.callId === "string" ? event.callId : null, "事件身份或状态缺失，不能核对该次调用");
        continue;
      }
      grouped.set(event.callId, [...(grouped.get(event.callId) ?? []), event]);
    }
    return grouped;
  };
  const models = groups(input.modelReceipts, "model");
  const transports = groups(input.transportEvents, "transport");
  const startedCount = (events: readonly RecordValue[]) => events.filter((event) => event.stage === "visual_model" && event.status === "started").length;
  const modelStarted = startedCount(input.modelReceipts);
  const transportStarted = startedCount(input.transportEvents);
  // 两层独立生成callId，不能伪称逐次跨层ID绑定；各层按ID核对，再严格核对请求总数。
  if (!modelStarted || input.requestAudits.length !== modelStarted || transportStarted !== modelStarted) {
    unresolved("request", null, `请求审计${input.requestAudits.length}、模型开始${modelStarted}与传输开始${transportStarted}未对齐`);
  }
  if (new Set(input.requestAudits.map((row) => row.objectName)).size !== input.requestAudits.length
    || input.requestAudits.some((row) => row.status !== "pass" || !row.objectName || !/^[a-f0-9]{64}$/.test(row.requestSha256 ?? ""))) {
    unresolved("request", null, "实际请求审计缺失、重复或未通过");
  }
  for (const [callId, events] of Array.from(transports)) {
    const started = events.filter((event) => event.status === "started");
    const terminal = events.filter((event) => event.status !== "started");
    if (started.length !== 1 || terminal.length !== 1 || events[0]?.status !== "started"
      || terminal[0]?.status !== "completed") {
      unresolved("transport", callId, "传输未唯一完整结束；失败或未返回不能推定免费");
    }
  }
  const tokenCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const knownUsage = { inputTokens: 0, outputTokens: 0, costCny: 0 };
  let knownAttempts = 0;
  const attemptSlots = new Set<string>();
  const startsBySegment = new Map<number, number>();
  for (const [callId, events] of Array.from(models)) {
    const started = events.filter((event) => event.status === "started");
    const completed = events.filter((event) => event.status === "completed");
    const failed = events.filter((event) => event.status === "failed");
    const start = started[0];
    const done = completed[0];
    const segmentIndex = start?.chunkIndex;
    const attemptNumber = start?.attemptNumber;
    if (started.length !== 1 || events[0]?.status !== "started" || completed.length > 1 || failed.length > 1
      || !Number.isInteger(segmentIndex) || !input.selectedSegmentIndexes.includes(segmentIndex as number)
      || !Number.isInteger(attemptNumber) || Number(attemptNumber) < 1 || Number(attemptNumber) > 3
      || typeof start?.batchRequestId !== "string" || !start.batchRequestId
      || typeof start.model !== "string" || !start.model) {
      unresolved("model", callId, "模型尝试开始回执、原段号或1至3次尝试身份不唯一或缺失");
      continue;
    }
    startsBySegment.set(segmentIndex as number, (startsBySegment.get(segmentIndex as number) ?? 0) + 1);
    const slot = `${segmentIndex}:${attemptNumber}`;
    if (attemptSlots.has(slot)) unresolved("model", callId, "同一原段同一次尝试出现重复调用身份");
    attemptSlots.add(slot);
    const facts = rawFacts.filter((fact) => record(fact.payload).callId === callId);
    if (completed.length !== 1 || facts.length !== 1) {
      unresolved("model", callId, `该次尝试完成回执${completed.length}、原始响应${facts.length}；用量未知`);
      continue;
    }
    const fact = facts[0]!;
    const payload = record(fact.payload);
    // 外层GCS JSON可以有缩进与换行，不能重序列化后冒充原文件字节；校验保存时记录的响应原文哈希。
    const responseText = typeof payload.responseText === "string" ? payload.responseText : "";
    if (payload.segmentIndex !== segmentIndex || payload.attemptNumber !== attemptNumber
      || payload.batchRequestId !== start.batchRequestId || payload.seriesKey !== input.seriesKey
      || payload.episodeIndex !== 1 || payload.sourceDigest !== record(input.manifest).sourceDigest
      || done!.batchRequestId !== start.batchRequestId || done!.chunkIndex !== segmentIndex
      || done!.attemptNumber !== attemptNumber || done!.model !== start.model
      || !responseText || payload.responseBytes !== Buffer.byteLength(responseText)
      || payload.responseSha256 !== createHash("sha256").update(responseText).digest("hex")) {
      unresolved("model", callId, "原始证据字节或完成回执与尝试身份不一致");
      continue;
    }
    let rawUsage: RecordValue;
    try { rawUsage = record(record(JSON.parse(responseText)).usageMetadata); }
    catch { unresolved("model", callId, "原始响应无法解析用量，不能用成功状态补造回执"); continue; }
    const thoughts = rawUsage.thoughtsTokenCount ?? 0;
    if (!tokenCount(rawUsage.promptTokenCount) || !tokenCount(rawUsage.candidatesTokenCount) || !tokenCount(thoughts)
      || done!.inputTokens !== rawUsage.promptTokenCount || done!.outputTokens !== rawUsage.candidatesTokenCount + thoughts
      || (done!.reasoningTokens ?? 0) !== thoughts
      || typeof done!.priceEquivalentCny !== "number" || !Number.isFinite(done!.priceEquivalentCny) || done!.priceEquivalentCny < 0) {
      unresolved("model", callId, "原始响应用量缺失或与完成回执不一致，费用估算不能当作完整用量");
      continue;
    }
    knownAttempts += 1;
    knownUsage.inputTokens += rawUsage.promptTokenCount;
    knownUsage.outputTokens += rawUsage.candidatesTokenCount + thoughts;
    knownUsage.costCny += done!.priceEquivalentCny;
  }
  for (const [segmentIndex, count] of Array.from(startsBySegment)) {
    if (count > 3) unresolved("model", null, `原段${segmentIndex}出现${count}次开始回执，超过每片总3次范围`);
  }
  for (const fact of rawFacts) {
    const callId = record(fact.payload).callId;
    if (typeof callId !== "string" || !models.has(callId)) {
      unresolved("raw", typeof callId === "string" ? callId : null, `原始对象缺少本轮模型尝试回执：${fact.objectName}`);
    }
  }
  return { knownUsage: knownAttempts ? knownUsage : null, knownAttempts, unresolvedAttempts,
    usageReceiptComplete: knownAttempts > 0 && unresolvedAttempts.length === 0,
    costBasis: "code_estimate_not_invoice" as const,
    requestCorrelation: "per_layer_call_id_and_total_count" as const };
}

/**
 * 只编排已有媒体核验、生产选片执行器与不可变证据；不复制请求、提示词、重试或解析器。
 * evidence_verified只表示本轮证据对账成功，不表示语义质量通过或整集可导出。
 */
export async function runNativeProbeSelectedDiagnostic(input: DiagnosticInput, deps: DiagnosticDeps) {
  if (input.flyAppName !== "mvstudiopro") throw new Error("选片诊断只允许在 Fly 内执行");
  const scope = resolveNativeProbeDiagnosticScope(input.manifest, input.selectedSegmentIndexes);
  const { manifest, selectedSegmentIndexes, selectedSegments } = scope;
  const identity = assertNativeProbeImage(input.runtimeIdentity.commit, input.runtimeIdentity.imageRef);
  if (identity.commit !== input.sourceAttestation.commit || input.sourceAttestation.filesChecked <= 0
    || !/^[a-f0-9]{64}$/.test(input.sourceAttestation.manifestSha256)) {
    throw new Error("诊断源码核对身份不一致，禁止发车");
  }
  const save = async (name: string, payload: unknown) => {
    const text = JSON.stringify(payload);
    const saved = await deps.persist(name, payload);
    if (!saved.created || !saved.objectName || saved.bytes !== Buffer.byteLength(text)
      || saved.sha256 !== createHash("sha256").update(text).digest("hex")) {
      throw new Error(`诊断证据不可覆盖且必须按原字节可靠保存：${name}`);
    }
    return saved;
  };
  // 完整清单已验过。这里只缩小媒体读取范围，保留全片时长供共享尾片判据使用。
  const inputVideoVersions = await verifyNativeProbeManifestMedia({ ...manifest, segments: selectedSegments }, deps.media);
  const mediaByUri = new Map(inputVideoVersions.map((row) => [row.gsUri, row]));
  const preparedVideos = selectedSegments.map((segment) => {
    const verified = mediaByUri.get(segment.gsUri)!;
    return { ...segment, bytes: verified.media.bytes, hasAudio: verified.media.hasAudio,
      temporaryGcs: { bucket: verified.bucket, objectName: verified.objectName } };
  });
  let result: NativeDeepReadSelectedSegmentsResult | undefined;
  let runError: unknown;
  let resultEvidence: SavedEvidence | undefined;
  const selectedFacts: NativeProbeDiagnosticFact[] = [];
  try {
    result = await deps.runSelected({
      seriesKey: input.seriesKey, episodeIndex: 1, sourceDigest: manifest.sourceDigest,
      segments: manifest.segments.map(({ startSec, endSec }) => ({ startSec, endSec })),
      sourceDurationSec: manifest.sourceDurationSec, videoFps: input.videoFps,
      selectedSegmentIndexes, preparedVideos, hintZh: input.hintZh,
      segmentModelConcurrency: input.segmentModelConcurrency, onModelReceipt: input.onModelReceipt,
    });
    // 先留完整结果；身份错误也保留原物，不以重试掩盖。
    resultEvidence = await save("diagnostic-result.json", { sourceManifest: manifest, result });
    if (result.mode !== "gemini_selected" || result.assemblyComplete !== false || result.glmStatus !== "not_run"
      || result.productAcceptance !== "not_run" || result.sourceDigest !== manifest.sourceDigest
      || result.sourceDurationSec !== manifest.sourceDurationSec || result.totalSegmentCount !== manifest.segments.length
      || result.episodeIndex !== 1 || JSON.stringify(result.selectedSegmentIndexes) !== JSON.stringify(selectedSegmentIndexes)
      || result.segments.length !== selectedSegments.length) throw new Error("诊断结果来源或范围与完整清单不一致");
    for (const selected of result.segments) {
      const source = selectedSegments.find((row) => row.segmentIndex === selected.segmentIndex);
      if (!source || selected.startSec !== source.startSec || selected.endSec !== source.endSec
        || selected.hasAudio !== source.hasAudio || selectedFacts.some((row) => record(row.payload).segmentIndex === selected.segmentIndex)) {
        throw new Error("诊断结果原段号、时间轴或音轨身份不一致");
      }
      const payload = { seriesKey: input.seriesKey, sourceDigest: manifest.sourceDigest, episodeIndex: 1,
        segmentIndex: selected.segmentIndex, startSec: selected.startSec, endSec: selected.endSec,
        fingerprint: selected.requestFingerprint, rawAttemptEvidenceObjectName: selected.rawAttemptEvidenceObjectName,
        hasAudio: selected.hasAudio, raw: selected.raw, paidUsage: selected.paidUsage,
        batchRequestId: result.batchRequestId, mode: "gemini_selected", assemblyComplete: false };
      const saved = await save(`diagnostic-selected/seg${selected.segmentIndex}.json`, payload);
      selectedFacts.push({ ...saved, payload });
    }
  } catch (error) { runError = error; }
  const evidenceFailures: string[] = [];
  const collect = async (kind: "raw" | "parsed_attempt") => {
    try { return await deps.collect(kind); }
    catch (error) { evidenceFailures.push(`读取${kind}证据失败：${sanitizeSensitiveText(error)}`); return []; }
  };
  const rawFacts = await collect("raw");
  const parsedAttemptFacts = await collect("parsed_attempt");
  const rawCountsBySegment = new Map<number, number>();
  for (const fact of [...rawFacts, ...parsedAttemptFacts]) {
    const payload = record(fact.payload);
    if (payload.seriesKey !== input.seriesKey || payload.sourceDigest !== manifest.sourceDigest || payload.episodeIndex !== 1
      || !Number.isInteger(payload.segmentIndex) || !selectedSegmentIndexes.includes(payload.segmentIndex as number)) evidenceFailures.push(`出现非本轮选片身份的证据：${fact.objectName}`);
  }
  for (const fact of rawFacts) {
    const index = Number(record(fact.payload).segmentIndex);
    rawCountsBySegment.set(index, (rawCountsBySegment.get(index) ?? 0) + 1);
  }
  for (const index of selectedSegmentIndexes) {
    const count = rawCountsBySegment.get(index) ?? 0;
    if (count < 1 || count > 3) evidenceFailures.push(`原段${index}收到${count}份raw，不满足本轮每片1至3次总尝试范围`);
  }
  const parsedAttemptReconciliations = rawFacts.map((fact) => ({ rawObjectName: fact.objectName,
    ...reconcileNativeProbeParsedAttempt(fact, parsedAttemptFacts) }));
  for (const row of parsedAttemptReconciliations) if (row.status === "failed") evidenceFailures.push(row.reasonZh);
  for (const fact of parsedAttemptFacts) if (!rawFacts.some((raw) => raw.objectName === record(fact.payload).rawAttemptEvidenceObjectName)) {
    evidenceFailures.push(`解析稿缺少本轮原始对象：${fact.objectName}`);
  }
  const reconciliations = selectedSegments.map((segment) => {
    const selected = selectedFacts.filter((fact) => record(fact.payload).segmentIndex === segment.segmentIndex);
    const reconciliation = selected.length === 1 ? reconcileNativeProbeSegment({
      entry: selected[0]!.payload, rawFacts, seriesKey: input.seriesKey, sourceDigest: manifest.sourceDigest,
      segmentIndex: segment.segmentIndex, startSec: segment.startSec, endSec: segment.endSec,
    }) : { equal: false, reasonZh: "诊断选用原稿缺失或不唯一" };
    let rawCounts: ReturnType<typeof evidenceCounts> | null = null;
    const raw = rawFacts.find((fact) => fact.objectName === record(selected[0]?.payload).rawAttemptEvidenceObjectName);
    if (raw) try { rawCounts = evidenceCounts(extractNativeProbeModelJson(raw.payload)); } catch { /* 由同源对账器报告原始解析错误。 */ }
    return { segmentIndex: segment.segmentIndex, ...reconciliation, rawCounts,
      selectedCounts: selected.length === 1 ? evidenceCounts(record(selected[0]!.payload).raw) : null };
  });
  for (const row of reconciliations) if (!row.equal) evidenceFailures.push(`原段${row.segmentIndex}：${row.reasonZh}`);
  for (const before of inputVideoVersions) {
    try {
      const after = await deps.media.stat(before.gsUri);
      if (after.generation !== before.generation || after.bucket !== before.bucket || after.objectName !== before.objectName) {
        evidenceFailures.push(`已选媒体版本改变：${before.gsUri}`);
      }
    } catch { evidenceFailures.push(`已选媒体版本无法复核：${before.gsUri}`); }
  }
  if (input.requestAudits.length < rawFacts.length || input.requestAudits.some((row) => row.status !== "pass" || !row.requestSha256)) {
    evidenceFailures.push("P1实际请求审计缺失或未通过");
  }
  const knownFailureUsage = record(runError).nativeDeepReadUsage;
  const usageReconciliation = reconcileDiagnosticUsage(input, rawFacts);
  for (const unresolved of usageReconciliation.unresolvedAttempts) {
    evidenceFailures.push(`用量未对齐[${unresolved.scope}:${unresolved.callId ?? "unknown"}]：${unresolved.reasonZh}`);
  }
  const { usageReceiptComplete, knownUsage } = usageReconciliation;
  const failed = Boolean(runError) || evidenceFailures.length > 0;
  const receipt = ({ objectName, bytes, sha256, generation }: NativeProbeDiagnosticFact) => ({ objectName, bytes, sha256, generation });
  const summary = {
    schemaVersion: 1, mode: "gemini_selected", diagnosticStatus: failed ? "failed" : "evidence_verified",
    assemblyComplete: false, productAcceptance: "not_run", qualityAcceptance: "not_reviewed", glmStatus: "not_run",
    runId: input.seriesKey, sourceDigest: manifest.sourceDigest, sourceDurationSec: manifest.sourceDurationSec,
    totalSegmentCount: manifest.segments.length, selectedSegmentIndexes, selectedRanges: selectedSegments,
    fullSegmentPlan: manifest.segments, videoFps: input.videoFps, runtimeIdentity: identity, sourceAttestation: input.sourceAttestation,
    maxAttemptsPerSegment: 3, resultEvidence, rawEvidence: rawFacts.map(receipt), parsedAttemptEvidence: parsedAttemptFacts.map(receipt),
    selectedEvidence: selectedFacts.map(receipt), reconciliations, parsedAttemptReconciliations,
    requestAudits: input.requestAudits, modelReceipts: input.modelReceipts, transportEvents: input.transportEvents,
    usage: usageReceiptComplete ? knownUsage : null,
    knownFailureUsage: knownFailureUsage ?? null, ...usageReconciliation,
    error: runError ? sanitizeSensitiveText(runError) : undefined, evidenceFailures,
    videoRetention: { policy: "preserve_existing", inputVideoVersions, sourceContentOffsetVerified: false },
    frames: { status: "not_run", count: 0 }, exitCode: failed ? 1 : 0,
  };
  const summaryEvidence = await save("diagnostic-summary.json", summary);
  return { summary, summaryEvidence, exitCode: summary.exitCode };
}
