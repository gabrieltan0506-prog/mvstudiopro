/**
 * Kling Lip-Sync API Module
 * 
 * Two-step process:
 * 1. Identify faces in a video → get session_id + face_data
 * 2. Create lip-sync task → replace lip movements with audio
 * 
 * Supports:
 * - Single person lip-sync
 * - Custom audio (mp3/wav/m4a, ≤5MB, 2-60s)
 * - TTS-generated audio (via audio_id)
 * - Volume control (0-2) for both new audio and original
 * - Insert time control
 */

import { getKlingClient } from "./client";
import type {
  IdentifyFaceRequest,
  IdentifyFaceResult,
  CreateLipSyncRequest,
  LipSyncFaceConfig,
  LipSyncTaskResult,
  FaceData,
} from "./types";

const FACE_IDENTIFY_PATH = "/v1/videos/identify-face";
const LIP_SYNC_PATH = "/v1/videos/advanced-lip-sync";

// ─── Step 1: Face Identification ────────────────────

/**
 * Identify faces in a video.
 * Returns session_id and face data (face_id, thumbnail, time range).
 */
export async function identifyFaces(
  params: IdentifyFaceRequest,
  region?: "global" | "cn"
) {
  const client = getKlingClient();

  const response = await client.request<IdentifyFaceResult>({
    method: "POST",
    path: FACE_IDENTIFY_PATH,
    body: params as unknown as Record<string, unknown>,
    region,
    purpose: "video",
  });

  return response.data;
}

/**
 * Query face identification result.
 */
export async function getFaceIdentifyResult(
  taskId: string,
  region?: "global" | "cn"
) {
  const client = getKlingClient();

  const response = await client.request<IdentifyFaceResult & { task_status: string }>({
    method: "GET",
    path: `${FACE_IDENTIFY_PATH}/${taskId}`,
    region,
    purpose: "video",
  });

  return response.data;
}

// ─── Step 2: Lip-Sync Generation ────────────────────

/**
 * Create a lip-sync task.
 * Requires session_id from face identification step.
 */
export async function createLipSyncTask(
  params: CreateLipSyncRequest,
  region?: "global" | "cn"
) {
  const client = getKlingClient();

  const response = await client.request<{ task_id: string }>({
    method: "POST",
    path: LIP_SYNC_PATH,
    body: params as unknown as Record<string, unknown>,
    region,
    purpose: "video",
  });

  return response.data;
}

/**
 * Query the status of a lip-sync task.
 */
export async function getLipSyncTask(
  taskId: string,
  region?: "global" | "cn"
) {
  const client = getKlingClient();

  const response = await client.request<LipSyncTaskResult>({
    method: "GET",
    path: `${LIP_SYNC_PATH}/${taskId}`,
    region,
    purpose: "video",
  });

  return response.data;
}

// ─── Convenience Builders ───────────────────────────

/**
 * Build a lip-sync request with custom audio file.
 */
export function buildLipSyncWithAudio(params: {
  sessionId: string;
  faceId: string;
  audioUrl: string;
  audioStartTime?: number;
  audioEndTime?: number;
  insertTime?: number;
  soundVolume?: number;
  originalAudioVolume?: number;
}): CreateLipSyncRequest {
  const faceConfig: LipSyncFaceConfig = {
    face_id: params.faceId,
    sound_file: params.audioUrl,
    sound_start_time: params.audioStartTime,
    sound_end_time: params.audioEndTime,
    sound_insert_time: params.insertTime ?? 0,
    sound_volume: params.soundVolume ?? 1,
    original_audio_volume: params.originalAudioVolume ?? 0,
  };

  return {
    session_id: params.sessionId,
    face_choose: [faceConfig],
  };
}

/**
 * Build a lip-sync request with TTS audio.
 */
export function buildLipSyncWithTTS(params: {
  sessionId: string;
  faceId: string;
  audioId: string;
  insertTime?: number;
  soundVolume?: number;
  originalAudioVolume?: number;
}): CreateLipSyncRequest {
  const faceConfig: LipSyncFaceConfig = {
    face_id: params.faceId,
    audio_id: params.audioId,
    sound_insert_time: params.insertTime ?? 0,
    sound_volume: params.soundVolume ?? 1,
    original_audio_volume: params.originalAudioVolume ?? 0,
  };

  return {
    session_id: params.sessionId,
    face_choose: [faceConfig],
  };
}

/**
 * Validate lip-sync inputs.
 */
export function validateLipSyncInputs(params: {
  videoDurationSec?: number;
  audioDurationSec?: number;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (params.videoDurationSec !== undefined) {
    if (params.videoDurationSec < 2) errors.push("Video must be at least 2 seconds.");
    if (params.videoDurationSec > 60) errors.push("Video must be 60 seconds or less.");
  }

  if (params.audioDurationSec !== undefined) {
    if (params.audioDurationSec < 2) errors.push("Audio must be at least 2 seconds.");
    if (params.audioDurationSec > 60) errors.push("Audio must be 60 seconds or less.");
  }

  return { valid: errors.length === 0, errors };
}
