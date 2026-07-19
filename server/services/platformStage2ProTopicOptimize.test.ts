import { describe, expect, it } from "vitest";

// 轻测：解析路径通过动态 import 不便 mock Responses；此处仅校验导出存在。
describe("platformStage2ProTopicOptimize", () => {
  it("exports optimizeStage2TopicsWithPro", async () => {
    const mod = await import("./platformStage2ProTopicOptimize.js");
    expect(typeof mod.optimizeStage2TopicsWithPro).toBe("function");
  });
});
