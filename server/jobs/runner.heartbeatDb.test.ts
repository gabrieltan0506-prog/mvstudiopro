import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({ touch: vi.fn(async () => {}) }));
vi.mock("./repository", async (load) => ({ ...(await load<Record<string, unknown>>()), touchJobRunningUpdatedAt: repo.touch }));
vi.mock("./repository.js", async (load) => ({ ...(await load<Record<string, unknown>>()), touchJobRunningUpdatedAt: repo.touch }));

import { touchJobHeartbeat } from "./runner";

describe("任务心跳落 DB（审查 P0：僵尸行清理器按 updatedAt 判死，内存心跳必须定期刷盘）", () => {
  beforeEach(() => { repo.touch.mockClear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("同一任务 60 秒内多次 touch 只刷一次 DB；过 60 秒再刷；不同任务各自计时", async () => {
    vi.setSystemTime(1_000_000);
    touchJobHeartbeat("job-a");
    touchJobHeartbeat("job-a");
    touchJobHeartbeat("job-a");
    expect(repo.touch).toHaveBeenCalledTimes(1);
    expect(repo.touch).toHaveBeenCalledWith("job-a");
    vi.setSystemTime(1_000_000 + 59_000);
    touchJobHeartbeat("job-a");
    expect(repo.touch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1_000_000 + 61_000);
    touchJobHeartbeat("job-a");
    expect(repo.touch).toHaveBeenCalledTimes(2);
    touchJobHeartbeat("job-b");
    expect(repo.touch).toHaveBeenCalledTimes(3);
    touchJobHeartbeat(null);
    touchJobHeartbeat(undefined);
    expect(repo.touch).toHaveBeenCalledTimes(3);
  });

  it("DB 刷盘失败不抛、不打断任务，下一次 touch 立刻再试", async () => {
    vi.setSystemTime(2_000_000);
    repo.touch.mockRejectedValueOnce(new Error("db down"));
    expect(() => touchJobHeartbeat("job-c")).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    touchJobHeartbeat("job-c");
    expect(repo.touch).toHaveBeenCalledTimes(2);
  });
});
