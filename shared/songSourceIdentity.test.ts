import { describe, expect, it } from "vitest";
import { canvasMusicCandidateSchema } from "./canvasMusicMedia";
import { songDemoVariantSchema } from "./canvasMusicMv";
import { mergeSongDemoSourceVariants, musicCandidateSourceIdentity } from "./songSourceIdentity";

describe("歌曲候选与Demo来源身份", () => {
  it("新操作结果保留来源操作与版本编号", () => {
    const row = { id: "edited:1", url: "https://example.test/edit.mp3", durationSec: 36, sourceOperationId: "11111111-2222-4333-8444-555555555555", sourceVariantIndex: 1 };
    expect(canvasMusicCandidateSchema.parse(row)).toEqual(row);
    expect(canvasMusicCandidateSchema.safeParse({ ...row, sourceVariantIndex: -1 }).success).toBe(false);
  });
  it("旧候选、旧Demo仍可读取；新候选保留真实变体身份", () => {
    const old = { id: "bgm-old:0", url: "https://example.test/song.mp3", durationSec: 35 };
    expect(canvasMusicCandidateSchema.parse(old)).toEqual(old);
    const identity = musicCandidateSourceIdentity("bgm-real", { index: 1, musicId: " actual-b " });
    expect(canvasMusicCandidateSchema.parse({ ...old, ...identity })).toMatchObject({ musicJobId: "bgm-real", variantIndex: 1, musicId: "actual-b" });
    const demo = { index: 0, sourceGcsUri: "gs://test/song.mp3", durationSec: 35, status: "ready" as const };
    expect(songDemoVariantSchema.parse(demo)).toEqual(demo);
    expect(songDemoVariantSchema.parse({ ...demo, musicId: "real-a" }).musicId).toBe("real-a");
    expect(musicCandidateSourceIdentity("bgm-old", { index: 0 })).not.toHaveProperty("musicId");
  });
  it("恢复不覆盖已试听音轨、缺席旧变体与已保存ID，新增变体也带ID", () => {
    const old = [{ index: 0, sourceGcsUri: "gs://test/a", durationSec: 35, status: "ready" as const, url: "https://example.test/a", musicId: "a" }, { index: 2, sourceGcsUri: "gs://test/c", durationSec: 32, status: "ready" as const }];
    const merged = mergeSongDemoSourceVariants(old, [{ index: 0, gcsUri: "gs://test/a", durationSec: 35, musicId: null }, { index: 1, gcsUri: "gs://test/b", durationSec: 36, musicId: "b" }]);
    expect(merged).toHaveLength(3);
    expect(merged[0]).toEqual(old[0]);
    expect(merged[1]).toEqual(old[1]);
    expect(merged[2]).toMatchObject({ index: 1, musicId: "b", durationSec: 36, status: "pending" });
  });
  it("相同序号不能静默覆盖不同音频", () => {
    expect(() => mergeSongDemoSourceVariants([{ index: 0, sourceGcsUri: "gs://test/a", durationSec: 35, status: "ready" }], [{ index: 0, gcsUri: "gs://test/b", durationSec: 35, musicId: "b" }])).toThrow("身份发生变化");
  });
});
