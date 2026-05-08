/**
 * Vertex 前半段文案 / 低成本路徑：**區域**（預設 `global`，與專案在 Console 開通一致；可依 `VERTEX_GEMINI_LOCATION` / `GCP_LOCATION` 覆寫為 `us-central1` 等）+ **gemini-3.1-pro-preview**。
 * 可依 `VERTEX_GEMINI_31_PRO_MODEL` 覆寫模型 ID。
 * Vercel / Fly 無實體憑證檔路徑時，須從 **GOOGLE_APPLICATION_CREDENTIALS_JSON** 注入並修復 **private_key** 換行轉義。
 *
 * 【雙軌】平台生圖「英文化」對照測試可走 {@link ../services/geminiPlatformCompositeTranslation.ts} 的 **@google/genai** 路徑（`responseMimeType: application/json`）；本檔為 **@google-cloud/vertexai** 備用。
 */
import { VertexAI } from "@google-cloud/vertexai";

/** Vertex 文字生成模型（預設 gemini-3.1-pro-preview；可依 VERTEX_GEMINI_31_PRO_MODEL 覆寫）。 */
function resolveVertexGemini31ProModelId(): string {
  return (
    String(process.env.VERTEX_GEMINI_31_PRO_MODEL || "gemini-3.1-pro-preview").trim() || "gemini-3.1-pro-preview"
  );
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

/** Gemini 3.1 Pro 文本：預設 **global**（與當前專案/預覽模型常見開通一致）；亦可設 `us-central1` 等。 */
function resolveVertexGemini31Location(): string {
  const loc = String(
    process.env.GCP_LOCATION || process.env.VERTEX_GEMINI_LOCATION || "global",
  ).trim();
  return loc || "global";
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

/** Vertex AI（區域節點）驅動 Gemini 文本（預設 gemini-3.1-pro-preview @ global），不依賴 GEMINI_API_KEY；預設輸出上限 8192。 */
export async function callGemini3_1_Pro(prompt: string, opts?: CallGemini31ProOptions): Promise<string> {
  const vertex_ai = getVertexClientForGemini31Pro();
  const modelName = resolveVertexGemini31ProModelId();
  const generativeModel = vertex_ai.getGenerativeModel({
    model: modelName,
    generationConfig: {
      maxOutputTokens: opts?.maxOutputTokens ?? 8192,
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
    console.error(`[Vertex AI ${modelName} 崩潰]:`, errorDetail);
    throw new Error(`[Vertex 翻译失败] 原因: ${errorDetail}`);
  }
}
