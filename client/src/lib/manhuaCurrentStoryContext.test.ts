import { expect, it } from "vitest";
import {
  composeWriterPackFactoryContext,
  type ManhuaWriterPack,
} from "@shared/manhuaWriterRoom";
import { splitManhuaEpisodeStoryText } from "@shared/manhuaAdvisorRewrite";
import {
  buildManhuaWriterSession,
  parseManhuaWriterSession,
  serializeManhuaWriterSession,
} from "@shared/manhuaWriterSession";
import {
  resolveShotsForEpisodeKeyartsResult,
  spawnManhuaDramaStudio,
  spawnManhuaDramaStudioSeries,
} from "./canvasDramaStudio";

const story =
  "## 一、金针引气与取血\n先生弹出四枚金针，四处穴位渗出黑气。\n先生：“先镇住气，再说别的。”\n\n## 二、药见效\n墨屠低声马嘶，阿菁含泪抚着它的颈毛，不再加对白。";
const technical =
  "### 五至六段可拍表\n#### 段01\n- 意图：取血\n- 对白：\n  - 坐堂先生：「灵兽的血，我头回见。」\n- 表演：先生划开马肩，手在抖。\n- 场景：长明医馆\n- 角色：坐堂先生；墨屠\n#### 段02\n- 意图：药见效\n- 对白：\n  - 阿菁：「你脸色比娘还白。」\n- 表演：娘坐起，马腿打颤。\n- 场景：长明医馆\n- 角色：娘；阿菁；墨屠";
const pack: ManhuaWriterPack = {
  seriesTitle: "墨菁传",
  logline: "救母取血",
  charactersMd: "坐堂先生；墨屠；阿菁；娘",
  propsMd: "金针；药碗",
  locationsMd: "长明医馆",
  episodes: [
    {
      index: 1,
      title: "原集",
      body: "第一集原稿。\n\n" + technical,
      endHook: "原钩子",
    },
    {
      index: 2,
      title: "取血之夜",
      body: story + "\n\n" + technical,
      endHook: "袖口暗红光",
      storyboardNeedsReview: true,
    },
  ],
  rawMarkdown: "已保存完整稿",
  episodeCount: 2,
};

it("再次确认只投影当前剧情，旧技术材料继续保留在存档", () => {
  const original = JSON.stringify(pack);
  const context = composeWriterPackFactoryContext(pack, 2);
  expect(context).toContain(story);
  expect(context).toContain("分镜复核");
  expect(context).not.toContain("灵兽的血，我头回见");
  expect(context).not.toContain("你脸色比娘还白");
  expect(context).not.toContain("#### 段01");
  expect(JSON.stringify(pack)).toBe(original);
  expect(
    splitManhuaEpisodeStoryText(pack.episodes[1]!.body).technicalSections
  ).toEqual([technical]);
});

it.each([undefined, false])(
  "未改写的第一集及复核过的段表保留既有生产契约：%s",
  flag => {
    const unchanged = {
      ...pack,
      episodes: pack.episodes.map(ep =>
        ep.index === 2 ? { ...ep, storyboardNeedsReview: flag } : ep
      ),
    };
    expect(composeWriterPackFactoryContext(unchanged, 2)).toContain(
      "灵兽的血，我头回见"
    );
    expect(composeWriterPackFactoryContext(pack, 1)).toContain(technical);
  }
);

it("完整保存恢复后，单集铺板下游不能把旧段表认成已生产分镜", () => {
  const restored = parseManhuaWriterSession(
    serializeManhuaWriterSession(
      buildManhuaWriterSession({ writerPack: pack, writerConfirmed: true })
    )
  )!.writerPack!;
  const context = composeWriterPackFactoryContext(restored, 2);
  const spawned = spawnManhuaDramaStudio({
    topic: restored.seriesTitle,
    episodeIndex: 2,
    writerContext: context,
  });
  const parsed = resolveShotsForEpisodeKeyartsResult(spawned.blocks, 2);
  expect(parsed.isFallback).toBe(true);
  expect(parsed.shots).toEqual([]);
  expect(parsed.sourceErrors).toEqual([
    expect.stringContaining("尚未完成当前正文的分镜"),
  ]);
  expect(spawned.blocks.some(block => block.prompt.includes(story))).toBe(true);
  expect(
    spawned.blocks.every(block => !block.prompt.includes("你脸色比娘还白"))
  ).toBe(true);
  expect(
    parsed.shots.some(shot =>
      JSON.stringify(shot).includes("灵兽的血，我头回见")
    )
  ).toBe(false);
});

it("当前正文生成的真实分镜优先采用，复核提示不阻断真实新产物", () => {
  const spawned = spawnManhuaDramaStudio({
    topic: pack.seriesTitle,
    episodeIndex: 2,
    writerContext: composeWriterPackFactoryContext(pack, 2),
  });
  const beats = spawned.blocks.find(block => block.id.startsWith("beats-"))!;
  beats.outputText =
    "## 分镜表\n| # | 秒位 | 景别·运镜 | 画面 | 台词/字幕 | 音效·配乐 |\n|---|---|---|---|---|---|\n| 1 | 0–5s | 特写·跟针 | 四枚金针落入穴位 | 先生：先镇住气，再说别的。 | 针光轻鸣 |\n| 2 | 5–10s | 近景·固定 | 墨屠低声马嘶，阿菁落泪抚颈 | 无对白 | 马嘶与鼻息 |";
  const parsed = resolveShotsForEpisodeKeyartsResult(spawned.blocks, 2);
  expect(parsed.isFallback).toBe(false);
  expect(parsed.sourceErrors).toEqual([]);
  expect(parsed.shots).toHaveLength(2);
  expect(JSON.stringify(parsed.shots)).toContain("四枚金针");
  expect(JSON.stringify(parsed.shots)).not.toContain("你脸色比娘还白");
});

it("批量铺板第一集仍消费原技术表，第二集旧材料不进入分镜生产者", () => {
  const spawned = spawnManhuaDramaStudioSeries({
    topic: pack.seriesTitle,
    episodes: pack.episodes,
    writerContextForEpisode: ep =>
      composeWriterPackFactoryContext(pack, ep.index),
  });
  expect(
    resolveShotsForEpisodeKeyartsResult(spawned.blocks, 1).isFallback
  ).toBe(false);
  expect(
    resolveShotsForEpisodeKeyartsResult(spawned.blocks, 2).isFallback
  ).toBe(true);
});
