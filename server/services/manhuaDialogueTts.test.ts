import { describe, expect, it } from "vitest";
import { buildFingerprintAudioFilter } from "./manhuaDialogueTts";

describe("变声指纹档位（2026-08-15 预演实锤固化）", () => {
  it("女声必须走 rubberband 保共振峰（asetrate 会出卡通音）", () => {
    expect(buildFingerprintAudioFilter("female")).toContain("rubberband");
    expect(buildFingerprintAudioFilter("female")).not.toContain("asetrate");
  });
  it("男声/老年男声走 asetrate 降调且 atempo 保时长", () => {
    for (const p of ["male", "elder"] as const) {
      const f = buildFingerprintAudioFilter(p)!;
      expect(f).toContain("asetrate");
      expect(f).toContain("atempo");
    }
  });
  it("none 返回 null（原声仅限内部试听）", () => {
    expect(buildFingerprintAudioFilter("none")).toBeNull();
  });
});
