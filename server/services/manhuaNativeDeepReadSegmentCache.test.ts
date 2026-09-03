import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const gcs = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  downloadVersioned: vi.fn(),
  list: vi.fn(),
  upload: vi.fn(),
  createIfAbsent: vi.fn(),
}));

vi.mock("./gcs.js", () => ({
  getGcsBucketName: () => "test-bucket",
  deleteGcsObject: gcs.deleteObject,
  downloadGcsObjectVersioned: gcs.downloadVersioned,
  listGcsObjectNamesByPrefix: gcs.list,
  uploadBufferToGcs: gcs.upload,
  uploadBufferToGcsIfAbsent: gcs.createIfAbsent,
}));

import {
  NATIVE_DEEP_READ_SEGMENT_CACHE_SCHEMA_VERSION,
  NATIVE_DEEP_READ_SEGMENT_EVIDENCE_PREFIX,
  NATIVE_DEEP_READ_PARSED_ATTEMPT_EVIDENCE_PREFIX,
  NATIVE_DEEP_READ_RAW_ATTEMPT_EVIDENCE_PREFIX,
  clearNativeDeepReadSegmentCacheForEpisode,
  createNativeDeepReadSegmentCacheEntryIfAbsent,
  listNativeDeepReadSegmentCacheEntriesBySourceDigest,
  readNativeDeepReadRawAttemptEvidence,
  readNativeDeepReadSegmentCacheEntry,
  nativeDeepReadSegmentEvidenceObjectName,
  nativeDeepReadSegmentEvidenceResponseFingerprint,
  nativeDeepReadRawAttemptEvidenceObjectName,
  writeNativeDeepReadRawAttemptEvidence,
  writeNativeDeepReadParsedAttemptEvidence,
  writeNativeDeepReadSegmentCacheEntry,
  type NativeDeepReadSegmentCacheEntry,
  type NativeDeepReadParsedAttemptEvidenceInput,
  type NativeDeepReadRawAttemptEvidenceInput,
  type NativeDeepReadRawAttemptEvidenceReadInput,
} from "./manhuaNativeDeepReadSegmentCache";

const entryOf = (
  over: Partial<NativeDeepReadSegmentCacheEntry> = {}
): NativeDeepReadSegmentCacheEntry => ({
  schemaVersion: NATIVE_DEEP_READ_SEGMENT_CACHE_SCHEMA_VERSION,
  fingerprint: "a".repeat(64),
  sourceDigest: "b".repeat(64),
  seriesKey: "series_a",
  episodeIndex: 3,
  segmentIndex: 1,
  startSec: 90,
  endSec: 180,
  hasAudio: true,
  requestedFps: 10,
  visualRoute: "vertex_gcs_video",
  degraded: false,
  raw: { shots: [{ atSec: 100, visualZh: "人物进入画面" }] },
  paidUsage: {
    inputTokens: 1200,
    outputTokens: 300,
    audioInputTokens: 800,
    reasoningTokens: 100,
    costCny: 0.42,
  },
  savedAtIso: "2026-08-26T10:00:00.000Z",
  ...over,
});

beforeEach(() => {
  gcs.deleteObject.mockReset();
  gcs.downloadVersioned.mockReset();
  gcs.list.mockReset();
  gcs.upload.mockReset();
  gcs.createIfAbsent.mockReset();
  gcs.createIfAbsent.mockResolvedValue({ created: true });
});

const rawInputOf = (
  over: Partial<NativeDeepReadRawAttemptEvidenceInput> = {},
): NativeDeepReadRawAttemptEvidenceInput => ({
  seriesKey: "series_a",
  episodeIndex: 3,
  segmentIndex: 1,
  segmentCount: 2,
  sourceDigest: "b".repeat(64),
  requestFingerprint: "a".repeat(64),
  batchRequestId: "test-batch",
  callId: "11111111-1111-1111-1111-111111111111",
  attemptNumber: 1,
  temperature: 0.65,
  visualRoute: "vertex_gcs_video",
  httpStatus: 200,
  providerRequestId: "provider-req-1",
  responseText: JSON.stringify({ candidates: [{ finishReason: "STOP" }] }),
  ...over,
});

