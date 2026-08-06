import { describe, expect, it } from "vitest";
import {
  applyPersonaPolishOption,
  assessPlatformPersonaSpecificity,
  normalizePersonaText,
  platformPersonaPolishRunTier,
  platformTopicGoalPromptLine,
  resolvePlatformPersonaPolishQuota,
} from "./platformPersonaPolish.js";

describe("resolvePlatformPersonaPolishQuota", () => {
  it("头 3 次免费", () => {
    expect(resolvePlatformPersonaPolishQuota({ usedEver: 0, usedToday: 0 }).nextFree).toBe(true);
    expect(resolvePlatformPersonaPolishQuota({ usedEver: 2, usedToday: 2 }).nextFree).toBe(true);
    expect(resolvePlatformPersonaPolishQuota({ usedEver: 2, usedToday: 2 }).firstFreeLeft).toBe(1);
  });

  it("用完头 3 次后每天仍有 1 次免费", () => {
    const first = resolvePlatformPersonaPolishQuota({ usedEver: 3, usedToday: 0 });
    expect(first.nextFree).toBe(true);
    expect(first.nextCredits).toBe(0);
  });

  it("当天第二次起按档收：优秀 1、卓越 2", () => {
    const excellent = resolvePlatformPersonaPolishQuota({ usedEver: 5, usedToday: 1 });
    expect(excellent.nextFree).toBe(false);
    expect(excellent.nextCredits).toBe(1);
    const superb = resolvePlatformPersonaPolishQuota({ usedEver: 5, usedToday: 1, tier: "superb" });
    expect(superb.nextCredits).toBe(2);
  });
});

describe("platformPersonaPolishRunTier", () => {
  it("免费那次一律走优秀档，不管用户选了什么", () => {
    expect(platformPersonaPolishRunTier({ isFree: true, requested: "superb" })).toBe("excellent");
  });

  it("付费时听用户的", () => {
    expect(platformPersonaPolishRunTier({ isFree: false, requested: "superb" })).toBe("superb");
    expect(platformPersonaPolishRunTier({ isFree: false, requested: null })).toBe("excellent");
  });
});

describe("assessPlatformPersonaSpecificity", () => {
  it("太短的拦下来", () => {
    expect(assessPlatformPersonaSpecificity("做号").ok).toBe(false);
    expect(assessPlatformPersonaSpecificity("").ok).toBe(false);
  });

  it("只有笼统词的拦下来", () => {
    expect(assessPlatformPersonaSpecificity("分享生活").ok).toBe(false);
    expect(assessPlatformPersonaSpecificity("就是想涨粉。").ok).toBe(false);
  });

  it("写了身份或赛道就放行", () => {
    expect(assessPlatformPersonaSpecificity("身份：医学背景创作者；赛道：慢病科普").ok).toBe(true);
    expect(assessPlatformPersonaSpecificity("我是健身教练，带产后妈妈恢复").ok).toBe(true);
  });

  it("够长的自然语言即使没关键词也放行", () => {
    const long = "平时在江浙一带跑老街拍空镜，想把这些片子做成能卖的素材包给做民宿的人用";
    expect(assessPlatformPersonaSpecificity(long).ok).toBe(true);
  });
});

describe("applyPersonaPolishOption", () => {
  it("replace 命中时替换原片段", () => {
    const out = applyPersonaPolishOption("身份：分享生活的人；赛道：随便写写", {
      id: "o1",
      label: "慢病科普",
      replace: { from: "随便写写", to: "慢病科普" },
    });
    expect(out).toBe("身份：分享生活的人；赛道：慢病科普");
  });

  it("replace 未命中时退回追加", () => {
    const out = applyPersonaPolishOption("身份：医学背景创作者", {
      id: "o1",
      label: "补受众",
      replace: { from: "不存在的片段", to: "受众：职场人" },
    });
    expect(out).toBe("身份：医学背景创作者；受众：职场人");
  });

  it("append 已存在时不重复加", () => {
    const text = "身份：医学背景创作者；受众：职场人";
    const out = applyPersonaPolishOption(text, {
      id: "o1",
      label: "受众",
      append: "受众：职场人",
    });
    expect(out).toBe(text);
  });

  it("空选项不改文本", () => {
    expect(applyPersonaPolishOption("身份：老师", { id: "o1", label: "保持" })).toBe("身份：老师");
  });
});

describe("normalizePersonaText", () => {
  it("收拾重复分隔符与首尾分号", () => {
    expect(normalizePersonaText("；身份：老师；；受众：家长；")).toBe("身份：老师；受众：家长");
  });
});

describe("platformTopicGoalPromptLine", () => {
  it("三个方向各给一句可执行口径", () => {
    expect(platformTopicGoalPromptLine("acquire")).toContain("获客");
    expect(platformTopicGoalPromptLine("convert")).toContain("转化");
    expect(platformTopicGoalPromptLine("follow")).toContain("涨粉");
  });

  it("未选方向时不往提示词里塞空话", () => {
    expect(platformTopicGoalPromptLine(null)).toBe("");
    expect(platformTopicGoalPromptLine("whatever")).toBe("");
  });
});
