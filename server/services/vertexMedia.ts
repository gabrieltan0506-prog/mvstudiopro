import { getVertexAccessToken } from "../utils/vertex";

export const VERTEX_IMAGE_LOCATION_FLASH = "us-central1";
export const VERTEX_IMAGE_LOCATION_PRO = "us-central1";
export const VERTEX_VIDEO_LOCATION = "us-central1";

function s(v: unknown) {
  if (v == null) return "";
  if (Array.isArray(v)) return String(v[0] ?? "");
  return String(v);
}

function jparse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function getVertexProjectId() {
  const projectId = s(process.env.VERTEX_PROJECT_ID).trim();
  if (!projectId) {
    throw new Error("missing_env_VERTEX_PROJECT_ID");
  }
  return projectId;
}

export function getVertexImageFlashLocation() {
  return (
    String(process.env.VERTEX_IMAGE_LOCATION_FLASH || process.env.VERTEX_IMAGE_LOCATION || VERTEX_IMAGE_LOCATION_FLASH).trim() ||
    VERTEX_IMAGE_LOCATION_FLASH
  );
}

export function getVertexImageProLocation() {
  return (
    String(process.env.VERTEX_IMAGE_LOCATION_PRO || process.env.VERTEX_IMAGE_LOCATION || VERTEX_IMAGE_LOCATION_PRO).trim() ||
    VERTEX_IMAGE_LOCATION_PRO
  );
}

export function getVertexVideoLocation() {
  return String(process.env.VERTEX_VIDEO_LOCATION || VERTEX_VIDEO_LOCATION).trim() || VERTEX_VIDEO_LOCATION;
}

export function baseUrlForVertex(location: string) {
  return location === "global"
    ? "https://aiplatform.googleapis.com"
    : `https://${location}-aiplatform.googleapis.com`;
}

export async function fetchVertexJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const rawText = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    json: jparse(rawText),
    rawText,
  };
}

export async function getVertexAuthHeaders(contentType = "application/json") {
  const token = await getVertexAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": contentType,
  };
}

export async function fetchRemoteAssetAsBase64(assetUrl: string) {
  const url = s(assetUrl).trim();
  if (!url) throw new Error("missing_asset_url");

  const resp = await fetch(url, {
    headers: { "User-Agent": "mvstudiopro/vertex-media" },
    redirect: "follow",
  });
  if (!resp.ok) {
    throw new Error(`asset_fetch_failed_${resp.status}`);
  }

  const mimeType = String(resp.headers.get("content-type") || "application/octet-stream");
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (!buffer.length) throw new Error("asset_is_empty");

  return {
    mimeType,
    base64: buffer.toString("base64"),
    buffer,
  };
}

export function extractGeneratedImage(responseJson: any) {
  const parts = responseJson?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const imagePart = parts.find((part: any) => part?.inlineData?.data);
  if (!imagePart?.inlineData?.data) return null;
  return {
    data: String(imagePart.inlineData.data),
    mimeType: String(imagePart.inlineData.mimeType || "image/png"),
  };
}

export function extractVideoOperationName(responseJson: any) {
  return s(responseJson?.name).trim();
}

export function normalizePredictOperationName(taskIdOrName: string, projectId: string, model: string, location: string) {
  const input = s(taskIdOrName).trim();
  if (!input) return "";
  const prefix = `projects/${projectId}/locations/${location}/publishers/google/models/${model}/operations/`;
  if (input.startsWith(prefix)) return input;
  const matched = input.match(/operations\/([^/?\s]+)/);
  const operationId = matched?.[1] || input;
  return `${prefix}${operationId}`;
}

export function extractVideoUrl(responseJson: any) {
  const candidates = [
    responseJson?.response?.generatedVideos?.[0]?.video?.uri,
    responseJson?.response?.generatedVideos?.[0]?.video?.url,
    responseJson?.generatedVideos?.[0]?.video?.uri,
    responseJson?.generatedVideos?.[0]?.video?.url,
    responseJson?.response?.videos?.[0]?.uri,
    responseJson?.response?.videos?.[0]?.url,
    responseJson?.videoUrl,
    responseJson?.url,
  ];

  for (const candidate of candidates) {
    const value = s(candidate).trim();
    if (value) return value;
  }
  return "";
}
