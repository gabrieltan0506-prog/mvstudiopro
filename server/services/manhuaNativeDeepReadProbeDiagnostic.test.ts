import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  parseNativeProbeDiagnosticOptions,
  resolveNativeProbeDiagnosticScope,
  runNativeProbeSelectedDiagnostic,
} from "./manhuaNativeDeepReadProbeDiagnostic.js";

const digest = "a".repeat(64);
const commit = "b".repeat(40);
const manifest = () => ({
  schemaVersion: 1, sourceDigest: digest, sourceDurationSec: 1594,
  segments: [319, 638, 957, 1276, 1594].map((endSec, segmentIndex) => ({
    segmentIndex, startSec: segmentIndex * 319, endSec,
    gsUri: `gs://test-bucket/fake-segment-${segmentIndex}.mp4`, bytes: 1234, hasAudio: true,
  })),
});
const options = (indexes = "0") => ["--gemini-only", `--segment-indexes=${indexes}`, "--gcs-manifest=/never-read.json"];
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function fixture(indexes = [0], attemptNumber = 1) {
  const source = manifest();
  const objects = new Map<string, unknown>();
  const rawFacts: Array<{ objectName: string; payload: unknown; bytes: number; sha256: string }> = [];
  const parsedFacts: typeof rawFacts = [];
  const modelReceipts: Array<Record<string, unknown>> = [];
  const transportEvents: Array<Record<string, unknown>> = [];
  const fact = (objectName: string, payload: unknown) => ({
    objectName, payload, bytes: Buffer.byteLength(`${JSON.stringify(payload, null, 2)}\n`), sha256: hash(`${JSON.stringify(payload, null, 2)}\n`),
  });
  const persist = vi.fn(async (name: string, payload: unknown) => {
    if (objects.has(name)) throw new Error("禁止覆盖");
    objects.set(name, structuredClone(payload));
    const text = JSON.stringify(payload);
    return { objectName: `test-evidence/${name}`, bytes: Buffer.byteLength(text), sha256: hash(text), generation: "1", created: true };
  });
  const stat = vi.fn(async (uri: string) => ({ bucket: "test-bucket", objectName: uri.split("/").at(-1)!, generation: "1" }));
  const sign = vi.fn(async (uri: string) => `https://example.invalid/${uri.split("/").at(-1)}?test-signature`);
  const probe = vi.fn(async (url: string) => JSON.stringify({
    format: { start_time: "0", duration: url.includes("segment-4") ? "318" : "319", size: "1234" },
    streams: [
      { codec_type: "video", start_time: "0", duration: url.includes("segment-4") ? "318" : "319", width: 540, height: 960, avg_frame_rate: "30/1" },
      { codec_type: "audio", start_time: "0", duration: url.includes("segment-4") ? "318" : "319" },
    ],
  }));
  const runSelected = vi.fn(async (params: Record<string, unknown>) => {
    const selected = params.selectedSegmentIndexes as number[];
    return {
      mode: "gemini_selected", assemblyComplete: false, glmStatus: "not_run", productAcceptance: "not_run",
      sourceDigest: digest, sourceDurationSec: 1594, totalSegmentCount: 5,
      selectedSegmentIndexes: selected, episodeIndex: 1, batchRequestId: "test-batch", model: "test-model",
      segments: selected.map((segmentIndex) => {
        const segment = source.segments[segmentIndex]!;
        const raw = { shots: [{ startSec: segment.startSec, endSec: segment.endSec, actionZh: "测试具体动作" }], subtitles: [], keyMoments: [], audioResolution: [] };
        const rawObjectName = `raw/seg${segmentIndex}/attempt${attemptNumber}.json`;
        const callId = `test-call-${segmentIndex}-${attemptNumber}`;
        const responseText = JSON.stringify({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 1 },
          candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(raw) }] } }] });
        const rawPayload = {
          seriesKey: "test-diagnostic", sourceDigest: digest, episodeIndex: 1, segmentIndex,
          callId, attemptNumber, batchRequestId: "test-batch", requestFingerprint: "c".repeat(64), responseText,
          responseBytes: Buffer.byteLength(responseText), responseSha256: hash(responseText),
        };
        const modelIdentity = { callId, stage: "visual_model", chunkIndex: segmentIndex, attemptNumber,
          batchRequestId: "test-batch", model: "gemini-3.1-pro-preview" };
        modelReceipts.push({ ...modelIdentity, status: "started" }, { ...modelIdentity, status: "completed",
          inputTokens: 10, outputTokens: 5, reasoningTokens: 1, priceEquivalentCny: 0.01 });
        const transportIdentity = { callId: `transport-${callId}`, stage: "visual_model" };
        transportEvents.push({ ...transportIdentity, status: "started" }, { ...transportIdentity, status: "completed" });
        rawFacts.push(fact(rawObjectName, rawPayload));
        parsedFacts.push(fact(`parsed/seg${segmentIndex}/attempt1.json`, {
          ...rawPayload, rawAttemptEvidenceObjectName: rawObjectName, parsed: raw,
          parsedBytes: Buffer.byteLength(JSON.stringify(raw)), parsedSha256: hash(JSON.stringify(raw)),
          rawResponseBytes: Buffer.byteLength(responseText), rawResponseSha256: hash(responseText),
        }));
        return { ...segment, raw, requestFingerprint: rawPayload.requestFingerprint,
          rawAttemptEvidenceObjectName: rawObjectName, advisories: [], inputTokens: 10, outputTokens: 5,
          paidUsage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 1, audioInputTokens: 0, costCny: 0.01 },
        };
      }),
      usage: { inputTokens: selected.length * 10, outputTokens: selected.length * 5, costCny: selected.length * 0.01 },
      rawAttemptEvidenceObjectNames: rawFacts.map((row) => row.objectName),
    };
  });
  const deps = {
    media: { stat, sign, probe, persist: async ({ segmentIndex, kind, text }: { segmentIndex: number; kind: string; text: string }) => {
      const receipt = await persist(`media/seg${segmentIndex}/${kind}.json`, text);
      return { ...receipt, bytes: Buffer.byteLength(text), sha256: hash(text) };
    } },
    runSelected, persist,
    collect: vi.fn(async (kind: string) => kind === "raw" ? rawFacts : parsedFacts),
  };
  const input = {
    flyAppName: "mvstudiopro", manifest: source, selectedSegmentIndexes: indexes,
    seriesKey: "test-diagnostic", videoFps: 12,
    runtimeIdentity: { commit, imageRef: `registry.example.invalid/test:sha-${commit}` },
    sourceAttestation: { commit, filesChecked: 12, manifestSha256: "d".repeat(64) },
    requestAudits: indexes.map((index) => ({ objectName: `test-request-${index}`, requestSha256: hash(`test-request-${index}`), status: "pass" })),
    modelReceipts, transportEvents,
  };
  return { input, deps, objects, rawFacts, parsedFacts };
}

