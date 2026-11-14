import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  available: 6 * 1024 * 1024 * 1024, disk: 4 * 1024 * 1024 * 1024,
  release: vi.fn(async () => {}),
  begin: vi.fn(), collection: vi.fn(), mutation: vi.fn(),
  delay: undefined as undefined | ((ms: number) => Promise<void>),
}));
vi.mock("node:timers/promises", async (orig) => {
  const real = await orig<typeof import("node:timers/promises")>();
  return { ...real, setTimeout: (ms: number, value?: unknown, options?: { signal?: AbortSignal }) =>
    mocks.delay ? mocks.delay(ms).then(() => value) : real.setTimeout(ms, value, options) };
});
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (file: string) => {
    if (file === "/proc/meminfo") return `MemAvailable: ${mocks.available / 1024} kB`;
    if (file.endsWith("memory.max")) return "max";
    if (file.endsWith("memory.current")) return "0";
    return "";
  }),
  statfs: async () => ({ bavail: mocks.disk, bsize: 1 }),
}));
vi.mock("../growth/growthWorkloadPriority", () => ({ beginGrowthInteractiveWorkload: (...a: unknown[]) => mocks.begin(...a) }));
vi.mock("../growth/platformCollectionLane", () => ({ withGrowthCollectionExclusive: (...a: unknown[]) => mocks.collection(...a) }));
vi.mock("../growth/growthStoreMutationLock", () => ({ withGrowthStoreMutationLock: (...a: unknown[]) => mocks.mutation(...a) }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.available = 6 * 1024 ** 3; mocks.disk = 4 * 1024 ** 3; mocks.delay = undefined;
  mocks.release.mockResolvedValue(undefined);
  mocks.begin.mockResolvedValue(mocks.release);
  mocks.collection.mockImplementation((_s, _lost, work) => work());
  mocks.mutation.mockImplementation((_name, work) => work());
  vi.stubEnv("JOB_WORKER_ROLE", "app");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("post-production resource ownership", () => {
  it("serializes jobs and releases the next waiter even if priority cleanup fails", async () => {
    const { withPostProdResources } = await import("./postProdResources");
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const starts: number[] = [];
    const signal = new AbortController().signal;
    mocks.release.mockRejectedValueOnce(new Error("lease filesystem unavailable"));
    const a = withPostProdResources("a", signal, { phase: "new" }, async () => { starts.push(1); await gate; return "a"; });
    const b = withPostProdResources("b", signal, { phase: "new" }, async () => { starts.push(2); return "b"; });
    await vi.waitFor(() => expect(starts).toEqual([1])); finish();
    expect(await Promise.all([a, b])).toEqual(["a", "b"]);
    expect(starts).toEqual([1, 2]);
    expect(mocks.collection).toHaveBeenCalledTimes(2);
    expect(mocks.mutation).toHaveBeenCalledTimes(2);
  });
  it("cancelled queued job never starts and cannot let a later job overtake the owner", async () => {
    const { withPostProdResources } = await import("./postProdResources");
    let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve; });
    const run = vi.fn(async () => {}); const signal = new AbortController().signal;
    const a = withPostProdResources("a", signal, { phase: "new" }, () => gate);
    const cancelled = new AbortController();
    const b = withPostProdResources("b", cancelled.signal, { phase: "new" }, run);
    const rejected = expect(b).rejects.toThrow("cancel queue");
    const c = withPostProdResources("c", signal, { phase: "new" }, run);
    cancelled.abort(new Error("cancel queue"));
    await vi.waitFor(() => expect(mocks.collection).toHaveBeenCalledTimes(1));
    expect(run).not.toHaveBeenCalled(); finish();
    await a; await rejected; await c; expect(run).toHaveBeenCalledTimes(1);
  });
  it("does not begin media with insufficient disk", async () => {
    const { withPostProdResources } = await import("./postProdResources");
    mocks.disk = 1024;
    const work = vi.fn();
    await expect(withPostProdResources("small-disk", new AbortController().signal, { phase: "new" }, work)).rejects.toThrow("2.5GiB");
    expect(work).not.toHaveBeenCalled(); expect(mocks.release).toHaveBeenCalledOnce();
  });
  it("never idles on memory while holding the growth locks; releases them and waits outside", async () => {
    const { withPostProdResources } = await import("./postProdResources");
    let held = 0; const timeline: string[] = [];
    let now = 1_000_000; vi.spyOn(Date, "now").mockImplementation(() => now);
    // Scripted memory: short for 3 polls outside any lock -> recovers -> drops again right after the
    // first lock acquisition (stays short until the bounded in-lock wait gives up) -> recovers after release.
    let outsideWaits = 0; let acquisitions = 0;
    mocks.delay = async (ms: number) => {
      now += ms;
      timeline.push(`${held ? "locked" : "unlocked"}-wait`);
      if (!held && (++outsideWaits >= 3)) mocks.available = 6 * 1024 ** 3;
    };
    mocks.available = 1024 ** 3;
    mocks.mutation.mockImplementation(async (_name, work) => {
      acquisitions++; held++;
      if (acquisitions === 1) mocks.available = 1024 ** 3;
      try { return await work(); } finally { held--; timeline.push("released"); }
    });
    const work = vi.fn(async () => "done");
    expect(await withPostProdResources("low-mem", new AbortController().signal, { phase: "new" }, work)).toBe("done");
    expect(acquisitions).toBe(2);
    expect(work).toHaveBeenCalledTimes(1);
    // Waited outside before taking any lock; the in-lock wait was bounded (<= 60 s of 5 s polls) and then released.
    expect(timeline.slice(0, 3)).toEqual(["unlocked-wait", "unlocked-wait", "unlocked-wait"]);
    const lockedWaits = timeline.filter(t => t === "locked-wait").length;
    expect(lockedWaits).toBeGreaterThan(0);
    expect(lockedWaits).toBeLessThanOrEqual(12);
    expect(timeline.indexOf("released")).toBeGreaterThan(timeline.indexOf("locked-wait"));
    expect(held).toBe(0);
  });
  it("app machine: no priority lease while waiting for memory outside the locks", async () => {
    const { withPostProdResources } = await import("./postProdResources");
    let waits = 0; let leaseHeldDuringOutsideWait = false; let leased = false;
    mocks.begin.mockImplementation(async () => { leased = true; return async () => { leased = false; }; });
    mocks.available = 1024 ** 3;
    mocks.delay = async () => { if (leased) leaseHeldDuringOutsideWait = true; if (++waits >= 3) mocks.available = 6 * 1024 ** 3; };
    const work = vi.fn(async () => { expect(leased).toBe(true); return "done"; });
    expect(await withPostProdResources("lease-order", new AbortController().signal, { phase: "new" }, work)).toBe("done");
    expect(waits).toBe(3);
    expect(leaseHeldDuringOutsideWait).toBe(false);
    expect(mocks.begin).toHaveBeenCalledTimes(1);
    expect(leased).toBe(false);
  });
  it("lease loss aborts only the protected task and waits for its cleanup", async () => {
    const { withPostProdResources } = await import("./postProdResources");
    let lose!: () => void;
    mocks.collection.mockImplementation((_signal, onLost, work) => { lose = onLost; return work(); });
    let cleaned = false;
    const pending = withPostProdResources("lease", new AbortController().signal, { phase: "new" }, signal => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => { setTimeout(() => { cleaned = true; reject(signal.reason); }, 10); });
    }));
    const rejected = expect(pending).rejects.toThrow("租约续期失败");
    await vi.waitFor(() => expect(lose).toBeTypeOf("function"));
    // Ensure the work has installed its listener after the asynchronous budget check.
    await new Promise(resolve => setTimeout(resolve, 10)); lose();
    expect(mocks.release).not.toHaveBeenCalled();
    await rejected; expect(cleaned).toBe(true); expect(mocks.release).toHaveBeenCalledOnce();
  });
});

