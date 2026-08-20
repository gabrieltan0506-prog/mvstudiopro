/**
 * 后期工坊 worker 分派测试:
 * - worker 对旧任务数据用统一 Schema 再解析(缺 params/未知 action/多余字段都拒);
 * - 三个 action 各自落到对应服务函数并带上 AbortSignal;
 * - runWithTaskLimit 时限到 abort 且只执行一次,不重做。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const concatClips = vi.fn(async (..._args: unknown[]) => ({ kind: "concat" }));
const mountBgm = vi.fn(async (..._args: unknown[]) => ({ kind: "bgm" }));
const loudnessCheck = vi.fn(async (..._args: unknown[]) => ({ kind: "loudness" }));

vi.mock("../services/postProduction", () => ({
  concatClips: (a: unknown, b: unknown, c: unknown) => concatClips(a, b, c),
  mountBgm: (a: unknown, b: unknown, c: unknown) => mountBgm(a, b, c),
  loudnessCheck: (a: unknown, b: unknown) => loudnessCheck(a, b),
}));

import { processPostProdJob, runWithTaskLimit } from "./postProdJob";

describe("processPostProdJob 强 Schema 分派", () => {
  beforeEach(() => {
    concatClips.mockClear();
    mountBgm.mockClear();
    loudnessCheck.mockClear();
  });

  it("concat:worker 再解析旧任务数据并补默认值,signal 透传", async () => {
    const signal = new AbortController().signal;
    const res = await processPostProdJob(
      { action: "concat", params: { clips: ["gs://b/a.mp4", "gs://b/b.mp4"] } },
      "u1",
      { signal },
    );
    expect(concatClips).toHaveBeenCalledTimes(1);
    const [params, userId, options] = concatClips.mock.calls[0] as [
      { clips: string[]; width: number; height: number; fps: number },
      string,
      { signal?: AbortSignal },
    ];
    // 默认值由 Schema 统一整理,不靠服务层兜
    expect(params).toEqual({
      clips: ["gs://b/a.mp4", "gs://b/b.mp4"],
      width: 1280,
      height: 720,
      fps: 30,
    });
    expect(userId).toBe("u1");
    expect(options.signal).toBe(signal);
    expect(res).toEqual({ output: { kind: "concat" }, provider: "ffmpeg-post-prod" });
  });

  it("bgm_mount → mountBgm,默认音量/淡入淡出补齐", async () => {
    await processPostProdJob(
      { action: "bgm_mount", params: { videoUri: "gs://b/v.mp4", bgmUri: "gs://b/m.mp3" } },
      "u2",
    );
    const [params] = mountBgm.mock.calls[0] as [Record<string, unknown>];
    expect(params).toMatchObject({ bgmVolume: 0.48, entrySec: 0, fadeInSec: 0.5, fadeOutSec: 1 });
  });

  it("loudness_check → loudnessCheck,不带 userId", async () => {
    await processPostProdJob(
      { action: "loudness_check", params: { videoUri: "gs://b/v.mp4" } },
      "u3",
    );
    expect(loudnessCheck).toHaveBeenCalledTimes(1);
    const [params] = loudnessCheck.mock.calls[0] as [Record<string, unknown>];
    expect(params).toEqual({ videoUri: "gs://b/v.mp4", windows: [] });
  });

  it("未知 action 被 Schema 拒绝,不静默", async () => {
    await expect(processPostProdJob({ action: "nope", params: {} }, "u4")).rejects.toThrow();
    expect(concatClips).not.toHaveBeenCalled();
  });

  it("缺少 params 返回输入错误,不创建处理", async () => {
    await expect(processPostProdJob({ action: "concat" }, "u5")).rejects.toThrow();
    expect(concatClips).not.toHaveBeenCalled();
  });

  it("多余字段(strict)与超范围数值都拒", async () => {
    await expect(
      processPostProdJob(
        { action: "concat", params: { clips: ["gs://b/a.mp4", "gs://b/b.mp4"], evil: 1 } },
        "u6",
      ),
    ).rejects.toThrow();
    await expect(
      processPostProdJob(
        { action: "concat", params: { clips: ["gs://b/a.mp4", "gs://b/b.mp4"], fps: 999 } },
        "u6",
      ),
    ).rejects.toThrow();
  });
});

describe("runWithTaskLimit", () => {
  it("时限到 abort,操作只执行一次,不自动重做", async () => {
    let calls = 0;
    let sawAbort = false;
    await expect(
      runWithTaskLimit(30, (signal) => {
        calls += 1;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            sawAbort = true;
            reject(signal.reason ?? new Error("aborted"));
          });
        });
      }),
    ).rejects.toThrow(/timed out/);
    expect(calls).toBe(1);
    expect(sawAbort).toBe(true);
  });

  it("按时完成不受影响", async () => {
    const out = await runWithTaskLimit(5_000, async () => "done");
    expect(out).toBe("done");
  });
});
