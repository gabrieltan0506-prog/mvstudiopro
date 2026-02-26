import { getTierProviderChain, type UserTier } from "./tier-provider-routing";
import { getCometApiBaseUrl, getCometApiKey } from "./cometapi";

type ProviderType = "video" | "music" | "image" | "text";
type ProviderName = "veo" | "kling" | "fal" | "comet" | "gemini" | "nano" | "forge" | "suno";
type ProviderState = "ok" | "not_configured" | "timeout" | "error";
type EffectiveTier = UserTier | "unknown";
type RoutingMap = Record<UserTier, Record<"image" | "video" | "text", string[]>>;

export type ProviderDiagItem = {
  name: ProviderName;
  provider?: string;
  modelId?: string;
  type: ProviderType;
  role: string;
  paidOnly: boolean;
  state: ProviderState;
  latencyMs: number;
  error: string | null;
};

export type ProviderDiagResponse = {
  status: "ok" | "degraded" | "error";
  timestamp: string;
  effectiveTier: EffectiveTier;
  providers: ProviderDiagItem[];
  routingMap: RoutingMap;
  routing: RoutingMap;
};

type CheckResult = {
  ok: boolean;
  error?: string;
};

type ProviderSpec = {
  name: ProviderName;
  provider?: string;
  modelId?: string;
  type: ProviderType;
  role: string;
  paidOnly: boolean;
  check: () => Promise<CheckResult>;
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

function inferProviderState(errorMessage: string): ProviderState {
  const lower = errorMessage.toLowerCase();
  if (lower.includes("missing")) return "not_configured";
  if (lower.includes("timeout") || lower.includes("abort")) return "timeout";
  return "error";
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
    return ok ? { ok: true } : { ok: false, error: `HTTP ${response.status}` };
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

async function checkKlingBeijingVideoApi(timeoutMs: number): Promise<CheckResult> {
  const videoAccessKey = getFirstEnv(["KLING_VIDEO_ACCESS_KEY", "KLING_ACCESS_KEY", "KLING_ACCESS_KEY_1"]);
  const videoSecretKey = getFirstEnv(["KLING_VIDEO_SECRET_KEY", "KLING_SECRET_KEY", "KLING_SECRET_KEY_1"]);
  if (!hasValue(videoAccessKey) || !hasValue(videoSecretKey)) {
    return { ok: false, error: "KLING video key missing" };
  }
  return await pingUrl("https://api-beijing.klingai.com", timeoutMs);
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
  const cometKey = getCometApiKey();
  if (!hasValue(cometKey)) {
    return { ok: false, error: "COMETAPI key missing" };
  }
  const base = getCometApiBaseUrl();
  return await pingUrl(`${base}/v1/models`, timeoutMs, {
    Authorization: `Bearer ${cometKey}`,
  });
}

function buildRoutingMap(): RoutingMap {
  const safeTierChain = (tier: UserTier, surface: "image" | "video" | "text"): string[] => {
    try {
      return getTierProviderChain(tier, surface);
    } catch (error) {
      console.error(`[ProviderDiag] Failed to build routing chain for ${tier}/${surface}:`, error);
      return [];
    }
  };

  return {
    free: {
      image: safeTierChain("free", "image"),
      video: safeTierChain("free", "video"),
      text: safeTierChain("free", "text"),
    },
    beta: {
      image: safeTierChain("beta", "image"),
      video: safeTierChain("beta", "video"),
      text: safeTierChain("beta", "text"),
    },
    paid: {
      image: safeTierChain("paid", "image"),
      video: safeTierChain("paid", "video"),
      text: safeTierChain("paid", "text"),
    },
    supervisor: {
      image: safeTierChain("supervisor", "image"),
      video: safeTierChain("supervisor", "video"),
      text: safeTierChain("supervisor", "text"),
    },
  };
}

async function runCheck(config: ProviderSpec): Promise<ProviderDiagItem> {
  const start = nowMs();
  try {
    const result = await config.check();
    const latencyMs = nowMs() - start;
    if (result.ok) {
      return {
        name: config.name,
        ...(config.provider ? { provider: config.provider } : {}),
        ...(config.modelId ? { modelId: config.modelId } : {}),
        type: config.type,
        role: config.role,
        paidOnly: config.paidOnly,
        state: "ok",
        latencyMs,
        error: null,
      };
    }

    const errorMessage = result.error || "check failed";
    return {
      name: config.name,
      ...(config.provider ? { provider: config.provider } : {}),
      ...(config.modelId ? { modelId: config.modelId } : {}),
      type: config.type,
      role: config.role,
      paidOnly: config.paidOnly,
      state: inferProviderState(errorMessage),
      latencyMs,
      error: errorMessage,
    };
  } catch (error) {
    const latencyMs = nowMs() - start;
    const message = toErrorMessage(error);
    return {
      name: config.name,
      ...(config.provider ? { provider: config.provider } : {}),
      ...(config.modelId ? { modelId: config.modelId } : {}),
      type: config.type,
      role: config.role,
      paidOnly: config.paidOnly,
      state: inferProviderState(message),
      latencyMs,
      error: message,
    };
  }
}

function buildProviderSpecs(timeoutMs: number): ProviderSpec[] {
  let geminiPingPromise: Promise<CheckResult> | null = null;
  let forgePingPromise: Promise<CheckResult> | null = null;

  const geminiPing = () => {
    if (!geminiPingPromise) {
      geminiPingPromise = checkGeminiApi(timeoutMs);
    }
    return geminiPingPromise;
  };

  const forgePing = () => {
    if (!forgePingPromise) {
      forgePingPromise = checkForgeApi(timeoutMs);
    }
    return forgePingPromise;
  };

  return [
    {
      name: "veo",
      type: "video",
      role: "primary",
      paidOnly: true,
      check: async () => await geminiPing(),
    },
    {
      name: "kling",
      type: "video",
      role: "primary",
      paidOnly: false,
      check: async () => {
        const videoResult = await checkKlingBeijingVideoApi(timeoutMs);
        if (videoResult.ok) return videoResult;
        return await checkKlingImageApi(timeoutMs);
      },
    },
    {
      name: "fal",
      type: "video",
      role: "fallback",
      paidOnly: false,
      check: async () => await checkFalApi(timeoutMs),
    },
    {
      name: "comet",
      provider: "cometapi",
      type: "video",
      role: "fallback",
      paidOnly: false,
      check: async () => await checkCometApi(timeoutMs),
    },
    {
      name: "gemini",
      provider: "gemini",
      type: "text",
      role: "primary",
      paidOnly: false,
      check: async () => await geminiPing(),
    },
    {
      name: "nano",
      type: "image",
      role: "primary",
      paidOnly: true,
      check: async () => await geminiPing(),
    },
    {
      name: "forge",
      type: "image",
      role: "primary",
      paidOnly: false,
      check: async () => await forgePing(),
    },
    {
      name: "suno",
      type: "music",
      role: "primary",
      paidOnly: false,
      check: async () => await checkSunoApi(timeoutMs),
    },
  ];
}

function buildUnavailableProviders(specs: ProviderSpec[]): ProviderDiagItem[] {
  return specs.map((spec) => ({
    name: spec.name,
    ...(spec.provider ? { provider: spec.provider } : {}),
    ...(spec.modelId ? { modelId: spec.modelId } : {}),
    type: spec.type,
    role: spec.role,
    paidOnly: spec.paidOnly,
    state: "error",
    latencyMs: 0,
    error: "diagnostics unavailable",
  }));
}

export function getProviderDiagnosticsFallback(effectiveTier: EffectiveTier = "unknown"): ProviderDiagResponse {
  const routingMap = buildRoutingMap();
  return {
    status: "error",
    timestamp: new Date().toISOString(),
    effectiveTier,
    providers: buildUnavailableProviders(buildProviderSpecs(0)),
    routingMap,
    routing: routingMap,
  };
}

export async function getProviderDiagnostics(
  timeoutMs: number = 8000,
  effectiveTier: EffectiveTier = "unknown"
): Promise<ProviderDiagResponse> {
  const routingMap = buildRoutingMap();
  const providerSpecs = buildProviderSpecs(timeoutMs);

  try {
    const providers = await Promise.all(providerSpecs.map((spec) => runCheck(spec)));

    const okCount = providers.filter((p) => p.state === "ok").length;
    const status: ProviderDiagResponse["status"] =
      okCount === providers.length ? "ok" : okCount > 0 ? "degraded" : "error";

    return {
      status,
      timestamp: new Date().toISOString(),
      effectiveTier,
      providers,
      routingMap,
      routing: routingMap,
    };
  } catch (error) {
    console.error("[ProviderDiag] getProviderDiagnostics failed:", error);
    return getProviderDiagnosticsFallback(effectiveTier);
  }
}
