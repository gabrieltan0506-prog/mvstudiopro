/**
 * Kling 2.6 Motion Control API Module
 * 
 * Transfer motion from a reference video to a character image.
 * Supports:
 * - Image orientation (output matches image aspect ratio, max 10s)
 * - Video orientation (output matches video aspect ratio, max 30s)
 * - Standard (720p) and Professional (1080p) modes
 * - Optional text prompt for scene/camera effects
 * - Keep or discard original video sound
 */

import { getKlingClient } from "./client";
import type {
  CreateMotionControlRequest,
  MotionControlTaskResult,
  KlingMode,
  CharacterOrientation,
  TaskListResponse,
} from "./types";

const MC_PATH = "/v1/videos/motion-control";

/**
 * Create a Motion Control task.
 */
export async function createMotionControlTask(
  params: CreateMotionControlRequest,
  region?: "global" | "cn"
) {
  const client = getKlingClient();

  const response = await client.request<{ task_id: string }>({
    method: "POST",
    path: MC_PATH,
    body: params as unknown as Record<string, unknown>,
    region,
  });

  return response.data;
}

/**
 * Query the status of a Motion Control task.
 */
export async function getMotionControlTask(
  taskId: string,
  region?: "global" | "cn"
) {
  const client = getKlingClient();

  const response = await client.request<MotionControlTaskResult>({
    method: "GET",
    path: `${MC_PATH}/${taskId}`,
    region,
  });

  return response.data;
}

/**
 * List Motion Control tasks.
 */
export async function listMotionControlTasks(
  pageNum = 1,
  pageSize = 30,
  region?: "global" | "cn"
) {
  const client = getKlingClient();

  const response = await client.request<TaskListResponse<MotionControlTaskResult>>({
    method: "GET",
    path: `${MC_PATH}?pageNum=${pageNum}&pageSize=${pageSize}`,
    region,
  });

  return response.data;
}

// ─── Convenience Builder ────────────────────────────

/**
 * Build a Motion Control request with sensible defaults.
 */
export function buildMotionControlRequest(params: {
  imageUrl: string;
  videoUrl: string;
  orientation?: CharacterOrientation;
  mode?: KlingMode;
  prompt?: string;
  keepOriginalSound?: boolean;
}): CreateMotionControlRequest {
  return {
    image_url: params.imageUrl,
    video_url: params.videoUrl,
    character_orientation: params.orientation ?? "video",
    mode: params.mode ?? "pro",
    prompt: params.prompt,
    keep_original_sound: params.keepOriginalSound ? "yes" : "no",
  };
}

/**
 * Validate Motion Control inputs before submission.
 */
export function validateMotionControlInputs(params: {
  orientation: CharacterOrientation;
  estimatedDurationSec?: number;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (params.orientation === "image" && params.estimatedDurationSec && params.estimatedDurationSec > 10) {
    errors.push("Image orientation mode supports max 10 seconds. Your reference video will be truncated.");
  }

  if (params.orientation === "video" && params.estimatedDurationSec && params.estimatedDurationSec > 30) {
    errors.push("Video orientation mode supports max 30 seconds. Your reference video will be truncated.");
  }

  if (params.estimatedDurationSec && params.estimatedDurationSec < 3) {
    errors.push("Reference video must be at least 3 seconds long.");
  }

  return { valid: errors.length === 0, errors };
}
