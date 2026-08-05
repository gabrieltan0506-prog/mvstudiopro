import { describe, expect, it } from "vitest";
import {
  CANVAS_IMAGE_CREDITS_PER_SHOT,
  CANVAS_VIDEO_CREDITS_CLIP,
  CANVAS_VIDEO_CREDITS_CLIP_LONG,
  canvasVideoClipCredits,
  describeCanvasVideoClipPrice,
  MANHUA_EPISODE_CREDITS,
  MANHUA_EPISODE_CREDITS_PER_SEGMENT,
} from "./canvasGenerationPricing";

describe("canvasVideoClipCredits", () => {
  it("15 秒及以内按单段价", () => {
    expect(canvasVideoClipCredits({ durationSec: 5 })).toBe(CANVAS_VIDEO_CREDITS_CLIP);
    expect(canvasVideoClipCredits({ durationSec: 15 })).toBe(CANVAS_VIDEO_CREDITS_CLIP);
  });

  it("超过 15 秒按加长档", () => {
    expect(canvasVideoClipCredits({ durationSec: 16 })).toBe(CANVAS_VIDEO_CREDITS_CLIP_LONG);
    expect(canvasVideoClipCredits({ durationSec: 30 })).toBe(CANVAS_VIDEO_CREDITS_CLIP_LONG);
  });

  it("缺时长时退单段价，不会白给加长", () => {
    expect(canvasVideoClipCredits({})).toBe(CANVAS_VIDEO_CREDITS_CLIP);
    expect(canvasVideoClipCredits({ durationSec: null })).toBe(CANVAS_VIDEO_CREDITS_CLIP);
    expect(canvasVideoClipCredits({ durationSec: Number.NaN })).toBe(CANVAS_VIDEO_CREDITS_CLIP);
  });

  it("漫剧分段走整集折算价，且与整集价自洽", () => {
    expect(canvasVideoClipCredits({ isEpisodeSegment: true, durationSec: 30 })).toBe(
      MANHUA_EPISODE_CREDITS_PER_SEGMENT,
    );
    // 一集 4 段 × 段价 应当等于对外宣称的整集价
    expect(MANHUA_EPISODE_CREDITS_PER_SEGMENT * 4).toBe(MANHUA_EPISODE_CREDITS);
  });

  it("段价高于单段价：一集普遍是 30 秒档，不能比自由画布单段还便宜到亏本", () => {
    expect(MANHUA_EPISODE_CREDITS_PER_SEGMENT).toBeGreaterThan(CANVAS_VIDEO_CREDITS_CLIP);
  });

  it("出图单价与创作台生图同档，不能回到 0", () => {
    expect(CANVAS_IMAGE_CREDITS_PER_SHOT).toBe(54);
  });

  it("说明文案带出整集价", () => {
    expect(describeCanvasVideoClipPrice({ isEpisodeSegment: true })).toContain("整集");
    expect(describeCanvasVideoClipPrice({ durationSec: 15 })).toBe("118 积分/段");
  });
});
