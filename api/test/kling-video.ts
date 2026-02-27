import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  buildT2VRequest,
  configureKlingClient,
  createOmniVideoTask,
  parseKeysFromEnv,
} from "../../server/kling";
import { getKlingCnConfig } from "../../server/config/klingCn";

const DEFAULT_PROMPT =
  "A woman in red evening dress walks indoors, gradually transforms into ski outfit with reflective goggles, opens the door into heavy snowstorm. cinematic, realistic, continuous shot.";

const DEFAULT_DURATION = "8" as const;
const DEFAULT_ASPECT_RATIO = "16:9" as const;

function normalizeDuration(input: unknown): "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "15" {
  const value = String(input ?? DEFAULT_DURATION).trim();
  const allowed = new Set(["3", "4", "5", "6", "7", "8", "9", "10", "15"]);
  return allowed.has(value) ? (value as any) : DEFAULT_DURATION;
}

function normalizeAspectRatio(input: unknown): "16:9" | "9:16" | "1:1" {
  const value = String(input ?? DEFAULT_ASPECT_RATIO).trim();
  if (value === "9:16" || value === "1:1") return value;
  return "16:9";
}

function parsePostBody(req: VercelRequest): { prompt?: string; duration?: unknown; aspectRatio?: unknown } {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  if (req.body && typeof req.body === "object") {
    return req.body as { prompt?: string; duration?: unknown; aspectRatio?: unknown };
  }
  return {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).setHeader("Allow", "GET, POST").json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    getKlingCnConfig();
  } catch {
    return res.status(400).json({ ok: false, error: "Missing KLING_CN_VIDEO_ACCESS_KEY/SECRET_KEY" });
  }

  const body = req.method === "POST" ? parsePostBody(req) : {};
  const prompt = (body.prompt && String(body.prompt).trim()) || DEFAULT_PROMPT;
  const duration = normalizeDuration(body.duration);
  const aspectRatio = normalizeAspectRatio(body.aspectRatio);

  const keys = parseKeysFromEnv();
  configureKlingClient(keys, "cn");

  const request = buildT2VRequest({
    prompt,
    duration,
    aspectRatio,
  });

  let upstreamStatus: number | null = null;
  let upstreamBodyText = "";

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init);
    upstreamStatus = response.status;
    try {
      upstreamBodyText = await response.clone().text();
    } catch {
      upstreamBodyText = "";
    }
    return response;
  };

  try {
    const raw = await createOmniVideoTask(request, "cn");
    return res.status(200).json({
      ok: true,
      provider: "kling_beijing",
      taskId: raw?.task_id ?? null,
      status: upstreamStatus,
      raw,
      response: upstreamBodyText.slice(0, 1000),
    });
  } catch (error: any) {
    return res.status(upstreamStatus ?? 502).json({
      ok: false,
      provider: "kling_beijing",
      error: error?.message || "Upstream request failed",
      status: upstreamStatus,
      upstream: upstreamBodyText.slice(0, 1000),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}