it("工作机两项学习同时进入，后期独占任务等两项收尾再进入", async () => {
  vi.stubEnv("JOB_WORKER_ROLE", "rig");
  const { withPostProdResources, postProdResourcesBusy } = await import("./postProdResources");
  let endA!: () => void, endB!: () => void;
  const aGate = new Promise<void>(r => { endA = r; }); const bGate = new Promise<void>(r => { endB = r; });
  const starts: string[] = [];
  const signal = new AbortController().signal;
  const a = withPostProdResources("a", signal, { phase: "new" }, async () => { starts.push("a"); await aGate; }, { parallelLearning: true });
  const b = withPostProdResources("b", signal, { phase: "new" }, async () => { starts.push("b"); await bGate; }, { parallelLearning: true });
  const exclusive = withPostProdResources("post", signal, { phase: "new" }, async () => { starts.push("post"); });
  await vi.waitFor(() => expect(starts).toEqual(["a", "b"]));
  endA(); await a; expect(postProdResourcesBusy()).toBe(true); expect(starts).toEqual(["a", "b"]);
  endB(); await b; await exclusive; expect(starts).toEqual(["a", "b", "post"]); expect(postProdResourcesBusy()).toBe(false);
});
it("网站机不能开启并发媒体重处理", async () => {
  const { withPostProdResources } = await import("./postProdResources");
  const work = vi.fn();
  await expect(withPostProdResources("forbidden", new AbortController().signal, { phase: "new" }, work, { parallelLearning: true })).rejects.toThrow("仅允许在工作机");
  expect(work).not.toHaveBeenCalled();
});
