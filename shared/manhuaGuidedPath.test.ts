import { describe, expect, it } from "vitest";
import {
  resolveManhuaGuidedActiveStep,
  resolveManhuaGuidedNextAction,
  type ManhuaGuidedProgress,
} from "./manhuaGuidedPath";

const base: ManhuaGuidedProgress = {
  hasTopic: false,
  hasWriterPack: false,
  writerConfirmed: false,
  hasCast: false,
  hasKeyart: false,
  hasClip: false,
  hasFinalVideo: false,
};

describe("resolveManhuaGuidedActiveStep", () => {
  it("defaults to topic", () => {
    expect(resolveManhuaGuidedActiveStep(base)).toBe("topic");
  });

  it("advances through guided path", () => {
    expect(resolveManhuaGuidedActiveStep({ ...base, hasTopic: true })).toBe("topic");
    expect(
      resolveManhuaGuidedActiveStep({ ...base, hasTopic: true, hasWriterPack: true }),
    ).toBe("writer");
    expect(
      resolveManhuaGuidedActiveStep({
        ...base,
        hasTopic: true,
        hasWriterPack: true,
        writerConfirmed: true,
      }),
    ).toBe("cast");
    expect(
      resolveManhuaGuidedActiveStep({
        ...base,
        hasTopic: true,
        hasWriterPack: true,
        writerConfirmed: true,
        hasCast: true,
      }),
    ).toBe("wb");
    expect(
      resolveManhuaGuidedActiveStep({
        ...base,
        writerConfirmed: true,
        hasCast: true,
        hasKeyart: true,
      }),
    ).toBe("keyart");
    expect(
      resolveManhuaGuidedActiveStep({
        ...base,
        writerConfirmed: true,
        hasCast: true,
        hasKeyart: true,
        hasClip: true,
      }),
    ).toBe("clip");
    expect(
      resolveManhuaGuidedActiveStep({
        ...base,
        hasClip: true,
        hasFinalVideo: true,
      }),
    ).toBe("preview");
  });

  it("resolveManhuaGuidedNextAction follows pipeline", () => {
    expect(resolveManhuaGuidedNextAction(base).ctaLabel).toMatch(/题材/);
    expect(resolveManhuaGuidedNextAction({ ...base, hasTopic: true }).ctaLabel).toMatch(/扩写/);
    expect(
      resolveManhuaGuidedNextAction({ ...base, hasTopic: true, hasWriterPack: true }).title,
    ).toMatch(/确认编剧/);
    expect(
      resolveManhuaGuidedNextAction({
        ...base,
        writerConfirmed: true,
        hasCast: true,
        hasClip: true,
      }).href,
    ).toBe("#manhua-clip-dock-zone");
  });
});
