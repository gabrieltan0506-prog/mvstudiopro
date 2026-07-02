/**
 * Gemini Omni Flash Preview · Interactions API（AI Studio 同款）
 * 模型：models/gemini-omni-flash-preview
 * 文档：https://aistudio.google.com/prompts/new_chat?model=gemini-omni-flash-preview
 */
import { GoogleGenAI } from "@google/genai";
import { signGsUriV4ReadUrl } from "./gcs";
import { fetchRemoteAssetAsBase64 } from "./vertexMedia";
import { requireGeminiApiKey } from "./googleDeepResearchInteractions";

const INTERACTIONS_REST_CREATE = "https://generativelanguage.googleapis.com/v1beta/interactions";

export const OMNI_FLASH_MODEL = "models/gemini-omni-flash-preview";

export type OmniVideoTask =
  | "unspecified"
  | "text_to_video"
  | "image_to_video"
  | "reference_to_video"
  | "edit_video";

export type OmniInteractionCreateInput = {
  prompt: string;
  task?: OmniVideoTask;
  aspectRatio?: "9:16" | "16:9";
  /** 秒数；Interactions response_format 使用如 `10s` */
  durationSeconds?: number;
  resolution?: "720p" | "1080p" | "2K" | "4K";
  imageUrl?: string;
  videoUrl?: string;
  gcsUri?: string;
  referenceImageUrls?: string[];
  systemInstruction?: string;
  responseModalities?: Array<"text" | "video" | "image">;
};

export type OmniInteractionOutputs = {
  text: string;
  videoUri: string;
  videoBytes: string;
  videoMimeType: string;
  imageUrls: string[];
  raw: Record<string, unknown>;
};

function normalizeModel(model?: string) {
  const m = String(model || OMNI_FLASH_MODEL).trim();
  return m.startsWith("models/") ? m : `models/${m}`;
}

function normalizeDurationLabel(seconds: number | undefined) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return "10s";
  if (n <= 10) return "10s";
  if (n <= 30) return "30s";
  return "60s";
}

function normalizeVideoTask(task: string | undefined, hasImage: boolean, hasVideo: boolean): OmniVideoTask {
  const t = String(task || "").trim().toLowerCase();
  if (t === "text_to_video" || t === "image_to_video" || t === "reference_to_video" || t === "edit_video") {
    return t as OmniVideoTask;
  }
  if (hasVideo) return "edit_video";
  if (hasImage) return "image_to_video";
  return "text_to_video";
}

async function resolveMediaUrl(raw: string | undefined): Promise<string> {
  const url = String(raw || "").trim();
  if (!url) return "";
  if (url.startsWith("gs://")) {
    return signGsUriV4ReadUrl(url, 3600);
  }
  return url;
}

async function buildInteractionInput(input: OmniInteractionCreateInput) {
  const prompt = String(input.prompt || "").trim();
  const imageUrl = await resolveMediaUrl(input.imageUrl || input.gcsUri);
  const videoUrl = await resolveMediaUrl(input.videoUrl);
  const refUrls = await Promise.all((input.referenceImageUrls || []).map((u) => resolveMediaUrl(u)));

  const hasVideo = Boolean(videoUrl);
  const hasImage = Boolean(imageUrl) || refUrls.length > 0;
  const task = normalizeVideoTask(input.task, hasImage, hasVideo);

  const parts: Array<Record<string, unknown>> = [];
  if (prompt) parts.push({ type: "text", text: prompt });

  if (videoUrl) {
    const asset = await fetchRemoteAssetAsBase64(videoUrl);
    parts.push({
      type: "video",
      data: asset.base64,
      mime_type: asset.mimeType || "video/mp4",
    });
  }

  const imageCandidates = [imageUrl, ...refUrls].filter(Boolean);
  for (const imgUrl of imageCandidates) {
    const asset = await fetchRemoteAssetAsBase64(imgUrl);
    parts.push({
      type: "image",
      data: asset.base64,
      mime_type: asset.mimeType || "image/png",
    });
  }

  if (parts.length === 0) {
    throw new Error("missing_prompt_or_media");
  }

  return {
    task,
    input: parts.length === 1 && parts[0]?.type === "text" ? prompt : parts,
  };
}

