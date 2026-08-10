import { describe, expect, it } from "vitest";
import {
  MANHUA_WRITER_EXPAND_CREDITS_PER_EPISODE,
  MANHUA_WRITER_EXPAND_TIERS,
  resolveManhuaWriterExpandQuota,
} from "./manhuaWriterExpandPricing";

describe("manhuaWriterExpandPricing", () => {
  it("charges every expansion without first-use or daily freebies", () => {
    const first = resolveManhuaWriterExpandQuota({
      usedEver: 0,
      usedToday: 0,
      tier: "excellent",
      episodeCount: 2,
    });
    expect(first.nextFree).toBe(false);
    expect(first.firstFreeLeft).toBe(0);
    expect(first.nextCredits).toBe(2);
  });

  it("prices the premium long-form tier at five credits per episode", () => {
    expect(MANHUA_WRITER_EXPAND_TIERS.map((tier) => tier.id)).toContain("transcendent");
    expect(MANHUA_WRITER_EXPAND_CREDITS_PER_EPISODE.transcendent).toBe(5);
    expect(
      resolveManhuaWriterExpandQuota({
        usedEver: 99,
        usedToday: 9,
        tier: "transcendent",
        episodeCount: 6,
      }).nextCredits,
    ).toBe(30);
  });
});
