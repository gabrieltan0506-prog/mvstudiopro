// @ts-nocheck
/**
 * Kling AI API Client
 *
 * CN-only bearer-key client:
 * - Uses KLING_CN_BASE_URL + KLING_CN_VIDEO_ACCESS_KEY / KLING_CN_VIDEO_SECRET_KEY
 * - Ignores all legacy KLING_* key env vars
 */

import { getKlingCnConfig } from "../config/klingCn";
import crypto from "crypto";

export interface KlingApiKey {
  id: string;
  apiKey: string;
  region: "cn";
  purpose: "image" | "video" | "all";
  enabled: boolean;
  remainingUnits?: number;
  expiresAt?: Date;
}

export interface KlingConfig {
  keys: KlingApiKey[];
  defaultRegion: "cn";
  maxRetries: number;
  requestTimeoutMs: number;
}

class KeyPool {
  private keys: KlingApiKey[];
  private currentIndex = 0;

  constructor(keys: KlingApiKey[]) {
    this.keys = keys;
  }

  updateKeys(keys: KlingApiKey[]) {
    this.keys = keys;
  }

  getAvailableKey(purpose: "image" | "video" | "all" = "all"): KlingApiKey | null {
    const candidates = this.keys.filter(
      (k) =>
        k.enabled &&
        (k.purpose === purpose || k.purpose === "all" || purpose === "all")
    );

    if (candidates.length === 0) return null;
    const key = candidates[this.currentIndex % candidates.length];
    this.currentIndex += 1;
    return key;
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
}

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
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const key = this.keyPool.getAvailableKey(options.purpose ?? "all");
      if (!key) {
        throw new Error("No available Kling CN API key. Missing KLING_CN_VIDEO_ACCESS_KEY and KLING_CN_VIDEO_SECRET_KEY.");
      }

      try {
        const { baseUrl } = getKlingCnConfig();
        const url = `${baseUrl.replace(/\/$/, "")}${options.path}`;
        const timeout = options.timeoutMs ?? this.config.requestTimeoutMs;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key.apiKey}`,
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

        if (json.code === 1004 || json.code === 1005) {
          this.keyPool.markKeyExhausted(key.id);
          lastError = new Error(`Key ${key.id} exhausted: ${json.message}`);
          continue;
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
        if (attempt < this.config.maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
      }
    }

    throw lastError ?? new Error("Kling API request failed after all retries");
  }
}

let clientInstance: KlingClient | null = null;

export function getKlingClient(): KlingClient {
  if (!clientInstance) {
    clientInstance = new KlingClient({
      keys: [],
      defaultRegion: "cn",
      maxRetries: 2,
      requestTimeoutMs: 60_000,
    });
  }
  return clientInstance;
}

export function configureKlingClient(keys: KlingApiKey[], defaultRegion: "global" | "cn" = "cn") {
  const client = getKlingClient();
  const normalized = keys.filter((k) => !!k.apiKey);
  client.updateKeys(normalized);
}

export function parseKeysFromEnv(): KlingApiKey[] {
  const { accessKey, secretKey } = getKlingCnConfig();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = { iss: accessKey, exp: now + 1800, nbf: now - 5, iat: now };
  const toBase64Url = (value: Buffer) =>
    value.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const headerB64 = toBase64Url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = toBase64Url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = crypto.createHmac("sha256", secretKey).update(signingInput).digest();
  const jwt = `${signingInput}.${toBase64Url(signature)}`;

  return [
    {
      id: "primary-cn-video",
      apiKey: jwt,
      region: "cn",
      purpose: "all",
      enabled: true,
    },
  ];
}
