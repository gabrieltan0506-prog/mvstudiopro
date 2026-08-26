import { beforeEach, describe, expect, it, vi } from "vitest";

const child = vi.hoisted(() => ({ execFile: vi.fn() }));

vi.mock("node:child_process", () => ({ execFile: child.execFile }));

import { parseBgmVolumeDb, probeBgmLevels } from "./manhuaBgmLevelProbe";

beforeEach(() => {
  child.execFile.mockReset();
  child.execFile.mockImplementation(
    (
      _command: string,
      args: string[],
      _opts: unknown,
      callback: (
        error: null,
        result: { stdout: string; stderr: string }
      ) => void
    ) => {
      const atSec = Number(args[args.indexOf("-ss") + 1]);
      // 反序完成，断言输出仍会按时间排序。
      setTimeout(
        () =>
          callback(null, {
            stdout: "",
            stderr: `max_volume: ${-20 + atSec} dB\nmean_volume: ${-30 + atSec} dB`,
          }),
        Math.round((2 - atSec) * 2)
      );
    }
  );
});

describe("BGM 电平探针", () => {
  it("每 0.5 秒独立量测，受控并发后仍按秒位排序", async () => {
    const rows = await probeBgmLevels("/tmp/fake.mp3", { totalSec: 1.1 });
    expect(rows).toEqual([
      { atSec: 0, peakDb: -20, meanDb: -30 },
      { atSec: 0.5, peakDb: -19.5, meanDb: -29.5 },
      { atSec: 1, peakDb: -19, meanDb: -29 },
    ]);
    expect(child.execFile).toHaveBeenCalledTimes(3);
    for (const call of child.execFile.mock.calls) {
      expect(call[1]).toContain("volumedetect");
      expect(call[1]).toContain("-ss");
      expect(call[1]).toContain("-t");
    }
  });

  it("任务已中止时不启动 ffmpeg", async () => {
    const controller = new AbortController();
    controller.abort(new Error("墙钟结束"));
    await expect(
      probeBgmLevels("/tmp/fake.mp3", {
        totalSec: 20,
        abortSignal: controller.signal,
      })
    ).rejects.toThrow("墙钟结束");
    expect(child.execFile).not.toHaveBeenCalled();
  });

  it("缺失或非法量测统一按 -91dB，不产生 NaN", () => {
    expect(parseBgmVolumeDb("", "max_volume")).toBe(-91);
    expect(parseBgmVolumeDb("max_volume: -3.2 dB", "max_volume")).toBe(-3.2);
  });
});
