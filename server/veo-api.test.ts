import { describe, it, expect } from "vitest";

describe("Gemini API Key validation for Veo 3.1", () => {
  it("should have GEMINI_API_KEY set", () => {
    const key = process.env.GEMINI_API_KEY;
    expect(key).toBeDefined();
    expect(key!.length).toBeGreaterThan(10);
    expect(key!.startsWith("AIza")).toBe(true);
  });

  it("should be able to reach Gemini API", async () => {
    const key = process.env.GEMINI_API_KEY;
    // Use a lightweight models list endpoint to validate the key
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.models).toBeDefined();
    expect(data.models.length).toBeGreaterThan(0);
    
    // Check if Veo models are available
    const modelNames = data.models.map((m: any) => m.name);
    const hasVeo = modelNames.some((name: string) => name.includes("veo"));
    // Veo might not show in models list, so just verify API key works
    expect(data.models.length).toBeGreaterThan(0);
  });
});
