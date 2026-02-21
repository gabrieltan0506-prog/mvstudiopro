import { describe, it, expect } from "vitest";

describe("CometAPI Key Validation", () => {
  it("should have COMET_API_KEY set", () => {
    const key = process.env.COMET_API_KEY;
    expect(key).toBeDefined();
    expect(key!.length).toBeGreaterThan(10);
  });

  it("should authenticate with CometAPI successfully", async () => {
    const key = process.env.COMET_API_KEY!;

    // Call a lightweight endpoint to verify the key works
    const response = await fetch("https://api.cometapi.com/v1/models", {
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
    });

    // 200 = success, 401/403 = invalid key
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  }, 15000);
});
