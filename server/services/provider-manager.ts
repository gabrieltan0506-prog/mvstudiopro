export type GenerationProvider =
  | "fal.ai"
  | "nano-banana-pro"
  | "veo3.1-pro"
  | "forge"
  | "kling_beijing"
  | "veo_3_1"
  | "fal_kling_video"
  | "cometapi"
  | "kling_image"
  | "basic_model"
  | "gemini_3_flash"
  | "gemini_3_pro"
  | "gpt_5_1";

export const DEFAULT_PROVIDER_CHAIN: GenerationProvider[] = [
  "fal.ai",
  "nano-banana-pro",
  "veo3.1-pro",
];

export type ProviderAttempt = {
  provider: GenerationProvider;
  ok: boolean;
  latencyMs: number;
  errorCode?: string;
  errorMessage?: string;
};

export type ProviderFallbackInfo = {
  chain: GenerationProvider[];
  attempts: ProviderAttempt[];
  totalLatencyMs: number;
  providerUsed: GenerationProvider | null;
};

export type ProviderSuccessResult<T> = {
  success: true;
  providerUsed: GenerationProvider;
  jobId: string | null;
  data: T;
  fallback: ProviderFallbackInfo;
};

export type ProviderFailedResult = {
  success: false;
  providerUsed: null;
  jobId: null;
  data: null;
  error: string;
  fallback: ProviderFallbackInfo;
};

export type ProviderExecutionResult<T> =
  | ProviderSuccessResult<T>
  | ProviderFailedResult;

type ExecuteProviderFallbackParams<T> = {
  apiName: string;
  execute: (provider: GenerationProvider) => Promise<{
    data: T;
    jobId?: string | null;
  }>;
  providers?: GenerationProvider[];
};

function extractErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return String((error as { status: number }).status);
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  const httpCode = message.match(/\b([45]\d{2})\b/);
  if (httpCode?.[1]) return httpCode[1];
  return undefined;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "Unknown provider error");
}

export async function executeProviderFallback<T>(
  params: ExecuteProviderFallbackParams<T>
): Promise<ProviderExecutionResult<T>> {
  const providers = params.providers ?? DEFAULT_PROVIDER_CHAIN;
  const attempts: ProviderAttempt[] = [];
  const startedAt = Date.now();

  for (const provider of providers) {
    const attemptStartedAt = Date.now();
    try {
      const result = await params.execute(provider);
      const latencyMs = Date.now() - attemptStartedAt;
      attempts.push({
        provider,
        ok: true,
        latencyMs,
      });

      const fallbackInfo: ProviderFallbackInfo = {
        chain: [...providers],
        attempts,
        totalLatencyMs: Date.now() - startedAt,
        providerUsed: provider,
      };

      console.info("[ProviderFallback] success", {
        apiName: params.apiName,
        providerUsed: provider,
        totalLatencyMs: fallbackInfo.totalLatencyMs,
        attempts: attempts.map((a) => ({
          provider: a.provider,
          ok: a.ok,
          latencyMs: a.latencyMs,
          errorCode: a.errorCode,
        })),
      });

      return {
        success: true,
        providerUsed: provider,
        jobId: result.jobId ?? null,
        data: result.data,
        fallback: fallbackInfo,
      };
    } catch (error) {
      const latencyMs = Date.now() - attemptStartedAt;
      const errorCode = extractErrorCode(error);
      const errorMessage = extractErrorMessage(error);
      attempts.push({
        provider,
        ok: false,
        latencyMs,
        errorCode,
        errorMessage,
      });

      console.warn("[ProviderFallback] provider failed", {
        apiName: params.apiName,
        provider,
        latencyMs,
        errorCode,
        errorMessage,
        fallbackPath: providers.slice(0, attempts.length).join(" -> "),
      });
    }
  }

  const fallbackInfo: ProviderFallbackInfo = {
    chain: [...providers],
    attempts,
    totalLatencyMs: Date.now() - startedAt,
    providerUsed: null,
  };

  const finalError =
    attempts.at(-1)?.errorMessage ?? "All providers in fallback chain failed";
  console.error("[ProviderFallback] all providers failed", {
    apiName: params.apiName,
    totalLatencyMs: fallbackInfo.totalLatencyMs,
    attempts,
  });

  return {
    success: false,
    providerUsed: null,
    jobId: null,
    data: null,
    error: finalError,
    fallback: fallbackInfo,
  };
}
