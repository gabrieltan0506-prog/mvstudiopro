/**
 * Kling AI API Type Definitions
 * 
 * Covers:
 * - 3.0 Omni Video (kling-v3-omni / kling-video-o1)
 * - 2.6 Motion Control
 * - Lip-Sync (Face Identify + Advanced Lip-Sync)
 * - Element Management
 */

// ─── Common Types ───────────────────────────────────

export type KlingMode = "std" | "pro";
export type KlingAspectRatio = "16:9" | "9:16" | "1:1";
export type KlingDuration = "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "15";
export type KlingModelName = "kling-video-o1" | "kling-v3-omni" | "kling-v2-6";
export type KlingRegion = "global" | "cn";

export interface KlingTaskStatus {
  task_id: string;
  task_status: "submitted" | "processing" | "succeed" | "failed";
  task_status_msg?: string;
  created_at: number;
  updated_at: number;
}

export interface KlingVideoResult {
  id: string;
  url: string;
  duration: string;
}

// ─── 3.0 Omni Video Types ──────────────────────────

export interface OmniVideoImageRef {
  image_url: string;       // URL or Base64
  type?: "first_frame" | "end_frame";
}

export interface OmniVideoElementRef {
  element_id: number;      // Element ID from element library
}

export interface OmniVideoRef {
  video_url: string;
  refer_type: "feature" | "base"; // feature=reference, base=edit
  keep_original_sound?: "yes" | "no";
}

export interface OmniVideoMultiPrompt {
  index: number;
  prompt: string;
  duration: string;        // e.g., "5"
}

export interface CreateOmniVideoRequest {
  model_name?: KlingModelName;  // "kling-video-o1" or "kling-v3-omni"
  prompt: string;
  negative_prompt?: string;
  image_list?: OmniVideoImageRef[];
  element_list?: OmniVideoElementRef[];
  video_list?: OmniVideoRef[];
  mode?: KlingMode;
  aspect_ratio?: KlingAspectRatio;
  duration?: KlingDuration;
  multi_shot?: boolean;
  shot_type?: string;
  multi_prompt?: OmniVideoMultiPrompt[];
  cfg_scale?: number;      // 0-1, default 0.5
  watermark_info?: { watermark: boolean };
  callback_url?: string;
  external_task_id?: string;
}

export interface OmniVideoTaskResult extends KlingTaskStatus {
  task_result?: {
    videos: KlingVideoResult[];
  };
}

// ─── 2.6 Motion Control Types ──────────────────────

export type CharacterOrientation = "image" | "video";

export interface CreateMotionControlRequest {
  image_url: string;              // Reference character image (URL or Base64)
  video_url: string;              // Reference motion video URL
  character_orientation: CharacterOrientation;
  mode: KlingMode;
  prompt?: string;                // Optional text prompt, max 2500 chars
  keep_original_sound?: "yes" | "no";
  watermark_info?: { watermark: boolean };
  callback_url?: string;
  external_task_id?: string;
}

export interface MotionControlTaskResult extends KlingTaskStatus {
  task_result?: {
    videos: KlingVideoResult[];
  };
}

// ─── Lip-Sync Types ────────────────────────────────

export interface IdentifyFaceRequest {
  video_url?: string;
  video_id?: string;
}

export interface FaceData {
  face_id: string;
  face_image: string;      // Face thumbnail URL
  start_time: number;
  end_time: number;
}

export interface IdentifyFaceResult {
  session_id: string;
  face_data: FaceData[];
}

export interface LipSyncFaceConfig {
  face_id: string;
  audio_id?: string;              // TTS-generated audio ID
  sound_file?: string;            // Audio URL or Base64
  sound_start_time?: number;
  sound_end_time?: number;
  sound_insert_time?: number;
  sound_volume?: number;          // 0-2
  original_audio_volume?: number; // 0-2
}

export interface CreateLipSyncRequest {
  session_id: string;
  face_choose: LipSyncFaceConfig[];
  watermark_info?: { watermark: boolean };
  callback_url?: string;
  external_task_id?: string;
}

export interface LipSyncTaskResult extends KlingTaskStatus {
  task_result?: {
    videos: KlingVideoResult[];
  };
}

// ─── Element Management Types ──────────────────────

export type ElementType = "image" | "video";

export interface CreateImageElementRequest {
  image_list: Array<{
    image_url: string;     // URL or Base64
  }>;
  name?: string;
}

export interface CreateVideoElementRequest {
  video_url: string;       // 3-8 second video
  name?: string;
}

export interface ElementResult {
  element_id: number;
  name: string;
  type: ElementType;
  status: "submitted" | "processing" | "succeed" | "failed";
  created_at: number;
}

// ─── Task Query Types ──────────────────────────────

export interface TaskListQuery {
  pageNum?: number;
  pageSize?: number;
}

export interface TaskListResponse<T> {
  total: number;
  list: T[];
}

// ─── Credits Cost Mapping ──────────────────────────

export interface KlingCostEstimate {
  units: number;
  usd: number;
  description: string;
}

/**
 * Estimate the cost of a Kling API call.
 * Based on official pricing as of Feb 2026.
 */
export function estimateOmniVideoCost(params: {
  mode: KlingMode;
  duration: number;
  hasVideoInput: boolean;
  hasAudio: boolean;
}): KlingCostEstimate {
  const { mode, duration, hasVideoInput, hasAudio } = params;
  
  let unitsPerSec: number;
  if (mode === "std") {
    if (!hasVideoInput && !hasAudio) unitsPerSec = 0.6;
    else if (!hasVideoInput && hasAudio) unitsPerSec = 0.8;
    else if (hasVideoInput && !hasAudio) unitsPerSec = 0.9;
    else unitsPerSec = 1.1;
  } else {
    if (!hasVideoInput && !hasAudio) unitsPerSec = 0.8;
    else if (!hasVideoInput && hasAudio) unitsPerSec = 1.0;
    else if (hasVideoInput && !hasAudio) unitsPerSec = 1.2;
    else unitsPerSec = 1.4;
  }

  const units = unitsPerSec * duration;
  const usd = units * 0.14; // $0.14 per unit (Package 1 rate)

  return {
    units,
    usd,
    description: `${mode.toUpperCase()} ${duration}s ${hasVideoInput ? "+video" : ""} ${hasAudio ? "+audio" : ""}: ${units.toFixed(1)} units ($${usd.toFixed(3)})`,
  };
}

export function estimateMotionControlCost(params: {
  mode: KlingMode;
  duration: number;
}): KlingCostEstimate {
  const { mode, duration } = params;
  const unitsPerSec = mode === "std" ? 0.5 : 0.8;
  const units = unitsPerSec * duration;
  const usd = units * 0.14;

  return {
    units,
    usd,
    description: `MC ${mode.toUpperCase()} ${duration}s: ${units.toFixed(1)} units ($${usd.toFixed(3)})`,
  };
}

export function estimateLipSyncCost(params: {
  durationSec: number;
}): KlingCostEstimate {
  const { durationSec } = params;
  const faceRecognitionUnits = 0.05; // $0.007
  const lipSyncPer5s = 0.5;
  const chunks = Math.ceil(durationSec / 5);
  const units = faceRecognitionUnits + lipSyncPer5s * chunks;
  const usd = units * 0.14;

  return {
    units,
    usd,
    description: `Lip-Sync ${durationSec}s: ${units.toFixed(1)} units ($${usd.toFixed(3)})`,
  };
}
