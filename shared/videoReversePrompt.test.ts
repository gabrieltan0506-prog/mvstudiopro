import { describe, expect, it } from "vitest";
import {
  VIDEO_REVERSE_EIGHT_DIMS_ZH,
  buildVideoReverseUserPrompt,
  parseVideoReverseOutputMode,
} from "./videoReversePrompt";

describe("videoReversePrompt ⑨A", () => {
  it("exposes eight craft dimensions", () => {
    expect(VIDEO_REVERSE_EIGHT_DIMS_ZH).toHaveLength(8);
    expect(VIDEO_REVERSE_EIGHT_DIMS_ZH).toContain("灯光");
    expect(VIDEO_REVERSE_EIGHT_DIMS_ZH).toContain("转场/卡点");
  });

  it("builds zh / en / compact structures", () => {
    const zh = buildVideoReverseUserPrompt({ outputMode: "zh" });
    expect(zh).toContain("八维分镜表");
    expect(zh).toContain("主体动作");

    const en = buildVideoReverseUserPrompt({ outputMode: "en" });
    expect(en).toContain("Eight-dimension");
    expect(en).toContain("Lighting");

    const compact = buildVideoReverseUserPrompt({ outputMode: "compact", userHint: "只看运镜" });
    expect(compact).toContain("精简");
    expect(compact).toContain("只看运镜");
    expect(compact.length).toBeLessThan(zh.length);
  });

  it("parses outputMode aliases", () => {
    expect(parseVideoReverseOutputMode("精简")).toBe("compact");
    expect(parseVideoReverseOutputMode("en")).toBe("en");
    expect(parseVideoReverseOutputMode("")).toBe("zh");
  });
});