function unknownAttempt(f: ReturnType<typeof fixture>, attemptNumber: number, transportStatus = "failed") {
  const model = { callId: `unknown-model-${attemptNumber}`, stage: "visual_model", chunkIndex: 0, attemptNumber,
    batchRequestId: "test-batch", model: "gemini-3.1-pro-preview" };
  f.input.modelReceipts.push({ ...model, status: "started" }, { ...model, status: "failed" });
  const transport = { callId: `unknown-transport-${attemptNumber}`, stage: "visual_model" };
  f.input.transportEvents.push({ ...transport, status: "started" }, { ...transport, status: transportStatus });
  f.input.requestAudits.push({ objectName: `request-unknown-${attemptNumber}`, requestSha256: hash(`unknown-${attemptNumber}`), status: "pass" });
}

describe("选片诊断参数：显式入口与完整来源计划", () => {
  it("旧整集入口完全惰性", () => expect(parseNativeProbeDiagnosticOptions([], "")).toBeNull());
  it.each(["0", "0,1", "4,2,0"])("接受1至3片并排序原索引 %s", (value) => {
    expect(parseNativeProbeDiagnosticOptions(options(value), "")?.selectedSegmentIndexes)
      .toEqual(value.split(",").map(Number).sort((a, b) => a - b));
  });
  it.each(["", "0,0", "0,1,2,3", "-1", "1.5", "NaN", "0,", " 0", "01"])("非法索引%s不能默默改成整集", (value) => {
    expect(() => parseNativeProbeDiagnosticOptions(options(value), "")).toThrow(/segment-indexes/);
  });
  it.each([
    ["--gemini-only"], ["--segment-indexes=0"],
    ["--gemini-only=false", "--segment-indexes=0", "--gcs-manifest=x"],
    [...options(), "--segment-indexes=1"], [...options(), "--gemini-only"],
    [...options(), "--url=https://example.invalid"], [...options(), "--unknown=1"],
    [...options(), "--execute=false"], [...options(), "--model-concurrency=9999999999999999999999"],
  ].map((args) => ({ args })))("不完整或矛盾选项必须拒绝 $args", ({ args }) => {
    expect(() => parseNativeProbeDiagnosticOptions(args, "")).toThrow();
  });
  it("本机execute先于任何文件或网络读取拒绝", () => {
    expect(() => parseNativeProbeDiagnosticOptions([...options(), "--execute"], "")).toThrow(/Fly/);
  });
  it("选尾片不缩短全片、不重编号", () => {
    const scope = resolveNativeProbeDiagnosticScope(manifest(), [4]);
    expect(scope.manifest.sourceDurationSec).toBe(1594);
    expect(scope.manifest.segments).toHaveLength(5);
    expect(scope.selectedSegments).toEqual([manifest().segments[4]]);
  });
  it.each([[5], [-1], [0, 0], [], [0, 1, 2, 3]].map((indexes) => ({ indexes })))("运行范围也拒绝非法索引 $indexes", ({ indexes }) => {
    expect(() => resolveNativeProbeDiagnosticScope(manifest(), indexes)).toThrow();
  });
  it("未选片的映射损坏也必须拒绝完整manifest", () => {
    const value = manifest(); value.segments[4]!.startSec += 1;
    expect(() => resolveNativeProbeDiagnosticScope(value, [0])).toThrow();
  });
});