const rawReadInputOf = (
  raw = rawInputOf(),
): NativeDeepReadRawAttemptEvidenceReadInput => ({
  seriesKey: raw.seriesKey,
  episodeIndex: raw.episodeIndex,
  segmentIndex: raw.segmentIndex,
  segmentCount: raw.segmentCount,
  sourceDigest: raw.sourceDigest,
  requestFingerprint: raw.requestFingerprint,
  attemptNumber: raw.attemptNumber,
  temperature: raw.temperature,
  visualRoute: raw.visualRoute,
});

const rawStoredPayload = (raw = rawInputOf()): Record<string, unknown> => {
  const response = Buffer.from(raw.responseText, "utf8");
  return {
    schemaVersion: 1,
    sourceDigest: raw.sourceDigest,
    requestFingerprint: raw.requestFingerprint,
    seriesKey: raw.seriesKey,
    episodeIndex: raw.episodeIndex,
    segmentIndex: raw.segmentIndex,
    segmentCount: raw.segmentCount,
    batchRequestId: raw.batchRequestId,
    callId: raw.callId,
    attemptNumber: raw.attemptNumber,
    temperature: raw.temperature,
    visualRoute: raw.visualRoute,
    httpStatus: raw.httpStatus,
    providerRequestId: raw.providerRequestId,
    responseBytes: response.byteLength,
    responseSha256: createHash("sha256").update(response).digest("hex"),
    responseText: raw.responseText,
  };
};

describe("门禁前原始响应确定性证据", () => {
  it("对象名只由来源、请求契约和尝试序号决定，不依赖随机 callId", () => {
    const first = rawInputOf();
    const second = rawInputOf({ callId: "22222222-2222-2222-2222-222222222222" });
    const expected = `${NATIVE_DEEP_READ_RAW_ATTEMPT_EVIDENCE_PREFIX}`
      + `tpl_native_series_a_ep003/${"b".repeat(64)}/${"a".repeat(64)}/seg1-attempt1.json`;
    expect(nativeDeepReadRawAttemptEvidenceObjectName(first)).toBe(expected);
    expect(nativeDeepReadRawAttemptEvidenceObjectName(second)).toBe(expected);
    expect(nativeDeepReadRawAttemptEvidenceObjectName(rawInputOf({
      requestFingerprint: "c".repeat(64),
    }))).not.toBe(expected);
  });

  it("严格回读并返回原始响应与上游调用身份", async () => {
    const raw = rawInputOf();
    const stored = rawStoredPayload(raw);
    gcs.downloadVersioned.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(stored), "utf8"),
      generation: "7",
    });

    await expect(readNativeDeepReadRawAttemptEvidence(rawReadInputOf(raw))).resolves.toEqual({
      objectName: nativeDeepReadRawAttemptEvidenceObjectName(raw),
      responseText: raw.responseText,
      callId: raw.callId,
      batchRequestId: raw.batchRequestId,
      providerRequestId: raw.providerRequestId,
      responseBytes: Buffer.byteLength(raw.responseText),
      responseSha256: stored.responseSha256,
      httpStatus: 200,
    });
    expect(gcs.downloadVersioned).toHaveBeenCalledWith({
      gcsUri: `gs://test-bucket/${nativeDeepReadRawAttemptEvidenceObjectName(raw)}`,
    });
  });

  it.each([
    ["seriesKey", "series_b"],
    ["episodeIndex", 4],
    ["segmentIndex", 0],
    ["segmentCount", 3],
    ["sourceDigest", "c".repeat(64)],
    ["requestFingerprint", "d".repeat(64)],
    ["batchRequestId", ""],
    ["attemptNumber", 2],
    ["temperature", 0.6],
    ["visualRoute", "not_a_known_route"],
    ["httpStatus", 500],
    ["callId", "bad"],
    ["responseBytes", 1],
    ["responseSha256", "e".repeat(64)],
  ] as const)("存稿字段 %s 不匹配时关闭式失败", async (field, value) => {
    const raw = rawInputOf();
    const stored = { ...rawStoredPayload(raw), [field]: value };
    gcs.downloadVersioned.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(stored), "utf8"),
      generation: "7",
    });
    await expect(readNativeDeepReadRawAttemptEvidence(rawReadInputOf(raw)))
      .rejects.toThrow("身份或内容校验失败");
  });

  it("0904：换道续跑不作废已付费证据——存稿 visualRoute 为其他已知路由时照常回读", async () => {
    const raw = rawInputOf();
    for (const storedRoute of ["evolink_gemini_video", "gemini_api_files_video"] as const) {
      const stored = { ...rawStoredPayload(raw), visualRoute: storedRoute };
      gcs.downloadVersioned.mockResolvedValue({
        buffer: Buffer.from(JSON.stringify(stored), "utf8"),
        generation: "7",
      });
      const read = await readNativeDeepReadRawAttemptEvidence(rawReadInputOf(raw));
      expect(read?.responseText).toBe(stored.responseText);
    }
  });

  it("只有404返回null，权限或网络错误关闭式失败", async () => {
    const input = rawReadInputOf();
    gcs.downloadVersioned.mockRejectedValueOnce(new Error("gcs_download_failed:404:not found"));
    await expect(readNativeDeepReadRawAttemptEvidence(input)).resolves.toBeNull();
    gcs.downloadVersioned.mockRejectedValueOnce(new Error("gcs_stat_failed:403:denied"));
    await expect(readNativeDeepReadRawAttemptEvidence(input))
      .rejects.toThrow("读取失败，已停止以避免重复付费");
  });

  it("同名同内容幂等，同名不同 callId 或响应内容关闭式失败", async () => {
    const raw = rawInputOf();
    await writeNativeDeepReadRawAttemptEvidence(raw);
    const original = gcs.createIfAbsent.mock.calls[0]![0].buffer as Buffer;
    gcs.createIfAbsent.mockResolvedValue({ created: false });
    gcs.downloadVersioned.mockResolvedValue({ buffer: original, generation: "1" });
    await expect(writeNativeDeepReadRawAttemptEvidence(raw)).resolves.toMatchObject({
      objectName: nativeDeepReadRawAttemptEvidenceObjectName(raw),
    });
    await expect(writeNativeDeepReadRawAttemptEvidence({
      ...raw,
      callId: "22222222-2222-2222-2222-222222222222",
    })).rejects.toThrow("内容不同");
    await expect(writeNativeDeepReadRawAttemptEvidence({
      ...raw,
      responseText: "different",
    })).rejects.toThrow("内容不同");
    expect(gcs.upload).not.toHaveBeenCalled();
  });
});

