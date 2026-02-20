/**
 * Gemini Image Generation Service (Nano Banana Pro)
 * Uses Google GenAI SDK for high-quality 2K/4K image generation
 * 
 * Pricing:
 * - 2K (2048×2048): ~$0.134/image
 * - 4K (4096×4096): ~$0.24/image
 */
import { GoogleGenAI } from "@google/genai";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function getClient() {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
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

  // Use gemini-2.0-flash-preview-image-generation for image generation
  const contents: any[] = [];

  // If reference image provided, include it
  if (opts.referenceImageUrl) {
    const imgRes = await fetch(opts.referenceImageUrl);
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
  } else {
    contents.push({
      role: "user",
      parts: [{ text: opts.prompt }],
    });
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash-preview-image-generation",
    contents,
    config: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  });

  // Extract generated image from response
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) {
    throw new Error("图片生成失败，未返回结果");
  }

  const imagePart = parts.find((p: any) => p.inlineData?.data);
  if (!imagePart || !imagePart.inlineData) {
    throw new Error("图片生成失败，未返回图片数据");
  }

  const imageBuffer = Buffer.from(imagePart.inlineData.data!, "base64");
  const mimeType = imagePart.inlineData.mimeType || "image/png";
  const ext = mimeType.includes("jpeg") ? "jpg" : "png";
  const fileKey = `idol-${opts.quality}/${nanoid(12)}.${ext}`;

  const { url } = await storagePut(fileKey, imageBuffer, mimeType);

  return {
    imageUrl: url,
    quality: opts.quality,
  };
}

/**
 * Check if Gemini Image API is available
 */
export function isGeminiImageAvailable(): boolean {
  return !!GEMINI_API_KEY;
}
