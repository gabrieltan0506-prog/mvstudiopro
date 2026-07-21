import { describe, expect, it } from "vitest";
import {
  extractManhuaPerformanceCue,
  extractPerformanceCuesFromScript,
  formatManhuaPerformanceInjectBlock,
  mergeManhuaPerformanceCue,
  stripQuotedDialogueFromAction,
} from "./manhuaPerformancePrompt";
import {
  formatWorkbenchClipInjectBlock,
  formatWorkbenchSegmentClipInjectBlock,
  formatWorkbenchShotInjectBlock,
  parseWorkbenchShotsFromText,
} from "./manhuaScriptWorkbench";

describe("manhuaPerformancePrompt dialogue split", () => {
  it("extracts dialogue tone emotion and micro-expression", () => {
    const cue = extractManhuaPerformanceCue(
      "近景，4秒。过肩拍。女主猛地抬头，双眼发红泪在眼眶打转却未落。她压着哭腔用沙哑的声音问：「从前说过的话，都不算数了？」语气里满是委屈和不信。",
    );
    expect(cue.dialogueZh).toContain("从前说过的话");
    expect(cue.voiceToneZh || cue.emotionZh).toBeTruthy();
    expect(cue.microExpressionZh || cue.bodyBeatZh).toBeTruthy();
  });

  it("key_art omits dialogue literal; clip keeps it", () => {
    const cue = mergeManhuaPerformanceCue(
      undefined,
      "沙哑沉重：「是我对不住你。」下颌绷紧，不敢对视",
    );
    const key = formatManhuaPerformanceInjectBlock(cue, { stage: "key_art", shotIndex: 1 });
    expect(key).toContain("【人物表演·静帧");
    expect(key).not.toContain("是我对不住你");
    expect(key).not.toMatch(/台词（/);
    expect(key).toContain("口型开合");

    const clip = formatManhuaPerformanceInjectBlock(cue, { stage: "clip", shotIndex: 2 });
    expect(clip).toContain("是我对不住你");
    expect(clip).toContain("气口");
    expect(clip).toMatch(/禁止字幕|禁止烧/);
  });

  it("strips quoted dialogue from action for stills", () => {
    expect(
      stripQuotedDialogueFromAction("女主问：「从前说过的话，都不算数了？」猛地抬头"),
    ).not.toContain("不算数");
    expect(stripQuotedDialogueFromAction("女主问：「从前说过的话，都不算数了？」猛地抬头")).toMatch(
      /猛地抬头/,
    );
  });

  it("workbench keyart inject has no dialogue quotes; segment clip has chain", () => {
    const shots = parseWorkbenchShotsFromText(
      [
        "1. 近景：女主猛地抬头，眼眶发红泪未落，压着哭腔沙哑问：「从前说过的话，都不算数了？」满是委屈和不信",
        "2. 近景：男主攥拳别开脸，下颌绷紧，沙哑沉重：「是我对不住你。」不敢回头",
        "3. 平视：女主抬手擦眼角咬下唇，一字一顿：「我不怪你，我等你回来。」",
      ].join("\n"),
    );
    expect(shots.length).toBeGreaterThanOrEqual(3);
    const key = formatWorkbenchShotInjectBlock(shots[0]!);
    expect(key).toContain("【人物表演·静帧");
    expect(key).not.toContain("不算数");
    expect(key).not.toMatch(/「[^」]+」/);

    const clip = formatWorkbenchSegmentClipInjectBlock({
      segmentIndex: 1,
      durationSec: 15,
      shots: shots.slice(0, 2),
    });
    expect(clip).toMatch(/段内对白链|台词（口型气口依据）|从前说过的话|是我对不住你/);
    expect(formatWorkbenchClipInjectBlock(shots[1]!)).toContain("是我对不住你");
  });

  it("pulls performance lines from full script for brief", () => {
    const cues = extractPerformanceCuesFromScript(
      [
        "女主问：「从前说过的话，都不算数了？」语气委屈和不信，双眼发红。",
        "男主：「是我对不住你。」沙哑沉重，满是愧疚。",
      ].join("\n"),
    );
    expect(cues.length).toBeGreaterThanOrEqual(1);
    expect(cues[0]?.dialogueZh).toBeTruthy();
  });
});
