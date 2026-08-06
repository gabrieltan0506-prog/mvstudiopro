import { describe, expect, it } from "vitest";
import { PLATFORM_ENGINE_TIER_EFFORT, platformEngineEffort } from "./platformEngineTiers.js";
import {
  PLATFORM_TOPIC_SHORTLIST_TIER_COUNTS,
  platformTopicShortlistTierCredits,
  resolvePlatformTopicShortlistQuota,
} from "./platformTopicShortlist.js";

describe("platformTopicShortlistTierCredits", () => {
  it("三档 6 条与 8 条的价钱写死，避免以后被顺手改低", () => {
    expect(platformTopicShortlistTierCredits({ tier: "excellent", count: 6 }).total).toBe(6);
    expect(platformTopicShortlistTierCredits({ tier: "excellent", count: 8 }).total).toBe(8);
    expect(platformTopicShortlistTierCredits({ tier: "superb", count: 6 }).total).toBe(12);
    expect(platformTopicShortlistTierCredits({ tier: "superb", count: 8 }).total).toBe(16);
    expect(platformTopicShortlistTierCredits({ tier: "top", count: 6 }).total).toBe(18);
    expect(platformTopicShortlistTierCredits({ tier: "top", count: 8 }).total).toBe(24);
  });

  it("卓越档 20 条仍与旧价对齐（基础 12 + 14×2 = 40）", () => {
    expect(platformTopicShortlistTierCredits({ tier: "superb", count: 20 }).total).toBe(40);
  });

  it("只给 6 / 8 两个选项", () => {
    expect([...PLATFORM_TOPIC_SHORTLIST_TIER_COUNTS]).toEqual([6, 8]);
  });
});

describe("resolvePlatformTopicShortlistQuota", () => {
  it("头 3 次每次给 2 条", () => {
    const q = resolvePlatformTopicShortlistQuota({ usedEver: 0, usedToday: 0 });
    expect(q.nextFree).toBe(true);
    expect(q.freeTopics).toBe(2);
    expect(q.firstFreeLeft).toBe(3);
    expect(resolvePlatformTopicShortlistQuota({ usedEver: 2, usedToday: 2 }).freeTopics).toBe(2);
  });

  it("头 3 次用完之后每天只剩 1 次、且只给 1 条", () => {
    const q = resolvePlatformTopicShortlistQuota({ usedEver: 3, usedToday: 0 });
    expect(q.nextFree).toBe(true);
    expect(q.freeTopics).toBe(1);
    expect(q.firstFreeLeft).toBe(0);
  });

  it("当天那次用掉就不再免费", () => {
    expect(resolvePlatformTopicShortlistQuota({ usedEver: 5, usedToday: 1 }).nextFree).toBe(false);
  });

  it("头 3 次期间不受当天次数限制（同一天连用 3 次仍免费）", () => {
    expect(resolvePlatformTopicShortlistQuota({ usedEver: 1, usedToday: 1 }).nextFree).toBe(true);
  });
});

describe("platformEngineEffort", () => {
  it("选题走中档：Kimi 的三级是 low|high|max，中档即 high（不再发 max）", () => {
    expect(platformEngineEffort("shortlist", "superb")).toBe("high");
    expect(PLATFORM_ENGINE_TIER_EFFORT.shortlist.superb).not.toBe("max");
  });

  it("润色反而用力：出稿只有一段文字，值得多想", () => {
    expect(platformEngineEffort("polish", "excellent")).toBe("xhigh");
    expect(platformEngineEffort("polish", "superb")).toBe("high");
  });
});
