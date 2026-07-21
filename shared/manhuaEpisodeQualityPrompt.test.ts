import { describe, expect, it } from "vitest";
import {
  composeManhuaEpisodeQualityBlock,
  MANHUA_ACTION_TRAJECTORY_BLOCK,
  MANHUA_CAMERA_TRAJECTORY_BLOCK,
  MANHUA_DIALOGUE_DENSITY_BLOCK,
  MANHUA_PROP_IN_FRAME_BLOCK,
  MANHUA_SCENE_DYNAMICS_BLOCK,
  MANHUA_SCENE_RENDER_BLOCK,
} from "./manhuaEpisodeQualityPrompt";
import { composeManhuaNarrativeEngineBlock } from "./manhuaNarrativeEnginePrompt";
import { MANHUA_DRAMA_DEFAULT_PROMPTS } from "./videoReversePrompt";
import {
  formatWorkbenchSegmentClipInjectBlock,
  formatWorkbenchShotInjectBlock,
} from "./manhuaScriptWorkbench";

describe("manhuaEpisodeQualityPrompt", () => {
  it("covers dialogue / prop / camera / action / scene / dynamics", () => {
    const block = composeManhuaEpisodeQualityBlock();
    expect(block).toContain("对白密度");
    expect(block).toContain("道具入画");
    expect(block).toContain("运镜轨迹");
    expect(block).toContain("动作轨迹");
    expect(block).toContain("场景渲染");
    expect(block).toContain("场面变化");
    expect(MANHUA_DIALOGUE_DENSITY_BLOCK).toMatch(/12–20/);
    expect(MANHUA_PROP_IN_FRAME_BLOCK).toMatch(/入画/);
    expect(MANHUA_CAMERA_TRAJECTORY_BLOCK).toMatch(/起幅/);
    expect(MANHUA_ACTION_TRAJECTORY_BLOCK).toMatch(/接触点|动作链/);
    expect(MANHUA_SCENE_RENDER_BLOCK).toMatch(/纵深|天气/);
    expect(MANHUA_SCENE_DYNAMICS_BLOCK).toMatch(/对白突然变剧烈打斗|晴→雨/);
  });

  it("narrative engine includes episode quality by default", () => {
    const block = composeManhuaNarrativeEngineBlock();
    expect(block).toContain("三分钟");
    expect(block).toContain("对白密度");
    expect(block).toContain("场景渲染");
    expect(block).toContain("场面变化");
  });

  it("default prompts target ~180s and denser craft", () => {
    expect(MANHUA_DRAMA_DEFAULT_PROMPTS.story_brief).toMatch(/180/);
    expect(MANHUA_DRAMA_DEFAULT_PROMPTS.episode_beats).toMatch(/12 段|动作链|互动/);
    expect(MANHUA_DRAMA_DEFAULT_PROMPTS.seedance_clip).toMatch(/15 秒|天气|打斗/);
    expect(MANHUA_DRAMA_DEFAULT_PROMPTS.video_reverse).toMatch(/动作链|互动|天气/);
  });

  it("segment clip inject chains dialogues and quality checks", () => {
    const text = formatWorkbenchSegmentClipInjectBlock({
      segmentIndex: 2,
      durationSec: 15,
      shots: [
        { index: 5, durationSec: 0, cameraZh: "中景", actionZh: "递出玉佩", dialogueZh: "拿着" },
        {
          index: 6,
          durationSec: 0,
          cameraZh: "近景",
          actionZh: "握紧玉佩后退",
          dialogueZh: "你早就知道了？",
        },
      ],
    });
    expect(text).toContain("成片表演剧本");
    expect(text).toContain("拿着");
    expect(text).toContain("动作轨迹");
    expect(text).toMatch(/道具入画|道具须入画/);
    expect(text).toContain("跨镜连续硬锁");
    expect(text).toContain("只重出本段");
    expect(text).toContain("多拍动作链");
  });

  it("injects weather and fight-shift cues when actions escalate", () => {
    const shot = formatWorkbenchShotInjectBlock({
      index: 8,
      durationSec: 0,
      cameraZh: "近景",
      actionZh: "晴转骤雨，两人夺刀打斗爆发",
      dialogueZh: "放开！",
    });
    expect(shot).toContain("天气/氛围突变");
    expect(shot).toContain("戏种跳变");
    expect(shot).toContain("人物互动");

    const clip = formatWorkbenchSegmentClipInjectBlock({
      segmentIndex: 3,
      durationSec: 15,
      shots: [
        {
          index: 9,
          durationSec: 0,
          cameraZh: "中景",
          actionZh: "对峙对白半句被打断",
          dialogueZh: "你听我说——",
        },
        {
          index: 10,
          durationSec: 0,
          cameraZh: "全景",
          actionZh: "推开对方拔刀打斗，雨丝初落",
        },
      ],
    });
    expect(clip).toContain("戏种跳变");
    expect(clip).toContain("天气/氛围");
  });
});
