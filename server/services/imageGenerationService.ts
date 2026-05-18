/**
 * 戰略/場景圖：Fly 端直連 Vertex **`generateContent` 圖像**（Nano Banana Pro / Nano Banana 2），取圖後上傳 GCS 並回簽名 URL（**不走** `/api/google` 閘道）。
 *
 * **生圖**：皆為 Gemini 圖像模型（**非** Imagen `:predict`）。
 * **放大**：見 `vertexImage.ts`（`imagen-4.0-upscale-preview` 等，與本檔無關）。
 */
import {
  buildGptImage2AlignedPlatformTopicCoverPrompt,
  PLATFORM_SHARED_IMAGE_PHOTOGRAPHY_MODIFIERS,
} from "./platformTopicCoverPrompt.js";
import { getVertexAccessToken } from "../utils/vertex";
import { resolvePlatformImageStorageDriver } from "../config/platformSwitches.js";
import { uploadBufferToGcs, signGsUriV4ReadUrl } from "./gcs";
import { writeFlyPlatformImageBuffer, buildFlyPlatformImagePublicUrl } from "./flyVolumeGeneratedImages.js";
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

/**
 * 在模型或業務層給出的**主體描述**後，疊加 Pro 級鏡頭／光影／材質語彙（{@link PLATFORM_SHARED_IMAGE_PHOTOGRAPHY_MODIFIERS}，與 gpt-image-2 / Nano Banana 2 / Pro 共用）。
 */
