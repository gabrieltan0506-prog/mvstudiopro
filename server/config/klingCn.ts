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
  const detected = LEGACY_KLING_ENV_KEYS.filter((key) => isTruthy(process.env[key]));
  if (detected.length > 0) {
    console.warn(`[Kling] Legacy Kling env vars detected and ignored: ${detected.join(", ")}`);
    warnedLegacyKlingEnv = true;
  }
}

function getMissingKlingCnVideoEnvError(): string | null {
  const missing: string[] = [];
  if (!isTruthy(process.env.KLING_CN_VIDEO_ACCESS_KEY)) {
    missing.push("KLING_CN_VIDEO_ACCESS_KEY");
  }
  if (!isTruthy(process.env.KLING_CN_VIDEO_SECRET_KEY)) {
    missing.push("KLING_CN_VIDEO_SECRET_KEY");
  }
  if (missing.length === 0) return null;
  return `Missing ${missing.join(" and ")}`;
}

export function getKlingCnConfig(): { baseUrl: string; accessKey: string; secretKey: string } {
  warnLegacyKlingEnvIgnored();

  const envBaseUrl = process.env.KLING_CN_BASE_URL?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction && !envBaseUrl) {
    throw new Error("Missing KLING_CN_BASE_URL");
  }

  const baseUrl = envBaseUrl || DEFAULT_KLING_CN_BASE_URL;
  const missingEnvError = getMissingKlingCnVideoEnvError();
  if (missingEnvError) {
    throw new Error(missingEnvError);
  }

  const accessKey = process.env.KLING_CN_VIDEO_ACCESS_KEY!.trim();
  const secretKey = process.env.KLING_CN_VIDEO_SECRET_KEY!.trim();

  if (!baseUrl) {
    throw new Error("Missing KLING_CN_BASE_URL");
  }

  return { baseUrl, accessKey, secretKey };
}
