import { describe, expect, it } from "vitest";
import {
  buildManhuaClipQualityPrompt,
  isManhuaClipQualityInfraFailure,
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
      "DURATION_10S=YES",
      "NO_UNRELATED_CONTENT=NO",
      "SUMMARY=人物和剧情与首镜无关",
    ].join("\n");
    const report = parseManhuaClipQualityMarkdown(raw);
    expect(report.status).toBe("failed");
    expect(report.failedKeys).toContain("CHARACTER_MATCH");
    expect(report.failedKeys).toContain("NO_UNRELATED_CONTENT");
    expect(report.summary).toContain("人物和剧情");
  });

  it("builds a strict prompt with expected context", () => {
    const prompt = buildManhuaClipQualityPrompt("女主在盟誓堂递出密令");
    expect(prompt).toContain("女主在盟誓堂递出密令");
    expect(prompt).toContain("仅画面精美、接口成功或时长正确都不算通过");
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
});
