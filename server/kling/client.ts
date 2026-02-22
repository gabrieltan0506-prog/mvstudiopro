// @ts-nocheck
/**
 * Kling AI API Client
 * 
 * Core service layer with:
 * - JWT token generation (HMAC-SHA256)
 * - Multi-API-key rotation (pool of keys)
 * - Automatic token refresh
 * - Request/response handling
 * - Error handling with retries
 */

import * as crypto from "crypto";

// ─── Types ──────────────────────────────────────────

export interface KlingApiKey {
  id: string;           // Identifier for this key (e.g., "global-1", "cn-1")
  accessKey: string;    // Kling Access Key ID
  secretKey: string;    // Kling Secret Key
  region: "global" | "cn";
  purpose: "image" | "video" | "all"; // Which API this key is for
  enabled: boolean;
  remainingUnits?: number;
  expiresAt?: Date;     // Trial package expiry
}

export interface KlingConfig {
  keys: KlingApiKey[];
  defaultRegion: "global" | "cn";
  maxRetries: number;
  requestTimeoutMs: number;
}

interface JwtPayload {
  iss: string;
  exp: number;
  nbf: number;
}

interface JwtCache {
  token: string;
  expiresAt: number;
}

// ─── Constants ──────────────────────────────────────

const API_ENDPOINTS = {
  global: "https://api-singapore.klingai.com",
  cn: "https://api-beijing.klingai.com",
} as const;

const JWT_EXPIRY_SECONDS = 1800; // 30 minutes
const JWT_REFRESH_BUFFER_MS = 60_000; // Refresh 1 minute before expiry

// ─── JWT Token Generation ───────────────────────────

function base64UrlEncode(data: Buffer): string {
  return data.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateJwt(accessKey: string, secretKey: string): string {
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const payload: JwtPayload = {
    iss: accessKey,
    exp: now + JWT_EXPIRY_SECONDS,
    nbf: now - 5, // 5 seconds leeway
  };

  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(signingInput)
    .digest();

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

// ─── API Key Pool Manager ───────────────────────────

class KeyPool {
  private keys: KlingApiKey[];
  private jwtCache: Map<string, JwtCache> = new Map();
  private currentIndex: Map<string, number> = new Map(); // per-region round-robin

  constructor(keys: KlingApiKey[]) {
    this.keys = keys;
  }

  updateKeys(keys: KlingApiKey[]) {
    this.keys = keys;
    // Clear cache for removed keys
    const keyIds = new Set(keys.map((k) => k.id));
    for (const [id] of this.jwtCache) {
      if (!keyIds.has(id)) this.jwtCache.delete(id);
    }
  }

  getAvailableKey(preferredRegion: "global" | "cn" = "global", purpose: "image" | "video" | "all" = "all"): KlingApiKey | null {
    // Filter by region + purpose (purpose match: exact match or "all")
    const regionKeys = this.keys.filter(
      (k) => k.enabled && k.region === preferredRegion && !this.isExpired(k) &&
             (k.purpose === purpose || k.purpose === "all" || purpose === "all")
    );

    if (regionKeys.length === 0) {
      // Fallback: match purpose in any region
      const purposeKeys = this.keys.filter(
        (k) => k.enabled && !this.isExpired(k) &&
               (k.purpose === purpose || k.purpose === "all" || purpose === "all")
      );
      if (purposeKeys.length > 0) return this.roundRobin(purposeKeys, `${purpose}-any`);
      // Last fallback: any available key
      const anyKeys = this.keys.filter((k) => k.enabled && !this.isExpired(k));
      if (anyKeys.length === 0) return null;
      return this.roundRobin(anyKeys, "any");
    }

    return this.roundRobin(regionKeys, `${preferredRegion}-${purpose}`);
  }

  getToken(key: KlingApiKey): string {
    const cached = this.jwtCache.get(key.id);
    const now = Date.now();

    if (cached && cached.expiresAt - JWT_REFRESH_BUFFER_MS > now) {
      return cached.token;
    }

    // Generate new JWT
    const token = generateJwt(key.accessKey, key.secretKey);
    this.jwtCache.set(key.id, {
      token,
      expiresAt: now + JWT_EXPIRY_SECONDS * 1000,
    });

    return token;
  }

  markKeyExhausted(keyId: string) {
    const key = this.keys.find((k) => k.id === keyId);
    if (key) {
      key.enabled = false;
      key.remainingUnits = 0;
    }
  }

  getKeyStats(): Array<{ id: string; region: string; enabled: boolean; remainingUnits?: number; expiresAt?: Date }> {
    return this.keys.map((k) => ({
      id: k.id,
      region: k.region,
      enabled: k.enabled,
      remainingUnits: k.remainingUnits,
      expiresAt: k.expiresAt,
    }));
  }

  private isExpired(key: KlingApiKey): boolean {
    if (!key.expiresAt) return false;
    return new Date() > key.expiresAt;
  }

  private roundRobin(keys: KlingApiKey[], group: string): KlingApiKey {
    const idx = this.currentIndex.get(group) ?? 0;
    const key = keys[idx % keys.length];
    this.currentIndex.set(group, idx + 1);
    return key;
  }
}

// ─── Kling API Client ───────────────────────────────

export interface KlingRequestOptions {
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
  region?: "global" | "cn";
  purpose?: "image" | "video" | "all";
  timeoutMs?: number;
}

export interface KlingApiResponse<T = unknown> {
  code: number;
  message: string;
  request_id: string;
  data: T;
}

export class KlingClient {
  private keyPool: KeyPool;
  private config: KlingConfig;

  constructor(config: KlingConfig) {
    this.config = config;
    this.keyPool = new KeyPool(config.keys);
  }

  updateKeys(keys: KlingApiKey[]) {
    this.config.keys = keys;
    this.keyPool.updateKeys(keys);
  }

  getKeyStats() {
    return this.keyPool.getKeyStats();
  }

  async request<T = unknown>(options: KlingRequestOptions): Promise<KlingApiResponse<T>> {
    const region = options.region ?? this.config.defaultRegion;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const key = this.keyPool.getAvailableKey(region, options.purpose ?? "all");
      if (!key) {
        throw new Error(
          `No available Kling API keys for region "${region}". ` +
          `Check key configuration and remaining units.`
        );
      }

      try {
        const token = this.keyPool.getToken(key);
        const baseUrl = API_ENDPOINTS[key.region];
        const url = `${baseUrl}${options.path}`;
        const timeout = options.timeoutMs ?? this.config.requestTimeoutMs;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        };

        const fetchOptions: RequestInit = {
          method: options.method,
          headers,
          signal: controller.signal,
        };

        if (options.body && options.method === "POST") {
          fetchOptions.body = JSON.stringify(options.body);
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timer);

        const json = (await response.json()) as KlingApiResponse<T>;

        // Handle specific error codes
        if (json.code === 1004 || json.code === 1005) {
          // Insufficient balance or key expired
          this.keyPool.markKeyExhausted(key.id);
          lastError = new Error(`Key ${key.id} exhausted: ${json.message}`);
          continue; // Try next key
        }

        if (json.code !== 0) {
          throw new Error(`Kling API error (${json.code}): ${json.message} [request_id: ${json.request_id}]`);
        }

        return json;
      } catch (err: any) {
        lastError = err;
        if (err.name === "AbortError") {
          lastError = new Error(`Kling API request timeout after ${options.timeoutMs ?? this.config.requestTimeoutMs}ms`);
        }
        // Retry on network errors
        if (attempt < this.config.maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); // Exponential backoff
          continue;
        }
      }
    }

    throw lastError ?? new Error("Kling API request failed after all retries");
  }
}

