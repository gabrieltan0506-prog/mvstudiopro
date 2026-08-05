import { describe, expect, it } from "vitest";
import {
  CANVAS_IMAGE_CREDITS_PER_SHOT,
  CANVAS_VIDEO_CREDITS_CLIP,
  CANVAS_VIDEO_CREDITS_CLIP_1080P,
  CANVAS_VIDEO_CREDITS_CLIP_2K,
  CANVAS_VIDEO_CREDITS_CLIP_4K,
  CANVAS_VIDEO_CREDITS_CLIP_LONG,
  canvasVideoClipCredits,
  describeCanvasVideoClipPrice,
  MANHUA_EPISODE_CREDITS,
  MANHUA_EPISODE_CREDITS_PER_SEGMENT,
  normalizeCanvasVideoResolution,
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

  it("画质按像素比加价，各档毛利率一致", () => {
    expect(canvasVideoClipCredits({ resolution: "720p" })).toBe(CANVAS_VIDEO_CREDITS_CLIP);
    expect(canvasVideoClipCredits({ resolution: "1080p" })).toBe(CANVAS_VIDEO_CREDITS_CLIP_1080P);
    expect(canvasVideoClipCredits({ resolution: "2K" })).toBe(CANVAS_VIDEO_CREDITS_CLIP_2K);
    expect(canvasVideoClipCredits({ resolution: "4K" })).toBe(CANVAS_VIDEO_CREDITS_CLIP_4K);
    // 成本按像素线性涨（1080p 2.25×、2K 4×、4K 9×），售价须同步，否则高画质档吃掉毛利
    expect(CANVAS_VIDEO_CREDITS_CLIP_1080P / CANVAS_VIDEO_CREDITS_CLIP).toBeCloseTo(2.25, 1);
    expect(CANVAS_VIDEO_CREDITS_CLIP_2K / CANVAS_VIDEO_CREDITS_CLIP).toBeCloseTo(4, 1);
    expect(CANVAS_VIDEO_CREDITS_CLIP_4K / CANVAS_VIDEO_CREDITS_CLIP).toBeCloseTo(9, 1);
  });

  it("缺省与脏值一律回落 720p，不会白送高画质", () => {
    expect(normalizeCanvasVideoResolution(undefined)).toBe("720p");
    expect(normalizeCanvasVideoResolution("8K")).toBe("720p");
    expect(canvasVideoClipCredits({})).toBe(CANVAS_VIDEO_CREDITS_CLIP);
    // OpenRouter 的 1K 写法等同 1080p
    expect(normalizeCanvasVideoResolution("1k")).toBe("1080p");
    expect(canvasVideoClipCredits({ resolution: "1k" })).toBe(CANVAS_VIDEO_CREDITS_CLIP_1080P);
  });

  it("加长档与漫剧段价不吃画质参数", () => {
    expect(canvasVideoClipCredits({ durationSec: 30, resolution: "4K" })).toBe(
      CANVAS_VIDEO_CREDITS_CLIP_LONG,
    );
    expect(canvasVideoClipCredits({ isEpisodeSegment: true, resolution: "4K" })).toBe(
      MANHUA_EPISODE_CREDITS_PER_SEGMENT,
    );
  });

  it("说明文案带出整集价", () => {
    expect(describeCanvasVideoClipPrice({ isEpisodeSegment: true })).toContain("整集");
    expect(describeCanvasVideoClipPrice({ durationSec: 15 })).toBe("118 积分/段");
  });
});
