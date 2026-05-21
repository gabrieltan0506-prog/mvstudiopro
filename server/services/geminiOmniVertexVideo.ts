/**
 * TestLab · Gemini Omni 全模态视频（Vertex AI + @google/genai generateVideos）
 * 模型默认 gemini-omni-flash-preview，机房默认 us-central1。
 */
import { GoogleGenAI, ThinkingLevel, type GenerateVideosOperation } from "@google/genai";
import { fetchRemoteAssetAsBase64 } from "./vertexMedia";

export type OmniVideoResolution = "2K" | "4K";
export type OmniVideoDurationSeconds = 30 | 60;

export type OmniVideoCreateInput = {
  prompt: string;
  audioPrompt?: string;
  imageUrl?: string;
  durationSeconds?: number;
  aspectRatio?: "16:9" | "9:16";
  resolution?: OmniVideoResolution;
};

export function resolveOmniVideoModel() {
  return String(process.env.VERTEX_OMNI_VIDEO_MODEL || "gemini-omni-flash-preview").trim();
}

export function resolveOmniVideoLocation() {
  return String(process.env.VERTEX_OMNI_VIDEO_LOCATION || "us-central1").trim() || "us-central1";
}

function resolveVertexProjectId() {
  const project = String(
    process.env.GCP_PROJECT_ID || process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "",
  ).trim();
  if (!project) throw new Error("missing_GCP_PROJECT_ID_or_VERTEX_PROJECT_ID");
  return project;
}

function buildGoogleGenAiAuthOptionsFromEnv():
  | { credentials: { client_email: string; private_key: string } }
  | undefined {
  const raw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  if (!raw || raw === "{}") return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const email = parsed.client_email;
    const pk = parsed.private_key;
    if (typeof email === "string" && typeof pk === "string") {
      return { credentials: { client_email: email, private_key: pk.replace(/\\n/g, "\n") } };
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

export function buildVertexOmniGenAiClient() {
  const authOpts = buildGoogleGenAiAuthOptionsFromEnv();
  return new GoogleGenAI({
    vertexai: true,
    project: resolveVertexProjectId(),
    location: resolveOmniVideoLocation(),
    ...(authOpts ? { googleAuthOptions: authOpts } : {}),
  });
}

function normalizeDurationSeconds(raw: number | undefined): OmniVideoDurationSeconds {
  const n = Number(raw);
  if (n >= 55) return 60;
  return 30;
}

function normalizeResolution(raw: string | undefined): OmniVideoResolution {
  const v = String(raw || "").trim().toUpperCase();
  return v === "2K" ? "2K" : "4K";
}

function buildCombinedPrompt(prompt: string, audioPrompt?: string) {
  const visual = String(prompt || "").trim();
  const audio = String(audioPrompt || "").trim();
  if (!audio) return visual;
  return `${visual}\n\n[Native audio direction]: ${audio}`;
}

export async function startOmniVideoGeneration(input: OmniVideoCreateInput) {
  const ai = buildVertexOmniGenAiClient();
  const model = resolveOmniVideoModel();
  const location = resolveOmniVideoLocation();
  const durationSeconds = normalizeDurationSeconds(input.durationSeconds);
  const resolution = normalizeResolution(input.resolution);
  const aspectRatio = input.aspectRatio === "9:16" ? "9:16" : "16:9";
  const prompt = buildCombinedPrompt(input.prompt, input.audioPrompt);

  const source: { prompt: string; image?: { imageBytes: string; mimeType: string } } = { prompt };
  if (input.imageUrl?.trim()) {
    const image = await fetchRemoteAssetAsBase64(input.imageUrl.trim());
    source.image = {
      imageBytes: image.base64,
      mimeType: image.mimeType,
    };
  }

  const operation = await ai.models.generateVideos({
    model,
    source,
    config: {
      numberOfVideos: 1,
      aspectRatio,
      resolution,
      durationSeconds,
      fps: 30,
      generateAudio: true,
      enhancePrompt: true,
      thinkingConfig: {
        includeThoughts: false,
        thinkingLevel: ThinkingLevel.HIGH,
      },
    } as Parameters<typeof ai.models.generateVideos>[0]["config"],
  });

  const taskId = String(operation.name || "").trim();
  if (!taskId) throw new Error("omni_video_missing_operation_name");

  return {
    model,
    location,
    taskId,
    durationSeconds,
    resolution,
    aspectRatio,
    operation,
  };
}

export async function pollOmniVideoGeneration(taskId: string) {
  const ai = buildVertexOmniGenAiClient();
  const operation = await ai.operations.getVideosOperation({
    operation: { name: taskId } as GenerateVideosOperation,
  });
  const done = Boolean(operation.done);
  const failed = done && Boolean(operation.error);
  const status = failed ? "failed" : done ? "succeeded" : "running";
  const video = operation.response?.generatedVideos?.[0]?.video;
  return {
    status,
    done,
    failed,
    videoUri: String(video?.uri || "").trim(),
    videoBytes: String(video?.videoBytes || "").trim(),
    mimeType: String(video?.mimeType || "video/mp4").trim() || "video/mp4",
    operation,
    error: operation.error,
  };
}
