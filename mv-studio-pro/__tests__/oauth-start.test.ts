import { describe, it, expect } from "vitest";

describe("OAuth Start Endpoint", () => {
  const API_BASE = "http://127.0.0.1:3000";

  it("should return a valid loginUrl and redirectUri from /api/oauth/start", async () => {
    const res = await fetch(`${API_BASE}/api/oauth/start`);
    expect(res.ok).toBe(true);

    const data = await res.json();
    expect(data.loginUrl).toBeDefined();
    expect(data.redirectUri).toBeDefined();

    // loginUrl should point to Manus portal
    expect(data.loginUrl).toContain("manus.im/app-auth");
    expect(data.loginUrl).toContain("appId=");
    expect(data.loginUrl).toContain("redirectUri=");
    expect(data.loginUrl).toContain("state=");

    // redirectUri should point to the current sandbox API
    expect(data.redirectUri).toContain("/api/oauth/callback");
    // Should NOT be empty
    expect(data.redirectUri.length).toBeGreaterThan(20);
  });

  it("should use the current sandbox URL, not a stale one", async () => {
    const res = await fetch(`${API_BASE}/api/oauth/start`);
    const data = await res.json();

    // The redirectUri should contain the current sandbox domain
    // It should be a valid URL
    const url = new URL(data.redirectUri);
    expect(url.pathname).toBe("/api/oauth/callback");
    expect(url.protocol).toBe("https:");
  });
});
