import { env } from "./env";

const DEFAULT_KLING_CN_BASE_URL = "https://api-beijing.klingai.com";

const LEGACY_KLING_ENV_KEYS = [
  "KLING_ACCESS_KEY",
  "KING_ACCESS_KEY",
  "KLINGAI_ACCESS_KEY",
  "KLINGAI_SECRET_KEY",
] as const;

let warnedLegacyKlingEnv = false;

function isTruthy(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function warnLegacyKlingEnvIgnored(): void {
  if (warnedLegacyKlingEnv) return;
  const legacyMap = env.legacyKlingEnv as Record<string, string>;
  const detected = LEGACY_KLING_ENV_KEYS.filter((key) => isTruthy(legacyMap[key]));
  if (detected.length > 0) {
    console.warn(`[Kling] Legacy Kling env vars detected and ignored: ${detected.join(", ")}`);
    warnedLegacyKlingEnv = true;
  }
}

function getMissingKlingCnVideoEnvError(): string | null {
  const missing: string[] = [];
  if (!isTruthy(env.klingVideoAccessKey)) {
    missing.push("KLING_CN_VIDEO_ACCESS_KEY");
  }
  if (!isTruthy(env.klingVideoSecretKey)) {
    missing.push("KLING_CN_VIDEO_SECRET_KEY");
  }
  if (missing.length === 0) return null;
  return `Missing ${missing.join(" and ")}`;
}

export function getKlingCnConfig(): { baseUrl: string; accessKey: string; secretKey: string } {
  warnLegacyKlingEnvIgnored();

  const envBaseUrl = env.klingCnBaseUrl;
  const isProduction = env.nodeEnv === "production";

  if (isProduction && !envBaseUrl) {
    throw new Error("Missing KLING_CN_BASE_URL");
  }

  const baseUrl = envBaseUrl || DEFAULT_KLING_CN_BASE_URL;
  const missingEnvError = getMissingKlingCnVideoEnvError();
  if (missingEnvError) {
    throw new Error(missingEnvError);
  }

  const accessKey = env.klingVideoAccessKey;
  const secretKey = env.klingVideoSecretKey;

  if (!baseUrl) {
    throw new Error("Missing KLING_CN_BASE_URL");
  }

  return { baseUrl, accessKey, secretKey };
}
