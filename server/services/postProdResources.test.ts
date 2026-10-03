import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  available: 6 * 1024 * 1024 * 1024, disk: 4 * 1024 * 1024 * 1024,
  release: vi.fn(async () => {}),
  begin: vi.fn(), collection: vi.fn(), mutation: vi.fn(),
}));
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
  mocks.available = 6 * 1024 ** 3; mocks.disk = 4 * 1024 ** 3;
  mocks.release.mockResolvedValue(undefined);
  mocks.begin.mockResolvedValue(mocks.release);
  mocks.collection.mockImplementation((_s, _lost, work) => work());
  mocks.mutation.mockImplementation((_name, work) => work());
  vi.stubEnv("JOB_WORKER_ROLE", "app");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
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