describe("门禁前解析稿永久证据", () => {
  const inputOf = (): NativeDeepReadParsedAttemptEvidenceInput => {
    const identity = {
      seriesKey: "series_a", episodeIndex: 3, segmentIndex: 1, segmentCount: 2,
      sourceDigest: "b".repeat(64), requestFingerprint: "a".repeat(64),
      batchRequestId: "test-batch", callId: "11111111-1111-1111-1111-111111111111",
      attemptNumber: 1, temperature: 0.65, visualRoute: "vertex_gcs_video" as const,
    };
    return {
      ...identity,
      model: "test-model", startSec: 300, endSec: 600, fps: 10, hasAudio: true,
      finishReason: "STOP", truncated: false,
      rawAttemptEvidenceObjectName: nativeDeepReadRawAttemptEvidenceObjectName(identity),
      rawResponseBytes: 100, rawResponseSha256: "c".repeat(64),
      parsed: { shots: Array.from({ length: 150 }, (_, i) => ({ startSec: 300 + i, endSec: 301 + i })) },
    };
  };

  it("完整保存拒收前解析稿、原始对象指针及双哈希，不写accepted或cache", async () => {
    const input = inputOf();
    const result = await writeNativeDeepReadParsedAttemptEvidence(input);
    expect(result.objectName.startsWith(NATIVE_DEEP_READ_PARSED_ATTEMPT_EVIDENCE_PREFIX)).toBe(true);
    const call = gcs.createIfAbsent.mock.calls[0]![0];
    const stored = JSON.parse(call.buffer.toString("utf8"));
    expect(stored.parsed.shots).toHaveLength(150);
    expect(stored.rawAttemptEvidenceObjectName).toBe(input.rawAttemptEvidenceObjectName);
    expect(stored.rawResponseSha256).toBe(input.rawResponseSha256);
    expect(stored.requestFingerprint).toBe(input.requestFingerprint);
    expect(stored.callId).toBe(input.callId);
    const serialized = JSON.stringify(input.parsed);
    expect(result.bytes).toBe(Buffer.byteLength(serialized));
    expect(result.sha256).toBe(createHash("sha256").update(serialized).digest("hex"));
    expect(stored.parsedSha256).toBe(result.sha256);
    expect(gcs.createIfAbsent).toHaveBeenCalledTimes(1);
    expect(gcs.upload).not.toHaveBeenCalled();
    expect(gcs.deleteObject).not.toHaveBeenCalled();
  });

  it("raw对象串到另一attempt时写前阻止", async () => {
    const input = inputOf();
    input.rawAttemptEvidenceObjectName = input.rawAttemptEvidenceObjectName.replace(
      "attempt1.json",
      "attempt2.json",
    );
    await expect(writeNativeDeepReadParsedAttemptEvidence(input)).rejects.toThrow("原始证据身份");
    expect(gcs.createIfAbsent).not.toHaveBeenCalled();
  });

  it("同名同内容幂等，同名异内容关闭式失败且不覆写", async () => {
    const input = inputOf();
    await writeNativeDeepReadParsedAttemptEvidence(input);
    const original = gcs.createIfAbsent.mock.calls[0]![0].buffer;
    gcs.createIfAbsent.mockResolvedValue({ created: false });
    gcs.downloadVersioned.mockResolvedValue({ buffer: original, generation: "1" });
    await expect(writeNativeDeepReadParsedAttemptEvidence(input)).resolves.toMatchObject({ bytes: expect.any(Number) });
    await expect(writeNativeDeepReadParsedAttemptEvidence({ ...input, parsed: { shots: [] } })).rejects.toThrow("内容不同");
    expect(gcs.upload).not.toHaveBeenCalled();
  });

  it("序列化快照先于异步写入，后续gateMarked不能污染存稿", async () => {
    const input = inputOf();
    let complete!: () => void;
    gcs.createIfAbsent.mockImplementation(() => new Promise((resolve) => {
      complete = () => resolve({ created: true });
    }));
    const writing = writeNativeDeepReadParsedAttemptEvidence(input);
    input.parsed.gateMarked = true;
    complete();
    await writing;
    const stored = JSON.parse(gcs.createIfAbsent.mock.calls[0]![0].buffer.toString("utf8"));
    expect(stored.parsed).not.toHaveProperty("gateMarked");
  });
});

