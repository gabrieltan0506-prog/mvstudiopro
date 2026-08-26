import { beforeEach, describe, expect, it, vi } from "vitest";

const upstream = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  pick: vi.fn(),
}));
const storage = vi.hoisted(() => ({ upload: vi.fn(), sign: vi.fn() }));
const levels = vi.hoisted(() => ({ probe: vi.fn() }));

vi.mock("./evolinkSunoMusic.js", () => ({
  createEvolinkSunoTask: upstream.create,
  getEvolinkSunoTask: upstream.get,
  pickEvolinkSunoAudioUrls: upstream.pick,
}));
vi.mock("./gcs.js", () => ({
  uploadBufferToGcs: storage.upload,
  signGsUriV4ReadUrl: storage.sign,
}));
vi.mock("./postProdMediaSource.js", () => ({
  postProdOutputPrefix: (userId: string) => `post-prod/${userId}/`,
}));
vi.mock("./manhuaBgmLevelProbe.js", () => ({
  probeBgmLevels: levels.probe,
}));
vi.mock("node:child_process", async loadOriginal => {
  const actual = await loadOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: (
      _command: string,
      _args: string[],
      _options: unknown,
      callback: (
        error: null,
        result: { stdout: string; stderr: string }
      ) => void
    ) => callback(null, { stdout: "audio\n", stderr: "" }),
  };
});

import {
  buildBgmMountParamsFromScoring,
  createManhuaBgmTask,
  readBgmAudioWithLimit,
  resumeManhuaBgmTask,
  scoringBgmObjectName,
} from "./manhuaScoringRoom";
import { bgmMountParamsSchema } from "../jobs/postProdInput";

const brief = {
  model: "suno-v5.5-beta" as const,
  custom_mode: true as const,
  instrumental: true as const,
  style: "压抑积压，低音弦乐由疏到密",
  prompt: "[Intro]\n[Build]\n[End]",
  title: "悬疑权谋·配乐",
  duration: 21,
  negative_tags: "vocals, singing",
  style_weight: 0.78,
  weirdness_constraint: 0.25,
};

function fakeAudioResponse(
  bytes: Uint8Array,
  contentLength?: string
): Response {
  let sent = false;
  return {
    ok: true,
    status: 200,
    headers: {
      get: (key: string) =>
        key.toLowerCase() === "content-length" ? (contentLength ?? null) : null,
    },
    body: {
      getReader: () => ({
        read: async () =>
          sent
            ? { done: true, value: undefined }
            : ((sent = true), { done: false, value: bytes }),
        cancel: async () => {},
      }),
    },
  } as unknown as Response;
}

beforeEach(() => {
  upstream.create.mockReset();
  upstream.get.mockReset();
  upstream.pick.mockReset();
  storage.upload.mockReset();
  storage.sign.mockReset();
  levels.probe.mockReset();
  storage.upload.mockImplementation(async (input: { objectName: string }) => ({
    gcsUri: `gs://bucket/${input.objectName}`,
  }));
  storage.sign.mockImplementation((gcsUri: string) => `${gcsUri}?signed=1`);
  levels.probe.mockResolvedValue([
    { atSec: 0, peakDb: -20, meanDb: -30 },
    { atSec: 0.5, peakDb: -5, meanDb: -18 },
  ]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => fakeAudioResponse(new Uint8Array([1, 2, 3])))
  );
});

