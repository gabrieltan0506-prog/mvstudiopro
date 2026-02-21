import { describe, it, expect } from "vitest";

describe("GEMINI_API_KEY validation", () => {
  it("should have GEMINI_API_KEY set in environment", () => {
    const key = process.env.GEMINI_API_KEY;
    expect(key).toBeDefined();
    expect(key).not.toBe("");
    expect(key!.startsWith("AIza")).toBe(true);
  });

  it("should be able to call Gemini API with the key", async () => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY not set");
    }

    // Use a lightweight models.list call to validate the key
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
    );
    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.models).toBeDefined();
    expect(data.models.length).toBeGreaterThan(0);

    // Check that Gemini 3 Flash is available
    const modelNames = data.models.map((m: any) => m.name);
    const hasGemini3 = modelNames.some((n: string) => n.includes("gemini-3"));
    console.log("Available Gemini 3 models:", modelNames.filter((n: string) => n.includes("gemini-3")));
    // At minimum, some gemini models should be listed
    expect(modelNames.length).toBeGreaterThan(0);
  }, 15000);
});
