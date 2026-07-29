import { describe, expect, it } from "vitest";
import {
  MANHUA_ASSET_STILL_FULL_CREDITS,
  MANHUA_ASSET_STILL_SHARE_HALF_CREDITS,
  MANHUA_LIBRARY_ASSET_USE_CREDITS_ONE,
  MANHUA_LIBRARY_ASSET_USE_CREDITS_TWO,
  manhuaAssetStillCredits,
  manhuaAssetStillPriceLabelZh,
  manhuaLibraryAssetUseCredits,
  manhuaLibraryAssetUsePriceLabelZh,
  resolveManhuaAssetStillBilling,
} from "./manhuaAssetSharePricing";

describe("manhuaAssetSharePricing", () => {
  it("paid credits + share → half price and contribute", () => {
    const b = resolveManhuaAssetStillBilling({
      shareRequested: true,
      remainingGiftedCredits: 0,
    });
    expect(b.credits).toBe(MANHUA_ASSET_STILL_SHARE_HALF_CREDITS);
    expect(b.halfPriceApplied).toBe(true);
    expect(b.contribute).toBe(true);
    expect(b.giftedBlocksHalfPrice).toBe(false);
  });

  it("paid credits without share → full price, no library", () => {
    const b = resolveManhuaAssetStillBilling({
      shareRequested: false,
      remainingGiftedCredits: 0,
    });
    expect(b.credits).toBe(MANHUA_ASSET_STILL_FULL_CREDITS);
    expect(b.halfPriceApplied).toBe(false);
    expect(b.contribute).toBe(false);
  });

  it("gifted/redeem credits → full price, force contribute, no half", () => {
    const withShare = resolveManhuaAssetStillBilling({
      shareRequested: true,
      remainingGiftedCredits: 100,
    });
    const withoutShare = resolveManhuaAssetStillBilling({
      shareRequested: false,
      remainingGiftedCredits: 1,
    });
    for (const b of [withShare, withoutShare]) {
      expect(b.credits).toBe(MANHUA_ASSET_STILL_FULL_CREDITS);
      expect(b.halfPriceApplied).toBe(false);
      expect(b.contribute).toBe(true);
      expect(b.giftedBlocksHalfPrice).toBe(true);
      expect(b.noticeZh).toMatch(/不享|不适用/);
      expect(b.noticeZh).toMatch(/无条件|进库|进平台参考库/);
    }
  });

  it("labels disclose gifted vs half-price paths", () => {
    expect(
      manhuaAssetStillPriceLabelZh({
        shareToLibrary: true,
        remainingGiftedCredits: 0,
      }),
    ).toContain("半价");
    expect(
      manhuaAssetStillPriceLabelZh({
        shareToLibrary: true,
        remainingGiftedCredits: 10,
      }),
    ).toMatch(/兑换码|原价|进库/);
    expect(
      manhuaAssetStillCredits({
        shareToLibrary: true,
        remainingGiftedCredits: 10,
      }),
    ).toBe(MANHUA_ASSET_STILL_FULL_CREDITS);
  });
});

describe("库内资产消费侧计价（1张15/2张20）", () => {
  it("一张 15、两张 20", () => {
    expect(manhuaLibraryAssetUseCredits(1)).toBe(15);
    expect(manhuaLibraryAssetUseCredits(2)).toBe(20);
    expect(MANHUA_LIBRARY_ASSET_USE_CREDITS_ONE).toBe(15);
    expect(MANHUA_LIBRARY_ASSET_USE_CREDITS_TWO).toBe(20);
  });

  it("非法/零/负数按一张兜底", () => {
    expect(manhuaLibraryAssetUseCredits(0)).toBe(15);
    expect(manhuaLibraryAssetUseCredits(-3)).toBe(15);
    expect(manhuaLibraryAssetUseCredits(Number.NaN)).toBe(15);
  });

  it("超过两张按第二张增量(+5/张)叠加，不暴涨", () => {
    expect(manhuaLibraryAssetUseCredits(3)).toBe(25);
    expect(manhuaLibraryAssetUseCredits(4)).toBe(30);
  });

  it("价签透出张数", () => {
    expect(manhuaLibraryAssetUsePriceLabelZh(1)).toContain("15");
    expect(manhuaLibraryAssetUsePriceLabelZh(2)).toMatch(/20.*2 张/);
  });
});
