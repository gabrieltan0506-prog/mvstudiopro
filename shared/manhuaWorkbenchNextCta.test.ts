import { describe, expect, it } from "vitest";
import { resolveManhuaWorkbenchNextCta } from "./manhuaWorkbenchNextCta";

describe("resolveManhuaWorkbenchNextCta", () => {
  it("asks to confirm outline first", () => {
    const cta = resolveManhuaWorkbenchNextCta({
      outlineComplete: false,
      assetsComplete: false,
      episodeSheetCount: 0,
      stillsReadyEnough: false,
      videoBurnUnlocked: false,
      hasClip: false,
      factoryBusy: false,
      writerPackReady: true,
    });
    expect(cta.kind).toBe("confirm_outline");
    expect(cta.targetPhase).toBe("outline");
    expect(cta.labelZh).toMatch(/确认大纲/);
  });

  it("prefers spawn sheets when pad ready but episode wall empty", () => {
    const cta = resolveManhuaWorkbenchNextCta({
      outlineComplete: true,
      assetsComplete: true,
      episodeSheetCount: 0,
      stillsReadyEnough: false,
      videoBurnUnlocked: false,
      hasClip: false,
      factoryBusy: false,
    });
    expect(cta.kind).toBe("spawn_sheets");
    expect(cta.targetPhase).toBe("assets");
    expect(cta.labelZh).toMatch(/设定图/);
  });

  it("moves to keyarts after sheets exist and assets locked", () => {
    const cta = resolveManhuaWorkbenchNextCta({
      outlineComplete: true,
      assetsComplete: true,
      episodeSheetCount: 3,
      stillsReadyEnough: false,
      videoBurnUnlocked: false,
      hasClip: false,
      factoryBusy: false,
    });
    expect(cta.kind).toBe("generate_keyarts");
    expect(cta.targetPhase).toBe("storyboard");
  });

  it("offers all clips when video unlocked and no clip yet", () => {
    const cta = resolveManhuaWorkbenchNextCta({
      outlineComplete: true,
      assetsComplete: true,
      episodeSheetCount: 3,
      stillsReadyEnough: true,
      videoBurnUnlocked: true,
      hasClip: false,
      factoryBusy: false,
    });
    expect(cta.kind).toBe("generate_all_clips");
  });
});
