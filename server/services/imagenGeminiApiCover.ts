/**
 * 選題 **單幀豎封**：**Google AI Studio · Imagen 4 Ultra**（`generateImages` · 需 `GEMINI_API_KEY`）。
 * 與 Vertex **Nano Banana 2** 並存，切換見 {@link resolvePlatformTopicCoverPixelEngine}。
 */
import { GoogleGenAI, PersonGeneration } from "@google/genai";

import { persistPlatformGeneratedImagePublicUrl } from "../gemini-image.js";
import { platformFlowLogTimestamp } from "../utils/platformFlowLogTimestamp.js";

export const PLATFORM_IMAGEN_ULTRA_COVER_MODEL_ID = "imagen-4.0-ultra-generate-001" as const;

function appendCoverPixelLog(log: string[] | undefined, message: string): void {
  if (!log || !Array.isArray(log)) return;
  log.push(`${platformFlowLogTimestamp()}  ${message}`);
}

export function isImagenGeminiApiCoverConfigured(): boolean {
  return Boolean(String(process.env.GEMINI_API_KEY ?? "").trim());
}

export async function generatePlatformTopicCoverImagenUltra(options: {
  englishPromptForVertexOrImagen: string;
  flowLog?: string[];
}): Promise<{ imageUrl: string; model: string } | null> {
  const apiKey = String(process.env.GEMINI_API_KEY ?? "").trim();
  if (!apiKey) {
    appendCoverPixelLog(options.flowLog, "[Imagen·封面] 跳过：未配置 GEMINI_API_KEY");
    return null;
  }
  const prompt = String(options.englishPromptForVertexOrImagen ?? "").trim();
  if (!prompt) {
    appendCoverPixelLog(options.flowLog, "[Imagen·封面] 跳过：prompt 为空");
    return null;
  }

  const L = options.flowLog;
  appendCoverPixelLog(
    L,
    `[Imagen·封面] ${PLATFORM_IMAGEN_ULTRA_COVER_MODEL_ID} · Gemini API · generateImages · 9:16 · 2K · PNG · ALLOW_ADULT`,
  );

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateImages({
      model: PLATFORM_IMAGEN_ULTRA_COVER_MODEL_ID,
      prompt,
      config: {
        numberOfImages: 1,
        outputMimeType: "image/png",
        aspectRatio: "9:16",
        imageSize: "2K",
        personGeneration: PersonGeneration.ALLOW_ADULT,
      },
    });

    const bytesB64 = response?.generatedImages?.[0]?.image?.imageBytes;
    if (!bytesB64) {
      appendCoverPixelLog(L, "[Imagen·封面] 模型未返回 imageBytes");
      return null;
    }
    const first = response.generatedImages?.[0]?.image;
    const mime = String(first?.mimeType || "image/png").trim() || "image/png";
    const buffer = Buffer.from(bytesB64, "base64");
    const imageUrl = await persistPlatformGeneratedImagePublicUrl(buffer, mime, L, "imagen_ultra_cover");
    appendCoverPixelLog(
      L,
      `[Imagen·封面] 成功 · model=${PLATFORM_IMAGEN_ULTRA_COVER_MODEL_ID} · url 预览=${imageUrl.slice(0, 96)}…`,
    );
    return { imageUrl, model: PLATFORM_IMAGEN_ULTRA_COVER_MODEL_ID };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    appendCoverPixelLog(L, `[Imagen·封面] 失败: ${msg}`);
    console.warn("[imagenGeminiApiCover] generatePlatformTopicCoverImagenUltra failed:", e);
    return null;
  }
}
