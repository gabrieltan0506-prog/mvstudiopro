/**
 * Gemma 4 31B IT — Vertex AI · **@google-cloud/vertexai**
 *
 * 地域優先級：`VERTEX_GEMMA_LOCATION` → `GCP_LOCATION` → `VERTEX_GEMINI_LOCATION` → 預設 **`global`**
 * （與 `vertexGemini31ProGlobal` 對齊；需其它區時請設 `VERTEX_GEMMA_LOCATION`）。
 *
 * 不依賴 GEMINI_API_KEY。
 */
import { VertexAI } from "@google-cloud/vertexai";

function resolveVertexGemmaModelId(): string {
  return String(process.env.VERTEX_GEMMA_MODEL || "gemma-4-31b-it").trim() || "gemma-4-31b-it";
}

function resolveProjectId(): string {
  const p = String(
    process.env.GCP_PROJECT_ID || process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "",
  ).trim();
  if (!p) {
    throw new Error("missing_GCP_PROJECT_ID_or_VERTEX_PROJECT_ID");
  }
  return p;
}

function resolveVertexGemmaLocation(): string {
  const loc = String(
    process.env.VERTEX_GEMMA_LOCATION || process.env.GCP_LOCATION || process.env.VERTEX_GEMINI_LOCATION || "global",
  ).trim();
  return loc || "global";
}

function parseCredentialsFromVercelJsonEnv(): Record<string, unknown> {
  const raw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  let credentials: Record<string, unknown> = {};

  try {
    if (raw && raw !== "{}") {
      credentials = JSON.parse(raw) as Record<string, unknown>;
      const pk = credentials.private_key;
      if (typeof pk === "string") {
        credentials.private_key = pk.replace(/\\n/g, "\n");
      }
    }
  } catch (error) {
    console.error("[Gemma Vertex] 解析 GOOGLE_APPLICATION_CREDENTIALS_JSON 失败:", error);
  }

  return credentials;
}

let vertexSingleton: VertexAI | null = null;
let vertexSingletonLocation: string | null = null;

function getVertexClientForGemma(): VertexAI {
  const location = resolveVertexGemmaLocation();
  if (!vertexSingleton || vertexSingletonLocation !== location) {
    vertexSingleton = new VertexAI({
      project: resolveProjectId(),
      location,
      googleAuthOptions: {
        credentials: parseCredentialsFromVercelJsonEnv(),
      },
    });
    vertexSingletonLocation = location;
  }
  return vertexSingleton;
}

export async function callGemma4(prompt: string): Promise<string> {
  const raw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  if (!raw) throw new Error("missing_GOOGLE_APPLICATION_CREDENTIALS_JSON");

  const vertex_ai = getVertexClientForGemma();
  const modelName = resolveVertexGemmaModelId();
  const generativeModel = vertex_ai.getGenerativeModel({
    model: modelName,
    generationConfig: {
      maxOutputTokens: 4096,
      temperature: 0.2,
      topP: 0.8,
    },
  });

  const request = {
    contents: [{ role: "user" as const, parts: [{ text: prompt }] }],
  };

  try {
    const streamingResp = await generativeModel.generateContent(request);
    const response = streamingResp.response;
    return String(response.candidates?.[0]?.content?.parts?.[0]?.text || "");
  } catch (error: any) {
    const errorDetail = error?.message || String(error);
    console.error(`[Vertex Gemma ${modelName}]:`, errorDetail);
    throw new Error(`[Vertex Gemma 失败]: ${errorDetail}`);
  }
}
