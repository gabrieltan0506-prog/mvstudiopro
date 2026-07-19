import { describe, expect, it } from "vitest";
import { resolveManhuaGuidedActiveStep, type ManhuaGuidedProgress } from "./manhuaGuidedPath";

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
});
