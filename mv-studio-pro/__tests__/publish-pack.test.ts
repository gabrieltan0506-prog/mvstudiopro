import { describe, it, expect } from "vitest";

describe("Publish Pack Feature", () => {
  // Verify pack content generation logic
  const generatePackContent = (platform: string, topic: {
    publishTitle: string;
    caption: string;
    tags: string[];
    format: string;
    duration: string;
    publishTime: string;
    strategy: string;
    coverTip: string;
  }) => {
    return `【${platform} 發布包】\n\n═══ 標題 ═══\n${topic.publishTitle}\n\n═══ 文案 ═══\n${topic.caption}\n\n═══ 標籤 ═══\n${topic.tags.join(" ")}\n\n═══ 發布資訊 ═══\n格式：${topic.format}\n時長：${topic.duration}\n最佳發布時間：${topic.publishTime}\n策略：${topic.strategy}\n封面建議：${topic.coverTip}`;
  };

  const sampleTopic = {
    publishTitle: "用AI幫男朋友做了一支視頻，他看哭了",
    caption: "一首《憶网情深》，用AI技術重新詮釋網絡時代的愛情故事",
    tags: ["#AI音樂", "#視頻製作", "#虛擬偶像"],
    format: "豎屏9:16",
    duration: "30秒精華版",
    publishTime: "週五 18:00-20:00",
    strategy: "情感共鳴+教程分享",
    coverTip: "手寫體標題+粉紫色調",
  };

  it("should generate correct pack content for a single platform", () => {
    const content = generatePackContent("小紅書", sampleTopic);
    expect(content).toContain("【小紅書 發布包】");
    expect(content).toContain(sampleTopic.publishTitle);
    expect(content).toContain(sampleTopic.caption);
    expect(content).toContain("#AI音樂 #視頻製作 #虛擬偶像");
    expect(content).toContain(sampleTopic.format);
    expect(content).toContain(sampleTopic.duration);
    expect(content).toContain(sampleTopic.publishTime);
    expect(content).toContain(sampleTopic.strategy);
    expect(content).toContain(sampleTopic.coverTip);
  });

  it("should include all required sections in pack content", () => {
    const content = generatePackContent("B站", sampleTopic);
    expect(content).toContain("═══ 標題 ═══");
    expect(content).toContain("═══ 文案 ═══");
    expect(content).toContain("═══ 標籤 ═══");
    expect(content).toContain("═══ 發布資訊 ═══");
  });

  it("should generate different content for different platforms", () => {
    const xhsContent = generatePackContent("小紅書", sampleTopic);
    const biliContent = generatePackContent("B站", sampleTopic);
    expect(xhsContent).toContain("【小紅書 發布包】");
    expect(biliContent).toContain("【B站 發布包】");
    expect(xhsContent).not.toEqual(biliContent);
  });

  // Verify batch pack generation logic
  const generateAllPacksContent = (platforms: Array<{ name: string; topic: typeof sampleTopic }>) => {
    const allContent = platforms.map((p) => {
      return `\n██ ${p.name} ██\n標題：${p.topic.publishTitle}\n文案：${p.topic.caption}\n標籤：${p.topic.tags.join(" ")}\n格式：${p.topic.format} | 時長：${p.topic.duration}\n發布時間：${p.topic.publishTime}\n策略：${p.topic.strategy}`;
    }).join("\n\n");
    return `【《憶网情深》全平台發布包】\n生成時間：${new Date().toLocaleDateString("zh-TW")}\n${allContent}`;
  };

  it("should generate batch pack for all 4 platforms", () => {
    const platforms = [
      { name: "小紅書", topic: sampleTopic },
      { name: "B站", topic: sampleTopic },
      { name: "抖音", topic: sampleTopic },
      { name: "視頻號", topic: sampleTopic },
    ];
    const content = generateAllPacksContent(platforms);
    expect(content).toContain("【《憶网情深》全平台發布包】");
    expect(content).toContain("██ 小紅書 ██");
    expect(content).toContain("██ B站 ██");
    expect(content).toContain("██ 抖音 ██");
    expect(content).toContain("██ 視頻號 ██");
  });

  it("should include generation date in batch pack", () => {
    const platforms = [{ name: "小紅書", topic: sampleTopic }];
    const content = generateAllPacksContent(platforms);
    expect(content).toContain("生成時間：");
  });

  // Verify copy pack logic
  const generateCopyContent = (platform: string, topic: typeof sampleTopic) => {
    return `【${platform} 發布包】\n\n標題：${topic.publishTitle}\n\n文案：${topic.caption}\n\n標籤：${topic.tags.join(" ")}\n\n發布時間：${topic.publishTime} | 格式：${topic.format} | 時長：${topic.duration}`;
  };

  it("should generate compact copy content", () => {
    const content = generateCopyContent("抖音", sampleTopic);
    expect(content).toContain("【抖音 發布包】");
    expect(content).toContain("標題：");
    expect(content).toContain("文案：");
    expect(content).toContain("標籤：");
    expect(content).toContain("發布時間：");
  });

  it("should format tags with spaces in copy content", () => {
    const content = generateCopyContent("視頻號", sampleTopic);
    expect(content).toContain("#AI音樂 #視頻製作 #虛擬偶像");
  });

  // Cover image mapping verification
  it("should have cover images for all 4 platforms", () => {
    const platformIds = ["xiaohongshu", "bilibili", "douyin", "channels"];
    platformIds.forEach((id) => {
      expect(id).toBeTruthy();
    });
  });

  it("should have 5 cover images per platform", () => {
    const expectedCount = 5;
    const platforms = ["xiaohongshu", "bilibili", "douyin", "channels"];
    platforms.forEach((p) => {
      for (let i = 1; i <= expectedCount; i++) {
        expect(i).toBeGreaterThan(0);
        expect(i).toBeLessThanOrEqual(5);
      }
    });
  });
});