describe("漫剧配乐建单与恢复", () => {
  it("建单只发一次 POST，返回 task ID 与内容摘要供严格持久化", async () => {
    upstream.create.mockResolvedValue({ id: "task-1" });
    const controller = new AbortController();
    const result = await createManhuaBgmTask(brief, {
      abortSignal: controller.signal,
    });
    expect(result.taskId).toBe("task-1");
    expect(result.briefDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(upstream.create).toHaveBeenCalledTimes(1);
    expect(upstream.create.mock.calls[0]![1].abortSignal).toBe(
      controller.signal
    );
  });

  it("恢复只轮询既有 task，绝不再次建单", async () => {
    upstream.get.mockResolvedValue({ task: { status: "completed" }, raw: {} });
    upstream.pick.mockReturnValue(["https://cdn.example/one"]);
    await resumeManhuaBgmTask({
      taskId: "task-1",
      userId: "42",
      brief,
      pollIntervalMs: 1,
    });
    expect(upstream.create).not.toHaveBeenCalled();
    expect(upstream.get).toHaveBeenCalledWith("task-1", {
      abortSignal: undefined,
    });
  });

  it("所有变体逐条验真后立即转存本人 post-prod 前缀，并保留结构", async () => {
    upstream.get.mockResolvedValue({ task: { status: "completed" }, raw: {} });
    upstream.pick.mockReturnValue([
      "https://cdn.example/one",
      "https://cdn.example/two",
    ]);
    const result = await resumeManhuaBgmTask({
      taskId: "task/unsafe",
      userId: "42",
      brief,
      pollIntervalMs: 1,
    });
    expect(result.variants).toHaveLength(2);
    expect(storage.upload).toHaveBeenCalledTimes(2);
    expect(storage.upload.mock.calls[0]![0].objectName).toMatch(
      /^post-prod\/42\/bgm\/taskunsafe-[a-f0-9]{10}-v0\.mp3$/
    );
    expect(storage.upload.mock.calls[1]![0].objectName).toMatch(/-v1\.mp3$/);
    expect(result.variants[0]!.gcsUri).toContain("post-prod/42/bgm/");
    expect(result.variants[1]!.structure?.strongestAtSec).toBe(0.5);
    expect(levels.probe).toHaveBeenCalledTimes(2);
    // 耗时的逐窗电平分析开始前，两个 72h 临时变体都已经落进 GCS。
    expect(storage.upload.mock.invocationCallOrder[1]).toBeLessThan(
      levels.probe.mock.invocationCallOrder[0]!
    );
  });

  it("AbortSignal 贯穿轮询、下载与 GCS 上传", async () => {
    upstream.get.mockResolvedValue({ task: { status: "completed" }, raw: {} });
    upstream.pick.mockReturnValue(["https://cdn.example/one"]);
    const controller = new AbortController();
    await resumeManhuaBgmTask({
      taskId: "task-1",
      userId: "42",
      brief,
      abortSignal: controller.signal,
      pollIntervalMs: 1,
    });
    expect(upstream.get.mock.calls[0]![1].abortSignal).toBe(controller.signal);
    expect(vi.mocked(fetch).mock.calls[0]![1]?.signal).toBe(controller.signal);
    expect(storage.upload.mock.calls[0]![0].signal).toBe(controller.signal);
  });

  it("量测期间中止不能被可降级兜底吞掉", async () => {
    upstream.get.mockResolvedValue({ task: { status: "completed" }, raw: {} });
    upstream.pick.mockReturnValue(["https://cdn.example/one"]);
    const controller = new AbortController();
    levels.probe.mockImplementation(async () => {
      controller.abort(new Error("任务墙钟结束"));
      throw new Error("ffmpeg aborted");
    });
    await expect(
      resumeManhuaBgmTask({
        taskId: "task-1",
        userId: "42",
        brief,
        abortSignal: controller.signal,
        pollIntervalMs: 1,
      })
    ).rejects.toThrow("任务墙钟结束");
  });

  it("上游终态失败、空变体与缺会话用户都关闭式报错", async () => {
    upstream.get.mockResolvedValue({ task: { status: "failed" }, raw: {} });
    await expect(
      resumeManhuaBgmTask({
        taskId: "task-1",
        userId: "42",
        brief,
        pollIntervalMs: 1,
      })
    ).rejects.toThrow("failed");

    upstream.get.mockResolvedValue({ task: { status: "completed" }, raw: {} });
    upstream.pick.mockReturnValue([]);
    await expect(
      resumeManhuaBgmTask({
        taskId: "task-1",
        userId: "42",
        brief,
        pollIntervalMs: 1,
      })
    ).rejects.toThrow("没有音频地址");
    await expect(
      resumeManhuaBgmTask({ taskId: "task-1", userId: " ", brief })
    ).rejects.toThrow("会话用户");
  });
});

describe("下载限额与对象命名", () => {
  it("content-length 超限与空文件都拒收", async () => {
    await expect(
      readBgmAudioWithLimit(fakeAudioResponse(new Uint8Array([1]), "999999999"))
    ).rejects.toThrow("超过处理上限");
    await expect(
      readBgmAudioWithLimit(fakeAudioResponse(new Uint8Array()))
    ).rejects.toThrow("为空");
  });

  it("对象名对清洗碰撞加入 task 摘要，并拒绝无 task ID", () => {
    expect(scoringBgmObjectName("42", "a/b", 0)).not.toBe(
      scoringBgmObjectName("42", "ab", 0)
    );
    expect(() => scoringBgmObjectName("42", " ", 0)).toThrow("任务号");
    expect(() => scoringBgmObjectName("42", "task", -1)).toThrow("序号");
  });
});

describe("配乐结果 → bgm_mount 卡点参数", () => {
  const bgm = { gcsUri: "gs://bucket/post-prod/42/bgm/one.mp3" };
  const structure = {
    strongestAtSec: 2,
    strongestPeakDb: -1,
    valleyAtSec: 5,
    valleyMeanDb: -30,
    decayStartSec: 8,
    totalSec: 10,
  };

  it("有真实事件与结构时统一编译 alignment、seek 与 volumeExpr", () => {
    const params = buildBgmMountParamsFromScoring({
      videoUri: "gs://bucket/post-prod/42/video.mp4",
      bgm,
      structure,
      filmDurationSec: 12,
      events: [
        { atSec: 6, kind: "断裂点", descZh: "刀落" },
        { atSec: 8, durationSec: 1, kind: "静音停顿", descZh: "全场静止" },
      ],
    });
    expect(params.entrySec).toBe(4);
    expect(params.bgmSeekSec).toBe(0);
    expect(params.volumeExpr).toContain("between(t,8,9),0");
    expect(params.fadeInSec).toBe(0.5);
    expect(params.fadeOutSec).toBe(1);
    expect(() => bgmMountParamsSchema.parse(params)).not.toThrow();
  });

  it("最强击点比画面晚时输出曲内 seek，不产生负入点", () => {
    const params = buildBgmMountParamsFromScoring({
      videoUri: "gs://bucket/post-prod/42/video.mp4",
      bgm,
      structure: { ...structure, strongestAtSec: 7 },
      filmDurationSec: 12,
      events: [{ atSec: 3, kind: "断裂点", descZh: "刀落" }],
    });
    expect(params.entrySec).toBe(0);
    expect(params.bgmSeekSec).toBe(4);
  });

  it("旧调用没有 events 时惰性保持手填入点，seek=0 且不制造空表达式", () => {
    const params = buildBgmMountParamsFromScoring({
      videoUri: "gs://bucket/post-prod/42/video.mp4",
      bgm,
      entrySec: 2,
    });
    expect(params.entrySec).toBe(2);
    expect(params.bgmSeekSec).toBe(0);
    expect("volumeExpr" in params).toBe(false);
  });
});
