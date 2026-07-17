import { describe, expect, it } from "vitest";
import {
  classifyPlatformSkillQaKind,
  shouldFetchTrendEvidence,
  shouldFetchWebEvidence,
} from "./platformSkillQa";

describe("classifyPlatformSkillQaKind", () => {
  it("detects virtual-goods / pricing market research questions", () => {
    expect(
      classifyPlatformSkillQaKind(
        "根据数据库以及网络的相关讯息，帮我找出小红书目前可以销售虚拟资料的类型有哪些，哪些是持续量大的？哪些是利润高的？哪些是有时间节点的？该如何定价",
      ),
    ).toBe("market_research");
  });

  it("detects creative help", () => {
    expect(classifyPlatformSkillQaKind("帮我改写这条小红书钩子文案")).toBe("creative_help");
  });

  it("falls back to general", () => {
    expect(classifyPlatformSkillQaKind("今天天气怎么样")).toBe("general");
  });
});

describe("evidence soft heuristics", () => {
  const marketQ =
    "根据数据库以及网络的相关讯息，帮我找出小红书目前可以销售虚拟资料的类型有哪些，该如何定价";

  it("market + explicit network request enables both trend and web", () => {
    expect(shouldFetchTrendEvidence(marketQ)).toBe(true);
    expect(shouldFetchWebEvidence(marketQ)).toBe(true);
  });

  it("database / 趋势库 wording also enables trend fetch", () => {
    expect(shouldFetchTrendEvidence("根据数据库帮我看看虚拟资料赛道")).toBe(true);
    expect(shouldFetchTrendEvidence("趋势库里小红书最近在卖什么")).toBe(true);
  });

  it("pure creative rewrite does not force web research", () => {
    expect(shouldFetchWebEvidence("帮我改写这条小红书钩子文案")).toBe(false);
  });
});
