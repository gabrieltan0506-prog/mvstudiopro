/**
 * Veo 3.1 Video Generation Service
 * Uses Google GenAI SDK with async polling for video generation
 */
import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function getClient() {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

export interface VeoGenerateOptions {
  /** Text prompt describing the video to generate */
  prompt: string;
  /** Optional reference image URL for image-to-video */
  imageUrl?: string;
  /** Video quality: "fast" uses veo-3.1-fast, "standard" uses veo-3.1-generate */
  quality?: "fast" | "standard";
  /** Desired aspect ratio */
  aspectRatio?: "16:9" | "9:16";
  /** Resolution: "720p" | "1080p" */
  resolution?: "720p" | "1080p";
  /** Negative prompt */
  negativePrompt?: string;
}

export interface VeoResult {
  /** Generated video URL (stored in S3) */
  videoUrl: string;
  /** Mime type */
  mimeType: string;
}

/**
 * Generate a video using Veo 3.1
 * This is a long-running operation that polls until complete
 */
export async function generateVideo(opts: VeoGenerateOptions): Promise<VeoResult> {
  const ai = getClient();
  const modelId = opts.quality === "fast"
    ? "veo-3.1-fast-generate-preview"
    : "veo-3.1-generate-preview";

  // Build image parameter if provided
  let image: { imageBytes: string; mimeType: string } | undefined;
  if (opts.imageUrl) {
    const imgRes = await fetch(opts.imageUrl);
    const imgBuffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(imgBuffer).toString("base64");
    const mimeType = imgRes.headers.get("content-type") || "image/jpeg";
    image = { imageBytes: base64, mimeType };
  }

  // Start video generation (returns a long-running operation)
  let operation = await ai.models.generateVideos({
    model: modelId,
    prompt: opts.prompt,
    ...(image ? { image } : {}),
    config: {
      aspectRatio: opts.aspectRatio || "16:9",
      resolution: opts.resolution || "720p",
      numberOfVideos: 1,
      negativePrompt: opts.negativePrompt,
    },
  });

  // Poll until the operation is done (typically 30-120 seconds)
  const maxWait = 300_000; // 5 minutes max
  const pollInterval = 10_000; // 10 seconds
  const startTime = Date.now();

  while (!operation.done) {
    if (Date.now() - startTime > maxWait) {
      throw new Error("视频生成超时，请稍后重试");
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  // Check for errors
  if (operation.error) {
    console.error("[Veo] Generation error:", operation.error);
    throw new Error("视频生成失败: " + JSON.stringify(operation.error));
  }

  // Extract generated video
  const generatedVideos = operation.response?.generatedVideos;
  if (!generatedVideos || generatedVideos.length === 0) {
    throw new Error("视频生成失败，未返回视频结果");
  }

  const video = generatedVideos[0];
  const videoUri = video.video?.uri;
  if (!videoUri) {
    throw new Error("视频生成成功但无法获取下载链接");
  }

  // Download video bytes and upload to S3
  const { storagePut } = await import("./storage");
  const { nanoid } = await import("nanoid");

  const videoRes = await fetch(videoUri);
  const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
  const fileKey = `veo-videos/${nanoid(12)}.mp4`;

  const { url } = await storagePut(fileKey, videoBuffer, "video/mp4");

  return {
    videoUrl: url,
    mimeType: "video/mp4",
  };
}

/**
 * Check if Veo API is available
 */
export function isVeoAvailable(): boolean {
  return !!GEMINI_API_KEY;
}