export function appendVertexProPhotographyPromptModifiers(
  basePrompt: string,
  intent:
    | "strategic_cover"
    | "platform_vertical_cover"
    | "platform_landscape_sheet"
    | "platform_vertical_cover_after_gpt2_aspect_lock",
): string {
  const base = String(basePrompt || "").trim();
  if (!base) return "";
  const modifiers = PLATFORM_SHARED_IMAGE_PHOTOGRAPHY_MODIFIERS;
  if (intent === "strategic_cover") {
    return `${base}. ${modifiers}, dark gold aesthetics, masterpiece, highly detailed, vertical 9:16 aspect.`;
  }
  if (intent === "platform_landscape_sheet") {
    return `${base}. ${modifiers}, wide 16:9 landscape master canvas, multi-panel graphic layout, high legibility, cohesive cinematic grade across the frame.`;
  }
  if (intent === "platform_vertical_cover_after_gpt2_aspect_lock") {
    // 比例約束已與 GPT-IMAGE-2 主路徑一致拼在 base；此處只叠鏡頭/光影，避免重複大段「vertical 9:16」敘述
    return `${base}. ${modifiers}, masterpiece, highly detailed.`;
  }
  return `${base}. ${modifiers}, vertical 9:16 social feed cover, generous safe margin for bold on-image headline, high legibility, uncluttered composition.`;
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
    ? ""
    : ", 2k resolution, hyper-realistic, masterpiece, cinematic lighting";
  const trialTail =
    IS_COVER && opts?.coverTrialWatermark
      ? ` ${TRIAL_READ_WATERMARK_IMAGE_PROMPT_INSTRUCTION}`
      : "";
  const finalPrompt = IS_COVER
    ? `${appendVertexProPhotographyPromptModifiers(pPrompt, "strategic_cover")}${trialTail}`
    : `${pPrompt}${qualitySuffix}${trialTail}`;

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
  const normalizedCt: "image/jpeg" | "image/png" | "image/webp" = contentType.toLowerCase().includes("webp")
    ? "image/webp"
    : contentType.includes("jpeg") || ext === "jpg"
      ? "image/jpeg"
      : "image/png";

  if (resolvePlatformImageStorageDriver() === "fly") {
    const { relPath } = await writeFlyPlatformImageBuffer({
      subdir: "strategic",
      buffer,
      contentType: normalizedCt,
    });
    const url = buildFlyPlatformImagePublicUrl(relPath);
    console.log(`[Fly Image Engine] 獲取圖像成功，落盤 Fly 卷: ${relPath}`);
    return url;
  }

  const gcsPath = `growth-camp/images/strategic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { gcsUri } = await uploadBufferToGcs({
    objectName: gcsPath,
    buffer,
    contentType: normalizedCt,
  });

  console.log(`[Fly Image Engine] 獲取圖像成功，上傳 GCS: ${gcsUri}`);
  return signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
}

/**
 * 平台選題單幀豎封：**Vertex Nano Banana Pro**（`gemini-3-pro-image-preview`，可 `VERTEX_PLATFORM_TOPIC_PRO_IMAGE_MODEL` 覆寫）· 9:16。
 * 預設像素引擎見 {@link resolvePlatformTopicCoverPixelEngine} · `nbp_only`；Imagen 4 已不再用於本管線。
 */
export async function generatePlatformTopicCoverNanoBananaProImage(options: {
  englishPrompt: string;
  flowLog?: string[];
}): Promise<string> {
  const baseEn = String(options.englishPrompt || "").trim();
  if (!baseEn) throw new Error("empty_platform_topic_pro_image_prompt");

  const projectId = s(process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT).trim();
  if (!projectId) throw new Error("missing_VERTEX_PROJECT_ID_or_GOOGLE_CLOUD_PROJECT");

  const model = s(process.env.VERTEX_PLATFORM_TOPIC_PRO_IMAGE_MODEL || "gemini-3-pro-image-preview").trim();
  const location = "global";
  const gpt2Aligned = buildGptImage2AlignedPlatformTopicCoverPrompt(baseEn);
  const primaryPrompt = appendVertexProPhotographyPromptModifiers(
    gpt2Aligned,
    "platform_vertical_cover_after_gpt2_aspect_lock",
  );

  const push = (line: string) => {
    options.flowLog?.push(line);
  };

  const runOnce = async (finalPrompt: string, logLabel: string): Promise<string> => {
    push(`${new Date().toISOString()}  [NB-Pro·封面] ${logLabel} · model=${model} · location=${location} · prompt≈${finalPrompt.length} chars`);
    const token = await getVertexAccessToken();
    const url = `${baseUrlFor(location)}/v1beta1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;

    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "9:16", personGeneration: "ALLOW_ADULT" },
        },
      }),
      signal: AbortSignal.timeout(180_000),
    });

    const text = await r.text();
    const json = jparse(text);
    if (!r.ok) {
      throw new Error(`${model} generateContent:${r.status}:${text.slice(0, 800)}`);
    }
    const images = extractGeneratedImagesFromVertexResponse(json);
    const first = images[0];
    if (!first?.data) throw new Error("platform_topic_pro_no_image_bytes");
    const buffer = Buffer.from(first.data, "base64");
    let contentType = first.mimeType || "image/png";
    const ext = /jpeg|jpg/i.test(contentType) ? "jpg" : "png";
    const normalizedCt: "image/jpeg" | "image/png" | "image/webp" = contentType.toLowerCase().includes("webp")
      ? "image/webp"
      : contentType.includes("jpeg") || ext === "jpg"
        ? "image/jpeg"
        : "image/png";

    if (resolvePlatformImageStorageDriver() === "fly") {
      const { relPath } = await writeFlyPlatformImageBuffer({
        subdir: "platform_topic_nano_banana_pro",
        buffer,
        contentType: normalizedCt,
      });
      const outUrl = buildFlyPlatformImagePublicUrl(relPath);
      push(`${new Date().toISOString()}  [NB-Pro·封面] 已落盘 Fly · ${relPath}`);
      return outUrl;
    }

    const gcsPath = `generated/platform_topic_nano_banana_pro/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { gcsUri } = await uploadBufferToGcs({
      objectName: gcsPath,
      buffer,
      contentType: normalizedCt,
    });
    const signed = signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
    push(`${new Date().toISOString()}  [NB-Pro·封面] 已上传 GCS`);
    return signed;
  };

  try {
    return await runOnce(primaryPrompt, "Vertex generateContent（GPT-IMAGE-2 同款比例锁 + Pro 光影）");
  } catch (firstErr: unknown) {
    const strengthened = appendVertexProPhotographyPromptModifiers(gpt2Aligned, "platform_vertical_cover");
    push(
      `${new Date().toISOString()}  [NB-Pro·封面] 首輪失敗，加強 9:16 版式語彙後重试 · ${firstErr instanceof Error ? firstErr.message.slice(0, 280) : String(firstErr).slice(0, 280)}`,
    );
    return await runOnce(strengthened, "重试 · 加强 vertical 版式");
  }
}
