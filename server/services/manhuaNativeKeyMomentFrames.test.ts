import { describe, expect, it, vi } from "vitest";
import {
  buildNativeKeyMomentFrameArgs,
  extractNativeKeyMomentEvidenceFrames,
  mergeNativeKeyMomentsBySecond,
  type NativeKeyMomentFrameDeps,
} from "./manhuaNativeKeyMomentFrames";

const jpeg = Buffer.from([0xff, 0xd8, 0x11, 0x22, 0xff, 0xd9]);

function fakeDeps(over: Partial<NativeKeyMomentFrameDeps> = {}): NativeKeyMomentFrameDeps {
  return {
    runFfmpeg: vi.fn(async () => undefined),
    makeTempDir: vi.fn(async () => "/tmp/native-km-test"),
    readFrame: vi.fn(async () => jpeg),
    removePath: vi.fn(async () => undefined),
    uploadFrame: vi.fn(async () => ({ created: true, generation: "1" })),
    bucket: vi.fn(() => "test-bucket"),
    ...over,
  };
}

describe("正式卡关键时刻抽帧", () => {
  it("同一 0.1 秒位合并类别与说明，只上传一张并附对象 metadata", async () => {
    const deps = fakeDeps();
    const rows = await extractNativeKeyMomentEvidenceFrames({
      seriesKey: "series-1",
      episodeIndex: 2,
      sourceDigest: "a".repeat(64),
      mediaNodes: [{ url: "https://cdn.example/episode.mp4", referer: "https://example.com/" }],
      keyMoments: [
        { atSec: 10.04, kindZh: "剧情", noteZh: "发现真相" },
        { atSec: 10.03, kindZh: "情绪", noteZh: "表情骤变" },
      ],
    }, deps);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ atSec: 10, kindZh: "剧情／情绪", noteZh: "发现真相；表情骤变" });
    expect(deps.runFfmpeg).toHaveBeenCalledTimes(1);
    expect(deps.uploadFrame).toHaveBeenCalledTimes(1);
    expect(deps.uploadFrame).toHaveBeenCalledWith(expect.objectContaining({
      bucket: "test-bucket",
      contentType: "image/jpeg",
      metadata: expect.objectContaining({
        producer: "native-deep-read-key-moments",
        seriesKey: "series-1",
        episodeIndex: "2",
        atSec: "10",
        kindZh: "剧情／情绪",
        sourceDigest: "a".repeat(64),
      }),
    }));
  });

  it("快速 seek 失败后只回退一次准确 seek，参数位置确实不同", async () => {
    const calls: string[][] = [];
    const deps = fakeDeps({
      runFfmpeg: vi.fn(async (args) => {
        calls.push(args);
        if (calls.length === 1) throw new Error("fast failed");
      }),
    });
    const rows = await extractNativeKeyMomentEvidenceFrames({
      seriesKey: "series",
      episodeIndex: 1,
      mediaNodes: [{ url: "https://cdn.example/episode.mp4" }],
      keyMoments: [{ atSec: 12.3, kindZh: "剧情", noteZh: "转折" }],
    }, deps);

    expect(rows).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.indexOf("-ss")).toBeLessThan(calls[0]!.indexOf("-i"));
    expect(calls[1]!.indexOf("-ss")).toBeGreaterThan(calls[1]!.indexOf("-i"));
  });

  it("双策略都失败便省略该帧，不上传、不抛错、不生成失败行", async () => {
    const deps = fakeDeps({ runFfmpeg: vi.fn(async () => { throw new Error("bad media"); }) });
    const rows = await extractNativeKeyMomentEvidenceFrames({
      seriesKey: "series",
      episodeIndex: 1,
      mediaNodes: [{ url: "https://cdn.example/episode.mp4" }],
      keyMoments: [{ atSec: 4, kindZh: "剧情", noteZh: "转折" }],
    }, deps);
    expect(rows).toEqual([]);
    expect(deps.runFfmpeg).toHaveBeenCalledTimes(2);
    expect(deps.uploadFrame).not.toHaveBeenCalled();
  });

  it("上传失败只省略对应成功 JPEG，不阻断其他帧", async () => {
    const deps = fakeDeps({
      uploadFrame: vi.fn(async (params) => {
        if (params.metadata.atSec === "4") throw new Error("gcs unavailable");
        return { created: true };
      }),
    });
    const rows = await extractNativeKeyMomentEvidenceFrames({
      seriesKey: "series",
      episodeIndex: 1,
      mediaNodes: [{ url: "https://cdn.example/episode.mp4" }],
      keyMoments: [
        { atSec: 4, kindZh: "剧情", noteZh: "转折一" },
        { atSec: 8, kindZh: "情绪", noteZh: "转折二" },
      ],
    }, deps);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.atSec).toBe(8);
  });

  it("并发执行上限固定为 4", async () => {
    let active = 0;
    let maxActive = 0;
    const deps = fakeDeps({
      runFfmpeg: vi.fn(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      }),
    });
    const rows = await extractNativeKeyMomentEvidenceFrames({
      seriesKey: "series",
      episodeIndex: 1,
      mediaNodes: [{ url: "https://cdn.example/episode.mp4" }],
      keyMoments: Array.from({ length: 9 }, (_, index) => ({
        atSec: index,
        kindZh: "剧情",
        noteZh: `时刻${index}`,
      })),
    }, deps);
    expect(rows).toHaveLength(9);
    expect(maxActive).toBe(4);
  });
});

describe("关键时刻抽帧纯函数", () => {
  it("非法/空项不会进入同秒清单", () => {
    expect(mergeNativeKeyMomentsBySecond([
      { atSec: 1, kindZh: "剧情", noteZh: "有效" },
      { atSec: Number.NaN, kindZh: "剧情", noteZh: "坏秒位" },
      { atSec: 2, kindZh: "", noteZh: "空类别" },
    ])).toEqual([{ atSec: 1, kindZh: "剧情", noteZh: "有效" }]);
  });

  it("参数构造器不把 URL 交给 shell，并保持 seek 位置", () => {
    const fast = buildNativeKeyMomentFrameArgs({
      node: { url: "https://cdn.example/a.mp4?x=$(bad)", referer: "https://example.com/" },
      atSec: 3,
      outputPath: "/tmp/a.jpg",
      seek: "fast",
    });
    expect(fast).toContain("https://cdn.example/a.mp4?x=$(bad)");
    expect(fast.indexOf("-ss")).toBeLessThan(fast.indexOf("-i"));
  });
});
