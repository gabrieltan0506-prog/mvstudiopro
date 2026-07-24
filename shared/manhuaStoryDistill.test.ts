import { describe, expect, it } from "vitest";
import {
  buildManhuaEpisodeSegmentPlanFixtureMarkdown,
  parseManhuaEpisodeSegmentPlanFromMarkdown,
} from "./manhuaEpisodeSegmentPlan";
import {
  buildManhuaProductionStepStates,
  canManhuaBurnVideo,
  resolveManhuaProductionNowSummary,
} from "./manhuaProductionPipeline";
import {
  buildManhuaSecondCueSheet,
  buildWorkbenchShotsFromSegmentPlan,
  formatManhuaKeyframeImage2Prompt,
  formatManhuaScreenplayEnginePromptBlock,
  formatManhuaSecondCueSheetBlock,
  resolveKeyframeRoleInSegment,
} from "./manhuaStoryDistill";

describe("manhuaStoryDistill", () => {
  it("assigns start/key/edit_out for 3 keyarts", () => {
    expect(resolveKeyframeRoleInSegment(1, 3)).toBe("start");
    expect(resolveKeyframeRoleInSegment(2, 3)).toBe("key_action");
    expect(resolveKeyframeRoleInSegment(3, 3)).toBe("edit_out");
  });

  it("builds 12×3 shots from segment plan with roles", () => {
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(
      buildManhuaEpisodeSegmentPlanFixtureMarkdown(),
    );
    const shots = buildWorkbenchShotsFromSegmentPlan(plan);
    expect(shots).toHaveLength(36);
    expect(shots[0]?.keyframeRole).toBe("start");
    expect(shots[1]?.keyframeRole).toBe("key_action");
    expect(shots[2]?.keyframeRole).toBe("edit_out");
  });

  it("builds second cue sheet and image-2 prompt without tech leak", () => {
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(
      buildManhuaEpisodeSegmentPlanFixtureMarkdown(),
    );
    const shots = buildWorkbenchShotsFromSegmentPlan(plan).slice(0, 3);
    const cue = buildManhuaSecondCueSheet({
      segment: plan.segments[0]!,
      shots,
      durationSec: 15,
    });
    expect(cue).toHaveLength(3);
    expect(cue[0]?.startSec).toBe(0);
    expect(cue[2]?.endSec).toBe(15);
    const block = formatManhuaSecondCueSheetBlock(cue, { segmentIndex: 1 });
    expect(block).toContain("按秒导戏单");
    expect(block).toContain("起幅");
    const img = formatManhuaKeyframeImage2Prompt({
      shot: shots[0]!,
      segment: plan.segments[0],
      imageStyleZh: "冷青烛金，雨雾空气",
    });
    expect(img).toContain("关键静帧");
    expect(img).not.toMatch(/GPT|OpenAI|Seedance|Nano Banana/i);
    expect(formatManhuaScreenplayEnginePromptBlock()).toContain("故事发动机");
  });

  it("locks video until keyart+cue ready; allows burn without full asset/10-seg lock", () => {
    const locked = canManhuaBurnVideo({
      hasTopic: true,
      hasScreenplay: true,
      assetsLocked: true,
      segmentPlanReady: true,
      keyartsReady: true,
      cueSheetReady: false,
      hasClip: false,
    });
    expect(locked).toBe(false);
    expect(
      canManhuaBurnVideo({
        hasTopic: true,
        hasScreenplay: true,
        assetsLocked: false,
        segmentPlanReady: false,
        keyartsReady: true,
        cueSheetReady: true,
        hasClip: false,
      }),
    ).toBe(true);
    const steps = buildManhuaProductionStepStates({
      hasTopic: true,
      hasScreenplay: true,
      assetsLocked: true,
      segmentPlanReady: true,
      keyartsReady: false,
      cueSheetReady: false,
      hasClip: false,
    });
    expect(steps.find((s) => s.id === "video")?.status).toBe("locked");
    expect(steps.find((s) => s.id === "keyart")?.status).toBe("current");
    const now = resolveManhuaProductionNowSummary({
      hasTopic: true,
      hasScreenplay: true,
      assetsLocked: true,
      segmentPlanReady: true,
      keyartsReady: false,
      cueSheetReady: false,
      hasClip: false,
    });
    expect(now.label).toBe("关键静帧");
    expect(now.stepIndex).toBe(5);
    expect(now.nextLabel).toBe("导戏单");
  });
});
