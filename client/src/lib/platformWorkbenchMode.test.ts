import { describe, expect, it } from "vitest";
import {
  composeFocusPromptFromPersona,
  isLegacyVideoTabAlias,
  isPlatformWorkbenchMode,
  parsePersonaFromFocusPrompt,
  parsePlatformToolsQuery,
  parsePlatformWorkbenchMode,
  resolvePlatformLocation,
  toolsTabFromMode,
} from "./platformWorkbenchMode";

describe("platformWorkbenchMode", () => {
  it("parses mode tokens", () => {
    expect(parsePlatformWorkbenchMode("create")).toBe("create");
    expect(parsePlatformWorkbenchMode("TREND")).toBe("trend");
    expect(parsePlatformWorkbenchMode("tools")).toBe("tools");
    expect(parsePlatformWorkbenchMode("nope")).toBeNull();
    expect(isPlatformWorkbenchMode("create")).toBe(true);
  });

  it("resolves URL priority, illegal mode, and legacy video→assets", () => {
    expect(resolvePlatformLocation("?mode=trend").mode).toBe("trend");
    expect(resolvePlatformLocation("?mode=nope").mode).toBe("create");
    expect(resolvePlatformLocation("?mode=nope").normalized).toBe(true);
    const legacy = resolvePlatformLocation("?tab=video");
    expect(legacy.mode).toBe("tools");
    expect(legacy.tool).toBe("assets");
    expect(legacy.legacyVideoMapped).toBe(true);
    expect(isLegacyVideoTabAlias("deep-video")).toBe(true);
    expect(parsePlatformToolsQuery("matting")).toBe("matting");
    expect(parsePlatformToolsQuery("video")).toBeNull();
    expect(resolvePlatformLocation("?mode=tools&tool=assets").tool).toBe("assets");
    expect(resolvePlatformLocation("?mode=tools&tool=bogus").tool).toBe("htmlPpt");
    expect(resolvePlatformLocation("?mode=tools&tool=bogus").normalized).toBe(true);
  });

  it("round-trips structured persona", () => {
    const persona = {
      identity: "医学创作者",
      domain: "慢病科普",
      audience: "职场人",
      businessGoal: "资料店转化",
    };
    const focus = composeFocusPromptFromPersona(persona);
    expect(focus).toContain("身份：医学创作者");
    expect(parsePersonaFromFocusPrompt(focus)).toEqual(persona);
  });

  it("maps tools tab by mode", () => {
    expect(toolsTabFromMode("create", "htmlPpt")).toBe("copy");
    expect(toolsTabFromMode("create", "topic")).toBe("topic");
    expect(toolsTabFromMode("tools", "copy")).toBe("htmlPpt");
    expect(toolsTabFromMode("tools", "matting")).toBe("matting");
  });
});
