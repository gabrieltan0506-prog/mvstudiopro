import { describe, expect, it } from "vitest";
import {
  MANHUA_ASSET_STILL_FULL_CREDITS,
  MANHUA_ASSET_STILL_SHARE_HALF_CREDITS,
  manhuaAssetStillCredits,
  manhuaAssetStillPriceLabelZh,
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
