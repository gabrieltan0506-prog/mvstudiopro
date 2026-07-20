import { describe, expect, it } from "vitest";
import {
  buildManhuaWriterExpandPrompt,
  clampWriterEpisodeCount,
  composeWriterPackFactoryContext,
  deriveSeriesTitleFromTopic,
  isPlaceholderSeriesTitle,
  parseManhuaWriterPack,
  writerPackLooksReady,
} from "./manhuaWriterRoom";

const SAMPLE = `## 系列标题
深宫棋子

## 一句话系列梗概
隐忍归来的女子，用旧盟约拆穿满朝伪善。

## 人物表
- 沈清｜青衣银簪｜翻盘｜与旧盟友对立｜勿崩成软弱

## 道具表
- 半枚玉珏｜身份铁证｜裂纹可见

## 场景表
- 雨夜回廊｜冷湿｜可扶栏对峙

## 第1集
### 集标题
归局
### 本集剧情
她踏入旧府，昔日盟友举杯如常。
### 片尾钩子
玉珏另一半，竟在对手腰间。

## 第2集
### 集标题
试探
### 本集剧情
宴会暗涌，她故意露出破绽。
### 片尾钩子
密信落款，却是亡父笔迹。

## 第3集
### 集标题
反咬
### 本集剧情
她当众揭伪证，朝堂哗然。
### 片尾钩子
幕后之人，竟唤她旧名。
`;

describe("manhuaWriterRoom", () => {
  it("clamps episode count 2–6", () => {
    expect(clampWriterEpisodeCount(1)).toBe(2);
    expect(clampWriterEpisodeCount(3)).toBe(3);
    expect(clampWriterEpisodeCount(9)).toBe(6);
  });

  it("builds expand prompt with episode count and no leak phrases", () => {
    const p = buildManhuaWriterExpandPrompt({
      topic: "女主权谋情感连载",
      brief: "每集结尾留钩子",
      episodeCount: 3,
    });
    expect(p).toContain("正好输出 3 集");
    expect(p).toContain("片尾钩子");
    expect(p).toContain("【道具示范库】");
    expect(p).toMatch(/权谋|商战|甜宠|古风/);
    expect(p).not.toMatch(/GPT-Image|OpenAI|EvoLink|藏海传/i);
  });

  it("parses pack and factory context", () => {
    const pack = parseManhuaWriterPack(SAMPLE, 3);
    expect(writerPackLooksReady(pack)).toBe(true);
    expect(pack.seriesTitle).toBe("深宫棋子");
    expect(pack.episodes).toHaveLength(3);
    expect(pack.episodes[0]!.endHook).toContain("玉珏");
    const ctx = composeWriterPackFactoryContext(pack, 1);
    expect(ctx).toContain("已确认编剧包");
    expect(ctx).toContain("第1集");
    expect(ctx).toContain("沈清");
  });

  it("parses same-line title and rejects placeholder with topic fallback", () => {
    const sameLine = parseManhuaWriterPack(
      `## 系列标题：花名册上没有我\n\n## 一句话系列梗概\n改写现实救人反被抹除。\n\n## 人物表\n- A\n\n## 道具表\n- B\n\n## 场景表\n- C\n\n## 第1集\n### 集标题\n一\n### 本集剧情\n冲突。\n### 片尾钩子\n未解悬念还在。\n\n## 第2集\n### 集标题\n二\n### 本集剧情\n再压。\n### 片尾钩子\n客服微笑未完。`,
      2,
    );
    expect(sameLine.seriesTitle).toBe("花名册上没有我");

    const placeholder = parseManhuaWriterPack(
      `## 系列标题\n（一句话标题）\n\n## 一句话系列梗概\n梗概。\n\n## 人物表\n- A\n\n## 道具表\n- B\n\n## 场景表\n- C\n\n## 第1集\n### 集标题\n一\n### 本集剧情\n冲突。\n### 片尾钩子\n未解悬念还在。\n\n## 第2集\n### 集标题\n二\n### 本集剧情\n再压。\n### 片尾钩子\n客服微笑未完。`,
      2,
      { topic: "都市逆袭：程序员绑定剧情改写器" },
    );
    expect(isPlaceholderSeriesTitle("（一句话标题）")).toBe(true);
    expect(placeholder.seriesTitle).toBe(deriveSeriesTitleFromTopic("都市逆袭：程序员绑定剧情改写器"));
    expect(placeholder.seriesTitle).not.toMatch(/^未命名/);
  });
});
