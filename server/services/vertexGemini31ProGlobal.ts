/**
 * 翻譯中樞：Vertex AI **實體區域**（預設 `us-central1`）+ **gemini-3.1-pro-preview**（不依賴 Consumer API Key）。
 * Vertex **不可**使用 `location: "global"`（SDK 會打到無效主機、回 HTML 404，進而觸發 JSON 解析錯誤）。
 * Vercel 無實體憑證檔路徑，須從 **GOOGLE_APPLICATION_CREDENTIALS_JSON** 注入並修復 **private_key** 換行轉義。
 */
import { VertexAI } from "@google-cloud/vertexai";

function resolveProjectId(): string {
  const p = String(
    process.env.GCP_PROJECT_ID || process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "",
  ).trim();
  if (!p) {
    throw new Error("missing_GCP_PROJECT_ID_or_VERTEX_PROJECT_ID");
  }
  return p;
}

/** Gemini 3.1 Pro 文本：須為 Vertex 已開通區域（Console 配額多在 us-central1）。 */
function resolveVertexGemini31Location(): string {
  const loc = String(
    process.env.GCP_LOCATION || process.env.VERTEX_GEMINI_LOCATION || "us-central1",
  ).trim();
  return loc || "us-central1";
}

/** 與 Vercel JSON 環變相容：解析失敗回 `{}`，私鑰 `\\n` → 真換行。 */
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
    } else {
      console.warn("[Vertex 警告]: GOOGLE_APPLICATION_CREDENTIALS_JSON 为空");
    }
  } catch (error) {
    console.error("[Vertex 授权异常] 解析 JSON 凭证失败:", error);
  }

  return credentials;
}

let vertexSingleton: VertexAI | null = null;
let vertexSingletonLocation: string | null = null;

function getVertexClientForGemini31Pro(): VertexAI {
  const location = resolveVertexGemini31Location();
  if (!vertexSingleton || vertexSingletonLocation !== location) {
    const credentials = parseCredentialsFromVercelJsonEnv();
    vertexSingleton = new VertexAI({
      project: resolveProjectId(),
      location,
      googleAuthOptions: {
        credentials,
      },
    });
    vertexSingletonLocation = location;
  }
  return vertexSingleton;
}

export type CallGemini31ProOptions = {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
};

/** Vertex AI（區域節點）驅動 gemini-3.1-pro-preview，不依賴 GEMINI_API_KEY */
export async function callGemini3_1_Pro(prompt: string, opts?: CallGemini31ProOptions): Promise<string> {
  const vertex_ai = getVertexClientForGemini31Pro();
  const generativeModel = vertex_ai.getGenerativeModel({
    model: "gemini-3.1-pro-preview",
    generationConfig: {
      maxOutputTokens: opts?.maxOutputTokens ?? 2048,
      temperature: opts?.temperature ?? 0.4,
      topP: opts?.topP ?? 0.8,
    },
  });

  const request = {
    contents: [{ role: "user" as const, parts: [{ text: prompt }] }],
  };

  try {
    const streamingResp = await generativeModel.generateContent(request);
    const response = streamingResp.response;
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return text
      .replace(/```[a-z]*\n?/gi, "")
      .replace(/```/g, "")
      .trim();
  } catch (error: any) {
    const errorDetail = error?.message || String(error);
    console.error("[Vertex AI gemini-3.1-pro-preview 崩潰]:", errorDetail);
    throw new Error(`[Vertex 翻译失败] 原因: ${errorDetail}`);
  }
}
