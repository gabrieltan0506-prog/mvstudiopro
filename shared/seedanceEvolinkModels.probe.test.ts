import { describe, expect, it } from "vitest";
import {
  SEEDANCE_PROBE_DEFAULT_DURATION_SEC,
  SEEDANCE_PROBE_DEFAULT_QUALITY,
  resolveSeedanceProbeDefaults,
} from "./seedanceEvolinkModels";

describe("resolveSeedanceProbeDefaults", () => {
  it("defaults to mini 5s 480p", () => {
    const d = resolveSeedanceProbeDefaults();
    expect(d.version).toBe("2.0-mini");
    expect(d.duration).toBe(SEEDANCE_PROBE_DEFAULT_DURATION_SEC);
    expect(d.quality).toBe(SEEDANCE_PROBE_DEFAULT_QUALITY);
  });

  it("accepts full 2.0 overrides", () => {
    const d = resolveSeedanceProbeDefaults({ version: "2.0", quality: "720p", duration: 15 });
    expect(d.version).toBe("2.0");
    expect(d.quality).toBe("720p");
    expect(d.duration).toBe(15);
  });

  it("falls back unknown version to 2.0-mini", () => {
    const d = resolveSeedanceProbeDefaults({ version: "9.9-unknown" });
    expect(d.version).toBe("2.0-mini");
  });

  it("falls back invalid duration to default", () => {
    const d = resolveSeedanceProbeDefaults({ duration: "nope" });
    expect(d.duration).toBe(SEEDANCE_PROBE_DEFAULT_DURATION_SEC);
  });

  it("falls back empty quality to default", () => {
    const d = resolveSeedanceProbeDefaults({ quality: "   " });
    expect(d.quality).toBe(SEEDANCE_PROBE_DEFAULT_QUALITY);
  });
});
