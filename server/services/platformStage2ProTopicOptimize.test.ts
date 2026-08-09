import { describe, expect, it, vi } from "vitest";

// 用例体内 await import 重模块，全量并发下 transform 成本计入 5s 默认预算（负载抽签）
vi.setConfig({ testTimeout: 60_000 });

// 轻测：解析路径通过动态 import 不便 mock Responses；此处仅校验导出存在。
describe("platformStage2ProTopicOptimize", () => {
  it("exports optimizeStage2TopicsWithPro", async () => {
    const mod = await import("./platformStage2ProTopicOptimize.js");
    expect(typeof mod.optimizeStage2TopicsWithPro).toBe("function");
  });
});