// ─── Singleton Instance ─────────────────────────────

let clientInstance: KlingClient | null = null;

export function getKlingClient(): KlingClient {
  if (!clientInstance) {
    // Initialize with empty keys - will be configured via env vars or admin panel
    clientInstance = new KlingClient({
      keys: [],
      defaultRegion: "cn",
      maxRetries: 2,
      requestTimeoutMs: 60_000,
    });
  }
  return clientInstance;
}

/**
 * Initialize or update the Kling client with API keys.
 * Called from environment setup or admin configuration.
 */
export function configureKlingClient(keys: KlingApiKey[], defaultRegion: "global" | "cn" = "cn") {
  const client = getKlingClient();
  client.updateKeys(keys);
}

/**
 * Parse Kling API keys from environment variables.
 * Format: KLING_API_KEYS = JSON array of { id, accessKey, secretKey, region }
 * Or individual keys: KLING_ACCESS_KEY_1, KLING_SECRET_KEY_1, etc.
 */
export function parseKeysFromEnv(): KlingApiKey[] {
  const keys: KlingApiKey[] = [];

  // Try JSON format first
  const jsonKeys = process.env.KLING_API_KEYS;
  if (jsonKeys) {
    try {
      const parsed = JSON.parse(jsonKeys) as Array<{
        id?: string;
        accessKey: string;
        secretKey: string;
        region?: string;
      }>;
      for (let i = 0; i < parsed.length; i++) {
        const k = parsed[i];
        keys.push({
          id: k.id ?? `key-${i + 1}`,
          accessKey: k.accessKey,
          secretKey: k.secretKey,
          region: (k.region as "global" | "cn") ?? "cn",
          purpose: "all",
          enabled: true,
        });
      }
      return keys;
    } catch {
      console.warn("Failed to parse KLING_API_KEYS JSON, trying individual env vars");
    }
  }

  // Image key: KLING_ACCESS_KEY, KLING_SECRET_KEY
  const ak = process.env.KLING_ACCESS_KEY;
  const sk = process.env.KLING_SECRET_KEY;
  if (ak && sk) {
    keys.push({
      id: "primary-image",
      accessKey: ak,
      secretKey: sk,
      region: (process.env.KLING_REGION as "global" | "cn") ?? "cn",
      purpose: "image",
      enabled: true,
    });
  }

  // Video key: KLING_VIDEO_ACCESS_KEY, KLING_VIDEO_SECRET_KEY
  const vak = process.env.KLING_VIDEO_ACCESS_KEY;
  const vsk = process.env.KLING_VIDEO_SECRET_KEY;
  if (vak && vsk) {
    keys.push({
      id: "primary-video",
      accessKey: vak,
      secretKey: vsk,
      region: (process.env.KLING_DEFAULT_REGION as "global" | "cn") ?? "cn",
      purpose: "video",
      enabled: true,
    });
  }

  // Try numbered keys: KLING_ACCESS_KEY_1, KLING_SECRET_KEY_1, etc.
  for (let i = 1; i <= 10; i++) {
    const akN = process.env[`KLING_ACCESS_KEY_${i}`];
    const skN = process.env[`KLING_SECRET_KEY_${i}`];
    if (akN && skN) {
      keys.push({
        id: `key-${i}`,
        accessKey: akN,
        secretKey: skN,
        region: (process.env[`KLING_REGION_${i}`] as "global" | "cn") ?? "cn",
        purpose: "all",
        enabled: true,
      });
    }
  }

  return keys;
}
