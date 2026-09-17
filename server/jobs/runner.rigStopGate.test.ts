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
  rigStopGate,
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