describe("选片诊断编排：纯假媒体与假模型，不连接网络", () => {
  it("只验选中片，沿原段号使用完整计划并永久保存诊断选用原稿", async () => {
    const f = fixture([4, 2]);
    const output = await runNativeProbeSelectedDiagnostic(f.input, f.deps as never);
    const args = f.deps.runSelected.mock.calls[0]![0];
    expect(args).toMatchObject({ sourceDigest: digest, sourceDurationSec: 1594, selectedSegmentIndexes: [2, 4], videoFps: 12 });
    expect(args.segments).toHaveLength(5);
    expect((args.preparedVideos as Array<{ startSec: number }>).map((row) => row.startSec)).toEqual([638, 1276]);
    expect(f.deps.media.sign.mock.calls.map(([uri]) => uri)).toEqual([manifest().segments[2]!.gsUri, manifest().segments[4]!.gsUri]);
    expect(f.deps.media.probe).toHaveBeenCalledTimes(2);
    expect(output.summary).toMatchObject({ diagnosticStatus: "evidence_verified", assemblyComplete: false, productAcceptance: "not_run", glmStatus: "not_run", qualityAcceptance: "not_reviewed", totalSegmentCount: 5, sourceDurationSec: 1594 });
    expect(output.exitCode).toBe(0);
    expect(f.objects.has("diagnostic-selected/seg2.json")).toBe(true);
    expect(f.objects.has("diagnostic-selected/seg4.json")).toBe(true);
    expect(Array.from(f.objects.keys()).some((key) => key.includes("segment-cache") || key.includes("episode-result"))).toBe(false);
  });
  it.each(["outside", "identity", "metadata"])("%s错误在模型前拒绝", async (kind) => {
    const f = fixture();
    if (kind === "outside") f.input.flyAppName = "";
    if (kind === "identity") f.input.sourceAttestation.commit = "e".repeat(40);
    if (kind === "metadata") f.deps.media.probe.mockResolvedValue("{broken-json");
    await expect(runNativeProbeSelectedDiagnostic(f.input, f.deps as never)).rejects.toThrow();
    expect(f.deps.runSelected).not.toHaveBeenCalled();
    if (kind === "metadata") expect(f.objects.has("media/seg0/raw.json")).toBe(true);
    else expect(f.deps.media.stat).not.toHaveBeenCalled();
  });
  it("付费失败也落摘要，未知费用不能写0，不调用整集fallback", async () => {
    const f = fixture(); f.deps.runSelected.mockRejectedValue(new Error("测试上游失败"));
    const output = await runNativeProbeSelectedDiagnostic(f.input, f.deps as never);
    expect(output.exitCode).toBe(1);
    expect(output.summary).toMatchObject({ diagnosticStatus: "failed", usage: null, glmStatus: "not_run" });
    expect(f.objects.has("diagnostic-summary.json")).toBe(true);
    expect(f.deps.runSelected).toHaveBeenCalledTimes(1);
  });
  it("不完整回执里的已知0元不能冒充完整账单0元", async () => {
    const f = fixture();
    f.deps.runSelected.mockRejectedValue(Object.assign(new Error("测试回执未齐"), {
      nativeDeepReadUsage: { inputTokens: 0, outputTokens: 0, costCny: 0, receiptComplete: false },
    }));
    const output = await runNativeProbeSelectedDiagnostic(f.input, f.deps as never);
    expect(output.summary).toMatchObject({ usage: null, usageReceiptComplete: false,
      knownFailureUsage: { costCny: 0, receiptComplete: false } });
  });
  it("完整逐次回执与raw用量对齐才报告完整用量，估算不是供应商账单", async () => {
    const f = fixture();
    const output = await runNativeProbeSelectedDiagnostic(f.input, f.deps as never);
    expect(output.summary).toMatchObject({ diagnosticStatus: "evidence_verified", usageReceiptComplete: true,
      knownUsage: { inputTokens: 10, outputTokens: 5, costCny: 0.01 }, unresolvedAttempts: [],
      costBasis: "code_estimate_not_invoice" });
  });
  it("真实本地advisory解析回执不算额外模型调用，亦不要求上游raw", async () => {
    const f = fixture(); const original = f.deps.runSelected.getMockImplementation()!;
    f.deps.runSelected.mockImplementation(async (params) => {
      const result = await original(params);
      // Runner的advisory生产形态：独立callId、visual_parse、local_schema_gate，只有completed。
      f.input.modelReceipts.push({ callId: "test-local-advisory", model: "gemini-3.1-pro-preview",
        route: "local_schema_gate", stage: "visual_parse", status: "completed", batchRequestId: "test-batch",
        episodeIndexes: [1], chunkIndex: 0, segmentCount: 5, videoCount: 1, attemptNumber: 1,
        advisoryCodes: ["shot_density_low"], advisoriesZh: "测试软提示，不是模型调用" });
      return result;
    });
    const output = await runNativeProbeSelectedDiagnostic(f.input, f.deps as never);
    expect(output.summary).toMatchObject({ diagnosticStatus: "evidence_verified", knownAttempts: 1,
      usageReceiptComplete: true, usage: { inputTokens: 10, outputTokens: 5, costCny: 0.01 }, unresolvedAttempts: [] });
    expect(output.summary.modelReceipts).toHaveLength(3);
  });
  it("非本地GLM的visual_parse回执不可当advisory略过", async () => {
    const f = fixture();
    f.input.modelReceipts.push({ callId: "unexpected-glm", stage: "visual_parse", route: "openrouter_glm",
      status: "started", model: "z-ai/glm-5.3" });
    const output = await runNativeProbeSelectedDiagnostic(f.input, f.deps as never);
    expect(output.summary).toMatchObject({ diagnosticStatus: "failed", usageReceiptComplete: false, usage: null });
    expect(output.summary.unresolvedAttempts).toEqual(expect.arrayContaining([expect.objectContaining({ callId: "unexpected-glm" })]));
  });
  it("首发费用未知而重试成功不能吞掉未知账单", async () => {
    const f = fixture([0], 2); unknownAttempt(f, 1);
    const output = await runNativeProbeSelectedDiagnostic(f.input, f.deps as never);
    expect(output.summary).toMatchObject({ diagnosticStatus: "failed", usage: null, usageReceiptComplete: false,
      knownUsage: { inputTokens: 10, outputTokens: 5, costCny: 0.01 } });
    expect(output.summary.unresolvedAttempts).toEqual(expect.arrayContaining([expect.objectContaining({ callId: "unknown-model-1" })]));
    expect(f.objects.has("diagnostic-selected/seg0.json")).toBe(true);
  });
  it("已知付费失败后未知终止，不信任Runner的非零token完整标记", async () => {
    const f = fixture(); const original = f.deps.runSelected.getMockImplementation()!;
    f.deps.runSelected.mockImplementation(async (params) => {
      await original(params); unknownAttempt(f, 2); unknownAttempt(f, 3);
      throw Object.assign(new Error("第三发网络失联"), {
        nativeDeepReadUsage: { inputTokens: 10, outputTokens: 5, costCny: 0.01, receiptComplete: true },
      });
    });
    const output = await runNativeProbeSelectedDiagnostic(f.input, f.deps as never);
    expect(output.summary).toMatchObject({ usage: null, usageReceiptComplete: false,
      knownUsage: { inputTokens: 10, outputTokens: 5, costCny: 0.01 } });
    expect(output.summary.unresolvedAttempts.length).toBeGreaterThanOrEqual(2);
  });
  it.each(["missing_raw", "http_failure", "usage_mismatch", "missing_usage", "orphan_completed",
    "missing_completed", "transport_inflight", "transport_failed", "extra_request", "wrong_attempt"])("%s不冒充已对账或免费", async (kind) => {
    const f = fixture(); const original = f.deps.runSelected.getMockImplementation()!;
    f.deps.runSelected.mockImplementation(async (params) => {
      const result = await original(params);
      if (kind === "missing_raw") f.rawFacts.splice(0);
      if (kind === "http_failure") unknownAttempt(f, 2, "completed");
      if (kind === "usage_mismatch") f.input.modelReceipts[1]!.outputTokens = 99;
      if (kind === "missing_usage") {
        const payload = f.rawFacts[0]!.payload as { responseText: string; responseBytes: number; responseSha256: string };
        const envelope = JSON.parse(payload.responseText); delete envelope.usageMetadata;
        payload.responseText = JSON.stringify(envelope);
        payload.responseBytes = Buffer.byteLength(payload.responseText); payload.responseSha256 = hash(payload.responseText);
        f.rawFacts[0]!.bytes = Buffer.byteLength(`${JSON.stringify(payload, null, 2)}\n`);
        f.rawFacts[0]!.sha256 = hash(`${JSON.stringify(payload, null, 2)}\n`);
      }
      if (kind === "orphan_completed") f.input.modelReceipts.push({ callId: "orphan", stage: "visual_model", status: "completed", inputTokens: 10, outputTokens: 5, priceEquivalentCny: 0.01 });
      if (kind === "missing_completed") f.input.modelReceipts.splice(1);
      if (kind === "transport_inflight") f.input.transportEvents.splice(1);
      if (kind === "transport_failed") f.input.transportEvents[1]!.status = "failed";
      if (kind === "extra_request") f.input.requestAudits.push({ objectName: "extra-request", requestSha256: hash("extra"), status: "pass" });
      if (kind === "wrong_attempt") f.input.modelReceipts[1]!.attemptNumber = 2;
      return result;
    });
    const output = await runNativeProbeSelectedDiagnostic(f.input, f.deps as never);
    expect(output.summary).toMatchObject({ diagnosticStatus: "failed", usage: null, usageReceiptComplete: false });
  });
  it("同一次模型完成后本地保存失败，已核实用量仍保留但诊断失败", async () => {
    const f = fixture(); const original = f.deps.runSelected.getMockImplementation()!;
    f.deps.runSelected.mockImplementation(async (params) => {
      await original(params);
      f.input.modelReceipts.push({ ...f.input.modelReceipts[0], status: "failed" });
      throw new Error("本地后处理失败，不重买");
    });
    const output = await runNativeProbeSelectedDiagnostic(f.input, f.deps as never);
    expect(output.summary).toMatchObject({ diagnosticStatus: "failed", usageReceiptComplete: true,
      usage: { inputTokens: 10, outputTokens: 5, costCny: 0.01 }, unresolvedAttempts: [] });
    expect(f.deps.runSelected).toHaveBeenCalledTimes(1);
  });
  it("每片三次限制按开始回执核验，不能只数成功raw", async () => {
    const f = fixture(); const original = f.deps.runSelected.getMockImplementation()!;
    f.deps.runSelected.mockImplementation(async (params) => {
      const result = await original(params);
      unknownAttempt(f, 2); unknownAttempt(f, 3); unknownAttempt(f, 4);
      return result;
    });
    const output = await runNativeProbeSelectedDiagnostic(f.input, f.deps as never);
    expect(output.summary).toMatchObject({ diagnosticStatus: "failed", usageReceiptComplete: false, usage: null });
    expect(output.summary.unresolvedAttempts).toEqual(expect.arrayContaining([
      expect.objectContaining({ callId: "unknown-model-4", reasonZh: expect.stringContaining("1至3") }),
    ]));
  });
  it("原始/门禁前解析内容不等即失败，条数相同不能冒充通过", async () => {
    const f = fixture();
    f.deps.collect.mockImplementation(async (kind) => {
      if (kind !== "raw") (f.parsedFacts[0]!.payload as { parsed: { shots: unknown[] } }).parsed.shots = [];
      return kind === "raw" ? f.rawFacts : f.parsedFacts;
    });
    const output = await runNativeProbeSelectedDiagnostic(f.input, f.deps as never);
    expect(output.exitCode).toBe(1);
    expect(output.summary.evidenceFailures.join("；")).toMatch(/解析稿|内容/);
  });
  it("已选视频版本改变使诊断失败，但不删除或重取媒体", async () => {
    const f = fixture(); let count = 0;
    f.deps.media.stat.mockImplementation(async (uri) => ({ bucket: "test-bucket", objectName: uri.split("/").at(-1)!, generation: ++count > 2 ? "2" : "1" }));
    const output = await runNativeProbeSelectedDiagnostic(f.input, f.deps as never);
    expect(output.exitCode).toBe(1);
    expect(output.summary.evidenceFailures.join("；")).toContain("版本");
  });
  it("缺实际P1请求审计不能只凭预检常量宣称证据通过", async () => {
    const f = fixture(); f.input.requestAudits = [];
    const output = await runNativeProbeSelectedDiagnostic(f.input, f.deps as never);
    expect(output.exitCode).toBe(1);
    expect(output.summary.evidenceFailures).toContain("P1实际请求审计缺失或未通过");
  });
  it("选用原稿保存失败保留前序JSON并失败，不再烧一次模型", async () => {
    const f = fixture(); const original = f.deps.persist.getMockImplementation()!;
    f.deps.persist.mockImplementation(async (name, payload) => {
      if (name.startsWith("diagnostic-selected/")) throw new Error("测试永久保存失败");
      return original(name, payload);
    });
    const output = await runNativeProbeSelectedDiagnostic(f.input, f.deps as never);
    expect(output.exitCode).toBe(1);
    expect(output.summary.error).toContain("测试永久保存失败");
    expect(f.objects.has("diagnostic-result.json")).toBe(true);
    expect(f.objects.has("diagnostic-summary.json")).toBe(true);
    expect(f.deps.runSelected).toHaveBeenCalledTimes(1);
  });
});
