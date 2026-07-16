import { describe, expect, it } from "vitest";
import {
  buildManhuaWriterExpandPrompt,
  clampWriterEpisodeCount,
  composeWriterPackFactoryContext,
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
    expect(p).not.toMatch(/GPT-Image|OpenAI|EvoLink|藏海传/i);
  });

  it("parses pack and factory context", () => {
    const pack = parseManhuaWriterPack(SAMPLE, 3);
    expect(writerPackLooksReady(pack)).toBe(true);
    expect(pack.episodes).toHaveLength(3);
    expect(pack.episodes[0]!.endHook).toContain("玉珏");
    const ctx = composeWriterPackFactoryContext(pack, 1);
    expect(ctx).toContain("已确认编剧包");
    expect(ctx).toContain("第1集");
    expect(ctx).toContain("沈清");
  });
});
