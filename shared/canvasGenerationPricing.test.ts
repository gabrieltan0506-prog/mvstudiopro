import { describe, expect, it } from "vitest";
import {
  CANVAS_IMAGE_CREDITS_PER_SHOT,
  CANVAS_VIDEO_CREDITS_CLIP,
  CANVAS_VIDEO_CREDITS_CLIP_1080P,
  CANVAS_VIDEO_CREDITS_CLIP_2K,
  CANVAS_VIDEO_CREDITS_CLIP_4K,
  CANVAS_VIDEO_CREDITS_CLIP_LONG,
  CANVAS_VIDEO_CREDITS_CLIP_MINI,
  canvasVideoClipCredits,
  describeCanvasVideoClipPrice,
  isMiniPricedVideoModel,
  MANHUA_EPISODE_CREDITS,
  MANHUA_EPISODE_CREDITS_MINI,
  MANHUA_EPISODE_CREDITS_PER_SEGMENT,
  MANHUA_EPISODE_CREDITS_PER_SEGMENT_MINI,
  MANHUA_EPISODE_SEGMENTS_FOR_PRICING_MINI,
  manhuaEpisodeTotalCredits,
  normalizeCanvasVideoResolution,
} from "./canvasGenerationPricing";

describe("canvasVideoClipCredits", () => {
  it("15 秒及以内按单段价", () => {
    expect(canvasVideoClipCredits({ durationSec: 5 })).toBe(CANVAS_VIDEO_CREDITS_CLIP);
    expect(canvasVideoClipCredits({ durationSec: 15 })).toBe(CANVAS_VIDEO_CREDITS_CLIP);
    // Happy Horse 画布成片与 2.0/H3 同档 720p 零售（≤15s → 118）
    expect(canvasVideoClipCredits({ durationSec: 15, resolution: "720p" })).toBe(
      CANVAS_VIDEO_CREDITS_CLIP,
    );
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
    /**
     * 原来这里断言「售价按像素比 2.25× / 4× / 9× 同步」。
     * 2026-08-09 实测把这个前提推翻了——EvoLink 同一条 5 秒片，
     * 720p $0.993、1080p $2.482、4K $5.063，折成每秒是 1.00 / 2.50 / 5.10 倍，
     * 而像素倍数是 1 / 2.25 / 9：**高档有明显折扣，成本不随像素线性增长**。
     * 4K 按 9 倍定价（1062）因此高估成本 26%，已按实测下调到 900。
     *
     * 所以这里只保留「档位越高越贵」这个不变量，不再假装存在某个像素公式。
     */
    expect(CANVAS_VIDEO_CREDITS_CLIP_1080P).toBeGreaterThan(CANVAS_VIDEO_CREDITS_CLIP);
    expect(CANVAS_VIDEO_CREDITS_CLIP_2K).toBeGreaterThan(CANVAS_VIDEO_CREDITS_CLIP_1080P);
    expect(CANVAS_VIDEO_CREDITS_CLIP_4K).toBeGreaterThan(CANVAS_VIDEO_CREDITS_CLIP_2K);
  });

  it("缺省与脏值一律回落 720p，不会白送高画质", () => {
    expect(normalizeCanvasVideoResolution(undefined)).toBe("720p");
    expect(normalizeCanvasVideoResolution("8K")).toBe("720p");
    expect(canvasVideoClipCredits({})).toBe(CANVAS_VIDEO_CREDITS_CLIP);
    // OpenRouter 的 1K 写法等同 1080p
    expect(normalizeCanvasVideoResolution("1k")).toBe("1080p");
    expect(canvasVideoClipCredits({ resolution: "1k" })).toBe(CANVAS_VIDEO_CREDITS_CLIP_1080P);
  });

  /**
   * 原来这条断言「加长档不吃画质参数」——那正是个收费漏洞：长片判断压在画质查表之前，
   * 一条 30 秒 4K 只收 240，而 15 秒 4K 收 688，**越长越便宜**，
   * 用户把时长拉过 15 秒就能拿高画质当白菜价。现在长档按同一倍率抬。
   */
  it("加长档按画质等比例抬价，720p 长档维持原值", () => {
    expect(canvasVideoClipCredits({ durationSec: 30, resolution: "720p" })).toBe(
      CANVAS_VIDEO_CREDITS_CLIP_LONG,
    );
    const long4K = canvasVideoClipCredits({ durationSec: 30, resolution: "4K" });
    expect(long4K).toBeGreaterThan(CANVAS_VIDEO_CREDITS_CLIP_LONG);
    // 与短档同一比例：4K 长档 / 4K 短档 === 720p 长档 / 720p 短档
    expect(long4K / CANVAS_VIDEO_CREDITS_CLIP_4K).toBeCloseTo(
      CANVAS_VIDEO_CREDITS_CLIP_LONG / CANVAS_VIDEO_CREDITS_CLIP,
      2,
    );
  });

  it("漫剧段价仍是整集折算价，不吃画质参数", () => {
    expect(canvasVideoClipCredits({ isEpisodeSegment: true, resolution: "4K" })).toBe(
      MANHUA_EPISODE_CREDITS_PER_SEGMENT,
    );
  });

  it("说明文案带出整集价", () => {
    expect(describeCanvasVideoClipPrice({ isEpisodeSegment: true })).toContain("整集");
    expect(describeCanvasVideoClipPrice({ durationSec: 15 })).toBe("118 积分/段");
  });
});

