/**
 * 戰略/場景圖：Fly 端直連 Vertex **`generateContent` 圖像**（Nano Banana Pro / Nano Banana 2），取圖後上傳 GCS 並回簽名 URL（**不走** `/api/google` 閘道）。
 *
 * **生圖**：皆為 Gemini 圖像模型（**非** Imagen `:predict`）。
 * **放大**：見 `vertexImage.ts`（`imagen-4.0-upscale-preview` 等，與本檔無關）。
 */
import { getVertexAccessToken } from "../utils/vertex";
import { uploadBufferToGcs, signGsUriV4ReadUrl } from "./gcs";
import { TRIAL_READ_WATERMARK_IMAGE_PROMPT_INSTRUCTION } from "../../shared/const.js";

function s(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

function jparse(t: string) {
  try {
    return JSON.parse(t) as any;
  } catch {
    return null;
  }
}

function baseUrlFor(location: string) {
  return location === "global" ? "https://aiplatform.googleapis.com" : `https://${location}-aiplatform.googleapis.com`;
}

/** 與 `api/google.ts` extractGeneratedImages 對齊：從 Vertex `generateContent` JSON 取圖。 */
function extractGeneratedImagesFromVertexResponse(raw: any): Array<{ data: string; mimeType: string }> {
  const images: Array<{ data: string; mimeType: string }> = [];
  const parts = Array.isArray(raw?.candidates?.[0]?.content?.parts) ? raw.candidates[0].content.parts : [];
  for (const part of parts) {
    const data = s(part?.inlineData?.data).trim();
    if (data) {
      images.push({ data, mimeType: s(part?.inlineData?.mimeType || "image/png").trim() || "image/png" });
    }
  }
  const generatedImages = Array.isArray(raw?.generatedImages) ? raw.generatedImages : [];
  for (const item of generatedImages) {
    const data = s(item?.image?.bytesBase64Encoded || item?.bytesBase64Encoded || item?.imageBytes).trim();
    if (data) {
      images.push({ data, mimeType: s(item?.image?.mimeType || item?.mimeType || "image/png").trim() || "image/png" });
    }
  }
  return images;
}

/**
 * 戰略封面用 prompt 的單次生成（**僅測 Vertex** Nano Banana 2 · 2K，不寫庫）。
 */
export async function generateStrategicCoverVertex(prompt: string, _creationId?: number): Promise<string | null> {
  try {
    const { generateGeminiImage } = await import("../gemini-image.js");
    const r = await generateGeminiImage({
      prompt: String(prompt || "").trim(),
      quality: "2k",
      aspectRatio: "9:16",
      personGeneration: "ALLOW_ADULT",
    });
    return r.imageUrl ? String(r.imageUrl).trim() : null;
  } catch {
    return null;
  }
}

/**
 * Fly / Node 端直連 Vertex，取圖後立刻上傳 GCS 並回簽名讀鏈（**不走 Vercel `/api/google` 閘道**）。
 *
 * - **COVER**：Gemini Nano Banana Pro · `generateContent` · 9:16（與 `api/google.ts` Pro 路線一致）
 * - **SCENE**：Nano Banana 2（Flash）· `generateContent` · 16:9 · 2K
 */
export async function generateAndStoreStrategicImage(
  prompt: string,
  mode: "COVER" | "SCENE" = "SCENE",
  opts?: { coverTrialWatermark?: boolean },
): Promise<string> {
  const pPrompt = String(prompt || "").trim();
  if (!pPrompt) throw new Error("empty_strategic_image_prompt");

  const IS_COVER = mode === "COVER";
  const qualitySuffix = IS_COVER
    ? ", 4k resolution, hyper-realistic, masterpiece, highly detailed, dark gold aesthetics"
    : ", 2k resolution, hyper-realistic, masterpiece, cinematic lighting";
  const trialTail =
    IS_COVER && opts?.coverTrialWatermark
      ? ` ${TRIAL_READ_WATERMARK_IMAGE_PROMPT_INSTRUCTION}`
      : "";
  const finalPrompt = `${pPrompt}${qualitySuffix}${trialTail}`;

  console.log(`[Fly Image Engine] 啟動生圖 -> 模式: ${mode}`);

  let buffer: Buffer;
  let contentType: string;

  if (IS_COVER) {
    const projectId = s(process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT).trim();
    if (!projectId) throw new Error("missing_VERTEX_PROJECT_ID_or_GOOGLE_CLOUD_PROJECT");

    const model = s(
      process.env.VERTEX_DEEP_RESEARCH_COVER_MODEL ||
        process.env.VERTEX_IMAGE_MODEL_PRO ||
        "gemini-3-pro-image-preview",
    ).trim();
    const location = (s(process.env.VERTEX_IMAGE_LOCATION_PRO || process.env.VERTEX_IMAGE_LOCATION) || "global").trim();
    const token = await getVertexAccessToken();
    const base = baseUrlFor(location);
    const url = `${base}/v1beta1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

    const imageConfig: Record<string, unknown> = {
      aspectRatio: "9:16",
      personGeneration: "ALLOW_ADULT",
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
        generationConfig: { responseModalities: ["IMAGE"], imageConfig },
      }),
      signal: AbortSignal.timeout(120_000),
    });

    const text = await r.text();
    const json = jparse(text);
    if (!r.ok) {
      throw new Error(`${model} generateContent:${r.status}:${text.slice(0, 800)}`);
    }
    const images = extractGeneratedImagesFromVertexResponse(json);
    const first = images[0];
    if (!first?.data) throw new Error("strategic_cover_no_image_bytes");
    buffer = Buffer.from(first.data, "base64");
    contentType = first.mimeType || "image/png";
  } else {
    const { generateGeminiImage } = await import("../gemini-image.js");
    const vertexResult = await generateGeminiImage({
      prompt: finalPrompt,
      quality: "2k",
      aspectRatio: "16:9",
      personGeneration: "ALLOW_ADULT",
    });
    const imgUrl = String(vertexResult?.imageUrl || "").trim();
    if (!imgUrl) throw new Error("strategic_scene_no_image_url");
    const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(120_000) });
    if (!imgRes.ok) throw new Error(`strategic_scene_fetch_failed:${imgRes.status}`);
    buffer = Buffer.from(await imgRes.arrayBuffer());
    contentType = imgRes.headers.get("content-type") || "image/png";
  }

  const ext = /jpeg|jpg/i.test(contentType) ? "jpg" : "png";
  const gcsPath = `growth-camp/images/strategic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { gcsUri } = await uploadBufferToGcs({
    objectName: gcsPath,
    buffer,
    contentType: contentType.includes("jpeg") || ext === "jpg" ? "image/jpeg" : "image/png",
  });

  console.log(`[Fly Image Engine] 獲取圖像成功，上傳 GCS: ${gcsUri}`);
  return signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
}
