import { describe, expect, it } from "vitest";
import {
  buildManhuaDialogueTimelineBeats,
  extractManhuaSceneHintFromPrompt,
  formatManhuaDialogueTimelineBlock,
  MANHUA_CROSS_SHOT_CONTINUITY_LOCK,
  MANHUA_SEEDANCE_AUDIO_DIRECTOR_LOCK,
} from "./manhuaClipDialogueTimeline";
import { formatWorkbenchSegmentClipInjectBlock } from "./manhuaScriptWorkbench";

describe("manhuaClipDialogueTimeline", () => {
  it("assigns second ranges and emotion fields per shot", () => {
    const beats = buildManhuaDialogueTimelineBeats(
      [
        {
          index: 1,
          durationSec: 0,
          cameraZh: "近景",
          actionZh: "抬头",
          dialogueZh: "拿着",
          emotionZh: "决绝",
          microExpressionZh: "下颌绷紧",
        },
        {
          index: 2,
          durationSec: 0,
          cameraZh: "中景",
          actionZh: "后退",
          dialogueZh: "你早就知道了？",
          emotionZh: "不信",
          microExpressionZh: "眼眶发红",
        },
      ],
      15,
    );
    expect(beats).toHaveLength(2);
    expect(beats[0]?.startSec).toBe(0);
    expect(beats[0]?.endSec).toBe(7.5);
    expect(beats[1]?.startSec).toBe(7.5);
    expect(beats[1]?.dialogueZh).toContain("你早就知道了");
    expect(beats[0]?.microExpressionZh).toContain("下颌");
  });

  it("formats second-axis with action/camera tracks and framing", () => {
    const block = formatManhuaDialogueTimelineBlock(
      [
        {
          index: 5,
          durationSec: 0,
          cameraZh: "近景，微推",
          actionZh: "@角色2 握拳对峙",
          dialogueZh: "放开！",
          emotionZh: "怒",
          microExpressionZh: "咬牙",
          voiceToneZh: "压嗓",
        },
      ],
      15,
      {
        segmentIndex: 2,
        sceneHintZh: "古宅廊下",
        lightingCameraZh: "侧逆光压暗",
        paletteZh: "冷青",
      },
    );
    expect(block).toContain("0–15s：");
    expect(block).toContain("动作轨迹：握拳对峙，咬牙");
    expect(block).toContain("运镜轨迹：");
    expect(block).toContain("景别：近景");
    expect(block).toContain("光：侧逆光压暗");
    expect(block).toContain("氛围：冷青");
    expect(block).toContain("@角色2");
    expect(block).toContain("说「放开！」");
    expect(block).not.toContain("视频生成导戏单");
    expect(block).not.toMatch(/衔接：|\d+mm|快门/);
    expect(MANHUA_CROSS_SHOT_CONTINUITY_LOCK).toMatch(/换脸|服装|跳棚/);
    expect(MANHUA_SEEDANCE_AUDIO_DIRECTOR_LOCK).toMatch(/引擎同轮出声|口型|时间轴|禁止另开后期配音/);
  });

  it("extracts scene name from keyart prompt", () => {
    expect(
      extractManhuaSceneHintFromPrompt("前言\n【本集主场景优先】古宅廊下\n直接吸收"),
    ).toBe("古宅廊下");
  });

  it("segment clip inject locks scene/light and lists tracks per beat", () => {
    const text = formatWorkbenchSegmentClipInjectBlock({
      segmentIndex: 1,
      durationSec: 15,
      sceneHintZh: "雨夜巷口",
      lightingCameraZh: "湿漉侧光",
      paletteZh: "青灰",
      sceneTag: "@场景1",
      shots: [
        {
          index: 1,
          durationSec: 0,
          cameraZh: "近景",
          actionZh: "@角色5 递出玉佩",
          dialogueZh: "拿着",
          emotionZh: "决绝",
          microExpressionZh: "目光钉死",
        },
        {
          index: 2,
          durationSec: 0,
          cameraZh: "中景",
          actionZh: "@角色4 握紧后退",
          dialogueZh: "你早就知道了？",
          emotionZh: "不信",
        },
      ],
    });
    expect(text).toContain("【第1段·15s】雨夜巷口");
    expect(text).toContain("【场景锁】");
    expect(text).toContain("@场景1");
    expect(text).toContain("【光影·景别·氛围】");
    expect(text).toContain("动作轨迹：");
    expect(text).toContain("运镜轨迹：");
    expect(text).toContain("景别：近景");
    expect(text).toContain("景别：中景");
    expect(text).toContain("说「拿着」");
    expect(text).toContain("说「你早就知道了？」");
    expect(text).not.toContain("视频生成导戏单");
    expect(text).not.toContain("跨镜连续硬锁");
    expect(text).not.toMatch(/衔接：|\d+mm|快门/);
  });
});