describe("Seedance 2.0 Mini 草稿档（用户 2026-08-09 拍板）", () => {
  it("mini 一个价：不吃画质加价表也不吃加长档", () => {
    expect(canvasVideoClipCredits({ videoModel: "seedance-2.0-mini" })).toBe(
      CANVAS_VIDEO_CREDITS_CLIP_MINI,
    );
    expect(
      canvasVideoClipCredits({ videoModel: "seedance-2.0-mini", resolution: "4K" }),
    ).toBe(CANVAS_VIDEO_CREDITS_CLIP_MINI);
    // mini 上游最长 15 秒，就算前端传了 30 也不该跳到 240 的加长档
    expect(
      canvasVideoClipCredits({ videoModel: "seedance-2.0-mini", durationSec: 30 }),
    ).toBe(CANVAS_VIDEO_CREDITS_CLIP_MINI);
  });

  it("mini 整集草稿包：6 段 × 28 = 168，且远低于正片档", () => {
    expect(
      canvasVideoClipCredits({ videoModel: "seedance-2.0-mini", isEpisodeSegment: true }),
    ).toBe(MANHUA_EPISODE_CREDITS_PER_SEGMENT_MINI);
    expect(
      MANHUA_EPISODE_CREDITS_PER_SEGMENT_MINI * MANHUA_EPISODE_SEGMENTS_FOR_PRICING_MINI,
    ).toBe(MANHUA_EPISODE_CREDITS_MINI);
    expect(MANHUA_EPISODE_CREDITS_MINI).toBeLessThan(MANHUA_EPISODE_CREDITS);
    expect(CANVAS_VIDEO_CREDITS_CLIP_MINI).toBeLessThan(CANVAS_VIDEO_CREDITS_CLIP);
  });

  it("认得 jobs / 画布两侧的 mini 别名，其余引擎不受影响", () => {
    for (const alias of ["seedance-2.0-mini", "2.0-mini", "mini", "2.0mini", "MINI"]) {
      expect(isMiniPricedVideoModel(alias)).toBe(true);
    }
    for (const other of ["seedance-2.0", "seedance-2.0-fast", "seedance-2.5", "minimax-hailuo-3", "", null]) {
      expect(isMiniPricedVideoModel(other)).toBe(false);
    }
    // 不传 videoModel 时必须保持旧口径，避免存量请求被误当 mini 少收
    expect(canvasVideoClipCredits({ durationSec: 15 })).toBe(CANVAS_VIDEO_CREDITS_CLIP);
    expect(canvasVideoClipCredits({ isEpisodeSegment: true })).toBe(
      MANHUA_EPISODE_CREDITS_PER_SEGMENT,
    );
  });
});

describe("manhuaEpisodeTotalCredits", () => {
  /**
   * 实收是「段价 × 段数」，所以整集总额随引擎段数变。
   * 这条锁的就是别再把 688 当成所有引擎的整集价印给用户。
   */
  it("按引擎真实段数算整集价，不再一律印 688", () => {
    expect(manhuaEpisodeTotalCredits({ videoModel: "seedance-2.5", segmentCount: 4 })).toBe(
      MANHUA_EPISODE_CREDITS,
    );
    expect(manhuaEpisodeTotalCredits({ videoModel: "seedance-2.0-fast", segmentCount: 6 })).toBe(
      MANHUA_EPISODE_CREDITS_PER_SEGMENT * 6,
    );
    expect(manhuaEpisodeTotalCredits({ videoModel: "minimax-hailuo-3", segmentCount: 8 })).toBe(
      MANHUA_EPISODE_CREDITS_PER_SEGMENT * 8,
    );
    expect(manhuaEpisodeTotalCredits({ videoModel: "seedance-2.0-mini", segmentCount: 6 })).toBe(
      MANHUA_EPISODE_CREDITS_MINI,
    );
  });

  it("段数缺省/脏值回落到该档的定价段数", () => {
    expect(manhuaEpisodeTotalCredits({})).toBe(MANHUA_EPISODE_CREDITS);
    expect(manhuaEpisodeTotalCredits({ segmentCount: 0 })).toBe(MANHUA_EPISODE_CREDITS);
    expect(manhuaEpisodeTotalCredits({ segmentCount: Number.NaN })).toBe(MANHUA_EPISODE_CREDITS);
    expect(manhuaEpisodeTotalCredits({ videoModel: "seedance-2.0-mini" })).toBe(
      MANHUA_EPISODE_CREDITS_MINI,
    );
  });

  it("说明文案跟着段数走", () => {
    expect(
      describeCanvasVideoClipPrice({ isEpisodeSegment: true, episodeSegmentCount: 6 }),
    ).toBe(`${MANHUA_EPISODE_CREDITS_PER_SEGMENT} 积分/段（整集 ${MANHUA_EPISODE_CREDITS_PER_SEGMENT * 6}）`);
    expect(
      describeCanvasVideoClipPrice({
        isEpisodeSegment: true,
        videoModel: "seedance-2.0-mini",
        episodeSegmentCount: MANHUA_EPISODE_SEGMENTS_FOR_PRICING_MINI,
      }),
    ).toBe(`${MANHUA_EPISODE_CREDITS_PER_SEGMENT_MINI} 积分/段（整集 ${MANHUA_EPISODE_CREDITS_MINI}）`);
  });
});
