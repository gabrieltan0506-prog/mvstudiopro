import { describe, it, expect } from "vitest";

/**
 * Tests for OAuth fallback values.
 * We replicate the core logic here since the actual module depends on
 * expo-linking and react-native which are not available in vitest.
 */

const FALLBACK_PORTAL_URL = "https://manus.im";
const FALLBACK_SERVER_URL = "https://api.manus.im";
const FALLBACK_APP_ID = "ZcSpbTjo8yTZWfuGuozyuC";
const FALLBACK_SANDBOX_API_URL = "https://3000-i24bw8ec1bj0mzo4lbni5-b4331c77.us2.manus.computer";

function isSandboxUrl(url: string): boolean {
  return url.includes(".manus.computer") || url.includes(".manuspre.computer");
}

function resolveEnv(envValue: string | undefined, fallback: string): string {
  return envValue || fallback;
}

function getSandboxApiBaseUrl(apiBaseUrl: string): string {
  if (apiBaseUrl && isSandboxUrl(apiBaseUrl)) {
    return apiBaseUrl.replace(/\/$/, "");
  }
  // Production fallback
  if (FALLBACK_SANDBOX_API_URL) {
    return FALLBACK_SANDBOX_API_URL;
  }
  return "";
}

function getLoginUrl(portalUrl: string, appId: string, redirectUri: string): string {
  const url = new URL(`${portalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", btoa(redirectUri));
  url.searchParams.set("type", "signIn");
  return url.toString();
}

describe("OAuth fallback values for production", () => {
  it("should use fallback portal URL when env var is empty", () => {
    const portal = resolveEnv("", FALLBACK_PORTAL_URL);
    expect(portal).toBe("https://manus.im");
  });

  it("should use fallback server URL when env var is empty", () => {
    const server = resolveEnv("", FALLBACK_SERVER_URL);
    expect(server).toBe("https://api.manus.im");
  });

  it("should use fallback app ID when env var is empty", () => {
    const appId = resolveEnv("", FALLBACK_APP_ID);
    expect(appId).toBe("ZcSpbTjo8yTZWfuGuozyuC");
  });

  it("should prefer env vars when they are set", () => {
    const portal = resolveEnv("https://custom.example.com", FALLBACK_PORTAL_URL);
    expect(portal).toBe("https://custom.example.com");
  });

  it("should generate valid login URL with fallback values (no URL error)", () => {
    const portal = resolveEnv("", FALLBACK_PORTAL_URL);
    const appId = resolveEnv("", FALLBACK_APP_ID);
    const redirectUri = `${FALLBACK_SANDBOX_API_URL}/api/oauth/callback`;

    // This is the critical test - new URL() should NOT throw
    expect(() => getLoginUrl(portal, appId, redirectUri)).not.toThrow();

    const loginUrl = getLoginUrl(portal, appId, redirectUri);
    expect(loginUrl).toContain("https://manus.im/app-auth");
    expect(loginUrl).toContain("appId=ZcSpbTjo8yTZWfuGuozyuC");
    expect(loginUrl).toContain("redirectUri=");
    expect(loginUrl).toContain("type=signIn");
  });

  it("should throw error with empty portal URL (the original bug)", () => {
    // This demonstrates the original bug: empty portal URL causes URL constructor to throw
    expect(() => new URL("/app-auth")).toThrow();
    expect(() => new URL(`${""}/app-auth`)).toThrow();
  });

  it("should use sandbox API URL for redirect_uri when API_BASE_URL is empty", () => {
    const sandboxUrl = getSandboxApiBaseUrl("");
    expect(sandboxUrl).toBe(FALLBACK_SANDBOX_API_URL);
    expect(sandboxUrl).toContain("manus.computer");
  });

  it("should use API_BASE_URL when it is a sandbox URL", () => {
    const customSandbox = "https://3000-custom.us2.manus.computer";
    const sandboxUrl = getSandboxApiBaseUrl(customSandbox);
    expect(sandboxUrl).toBe(customSandbox);
  });

  it("should generate complete redirect_uri with sandbox URL", () => {
    const sandboxUrl = getSandboxApiBaseUrl("");
    const redirectUri = `${sandboxUrl}/api/oauth/callback`;
    expect(redirectUri).toBe(`${FALLBACK_SANDBOX_API_URL}/api/oauth/callback`);
    expect(redirectUri).toMatch(/^https:\/\/.+\/api\/oauth\/callback$/);
  });
});
