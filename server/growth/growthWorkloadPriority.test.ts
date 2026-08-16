import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_STORE_DIR = process.env.GROWTH_STORE_DIR;

describe("growth interactive workload priority", () => {
  let tempRoot = "";

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "growth-priority-"));
    process.env.GROWTH_STORE_DIR = tempRoot;
  });

  afterEach(async () => {
    if (ORIGINAL_STORE_DIR) process.env.GROWTH_STORE_DIR = ORIGINAL_STORE_DIR;
    else delete process.env.GROWTH_STORE_DIR;
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("前台平台任务运行期间为真，结束后立即释放", async () => {
    const {
      beginGrowthInteractiveWorkload,
      hasActiveGrowthInteractiveWorkload,
    } = await import("./growthWorkloadPriority");
    const release = await beginGrowthInteractiveWorkload("platform:test");
    expect(await hasActiveGrowthInteractiveWorkload()).toBe(true);
    await release();
    expect(await hasActiveGrowthInteractiveWorkload()).toBe(false);
  });

  it("自动清理已无心跳的旧租约", async () => {
    const dir = path.join(tempRoot, "runtime-interactive-workloads");
    const file = path.join(dir, "stale.json");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, "{}", "utf8");
    const staleAt = new Date(Date.now() - 5 * 60_000);
    await fs.utimes(file, staleAt, staleAt);
    const { hasActiveGrowthInteractiveWorkload } = await import("./growthWorkloadPriority");
    expect(await hasActiveGrowthInteractiveWorkload()).toBe(false);
    await expect(fs.access(file)).rejects.toThrow();
  });

  it("只把已抢占且属于真实登录用户的平台 Job 判为前台工作", async () => {
    const { isAuthenticatedRunningPlatformJob } = await import("./growthWorkloadPriority");
    expect(isAuthenticatedRunningPlatformJob({
      type: "platform",
      status: "running",
      userId: "42",
    })).toBe(true);
    expect(isAuthenticatedRunningPlatformJob({
      type: "platform",
      status: "queued",
      userId: "42",
    })).toBe(false);
    expect(isAuthenticatedRunningPlatformJob({
      type: "video",
      status: "running",
      userId: "42",
    })).toBe(false);
    expect(isAuthenticatedRunningPlatformJob({
      type: "platform",
      status: "running",
      userId: "public",
    })).toBe(false);
    expect(isAuthenticatedRunningPlatformJob({
      type: "platform",
      status: "running",
      userId: "legacy-open-id",
    })).toBe(false);
  });

  it("租约目录不可读时不把异常误判成空闲", async () => {
    const workloadPath = path.join(tempRoot, "runtime-interactive-workloads");
    await fs.writeFile(workloadPath, "not-a-directory", "utf8");
    const { hasActiveGrowthInteractiveWorkload } = await import("./growthWorkloadPriority");
    await expect(hasActiveGrowthInteractiveWorkload()).rejects.toMatchObject({ code: "ENOTDIR" });
  });
});
