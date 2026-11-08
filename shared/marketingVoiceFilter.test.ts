/**
 * 营销口播配音声线筛选。
 * 正向：六种用途都有候选、场景完全匹配优先、性别筛选、卡片副标题、试读取第一句。
 * 反向：用途不匹配的声线不混入、性别不符不混入、空口播不试读、非中文声线不进入列表。
 */
import { describe, expect, it } from "vitest";
import {
  MARKETING_SYSTEM_VOICES,
  MARKETING_VOICE_PURPOSES,
  filterMarketingSystemVoices,
  marketingVoiceMeta,
  marketingVoicePurposes,
  marketingVoiceTrialText,
} from "./marketingVoiceFilter";
import { QWEN_TTS_VOICE_CATALOG, buildQwenTtsVoiceId } from "./qwenTtsVoiceCatalog";

describe("系统声线按用途筛选（正向）", () => {
  it("六种用途都至少有男或女声线可选", () => {
    for (const purpose of MARKETING_VOICE_PURPOSES) expect(filterMarketingSystemVoices({ purpose }).length).toBeGreaterThan(0);
  });

  it("直播带货优先列出电商直播场景声线", () => {
    const list = filterMarketingSystemVoices({ purpose: "live_sales" });
    expect(list[0].sceneZh).toBe("电商直播");
    expect(list.every(v => v.purposes.includes("live_sales"))).toBe(true);
  });

  it("场景或特质命中即归类", () => {
    expect(marketingVoicePurposes({ sceneZh: "深夜电台", traitZh: "温润磁性音" })).toContain("late_night");
    expect(marketingVoicePurposes({ sceneZh: "日常对话", traitZh: "叙事沉浸音" })).toEqual(["audiobook"]);
    expect(marketingVoicePurposes({ sceneZh: "新闻播报", traitZh: "标准播音音" })).toContain("news");
  });

  it("性别筛选与全部", () => {
    const female = filterMarketingSystemVoices({ purpose: "companion", gender: "女" });
    expect(female.length).toBeGreaterThan(0);
    expect(female.every(v => v.gender === "女")).toBe(true);
    expect(filterMarketingSystemVoices({ purpose: "all", gender: "all" })).toHaveLength(MARKETING_SYSTEM_VOICES.length);
  });

  it("声线 id 与原下拉一致（plus 模型 + 后缀），卡片副标题含性别·年龄·场景", () => {
    const row = QWEN_TTS_VOICE_CATALOG.find(r => r.lang.includes("中文"))!;
    expect(MARKETING_SYSTEM_VOICES[0].id).toBe(buildQwenTtsVoiceId("plus", row.suffix));
    expect(marketingVoiceMeta({ gender: "女", age: 24, sceneZh: "电商直播" })).toBe("女 · 24 岁 · 电商直播");
    expect(marketingVoiceMeta({ gender: "男", age: null, sceneZh: "新闻播报" })).toBe("男 · 新闻播报");
  });

  it("试读只取本段口播第一句，不改写", () => {
    expect(marketingVoiceTrialText("每天一杯好咖啡。从选豆开始！")).toBe("每天一杯好咖啡。");
    expect(marketingVoiceTrialText("没有标点的一句话")).toBe("没有标点的一句话");
    expect(Array.from(marketingVoiceTrialText("长".repeat(200)))).toHaveLength(60);
  });
});

describe("系统声线筛选（反向）", () => {
  it("用途不符的声线不会混入", () => {
    const news = filterMarketingSystemVoices({ purpose: "news" });
    expect(news.some(v => v.sceneZh === "动漫配音" && !v.purposes.includes("news"))).toBe(false);
    expect(marketingVoicePurposes({ sceneZh: "动漫配音", traitZh: "呆萌软糯音" })).toEqual([]);
  });
  it("非中文声线不进入列表，空口播不试读", () => {
    const englishOnly = QWEN_TTS_VOICE_CATALOG.filter(r => !r.lang.includes("中文")).map(r => buildQwenTtsVoiceId("plus", r.suffix));
    expect(MARKETING_SYSTEM_VOICES.some(v => englishOnly.includes(v.id))).toBe(false);
    expect(marketingVoiceTrialText("   ")).toBe("");
  });
});
