import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withGrowthArchiveVerificationCache } from "./growthArchiveColdRestoreCli";

const roots: string[] = [];
async function fixture() {
  const root = await fs.mkdtemp("/tmp/growth-cold-verify-cli-test-");
  roots.push(root);
  await fs.writeFile(path.join(root, "other-task.json"), "keep");
  return root;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("archive verification CLI cache ownership", () => {
  it("concurrent success only removes its own run while failed evidence and another run survive", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const root = await fixture();
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    let active = "", failed = "", succeeded = "";
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const inFlight = withGrowthArchiveVerificationCache(root, true, async cache => {
      active = cache;
      await fs.writeFile(path.join(cache, "in-flight.json"), "active");
      started();
      await barrier;
      return "first";
    });
    await ready;
    await expect(withGrowthArchiveVerificationCache(root, true, async cache => {
      failed = cache;
      await fs.writeFile(path.join(cache, "partial-backup.bin"), "evidence");
      throw new Error("synthetic restore unavailable");
    })).rejects.toThrow("synthetic restore unavailable");
    expect(await withGrowthArchiveVerificationCache(root, true, async cache => {
      succeeded = cache;
      await fs.writeFile(path.join(cache, "verified.json"), "complete");
      return 7;
    })).toBe(7);
    expect(new Set([active, failed, succeeded]).size).toBe(3);
    expect(await fs.readFile(path.join(active, "in-flight.json"), "utf8")).toBe("active");
    expect(await fs.readFile(path.join(failed, "partial-backup.bin"), "utf8")).toBe("evidence");
    expect(JSON.parse(await fs.readFile(path.join(failed, "verification-failure.json"), "utf8")).error).toBe("synthetic restore unavailable");
    await expect(fs.stat(succeeded)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(root, "other-task.json"), "utf8")).toBe("keep");
    release();
    expect(await inFlight).toBe("first");
    await expect(fs.stat(active)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.stat(failed)).toBeTruthy();
  });

  it("cleanup disabled preserves existing cache unchanged", async () => {
    const root = await fixture();
    expect(await withGrowthArchiveVerificationCache(root, false, async cache => {
      expect(cache).toBe(root);
      return 9;
    })).toBe(9);
    expect(await fs.readFile(path.join(root, "other-task.json"), "utf8")).toBe("keep");
  });

  it("unsafe cleanup roots are rejected before doing restore work", async () => {
    const work = vi.fn();
    await expect(withGrowthArchiveVerificationCache("/data/growth", true, work)).rejects.toThrow("cleanup_root_invalid");
    expect(work).not.toHaveBeenCalled();
  });

  it("lost ownership refuses cleanup and leaves replacement owner intact", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const root = await fixture(); let retained = "";
    await expect(withGrowthArchiveVerificationCache(root, true, async cache => {
      retained = cache;
      await fs.writeFile(path.join(cache, ".verification-owner"), "other-owner");
      await fs.writeFile(path.join(cache, "other-evidence"), "keep");
    })).rejects.toThrow("cleanup_ownership_lost");
    expect(await fs.readFile(path.join(retained, "other-evidence"), "utf8")).toBe("keep");
    expect(await fs.readFile(path.join(retained, ".verification-owner"), "utf8")).toBe("other-owner");
  });
});