export async function createOmniFlashInteraction(input: OmniInteractionCreateInput) {
  const apiKey = requireGeminiApiKey();
  const model = normalizeModel();
  const { task, input: interactionInput } = await buildInteractionInput(input);
  const aspectRatio = input.aspectRatio === "9:16" ? "9:16" : "16:9";
  const duration = normalizeDurationLabel(input.durationSeconds);
  const modalities = input.responseModalities?.length
    ? input.responseModalities
    : task === "edit_video" || task === "text_to_video" || task === "image_to_video" || task === "reference_to_video"
      ? (["video"] as const)
      : (["video"] as const);

  const body: Record<string, unknown> = {
    model,
    input: interactionInput,
    background: true,
    generation_config: {
      max_output_tokens: 128480,
      thinkingLevel: "high",
      video_config: { task },
    },
    response_modalities: modalities,
    response_format: {
      type: "video",
      aspect_ratio: aspectRatio,
      duration,
    },
  };

  if (input.systemInstruction?.trim()) {
    body.system_instruction = { parts: [{ text: input.systemInstruction.trim() }] };
  }

  const res = await fetch(INTERACTIONS_REST_CREATE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "x-goog-api-key": apiKey,
      "X-Goog-Api-Client": "genai-node/omni-canvas-rest-create",
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let parsed: { id?: string; error?: { message?: string; code?: string } } = {};
  try {
    parsed = JSON.parse(raw || "{}") as typeof parsed;
  } catch {
    /* ignore */
  }

  if (!res.ok) {
    const msg = parsed.error?.message || parsed.error?.code || raw.slice(0, 800);
    throw new Error(`omni_interaction_create HTTP ${res.status}: ${msg}`);
  }

  const id = parsed.id;
  if (!id) throw new Error(`omni_interaction_create 未返回 id · ${raw.slice(0, 400)}`);

  return { id, model, task, aspectRatio, duration };
}

export async function getOmniFlashInteraction(interactionId: string) {
  const ai = new GoogleGenAI({ apiKey: requireGeminiApiKey() });
  return (await ai.interactions.get(interactionId)) as unknown as Record<string, unknown>;
}

function collectVideoFromObject(obj: Record<string, unknown>) {
  const uri = String(obj.uri || obj.file_uri || obj.video_uri || "").trim();
  const bytes = String(obj.data || obj.video_bytes || obj.bytesBase64Encoded || "").trim();
  const mimeType = String(obj.mime_type || obj.mimeType || "video/mp4").trim() || "video/mp4";
  return { uri, bytes, mimeType };
}

export function extractOmniInteractionOutputs(interaction: unknown): OmniInteractionOutputs {
  const obj = interaction as Record<string, unknown>;
  const outputs = Array.isArray(obj.outputs) ? (obj.outputs as Array<Record<string, unknown>>) : [];
  const steps = Array.isArray(obj.steps) ? (obj.steps as Array<Record<string, unknown>>) : [];

  let text = "";
  const imageUrls: string[] = [];
  let videoUri = "";
  let videoBytes = "";
  let videoMimeType = "video/mp4";

  for (const out of outputs) {
    const type = String(out.type || "text").toLowerCase();
    if (type === "text" && typeof out.text === "string") {
      text = String(out.text);
    }
    if (type === "image" && out.data) {
      const mime = String(out.mime_type || out.mimeType || "image/png");
      imageUrls.push(`data:${mime};base64,${String(out.data)}`);
    }
    if (type === "video") {
      const v = collectVideoFromObject(out);
      if (v.uri) videoUri = v.uri;
      if (v.bytes) videoBytes = v.bytes;
      videoMimeType = v.mimeType;
    }
  }

  for (const step of steps) {
    if (step.type !== "model_output" || !Array.isArray(step.content)) continue;
    for (const part of step.content as Array<Record<string, unknown>>) {
      const type = String(part.type || "").toLowerCase();
      if (type === "text" && typeof part.text === "string") text = String(part.text);
      if (type === "image" && part.data) {
        const mime = String(part.mime_type || part.mimeType || "image/png");
        imageUrls.push(`data:${mime};base64,${String(part.data)}`);
      }
      if (type === "video") {
        const v = collectVideoFromObject(part);
        if (v.uri) videoUri = v.uri;
        if (v.bytes) videoBytes = v.bytes;
        videoMimeType = v.mimeType;
      }
    }
  }

  if (typeof obj.output_text === "string" && obj.output_text.trim()) {
    text = obj.output_text.trim();
  }

  return {
    text,
    videoUri,
    videoBytes,
    videoMimeType,
    imageUrls,
    raw: obj,
  };
}
