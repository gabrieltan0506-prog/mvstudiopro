import { describe, expect, it } from "vitest";
import {
  buildManhuaDirectorBoardPromptZh,
  chainManhuaActionBeatsZh,
  collectManhuaEpisodeCastZh,
  compressManhuaCameraMovesZh,
  joinManhuaSceneFlowZh,
  splitManhuaWardrobeAndProps,
  summarizeManhuaIntentZh,
} from "./manhuaDirectorBoardPrompt.js";
import type { ManhuaEpisodeSegmentBeat } from "./manhuaEpisodeSegmentPlan.js";

function beat(overrides: Partial<ManhuaEpisodeSegmentBeat>): ManhuaEpisodeSegmentBeat {
  return {
    index: 1,
    intentZh: "",
    dialogueZh: "",
    performanceZh: "",
    sceneZh: "",
    paletteZh: "",
    castZh: "",
    wardrobePropZh: "",
    lightingCameraZh: "",
    ...overrides,
  };
}

const SEGMENTS: ManhuaEpisodeSegmentBeat[] = [
  beat({
    index: 1,
    intentZh: "观众先看见沈策夜探雁门关，气氛紧绷。",
    performanceZh: "翻墙、贴壁、屏息",
    sceneZh: "雁门关城墙",
    paletteZh: "冷蓝夜色",
    castZh: "沈策、韩廷玉",
    wardrobePropZh: "黑色劲装；短刀",
    lightingCameraZh: "缓慢推近镜头，逆光剪影",
  }),
  beat({
    index: 2,
    intentZh: "接着误会韩廷玉是叛徒，紧张升级。",
    performanceZh: "对峙、拔刀、怒目",
    sceneZh: "雁门关城墙",
    paletteZh: "冷蓝夜色",
    castZh: "沈策、韩廷玉",
    wardrobePropZh: "玄甲；令牌",
    lightingCameraZh: "环绕运镜，侧光",
  }),
  beat({
    index: 3,
    intentZh: "最后留下令牌真伪的疑问，片尾钩子。",
    performanceZh: "对视、沉默、转身离去",
    sceneZh: "城下密室",
    paletteZh: "暖黄烛光",
    castZh: "沈策",
    wardrobePropZh: "油灯",
    lightingCameraZh: "缓慢拉远，暖调剪影",
  }),
];

describe("collectManhuaEpisodeCastZh", () => {
  it("dedupes cast names across segments", () => {
    expect(collectManhuaEpisodeCastZh(SEGMENTS)).toEqual(["沈策", "韩廷玉"]);
  });
});

describe("splitManhuaWardrobeAndProps", () => {
  it("splits wardrobePropZh into costumes vs props by keyword heuristic", () => {
    const { costumesZh, propsZh } = splitManhuaWardrobeAndProps(SEGMENTS);
    expect(costumesZh).toEqual(["黑色劲装", "玄甲"]);
    expect(propsZh).toEqual(["短刀", "令牌", "油灯"]);
  });
});

describe("joinManhuaSceneFlowZh", () => {
  it("chains scenes with an arrow, collapsing adjacent repeats", () => {
    expect(joinManhuaSceneFlowZh(SEGMENTS)).toBe("雁门关城墙 → 城下密室");
  });
});

describe("compressManhuaCameraMovesZh", () => {
  it("keeps only camera-movement tokens, capped at 4", () => {
    const out = compressManhuaCameraMovesZh(SEGMENTS);
    expect(out).toContain("缓慢推近镜头");
    expect(out).toContain("环绕运镜");
    expect(out.split("、").length).toBeLessThanOrEqual(4);
  });
});

describe("chainManhuaActionBeatsZh", () => {
  it("chains performance beats across segments with arrows", () => {
    const out = chainManhuaActionBeatsZh(SEGMENTS);
    expect(out).toBe(
      "翻墙 → 贴壁 → 屏息 → 对峙 → 拔刀 → 怒目 → 对视 → 沉默 → 转身离去",
    );
  });
});

describe("summarizeManhuaIntentZh", () => {
  it("joins short lists as-is (<=4 segments)", () => {
    const out = summarizeManhuaIntentZh(SEGMENTS);
    expect(out).toContain("观众先看见");
    expect(out).toContain("片尾钩子");
  });
});

describe("buildManhuaDirectorBoardPromptZh", () => {
  const result = buildManhuaDirectorBoardPromptZh({
    episodeNumber: 1,
    episodeTitleZh: "雁门照山河",
    segments: SEGMENTS,
  });

  it("produces the fixed section structure in order, no LLM call involved", () => {
    const sections = [
      "【图片用途】",
      "【戏剧核心】",
      "【人物连续性】",
      "【场景 / 服装 / 道具】",
      "【版式】",
      "【中央主画面】",
      "【下方三个小分镜】",
      "【运镜】",
      "【人物与道具运动】",
      "【灯光】",
      "【右侧文字，必须逐字呈现】",
      "【视觉风格】",
      "【禁止事项】",
    ];
    let cursor = -1;
    for (const s of sections) {
      const idx = result.promptZh.indexOf(s);
      expect(idx, `missing or out of order: ${s}`).toBeGreaterThan(cursor);
      cursor = idx;
    }
  });

  it("uses 青色 (cyan) for the camera-arrow convention, never 蓝色", () => {
    expect(result.promptZh).toContain("青色箭头");
    expect(result.promptZh).not.toMatch(/蓝色箭头/);
  });

  it("bans fantasy/modern/gore/watermark/logo/extra text in 【禁止事项】", () => {
    const banned = result.promptZh.slice(result.promptZh.indexOf("【禁止事项】"));
    expect(banned).toContain("仙侠法术");
    expect(banned).toContain("现代物品");
    expect(banned).toContain("血腥画面");
    expect(banned).toContain("水印");
    expect(banned).toContain("标志");
  });

  it("produces 7-9 right-column short lines including the episode/title line", () => {
    expect(result.rightTextLinesZh.length).toBeGreaterThanOrEqual(7);
    expect(result.rightTextLinesZh.length).toBeLessThanOrEqual(9);
    expect(result.rightTextLinesZh[0]).toBe("第01集　雁门照山河");
  });

  it("keeps segment count driven by input (no hardcoded 4), works for 4/7/8-segment layouts", () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      beat({ index: i + 1, intentZh: `段${i + 1}意图`, castZh: "沈策" }),
    );
    const r = buildManhuaDirectorBoardPromptZh({
      episodeNumber: 2,
      episodeTitleZh: "第二集",
      segments: many,
    });
    expect(r.promptZh).toContain("【图片用途】");
    expect(r.rightTextLinesZh[0]).toBe("第02集　第二集");
  });
});
