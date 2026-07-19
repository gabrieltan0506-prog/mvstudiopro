import { describe, expect, it } from "vitest";
import { CREDIT_COSTS } from "@shared/plans";
import {
  buildCreatePrimaryCta,
  buildToolsPrimaryCta,
  buildTrendPrimaryCta,
  describePlatformCtaMatrix,
} from "./platformWorkbenchCta";

describe("platformWorkbenchCta", () => {
  it("create shortlist CTA uses plans credits", () => {
    const cta = buildCreatePrimaryCta({
      createStep: "topics",
      focusPrompt: "身份：创作者",
      topicShortlistCount: 6,
      isAuthenticated: true,
      shortlistPending: false,
      fullcaseBusy: false,
      customNoteBusy: false,
      hasTopicResults: false,
    });
    expect(cta.handlerKey).toBe("generateTopicShortlist");
    expect(cta.credits).toBe(CREDIT_COSTS.platformTopicShortlist);
    expect(cta.disabled).toBe(false);
  });

  it("trend CTA requires single platform", () => {
    const bad = buildTrendPrimaryCta({
      selectedPlatformCount: 0,
      isAuthenticated: true,
      busy: false,
    });
    expect(bad.disabled).toBe(true);
    expect(bad.handlerKey).toBe("handleTrendStandaloneAnalyze");
    expect(bad.credits).toBe(CREDIT_COSTS.platformTrend);

    const ok = buildTrendPrimaryCta({
      selectedPlatformCount: 1,
      isAuthenticated: true,
      busy: false,
    });
    expect(ok.disabled).toBe(false);
  });

  it("tools matting CTA isolates handler", () => {
    const cta = buildToolsPrimaryCta({
      toolsTab: "matting",
      isAuthenticated: true,
      mattingPrompt: "白底站姿",
      mattingCount: 1,
      mattingBusy: false,
      customNoteBusy: false,
      customTopicBusy: false,
      assetBusy: false,
    });
    expect(cta.handlerKey).toBe("customMattingGenerate");
    expect(cta.confirmKind).toBe("custom_matting");
  });

  it("exposes matrix for docs", () => {
    expect(describePlatformCtaMatrix()).toHaveLength(3);
  });
});
