import { beforeEach, describe, expect, it, vi } from "vitest";

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
  clearNativeDeepReadSegmentCacheForEpisode,
  createNativeDeepReadSegmentCacheEntryIfAbsent,
  listNativeDeepReadSegmentCacheEntriesBySourceDigest,
  readNativeDeepReadSegmentCacheEntry,
  nativeDeepReadSegmentEvidenceObjectName,
  nativeDeepReadSegmentEvidenceResponseFingerprint,
  writeNativeDeepReadSegmentCacheEntry,
  type NativeDeepReadSegmentCacheEntry,
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
        "manhua-template-learn/segment-evidence-raw/a/attempt1-11111111-1111-1111-1111-111111111111.json",
      savedAtIso: "2026-08-28T10:00:00.000Z",
    });
    const second = entryOf({
      rawAttemptEvidenceObjectName:
        "manhua-template-learn/segment-evidence-raw/a/attempt1-22222222-2222-2222-2222-222222222222.json",
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
