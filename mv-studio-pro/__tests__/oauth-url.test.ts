import { describe, it, expect } from "vitest";

// We replicate the core getApiBaseUrl logic here for testing,
// since the actual module depends on expo-linking and react-native.

function isSandboxUrl(url: string): boolean {
  return url.includes(".manus.computer") || url.includes(".manuspre.computer");
}

function getApiBaseUrlLogic(
  apiBaseUrlEnv: string,
  platformOS: string,
  windowLocation: { protocol: string; hostname: string; origin: string } | null
): string {
  // On web, ALWAYS derive from current window.location to avoid stale env vars
  if (platformOS === "web" && windowLocation) {
    const { protocol, hostname, origin } = windowLocation;

    // Development sandbox pattern
    if (hostname.startsWith("8081-")) {
      const apiHostname = hostname.replace(/^8081-/, "3000-");
      return `${protocol}//${apiHostname}`;
    }

    // Production environment (custom domain)
    if (!hostname.includes("localhost") && !hostname.includes("127.0.0.1")) {
      return origin;
    }
  }

  // For native platforms, or localhost web, use the env var if it's not a stale sandbox URL
  if (apiBaseUrlEnv && !isSandboxUrl(apiBaseUrlEnv)) {
    return apiBaseUrlEnv.replace(/\/$/, "");
  }

  return "";
}

// Test the frontend URL derivation logic from oauth.ts (server-side)
function deriveFrontendUrl(
  frontendUrlEnv: string | undefined,
  reqHeaders: { 'x-forwarded-proto'?: string; 'x-forwarded-host'?: string; host?: string },
  reqProtocol: string
): string {
  let frontendUrl = frontendUrlEnv;

  if (!frontendUrl) {
    const proto = reqHeaders['x-forwarded-proto'] || reqProtocol || 'https';
    const host = reqHeaders['x-forwarded-host'] || reqHeaders.host;
    if (host) {
      const hostStr = typeof host === 'string' ? host : host;
      if (hostStr.startsWith('3000-')) {
        const webHost = hostStr.replace(/^3000-/, '8081-');
        frontendUrl = `${proto}://${webHost}`;
      } else {
        frontendUrl = `${proto}://${hostStr}`;
      }
    }
  }

  if (!frontendUrl) {
    frontendUrl = "http://localhost:8081";
  }

  return frontendUrl.replace(/\/$/, '');
}

