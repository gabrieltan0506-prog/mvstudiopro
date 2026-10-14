import { describe, expect, it, vi } from "vitest";
import { preparedMediaIndexName, readPreparedMedia, writePreparedMedia, type PreparedMediaCacheDeps, type PreparedMediaVideo } from "./manhuaNativePreparedMediaCache";
const key = { seriesKey: "series", sourceDigest: "a".repeat(64), episodeIndex: 1, sourceDurationSec: 60, startSec: 0, endSec: 10 };
const video: PreparedMediaVideo = { gsUri: "gs://test-bucket/manhua-template-learn/tmp/native-deep-read/test.mp4",
  temporaryGcs: { bucket: "test-bucket", objectName: "manhua-template-learn/tmp/native-deep-read/test.mp4" }, startSec: 0, endSec: 10, bytes: 200_000, hasAudio: true };
export function mediaCacheFixture() {
  const objects = new Map<string, Buffer>();
  const deps: PreparedMediaCacheDeps = {
    bucket: () => "test-bucket",
    download: vi.fn(async ({ gcsUri }) => {
      const data = objects.get(gcsUri.replace("gs://test-bucket/", ""));
      if (!data) throw new Error("gcs_stat_failed:404");
      return { buffer: data, bucket: "test-bucket", objectName: "index", generation: "1" };
    }),
    stat: vi.fn(async ({ gcsUri }) => ({ bucket: "test-bucket", objectName: gcsUri.split("/").at(-1)!, generation: "7", byteLength: 200_000 })),
    upload: vi.fn(async ({ objectName, buffer }) => {
      objects.set(objectName, buffer); return { bucket: "test-bucket", objectName, gcsUri: `gs://test-bucket/${objectName}` };
    }),
  };
  return { deps, objects };
}
describe("已上传分片跨任务恢复", () => {
  it("持久化真实版本后回读，来源或范围改变不命中", async () => {
    const { deps } = mediaCacheFixture();
    expect(await writePreparedMedia(key, video, deps)).toMatchObject({ reusable: true });
    expect(await readPreparedMedia(key, deps)).toEqual({ ...video, reusable: true });
    expect(await readPreparedMedia({ ...key, sourceDigest: "b".repeat(64) }, deps)).toBeNull();
    expect(await readPreparedMedia({ ...key, endSec: 11 }, deps)).toBeNull();
  });
  it("已有旧截图来源索引可迁移，缺少新索引不再直接重切", async () => {
    const { deps, objects } = mediaCacheFixture();
    const legacyFrameSourceName = `manhua-template-learn/native-frame-sources/${"c".repeat(64)}.json`;
    objects.set(legacyFrameSourceName, Buffer.from(JSON.stringify([video])));
    expect(await readPreparedMedia({ ...key, legacyFrameSourceName }, deps)).toEqual({ ...video, reusable: true });
    expect(objects.has(preparedMediaIndexName(key))).toBe(true);
    objects.delete(legacyFrameSourceName);
    expect(await readPreparedMedia(key, deps)).toMatchObject({ reusable: true });
  });
  it("媒体404或版本改变只返回缺片，不使用失效对象", async () => {
    const { deps } = mediaCacheFixture(); await writePreparedMedia(key, video, deps);
    vi.mocked(deps.stat).mockRejectedValueOnce(new Error("gcs_stat_failed:404"));
    expect(await readPreparedMedia(key, deps)).toBeNull();
    vi.mocked(deps.stat).mockResolvedValueOnce({ bucket: "test-bucket", objectName: "x", generation: "8", byteLength: video.bytes });
    expect(await readPreparedMedia(key, deps)).toBeNull();
  });
  it("读取503/403、损坏索引不得冒充miss重新切片", async () => {
    const { deps, objects } = mediaCacheFixture(); await writePreparedMedia(key, video, deps);
    vi.mocked(deps.stat).mockRejectedValueOnce(new Error("gcs_stat_failed:503"));
    await expect(readPreparedMedia(key, deps)).rejects.toThrow("503");
    vi.mocked(deps.download).mockRejectedValueOnce(new Error("gcs_stat_failed:403"));
    await expect(readPreparedMedia(key, deps)).rejects.toThrow("403");
    objects.set(preparedMediaIndexName(key), Buffer.from('{}'));
    await expect(readPreparedMedia(key, deps)).rejects.toThrow("身份或版本损坏");
  });
  it("索引写失败不能标记为可恢复，外来桶与错片不入索引", async () => {
    const { deps } = mediaCacheFixture(); vi.mocked(deps.upload).mockRejectedValueOnce(new Error("index write failed"));
    await expect(writePreparedMedia(key, video, deps)).rejects.toThrow("index write failed");
    expect(video.reusable).toBeUndefined();
    await expect(writePreparedMedia(key, { ...video, startSec: 1 }, deps)).rejects.toThrow("来源范围");
  });
});
