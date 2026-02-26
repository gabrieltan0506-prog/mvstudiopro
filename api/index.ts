import type { VercelRequest, VercelResponse } from "@vercel/node";
import { COOKIE_NAME } from "../shared/const";
import * as db from "../server/db";
import { sdk } from "../server/_core/sdk";
import { getSupervisorAllowlist, isSupervisorEmail } from "../server/services/access-policy";

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

function buildProviders(): ProviderDiagItem[] {
  const forgeState = hasValue(process.env.BUILT_IN_FORGE_API_KEY)
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "BUILT_IN_FORGE_API_KEY missing" };

  const nanoState = hasValue(process.env.GEMINI_API_KEY)
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "GEMINI_API_KEY missing" };

  const klingState = classifyConfig([
    {
      keys: ["KLING_VIDEO_ACCESS_KEY", "KLING_ACCESS_KEY", "KLING_ACCESS_KEY_1"],
      label: "KLING video access key",
    },
    {
      keys: ["KLING_VIDEO_SECRET_KEY", "KLING_SECRET_KEY", "KLING_SECRET_KEY_1"],
      label: "KLING video secret key",
    },
  ]);

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

  const sunoState = hasValue(process.env.SUNO_API_KEY)
    ? { state: "reachable" as const, error: null }
    : { state: "unconfigured" as const, error: "SUNO_API_KEY missing" };

  return [
    {
      name: "forge",
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

async function resolveEffectiveTier(
  req: VercelRequest
): Promise<"free" | "beta" | "paid" | "supervisor" | "unknown"> {
  try {
    const cookieValue = req.cookies?.[COOKIE_NAME];
    const session = await sdk.verifySession(cookieValue);

    if (!session?.openId) return "unknown";

    const user = await db.getUserByOpenId(session.openId);
    if (!user) return "unknown";

    if (isSupervisorEmail(user.email) || user.role === "supervisor") {
      return "supervisor";
    }
    if (user.role === "paid" || user.role === "admin") {
      return "paid";
    }
    if (user.role === "beta") {
      return "beta";
    }

    return "free";
  } catch {
    return "unknown";
  }
}

export default function handler(req: VercelRequest, res: VercelResponse) {
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

    if (isDiagProviders) {
      const routingMap = {
        free: {
          image: ["forge", "nano-banana-pro", "kling_image"],
          video: ["kling_beijing", "fal_kling_video", "veo_3_1", "cometapi"],
          text: ["basic_model", "gemini_3_flash", "gemini_3_pro", "gpt_5_1"],
        },
        beta: {
          image: ["forge", "nano-banana-pro", "kling_image"],
          video: ["kling_beijing", "fal_kling_video", "veo_3_1", "cometapi"],
          text: ["gemini_3_flash", "basic_model", "gemini_3_pro", "gpt_5_1"],
        },
        paid: {
          image: ["nano-banana-pro", "forge", "kling_image"],
          video: ["veo_3_1", "fal_kling_video", "kling_beijing", "cometapi"],
          text: ["gemini_3_pro", "gpt_5_1", "gemini_3_flash", "basic_model"],
        },
        supervisor: {
          image: ["nano-banana-pro", "forge", "kling_image"],
          video: ["veo_3_1", "kling_beijing", "fal_kling_video", "cometapi"],
          text: ["gemini_3_pro", "gpt_5_1", "gemini_3_flash", "basic_model"],
        },
      };

      return resolveEffectiveTier(req)
        .then(effectiveTier => {
          return res.status(200).json({
            status: "ok",
            timestamp: new Date().toISOString(),
            providers: buildProviders(),
            routing: routingMap,
            routingMap,
            supervisorAllowlist: getSupervisorAllowlist(true),
            effectiveTier,
          });
        })
        .catch(() => {
          return res.status(200).json({
            status: "degraded",
            timestamp: new Date().toISOString(),
            providers: buildProviders(),
            routing: routingMap,
            routingMap,
            supervisorAllowlist: getSupervisorAllowlist(true),
            effectiveTier: "unknown",
          });
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
      supervisorAllowlist: getSupervisorAllowlist(true),
      effectiveTier: "unknown",
    });
  }
}
