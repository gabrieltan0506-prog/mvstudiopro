import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  releaseHomePhotoUpscaleLease,
  tryAcquireHomePhotoUpscaleLease,
} from "./homePhotoUpscaleLease";

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function newLeasePath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hpu-lease-test-"));
  cleanupDirs.push(dir);
  return path.join(dir, "task.lock");
}

describe("首页高清放大跨进程 lease", () => {
  it("同一任务同时只有一个进程能取得 claim，释放后才能再次取得", async () => {
    const leasePath = await newLeasePath();
    const attempts = await Promise.all(
      Array.from({ length: 12 }, () =>
        tryAcquireHomePhotoUpscaleLease({ leasePath, staleAfterMs: 60_000 }),
      ),
    );
    const acquired = attempts.filter((lease) => lease !== null);
    expect(acquired).toHaveLength(1);

    await releaseHomePhotoUpscaleLease(acquired[0]!);
    await expect(
      tryAcquireHomePhotoUpscaleLease({ leasePath, staleAfterMs: 60_000 }),
    ).resolves.not.toBeNull();
  });

  it("只接管过期 lease，且旧 token 不得删除接管后的新 lease", async () => {
    const leasePath = await newLeasePath();
    const oldLease = await tryAcquireHomePhotoUpscaleLease({
      leasePath,
      staleAfterMs: 60_000,
      nowMs: 1_000,
    });
    expect(oldLease).not.toBeNull();

    const replacement = await tryAcquireHomePhotoUpscaleLease({
      leasePath,
      staleAfterMs: 60_000,
      nowMs: 62_000,
    });
    expect(replacement).not.toBeNull();
    expect(replacement?.token).not.toBe(oldLease?.token);

    await releaseHomePhotoUpscaleLease(oldLease!);
    await expect(fs.readFile(leasePath, "utf8")).resolves.toContain(replacement!.token);
  });
});
