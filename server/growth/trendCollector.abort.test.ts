import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_STORE_DIR = process.env.GROWTH_STORE_DIR;

describe("trendCollector abort contract", () => {
  let tempRoot = "";

  beforeEach(async () => {
    vi.resetModules();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "growth-collector-abort-"));
    process.env.GROWTH_STORE_DIR = tempRoot;
  });

  afterEach(async () => {
    if (ORIGINAL_STORE_DIR) process.env.GROWTH_STORE_DIR = ORIGINAL_STORE_DIR;
    else delete process.env.GROWTH_STORE_DIR;
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("公共多平台入口不会吞掉调用方已经发出的 abort", async () => {
    const controller = new AbortController();
    controller.abort("caller-cancelled");
    const { collectTrendPlatforms } = await import("./trendCollector");
    await expect(collectTrendPlatforms(["weixin_channels"], {
      signal: controller.signal,
      collectionSource: "live",
    })).rejects.toThrow("growth_collector_aborted");
  });
});