describe("错位段缓存核对", () => {
  it("按对象身份读出同来源旧集号，不把别的来源混进迁移候选", async () => {
    const sourceDigest = "b".repeat(64);
    const matching = entryOf({ episodeIndex: 10, segmentIndex: 0, sourceDigest });
    const other = entryOf({ episodeIndex: 11, segmentIndex: 0, sourceDigest: "c".repeat(64) });
    gcs.list.mockResolvedValue([
      "manhua-template-learn/segment-cache/tpl_native_series_a_ep010_seg0.json",
      "manhua-template-learn/segment-cache/tpl_native_series_a_ep011_seg0.json",
    ]);
    gcs.downloadVersioned.mockImplementation(async ({ gcsUri }: { gcsUri: string }) => ({
      buffer: Buffer.from(JSON.stringify(gcsUri.includes("ep010") ? matching : other), "utf8"),
      generation: gcsUri.includes("ep010") ? "10" : "11",
    }));

    const rows = await listNativeDeepReadSegmentCacheEntriesBySourceDigest({
      seriesKey: "series_a",
      sourceDigest,
      excludeEpisodeIndex: 1,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.entry.episodeIndex).toBe(10);
    expect(rows[0]!.entry.segmentIndex).toBe(0);
  });

  it("迁移目标存在不同契约时不覆盖", async () => {
    const target = entryOf({ episodeIndex: 1, segmentIndex: 0 });
    // 证据先落盘：证据名放行，缓存名返回已存在。
    gcs.createIfAbsent.mockImplementation(async ({ objectName }: { objectName: string }) => ({
      created: String(objectName).startsWith(NATIVE_DEEP_READ_SEGMENT_EVIDENCE_PREFIX),
    }));
    gcs.downloadVersioned.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify({ ...target, fingerprint: "f".repeat(64) }), "utf8"),
      generation: "9",
    });

    await expect(createNativeDeepReadSegmentCacheEntryIfAbsent(target)).rejects.toThrow(
      "已有不同缓存，拒绝迁移覆盖",
    );
    expect(gcs.upload).not.toHaveBeenCalled();
  });
});

