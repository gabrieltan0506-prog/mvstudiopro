import * as Linking from "expo-linking";
import * as ReactNative from "react-native";

// Extract scheme from bundle ID (last segment timestamp, prefixed with "manus")
// e.g., "space.manus.my.app.t20240115103045" -> "manus20240115103045"
const bundleId = "space.manus.mv.studio.pro.t20260214225152";
const timestamp = bundleId.split(".").pop()?.replace(/^t/, "") ?? "";
const schemeFromBundleId = `manus${timestamp}`;

/**
 * Hardcoded fallback values for production.
 * When deployed to Vercel, EXPO_PUBLIC_* env vars may not be available at build time
 * because Metro replaces process.env.EXPO_PUBLIC_* at compile time.
 * These fallbacks ensure OAuth works even without env vars.
 */
const FALLBACK_PORTAL_URL = "https://manus.im";
const FALLBACK_SERVER_URL = "https://api.manus.im";
// VITE_APP_ID is also not available at Metro compile time, so hardcode it
const FALLBACK_APP_ID = "ZcSpbTjo8yTZWfuGuozyuC";

const env = {
  portal: process.env.EXPO_PUBLIC_OAUTH_PORTAL_URL || FALLBACK_PORTAL_URL,
  server: process.env.EXPO_PUBLIC_OAUTH_SERVER_URL || FALLBACK_SERVER_URL,
  appId: process.env.EXPO_PUBLIC_APP_ID || FALLBACK_APP_ID,
  ownerId: process.env.EXPO_PUBLIC_OWNER_OPEN_ID ?? "",
  ownerName: process.env.EXPO_PUBLIC_OWNER_NAME ?? "",
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  deepLinkScheme: schemeFromBundleId,
};

export const OAUTH_PORTAL_URL = env.portal;
export const OAUTH_SERVER_URL = env.server;
export const APP_ID = env.appId;
export const OWNER_OPEN_ID = env.ownerId;
export const OWNER_NAME = env.ownerName;
export const API_BASE_URL = env.apiBaseUrl;

/**
 * Helper to detect if a URL looks like a Manus sandbox development URL.
 * These URLs follow the pattern: {port}-{sandboxId}.{region}.manus.computer
 */
function isSandboxUrl(url: string): boolean {
  return url.includes(".manus.computer") || url.includes(".manuspre.computer");
}

/**
 * Get the API base URL for general API calls (tRPC, etc.).
 *
 * On web, we derive the API base URL from the current window.location
 * to ensure it matches the actual domain the user is on.
 */
export function getApiBaseUrl(): string {
  // On web, ALWAYS derive from current window.location to avoid stale env vars
  if (ReactNative.Platform.OS === "web" && typeof window !== "undefined" && window.location) {
    const { protocol, hostname, origin } = window.location;

    // Development sandbox pattern: 8081-sandboxid.region.domain -> 3000-sandboxid.region.domain
    if (hostname.startsWith("8081-")) {
      const apiHostname = hostname.replace(/^8081-/, "3000-");
      return `${protocol}//${apiHostname}`;
    }

    // Production environment (custom domain like mvstudiopro.com):
    // API routes are served from the same domain, use current origin
    if (!hostname.includes("localhost") && !hostname.includes("127.0.0.1")) {
      return origin;
    }
  }

  // For native platforms, or localhost web, use the env var if it's not a stale sandbox URL
  if (API_BASE_URL && !isSandboxUrl(API_BASE_URL)) {
    return API_BASE_URL.replace(/\/$/, "");
  }

  // Fallback to empty (will use relative URL)
  return "";
}

/**
 * Get the sandbox API base URL specifically for OAuth redirect_uri.
 * 
 * DEPRECATED for Web: Web now uses /api/oauth/start backend endpoint
 * which generates the OAuth URL dynamically at runtime.
 * This function is only used for native (iOS/Android) OAuth flow.
 */
