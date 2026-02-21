/**
 * Kling AI API Integration
 * 
 * Unified module exporting all Kling API capabilities:
 * - Client: JWT auth, multi-key rotation, base HTTP client
 * - Omni Video 3.0: T2V, I2V, storyboard, all-in-one reference
 * - Motion Control 2.6: Image + motion video → animated character
 * - Lip-Sync: Face identification + audio-driven lip replacement
 * - Elements 3.0: Image/video character reference management
 * - Types: Full TypeScript type definitions
 * - Cost Estimation: Pricing calculators
 */

// Client & Configuration
export {
  KlingClient,
  getKlingClient,
  configureKlingClient,
  parseKeysFromEnv,
  type KlingApiKey,
  type KlingConfig,
  type KlingRequestOptions,
  type KlingApiResponse,
} from "./client";

// 3.0 Omni Video
export {
  createOmniVideoTask,
  getOmniVideoTask,
  listOmniVideoTasks,
  buildT2VRequest,
  buildI2VRequest,
  buildStoryboardRequest,
  buildAllInOneRequest,
} from "./omni-video";

// 2.6 Motion Control
export {
  createMotionControlTask,
  getMotionControlTask,
  listMotionControlTasks,
  buildMotionControlRequest,
  validateMotionControlInputs,
} from "./motion-control";

// Lip-Sync
export {
  identifyFaces,
  getFaceIdentifyResult,
  createLipSyncTask,
  getLipSyncTask,
  buildLipSyncWithAudio,
  buildLipSyncWithTTS,
  validateLipSyncInputs,
} from "./lip-sync";

// Elements 3.0
export {
  createImageElement,
  createVideoElement,
  getElement,
  listElements,
  deleteElement,
} from "./elements";

// Types & Cost Estimation
export {
  estimateOmniVideoCost,
  estimateMotionControlCost,
  estimateLipSyncCost,
} from "./types";

export type {
  KlingMode,
  KlingAspectRatio,
  KlingDuration,
  KlingModelName,
  KlingRegion,
  KlingTaskStatus,
  KlingVideoResult,
  CreateOmniVideoRequest,
  OmniVideoTaskResult,
  CreateMotionControlRequest,
  MotionControlTaskResult,
  IdentifyFaceRequest,
  IdentifyFaceResult,
  CreateLipSyncRequest,
  LipSyncTaskResult,
  FaceData,
  CreateImageElementRequest,
  CreateVideoElementRequest,
  ElementResult,
  KlingCostEstimate,
} from "./types";
