/**
 * Kling 3.0 Omni Video API Module
 * 
 * Supports:
 * - Text-to-Video (T2V)
 * - Image-to-Video (I2V) with first/end frame
 * - Element Reference (character/style consistency)
 * - Video Reference (feature extraction / base editing)
 * - Multi-shot Storyboard (up to 6 shots, 15s total)
 * - Audio generation (native audio sync)
 */

import { getKlingClient } from "./client";
import type {
  CreateOmniVideoRequest,
  OmniVideoTaskResult,
  KlingMode,
  KlingAspectRatio,
  KlingDuration,
  TaskListResponse,
} from "./types";

const OMNI_VIDEO_PATH = "/v1/videos/omni-video";

/**
 * Create an Omni Video generation task.
 */
export async function createOmniVideoTask(
  params: CreateOmniVideoRequest,
  region?: "global" | "cn"
) {
  const client = getKlingClient();

  // Default model name
  if (!params.model_name) {
    params.model_name = "kling-v3-omni";
  }

  const response = await client.request<{ task_id: string }>({
    method: "POST",
    path: OMNI_VIDEO_PATH,
    body: params as unknown as Record<string, unknown>,
    region,
  });

  return response.data;
}

/**
 * Query the status of an Omni Video task.
 */
export async function getOmniVideoTask(
  taskId: string,
  region?: "global" | "cn"
) {
  const client = getKlingClient();

  const response = await client.request<OmniVideoTaskResult>({
    method: "GET",
    path: `${OMNI_VIDEO_PATH}/${taskId}`,
    region,
  });

  return response.data;
}

/**
 * List Omni Video tasks.
 */
export async function listOmniVideoTasks(
  pageNum = 1,
  pageSize = 30,
  region?: "global" | "cn"
) {
  const client = getKlingClient();

  const response = await client.request<TaskListResponse<OmniVideoTaskResult>>({
    method: "GET",
    path: `${OMNI_VIDEO_PATH}?pageNum=${pageNum}&pageSize=${pageSize}`,
    region,
  });

  return response.data;
}

// ─── Convenience Builders ───────────────────────────

/**
 * Build a Text-to-Video request.
 */
export function buildT2VRequest(params: {
  prompt: string;
  negativePrompt?: string;
  mode?: KlingMode;
  aspectRatio?: KlingAspectRatio;
  duration?: KlingDuration;
  cfgScale?: number;
}): CreateOmniVideoRequest {
  return {
    model_name: "kling-v3-omni",
    prompt: params.prompt,
    negative_prompt: params.negativePrompt,
    mode: params.mode ?? "std",
    aspect_ratio: params.aspectRatio ?? "16:9",
    duration: params.duration ?? "5",
    cfg_scale: params.cfgScale ?? 0.5,
  };
}

/**
 * Build an Image-to-Video request.
 */
export function buildI2VRequest(params: {
  prompt: string;
  imageUrl: string;
  imageType?: "first_frame" | "end_frame";
  negativePrompt?: string;
  mode?: KlingMode;
  aspectRatio?: KlingAspectRatio;
  duration?: KlingDuration;
  cfgScale?: number;
}): CreateOmniVideoRequest {
  return {
    model_name: "kling-v3-omni",
    prompt: params.prompt,
    image_list: [
      {
        image_url: params.imageUrl,
        type: params.imageType ?? "first_frame",
      },
    ],
    negative_prompt: params.negativePrompt,
    mode: params.mode ?? "std",
    aspect_ratio: params.aspectRatio ?? "16:9",
    duration: params.duration ?? "5",
    cfg_scale: params.cfgScale ?? 0.5,
  };
}

/**
 * Build a Multi-shot Storyboard request.
 * Up to 6 shots, total duration ≤ 15 seconds.
 */
export function buildStoryboardRequest(params: {
  shots: Array<{ prompt: string; duration: string }>;
  mode?: KlingMode;
  aspectRatio?: KlingAspectRatio;
  elementIds?: number[];
  imageUrl?: string;
}): CreateOmniVideoRequest {
  const multiPrompt = params.shots.map((shot, index) => ({
    index: index + 1,
    prompt: shot.prompt,
    duration: shot.duration,
  }));

  // Combine all shot prompts for the main prompt
  const mainPrompt = params.shots.map((s) => s.prompt).join("; ");

  const request: CreateOmniVideoRequest = {
    model_name: "kling-v3-omni",
    prompt: mainPrompt,
    multi_shot: true,
    shot_type: "cut",
    multi_prompt: multiPrompt,
    mode: params.mode ?? "std",
    aspect_ratio: params.aspectRatio ?? "16:9",
  };

  // Add element references for character consistency
  if (params.elementIds?.length) {
    request.element_list = params.elementIds.map((id) => ({ element_id: id }));
    // Update prompt with element placeholders
    request.prompt = params.shots
      .map((s) => `<<<element_1>>> ${s.prompt}`)
      .join("; ");
    request.multi_prompt = params.shots.map((shot, index) => ({
      index: index + 1,
      prompt: `<<<element_1>>> ${shot.prompt}`,
      duration: shot.duration,
    }));
  }

  // Add first frame image
  if (params.imageUrl) {
    request.image_list = [{ image_url: params.imageUrl, type: "first_frame" }];
  }

  return request;
}

/**
 * Build a request with Element + Video reference (All-in-One Reference 3.0).
 */
export function buildAllInOneRequest(params: {
  prompt: string;
  elementIds?: number[];
  imageUrls?: Array<{ url: string; type?: "first_frame" | "end_frame" }>;
  videoUrl?: string;
  videoReferType?: "feature" | "base";
  keepOriginalSound?: boolean;
  mode?: KlingMode;
  aspectRatio?: KlingAspectRatio;
  duration?: KlingDuration;
}): CreateOmniVideoRequest {
  let prompt = params.prompt;

  const request: CreateOmniVideoRequest = {
    model_name: "kling-v3-omni",
    prompt,
    mode: params.mode ?? "pro",
    aspect_ratio: params.aspectRatio ?? "16:9",
    duration: params.duration ?? "5",
  };

  // Element references
  if (params.elementIds?.length) {
    request.element_list = params.elementIds.map((id) => ({ element_id: id }));
    // Inject element placeholders into prompt
    const placeholders = params.elementIds.map((_, i) => `<<<element_${i + 1}>>>`).join(" ");
    request.prompt = `${placeholders} ${prompt}`;
  }

  // Image references
  if (params.imageUrls?.length) {
    request.image_list = params.imageUrls.map((img) => ({
      image_url: img.url,
      type: img.type,
    }));
  }

  // Video reference
  if (params.videoUrl) {
    request.video_list = [
      {
        video_url: params.videoUrl,
        refer_type: params.videoReferType ?? "feature",
        keep_original_sound: params.keepOriginalSound ? "yes" : "no",
      },
    ];
  }

  return request;
}
