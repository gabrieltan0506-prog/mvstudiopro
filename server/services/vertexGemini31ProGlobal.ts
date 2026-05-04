/**
 * 翻譯中樞：Vertex AI **global** 節點 + **gemini-3.1-pro-preview**（不依賴 Google AI Studio / Consumer API Key）。
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

let vertexSingleton: VertexAI | null = null;

function getVertexGlobal(): VertexAI {
  if (!vertexSingleton) {
    vertexSingleton = new VertexAI({
      project: resolveProjectId(),
      location: "global",
    });
  }
  return vertexSingleton;
}

export type CallGemini31ProOptions = {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
};

/** Vertex AI Global 驅動（gemini-3.1-pro-preview），不依賴 GEMINI_API_KEY */
export async function callGemini3_1_Pro(prompt: string, opts?: CallGemini31ProOptions): Promise<string> {
  const vertex_ai = getVertexGlobal();
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
    console.error("[Vertex AI Global 3.1 Pro 崩溃]:", errorDetail);
    throw new Error(`[Vertex Global 翻译失败] 原因: ${errorDetail}`);
  }
}
