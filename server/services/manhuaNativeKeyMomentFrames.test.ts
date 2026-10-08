import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  describeNativeFrameFailure,
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
  it("136分钟长片的194个时刻直接读取27个GCS分片，seek使用分片内秒位而落盘保留绝对秒位", async () => {
    const preparedSegments = Array.from({ length: 27 }, (_, i) => ({
      gsUri: `gs://test-bucket/seg-${i}.mp4`, startSec: i * 303, endSec: Math.min((i + 1) * 303, 8166),
    }));
    const keyMoments = Array.from({ length: 194 }, (_, i) => ({
      atSec: Math.round(i * 8165 / 193 * 10) / 10, kindZh: "剧情", noteZh: "长片重点时刻",
    }));
    const deps = fakeDeps({ signPreparedVideo: vi.fn(gsUri => gsUri.replace("gs://", "https://storage.example/")) });
    const rows = await extractNativeKeyMomentEvidenceFrames({
      seriesKey: "long-film", episodeIndex: 1, mediaNodes: [], preparedSegments, keyMoments,
    }, deps);
    expect(rows.map(row => row.atSec)).toEqual(keyMoments.map(row => row.atSec));
    const calls = vi.mocked(deps.runFfmpeg).mock.calls;
    expect(calls).toHaveLength(194);
    for (const [args] of calls) {
      const source = args[args.indexOf("-i") + 1]!;
      const index = Number(/seg-(\d+)/.exec(source)![1]);
      const relativeSec = Number(args[args.indexOf("-ss") + 1]);
      expect(relativeSec).toBeGreaterThanOrEqual(0);
      expect(relativeSec).toBeLessThan(preparedSegments[index]!.endSec - preparedSegments[index]!.startSec);
    }
    expect(rows.at(-1)?.atSec).toBe(8165);
  });

  it("分片边界属于下一片，缓存缺片只用原片补齐对应秒位", async () => {
    const deps = fakeDeps({ signPreparedVideo: vi.fn(() => "https://storage.example/second.mp4") });
    const rows = await extractNativeKeyMomentEvidenceFrames({
      seriesKey: "mixed", episodeIndex: 1, mediaNodes: [{ url: "https://source.example/full.mp4" }],
      preparedSegments: [{ gsUri: "gs://b/second.mp4", startSec: 303, endSec: 606 }],
      keyMoments: [302.9, 303, 605.9, 700].map(atSec => ({ atSec, kindZh: "剧情", noteZh: "边界" })),
    }, deps);
    expect(rows).toHaveLength(4);
    const calls = vi.mocked(deps.runFfmpeg).mock.calls.map(([args]) => ({
      input: args[args.indexOf("-i") + 1], seek: Number(args[args.indexOf("-ss") + 1]),
    }));
    expect(calls).toEqual(expect.arrayContaining([
      { input: "https://source.example/full.mp4", seek: 302.9 },
      { input: "https://storage.example/second.mp4", seek: 0 },
      { input: "https://storage.example/second.mp4", seek: 302.9 },
      { input: "https://source.example/full.mp4", seek: 700 },
    ]));
  });

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


describe("本地原片关键时刻证据", () => {
  const identity = { userId: "7", uploadId: "11111111-1111-4111-8111-111111111111", sha256: "a".repeat(64) };
  const sourceRef = `manhua-upload://u7/${identity.uploadId}/${identity.sha256}`;
  const base = { seriesKey: "local-series", episodeIndex: 1, mediaNodes: [], localVideoUpload: identity,
    keyMoments: [{ atSec: 1, kindZh: "动作", noteZh: "人物转身" }] };
  it("核验本人源后抽帧，保持证据非空且不清理原片", async () => {
    const localPath = "/data/private-test/source.video";
    const deps = fakeDeps({ resolveLocalUpload: vi.fn(async () => ({ sourceRef, sha256: identity.sha256, localPath })) });
    const rows = await extractNativeKeyMomentEvidenceFrames(base, deps);
    expect(rows).toHaveLength(1);
    expect(rows[0].bytes).toBeGreaterThan(0);
    expect(deps.resolveLocalUpload).toHaveBeenCalledWith(identity);
    const args = vi.mocked(deps.runFfmpeg).mock.calls[0][0];
    expect(args).toContain(localPath);
    expect(args).toContain("-protocol_whitelist");
    expect(args).not.toContain("-user_agent");
    expect(deps.removePath).not.toHaveBeenCalledWith(localPath);
    expect(JSON.stringify(rows)).not.toContain(localPath);
  });
  it("源身份改变时不抽帧、不上传", async () => {
    const deps = fakeDeps({ resolveLocalUpload: vi.fn(async () => ({ sourceRef, sha256: "b".repeat(64), localPath: "/data/private-test/source.video" })) });
    await expect(extractNativeKeyMomentEvidenceFrames(base, deps)).rejects.toThrow("来源已改变");
    expect(deps.runFfmpeg).not.toHaveBeenCalled();
    expect(deps.uploadFrame).not.toHaveBeenCalled();
  });
  it("普通节点不能指定本机路径", async () => {
    const deps = fakeDeps();
    const rows = await extractNativeKeyMomentEvidenceFrames({ ...base, localVideoUpload: undefined,
      mediaNodes: [{ url: "/data/private-test/source.video" }] }, deps);
    expect(rows).toEqual([]);
    expect(deps.runFfmpeg).not.toHaveBeenCalled();
  });
});


