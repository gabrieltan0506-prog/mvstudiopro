/** OpenRouter Alibaba HappyHorse 1.1（首页照片人物动画）。 */

import {
  HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION,
  isHomePhotoAnimateDuration,
  isHomePhotoAnimateResolution,
  type HomePhotoAnimateResolution,
} from "../../shared/homePhotoTools.js";
import {
  isOpenRouterVideoConfigured,
  runOpenRouterVideoJob,
} from "./openrouterVideoCore.js";

export const OPENROUTER_HAPPYHORSE_1_1_MODEL =
  "alibaba/happyhorse-1.1" as const;

const HAPPYHORSE_ASPECT_RATIOS = new Set([
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "21:9",
  "9:21",
]);

function normalizeHappyHorseDuration(raw: unknown): number {
  const duration = raw == null ? 5 : Number(raw);
  if (!isHomePhotoAnimateDuration(duration)) {
    throw new Error("照片动起来只支持 5、10 或 15 秒");
  }
  return duration;
}

function normalizeHappyHorseAspectRatio(raw: unknown): string {
  const aspectRatio = String(raw || "16:9").trim();
  return HAPPYHORSE_ASPECT_RATIOS.has(aspectRatio) ? aspectRatio : "16:9";
}

export function buildOpenRouterHappyHorseSubmitBody(input: {
  prompt: string;
  imageUrl: string;
  aspectRatio?: string;
  duration?: number;
  resolution?: HomePhotoAnimateResolution | string;
}): Record<string, unknown> {
  const imageUrl = String(input.imageUrl || "").trim();
  const resolution = input.resolution ?? HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION;
  if (!isHomePhotoAnimateResolution(resolution)) {
    throw new Error("照片动起来只支持 720p 或 1080p");
  }
  const body: Record<string, unknown> = {
    model: OPENROUTER_HAPPYHORSE_1_1_MODEL,
    prompt: String(input.prompt || "").trim(),
    duration: normalizeHappyHorseDuration(input.duration),
    resolution,
    aspect_ratio: normalizeHappyHorseAspectRatio(input.aspectRatio),
  };
  if (imageUrl) {
    body.frame_images = [
      {
        type: "image_url",
        image_url: { url: imageUrl },
        frame_type: "first_frame",
      },
    ];
  }
  return body;
}

export function isOpenRouterHappyHorseConfigured(): boolean {
  return isOpenRouterVideoConfigured();
}

export async function runOpenRouterHappyHorseVideo(input: {
  prompt: string;
  imageUrl: string;
  aspectRatio?: string;
  duration?: number;
  resolution?: HomePhotoAnimateResolution;
}): Promise<{
  videoUrl: string;
  model: typeof OPENROUTER_HAPPYHORSE_1_1_MODEL;
  provider: "openrouter";
  version: "1.1";
}> {
  const body = buildOpenRouterHappyHorseSubmitBody(input);
  const result = await runOpenRouterVideoJob(body, {
    durableStorage: {
      keyPrefix: "home-photo/animation",
      required: true,
    },
  });
  return {
    videoUrl: result.videoUrl,
    model: OPENROUTER_HAPPYHORSE_1_1_MODEL,
    provider: "openrouter",
    version: "1.1",
  };
}