describe("段缓存读取：只有 404 是 miss", () => {
  it("GCS 404 返回 null，不把未命中升级为故障", async () => {
    gcs.downloadVersioned.mockRejectedValue(
      new Error("gcs_stat_failed:404:not found")
    );

    await expect(
      readNativeDeepReadSegmentCacheEntry({
        seriesKey: "series_a",
        episodeIndex: 3,
        segmentIndex: 1,
      })
    ).resolves.toBeNull();
  });

  it.each([503, 403])("GCS %s 关闭式失败，不能伪装成 miss", async status => {
    gcs.downloadVersioned.mockRejectedValue(
      new Error(`gcs_stat_failed:${status}:upstream`)
    );

    await expect(
      readNativeDeepReadSegmentCacheEntry({
        seriesKey: "series_a",
        episodeIndex: 3,
        segmentIndex: 1,
      })
    ).rejects.toThrow("缓存读取失败，已停止以避免重复付费");
  });

  it("JSON 损坏时关闭式失败，不能重买已付费段", async () => {
    gcs.downloadVersioned.mockResolvedValue({
      buffer: Buffer.from("{ broken json", "utf8"),
      generation: "7",
    });

    await expect(
      readNativeDeepReadSegmentCacheEntry({
        seriesKey: "series_a",
        episodeIndex: 3,
        segmentIndex: 1,
      })
    ).rejects.toThrow("缓存 JSON 损坏，已停止以避免重复付费");
  });
});