it("真实本地视频产生可解码JPEG，保留原片", async () => {
  const exec = promisify(execFile);
  const directory = await mkdtemp(join(tmpdir(), "local-video-frame-test-"));
  try {
    const localPath = join(directory, "source.mp4");
    await exec("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x96:rate=10:duration=2", "-c:v", "libx264", "-threads", "1", localPath]);
    const sha256 = "a".repeat(64);
    const localVideoUpload = { userId: "7", uploadId: "11111111-1111-4111-8111-111111111111", sha256 };
    const sourceRef = `manhua-upload://u7/${localVideoUpload.uploadId}/${sha256}`;
    const uploaded: Buffer[] = [];
    const deps = fakeDeps({
      resolveLocalUpload: async () => ({ sourceRef, sha256, localPath }),
      runFfmpeg: async args => { await exec("ffmpeg", args); },
      makeTempDir: () => mkdtemp(join(directory, "frames-")),
      readFrame: readFile,
      removePath: async (path, recursive = false) => { await rm(path, { force: true, recursive }); },
      uploadFrame: async ({ buffer }) => { uploaded.push(buffer); return { created: true }; },
    });
    const rows = await extractNativeKeyMomentEvidenceFrames({ seriesKey: "local-real", episodeIndex: 1,
      mediaNodes: [], localVideoUpload, keyMoments: [{ atSec: 1, kindZh: "动作", noteZh: "真实测试画面" }] }, deps);
    expect(rows).toHaveLength(1);
    expect(uploaded[0].length).toBeGreaterThan(100);
    expect(rows[0].bytes).toBe(uploaded[0].length);
    expect((await stat(localPath)).size).toBeGreaterThan(0);
  } finally { await rm(directory, { force: true, recursive: true }); }
}, 30_000);


describe("分片截图错误定位与全局并发", () => {
  it("记录失败分类但绝不泄露签名地址和凭证", () => {
    const secret = "https://storage.example/v.mp4?token=production-secret";
    expect(describeNativeFrameFailure({ message: `ffmpeg ${secret}`, stderr: "HTTP error 403 Forbidden" })).toBe("http_403");
    expect(describeNativeFrameFailure({ stderr: `Failed to resolve host ${secret}: Name or service not known` })).toBe("dns");
    expect(describeNativeFrameFailure({ killed: true, message: secret })).toBe("timeout");
    expect(describeNativeFrameFailure({ message: secret })).toBe("unknown");
  });

  it("多分片同时抽帧也最多四个ffmpeg，不按分片倍增", async () => {
    let active = 0;
    let peak = 0;
    const deps = fakeDeps({ runFfmpeg: vi.fn(async () => {
      active += 1; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active -= 1;
    }) });
    await Promise.all(Array.from({ length: 3 }, (_, segmentIndex) => extractNativeKeyMomentEvidenceFrames({
      seriesKey: "s", episodeIndex: 1, mediaNodes: [{ url: "https://example.com/v.mp4" }],
      keyMoments: Array.from({ length: 7 }, (_, i) => ({ atSec: segmentIndex * 300 + i, kindZh: "剧情", noteZh: "转折" })),
    }, deps)));
    expect(peak).toBe(4);
    expect(deps.runFfmpeg).toHaveBeenCalledTimes(21);
  });
});
