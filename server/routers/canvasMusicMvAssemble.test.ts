import { musicMvRenderDurationSec } from "../../shared/canvasMusicMv";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  resolve: vi.fn(),
  download: vi.fn(),
}));
vi.mock("../jobs/repository", () => ({
  createJob: mocks.create,
  getJobByIdStrict: mocks.get,
}));
vi.mock("../services/postProdMediaSource", () => ({
  resolveRegisteredPostProdMediaSource: mocks.resolve,
}));
vi.mock("../services/gcs", () => ({
  getGcsBucketName: () => "test-bucket",
  downloadGcsObjectVersioned: mocks.download,
}));
vi.mock("../services/canvasVideoTask", () => ({
  peekCanvasVideoTask: vi.fn(),
}));
import { canvasMusicMvAssembleRouter } from "./canvasMusicMvAssemble";
const requestId = "11111111-1111-4111-8111-111111111111";
const planRequestId = "22222222-2222-4222-8222-222222222222";
const audio = {
  id: "song-2",
  durationSec: 20,
  url: "https://storage.googleapis.com/test-bucket/post-prod/7/song.mp3",
  gcsUri: "gs://test-bucket/post-prod/7/song.mp3",
};
const plan = {
  version: 1 as const,
  audioId: audio.id,
  audioDurationSec: 20,
  analysisBasis: "lyrics_and_user_description" as const,
  shots: [
    {
      id: "s1",
      startSec: 0,
      endSec: 9.5,
      visualPrompt: "主角雨中回家",
      cameraPrompt: "缓慢推进",
      lyricQuote: "回家",
      referenceIndices: [],
    },
    {
      id: "s2",
      startSec: 9.5,
      endSec: 20,
      visualPrompt: "主角推开家门",
      cameraPrompt: "镜头后退",
      lyricQuote: "",
      referenceIndices: [],
    },
  ],
};
const input = {
  requestId,
  planRequestId,
  audio,
  plan,
  clips: [
    {
      shotId: "s2",
      url: "https://storage.googleapis.com/test-bucket/post-prod/7/2.mp4",
    },
    {
      shotId: "s1",
      url: "https://storage.googleapis.com/test-bucket/post-prod/7/1.mp4",
    },
  ],
};
const saved = () => ({
  plan,
  input: {
    requestId: planRequestId,
    audio,
    lyrics: "回家",
    creativePrompt: "雨中归途",
    referenceSummaries: [],
  },
});
const caller = (id?: number) =>
  canvasMusicMvAssembleRouter.createCaller({
    user: id ? { id, role: "user" } : null,
  } as TrpcContext);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue(null);
  mocks.create.mockResolvedValue(undefined);
  mocks.resolve.mockImplementation(async ({ userId, source }) => {
    const canonical = source
      .replace(
        "https://storage.googleapis.com/test-bucket/",
        "gs://test-bucket/"
      )
      .split("?")[0];
    if (!canonical.startsWith(`gs://test-bucket/post-prod/${userId}/`))
      throw new Error("not registered");
    return canonical;
  });
  mocks.download.mockImplementation(async ({ gcsUri }) => ({
    buffer: Buffer.from(
      JSON.stringify(
        gcsUri.endsWith("settled.json") ? { settled: true } : saved()
      )
    ),
  }));
});
describe("MV 合成真实 router 调用门禁", () => {
  it("未登录及伪造用户字段在仓储调用前拒绝", async () => {
    await expect(caller().queue(input)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller(7).queue({ ...input, userId: 8 } as typeof input)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("按计划顺序完整裁切，稳定 GCS 入库、旧计费合同、纯音乐且零过渡", async () => {
    const out = await caller(7).queue(input);
    expect(out.jobId).toBe(`music_mv_7_${requestId.replace(/-/g, "")}`);
    const job = mocks.create.mock.calls[0][0];
    expect(job).toMatchObject({
      userId: "7",
      type: "video",
      provider: "manhua-assemble",
    });
    expect(job.input.params).toMatchObject({
      billingContractVersion: "manhua-assemble-v1",
      musicOnly: true,
      musicUrl: audio.gcsUri,
      transition: "cut",
      musicVolume: 1,
    });
    expect(
      job.input.params.clips.map((c: any) => [
        c.clipUrl,
        c.trimInSec,
        c.trimOutSec,
      ])
    ).toEqual([
      ["gs://test-bucket/post-prod/7/1.mp4", 0, 9.5],
      ["gs://test-bucket/post-prod/7/2.mp4", 0, 10.5],
    ]);
    expect(job.input.params.expectedSegments).toHaveLength(2);
  });
  it("重复编号只读原任务；不同内容或任务归属冲突", async () => {
    await caller(7).queue(input);
    const job = mocks.create.mock.calls[0][0];
    mocks.get.mockResolvedValue(job);
    await caller(7).queue(input);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await expect(
      caller(7).queue({ ...input, resolution: "9:16" })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    mocks.get.mockResolvedValue({ ...job, userId: "8" });
    await expect(caller(7).queue(input)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
  it("并发唯一键冲突可恢复；数据库读取错误不再建单", async () => {
    await caller(7).queue(input);
    const job = mocks.create.mock.calls[0][0];
    mocks.create.mockRejectedValue(new Error("duplicate"));
    mocks.get.mockResolvedValueOnce(null).mockResolvedValueOnce(job);
    expect((await caller(7).queue(input)).jobId).toBe(job.id);
    mocks.create.mockClear();
    mocks.get.mockRejectedValue(new Error("db unavailable"));
    await expect(caller(7).queue(input)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("缺镜、重复镜、旧分镜换歌或伪造 plan 被拒", async () => {
    for (const bad of [
      { ...input, clips: input.clips.slice(0, 1) },
      { ...input, clips: [input.clips[0], input.clips[0]] },
      { ...input, audio: { ...audio, id: "new-song" } },
      {
        ...input,
        audio: { ...audio, gcsUri: "gs://test-bucket/post-prod/7/other.mp3" },
      },
      {
        ...input,
        plan: {
          ...plan,
          shots: plan.shots.map(s => ({ ...s, visualPrompt: "篡改计划" })),
        },
      },
    ])
      await expect(caller(7).queue(bad)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("未登记外部、内网、跨用户和跨桶来源不入队", async () => {
    for (const url of [
      "http://127.0.0.1/metadata",
      "https://outside.test/video",
      "https://storage.googleapis.com/test-bucket/post-prod/8/1.mp4",
      "gs://other-bucket/v.mp4",
    ]) {
      await expect(
        caller(7).queue({
          ...input,
          clips: [{ ...input.clips[0], url }, input.clips[1]],
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("未结算原分镜不能跳过分镜付费，未知比例拒绝", async () => {
    mocks.download.mockImplementation(async ({ gcsUri }) => ({
      buffer: Buffer.from(
        JSON.stringify(
          gcsUri.endsWith("settled.json") ? { settled: false } : saved()
        )
      ),
    }));
    await expect(caller(7).queue(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(
      caller(7).queue({ ...input, resolution: "1:1" } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("MV累计帧对齐", () => {
  it("十个0.53秒镜头保持总159帧，不逐镜进位到160帧", () => {
    const durations = Array.from({ length: 10 }, (_, i) =>
      musicMvRenderDurationSec({ startSec: i * 0.53, endSec: (i + 1) * 0.53 })
    );
    expect(
      durations.map(value => Math.round(value * 30)).reduce((a, b) => a + b, 0)
    ).toBe(159);
    expect(durations.reduce((a, b) => a + b, 0)).toBeCloseTo(5.3, 10);
    expect(durations.every(value => value >= 0.5)).toBe(true);
    expect(() =>
      musicMvRenderDurationSec({ startSec: 0, endSec: 0.2 })
    ).toThrow();
  });
});
