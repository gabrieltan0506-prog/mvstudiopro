import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reclaimGrowthStoreMutationLockFromPreviousBoot, withGrowthStoreMutationLock } from "./growthStoreMutationLock";

/** Older than the 1 s stale threshold used below, but written during this boot. */
async function ageAfterBoot(file: string, ageMs = 5_000) {
  const at = new Date(Date.now() - ageMs);
  await fs.utimes(file, at, at);
}
function missingPid() {
  for (let pid = 4_000_000; pid > 3_000_000; pid -= 7919) {
    try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return pid; }
  }
  throw new Error("no free pid found");
}

describe("growth store mutation lock", () => {
  const originalStoreDir = process.env.GROWTH_STORE_DIR;
  let tempRoot = "";

  afterEach(async () => {
    if (originalStoreDir) process.env.GROWTH_STORE_DIR = originalStoreDir;
    else delete process.env.GROWTH_STORE_DIR;
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("把scheduler/backfill/恢复写入严格串行化", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "growth-mutation-lock-"));
    process.env.GROWTH_STORE_DIR = tempRoot;
    const events: string[] = [];
    let releaseFirst!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withGrowthStoreMutationLock("merge", async () => {
      events.push("merge:start");
      await held;
      events.push("merge:end");
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = withGrowthStoreMutationLock("restore", async () => {
      events.push("restore:start");
      events.push("restore:end");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(["merge:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["merge:start", "merge:end", "restore:start", "restore:end"]);
  });
});


describe("growth mutation lease failure protection", () => {
  const originalStoreDir = process.env.GROWTH_STORE_DIR;
  let root = "";
  afterEach(async () => {
    if (originalStoreDir) process.env.GROWTH_STORE_DIR = originalStoreDir; else delete process.env.GROWTH_STORE_DIR;
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  it("lost ownership rejects commit and never unlinks or renews a replacement owner", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-lease-loss-"));
    process.env.GROWTH_STORE_DIR = root;
    const lock = path.join(root, ".growth-store-mutation.lock");
    let committed = false;
    await expect(withGrowthStoreMutationLock("snapshot", async lease => {
      await fs.unlink(lock);
      await fs.writeFile(lock, JSON.stringify({ token: "other-owner", pid: process.pid }));
      await lease.assertOwned();
      committed = true;
    })).rejects.toThrow("growth_lock_ownership_lost");
    expect(committed).toBe(false);
    expect(JSON.parse(await fs.readFile(lock, "utf8")).token).toBe("other-owner");
  });
  it("does not report success when a legacy callback loses its lease", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-lease-result-"));
    process.env.GROWTH_STORE_DIR = root;
    await expect(withGrowthStoreMutationLock("legacy", async () => {
      await fs.writeFile(path.join(root, ".growth-store-mutation.lock"), '{"token":"replacement"}');
      return "success";
    })).rejects.toThrow("growth_lock_ownership_lost");
  });
  it("an old heartbeat cannot authorize stealing from a live process", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-live-owner-"));
    process.env.GROWTH_STORE_DIR = root;
    const lock = path.join(root, ".growth-store-mutation.lock");
    await fs.writeFile(lock, JSON.stringify({ token: "paused-owner", pid: process.pid }));
    await ageAfterBoot(lock);
    await expect(withGrowthStoreMutationLock("contender", async () => true, { waitTimeoutMs: 1000, staleAfterMs: 1000 })).rejects.toThrow("growth_store_mutation_lock_timeout");
    expect(JSON.parse(await fs.readFile(lock, "utf8")).token).toBe("paused-owner");
  });
  it("heartbeat loss aborts its signal and reports failure without touching the new owner", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-heartbeat-loss-"));
    process.env.GROWTH_STORE_DIR = root;
    const lock = path.join(root, ".growth-store-mutation.lock");
    let notified = 0;
    await expect(withGrowthStoreMutationLock("long-snapshot", async lease => {
      await fs.unlink(lock);
      await fs.writeFile(lock, '{"token":"new-owner"}');
      await new Promise(resolve => setTimeout(resolve, 1150));
      expect(lease.signal.aborted).toBe(true);
      return "must-not-succeed";
    }, { waitTimeoutMs: 1000, staleAfterMs: 1000, onLeaseLost: () => { notified++; } })).rejects.toThrow("growth_lock_ownership_lost");
    expect(notified).toBe(1);
    expect(JSON.parse(await fs.readFile(lock, "utf8")).token).toBe("new-owner");
  });
  it("reclaims a stale lock whose pid was reused after a reboot (different boot id)", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-reboot-stale-"));
    process.env.GROWTH_STORE_DIR = root;
    const lock = path.join(root, ".growth-store-mutation.lock");
    // Owner pid is alive right now (ours), but the lock says it came from another boot.
    await fs.writeFile(lock, JSON.stringify({ token: "pre-reboot-owner", pid: process.pid, bootId: "00000000-dead-beef-0000-000000000000", pidStartTicks: "1" }));
    await fs.utimes(lock, new Date(0), new Date(0));
    const ran = await withGrowthStoreMutationLock("contender", async () => "ran", { waitTimeoutMs: 1000, staleAfterMs: 1000 });
    expect(ran).toBe("ran");
    await expect(fs.readFile(lock, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("reclaims a stale lock whose pid number now belongs to a different process (start time differs)", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-pid-reuse-"));
    process.env.GROWTH_STORE_DIR = root;
    const lock = path.join(root, ".growth-store-mutation.lock");
    let bootId: string | null = null;
    try { bootId = (await fs.readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(); } catch {}
    if (!bootId) return; // /proc not available: covered by the boot-id test above.
    await fs.writeFile(lock, JSON.stringify({ token: "reused-pid-owner", pid: process.pid, bootId, pidStartTicks: "0" }));
    await fs.utimes(lock, new Date(0), new Date(0));
    const ran = await withGrowthStoreMutationLock("contender", async () => "ran", { waitTimeoutMs: 1000, staleAfterMs: 1000 });
    expect(ran).toBe("ran");
  });
  it("a stale-looking lock from this boot held by a live pid is still never stolen", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-live-same-boot-"));
    process.env.GROWTH_STORE_DIR = root;
    const lock = path.join(root, ".growth-store-mutation.lock");
    // Acquire once for real so the file carries our own bootId/pidStartTicks, then age it.
    let captured = "";
    await withGrowthStoreMutationLock("seed", async () => { captured = await fs.readFile(lock, "utf8"); });
    await fs.writeFile(lock, captured.replace(/"token":"[^"]+"/, '"token":"paused-owner"'));
    // 带本次开机 bootId 的锁：即使 mtime 极旧（时钟跳变/长时间无心跳）也不得按「开机前」回收。
    await fs.utimes(lock, new Date(0), new Date(0));
    await expect(withGrowthStoreMutationLock("contender", async () => true, { waitTimeoutMs: 1000, staleAfterMs: 1000 })).rejects.toThrow("growth_store_mutation_lock_timeout");
    expect(JSON.parse(await fs.readFile(lock, "utf8")).token).toBe("paused-owner");
  });

  // 2026-11-12 事故：整机异常退出后留下零字节/截断锁文件，或旧版锁无 bootId，此后每次开机都永久超时。
  it("reclaims an empty lock file older than the stale threshold", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-empty-stale-"));
    process.env.GROWTH_STORE_DIR = root;
    const lock = path.join(root, ".growth-store-mutation.lock");
    await fs.writeFile(lock, "");
    await ageAfterBoot(lock);
    expect(await withGrowthStoreMutationLock("contender", async () => "ran", { waitTimeoutMs: 1000, staleAfterMs: 1000 })).toBe("ran");
    await expect(fs.readFile(lock, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("reclaims a truncated (unparsable) lock file older than the stale threshold", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-trunc-stale-"));
    process.env.GROWTH_STORE_DIR = root;
    const lock = path.join(root, ".growth-store-mutation.lock");
    await fs.writeFile(lock, '{"token":"abc","pi');
    await ageAfterBoot(lock);
    expect(await withGrowthStoreMutationLock("contender", async () => "ran", { waitTimeoutMs: 1000, staleAfterMs: 1000 })).toBe("ran");
  });
  it("never reclaims a fresh empty lock file (owner may be between open and write)", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-empty-fresh-"));
    process.env.GROWTH_STORE_DIR = root;
    const lock = path.join(root, ".growth-store-mutation.lock");
    await fs.writeFile(lock, "");
    await expect(withGrowthStoreMutationLock("contender", async () => true, { waitTimeoutMs: 1000, staleAfterMs: 60_000 }))
      .rejects.toThrow(/growth_store_mutation_lock_timeout:contender:1000 holder=.*"bytes":0.*"parsable":false/);
    expect(await fs.readFile(lock, "utf8")).toBe("");
  });
  it("reclaims an empty lock whose mtime predates this boot without waiting for the stale threshold", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-empty-preboot-"));
    process.env.GROWTH_STORE_DIR = root;
    const lock = path.join(root, ".growth-store-mutation.lock");
    await fs.writeFile(lock, "");
    const beforeBoot = new Date(Date.now() - os.uptime() * 1000 - 10 * 60_000);
    await fs.utimes(lock, beforeBoot, beforeBoot);
    // Default 15-minute stale threshold: only the previous-boot proof can release it.
    expect(await withGrowthStoreMutationLock("contender", async () => "ran", { waitTimeoutMs: 1000 })).toBe("ran");
  });
  it("reclaims a legacy lock (no bootId) from a previous boot even though its pid number is alive now", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-legacy-preboot-"));
    process.env.GROWTH_STORE_DIR = root;
    const lock = path.join(root, ".growth-store-mutation.lock");
    await fs.writeFile(lock, JSON.stringify({ token: "legacy", pid: process.pid, operation: "merge-trend-collections" }));
    await fs.utimes(lock, new Date(0), new Date(0));
    const result = await reclaimGrowthStoreMutationLockFromPreviousBoot();
    expect(result).toMatchObject({ present: true, reclaimed: true });
    await expect(fs.readFile(lock, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("boot-time cleanup leaves a lock written during this boot by a live owner alone", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-boot-live-"));
    process.env.GROWTH_STORE_DIR = root;
    const lock = path.join(root, ".growth-store-mutation.lock");
    await fs.writeFile(lock, JSON.stringify({ token: "live", pid: process.pid, operation: "write-store" }));
    await ageAfterBoot(lock);
    expect(await reclaimGrowthStoreMutationLockFromPreviousBoot()).toMatchObject({ present: true, reclaimed: false });
    expect(JSON.parse(await fs.readFile(lock, "utf8")).token).toBe("live");
  });
  it("reclaims via differing boot id even when the mtime is after this boot", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-bootid-after-"));
    process.env.GROWTH_STORE_DIR = root;
    const lock = path.join(root, ".growth-store-mutation.lock");
    let bootId: string | null = null;
    try { bootId = (await fs.readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(); } catch {}
    if (!bootId) return;
    await fs.writeFile(lock, JSON.stringify({ token: "other-boot", pid: process.pid, bootId: "00000000-dead-beef-0000-000000000000", pidStartTicks: "1" }));
    await ageAfterBoot(lock);
    expect(await withGrowthStoreMutationLock("contender", async () => "ran", { waitTimeoutMs: 1000, staleAfterMs: 1000 })).toBe("ran");
  });
  it("reclaims a stale lock whose pid is gone in this boot (was inverted when /proc/<pid>/stat is unreadable)", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-dead-pid-"));
    process.env.GROWTH_STORE_DIR = root;
    const lock = path.join(root, ".growth-store-mutation.lock");
    let bootId: string | null = null;
    try { bootId = (await fs.readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(); } catch {}
    await fs.writeFile(lock, JSON.stringify({ token: "dead", pid: missingPid(), bootId, pidStartTicks: "123" }));
    await ageAfterBoot(lock);
    expect(await withGrowthStoreMutationLock("contender", async () => "ran", { waitTimeoutMs: 1000, staleAfterMs: 1000 })).toBe("ran");
  });
  it("timeout error names the live holder without leaking its token", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-timeout-holder-"));
    process.env.GROWTH_STORE_DIR = root;
    let release!: () => void;
    const held = withGrowthStoreMutationLock("post-prod", () => new Promise<void>(resolve => { release = resolve; }));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const error = await withGrowthStoreMutationLock("update-trend-scheduler:bilibili", async () => true, { waitTimeoutMs: 1000 })
      .catch((e: Error) => e);
    release(); await held;
    expect(String(error)).toMatch(/growth_store_mutation_lock_timeout:update-trend-scheduler:bilibili:1000 holder=/);
    const holder = JSON.parse(String((error as Error).message).split(" holder=")[1]);
    expect(holder).toMatchObject({ operation: "post-prod", pid: process.pid, parsable: true });
    expect(typeof holder.acquiredAt).toBe("string");
    expect(typeof holder.ageMs).toBe("number");
    expect(String(error)).not.toMatch(/token/);
  });
  it("removes its own lock file when writing the owner record fails", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-write-fail-"));
    process.env.GROWTH_STORE_DIR = root;
    const lock = path.join(root, ".growth-store-mutation.lock");
    const realOpen = fs.open.bind(fs);
    const spy = vi.spyOn(fs, "open").mockImplementationOnce(async (...args: Parameters<typeof fs.open>) => {
      const handle = await realOpen(...args);
      handle.writeFile = async () => { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); };
      return handle;
    });
    try {
      await expect(withGrowthStoreMutationLock("snapshot", async () => true)).rejects.toThrow("disk full");
    } finally { spy.mockRestore(); }
    await expect(fs.lstat(lock)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await withGrowthStoreMutationLock("next", async () => "ran", { waitTimeoutMs: 1000 })).toBe("ran");
  });
});

describe("growth mutation lock when boot id cannot be read", () => {
  const originalStoreDir = process.env.GROWTH_STORE_DIR;
  let root = "";
  afterEach(async () => {
    vi.restoreAllMocks(); vi.resetModules();
    if (originalStoreDir) process.env.GROWTH_STORE_DIR = originalStoreDir; else delete process.env.GROWTH_STORE_DIR;
    if (root) await fs.rm(root, { recursive: true, force: true });
  });
  async function loadWithoutBootId() {
    vi.resetModules();
    const fsSync = (await import("node:fs")).default;
    const real = fsSync.readFileSync.bind(fsSync);
    vi.spyOn(fsSync, "readFileSync").mockImplementation(((file: unknown, ...rest: unknown[]) => {
      if (String(file).includes("boot_id")) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      return (real as (...a: unknown[]) => unknown)(file, ...rest);
    }) as typeof fsSync.readFileSync);
    return import("./growthStoreMutationLock");
  }
  it("still reclaims an owner from a previous boot via mtime vs. system boot time", async () => {
    const mod = await loadWithoutBootId();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-nobootid-preboot-"));
    process.env.GROWTH_STORE_DIR = root;
    const lock = path.join(root, ".growth-store-mutation.lock");
    // pid is alive (ours) and start ticks unknown: only the boot-time proof can release it.
    await fs.writeFile(lock, JSON.stringify({ token: "old-boot", pid: process.pid, bootId: "11111111-2222-3333-4444-555555555555" }));
    await fs.utimes(lock, new Date(0), new Date(0));
    expect(await mod.withGrowthStoreMutationLock("contender", async () => "ran", { waitTimeoutMs: 1000 })).toBe("ran");
  });
  it("never reclaims a live same-pid owner written during this boot", async () => {
    const mod = await loadWithoutBootId();
    root = await fs.mkdtemp(path.join(os.tmpdir(), "growth-nobootid-live-"));
    process.env.GROWTH_STORE_DIR = root;
    const lock = path.join(root, ".growth-store-mutation.lock");
    await fs.writeFile(lock, JSON.stringify({ token: "live", pid: process.pid, bootId: "11111111-2222-3333-4444-555555555555" }));
    await ageAfterBoot(lock);
    await expect(mod.withGrowthStoreMutationLock("contender", async () => true, { waitTimeoutMs: 1000, staleAfterMs: 1000 }))
      .rejects.toThrow("growth_store_mutation_lock_timeout");
    expect(JSON.parse(await fs.readFile(lock, "utf8")).token).toBe("live");
  });
});
