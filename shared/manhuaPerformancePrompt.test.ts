import { describe, expect, it } from "vitest";
import {
  extractManhuaPerformanceCue,
  extractPerformanceCuesFromScript,
  formatManhuaPerformanceInjectBlock,
  mergeManhuaPerformanceCue,
} from "./manhuaPerformancePrompt";
import {
  formatWorkbenchClipInjectBlock,
  formatWorkbenchShotInjectBlock,
  parseWorkbenchShotsFromText,
} from "./manhuaScriptWorkbench";

describe("manhuaPerformancePrompt (feel.mp4 lesson)", () => {
  it("extracts dialogue tone emotion and micro-expression", () => {
    const cue = extractManhuaPerformanceCue(
      "近景，4秒。过肩拍。女主猛地抬头，双眼发红泪在眼眶打转却未落。她压着哭腔用沙哑的声音问：「从前说过的话，都不算数了？」语气里满是委屈和不信。",
    );
    expect(cue.dialogueZh).toContain("从前说过的话");
    expect(cue.voiceToneZh || cue.emotionZh).toBeTruthy();
    expect(cue.microExpressionZh || cue.bodyBeatZh).toBeTruthy();
  });

  it("formats inject with no-burn dialogue lock", () => {
    const block = formatManhuaPerformanceInjectBlock(
      mergeManhuaPerformanceCue(undefined, "沙哑沉重：「是我对不住你。」下颌绷紧，不敢对视"),
      { stage: "clip", shotIndex: 2 },
    );
    expect(block).toContain("【人物表演·台词情绪");
    expect(block).toContain("是我对不住你");
    expect(block).toMatch(/禁止字幕|禁止烧/);
    expect(block).toContain("气口");
  });

  it("parses feel-style numbered shot into workbench inject", () => {
    const shots = parseWorkbenchShotsFromText(
      [
        "1. 近景：女主猛地抬头，眼眶发红泪未落，压着哭腔沙哑问：「从前说过的话，都不算数了？」满是委屈和不信",
        "2. 近景：男主攥拳别开脸，下颌绷紧，沙哑沉重：「是我对不住你。」不敢回头",
        "3. 平视：女主抬手擦眼角咬下唇，一字一顿：「我不怪你，我等你回来。」",
      ].join("\n"),
    );
    expect(shots.length).toBeGreaterThanOrEqual(3);
    expect(shots[0]?.dialogueZh || shots[0]?.actionZh).toMatch(/从前说过的话|不算数/);
    const key = formatWorkbenchShotInjectBlock(shots[0]!);
    expect(key).toContain("【人物表演·台词情绪");
    expect(key).toMatch(/从前说过的话|不算数/);
    const clip = formatWorkbenchClipInjectBlock(shots[1]!);
    expect(clip).toContain("【人物表演·台词情绪");
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
