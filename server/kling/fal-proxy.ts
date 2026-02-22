/**
 * fal.ai Proxy for Kling Video API
 * 
 * Routes all Kling video API calls through fal.ai to bypass
 * CN-region connectivity issues from overseas deployment.
 * 
 * Supported endpoints:
 * - Omni Video 3.0 (T2V, I2V, O3, Pro, Standard)
 * - Motion Control 2.6
 * - Lip Sync
 * - Elements 3.0
 */

import { fal } from "@fal-ai/client";

// ─── Initialize fal.ai client ──────────────────────
function initFal() {
  const key = process.env.FAL_API_KEY;
  if (!key) throw new Error("FAL_API_KEY not set");
  fal.config({ credentials: key });
}

// ─── Endpoint Mapping ──────────────────────────────
export const FAL_KLING_ENDPOINTS = {
  // Omni Video 3.0
  "v3-standard-t2v": "fal-ai/kling-video/v3/standard/text-to-video",
  "v3-standard-i2v": "fal-ai/kling-video/v3/standard/image-to-video",
  "v3-pro-t2v": "fal-ai/kling-video/v3/pro/text-to-video",
  "v3-pro-i2v": "fal-ai/kling-video/v3/pro/image-to-video",
  "o3-t2v": "fal-ai/kling-video/o3/text-to-video",
  "o3-i2v": "fal-ai/kling-video/o3/image-to-video",
  // Motion Control 2.6
  "motion-control": "fal-ai/kling-video/v2.6/motion-control",
  // Lip Sync
  "lip-sync": "fal-ai/kling-video/lip-sync",
  // Elements
  "elements": "fal-ai/kling-video/elements",
} as const;

export type FalKlingEndpoint = keyof typeof FAL_KLING_ENDPOINTS;

// ─── Generic Submit + Poll ─────────────────────────
export interface FalKlingResult {
  request_id: string;
  video?: { url: string; content_type?: string; file_name?: string; file_size?: number };
  images?: Array<{ url: string; content_type?: string }>;
  element_id?: number;
  // Lip sync specific
  session_id?: string;
  face_list?: Array<{ face_id: string; face_image_url: string }>;
}

/**
 * Submit a task to fal.ai Kling endpoint and wait for result.
 * Uses fal.subscribe which handles polling automatically.
 */
export async function falKlingSubmit(
  endpoint: FalKlingEndpoint,
  input: Record<string, unknown>,
  onProgress?: (status: string) => void
): Promise<FalKlingResult> {
  initFal();
  const falEndpoint = FAL_KLING_ENDPOINTS[endpoint];
  
  console.log(`[fal-kling] Submitting to ${falEndpoint}`, JSON.stringify(input).substring(0, 200));

  try {
    const result = await fal.subscribe(falEndpoint, {
      input,
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS") {
          onProgress?.("generating");
        }
      },
    });

    console.log(`[fal-kling] Result from ${falEndpoint}:`, JSON.stringify(result.data).substring(0, 300));
    return result.data as FalKlingResult;
  } catch (err: any) {
    console.error(`[fal-kling] Error from ${falEndpoint}:`, err.message);
    throw new Error(`Kling via fal.ai error: ${err.message}`);
  }
}

/**
 * Submit a task without waiting (queue only).
 * Returns request_id for later polling.
 */
export async function falKlingQueue(
  endpoint: FalKlingEndpoint,
  input: Record<string, unknown>
): Promise<{ request_id: string; status_url: string }> {
  initFal();
  const falEndpoint = FAL_KLING_ENDPOINTS[endpoint];

  console.log(`[fal-kling] Queuing to ${falEndpoint}`);

  const result = await fal.queue.submit(falEndpoint, { input });
  return {
    request_id: result.request_id,
    status_url: result.status_url,
  };
}

/**
 * Check status of a queued task.
 */
export async function falKlingStatus(
  endpoint: FalKlingEndpoint,
  requestId: string
): Promise<{ status: string; result?: FalKlingResult }> {
  initFal();
  const falEndpoint = FAL_KLING_ENDPOINTS[endpoint];

  const statusResp = await fal.queue.status(falEndpoint, {
    requestId,
    logs: false,
  }) as any;

  const st = statusResp?.status as string;
  if (st === "COMPLETED") {
    const result = await fal.queue.result(falEndpoint, { requestId });
    return { status: "completed", result: result.data as FalKlingResult };
  }

  return { status: st === "IN_QUEUE" ? "queued" : st === "IN_PROGRESS" ? "processing" : (st || "unknown").toLowerCase() };
}

/**
 * Get result of a completed task.
 */
export async function falKlingResult(
  endpoint: FalKlingEndpoint,
  requestId: string
): Promise<FalKlingResult> {
  initFal();
  const falEndpoint = FAL_KLING_ENDPOINTS[endpoint];
  const result = await fal.queue.result(falEndpoint, { requestId });
  return result.data as FalKlingResult;
}

// ─── Convenience: Omni Video ───────────────────────

/**
 * Determine the correct fal.ai endpoint based on model/mode.
 */
export function getOmniVideoEndpoint(
  modelName: string,
  mode: string,
  hasImage: boolean
): FalKlingEndpoint {
  const type = hasImage ? "i2v" : "t2v";
  
  if (modelName === "kling-v3-omni" || modelName === "kling-video-o1") {
    // O3 model
    return `o3-${type}` as FalKlingEndpoint;
  }
  
  if (mode === "pro") {
    return `v3-pro-${type}` as FalKlingEndpoint;
  }
  
  return `v3-standard-${type}` as FalKlingEndpoint;
}

/**
 * Convert our internal Omni Video request format to fal.ai format.
 */
export function convertOmniVideoToFal(params: {
  prompt: string;
  negative_prompt?: string;
  mode?: string;
  aspect_ratio?: string;
  duration?: string;
  cfg_scale?: number;
  image_list?: Array<{ image_url: string; type?: string }>;
  model_name?: string;
}): Record<string, unknown> {
  const input: Record<string, unknown> = {
    prompt: params.prompt,
  };

  if (params.negative_prompt) input.negative_prompt = params.negative_prompt;
  if (params.aspect_ratio) input.aspect_ratio = params.aspect_ratio;
  if (params.duration) input.duration = parseInt(params.duration) || 5;
  if (params.cfg_scale !== undefined) input.cfg_scale = params.cfg_scale;

  // Image for I2V
  if (params.image_list?.length) {
    input.image_url = params.image_list[0].image_url;
  }

  return input;
}

// ─── Convenience: Motion Control ───────────────────

export function convertMotionControlToFal(params: {
  image_url: string;
  video_url: string;
  mode?: string;
  prompt?: string;
  keep_original_sound?: string;
  character_orientation?: string;
}): Record<string, unknown> {
  return {
    image_url: params.image_url,
    video_url: params.video_url,
    mode: params.mode ?? "pro",
    prompt: params.prompt,
    keep_original_sound: params.keep_original_sound === "yes",
  };
}

// ─── Convenience: Lip Sync ─────────────────────────

export function convertLipSyncToFal(params: {
  video_url: string;
  audio_url: string;
  mode?: string;
}): Record<string, unknown> {
  return {
    video_url: params.video_url,
    audio_url: params.audio_url,
  };
}

// ─── Convenience: Elements ─────────────────────────

export function convertElementToFal(params: {
  image_url?: string;
  video_url?: string;
  face_image_url?: string;
}): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (params.image_url) input.image_url = params.image_url;
  if (params.video_url) input.video_url = params.video_url;
  if (params.face_image_url) input.face_image_url = params.face_image_url;
  return input;
}
