import { describe, expect, it } from "vitest";
import {
  buildManhuaClipQualityPrompt,
  isManhuaClipQualityInfraFailure,
  isManhuaClipQualityKeyartTextFailure,
  MANHUA_CLIP_QUALITY_KEYS,
  parseManhuaClipQualityMarkdown,
} from "./manhuaClipQuality";

describe("manhuaClipQuality", () => {
  it("passes only when every quality gate is YES", () => {
    const raw = [
      ...MANHUA_CLIP_QUALITY_KEYS.map((key) => `${key}=YES`),
      "SUMMARY=全部通过",
    ].join("\n");
    const report = parseManhuaClipQualityMarkdown(raw);
    expect(report.status).toBe("passed");
    expect(report.failedKeys).toEqual([]);
  });

  it("rejects an unrelated but otherwise valid video", () => {
    const raw = [
      "CHARACTER_MATCH=NO",
      "SCENE_MATCH=YES",
      "PLOT_MATCH=NO",
      "CAMERA_MOTION=YES",
      "LIGHTING=YES",
      "DURATION_OK=YES",
      "NO_UNRELATED_CONTENT=NO",
      "SUMMARY=人物和剧情与首镜无关",
    ].join("\n");
    const report = parseManhuaClipQualityMarkdown(raw);
    expect(report.status).toBe("failed");
    expect(report.failedKeys).toContain("CHARACTER_MATCH");
    expect(report.failedKeys).toContain("NO_UNRELATED_CONTENT");
    expect(report.summary).toContain("人物和剧情");
  });

  it("accepts legacy DURATION_10S as DURATION_OK", () => {
    const raw = [
      "CHARACTER_MATCH=YES",
      "SCENE_MATCH=YES",
      "PLOT_MATCH=YES",
      "CAMERA_MOTION=YES",
      "LIGHTING=YES",
      "DURATION_10S=YES",
      "NO_UNRELATED_CONTENT=YES",
      "SUMMARY=全部通过",
    ].join("\n");
    const report = parseManhuaClipQualityMarkdown(raw);
    expect(report.checks.DURATION_OK).toBe(true);
    expect(report.status).toBe("passed");
  });

  it("builds a fragment-scoped prompt with duration", () => {
    const prompt = buildManhuaClipQualityPrompt({
      expectedContext: "女主在盟誓堂递出密令",
      expectedDurationSec: 2.5,
      shotIndex: 1,
    });
    expect(prompt).toContain("女主在盟誓堂递出密令");
    expect(prompt).toContain("约 2.5 秒");
    expect(prompt).toContain("DURATION_OK");
    expect(prompt).toContain("只评判本镜");
    expect(prompt).not.toContain("DURATION_10S=YES或NO");
  });

  it("detects quality infra failure separately from content fail", () => {
    expect(
      isManhuaClipQualityInfraFailure({
        summary: "智能质检暂不可用（非成片内容判定），成片已保留但暂不进成片坞",
        raw: "Failed to fetch",
        failedKeys: [...MANHUA_CLIP_QUALITY_KEYS],
      }),
    ).toBe(true);
    expect(
      isManhuaClipQualityInfraFailure({
        summary: "人物与首镜不符",
        raw: "CHARACTER_MATCH=NO\nSUMMARY=人物与首镜不符",
        failedKeys: ["CHARACTER_MATCH"],
      }),
    ).toBe(false);
  });

  it("flags keyart text failures for rerun hint", () => {
    expect(
      isManhuaClipQualityKeyartTextFailure({
        summary: "首镜含违规文字，请重出静帧",
        raw: "NO_UNRELATED_CONTENT=NO",
        failedKeys: ["NO_UNRELATED_CONTENT"],
      }),
    ).toBe(true);
  });
});
