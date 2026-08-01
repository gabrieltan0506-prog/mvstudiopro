import { describe, expect, it } from "vitest";
import {
  PLATFORM_COVER_HEADLINE_MAX_CHARS,
  clampPlatformCoverHeadline,
  countPlatformCoverHeadlineChars,
} from "./platformCreatorInsightFraming";
import { normalizePlatformVariants } from "./platformNativeVariants";

describe("platform coverHeadline max 13", () => {
  it("exports hard max 13", () => {
    expect(PLATFORM_COVER_HEADLINE_MAX_CHARS).toBe(13);
  });

  it("counts and clamps including punctuation", () => {
    const long = "想吃瘦，别减主食｜先做三件事";
    expect(countPlatformCoverHeadlineChars(long)).toBeGreaterThan(13);
    const clamped = clampPlatformCoverHeadline(long);
    expect(countPlatformCoverHeadlineChars(clamped)).toBe(13);
    expect(clamped).toBe("想吃瘦，别减主食｜先做三件");
  });

  it("normalizePlatformVariants clamps coverHeadline", () => {
    const rows = normalizePlatformVariants([
      {
        platform: "xiaohongshu",
        format: "图文",
        hook: "x",
        coverHeadline: "这是一条明显超过十三字限制的封面主句测试",
      },
    ]);
    expect(rows[0]?.coverHeadline.length).toBeLessThanOrEqual(13);
    expect(countPlatformCoverHeadlineChars(rows[0]!.coverHeadline)).toBe(13);
  });
});
