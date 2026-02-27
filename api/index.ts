import type { VercelRequest, VercelResponse } from "@vercel/node";
import klingVideoHandler from "./test/kling-video";
import klingVideoStatusHandler from "./test/kling-video-status";

const COOKIE_NAME = "app_session_id";
const SUPERVISOR_ALLOWLIST = [
  "gabrieltan0506@gmail.com",
  "benjamintan0506@163.com",
] as const;
const MASKED_SUPERVISOR_ALLOWLIST = ["g***6@gmail.com", "b***6@163.com"] as const;

type ProviderDiagState = "reachable" | "unconfigured" | "error";

type ProviderDiagItem = {
  name: string;
  type: "image" | "video" | "text" | "music";
  role: string;
  paidOnly: boolean;
  state: ProviderDiagState;
  latencyMs: number;
  error: string | null;
};

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasAnyEnv(keys: string[]): boolean {
  return keys.some(key => hasValue(process.env[key]));
}

function classifyConfig(parts: { keys: string[]; label: string }[]): {
  state: ProviderDiagState;
  error: string | null;
} {
  for (const item of parts) {
    const present = item.keys.filter(key => hasValue(process.env[key])).length;
    if (present > 0 && present < item.keys.length) {
      return {
        state: "error",
        error: `partial config: ${item.label}`,
      };
    }
    if (present === 0) {
      return {
        state: "unconfigured",
        error: `${item.label} missing`,
      };
    }
  }

  return {
    state: "reachable",
    error: null,
  };
}

function resolveKlingCnState(): { state: ProviderDiagState; error: string | null } {
  const hasAccessKey = hasValue(process.env.KLING_CN_VIDEO_ACCESS_KEY);
  const hasSecretKey = hasValue(process.env.KLING_CN_VIDEO_SECRET_KEY);
  if (!hasAccessKey && !hasSecretKey) {
    return { state: "unconfigured", error: "Missing KLING_CN_VIDEO_ACCESS_KEY and KLING_CN_VIDEO_SECRET_KEY" };
  }
  if (!hasAccessKey) {
    return { state: "unconfigured", error: "Missing KLING_CN_VIDEO_ACCESS_KEY" };
  }
  if (!hasSecretKey) {
    return { state: "unconfigured", error: "Missing KLING_CN_VIDEO_SECRET_KEY" };
  }
  return { state: "reachable", error: null };
}

function buildProviders(): ProviderDiagItem[] {
  const forgeState = hasValue(process.env.PLAYGROUND_API_KEY)
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "PLAYGROUND_API_KEY missing" };

  const nanoState = hasValue(process.env.GEMINI_API_KEY)
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "GEMINI_API_KEY missing" };

  const klingState = resolveKlingCnState();

  const falState = hasValue(process.env.FAL_API_KEY)
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "FAL_API_KEY missing" };

  const veoState = hasValue(process.env.GEMINI_API_KEY)
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "GEMINI_API_KEY missing" };

  const cometState = hasAnyEnv(["COMET_API_KEY", "COMETAPI_API_KEY", "COMETAPI_KEY"])
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "COMETAPI key missing" };

  const geminiFlashState = hasValue(process.env.GEMINI_API_KEY)
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "GEMINI_API_KEY missing" };

  const geminiProState = hasValue(process.env.GEMINI_API_KEY)
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "GEMINI_API_KEY missing" };

  const gptState = cometState;

  const sunoState = hasValue(process.env.COMETAPI_KEY)
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "COMETAPI key missing" };

  return [
    {
      name: "playground-v2.5-1024px-aesthetic",
      type: "image",
      role: "free",
      paidOnly: false,
      state: forgeState.state,
      latencyMs: 0,
      error: forgeState.error,
    },
    {
      name: "nano-banana-pro",
      type: "image",
      role: "paidOnly",
      paidOnly: true,
      state: nanoState.state,
      latencyMs: 0,
      error: nanoState.error,
    },
    {
      name: "kling_beijing",
      type: "video",
      role: "free",
      paidOnly: false,
      state: klingState.state,
      latencyMs: 0,
      error: klingState.error,
    },
    {
      name: "fal_kling_video",
      type: "video",
      role: "fallback",
      paidOnly: false,
      state: falState.state,
      latencyMs: 0,
      error: falState.error,
    },
    {
      name: "veo_3_1",
      type: "video",
      role: "paidOnly",
      paidOnly: true,
      state: veoState.state,
      latencyMs: 0,
      error: veoState.error,
    },
    {
      name: "cometapi",
      type: "video",
      role: "fallback",
      paidOnly: false,
      state: cometState.state,
      latencyMs: 0,
      error: cometState.error,
    },
    {
      name: "gemini_3_flash",
      type: "text",
      role: "default",
      paidOnly: false,
      state: geminiFlashState.state,
      latencyMs: 0,
      error: geminiFlashState.error,
    },
    {
      name: "gemini_3_pro",
      type: "text",
      role: "paidOnly",
      paidOnly: true,
      state: geminiProState.state,
      latencyMs: 0,
      error: geminiProState.error,
    },
    {
      name: "gpt_5_1",
      type: "text",
      role: "paidOnly",
      paidOnly: true,
      state: gptState.state,
      latencyMs: 0,
      error: gptState.error,
    },
    {
      name: "suno_4_5",
      type: "music",
      role: "paidOnly",
      paidOnly: true,
      state: sunoState.state,
      latencyMs: 0,
      error: sunoState.error,
    },
  ];
}