describe("段缓存写入：证据门禁与条件写", () => {
  it("有声段 audioInputTokens=0 时写前拒绝，GCS 完全不调用", async () => {
    const entry = entryOf({
      paidUsage: {
        inputTokens: 1200,
        outputTokens: 300,
        audioInputTokens: 0,
        reasoningTokens: 100,
        costCny: 0.42,
      },
    });

    await expect(writeNativeDeepReadSegmentCacheEntry(entry)).rejects.toThrow(
      "段缓存字段或对象身份不完整"
    );
    expect(gcs.downloadVersioned).not.toHaveBeenCalled();
    expect(gcs.createIfAbsent).not.toHaveBeenCalled();
    expect(gcs.upload).not.toHaveBeenCalled();
  });

  it("对象不存在时走 ifGenerationMatch=0 的 createIfAbsent 原子创建路径", async () => {
    const entry = entryOf();
    gcs.downloadVersioned.mockRejectedValue(
      new Error("gcs_stat_failed:404:not found")
    );
    gcs.createIfAbsent.mockResolvedValue({ created: true });

    const result = await writeNativeDeepReadSegmentCacheEntry(entry);
    expect(result.outcome).toBe("created");
    expect(result.entry).toEqual(entry);
    expect(result.cacheObjectName).toBe(
      "manhua-template-learn/segment-cache/tpl_native_series_a_ep003_seg1.json",
    );
    expect(result.evidenceObjectName).toBe(nativeDeepReadSegmentEvidenceObjectName(entry));

    expect(gcs.createIfAbsent).toHaveBeenCalledTimes(2);
    expect(gcs.createIfAbsent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        bucket: "test-bucket",
        objectName: nativeDeepReadSegmentEvidenceObjectName(entry),
        contentType: "application/json",
      }),
    );
    expect(gcs.createIfAbsent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        bucket: "test-bucket",
        objectName:
          "manhua-template-learn/segment-cache/tpl_native_series_a_ep003_seg1.json",
        contentType: "application/json",
      })
    );
    expect(gcs.upload).not.toHaveBeenCalled();
  });

  it("旧版对象只按刚读到的 generation 条件覆写", async () => {
    const entry = entryOf();
    gcs.downloadVersioned.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify({ schemaVersion: 0 }), "utf8"),
      generation: "41",
    });
    gcs.upload.mockResolvedValue({});

    const result = await writeNativeDeepReadSegmentCacheEntry(entry);
    expect(result.outcome).toBe("replaced");
    expect(result.entry).toEqual(entry);
    expect(result.cacheObjectName).toBe(
      "manhua-template-learn/segment-cache/tpl_native_series_a_ep003_seg1.json",
    );

    expect(gcs.upload).toHaveBeenCalledOnce();
    expect(gcs.upload).toHaveBeenCalledWith(
      expect.objectContaining({ ifGenerationMatch: "41" })
    );
    expect(gcs.createIfAbsent).toHaveBeenCalledOnce();
    expect(gcs.createIfAbsent).toHaveBeenCalledWith(expect.objectContaining({
      objectName: nativeDeepReadSegmentEvidenceObjectName(entry),
    }));
  });

  it("条件覆写遇到 412 时复读；竞争方已写入同契约即确认成功", async () => {
    const entry = entryOf();
    gcs.downloadVersioned
      .mockResolvedValueOnce({
        buffer: Buffer.from(JSON.stringify({ schemaVersion: 0 }), "utf8"),
        generation: "41",
      })
      .mockResolvedValueOnce({
        buffer: Buffer.from(JSON.stringify(entry), "utf8"),
        generation: "42",
      });
    gcs.upload.mockRejectedValueOnce(
      new Error("gcs_upload_failed:412:conflict")
    );

    const result = await writeNativeDeepReadSegmentCacheEntry(entry);
    expect(result.outcome).toBe("reused");
    expect(result.entry).toEqual(entry);
    expect(result.evidenceObjectName).toBe(nativeDeepReadSegmentEvidenceObjectName(entry));

    expect(gcs.downloadVersioned).toHaveBeenCalledTimes(2);
    expect(gcs.upload).toHaveBeenCalledTimes(1);
    expect(gcs.upload).toHaveBeenCalledWith(
      expect.objectContaining({ ifGenerationMatch: "41" })
    );
  });

  it("同一付费分片永远写入独立不可变证据，路径含来源与契约指纹", async () => {
    const entry = entryOf();
    gcs.downloadVersioned.mockRejectedValue(new Error("gcs_stat_failed:404:not found"));

    await writeNativeDeepReadSegmentCacheEntry(entry);

    const evidenceName = nativeDeepReadSegmentEvidenceObjectName(entry);
    expect(evidenceName).toBe(
      `${NATIVE_DEEP_READ_SEGMENT_EVIDENCE_PREFIX}tpl_native_series_a_ep003/${"b".repeat(64)}/seg1-${"a".repeat(64)}-${nativeDeepReadSegmentEvidenceResponseFingerprint(entry)}.json`,
    );
    expect(evidenceName).toMatch(/\/seg1-[0-9a-f]{64}-[0-9a-f]{64}\.json$/);
    const evidenceCall = gcs.createIfAbsent.mock.calls.find(
      ([call]) => call.objectName === evidenceName,
    );
    expect(evidenceCall).toBeTruthy();
    expect(JSON.parse(evidenceCall![0].buffer.toString("utf8"))).toMatchObject({
      raw: entry.raw,
      paidUsage: entry.paidUsage,
    });
  });
});

