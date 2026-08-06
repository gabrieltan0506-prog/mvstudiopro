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

  it("超长时在分隔符处断句，宁可短也不印残句", () => {
    const long = "想吃瘦，别减主食｜先做三件事";
    expect(countPlatformCoverHeadlineChars(long)).toBeGreaterThan(13);
    const clamped = clampPlatformCoverHeadline(long);
    // 旧行为会砍成「…先做三件」，把「事」切掉；现在退到「｜」之前收尾
    expect(clamped).toBe("想吃瘦，别减主食");
    expect(countPlatformCoverHeadlineChars(clamped)).toBeLessThanOrEqual(13);
  });

  it("没有分隔符可断时才硬砍到 13 字", () => {
    const clamped = clampPlatformCoverHeadline("这是一条明显超过十三字限制的封面主句测试");
    expect(countPlatformCoverHeadlineChars(clamped)).toBe(13);
  });

  it("分隔符太靠前就不用它，否则只剩两三个字没法看", () => {
    const clamped = clampPlatformCoverHeadline("三年，我把整间店的账目全部重做了一遍");
    expect(countPlatformCoverHeadlineChars(clamped)).toBe(13);
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
    expect(countPlatformCoverHeadlineChars(rows[0]!.coverHeadline)).toBeLessThanOrEqual(13);
  });
});
