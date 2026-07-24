import { describe, expect, it } from "vitest";
import {
  buildManhuaWriterExpandPrompt,
  clampWriterEpisodeCount,
  composeWriterPackFactoryContext,
  deriveSeriesTitleFromTopic,
  importManhuaWriterPackFromText,
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
    expect(p).toMatch(/5–6 段|6 段/);
    expect(p).toMatch(/15 秒/);
    expect(p).toContain("五至六段可拍表");
    expect(p).toContain("故事发动机");
    expect(p).toContain("整体影像风格");
    expect(p).toMatch(/权谋|商战|甜宠|古风/);
    expect(p).not.toMatch(/GPT-Image|OpenAI|EvoLink|藏海传/i);
    expect(p).not.toMatch(/严格按 10 秒/);
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

  it("imports freeform script with episode markers", () => {
    const raw = `# 花名册上没有我

梗概：改写现实救人，反被系统抹除身份。

第1集 救下她
高主管把裁员文件夹推到林夏面前。周野改写名单，林夏留下，自己却刷不开门禁。

片尾钩子：系统提示在十秒后切断——

第2集 客服微笑
秦策劝他再改一次。林夏带他进门，却忽然问：你是谁？

第3集 同名替身
周野查出额度流向秦策，最后一改让光环倒流，秦策却长出与他相同的脸。
钩子：现实只允许一名周野存在，被删除的将是——
`;
    const res = importManhuaWriterPackFromText(raw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.via).toBe("episode_markers");
    expect(res.pack.seriesTitle).toBe("花名册上没有我");
    expect(res.pack.episodes).toHaveLength(3);
    expect(writerPackLooksReady(res.pack)).toBe(true);
    expect(res.pack.episodes[0]!.endHook.length).toBeGreaterThanOrEqual(4);
  });

  it("imports structured expand markdown", () => {
    const res = importManhuaWriterPackFromText(SAMPLE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.via).toBe("structured");
    expect(res.pack.seriesTitle).toBe("深宫棋子");
    expect(writerPackLooksReady(res.pack)).toBe(true);
  });

  it("rejects import without episode markers", () => {
    const res = importManhuaWriterPackFromText(
      "这是一段没有分集标记的长文。".repeat(20),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/分集|第1集/);
  });
});
