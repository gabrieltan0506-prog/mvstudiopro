/**
 * 后期工坊 worker 测试:
 * - worker 对旧任务数据用统一 Schema 再解析(缺 params/未知 action/extraField/奇数尺寸都拒);
 * - worker 执行前调用 resolvePostProdInputSources 重新核对素材登记约束;
 * - 三个 action 各自落到对应服务函数并带上 AbortSignal;
 * - runWithTaskLimit:不读取 signal 的 operation 也在任务时限附近结束等待,
 *   operation 只执行一次,不重做。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const concatClips = vi.fn(async (..._args: unknown[]) => ({ kind: "concat" }));
const mountBgm = vi.fn(async (..._args: unknown[]) => ({ kind: "bgm" }));
const loudnessCheck = vi.fn(async (..._args: unknown[]) => ({ kind: "loudness" }));
const resolvePostProdInputSources = vi.fn(async ({ input }: { input: unknown }) => input);

vi.mock("../services/postProduction", () => ({
  concatClips: (a: unknown, b: unknown, c: unknown) => concatClips(a, b, c),
  mountBgm: (a: unknown, b: unknown, c: unknown) => mountBgm(a, b, c),
  loudnessCheck: (a: unknown, b: unknown) => loudnessCheck(a, b),
}));

vi.mock("../services/postProdMediaSource", () => ({
  resolvePostProdInputSources: (args: { input: unknown }) => resolvePostProdInputSources(args),
}));

import { processPostProdJob, runWithTaskLimit } from "./postProdJob";

describe("processPostProdJob 强 Schema 分派", () => {
  beforeEach(() => {
    concatClips.mockClear();
    mountBgm.mockClear();
    loudnessCheck.mockClear();
    resolvePostProdInputSources.mockClear();
  });

  it("worker 执行前调用 resolvePostProdInputSources 重新核对素材登记约束", async () => {
    await processPostProdJob(
      { action: "concat", params: { clips: ["gs://b/a.mp4", "gs://b/b.mp4"] } },
      "u1",
    );
    expect(resolvePostProdInputSources).toHaveBeenCalledTimes(1);
    expect(resolvePostProdInputSources.mock.calls[0][0]).toMatchObject({ userId: "u1" });
  });

  it("concat:再解析旧任务数据并补默认值,signal 透传", async () => {
    const signal = new AbortController().signal;
    const res = await processPostProdJob(
      { action: "concat", params: { clips: ["gs://b/a.mp4", "gs://b/b.mp4"] } },
      "u1",
      { signal },
    );
    const [params, userId, options] = concatClips.mock.calls[0] as [
      { clips: string[]; width: number; height: number; fps: number },
      string,
      { signal?: AbortSignal },
    ];
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
    expect(params).toMatchObject({
      bgmVolume: 0.48,
      entrySec: 0,
      bgmSeekSec: 0,
      fadeInSec: 0.5,
      fadeOutSec: 1,
    });
  });

  it("loudness_check → loudnessCheck,不带 userId", async () => {
    await processPostProdJob(
      { action: "loudness_check", params: { videoUri: "gs://b/v.mp4" } },
      "u3",
    );
    const [params] = loudnessCheck.mock.calls[0] as [Record<string, unknown>];
    expect(params).toEqual({ videoUri: "gs://b/v.mp4", windows: [] });
  });

  it("未知 action 被 Schema 拒绝", async () => {
    await expect(processPostProdJob({ action: "nope", params: {} }, "u4")).rejects.toThrow();
    expect(concatClips).not.toHaveBeenCalled();
  });

  it("缺少 params 返回输入提示,不进入媒体处理", async () => {
    await expect(processPostProdJob({ action: "concat" }, "u5")).rejects.toThrow();
    expect(concatClips).not.toHaveBeenCalled();
    expect(resolvePostProdInputSources).not.toHaveBeenCalled();
  });

  it("extraField(strict)与超范围数值都拒", async () => {
    await expect(
      processPostProdJob(
        { action: "concat", params: { clips: ["gs://b/a.mp4", "gs://b/b.mp4"], extraField: 1 } },
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

  it("画面宽高必须为偶数,奇数在 Schema 层返回输入提示", async () => {
    await expect(
      processPostProdJob(
        {
          action: "concat",
          params: { clips: ["gs://b/a.mp4", "gs://b/b.mp4"], width: 321, height: 721 },
        },
        "7",
      ),
    ).rejects.toThrow(/必须为偶数/);
    expect(concatClips).not.toHaveBeenCalled();
  });
});

describe("runWithTaskLimit", () => {
  it("读取 signal 的 operation:时限到 abort,只执行一次,不自动重做", async () => {
    let calls = 0;
    let sawAbort = false;
    await expect(
      runWithTaskLimit(30, (signal) => {
        calls += 1;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            sawAbort = true;
            reject(signal.reason ?? new DOMException("任务时限结束", "AbortError"));
          });
        });
      }),
    ).rejects.toThrow(/timed out/);
    expect(calls).toBe(1);
    expect(sawAbort).toBe(true);
  });

  it("到达任务时限后立即结束等待:不读取 signal 的 operation 也不拖延", async () => {
    const started = Date.now();
    await expect(
      runWithTaskLimit(20, async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "late";
      }),
    ).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(80);
  });

  it("worker 不重新执行同一媒体任务:时限拒绝后 operation 调用数仍为 1", async () => {
    let calls = 0;
    await expect(
      runWithTaskLimit(20, async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 60));
        return "late";
      }),
    ).rejects.toThrow(/timed out/);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(calls).toBe(1);
  });

  it("按时完成不受影响", async () => {
    const out = await runWithTaskLimit(5_000, async () => "done");
    expect(out).toBe("done");
  });
});
