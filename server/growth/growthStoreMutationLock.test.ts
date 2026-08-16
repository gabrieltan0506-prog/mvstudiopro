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

