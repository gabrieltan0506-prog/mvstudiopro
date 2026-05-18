/**
 * Vertex 文本：**IAM REST `generateContent`**（與 TestLab **`op=geminiScript`**、`vertexTranslate`、{@link ./vertexGemini3FlashText.ts} 同源）。
 * 使用 **`VERTEX_PROJECT_ID`（或 `GOOGLE_CLOUD_PROJECT` / `GCP_PROJECT_ID`）** + **`getVertexAccessToken`**，**不依賴** `@google-cloud/vertexai` SDK（避免 SDK 對非 JSON 回應解析出 `Unexpected token '<'`）。
 *
 * - 區域：預設 **`VERTEX_GEMINI_LOCATION` → `global`**（與 `api/google.ts` geminiScript 一致；可再用 `GCP_LOCATION` 兜底）
 * - 模型：預設 **`gemini-3.1-pro-preview`**；`VERTEX_GEMINI_31_PRO_MODEL` 或 **`VERTEX_GEMINI_MODEL`** 可覆寫
 */
import { baseUrlForVertex, fetchVertexJson, getVertexAuthHeaders } from "./vertexMedia.js";

function sp(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

type VertexGenRaw = { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };

function extractTextFromGenerateContent(raw: unknown): string {
  const c0 = (raw as VertexGenRaw)?.candidates?.[0];
  const parts = Array.isArray(c0?.content?.parts) ? c0.content.parts : [];
  return parts.map((p) => sp(p?.text)).join("").trim();
}

/** 與 Flash 文本、`geminiScript` 看齊的 project 解析順序 */
function resolveVertexTextProjectId(): string {
  const p = String(
    process.env.VERTEX_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCP_PROJECT_ID ||
      "",
  ).trim();
  if (!p) {
    throw new Error("missing_VERTEX_PROJECT_ID_or_GOOGLE_CLOUD_PROJECT");
  }
  return p;
}

/** Vertex 文字生成模型（geminiScript 同源：`VERTEX_GEMINI_MODEL`） */
function resolveVertexGemini31ProModelId(): string {
  const m = String(
    process.env.VERTEX_GEMINI_31_PRO_MODEL || process.env.VERTEX_GEMINI_MODEL || "gemini-3.1-pro-preview",
  ).trim();
  return m || "gemini-3.1-pro-preview";
}

/** 與 `api/google.ts` geminiScript：`VERTEX_GEMINI_LOCATION` 優先，其次 `GCP_LOCATION`，預設 global */
function resolveVertexGemini31Location(): string {
  const loc = String(process.env.VERTEX_GEMINI_LOCATION || process.env.GCP_LOCATION || "global").trim();
  return loc || "global";
}

export type CallGemini31ProOptions = {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
};

/** 人類可讀：**模型 ID · 區域**（供日誌 / 異常前缀）。 */
export function describeVertexGemini31ProRouting(): string {
  return `${resolveVertexGemini31ProModelId()} · ${resolveVertexGemini31Location()}`;
}

async function vertexGemini31ProRestGenerateContent(body: Record<string, unknown>): Promise<string> {
  const projectId = resolveVertexTextProjectId();
  const modelName = resolveVertexGemini31ProModelId();
  const location = resolveVertexGemini31Location();
  const base = baseUrlForVertex(location);
  const url = `${base}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelName}:generateContent`;
  const headers = await getVertexAuthHeaders();
  const r = await fetchVertexJson(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!r.ok) {
    const errSnippet =
      r.json != null ? JSON.stringify(r.json).slice(0, 1600) : (r.rawText || "").slice(0, 1600);
    console.error(`[Vertex AI ${modelName} HTTP ${r.status}]:`, errSnippet);
    throw new Error(`[Vertex 翻译失败] 原因: ${modelName} (${location}) HTTP ${r.status}: ${errSnippet}`);
  }

  const text = extractTextFromGenerateContent(r.json);
  if (!text) {
    const hint =
      typeof r.json === "object" && r.json !== null
        ? JSON.stringify(r.json).slice(0, 800)
        : (r.rawText || "").slice(0, 800);
    throw new Error(`[Vertex 翻译失败] 原因: ${modelName} (${location}) 无文本产出: ${hint}`);
  }

  return text
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/```/g, "")
    .trim();
}

/**
 * 平台生圖英文化兜底：**system + user** 分離（與 {@link ./geminiPlatformCompositeTranslation.ts} Flash 契约一致：JSON **`prompt`**）。
 * 依賴 **Vertex IAM**（與 **`op=geminiScript`** 相同閘道），**不經** `GEMINI_API_KEY`。
 */
export async function callGemini31ProSystemUserForImagePrompt(
  systemInstruction: string,
  userText: string,
  opts?: CallGemini31ProOptions,
): Promise<string> {
  const modelName = resolveVertexGemini31ProModelId();
  try {
    return await vertexGemini31ProRestGenerateContent({
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: {
        maxOutputTokens: opts?.maxOutputTokens ?? 65536,
        temperature: opts?.temperature ?? 0.9,
        topP: opts?.topP ?? 0.95,
        thinkingConfig: { includeThoughts: false, thinkingLevel: "HIGH" },
      },
    });
  } catch (error: unknown) {
    const errorDetail = error instanceof Error ? error.message : String(error);
    console.error(`[Vertex AI ${modelName} system/user 調用]:`, errorDetail);
    throw error instanceof Error ? error : new Error(errorDetail);
  }
}

/** Vertex **`gemini-3.1-pro-preview`**（或環境覆寫）純 user 文本；與 **`op=geminiScript`** 同 REST 路徑。 */
export async function callGemini3_1_Pro(prompt: string, opts?: CallGemini31ProOptions): Promise<string> {
  const modelName = resolveVertexGemini31ProModelId();
  try {
    return await vertexGemini31ProRestGenerateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: opts?.maxOutputTokens ?? 65536,
        temperature: opts?.temperature ?? 0.9,
        topP: opts?.topP ?? 0.95,
        thinkingConfig: { includeThoughts: false, thinkingLevel: "HIGH" },
      },
    });
  } catch (error: unknown) {
    const errorDetail = error instanceof Error ? error.message : String(error);
    console.error(`[Vertex AI ${modelName} 崩潰]:`, errorDetail);
    throw error instanceof Error ? error : new Error(errorDetail);
  }
}