function getSandboxApiBaseUrl(): string {
  // PRIORITY 1: In development, ALWAYS derive from window.location
  if (ReactNative.Platform.OS === "web" && typeof window !== "undefined" && window.location) {
    const { protocol, hostname } = window.location;
    if (hostname.startsWith("8081-")) {
      const apiHostname = hostname.replace(/^8081-/, "3000-");
      const url = `${protocol}//${apiHostname}`;
      console.log('[OAuth] Using sandbox API URL from window.location:', url);
      return url;
    }
  }

  // PRIORITY 2: Use API_BASE_URL if it's a sandbox URL
  if (API_BASE_URL && isSandboxUrl(API_BASE_URL)) {
    console.log('[OAuth] Using sandbox API URL from API_BASE_URL:', API_BASE_URL);
    return API_BASE_URL.replace(/\/$/, '');
  }

  // PRIORITY 3: Last resort - use the general API base URL
  const fallback = getApiBaseUrl();
  console.log('[OAuth] Using fallback API URL:', fallback);
  return fallback;
}

export const SESSION_TOKEN_KEY = "app_session_token";
export const USER_INFO_KEY = "manus-runtime-user-info";

const encodeState = (value: string) => {
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(value);
  }
  const BufferImpl = (globalThis as Record<string, any>).Buffer;
  if (BufferImpl) {
    return BufferImpl.from(value, "utf-8").toString("base64");
  }
  return value;
};

/**
 * Get the redirect URI for OAuth callback.
 * Only used for native (iOS/Android) OAuth flow.
 * Web uses /api/oauth/start backend endpoint instead.
 */
export const getRedirectUri = () => {
  if (ReactNative.Platform.OS === "web") {
    // Use sandbox API URL for OAuth redirect (whitelisted by Manus Portal)
    return `${getSandboxApiBaseUrl()}/api/oauth/callback`;
  } else {
    return Linking.createURL("/oauth/callback", {
      scheme: env.deepLinkScheme,
    });
  }
};

/**
 * Get the login URL for native OAuth flow.
 * Only used for native (iOS/Android).
 * Web uses /api/oauth/start backend endpoint instead.
 */
export const getLoginUrl = () => {
  const redirectUri = getRedirectUri();
  const state = encodeState(redirectUri);

  const url = new URL(`${OAUTH_PORTAL_URL}/app-auth`);
  url.searchParams.set("appId", APP_ID);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};

/**
 * Start OAuth login flow.
 *
 * On WEB: Calls backend /api/oauth/start to get a dynamically generated
 * OAuth URL with the current (non-stale) sandbox redirect_uri.
 * This solves the problem of stale sandbox URLs in the build artifact.
 *
 * On NATIVE: Opens the system browser with a locally generated OAuth URL.
 *
 * @returns Always null, the callback is handled via redirect or deep link.
 */
export async function startOAuthLogin(): Promise<string | null> {
  if (ReactNative.Platform.OS === "web") {
    // Web: ask the backend for the OAuth URL (backend knows its current domain)
    if (typeof window !== "undefined") {
      try {
        const apiBase = getApiBaseUrl();
        console.log("[OAuth] Fetching OAuth URL from backend:", `${apiBase}/api/oauth/start`);
        
        const response = await fetch(`${apiBase}/api/oauth/start`, {
          credentials: "include",
        });
        
        if (!response.ok) {
          throw new Error(`Backend returned ${response.status}`);
        }
        
        const data = await response.json();
        console.log("[OAuth] Backend returned loginUrl, redirecting...");
        console.log("[OAuth] redirectUri:", data.redirectUri);
        
        window.location.href = data.loginUrl;
      } catch (error) {
        console.error("[OAuth] Failed to get OAuth URL from backend:", error);
        // Fallback: try the old method (may fail with stale URL)
        const loginUrl = getLoginUrl();
        console.warn("[OAuth] Falling back to client-side OAuth URL:", loginUrl);
        window.location.href = loginUrl;
      }
    }
    return null;
  }

  // Native: use locally generated URL
  const loginUrl = getLoginUrl();
  const supported = await Linking.canOpenURL(loginUrl);
  if (!supported) {
    console.warn("[OAuth] Cannot open login URL: URL scheme not supported");
    return null;
  }

  try {
    await Linking.openURL(loginUrl);
  } catch (error) {
    console.error("[OAuth] Failed to open login URL:", error);
  }

  // The OAuth callback will reopen the app via deep link.
  return null;
}
