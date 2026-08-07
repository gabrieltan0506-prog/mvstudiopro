/**
 * OpenRouter Seedance 2.0 / 2.0-fast（POST /api/v1/videos + poll）。
 * 不走 EvoLink；密钥：OPENROUTER_API_KEY。
 */

import {
  clampSeedanceOpenRouterDuration,
  normalizeSeedanceOpenRouterAspectRatio,
  normalizeSeedanceOpenRouterQuality,
  resolveSeedanceOpenRouterModelId,
  SEEDANCE_REFERENCE_MAX,
  type SeedanceOpenRouterVariant,
} from "../../shared/seedanceOpenRouterModels.js";
import { isOpenRouterVideoConfigured, runOpenRouterVideoJob } from "./openrouterVideoCore.js";

export function isOpenRouterSeedanceConfigured(): boolean {
  return isOpenRouterVideoConfigured();
}

export function buildOpenRouterSeedanceSubmitBody(input: {
  variant: SeedanceOpenRouterVariant;
  prompt: string;
  imageUrl?: string;
  imageUrls?: string[];
  /** 角色声线参考 mp3（最多 3；进 input_references） */
  audioUrls?: string[];
  aspectRatio?: string;
  duration?: number;
  quality?: string;
  generateAudio?: boolean;
}): Record<string, unknown> {
  const model = resolveSeedanceOpenRouterModelId(input.variant);
  const duration = clampSeedanceOpenRouterDuration(input.duration);
  const resolution = normalizeSeedanceOpenRouterQuality(input.variant, input.quality);
  const aspect_ratio = normalizeSeedanceOpenRouterAspectRatio(input.aspectRatio);
  const images = [
    ...(input.imageUrls || []).map((u) => String(u || "").trim()).filter(Boolean),
    ...(String(input.imageUrl || "").trim() ? [String(input.imageUrl).trim()] : []),
  ];
  const uniqueImages = Array.from(new Set(images));
  const audioUrls = Array.from(
    new Set((input.audioUrls || []).map((u) => String(u || "").trim()).filter(Boolean)),
  ).slice(0, SEEDANCE_REFERENCE_MAX.audio);

  const body: Record<string, unknown> = {
    model,
    prompt: String(input.prompt || "").trim(),
    duration,
    resolution,
    aspect_ratio,
    generate_audio: input.generateAudio !== false,
  };

  const inputReferences: Array<Record<string, unknown>> = [];
  if (uniqueImages.length === 1 && !audioUrls.length) {
    // 单图且无声线参考：走首帧 I2V
    body.frame_images = [
      {
        type: "image_url",
        image_url: { url: uniqueImages[0] },
        frame_type: "first_frame",
      },
    ];
  } else if (uniqueImages.length === 1 && audioUrls.length) {
    // 有声线参考时改走 reference（首帧图 + 参考音）
    inputReferences.push({
      type: "image_url",
      image_url: { url: uniqueImages[0] },
    });
  } else if (uniqueImages.length > 1) {
    // 官方多模态参考上限 9 张；早先写死 4 会把本段静帧和场景/道具静默丢掉，
    // 提示词里的 @ImageN 却照旧指向没发出去的图，导致脸/服/场锁不住。
    for (const url of uniqueImages.slice(0, SEEDANCE_REFERENCE_MAX.image)) {
      inputReferences.push({
        type: "image_url",
        image_url: { url },
      });
    }
  }
  for (const url of audioUrls) {
    inputReferences.push({
      type: "audio_url",
      audio_url: { url },
    });
  }
  if (inputReferences.length) {
    body.input_references = inputReferences;
  }

  return body;
}

export type OpenRouterSeedanceRunInput = {
  prompt: string;
  imageUrl?: string;
  imageUrls?: string[];
  audioUrls?: string[];
  aspectRatio?: string;
  duration?: number;
  quality?: string;
  generateAudio?: boolean;
  version?: SeedanceOpenRouterVariant | string;
};

export async function runOpenRouterSeedanceVideo(input: OpenRouterSeedanceRunInput): Promise<{
  videoUrl: string;
  model: string;
  provider: "openrouter";
  version: SeedanceOpenRouterVariant;
}> {
  const variant: SeedanceOpenRouterVariant =
    String(input.version || "2.0").trim().toLowerCase() === "2.0-fast" ||
    String(input.version || "").trim().toLowerCase() === "fast"
      ? "2.0-fast"
      : "2.0";

  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("请填写视频提示词");

  const body = buildOpenRouterSeedanceSubmitBody({
    variant,
    prompt,
    imageUrl: input.imageUrl,
    imageUrls: input.imageUrls,
    audioUrls: input.audioUrls,
    aspectRatio: input.aspectRatio,
    duration: input.duration,
    quality: input.quality,
    generateAudio: input.generateAudio,
  });
  const result = await runOpenRouterVideoJob(body);
  return { videoUrl: result.videoUrl, model: result.model, provider: "openrouter", version: variant };
}
