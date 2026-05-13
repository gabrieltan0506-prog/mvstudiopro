/**
 * Gemma Stage1：同模型、雙通道
 * — **首選** Vertex `@google-cloud/vertexai`，機房鎖 **`us-central1`**，同一 **`GEMMA_MODEL_ID`**（相容 **`VERTEX_GEMMA_MODEL`** · 默认 `gemma-4-31b-it`）連試 **2** 次。
 * — **第 3 路** `@google/generative-ai`（**`GEMINI_API_KEY` · AI Studio 全球路由**），**模型 ID 不改**。
 *
 * 生成參數（兩通道一致）：**`maxOutputTokens: 4096`** · **`temperature: 0.8`**。
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { VertexAI } from "@google-cloud/vertexai";

const GEMMA_STAGE1_PRIMARY_LOCATION = "us-central1" as const;
const GEMMA_VERTEX_PRIMARY_ATTEMPTS = 2;

const GEMMA_STAGE1_MAX_OUTPUT_TOKENS = 4096;
const GEMMA_STAGE1_TEMPERATURE = 0.8;

const GEMMA_STAGE1_SINGLE_CALL_TIMEOUT_MS = 120_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}_TIMEOUT_${ms}ms`)), ms),
    ),
  ]);
}

function resolveGemmaModelId(): string {
  const id = String(process.env.GEMMA_MODEL_ID || process.env.VERTEX_GEMMA_MODEL || "gemma-4-31b-it").trim();
  return id || "gemma-4-31b-it";
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

function extractVertexCandidateText(vertexResponse: { candidates?: { content?: { parts?: { text?: string }[] } }[] }): string {
  return String(vertexResponse?.candidates?.[0]?.content?.parts?.[0]?.text || "");
}

/**
 * Stage1 文本：Vertex `us-central1` ×2 → `@google/generative-ai` ×1。**不換模型名**。
 */
export async function callGemma4(prompt: string): Promise<string> {
  const rawCred = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  if (!rawCred) throw new Error("missing_GOOGLE_APPLICATION_CREDENTIALS_JSON");

  const modelName = resolveGemmaModelId();
  const generationConfig = {
    maxOutputTokens: GEMMA_STAGE1_MAX_OUTPUT_TOKENS,
    temperature: GEMMA_STAGE1_TEMPERATURE,
    topP: 0.8,
  };

  const credentials = parseCredentialsFromVercelJsonEnv();
  let lastVertexErr: unknown;

  for (let i = 0; i < GEMMA_VERTEX_PRIMARY_ATTEMPTS; i++) {
    try {
      console.log(
        `[Gemma Stage1] Vertex Primary · ${GEMMA_STAGE1_PRIMARY_LOCATION} · model=${modelName} · attempt ${i + 1}/${GEMMA_VERTEX_PRIMARY_ATTEMPTS}`,
      );
      const vertexAi = new VertexAI({
        project: resolveProjectId(),
        location: GEMMA_STAGE1_PRIMARY_LOCATION,
        googleAuthOptions: { credentials },
      });
      const generativeModel = vertexAi.getGenerativeModel({
        model: modelName,
        generationConfig,
      });
      const request = {
        contents: [{ role: "user" as const, parts: [{ text: prompt }] }],
      };

      const streamingResp = await withTimeout(
        generativeModel.generateContent(request),
        GEMMA_STAGE1_SINGLE_CALL_TIMEOUT_MS,
        "VERTEX_GEMMA",
      );
      const text = extractVertexCandidateText(streamingResp.response).trim();
      if (text) {
        console.log(`[Gemma Stage1] Vertex Primary OK (${GEMMA_STAGE1_PRIMARY_LOCATION})`);
        return text;
      }
      lastVertexErr = new Error("EMPTY_GEMMA_VERTEX_OUTPUT");
    } catch (error: unknown) {
      lastVertexErr = error;
      console.warn(`[Gemma Stage1] Vertex Primary fail (${i + 1}/${GEMMA_VERTEX_PRIMARY_ATTEMPTS}):`, error);
      if (i < GEMMA_VERTEX_PRIMARY_ATTEMPTS - 1) {
        await sleep(5000 * (i + 1));
      }
    }
  }

  console.warn(
    `[Gemma Stage1] Vertex (${GEMMA_STAGE1_PRIMARY_LOCATION}) ${GEMMA_VERTEX_PRIMARY_ATTEMPTS} 次未成功 · 備援 GoogleGenerativeAI（GEMINI_API_KEY）· 模型仍為 ${modelName}`,
  );
  try {
    const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
    if (!apiKey) throw new Error("missing_GEMINI_API_KEY");
    const genAI = new GoogleGenerativeAI(apiKey);
    const studioModel = genAI.getGenerativeModel({
      model: modelName,
      generationConfig,
    });
    const result = await withTimeout(
      studioModel.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
      GEMMA_STAGE1_SINGLE_CALL_TIMEOUT_MS,
      "GEMINI_GENERATIVE_AI_SDK",
    );
    const text = String(result.response.text()).trim();
    if (text) {
      console.log(`[Gemma Stage1] GoogleGenerativeAI fallback OK · model=${modelName}`);
      return text;
    }
    throw new Error("EMPTY_GEMMA_SDK_OUTPUT");
  } catch (error: unknown) {
    const vPart = lastVertexErr instanceof Error ? lastVertexErr.message : String(lastVertexErr);
    const gPart = error instanceof Error ? error.message : String(error);
    console.error("[Gemma Stage1] Vertex + GoogleGenerativeAI 雙通道失敗:", vPart, "|", gPart);
    throw new Error(`[Gemma Stage1 雙通道失敗] Vertex: ${vPart.slice(0, 500)} · GoogleGenerativeAI: ${gPart.slice(0, 500)}`);
  }
}
