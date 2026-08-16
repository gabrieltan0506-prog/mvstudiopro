import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("首页照片高清放大外部调用策略", () => {
  it("整条供应商链只创建一次，超时直接失败退款而不是重新排队", () => {
    const source = fs.readFileSync("server/services/homePhotoUpscaleTask.ts", "utf8");
    expect(source).toContain("const MAX_ATTEMPTS = 1;");
    expect(source).toContain("abortSignal: AbortSignal.timeout(remainingWallMs)");
    expect(source).toContain("tryAcquireHomePhotoUpscaleLease");
    expect(source).not.toContain('task.status = "queued";');
    expect(source).not.toMatch(/retryable failure/);
  });

  it("接单与续跑都按任务倍率检查供应商配置", () => {
    const source = fs.readFileSync("server/services/homePhotoUpscaleTask.ts", "utf8");
    expect(source).toContain("isImageUpscaleConfigured(task.upscaleFactor)");
    expect(source).toContain("isImageUpscaleConfigured(input.upscaleFactor)");
  });
});
