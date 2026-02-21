/**
 * Kling Element Management API Module
 * 
 * Elements 3.0 supports:
 * - Image Character Elements (upload images to create character reference)
 * - Video Character Elements (upload 3-8s video to capture visual + audio)
 * - Element library management (list, query, delete)
 * 
 * Elements are used in Omni Video via element_list + <<<element_N>>> prompt syntax.
 */

import { getKlingClient } from "./client";
import type {
  CreateImageElementRequest,
  CreateVideoElementRequest,
  ElementResult,
} from "./types";

const ELEMENT_PATH = "/v1/elements";

// ─── Create Elements ────────────────────────────────

/**
 * Create an image-based character element.
 * Upload 1+ images of a character for visual consistency.
 */
export async function createImageElement(
  params: CreateImageElementRequest,
  region?: "global" | "cn"
) {
  const client = getKlingClient();

  const response = await client.request<{ element_id: number }>({
    method: "POST",
    path: `${ELEMENT_PATH}/image-character`,
    body: params as unknown as Record<string, unknown>,
    region,
  });

  return response.data;
}

/**
 * Create a video-based character element.
 * Upload a 3-8 second video to capture both visual appearance and voice.
 * This is the Elements 3.0 "Video-Character Reference with Visual & Audio Capture".
 */
export async function createVideoElement(
  params: CreateVideoElementRequest,
  region?: "global" | "cn"
) {
  const client = getKlingClient();

  const response = await client.request<{ element_id: number }>({
    method: "POST",
    path: `${ELEMENT_PATH}/video-character`,
    body: params as unknown as Record<string, unknown>,
    region,
  });

  return response.data;
}

// ─── Query Elements ─────────────────────────────────

/**
 * Get element details by ID.
 */
export async function getElement(
  elementId: number,
  region?: "global" | "cn"
) {
  const client = getKlingClient();

  const response = await client.request<ElementResult>({
    method: "GET",
    path: `${ELEMENT_PATH}/${elementId}`,
    region,
  });

  return response.data;
}

/**
 * List all elements in the account.
 */
export async function listElements(
  pageNum = 1,
  pageSize = 30,
  region?: "global" | "cn"
) {
  const client = getKlingClient();

  const response = await client.request<{ total: number; list: ElementResult[] }>({
    method: "GET",
    path: `${ELEMENT_PATH}?pageNum=${pageNum}&pageSize=${pageSize}`,
    region,
  });

  return response.data;
}

// ─── Delete Elements ────────────────────────────────

/**
 * Delete an element from the library.
 */
export async function deleteElement(
  elementId: number,
  region?: "global" | "cn"
) {
  const client = getKlingClient();

  const response = await client.request<null>({
    method: "DELETE",
    path: `${ELEMENT_PATH}/${elementId}`,
    region,
  });

  return response.data;
}
