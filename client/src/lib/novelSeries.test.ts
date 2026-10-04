import { it, expect } from "vitest";
import {
  emptyNovelWorkspace,
  applyNovelChapterCompletion,
  type NovelRun,
} from "./novelWorkspace";
import {
  batchNovel,
  nextNovelBatch,
  continuationContext,
  completeScriptBatches,
} from "./novelSeries";
import {
  novelTestInputSchema,
  validateNovelStageOutput,
} from "@shared/novelWorkspace";
it("3→10→20→20→7 reaches 60 with continuous ranges and preserved original episodes", () => {
  let d = emptyNovelWorkspace();
  d.targetEpisodeCount = 60;
  const windows = [];
  for (const next of [10, 20, 20, 20, 20]) {
    const start = d.episodeStart || 1;
    windows.push([start, d.episodeCount]);
    for (let i = start; i < start + d.episodeCount; i++)
      d.chapters[i - 1] = `第${i}集原稿`;
    d.outline = "本批纲";
    d.novelApproved = batchNovel(d);
    if (d.chapters.length === 60) {
      expect(() => nextNovelBatch(d, next)).toThrow("全剧计划");
      break;
    }
    d = nextNovelBatch(d, next);
  }
  expect(windows).toEqual([
    [1, 3],
    [4, 10],
    [14, 20],
    [34, 20],
    [54, 7],
  ]);
  expect(d.chapters).toHaveLength(60);
  expect(d.chapters[0]).toBe("第1集原稿");
  d.targetEpisodeCount = 50;
  expect(d.chapters[59]).toBe("第60集原稿");
});
it("review and pending-job gates prevent automatic continuation", () => {
  const d = emptyNovelWorkspace();
  d.targetEpisodeCount = 80;
  d.chapters = ["一", "二", "三"];
  expect(() => nextNovelBatch(d, 10)).toThrow("审阅");
  d.novelApproved = batchNovel(d);
  d.chapterWarnings = { "1": "核对前文" };
  expect(() => nextNovelBatch(d, 10)).toThrow("衔接");
});
it("continuation uses all approved cumulative facts and latest two full texts; edits invalidate facts", () => {
  const d = emptyNovelWorkspace();
  d.chapters = Array.from({ length: 60 }, (_, i) => `原稿${i}`);
  d.continuity = "累计人物与伏笔";
  d.continuityThrough = 60;
  d.continuityBase = d.chapters.join("\n\n");
  expect(continuationContext(d, 60)).toBe("原稿58\n\n原稿59");
  d.chapters[0] = "修改身份";
  expect(() => continuationContext(d, 60)).toThrow("前文已变动");
});
it("schema validates global episode numbers and complete batch output without a three-episode limit", () => {
  const input = novelTestInputSchema.parse({
    requestId: crypto.randomUUID(),
    roundId: crypto.randomUUID(),
    stage: "outline",
    topic: "剧",
    direction: "续写",
    templates: [{ publicId: "mt_a", role: "权谋" }],
    episodeCount: 20,
    episodeStart: 34,
    targetEpisodeCount: 80,
  });
  const value = {
    premise: "冲突",
    characters: "关系",
    episodes: Array.from({ length: 20 }, (_, i) => ({
      index: 34 + i,
      title: "标题",
      events: "因果",
      hook: "伏笔",
      payoff: "兑现",
    })),
  };
  expect(validateNovelStageOutput(input, value, [])).toEqual(value);
  expect(() =>
    validateNovelStageOutput(
      input,
      {
        ...value,
        episodes: value.episodes.map((e, i) => ({ ...e, index: i + 1 })),
      },
      []
    )
  ).toThrow("次序");
});
it("incomplete script batches are not offered as complete; grouping uses exact story revision and episode order", () => {
  const id = crypto.randomUUID();
  const parts = Array.from(
    { length: 10 },
    (_, i) =>
      ({
        input: {
          requestId: crypto.randomUUID(),
          roundId: crypto.randomUUID(),
          stage: "script",
          topic: "剧",
          direction: "方向",
          templates: [],
          episodeCount: 1,
          episodeStart: 4 + i,
          chapterIndex: 4 + i,
          outline: "纲",
          novel: "正文",
          selectedTemplateIds: [],
          scriptBatch: { id, start: 4, count: 10, baseline: "same-story" },
        },
        result: {
          requestId: crypto.randomUUID(),
          stage: "script",
          inputSha256: "a",
          resultSha256: `hash${i}`,
          templateIds: [],
          text: JSON.stringify({
            title: "剧",
            episodes: [
              {
                index: 4 + i,
                title: "集",
                opening: "开场",
                hook: "钩子",
                payoff: "兑现",
                scenes: [
                  {
                    key: `E${4 + i}-S1`,
                    场景: "场景",
                    人物: "人物",
                    妆容: "妆容",
                    灯光: "灯光",
                    氛围: "氛围",
                    对白: "对白",
                  },
                ],
              },
            ],
          }),
        },
      }) as NovelRun
  );
  expect(completeScriptBatches(parts.slice(0, 9))).toHaveLength(0);
  const complete = completeScriptBatches(parts);
  expect(complete).toHaveLength(1);
  expect(
    JSON.parse(complete[0].result.text).episodes.map((e: any) => e.index)
  ).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
});
