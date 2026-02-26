type ProviderType = "video" | "music" | "image" | "text";

type ProviderState = "ok" | "not_configured" | "timeout" | "error";

export type ProviderDiagItem = {
  name: string;
  type: ProviderType;
  role: string;
  state: ProviderState;
  latencyMs: number;
  error: string | null;
  capabilities?: string[];
};

export type ProviderDiagResponse = {
  status: "ok" | "degraded" | "error";
  timestamp: string;
  providers: ProviderDiagItem[];
};

type CheckResult = {
  ok: boolean;
  error?: string;
};

function nowMs() {
  return Date.now();
}

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function getFirstEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (hasValue(value)) {
      return value;
    }
  }
  return undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? "unknown error");
}

async function pingUrl(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<CheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const ok = response.status < 500;
    return ok
      ? { ok: true }
      : { ok: false, error: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function checkGeminiApi(timeoutMs: number): Promise<CheckResult> {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!hasValue(geminiApiKey)) {
    return { ok: false, error: "GEMINI_API_KEY missing" };
  }
  return await pingUrl(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(geminiApiKey)}`,
    timeoutMs
  );
}

async function checkFalApi(timeoutMs: number): Promise<CheckResult> {
  const falKey = process.env.FAL_API_KEY;
  if (!hasValue(falKey)) {
    return { ok: false, error: "FAL_API_KEY missing" };
  }
  return await pingUrl("https://fal.run", timeoutMs, {
    Authorization: `Key ${falKey}`,
  });
}

async function checkSunoApi(timeoutMs: number): Promise<CheckResult> {
  const sunoKey = process.env.SUNO_API_KEY;
  if (!hasValue(sunoKey)) {
    return { ok: false, error: "SUNO_API_KEY missing" };
  }
  const base = process.env.SUNO_API_BASE || "https://api.sunoapi.org";
  const url = `${base.replace(/\/$/, "")}/api/v1/generate/record-info?taskId=diag-health-check`;
  return await pingUrl(url, timeoutMs, {
    Authorization: `Bearer ${sunoKey}`,
  });
}

async function checkKlingImageApi(timeoutMs: number): Promise<CheckResult> {
  const klingAccessKey = getFirstEnv(["KLING_ACCESS_KEY", "KLING_ACCESS_KEY_1"]);
  const klingSecretKey = getFirstEnv(["KLING_SECRET_KEY", "KLING_SECRET_KEY_1"]);
  if (!hasValue(klingAccessKey) || !hasValue(klingSecretKey)) {
    return { ok: false, error: "KLING_ACCESS_KEY/KLING_SECRET_KEY missing" };
  }
  const region = (process.env.KLING_REGION || process.env.KLING_DEFAULT_REGION || "cn").toLowerCase();
  const base = region === "global" ? "https://api-singapore.klingai.com" : "https://api-beijing.klingai.com";
  return await pingUrl(base, timeoutMs);
}

async function checkForgeApi(timeoutMs: number): Promise<CheckResult> {
  const forgeApiKey = process.env.BUILT_IN_FORGE_API_KEY;
  if (!hasValue(forgeApiKey)) {
    return { ok: false, error: "BUILT_IN_FORGE_API_KEY missing" };
  }
  const forgeBase = process.env.BUILT_IN_FORGE_API_URL || "https://forge.manus.im";
  const url = `${forgeBase.replace(/\/$/, "")}/v1/models`;
  return await pingUrl(url, timeoutMs, {
    Authorization: `Bearer ${forgeApiKey}`,
  });
}

async function checkCometApi(timeoutMs: number): Promise<CheckResult> {
  const cometKey = getFirstEnv(["COMETAPI_API_KEY", "COMET_API_KEY", "COMETAPI_KEY"]);
  if (!hasValue(cometKey)) {
    return { ok: false, error: "COMETAPI key missing" };
  }
  const base = process.env.COMETAPI_BASE_URL || process.env.COMET_API_BASE_URL;
  if (!hasValue(base)) {
    return { ok: true };
  }
  return await pingUrl(base!, timeoutMs, {
    Authorization: `Bearer ${cometKey}`,
  });
}

async function runCheck(
  config: {
    name: string;
    type: ProviderType;
    role: string;
    capabilities?: string[];
  },
  check: () => Promise<CheckResult>
): Promise<ProviderDiagItem> {
  const start = nowMs();
  try {
    const result = await check();
    const latencyMs = nowMs() - start;
    if (result.ok) {
      return {
        name: config.name,
        type: config.type,
        role: config.role,
        state: "ok",
        latencyMs,
        error: null,
        ...(config.capabilities ? { capabilities: config.capabilities } : {}),
      };
    }

    const errorMessage = result.error || "check failed";
    const lower = errorMessage.toLowerCase();
    const state: ProviderState =
      lower.includes("missing")
        ? "not_configured"
        : lower.includes("timeout") || lower.includes("abort")
        ? "timeout"
        : "error";

    return {
      name: config.name,
      type: config.type,
      role: config.role,
      state,
      latencyMs,
      error: errorMessage,
      ...(config.capabilities ? { capabilities: config.capabilities } : {}),
    };
  } catch (error) {
    const latencyMs = nowMs() - start;
    const message = toErrorMessage(error);
    return {
      name: config.name,
      type: config.type,
      role: config.role,
      state: message.toLowerCase().includes("timeout") ? "timeout" : "error",
      latencyMs,
      error: message,
      ...(config.capabilities ? { capabilities: config.capabilities } : {}),
    };
  }
}

export async function getProviderDiagnostics(timeoutMs: number = 8000): Promise<ProviderDiagResponse> {
  const geminiPing = checkGeminiApi(timeoutMs);
  const forgePing = checkForgeApi(timeoutMs);

  const providers = await Promise.all([
    runCheck(
      { name: "veo_3_1", type: "video", role: "primary" },
      async () => await geminiPing
    ),
    runCheck(
      {
        name: "fal_kling_video",
        type: "video",
        role: "primary-feature: motion_control_2_6 + lipsync",
        capabilities: ["motion_control_2_6", "lipsync"],
      },
      async () => await checkFalApi(timeoutMs)
    ),
    runCheck(
      { name: "cometapi", type: "video", role: "fallback" },
      async () => await checkCometApi(timeoutMs)
    ),
    runCheck(
      { name: "suno_4_5", type: "music", role: "primary" },
      async () => await checkSunoApi(timeoutMs)
    ),
    runCheck(
      { name: "nano_banana_pro", type: "image", role: "primary" },
      async () => await geminiPing
    ),
    runCheck(
      { name: "kling_image", type: "image", role: "fallback" },
      async () => await checkKlingImageApi(timeoutMs)
    ),
    runCheck(
      { name: "gemini_3_flash", type: "text", role: "primary" },
      async () => await forgePing
    ),
    runCheck(
      { name: "gemini_3_pro", type: "text", role: "fallback" },
      async () => await forgePing
    ),
    runCheck(
      { name: "gpt_5_1", type: "text", role: "secondary" },
      async () => await forgePing
    ),
  ]);

  const okCount = providers.filter(p => p.state === "ok").length;
  const status: ProviderDiagResponse["status"] =
    okCount === providers.length ? "ok" : okCount > 0 ? "degraded" : "error";

  return {
    status,
    timestamp: new Date().toISOString(),
    providers,
  };
}
