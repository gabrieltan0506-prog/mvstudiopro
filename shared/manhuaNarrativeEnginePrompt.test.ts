import { describe, expect, it } from "vitest";
import {
  MANHUA_HOOK_3S_BLOCK,
  MANHUA_PLOT_ENGINE_BLOCK,
  composeManhuaNarrativeEngineBlock,
} from "./manhuaNarrativeEnginePrompt";
import { MANHUA_DRAMA_DEFAULT_PROMPTS } from "./videoReversePrompt";
import { formatWorkbenchClipInjectBlock } from "./manhuaScriptWorkbench";
import { enrichPerformanceCueWithVisibleAction } from "./manhuaPerformancePrompt";

describe("manhuaNarrativeEnginePrompt", () => {
  it("composes plot engine + 3s hook + info increment", () => {
    const block = composeManhuaNarrativeEngineBlock();
    expect(block).toContain("剧情发动机");
    expect(block).toContain("前三秒");
    expect(block).toContain("信息增量");
    expect(block).not.toMatch(/元点Agent|东山聊AI|RunningHub/i);
  });

  it("default stage prompts require goal obstacle cost and hook", () => {
    expect(MANHUA_DRAMA_DEFAULT_PROMPTS.story_brief).toMatch(/目标|阻力|代价/);
    expect(MANHUA_DRAMA_DEFAULT_PROMPTS.episode_beats).toMatch(/信息增量|前三秒|≤3/);
    expect(MANHUA_HOOK_3S_BLOCK).toContain("问题");
    expect(MANHUA_PLOT_ENGINE_BLOCK).toContain("代价");
  });

  it("first shot clip inject has 3s hook lock", () => {
    const clip = formatWorkbenchClipInjectBlock({
      index: 1,
      durationSec: 3,
      cameraZh: "过肩",
      actionZh: "电梯门开，灯全亮",
      emotionZh: "震惊",
    });
    expect(clip).toContain("前三秒");
    expect(clip).toContain("推荐运镜");
    expect(clip).toContain("成片预演硬锁");
  });

  it("enriches fear emotion into visible action", () => {
    const cue = enrichPerformanceCueWithVisibleAction({
      dialogueZh: "",
      emotionZh: "害怕",
      voiceToneZh: "",
      microExpressionZh: "",
      bodyBeatZh: "",
    });
    expect(cue.microExpressionZh).toBeTruthy();
    expect(cue.bodyBeatZh).toMatch(/后退|门把|衣角/);
  });
});
