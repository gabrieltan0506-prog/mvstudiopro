/**
 * Kling AI Image Generation
 * 
 * Supports:
 * - Text to Image (kling-image-o1, kling-v2-1)
 * - Image to Image (with reference)
 * - 1K and 2K resolution
 */

import { getKlingClient } from "./client";

// ─── Types ────────────────────────────────────────────

export interface CreateImageRequest {
  model_name?: string;
  prompt: string;
  negative_prompt?: string;
  image?: string; // Reference image URL
  image_reference?: string;
  image_fidelity?: number;
  human_fidelity?: number;
  resolution?: "1k" | "2k";
  n?: number;
  aspect_ratio?: string;
}

export interface ImageTaskResult {
  task_id: string;
  task_status: string;
  task_status_msg?: string;
  created_at: number;
  updated_at: number;
  task_result?: {
    images: Array<{
      index: number;
      url: string;
    }>;
  };
}

// ─── API Functions ────────────────────────────────────

export async function createImageTask(
  request: CreateImageRequest,
  region?: "global" | "cn",
): Promise<ImageTaskResult> {
  const client = getKlingClient();
  const response = await client.request<ImageTaskResult>({
    method: "POST",
    path: "/v1/images/generations",
    body: request as unknown as Record<string, unknown>,
    region,
  });
  return response.data;
}

export async function getImageTask(
  taskId: string,
  region?: "global" | "cn",
): Promise<ImageTaskResult> {
  const client = getKlingClient();
  const response = await client.request<ImageTaskResult>({
    method: "GET",
    path: `/v1/images/generations/${taskId}`,
    region,
  });
  return response.data;
}

// ─── Builder Functions ────────────────────────────────

export interface BuildImageRequestParams {
  prompt: string;
  negativePrompt?: string;
  model?: "kling-image-o1" | "kling-v2-1";
  resolution?: "1k" | "2k";
  aspectRatio?: string;
  referenceImageUrl?: string;
  imageFidelity?: number;
  humanFidelity?: number;
  count?: number;
}

export function buildImageRequest(params: BuildImageRequestParams): CreateImageRequest {
  const request: CreateImageRequest = {
    model_name: params.model ?? "kling-image-o1",
    prompt: params.prompt,
    resolution: params.resolution ?? "1k",
    aspect_ratio: params.aspectRatio ?? "1:1",
    n: params.count ?? 1,
  };

  if (params.negativePrompt) {
    request.negative_prompt = params.negativePrompt;
  }

  if (params.referenceImageUrl) {
    request.image = params.referenceImageUrl;
    request.image_fidelity = params.imageFidelity ?? 0.5;
    request.human_fidelity = params.humanFidelity ?? 0.45;
  }

  return request;
}

// ─── Cost Estimation ──────────────────────────────────

export interface ImageCostEstimate {
  units: number;
  costUsd: number;
  credits: number;
  model: string;
  resolution: string;
}

export function estimateImageCost(params: {
  model?: string;
  resolution?: string;
  count?: number;
}): ImageCostEstimate {
  const model = params.model ?? "kling-image-o1";
  const resolution = params.resolution ?? "1k";
  const count = params.count ?? 1;

  let unitsPerImage: number;
  let costPerImage: number;
  let creditsPerImage: number;

  if (model === "kling-image-o1") {
    unitsPerImage = 8;
    costPerImage = 0.028;
    creditsPerImage = resolution === "2k" ? 10 : 8;
  } else {
    // kling-v2-1
    unitsPerImage = 4;
    costPerImage = 0.014;
    creditsPerImage = resolution === "2k" ? 7 : 5;
  }

  return {
    units: unitsPerImage * count,
    costUsd: costPerImage * count,
    credits: creditsPerImage * count,
    model,
    resolution,
  };
}