describe("回归：证据身份绑定付费响应", () => {
  it("同一响应仅 savedAtIso 不同：对象名一致（落盘时间不属身份）", () => {
    const first = entryOf({ savedAtIso: "2026-08-28T10:00:00.000Z" });
    const second = entryOf({ savedAtIso: "2026-08-29T03:00:00.000Z" });
    expect(nativeDeepReadSegmentEvidenceObjectName(first))
      .toBe(nativeDeepReadSegmentEvidenceObjectName(second));
  });

  it("相同 raw/usage 但不同调用身份仍生成不同不可变对象", () => {
    const first = entryOf({
      rawAttemptEvidenceObjectName:
        `manhua-template-learn/segment-evidence-raw/tpl_native_series_a_ep003/${"b".repeat(64)}/${"a".repeat(64)}/seg1-attempt1.json`,
      savedAtIso: "2026-08-28T10:00:00.000Z",
    });
    const second = entryOf({
      rawAttemptEvidenceObjectName:
        `manhua-template-learn/segment-evidence-raw/tpl_native_series_a_ep003/${"b".repeat(64)}/${"c".repeat(64)}/seg1-attempt1.json`,
      savedAtIso: "2026-08-28T10:01:00.000Z",
    });

    expect(first.raw).toEqual(second.raw);
    expect(first.paidUsage).toEqual(second.paidUsage);
    expect(nativeDeepReadSegmentEvidenceObjectName(first))
      .not.toBe(nativeDeepReadSegmentEvidenceObjectName(second));
  });

  it("A：同契约不同付费响应各落独立证据，且更新 active 缓存", async () => {
    const buf = (e: NativeDeepReadSegmentCacheEntry) =>
      Buffer.from(`${JSON.stringify(e, null, 2)}\n`, "utf8");
    const entryA = entryOf();
    const entryB = entryOf({
      raw: { shots: [{ atSec: 120, visualZh: "另一次付费响应的段卡" }] },
      savedAtIso: "2026-08-27T10:00:00.000Z",
    });
    const nameA = nativeDeepReadSegmentEvidenceObjectName(entryA);
    const nameB = nativeDeepReadSegmentEvidenceObjectName(entryB);
    expect(nameA).not.toBe(nameB);

    // 第一次付费：缓存不存在，证据 A 先落盘，缓存原子创建。
    gcs.downloadVersioned.mockRejectedValueOnce(new Error("gcs_stat_failed:404:not found"));
    const first = await writeNativeDeepReadSegmentCacheEntry(entryA);
    expect(first.outcome).toBe("created");
    expect(first.entry).toEqual(entryA);
    expect(first.evidenceObjectName).toBe(nameA);
    expect(gcs.upload).not.toHaveBeenCalled();

    // 同契约重跑得到不同响应：证据 B 独立落盘，active 缓存按 generation 更新为 B。
    gcs.downloadVersioned.mockResolvedValueOnce({ buffer: buf(entryA), generation: "41" });
    gcs.upload.mockResolvedValue({});
    const second = await writeNativeDeepReadSegmentCacheEntry(entryB);
    // 缓存在位 A、本次响应 B：outcome=replaced，canonical entry 必须是 B，缓存字节即 B。
    expect(second.outcome).toBe("replaced");
    expect(second.entry).toEqual(entryB);
    expect(second.evidenceObjectName).toBe(nameB);
    expect(gcs.upload).toHaveBeenCalledOnce();
    expect(gcs.upload).toHaveBeenCalledWith(expect.objectContaining({ ifGenerationMatch: "41" }));
    expect((gcs.upload.mock.calls[0]![0] as { buffer: Buffer }).buffer.equals(buf(entryB))).toBe(true);

    const evidenceNames = gcs.createIfAbsent.mock.calls
      .map(([call]) => String(call.objectName))
      .filter((name) => name.startsWith(NATIVE_DEEP_READ_SEGMENT_EVIDENCE_PREFIX));
    expect(evidenceNames).toEqual([nameA, nameB]);

    // 证据 B 再写一遍（并发先写者已落同一内容）：同名同内容幂等放行，不再覆写。
    gcs.downloadVersioned.mockImplementation(async ({ gcsUri }: { gcsUri: string }) => ({
      buffer: buf(entryB),
      generation: gcsUri.endsWith(nameB) ? "1" : "42",
    }));
    gcs.createIfAbsent.mockImplementation(async ({ objectName }: { objectName: string }) => (
      { created: objectName !== nameB }
    ));
    const third = await writeNativeDeepReadSegmentCacheEntry(entryB);
    expect(third.outcome).toBe("reused");
    expect(third.entry).toEqual(entryB);
    expect(gcs.upload).toHaveBeenCalledOnce();
  });

  it("B：证据写入失败必须在覆写缓存之前中止并向上抛", async () => {
    const entry = entryOf();
    // 缓存已在位且同契约：先确保证据，证据失败时禁止任何缓存覆写。
    gcs.downloadVersioned.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(entry), "utf8"),
      generation: "41",
    });
    gcs.createIfAbsent.mockRejectedValue(new Error("gcs_upload_failed:503:evidence down"));

    await expect(writeNativeDeepReadSegmentCacheEntry(entry)).rejects.toThrow(
      "gcs_upload_failed:503:evidence down",
    );
    expect(gcs.upload).not.toHaveBeenCalled();
    // 缓存对象名零写入：连原子创建通道也不得碰 active cache。
    const cacheName = "manhua-template-learn/segment-cache/tpl_native_series_a_ep003_seg1.json";
    expect(gcs.createIfAbsent.mock.calls.some(([call]) => call.objectName === cacheName)).toBe(false);
  });

  it("C：迁移 reused 分支同时落两份独立证据，在位缓存的证据以其自身响应为准", async () => {
    const migrated = entryOf({
      raw: { shots: [{ atSec: 100, visualZh: "迁移来源集的响应" }] },
    });
    const inPlace = entryOf({
      raw: { shots: [{ atSec: 100, visualZh: "目标集已在位的响应" }] },
      savedAtIso: "2026-08-25T10:00:00.000Z",
    });
    // 证据名一律放行；缓存名返回已存在，走 reused 分支。
    gcs.createIfAbsent.mockImplementation(async ({ objectName }: { objectName: string }) => ({
      created: String(objectName).startsWith(NATIVE_DEEP_READ_SEGMENT_EVIDENCE_PREFIX),
    }));
    gcs.downloadVersioned.mockResolvedValue({
      buffer: Buffer.from(JSON.stringify(inPlace), "utf8"),
      generation: "12",
    });

    await expect(createNativeDeepReadSegmentCacheEntryIfAbsent(migrated)).resolves.toBe("reused");

    const evidenceCalls = gcs.createIfAbsent.mock.calls
      .filter(([call]) => String(call.objectName).startsWith(NATIVE_DEEP_READ_SEGMENT_EVIDENCE_PREFIX));
    expect(evidenceCalls).toHaveLength(2);
    expect(evidenceCalls[0]![0].objectName).toBe(nativeDeepReadSegmentEvidenceObjectName(migrated));
    expect(evidenceCalls[1]![0].objectName).toBe(nativeDeepReadSegmentEvidenceObjectName(inPlace));
    const written = JSON.parse(evidenceCalls[1]![0].buffer.toString("utf8"));
    expect(written.raw).toEqual(inPlace.raw);
    expect(written.raw).not.toEqual(migrated.raw);
  });
});

