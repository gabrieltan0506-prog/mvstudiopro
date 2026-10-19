import { expect, it } from "vitest";
import {
  subtitleHighlightDraftSchema,
  validateSubtitleHighlights,
} from "../../shared/subtitleHighlights";
import { burnSubtitleParamsSchema } from "../jobs/postProdInput";
import { buildSubtitleEffectAss } from "./subtitleEffects";

const cue = {
  id: "c1",
  startSec: 1,
  endSec: 3,
  text: "找要点",
  effect: "impact" as const,
  positionPercent: 72,
  fontSize: 13,
};
const srt = "1\n00:00:01,000 --> 00:00:03,000\n普通字幕";
it("重点数组经过入队契约保留，与普通字号和位置分别编译", () => {
  const params = burnSubtitleParamsSchema.parse({
    videoUri: "gs://test-only/video.mp4",
    subtitleSrt: srt,
    effect: "none",
    highlights: [
      cue,
      { ...cue, id: "c2", effect: "arrange", text: "目标|待办|待确认" },
      { ...cue, id: "c3", effect: "spiral" },
    ],
    styleOverride: { fontSize: 16, marginV: 50, outline: 0.35 },
  });
  const ass = buildSubtitleEffectAss({
    ...params,
    effect: params.effect!,
    width: 720,
    height: 1280,
  });
  expect(params.highlights).toHaveLength(3);
  expect(ass).toContain("Style: Default,Noto Sans CJK SC,16,");
  expect(ass).toContain(",50,1");
  expect(ass).toContain("\\fs13");
  expect(ass).toContain("\\fscx65");
  expect(ass).toContain("\\move(");
  expect(ass).toContain("\\p1");
  expect(ass).toContain("普通字幕");
  expect(
    ass.split("\n").filter(l => l.startsWith("Dialogue: 0,"))
  ).toHaveLength(1);
});
it("拒绝超时、过密、重复ID、任意字段及放不下的关键词", () => {
  expect(() => validateSubtitleHighlights([cue], 2)).toThrow("超出");
  expect(() => validateSubtitleHighlights([cue, cue])).toThrow("编号重复");
  expect(() => validateSubtitleHighlights([{ ...cue, startSec: 3 }])).toThrow();
  expect(() =>
    validateSubtitleHighlights([{ ...cue, script: "bad" }])
  ).toThrow();
  expect(() =>
    validateSubtitleHighlights(
      Array.from({ length: 7 }, (_, i) => ({
        ...cue,
        id: String(i),
        startSec: i * 30,
        endSec: (i + 1) * 30,
        effect: "spiral",
      }))
    )
  ).toThrow("180秒");
  expect(() =>
    buildSubtitleEffectAss({
      subtitleSrt: srt,
      effect: "none",
      highlights: [
        { ...cue, text: "这是一条过长的重点字幕内容", fontSize: 24 },
      ],
      width: 720,
      height: 1280,
    })
  ).toThrow("放不下");
});
it("草稿保留未填完内容，严格提交拒绝空白；重点不能注入ASS标签", () => {
  expect(
    subtitleHighlightDraftSchema.parse([{ ...cue, text: "", endSec: 0 }])[0]
      .text
  ).toBe("");
  expect(() => validateSubtitleHighlights([{ ...cue, text: "" }])).toThrow();
  const ass = buildSubtitleEffectAss({
    subtitleSrt: srt,
    effect: "none",
    width: 1920,
    height: 1080,
    highlights: [{ ...cue, text: "{\\pos(1,2)}" }],
  });
  expect(ass).toContain("｛＼pos(1,2)｝");
  expect(ass).not.toContain("{\\pos(1,2)}");
});

it("多行普通字幕与旋转光带相交时向上避让，整条重点保持稳定位置", async () => {
  const { subtitleLayoutCues, placeSubtitleHighlights } = await import("../../shared/subtitleLayout");
  const cues = subtitleLayoutCues("1\n00:00:07,000 --> 00:00:09,000\n重点与普通独立大小", 162, 16);
  expect(cues[0].lines.length).toBeGreaterThan(1);
  const [placed] = placeSubtitleHighlights([{ ...cue, startSec:7,endSec:9,effect:"spiral" }],cues,{fontSize:16,marginV:50});
  const normalTop = 288-50-cues[0].lines.length*16*1.35-.7;
  expect(placed.positionPercent*2.88+13*.7+9+4).toBeLessThanOrEqual(normalTop+.001);
  const [untouched] = placeSubtitleHighlights([{...cue,startSec:0,endSec:2}],cues,{fontSize:16,marginV:50});
  expect(untouched.positionPercent).toBe(72);
});
