/**
 * TestLab · Gemini Omni 全模态视频（@google/genai generateVideos）
 * - 优先 Vertex IAM（location 默认 global）
 * - Vertex 失败时 fallback 至 GEMINI_API_KEY（Consumer Gemini API）
 * 模型默认 gemini-omni-flash-preview（可通过 VERTEX_OMNI_VIDEO_MODEL 覆盖）。
 */
import { GoogleGenAI, ThinkingLevel, type GenerateVideosOperation } from "@google/genai";
import { fetchRemoteAssetAsBase64 } from "./vertexMedia";

export type OmniVideoResolution = "2K" | "4K";
export type OmniVideoDurationSeconds = 30 | 60;
export type OmniVideoAuthMode = "vertex" | "gemini_api";

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
  return String(process.env.VERTEX_OMNI_VIDEO_LOCATION || "global").trim() || "global";
}

function resolveVertexProjectId() {
  const project = String(
    process.env.GCP_PROJECT_ID || process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "",
  ).trim();
  if (!project) throw new Error("missing_GCP_PROJECT_ID_or_VERTEX_PROJECT_ID");
  return project;
}

export function canUseVertexOmni(): boolean {
  const project = String(
    process.env.GCP_PROJECT_ID || process.env.VERTEX_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "",
  ).trim();
  if (project) return true;
  const raw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  return Boolean(raw && raw !== "{}");
}

function resolveGeminiApiKey(): string {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  return apiKey;
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

export function buildGeminiApiOmniClient() {
  return new GoogleGenAI({ apiKey: resolveGeminiApiKey() });
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

type OmniGenerateParams = {
  model: string;
  source: { prompt: string; image?: { imageBytes: string; mimeType: string } };
  config: Parameters<GoogleGenAI["models"]["generateVideos"]>[0]["config"];
};

function buildOmniGenerateParams(input: OmniVideoCreateInput): OmniGenerateParams {
  const model = resolveOmniVideoModel();
  const durationSeconds = normalizeDurationSeconds(input.durationSeconds);
  const resolution = normalizeResolution(input.resolution);
  const aspectRatio = input.aspectRatio === "9:16" ? "9:16" : "16:9";
  const prompt = buildCombinedPrompt(input.prompt, input.audioPrompt);

  const source: OmniGenerateParams["source"] = { prompt };

  return {
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
    } as OmniGenerateParams["config"],
  };
}

async function attachImageToSource(
  source: OmniGenerateParams["source"],
  imageUrl?: string,
) {
  if (!imageUrl?.trim()) return;
  const image = await fetchRemoteAssetAsBase64(imageUrl.trim());
  source.image = {
    imageBytes: image.base64,
    mimeType: image.mimeType,
  };
}

async function invokeGenerateVideos(ai: GoogleGenAI, params: OmniGenerateParams) {
  return ai.models.generateVideos({
    model: params.model,
    source: params.source,
    config: params.config,
  });
}

function extractImmediateVideo(operation: GenerateVideosOperation) {
  const video = operation.response?.generatedVideos?.[0]?.video;
  if (!video) return null;
  const videoBytes = String(video.videoBytes || "").trim();
  const videoUri = String(video.uri || "").trim();
  if (!videoBytes && !videoUri) return null;
  return {
    videoBytes,
    videoUri,
    mimeType: String(video.mimeType || "video/mp4").trim() || "video/mp4",
  };
}

async function startWithClient(
  ai: GoogleGenAI,
  input: OmniVideoCreateInput,
  authMode: OmniVideoAuthMode,
  location: string,
) {
  const params = buildOmniGenerateParams(input);
  await attachImageToSource(params.source, input.imageUrl);

  const operation = await invokeGenerateVideos(ai, params);
  const immediate = Boolean(operation.done) ? extractImmediateVideo(operation) : null;
  const taskId = String(operation.name || "").trim();

  if (!taskId && !immediate) {
    throw new Error("omni_video_missing_operation_name");
  }

  return {
    model: params.model,
    location,
    authMode,
    taskId: taskId || "",
    durationSeconds: normalizeDurationSeconds(input.durationSeconds),
    resolution: normalizeResolution(input.resolution),
    aspectRatio: input.aspectRatio === "9:16" ? "9:16" : "16:9",
    operation,
    immediate,
  };
}

export async function startOmniVideoGeneration(input: OmniVideoCreateInput) {
  const location = resolveOmniVideoLocation();
  const vertexErrors: string[] = [];

  if (canUseVertexOmni()) {
    try {
      return await startWithClient(buildVertexOmniGenAiClient(), input, "vertex", location);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      vertexErrors.push(msg);
      console.warn("[omni-video] Vertex 不可用，改 GEMINI_API_KEY:", msg);
    }
  }

  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    const hint = vertexErrors.length ? vertexErrors.join("; ") : "missing_vertex_and_GEMINI_API_KEY";
    throw new Error(hint);
  }

  return startWithClient(buildGeminiApiOmniClient(), input, "gemini_api", "gemini-api");
}

export async function pollOmniVideoGeneration(
  taskId: string,
  opts?: { authMode?: OmniVideoAuthMode },
) {
  const authMode = opts?.authMode;
  const ai =
    authMode === "gemini_api"
      ? buildGeminiApiOmniClient()
      : authMode === "vertex"
        ? buildVertexOmniGenAiClient()
        : canUseVertexOmni()
          ? buildVertexOmniGenAiClient()
          : buildGeminiApiOmniClient();

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
