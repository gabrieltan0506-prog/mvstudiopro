import { describe, expect, it } from "vitest";
import { nativeDeepReadModelMayOmitAudioTokens } from "./manhuaNativeAudioAnalysis";
import { resolveManhuaNativeDeepReadEscalationModelFor } from "./manhuaNativeDeepReadJob";

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

describe("单片五发不过后的重读模型", () => {
  it("Hydrogen 首读固定改 3.8 Flash，不随环境变量变化", () => {
    expect(resolveManhuaNativeDeepReadEscalationModelFor("gemini-4-hydrogen", {})).toBe("gemini-3.8-flash");
    expect(resolveManhuaNativeDeepReadEscalationModelFor("gemini-4-hydrogen", { MANHUA_DEEP_READ_ESCALATION_MODEL: "gemini-4-hydrogen", MANHUA_DEEP_READ_MODEL: "gemini-4-hydrogen" })).toBe("gemini-3.8-flash");
  });
  it("3.8 Flash 首读仍按配置（缺省同首读 = 不升级）", () => {
    expect(resolveManhuaNativeDeepReadEscalationModelFor("gemini-3.8-flash", {})).toBe("gemini-3.8-flash");
  });
});
