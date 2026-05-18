/**
 * 選題 **單幀豎封**：**Google AI Studio · Imagen 4 Ultra**（`generateImages` · 需 `GEMINI_API_KEY`）。
 * **失敗直接拋錯**，不回落其他生圖引擎。
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

/**
 * @throws Error 前綴 `platform_cover_imagen:` — 缺少 key、無圖、API 異常等一律拋出，由上游管線記錄。
 */
export async function generatePlatformTopicCoverImagenUltra(options: {
  englishPromptForVertexOrImagen: string;
  flowLog?: string[];
}): Promise<{ imageUrl: string; model: string }> {
  const apiKey = String(process.env.GEMINI_API_KEY ?? "").trim();
  if (!apiKey) {
    appendCoverPixelLog(options.flowLog, "[Imagen·封面] 缺失 GEMINI_API_KEY（将抛错）");
    throw new Error("platform_cover_imagen: missing GEMINI_API_KEY");
  }
  const prompt = String(options.englishPromptForVertexOrImagen ?? "").trim();
  if (!prompt) {
    appendCoverPixelLog(options.flowLog, "[Imagen·封面] prompt 为空（将抛错）");
    throw new Error("platform_cover_imagen: empty prompt");
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
      appendCoverPixelLog(L, "[Imagen·封面] 模型未返回 imageBytes（将抛错）");
      throw new Error("platform_cover_imagen: model returned no imageBytes");
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
    if (e instanceof Error && e.message.startsWith("platform_cover_imagen:")) {
      throw e;
    }
    const msg = e instanceof Error ? e.message : String(e);
    appendCoverPixelLog(L, `[Imagen·封面] API 异常: ${msg}`);
    console.warn("[imagenGeminiApiCover] generatePlatformTopicCoverImagenUltra failed:", e);
    throw new Error(`platform_cover_imagen: ${msg}`, { cause: e });
  }
}
