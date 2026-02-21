/**
 * Gemini Image Generation Service (Nano Banana Pro)
 * Uses Google GenAI SDK for high-quality 2K/4K image generation
 * 
 * Uses server-side GEMINI_API_KEY environment variable.
 * Admin users bypass credits; paid users deduct from their balance.
 */
import { GoogleGenAI } from "@google/genai";
import { storagePut } from "./storage";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function getClient() {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured. Please set it in environment variables.");
  }
  return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

export type ImageQuality = "2k" | "4k";

export interface GeminiImageOptions {
  /** Text prompt describing the image to generate */
  prompt: string;
  /** Image quality / resolution */
  quality: ImageQuality;
  /** Optional reference image URL for editing */
  referenceImageUrl?: string;
}

export interface GeminiImageResult {
  /** Generated image URL (stored in S3) */
  imageUrl: string;
  /** Image quality used */
  quality: ImageQuality;
}

/**
 * Generate an image using Gemini (Nano Banana Pro)
 */
export async function generateGeminiImage(opts: GeminiImageOptions): Promise<GeminiImageResult> {
  const ai = getClient();

  // Build contents for Gemini
  const contents: any[] = [];

  // If reference image provided, include it
  if (opts.referenceImageUrl) {
    try {
      const imgRes = await fetch(opts.referenceImageUrl);
      if (!imgRes.ok) {
        console.error(`[GeminiImage] Failed to fetch reference image: ${imgRes.status} ${imgRes.statusText}`);
        throw new Error(`无法获取参考图片 (HTTP ${imgRes.status})`);
      }
      const imgBuffer = await imgRes.arrayBuffer();
      const base64 = Buffer.from(imgBuffer).toString("base64");
      const mimeType = imgRes.headers.get("content-type") || "image/jpeg";
      contents.push({
        role: "user",
        parts: [
          { inlineData: { data: base64, mimeType } },
          { text: opts.prompt },
        ],
      });
    } catch (fetchErr: any) {
      console.error(`[GeminiImage] Reference image fetch error:`, fetchErr);
      // Fall back to text-only generation
      contents.push({
        role: "user",
        parts: [{ text: opts.prompt }],
      });
    }
  } else {
    contents.push({
      role: "user",
      parts: [{ text: opts.prompt }],
    });
  }

  // Try Gemini 3 series models first, then fall back to older versions
  const modelNames = [
    "gemini-3-pro-image-preview",
    "nano-banana-pro-preview",
    "gemini-3-flash-preview",
    "gemini-2.5-flash-preview-image-generation",
  ];

  let response: any = null;
  let lastError: any = null;

  for (const modelName of modelNames) {
    try {
      console.log(`[GeminiImage] Trying model: ${modelName}`);
      response = await ai.models.generateContent({
        model: modelName,
        contents,
        config: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      });
      console.log(`[GeminiImage] Success with model: ${modelName}`);
      break;
    } catch (modelErr: any) {
      console.error(`[GeminiImage] Model ${modelName} failed:`, modelErr.message || modelErr);
      lastError = modelErr;
      continue;
    }
  }

  if (!response) {
    console.error(`[GeminiImage] All models failed. Last error:`, lastError);
    throw new Error(`Gemini 图片生成失败: ${lastError?.message || '所有模型均不可用'}`);
  }

  // Extract generated image from response
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) {
    console.error(`[GeminiImage] No parts in response:`, JSON.stringify(response.candidates?.[0], null, 2));
    throw new Error("图片生成失败，未返回结果");
  }

  const imagePart = parts.find((p: any) => p.inlineData?.data);
  if (!imagePart || !imagePart.inlineData) {
    const textPart = parts.find((p: any) => p.text);
    console.error(`[GeminiImage] No image in response. Text:`, textPart?.text || 'none');
    throw new Error("图片生成失败，未返回图片数据");
  }

  const imageBuffer = Buffer.from(imagePart.inlineData.data!, "base64");
  const mimeType = imagePart.inlineData.mimeType || "image/png";
  const ext = mimeType.includes("jpeg") ? "jpg" : "png";
  const fileKey = `idol-${opts.quality}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { url } = await storagePut(fileKey, imageBuffer, mimeType);
  console.log(`[GeminiImage] Image saved to S3: ${url}`);

  return {
    imageUrl: url,
    quality: opts.quality,
  };
}

/**
 * Check if Gemini Image API is available (server-side key configured)
 */
export function isGeminiImageAvailable(): boolean {
  return !!GEMINI_API_KEY;
}
