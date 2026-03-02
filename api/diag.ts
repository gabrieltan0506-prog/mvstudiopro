import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getVertexAccessToken } from "./vertex.js";

function asString(v: any): string {
  if (v == null) return "";
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

async function probeImageModel(input: {
  token: string;
  projectId: string;
  location: string;
  model: string;
}): Promise<Record<string, any>> {
  if (!input.model) {
    return { ok: false, error: "missing_model_env" };
  }

  const baseUrl =
    input.location === "global"
      ? "https://aiplatform.googleapis.com"
      : `https://${input.location}-aiplatform.googleapis.com`;
  const url = `${baseUrl}/v1/projects/${input.projectId}/locations/${input.location}/publishers/google/models/${input.model}:generateContent`;

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "health check image" }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    });

    const json: any = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return {
        ok: false,
        status: upstream.status,
        error: "upstream_error",
        raw: json,
      };
    }

    const parts: any[] = json?.candidates?.[0]?.content?.parts || [];
    const hasImage = parts.some((p) => Boolean(p?.inlineData?.data));
    return {
      ok: hasImage,
      status: upstream.status,
      hasImage,
      error: hasImage ? undefined : "no_image_in_response",
    };
  } catch (e: any) {
    return {
      ok: false,
      error: "request_failed",
      detail: e?.message || String(e),
    };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const projectId = asString(process.env.VERTEX_PROJECT_ID);
  const location = asString(process.env.VERTEX_LOCATION || "global");
  const flashModel = asString(process.env.VERTEX_IMAGE_MODEL_FLASH);
  const proModel = asString(process.env.VERTEX_IMAGE_MODEL_PRO);

  const base = {
    status: "ok",
    timestamp: new Date().toISOString(),
    env: {
      hasGoogleCredentialsJson: Boolean(asString(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)),
      hasVertexProjectId: Boolean(projectId),
      location,
      flashModel: flashModel || null,
      proModel: proModel || null,
    },
  } as Record<string, any>;

  // default to active checks; allow turning off with /api/diag?check=0
  const runCheck = asString(req.query?.check) !== "0";
  if (!runCheck) {
    return res.status(200).json({ ...base, checksSkipped: true });
  }

  if (!projectId) {
    return res.status(200).json({
      ...base,
      vertexImageCheck: {
        ok: false,
        error: "missing_env",
        detail: "Missing VERTEX_PROJECT_ID",
      },
    });
  }

  try {
    const token = await getVertexAccessToken();
    const [flash, pro] = await Promise.all([
      probeImageModel({ token, projectId, location, model: flashModel }),
      probeImageModel({ token, projectId, location, model: proModel }),
    ]);

    return res.status(200).json({
      ...base,
      vertexImageCheck: {
        ok: Boolean(flash?.ok || pro?.ok),
        flash,
        pro,
      },
    });
  } catch (e: any) {
    return res.status(200).json({
      ...base,
      vertexImageCheck: {
        ok: false,
        error: "token_failed",
        detail: e?.message || String(e),
      },
    });
  }
}
