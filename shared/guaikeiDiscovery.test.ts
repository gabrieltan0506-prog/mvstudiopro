import { describe, it, expect } from "vitest";
import { defaultGuaikeiSettings, guaikeiSettingsSchema, recentGuaikeiItems, type GuaikeiItem } from "./guaikei";
describe("多领域采集默认与窗口", () => {
  it("新配置符合持久化合同且不自动启动付费", () => {
    const settings = guaikeiSettingsSchema.parse(defaultGuaikeiSettings());
    expect(settings.enabled).toBe(false);
    for (const platform of Object.values(settings.platforms)) {
      expect(platform.keywords.length).toBeGreaterThanOrEqual(8);
      expect(platform.keywords.filter(k => /\bAI\b|人工智能/i.test(k))).toHaveLength(0);
      expect(platform.rounds).toBe(1); expect(platform.limit).toBe(20);
    }
  });
  it("不同平台和不同初始化实例不共享可变关键词数组", () => {
    const first = defaultGuaikeiSettings(), second = defaultGuaikeiSettings();
    first.platforms.douyin.keywords.push("独立主题");
    expect(first.platforms.xiaohongshu.keywords).not.toContain("独立主题");
    expect(second.platforms.douyin.keywords).not.toContain("独立主题");
  });
  it("保留用户自定义专题，不用新默认静默覆盖", () => {
    const saved = defaultGuaikeiSettings(); saved.platforms.wechat.keywords = ["AI工具", "退休生活"];
    expect(guaikeiSettingsSchema.parse(saved).platforms.wechat.keywords).toEqual(["AI工具", "退休生活"]);
  });
  it("上海窗口排除过期、未来及无日期作品", () => {
    const rows = ["2026-11-02T00:00:00+08:00", "2026-11-01T23:59:59+08:00", "2026-11-05T00:00:00+08:00", null].map((publishedAt, i) => ({ id: String(i), publishedAt } as GuaikeiItem));
    expect(recentGuaikeiItems(rows, 3, Date.parse("2026-11-04T14:00:00+08:00")).map(x=>x.id)).toEqual(["0"]);
  });
});
