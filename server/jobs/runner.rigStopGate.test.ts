import { afterEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({ claim: vi.fn(async () => null) }));
vi.mock("./repository", async (load) => ({
  ...(await load<Record<string, unknown>>()),
  claimNextPostProdJob: repo.claim,
}));
vi.mock("./repository.js", async (load) => ({
  ...(await load<Record<string, unknown>>()),
  claimNextPostProdJob: repo.claim,
}));

import {
  RIG_STOP_GATE_MAX_MS,
  processPostProdJobsOnce,
  releaseStaleRigStopGateIfNeeded,
  rigIdleState,
  rigStartState,
  rigStopGate,
  stopJobWorker,
} from "./runner";

describe("rig 停机闸（审查 P1：停机要跨一次网络往返，这期间不能再领单）", () => {
  afterEach(() => {
    rigStopGate.requested = false;
    rigStopGate.requestedAt = 0;
    repo.claim.mockClear();
    vi.restoreAllMocks();
  });

  it("闸没关时照常领单（反例对照：不能因为加了闸就整条通道不干活了）", async () => {
    await processPostProdJobsOnce();
    expect(repo.claim).toHaveBeenCalled();
  });

  it("停机决定一发出就不再领单；停机失败复位后恢复领单", async () => {
    rigStopGate.requested = true;
    await processPostProdJobsOnce();
    expect(repo.claim).not.toHaveBeenCalled();

    rigStopGate.requested = false;
    await processPostProdJobsOnce();
    expect(repo.claim).toHaveBeenCalled();
  });
});

describe("停机闸自愈（审查第二轮：Fly 接受了 stop 但机器没停，不能变成永远不领单的空转机）", () => {
  afterEach(() => {
    rigStopGate.requested = false;
    rigStopGate.requestedAt = 0;
    repo.claim.mockClear();
    vi.restoreAllMocks();
  });

  it("闸关了超过上限本进程还活着 → 复位，重新领单", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const t0 = 1_000_000;
    rigStopGate.requested = true;
    rigStopGate.requestedAt = t0;
    expect(releaseStaleRigStopGateIfNeeded(t0 + RIG_STOP_GATE_MAX_MS + 1)).toBe(true);
    expect(rigStopGate.requested).toBe(false);
    await processPostProdJobsOnce();
    expect(repo.claim).toHaveBeenCalled();
  });

  it("反例对照：还没到上限不许复位（否则停机在途就又开始领单，正是闸要防的事）", async () => {
    const t0 = 1_000_000;
    rigStopGate.requested = true;
    rigStopGate.requestedAt = t0;
    expect(releaseStaleRigStopGateIfNeeded(t0 + RIG_STOP_GATE_MAX_MS)).toBe(false);
    expect(rigStopGate.requested).toBe(true);
    await processPostProdJobsOnce();
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it("闸本来就没关时不做任何事", () => {
    expect(releaseStaleRigStopGateIfNeeded(Date.now() + 10 * RIG_STOP_GATE_MAX_MS)).toBe(false);
  });
});

describe("worker 生命周期复位（第四轮：跨 stopJobWorker 的状态残留）", () => {
  it("stopJobWorker 之后确认窗口清零，下一次 startJobWorker 的第一次观察不会立刻打回任务", () => {
    rigStartState.lastAttemptAt = 123;
    rigStartState.unavailableSince = 1;
    const before = rigIdleState.lastBusyAt;
    stopJobWorker();
    expect(rigStartState.unavailableSince).toBeUndefined();
    expect(rigStartState.lastAttemptAt).toBe(0);
    // 空闲计时也要跟着重开，否则重启后第一个 tick 就满足十分钟空闲直接停机
    expect(rigIdleState.lastBusyAt).toBeGreaterThanOrEqual(before);
    expect(Date.now() - rigIdleState.lastBusyAt).toBeLessThan(5_000);
  });
});
