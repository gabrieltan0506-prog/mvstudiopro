import { describe, expect, it } from "vitest";
import {
  GEMINI_SCRIPT_FALLBACK_MODEL,
  resolveGeminiScriptFallbackModel,
} from "./geminiScriptFallback";

describe("geminiScriptFallback", () => {
  it("maps 3.1 pro to flash", () => {
    expect(resolveGeminiScriptFallbackModel("gemini-3.1-pro-preview")).toBe(
      GEMINI_SCRIPT_FALLBACK_MODEL,
    );
    expect(resolveGeminiScriptFallbackModel("gemini-3.1-pro")).toBe(GEMINI_SCRIPT_FALLBACK_MODEL);
  });

  it("does not fallback flash to itself", () => {
    expect(resolveGeminiScriptFallbackModel("gemini-3-flash-preview")).toBeNull();
  });
});
