const DEFAULT_COMET_API_BASE_URL = "https://api.cometapi.com";

export const COMETAPI_GPT_5_1_MODEL_ID = "gpt-5.1";

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function getCometApiKey(): string | undefined {
  const candidate =
    process.env.COMET_API_KEY ||
    process.env.COMETAPI_API_KEY ||
    process.env.COMETAPI_KEY;

  if (!hasValue(candidate)) {
    return undefined;
  }

  return candidate.trim();
}

export function getCometApiBaseUrl(): string {
  const candidate =
    process.env.COMET_API_BASE_URL ||
    process.env.COMETAPI_BASE_URL ||
    DEFAULT_COMET_API_BASE_URL;

  if (!hasValue(candidate)) {
    return DEFAULT_COMET_API_BASE_URL;
  }

  return candidate.replace(/\/$/, "");
}
