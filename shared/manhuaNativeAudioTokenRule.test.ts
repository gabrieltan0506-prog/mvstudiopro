import { describe, expect, it } from "vitest";
import { nativeDeepReadModelMayOmitAudioTokens } from "./manhuaNativeAudioAnalysis";

describe("读片回执 AUDIO 用量口径", () => {
  it("4 代模型（含 Hydrogen）回执不单列 AUDIO，不据此拒收段缓存", () => {
    for (const model of ["gemini-4-argon", "gemini-4-carbon", "gemini-4-hydrogen"]) {
      expect(nativeDeepReadModelMayOmitAudioTokens(model)).toBe(true);
    }
  });
  it("3.8 Flash 与 3.1 Pro 仍要求 AUDIO 用量", () => {
    expect(nativeDeepReadModelMayOmitAudioTokens("gemini-3.8-flash")).toBe(false);
    expect(nativeDeepReadModelMayOmitAudioTokens("gemini-3.1-pro-preview")).toBe(false);
  });
});