function normalizeEmail(email: string | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function isSupervisorEmail(email: string | undefined): boolean {
  const normalized = normalizeEmail(email);
  return SUPERVISOR_ALLOWLIST.includes(normalized as (typeof SUPERVISOR_ALLOWLIST)[number]);
}

function getCookie(req: VercelRequest, name: string): string | undefined {
  const direct = req.cookies?.[name];
  if (typeof direct === "string" && direct.length > 0) return direct;

  const header = req.headers.cookie;
  if (!header) return undefined;
  const cookieHeader = Array.isArray(header) ? header.join("; ") : header;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }

  return undefined;
}

function resolveEffectiveTier(req: VercelRequest): "free" | "beta" | "paid" | "supervisor" | "unknown" {
  const cookieValue = getCookie(req, COOKIE_NAME);
  if (!cookieValue) return "unknown";

  const emailHeader = req.headers["x-user-email"];
  const email = typeof emailHeader === "string" ? emailHeader : undefined;
  if (isSupervisorEmail(email)) return "supervisor";

  const tierHeader = req.headers["x-user-tier"];
  const tier = (typeof tierHeader === "string" ? tierHeader : "").toLowerCase();
  if (tier === "supervisor" || tier === "paid" || tier === "beta" || tier === "free") {
    return tier;
  }

  return "free";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).setHeader("Allow", "GET").send("Method Not Allowed");
    }

    const requestUrl = req.url ?? "";
    const pathname = requestUrl.split("?")[0] ?? "";
    const headerPaths = [
      req.headers["x-original-url"],
      req.headers["x-rewrite-url"],
      req.headers["x-matched-path"],
      req.headers["x-forwarded-uri"],
    ]
      .flatMap(value => (Array.isArray(value) ? value : [value]))
      .filter((value): value is string => typeof value === "string")
      .map(value => value.split("?")[0]);
    const pathCandidates = [pathname, ...headerPaths];
    const isDiagProviders = pathCandidates.includes("/api/diag/providers");
    const isKlingVideoStatusTest = pathCandidates.includes("/api/test/kling-video/status");
    const isKlingVideoTest = pathCandidates.includes("/api/test/kling-video");

    if (isKlingVideoStatusTest) {
      await klingVideoStatusHandler(req, res);
      return;
    }

    if (isKlingVideoTest) {
      await klingVideoHandler(req, res);
      return;
    }

    if (isDiagProviders) {
      const routingMap = {
        free: {
          image: ["playground-v2.5-1024px-aesthetic", "nano-banana-pro", "kling_image"],
          video: ["kling_beijing", "fal_kling_video", "veo_3_1", "cometapi"],
          text: ["basic_model", "gemini_3_flash", "gemini_3_pro", "gpt_5_1"],
        },
        beta: {
          image: ["playground-v2.5-1024px-aesthetic", "nano-banana-pro", "kling_image"],
          video: ["kling_beijing", "fal_kling_video", "veo_3_1", "cometapi"],
          text: ["gemini_3_flash", "basic_model", "gemini_3_pro", "gpt_5_1"],
        },
        paid: {
          image: ["nano-banana-pro", "playground-v2.5-1024px-aesthetic", "kling_image"],
          video: ["veo_3_1", "fal_kling_video", "kling_beijing", "cometapi"],
          text: ["gemini_3_pro", "gpt_5_1", "gemini_3_flash", "basic_model"],
        },
        supervisor: {
          image: ["nano-banana-pro", "playground-v2.5-1024px-aesthetic", "kling_image"],
          video: ["veo_3_1", "kling_beijing", "fal_kling_video", "cometapi"],
          text: ["gemini_3_pro", "gpt_5_1", "gemini_3_flash", "basic_model"],
        },
      };
      return res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
        providers: buildProviders(),
        routing: routingMap,
        routingMap,
        supervisorAllowlist: [...MASKED_SUPERVISOR_ALLOWLIST],
        effectiveTier: "supervisor",
      });
    }

    res.setHeader("Content-Security-Policy", "default-src 'self'");
    return res.status(200).send("ok");
  } catch (error) {
    console.error(error);
    return res.status(200).json({
      status: "error",
      timestamp: new Date().toISOString(),
      providers: buildProviders(),
      supervisorAllowlist: [...MASKED_SUPERVISOR_ALLOWLIST],
      effectiveTier: "supervisor",
    });
  }
}