describe("段缓存清理", () => {
  it("任一对象删除失败时仍尝试全部对象，并向上抛错", async () => {
    gcs.deleteObject.mockImplementation(
      async ({ objectName }: { objectName: string }) => {
        if (objectName.endsWith("_seg1.json")) {
          throw new Error("gcs_delete_failed:503");
        }
      }
    );

    await expect(
      clearNativeDeepReadSegmentCacheForEpisode({
        seriesKey: "series_a",
        episodeIndex: 3,
        segmentCount: 3,
      })
    ).rejects.toThrow("第3集段缓存未全部清理");

    expect(gcs.deleteObject).toHaveBeenCalledTimes(3);
    expect(
      gcs.deleteObject.mock.calls.map(([call]) => call.objectName)
    ).toEqual([
      "manhua-template-learn/segment-cache/tpl_native_series_a_ep003_seg0.json",
      "manhua-template-learn/segment-cache/tpl_native_series_a_ep003_seg1.json",
      "manhua-template-learn/segment-cache/tpl_native_series_a_ep003_seg2.json",
    ]);
    expect(gcs.deleteObject.mock.calls.some(
      ([call]) => String(call.objectName).startsWith(NATIVE_DEEP_READ_SEGMENT_EVIDENCE_PREFIX),
    )).toBe(false);
  });
});
