import { describe, expect, it } from "vitest";
import {
  findGrowthMonotonicRegressions,
  resolveGuardPlatforms,
} from "../../scripts/verify-growth-monotonic.mjs";

const activePlatforms = ["douyin", "xiaohongshu", "bilibili", "weixin_channels"];

function snapshot(platforms: Record<string, {
  currentTotal: number;
  currentRetentionCap?: number;
  archivedTotal: number;
}>) {
  return { platforms };
}

describe("growth monotonic guard", () => {
  it("只检查基线显式声明的当前平台，允许退休平台从产物中移除", () => {
    const baseline = {
      activePlatforms,
      ...snapshot({
        douyin: { currentTotal: 100, archivedTotal: 100 },
        kuaishou: { currentTotal: 18_358, archivedTotal: 18_358 },
        toutiao: { currentTotal: 3_714, archivedTotal: 3_714 },
      }),
    };
    const before = snapshot({
      douyin: { currentTotal: 100, archivedTotal: 100 },
      kuaishou: { currentTotal: 18_358, archivedTotal: 18_358 },
      toutiao: { currentTotal: 3_714, archivedTotal: 3_714 },
    });
    const after = snapshot({
      douyin: { currentTotal: 100, archivedTotal: 100 },
      weixin_channels: { currentTotal: 20, archivedTotal: 20 },
    });

    expect(resolveGuardPlatforms(baseline, before, after)).toEqual(new Set(activePlatforms));
    expect(findGrowthMonotonicRegressions({ baseline, before, after })).toEqual([]);
  });

  it("当前平台仍发生超过容差的回退时继续阻断", () => {
    const baseline = {
      activePlatforms,
      ...snapshot({ douyin: { currentTotal: 100, archivedTotal: 100 } }),
    };
    const before = snapshot({ douyin: { currentTotal: 100, archivedTotal: 100 } });
    const after = snapshot({ douyin: { currentTotal: 80, archivedTotal: 100 } });

    expect(findGrowthMonotonicRegressions({ baseline, before, after })).toEqual([
      "douyin: currentTotal regressed 80 < 90 (floor 100, tolerance 10%)",
    ]);
  });

  it("允许小红书当前热缓存按声明上限从历史大池压缩到两万条", () => {
    const baseline = {
      activePlatforms,
      ...snapshot({
        xiaohongshu: {
          currentTotal: 79_549,
          currentRetentionCap: 20_000,
          archivedTotal: 78_894,
        },
      }),
    };
    const before = snapshot({
      xiaohongshu: { currentTotal: 591_222, archivedTotal: 591_343 },
    });
    const after = snapshot({
      xiaohongshu: { currentTotal: 20_000, archivedTotal: 591_343 },
    });

    expect(findGrowthMonotonicRegressions({ baseline, before, after })).toEqual([]);
  });

  it("热缓存跌破声明上限的容差后仍然阻断", () => {
    const baseline = {
      activePlatforms,
      ...snapshot({
        xiaohongshu: {
          currentTotal: 79_549,
          currentRetentionCap: 20_000,
          archivedTotal: 78_894,
        },
      }),
    };
    const before = snapshot({
      xiaohongshu: { currentTotal: 591_222, archivedTotal: 591_343 },
    });
    const after = snapshot({
      xiaohongshu: { currentTotal: 17_999, archivedTotal: 591_343 },
    });

    expect(findGrowthMonotonicRegressions({ baseline, before, after })).toEqual([
      "xiaohongshu: currentTotal regressed 17999 < 18000 (floor 20000, tolerance 10%)",
    ]);
  });

  it("旧基线没有 activePlatforms 时保持原来的全平台并集规则", () => {
    const baseline = snapshot({ kuaishou: { currentTotal: 100, archivedTotal: 100 } });
    const before = snapshot({ kuaishou: { currentTotal: 100, archivedTotal: 100 } });
    const after = snapshot({});

    expect(resolveGuardPlatforms(baseline, before, after)).toEqual(new Set(["kuaishou"]));
    expect(findGrowthMonotonicRegressions({ baseline, before, after })).toHaveLength(1);
  });
});
