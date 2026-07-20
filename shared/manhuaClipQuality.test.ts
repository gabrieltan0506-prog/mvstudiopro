import { describe, expect, it } from "vitest";
import {
  buildManhuaClipQualityPrompt,
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
});