describe("OAuth URL Logic", () => {
  describe("getApiBaseUrl (frontend)", () => {
    it("should use window.location.origin for production domain even when EXPO_PUBLIC_API_BASE_URL is set to sandbox URL", () => {
      // THIS IS THE KEY TEST: even with a stale sandbox URL in env var,
      // on web it should use window.location.origin
      const result = getApiBaseUrlLogic(
        "https://3000-i6br6rgonx68jgd58goeg-90cc4714.us2.manus.computer",
        "web",
        { protocol: "https:", hostname: "www.mvstudiopro.com", origin: "https://www.mvstudiopro.com" }
      );
      expect(result).toBe("https://www.mvstudiopro.com");
    });

    it("should use window.location.origin for production domain when env var is empty", () => {
      const result = getApiBaseUrlLogic(
        "",
        "web",
        { protocol: "https:", hostname: "www.mvstudiopro.com", origin: "https://www.mvstudiopro.com" }
      );
      expect(result).toBe("https://www.mvstudiopro.com");
    });

    it("should use window.location.origin for production domain without www", () => {
      const result = getApiBaseUrlLogic(
        "https://3000-old-sandbox.us2.manus.computer",
        "web",
        { protocol: "https:", hostname: "mvstudiopro.com", origin: "https://mvstudiopro.com" }
      );
      expect(result).toBe("https://mvstudiopro.com");
    });

    it("should derive API URL from sandbox hostname (dev environment)", () => {
      const result = getApiBaseUrlLogic(
        "",
        "web",
        { protocol: "https:", hostname: "8081-abc123.us2.manus.computer", origin: "https://8081-abc123.us2.manus.computer" }
      );
      expect(result).toBe("https://3000-abc123.us2.manus.computer");
    });

    it("should use sandbox derivation even when env var has stale sandbox URL", () => {
      const result = getApiBaseUrlLogic(
        "https://3000-old-sandbox.us2.manus.computer",
        "web",
        { protocol: "https:", hostname: "8081-new-sandbox.us2.manus.computer", origin: "https://8081-new-sandbox.us2.manus.computer" }
      );
      expect(result).toBe("https://3000-new-sandbox.us2.manus.computer");
    });

    it("should return empty string for localhost web", () => {
      const result = getApiBaseUrlLogic(
        "",
        "web",
        { protocol: "http:", hostname: "localhost", origin: "http://localhost:8081" }
      );
      expect(result).toBe("");
    });

    it("should use non-sandbox env var for native platform", () => {
      const result = getApiBaseUrlLogic(
        "https://api.mvstudiopro.com",
        "ios",
        null
      );
      expect(result).toBe("https://api.mvstudiopro.com");
    });

    it("should ignore sandbox env var for native platform", () => {
      const result = getApiBaseUrlLogic(
        "https://3000-old-sandbox.us2.manus.computer",
        "ios",
        null
      );
      expect(result).toBe("");
    });

    it("should remove trailing slash from env var", () => {
      const result = getApiBaseUrlLogic(
        "https://api.mvstudiopro.com/",
        "ios",
        null
      );
      expect(result).toBe("https://api.mvstudiopro.com");
    });
  });

  describe("deriveFrontendUrl (backend OAuth callback)", () => {
    it("should use FRONTEND_URL when set", () => {
      const result = deriveFrontendUrl(
        "https://mvstudiopro.com",
        { host: "mvstudiopro.com" },
        "https"
      );
      expect(result).toBe("https://mvstudiopro.com");
    });

    it("should derive from request host in production (Vercel)", () => {
      const result = deriveFrontendUrl(
        undefined,
        {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'www.mvstudiopro.com',
          host: 'www.mvstudiopro.com'
        },
        "http"
      );
      expect(result).toBe("https://www.mvstudiopro.com");
    });

    it("should derive from request host without www", () => {
      const result = deriveFrontendUrl(
        undefined,
        {
          'x-forwarded-proto': 'https',
          host: 'mvstudiopro.com'
        },
        "http"
      );
      expect(result).toBe("https://mvstudiopro.com");
    });

    it("should handle dev sandbox: replace 3000- with 8081-", () => {
      const result = deriveFrontendUrl(
        undefined,
        { host: "3000-abc123.us2.manus.computer" },
        "https"
      );
      expect(result).toBe("https://8081-abc123.us2.manus.computer");
    });

    it("should fallback to localhost when no host info available", () => {
      const result = deriveFrontendUrl(undefined, {}, "http");
      expect(result).toBe("http://localhost:8081");
    });

    it("should remove trailing slash from FRONTEND_URL", () => {
      const result = deriveFrontendUrl(
        "https://mvstudiopro.com/",
        { host: "mvstudiopro.com" },
        "https"
      );
      expect(result).toBe("https://mvstudiopro.com");
    });
  });

  describe("OAuth redirect_uri construction", () => {
    it("should produce correct redirect_uri for production even with stale env var", () => {
      const apiBase = getApiBaseUrlLogic(
        "https://3000-i6br6rgonx68jgd58goeg-90cc4714.us2.manus.computer",
        "web",
        { protocol: "https:", hostname: "www.mvstudiopro.com", origin: "https://www.mvstudiopro.com" }
      );
      const redirectUri = `${apiBase}/api/oauth/callback`;
      expect(redirectUri).toBe("https://www.mvstudiopro.com/api/oauth/callback");
    });

    it("should produce correct redirect_uri for production (non-www)", () => {
      const apiBase = getApiBaseUrlLogic(
        "",
        "web",
        { protocol: "https:", hostname: "mvstudiopro.com", origin: "https://mvstudiopro.com" }
      );
      const redirectUri = `${apiBase}/api/oauth/callback`;
      expect(redirectUri).toBe("https://mvstudiopro.com/api/oauth/callback");
    });

    it("should produce correct redirect_uri for dev sandbox", () => {
      const apiBase = getApiBaseUrlLogic(
        "",
        "web",
        { protocol: "https:", hostname: "8081-abc123.us2.manus.computer", origin: "https://8081-abc123.us2.manus.computer" }
      );
      const redirectUri = `${apiBase}/api/oauth/callback`;
      expect(redirectUri).toBe("https://3000-abc123.us2.manus.computer/api/oauth/callback");
    });
  });

  describe("isSandboxUrl helper", () => {
    it("should detect manus.computer sandbox URLs", () => {
      expect(isSandboxUrl("https://3000-abc.us2.manus.computer")).toBe(true);
    });

    it("should detect manuspre.computer sandbox URLs", () => {
      expect(isSandboxUrl("https://3000-abc.us2.manuspre.computer")).toBe(true);
    });

    it("should not flag production URLs", () => {
      expect(isSandboxUrl("https://www.mvstudiopro.com")).toBe(false);
    });

    it("should not flag API URLs", () => {
      expect(isSandboxUrl("https://api.mvstudiopro.com")).toBe(false);
    });
  });
});
