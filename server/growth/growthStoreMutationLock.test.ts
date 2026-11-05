import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withGrowthStoreMutationLock } from "./growthStoreMutationLock";

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
    await fs.utimes(lock, new Date(0), new Date(0));
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

});
