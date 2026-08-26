import { beforeEach, describe, expect, it, vi } from "vitest";

const gcs = vi.hoisted(() => ({
  deleteObject: vi.fn(),
  downloadVersioned: vi.fn(),
  upload: vi.fn(),
  createIfAbsent: vi.fn(),
}));

vi.mock("./gcs.js", () => ({
  getGcsBucketName: () => "test-bucket",
  deleteGcsObject: gcs.deleteObject,
  downloadGcsObjectVersioned: gcs.downloadVersioned,
  uploadBufferToGcs: gcs.upload,
  uploadBufferToGcsIfAbsent: gcs.createIfAbsent,
}));

import {
  NATIVE_DEEP_READ_SEGMENT_CACHE_SCHEMA_VERSION,
  clearNativeDeepReadSegmentCacheForEpisode,
  readNativeDeepReadSegmentCacheEntry,
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
  gcs.upload.mockReset();
  gcs.createIfAbsent.mockReset();
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

    await expect(
      writeNativeDeepReadSegmentCacheEntry(entry)
    ).resolves.toBeUndefined();

    expect(gcs.createIfAbsent).toHaveBeenCalledOnce();
    expect(gcs.createIfAbsent).toHaveBeenCalledWith(
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

    await expect(
      writeNativeDeepReadSegmentCacheEntry(entry)
    ).resolves.toBeUndefined();

    expect(gcs.upload).toHaveBeenCalledOnce();
    expect(gcs.upload).toHaveBeenCalledWith(
      expect.objectContaining({ ifGenerationMatch: "41" })
    );
    expect(gcs.createIfAbsent).not.toHaveBeenCalled();
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

    await expect(
      writeNativeDeepReadSegmentCacheEntry(entry)
    ).resolves.toBeUndefined();

    expect(gcs.downloadVersioned).toHaveBeenCalledTimes(2);
    expect(gcs.upload).toHaveBeenCalledTimes(1);
    expect(gcs.upload).toHaveBeenCalledWith(
      expect.objectContaining({ ifGenerationMatch: "41" })
    );
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
  });
});
