/**
 * Vertex IAM **`locations/global`** `generateContent`（與 {@link ../../api/google.ts} `vertexTranslate` 一致）：
 * **gemini-3-flash-preview** · `VERTEX_PROJECT_ID` + `getVertexAccessToken`（非 Consumer `GEMINI_API_KEY`）。
 */
import { getVertexAccessToken } from "../utils/vertex.js";

function s(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; url: string; json: unknown | null; rawHead: string }> {
  const r = await fetch(url, init);
  const t = await r.text();
  let json: unknown | null = null;
  try {
    json = JSON.parse(t) as unknown;
  } catch {
    /* empty */
  }
  return { ok: r.ok, status: r.status, url, json, rawHead: t.slice(0, 2400) };
}

type VertexGenRaw = { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };

function extractTextFromGenerateContent(raw: unknown): string {
  const c0 = (raw as VertexGenRaw)?.candidates?.[0];
  const parts = Array.isArray(c0?.content?.parts) ? c0.content.parts : [];
  return parts.map((p) => s(p?.text)).join("").trim();
}

export async function vertexGemini3FlashGenerateContent(
  prompt: string,
  cfg?: { temperature?: number; maxOutputTokens?: number; signal?: AbortSignal },
): Promise<string> {
  const projectId = String(process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "").trim();
  if (!projectId) throw new Error("missing_VERTEX_PROJECT_ID");

  const token = await getVertexAccessToken();
  const model = "gemini-3-flash-preview";
  const bodyStr = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: cfg?.temperature ?? 0.4,
      maxOutputTokens: cfg?.maxOutputTokens ?? 8192,
    },
  });

  const location = "global";
  const url = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
  const r = await fetchJson(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: bodyStr,
    signal: cfg?.signal ?? AbortSignal.timeout(120_000),
  });

  if (r.ok) {
    const raw = r.json;
    const text = extractTextFromGenerateContent(raw);
    if (!text) {
      const hint = typeof raw === "object" && raw !== null ? JSON.stringify(raw).slice(0, 800) : r.rawHead;
      throw new Error(`vertex ${model} (${location}) 无文本产出: ${hint}`);
    }
    return text;
  }

  const errSnippet = r.json != null ? JSON.stringify(r.json).slice(0, 1600) : r.rawHead || "";
  throw new Error(`vertex ${model} (${location}) HTTP ${r.status}: ${errSnippet}`);
}
