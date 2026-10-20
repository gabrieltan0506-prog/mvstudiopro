import { describe, expect, it, vi } from "vitest";
import { buildMarketingPrompt } from "../../shared/marketingSkills.js";
vi.mock("../growth/trendStore", () => ({ readTrendStoreForPlatforms: vi.fn() }));
import { buildCommanderPrompt } from "./commanderPromptBuilder";

describe("研究指令消费营销方法", () => {
 it("既有档案、痛点与场景输入共同驱动研究方法，保留审批与样本边界", () => {
  const boundary = "亲子关系儿童绘本与动画，禁止治疗承诺";
  const assets = "现有绘本角色";
  const notes = "营销获客，价格成本待补";
  const painPoint = "寻找愿意共读的家庭";
  const supplementary = "产品仅候选，尚未销售";
  const prompt = buildCommanderPrompt({ scenario: "platform_ip_matrix", scenarioTitle: "亲子内容研究", scenarioPayload: { 产品: "儿童绘本" }, painPoint, freeformSupplementary: supplementary, profile: { strategicBoundary: boundary, coreAssets: assets, notes, updatedAt: "2026-10-20" }, platformBriefing: "暂无相关趋势样本" });
  expect(prompt).toContain(buildMarketingPrompt({ stage: "research", context: [boundary, assets, notes, painPoint, "· 产品：儿童绘本", supplementary].join("\n") }));
  expect(prompt).toContain("深潜研究计划");
  expect(prompt).toContain("非账号真实CTR");
  expect(prompt).toContain(supplementary);
 });
});
