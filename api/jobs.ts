import type { VercelRequest, VercelResponse } from "@vercel/node";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import type { PaidJobDeductSnapshot } from "../server/services/paidJobLedger.js";
import sharp from "sharp";
import { get, put } from "@vercel/blob";
import { env, getEnvStatus } from "../server/vercel-api-core/env.js";
import { renderWorkflowFinalVideo } from "../server/vercel-api-core/render.js";
import { generateImageWithBanana } from "../server/vercel-api-core/banana.js";
import { getCometApiBaseUrl, getCometApiKey } from "../server/services/cometapi.js";
import {
  getWorkflow as getCoreWorkflow,
  saveWorkflow as saveCoreWorkflow,
  startWorkflow as startCoreWorkflow,
  type WorkflowTask,
} from "../server/vercel-api-core/workflow.js";
import { generateVideoWithVeo } from "../server/models/veo.js";
import { buildScriptPrompt } from "../server/workflow/prompts/scriptPrompt.js";
import { buildStoryboardPrompt } from "../server/workflow/prompts/storyboardPrompt.js";
import { buildStoryboardImagePrompt } from "../server/workflow/prompts/storyboardImagePrompt.js";
import { buildCharacterLockPrompt } from "../server/workflow/prompts/characterLockPrompt.js";
import { buildVideoPrompt } from "../server/workflow/prompts/videoPrompt.js";
import { buildVoicePrompt } from "../server/workflow/prompts/voicePrompt.js";
import { buildMusicPrompt } from "../server/workflow/prompts/musicPrompt.js";
import { characterLockStep } from "../server/workflow/steps/characterLockStep.js";
import { backgroundRemoveStep } from "../server/workflow/steps/backgroundRemoveStep.js";
import { synthesizeVoiceAudio } from "../server/models/voiceSynthesis.js";
import { resolveSafeFlyPlatformImageReadPath } from "../server/services/flyVolumeGeneratedImages.js";
function s(v: any): string { if (v == null) return ""; if (Array.isArray(v)) return String(v[0] ?? ""); return String(v); }
function jparse(t: string): any { try { return JSON.parse(t); } catch { return null; } }
function getBody(req: VercelRequest): any {
  const b: any = (req as any).body;
  if (!b) return {};
  if (typeof b === "string") return jparse(b) ?? {};
  return b;
}
function b64url(buf: Buffer) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function jwtHS256(iss: string, secret: string) {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" }), "utf-8"));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(Buffer.from(JSON.stringify({ iss, iat: now, nbf: now, exp: now + 3600 }), "utf-8"));
  const unsigned = `${header}.${payload}`;
  const sig = crypto.createHmac("sha256", secret).update(unsigned).digest();
  return `${unsigned}.${b64url(sig)}`;
}
async function fetchJson(url: string, init: RequestInit) {
  const r = await fetch(url, init);
  const text = await r.text();
  const json = jparse(text);
  return { ok: r.ok, status: r.status, url, json, rawText: text.slice(0, 4000) };
}

async function fetchImageAsset(imageUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
  const url = s(imageUrl).trim();
  if (!url) throw new Error("missing_image_url");

  const tokens = Array.from(
    new Set(
      [process.env.MVSP_READ_WRITE_TOKEN, process.env.BLOB_READ_WRITE_TOKEN].map((value) => s(value).trim()).filter(Boolean),
    ),
  );
  const headers: Record<string, string> = { "User-Agent": "mvstudiopro/1.0 (+fetch)" };

  let r = await fetch(url, { redirect: "follow", headers });
  if ((r.status === 403 || r.status === 404) && tokens.length) {
    for (const token of tokens) {
      headers.Authorization = `Bearer ${token}`;
      r = await fetch(url, { redirect: "follow", headers });
      if (r.ok) break;
    }
  }
  if (!r.ok) throw new Error(`image_fetch_failed:${r.status}`);
  const buffer = Buffer.from(await r.arrayBuffer());
  if (!buffer.length) throw new Error("empty_image");
  if (buffer.length > 20 * 1024 * 1024) throw new Error("image_too_large");
  return {
    buffer,
    contentType: s(r.headers.get("content-type") || "image/jpeg").trim() || "image/jpeg",
  };
}

function imageContentTypeToExtension(contentType: string) {
  const normalized = s(contentType).trim().toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  return "jpg";
}

const WORKFLOW_VIDEO_REF_MAX_EDGE = 1280;

function mapVeoAspectRatio(raw: string): "16:9" | "9:16" {
  const a = s(raw).trim();
  if (a === "9:16" || a === "3:4") return "9:16";
  return "16:9";
}

/** Seedance：fal duration 枚举 4–15 或 auto */
function parseSeedanceDurationInput(raw: any): number | "auto" {
  if (raw == null || raw === "") return "auto";
  const str = String(raw).trim().toLowerCase();
  if (str === "auto") return "auto";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "auto";
  return Math.min(15, Math.max(4, Math.floor(n)));
}

async function uploadWorkflowImageToBlob(imageUrl: string, filenameBase = "workflow-scene", options?: { mode?: "original" | "video" }) {
  const sourceUrl = s(imageUrl).trim();
  if (!sourceUrl) throw new Error("missing_image_url");

  const token = s(process.env.MVSP_READ_WRITE_TOKEN).trim();
  if (!token) throw new Error("missing_env_MVSP_READ_WRITE_TOKEN");

  const asset = await fetchImageAsset(sourceUrl);
  const safeName = filenameBase.replace(/[^a-zA-Z0-9_-]+/g, "-") || "workflow-scene";
  let out = asset.buffer;
  let contentType = asset.contentType;
  let ext = imageContentTypeToExtension(contentType);

  if (options?.mode === "video") {
    out = await sharp(asset.buffer, { failOnError: false })
      .rotate()
      .resize({
        width: WORKFLOW_VIDEO_REF_MAX_EDGE,
        height: WORKFLOW_VIDEO_REF_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();
    contentType = "image/jpeg";
    ext = "jpg";
    if (out.length > 10 * 1024 * 1024) {
      out = await sharp(out, { failOnError: false }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
    }
    const meta = await sharp(out, { failOnError: false }).metadata();
    const width = Number(meta.width || 0);
    const height = Number(meta.height || 0);
    if (!width || !height) {
      throw new Error("invalid_video_reference_metadata");
    }
    if (Math.max(width, height) > WORKFLOW_VIDEO_REF_MAX_EDGE) {
      throw new Error(`video_reference_edge_exceeds_${WORKFLOW_VIDEO_REF_MAX_EDGE}`);
    }
    if (out.length > 10 * 1024 * 1024) {
      throw new Error("image_too_large_after_compress");
    }
  }

  const blob = await put(`refs/${Date.now()}-${safeName}.${ext}`, out, {
    access: "public",
    token,
    contentType,
  });
  return buildBlobMediaUrlFromPath(s(blob.pathname).trim());
}

async function uploadWorkflowImagesToBlob(imageUrls: string[], filenameBase: string) {
  const urls = Array.isArray(imageUrls) ? imageUrls.map((url) => s(url).trim()).filter(Boolean) : [];
  const uploaded: string[] = [];
  for (let i = 0; i < urls.length; i += 1) {
    uploaded.push(await uploadWorkflowImageToBlob(urls[i], `${filenameBase}-${i + 1}`));
  }
  return uploaded;
}

async function uploadWorkflowAudioToBlob(sourceUrl: string, filenameBase = "workflow-audio") {
  const target = s(sourceUrl).trim();
  if (!target) throw new Error("missing_audio_url");

  const token = s(process.env.MVSP_READ_WRITE_TOKEN).trim();
  if (!token) throw new Error("missing_env_MVSP_READ_WRITE_TOKEN");

  const resp = await fetch(target, {
    redirect: "follow",
    headers: { "User-Agent": "mvstudiopro/1.0 (+audio-fetch)" },
  });
  if (!resp.ok) throw new Error(`audio_fetch_failed:${resp.status}`);

  const buffer = Buffer.from(await resp.arrayBuffer());
  if (!buffer.length) throw new Error("empty_audio");
  if (buffer.length > 30 * 1024 * 1024) throw new Error("audio_too_large");

  const contentType = s(resp.headers.get("content-type")).trim() || "audio/mpeg";
  const ext =
    /audio\/wav/i.test(contentType) ? "wav" :
    /audio\/ogg/i.test(contentType) ? "ogg" :
    /audio\/mpeg|audio\/mp3/i.test(contentType) ? "mp3" :
    "mp3";
  const safeName = filenameBase.replace(/[^a-zA-Z0-9_-]+/g, "-") || "workflow-audio";
  const blob = await put(`music/${Date.now()}-${safeName}.${ext}`, buffer, {
    access: "public",
    token,
    contentType,
  });
  return buildBlobMediaUrlFromPath(s(blob.pathname).trim());
}

function computeScaledSize(w0:number,h0:number,maxEdge:number){
  const m = Math.max(w0,h0);
  const scale = m <= maxEdge ? 1 : maxEdge / m;
  return { w: Math.max(1, Math.round(w0*scale)), h: Math.max(1, Math.round(h0*scale)) };
}

async function klingGenerateSceneBackground(klingBase:string, imageToken:string, prompt:string): Promise<Buffer> {
  const cometKey = getCometApiKey();
  const useComet = Boolean(cometKey);
  const baseUrl = useComet ? `${getCometApiBaseUrl()}/v1` : `${klingBase}/v1`;
  const headers = useComet
    ? { "Authorization":"Bearer "+cometKey, "Content-Type":"application/json", "Accept":"application/json" }
    : { "Authorization":"Bearer "+imageToken, "Content-Type":"application/json", "Accept":"application/json" };
  const body = useComet
    ? { model: "nano-banana-pro", prompt, size: "1280x720", n: 1 }
    : { prompt, n: 1, image_size: "1024x576" };
  const r = await fetchJson(`${baseUrl}/images/generations`,{
    method:"POST",
    headers,
    body: JSON.stringify(body)
  });
  if(!r.ok) throw new Error(`kling_image_generation_failed:${r.status}`);
  const sceneUrl = r.json?.data?.[0]?.url || r.json?.data?.[0]?.image_url || "";
  if(!sceneUrl) throw new Error("kling_image_no_url");
  const img = await fetch(sceneUrl, { redirect:"follow", headers:{ "User-Agent":"mvstudiopro/1.0 (+scene)" }});
  if(!img.ok) throw new Error(`scene_download_failed:${img.status}`);
  const buf = Buffer.from(await img.arrayBuffer());
  if(!buf.length) throw new Error("scene_empty");
  return buf;
}

async function buildFirstFrameJpeg(input: Buffer, prompt: string, klingBase: string, imageToken: string) {
  const meta = await sharp(input, { failOnError: false }).metadata();
  const w0 = meta.width || 0;
  const h0 = meta.height || 0;
  if (!w0 || !h0) throw new Error("invalid_image_metadata");
  if (w0 < 300 || h0 < 300) throw new Error(`image_too_small:${w0}x${h0}`);

  const { w, h } = computeScaledSize(w0, h0, 1280);
  const hasAlpha = Boolean(meta.hasAlpha);

  if (hasAlpha) {
    // Compose first frame:
    // 1) generate a background scene via Kling Image (no people)
    // 2) composite transparent PNG foreground onto the scene
    const bgPrompt = `${prompt}\n\nbackground scene only, no people, no characters, no person, no human, no face`;
    const bgBuf = await klingGenerateSceneBackground(klingBase, imageToken, bgPrompt);

    const bg = await sharp(bgBuf, { failOnError: false })
      .resize(w, h, { fit: "cover" })
      .toBuffer();

    const fg = await sharp(input, { failOnError: false })
      .resize(w, h, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, withoutEnlargement: true })
      .png()
      .toBuffer();

    const jpeg = await sharp(bg, { failOnError: false })
      .composite([{ input: fg }])
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer();

    return { jpeg, bytes: jpeg.length };
  }

  const jpeg = await sharp(input, { failOnError: false })
    .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return { jpeg, bytes: jpeg.length };
}

async function createKlingI2VTask(
  klingBase: string,
  videoToken: string,
  imageToken: string,
  imageUrl: string,
  prompt: string,
  model: string,
  duration = "5"
) {
  const { buffer: buf } = await fetchImageAsset(imageUrl);
  const first = await buildFirstFrameJpeg(buf, prompt, klingBase, imageToken);
  const cometKey = getCometApiKey();
  const useComet = Boolean(cometKey);
  const baseUrl = useComet ? `${getCometApiBaseUrl()}/kling/v1` : `${klingBase}/v1`;
  const headers = useComet
    ? { Authorization: "Bearer " + cometKey, "Content-Type": "application/json", Accept: "application/json" }
    : { Authorization: "Bearer " + videoToken, "Content-Type": "application/json", Accept: "application/json" };
  const r = await fetchJson(`${baseUrl}/videos/image2video`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model_name: model || "kling-v2-6",
      image: first.jpeg.toString("base64"),
      prompt,
      duration,
      mode: "pro",
      sound: "off",
    }),
  });
  return { taskId: r.json?.data?.task_id || null, raw: r };
}

async function pollKlingI2VTask(klingBase: string, videoToken: string, taskId: string, timeoutMs = 240_000) {
  const pollMs = 5_000;
  const startedAt = Date.now();
  const cometKey = getCometApiKey();
  const useComet = Boolean(cometKey);
  const baseUrl = useComet ? `${getCometApiBaseUrl()}/kling/v1` : `${klingBase}/v1`;
  const headers = useComet
    ? { Authorization: "Bearer " + cometKey, Accept: "application/json" }
    : { Authorization: "Bearer " + videoToken, Accept: "application/json" };
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const r = await fetchJson(`${baseUrl}/videos/image2video/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers,
    });
    const taskStatus = s(r.json?.data?.task_status || "");
    if (taskStatus === "succeed") {
      const videoUrl = r.json?.data?.task_result?.videos?.[0]?.url || null;
      if (videoUrl) return { ok: true, videoUrl };
      return { ok: false, error: "kling succeeded without video url" };
    }
    if (taskStatus === "failed") {
      return { ok: false, error: s(r.json?.data?.task_status_msg || "kling generation failed") };
    }
  }
  return { ok: false, error: "kling generation timeout" };
}

async function createKlingT2VTask(klingBase: string, videoToken: string, prompt: string, model: string) {
  const cometKey = getCometApiKey();
  const useComet = Boolean(cometKey);
  const baseUrl = useComet ? `${getCometApiBaseUrl()}/kling/v1` : `${klingBase}/v1`;
  const headers = useComet
    ? { Authorization: "Bearer " + cometKey, "Content-Type": "application/json", Accept: "application/json" }
    : { Authorization: "Bearer " + videoToken, "Content-Type": "application/json", Accept: "application/json" };
  const r = await fetchJson(`${baseUrl}/videos/text2video`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model_name: model || "kling-v2-6",
      prompt,
      duration: "5",
      mode: "pro",
      aspect_ratio: "16:9",
      sound: "off",
    }),
  });
  return { taskId: r.json?.data?.task_id || null, raw: r };
}

async function pollKlingT2VTask(klingBase: string, videoToken: string, taskId: string, timeoutMs = 240_000) {
  const pollMs = 5_000;
  const startedAt = Date.now();
  const cometKey = getCometApiKey();
  const useComet = Boolean(cometKey);
  const baseUrl = useComet ? `${getCometApiBaseUrl()}/kling/v1` : `${klingBase}/v1`;
  const headers = useComet
    ? { Authorization: "Bearer " + cometKey, Accept: "application/json" }
    : { Authorization: "Bearer " + videoToken, Accept: "application/json" };
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const r = await fetchJson(`${baseUrl}/videos/text2video/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers,
    });
    const taskStatus = s(r.json?.data?.task_status || "");
    if (taskStatus === "succeed") {
      const videoUrl = r.json?.data?.task_result?.videos?.[0]?.url || null;
      if (videoUrl) return { ok: true, videoUrl };
      return { ok: false, error: "kling succeeded without video url" };
    }
    if (taskStatus === "failed") {
      return { ok: false, error: s(r.json?.data?.task_status_msg || "kling generation failed") };
    }
  }
  return { ok: false, error: "kling generation timeout" };
}

async function generateSceneVoice(input: { dialogueText: string; voicePrompt?: string; voice?: string; voiceType?: string; voiceStyle?: string }) {
  try {
    const synthesized = await synthesizeVoiceAudio(input);
    if (!synthesized.audioBuffer.length) {
      return {
        voiceProvider: synthesized.provider,
        voiceModel: synthesized.model,
        voiceVoice: synthesized.voice,
        voiceUrl: "",
        voiceIsFallback: true,
        voiceErrorMessage: synthesized.errorMessage,
      };
    }

    const blobKey = `voices/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${synthesized.extension}`;
    const blob = env.mvspReadWriteToken
      ? await put(blobKey, synthesized.audioBuffer, {
          access: "public",
          contentType: synthesized.contentType,
          token: env.mvspReadWriteToken,
        })
      : await put(blobKey, synthesized.audioBuffer, {
          access: "public",
          contentType: synthesized.contentType,
        });

    return {
      voiceProvider: synthesized.provider,
      voiceModel: synthesized.model,
      voiceVoice: synthesized.voice,
      voiceUrl: buildBlobMediaUrlFromPath(s(blob.pathname).trim()),
      voiceIsFallback: synthesized.isFallback,
      voiceErrorMessage: "",
    };
  } catch (error: any) {
    return {
      voiceProvider: "vertex" as const,
      voiceModel: s(process.env.VERTEX_TTS_MODEL || "gemini-2.5-flash-preview-tts") as string,
      voiceVoice: s(process.env.VERTEX_TTS_VOICE_FEMALE || "Kore") as string,
      voiceUrl: "",
      voiceIsFallback: true,
      voiceErrorMessage: error?.message || String(error),
    };
  }
}

type WorkflowStoryboardScene = {
  sceneIndex: number;
  sceneTitle?: string;
  scenePrompt: string;
  primarySubject?: string;
  voiceover?: string;
  voiceType?: string;
  voiceStyle?: string;
  environment?: string;
  character?: string;
  duration: number;
  camera: string;
  mood: string;
  lighting?: string;
  action?: string;
  renderStillNeeded?: boolean;
  renderStillPrompt?: string;
};

type WorkflowStoryboardImageItem = {
  sceneIndex: number;
  images: string[];
  imageUrls?: string[];
  characterImages?: string[];
  characterImageUrl?: string;
  sceneImages?: string[];
  sceneImageUrls?: string[];
  selectedSceneImageUrl?: string;
  renderStillImageUrl?: string;
  renderStillPrompt?: string;
  prompt?: string;
  duration?: number;
  sceneVideoUrl?: string;
  sceneVoiceUrl?: string;
  sceneVoicePrompt?: string;
  sceneVoiceType?: string;
  sceneVoiceStyle?: string;
  sceneVoiceVoice?: string;
  characterLocked?: boolean;
  referenceCharacterUrl?: string;
  characterPngUrl?: string;
  backgroundStatus?: string;
};

function upsertStoryboardImageItem(
  currentItems: any[],
  sceneIndex: number,
  buildNext: (existing: any) => WorkflowStoryboardImageItem,
) {
  const current = Array.isArray(currentItems) ? currentItems : [];
  const existing = current.find((item: any) => Number(item?.sceneIndex) === sceneIndex) || null;
  const nextItem = buildNext(existing);
  const next = current.some((item: any) => Number(item?.sceneIndex) === sceneIndex)
    ? current.map((item: any) => (Number(item?.sceneIndex) === sceneIndex ? nextItem : item))
    : [...current, nextItem];
  return next.sort((a: any, b: any) => Number(a?.sceneIndex || 0) - Number(b?.sceneIndex || 0));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWorkflowForResponse(input: any, fallbackId = "") {
  const workflowId = s(input?.workflowId || fallbackId).trim();
  if (!input) {
    return {
      workflowId,
      status: "not_found",
      currentStep: "input",
      outputs: {},
    };
  }
  return {
    workflowId,
    status: s(input?.status).trim() || (workflowId ? "running" : "not_found"),
    currentStep: s(input?.currentStep).trim() || "input",
    outputs: input?.outputs && typeof input.outputs === "object" ? input.outputs : {},
  };
}

function readWorkflow(workflowId: string, fallbackWorkflow?: any): any {
  const id = s(workflowId || fallbackWorkflow?.workflowId).trim();
  if (!id) throw new Error("workflowId is required");
  const task = getCoreWorkflow(id);
  if (task) return task;

  if (fallbackWorkflow && typeof fallbackWorkflow === "object") {
    const rebuilt = {
      ...fallbackWorkflow,
      workflowId: id,
      createdAt: Number(fallbackWorkflow.createdAt || Date.now()),
      updatedAt: Date.now(),
      status: s(fallbackWorkflow.status).trim() || "running",
      currentStep: s(fallbackWorkflow.currentStep).trim() || "input",
      outputs: fallbackWorkflow.outputs && typeof fallbackWorkflow.outputs === "object" ? fallbackWorkflow.outputs : {},
    } as WorkflowTask;
    saveCoreWorkflow(rebuilt);
    return rebuilt;
  }

  throw new Error("workflow not found");
}

function saveWorkflowPatch(task: any, patch: { currentStep?: string; status?: string; outputs?: Record<string, any> }) {
  const next = {
    ...task,
    updatedAt: Date.now(),
    currentStep: (patch.currentStep || task.currentStep) as any,
    status: (patch.status || task.status) as any,
    outputs: {
      ...(task.outputs || {}),
      ...(patch.outputs || {}),
    },
  } as WorkflowTask;
  saveCoreWorkflow(next);
  return next;
}

function normalizeStoryboardScene(input: any, fallbackIndex: number, fallbackDuration = 5): WorkflowStoryboardScene {
  return {
    sceneIndex: Number(input?.sceneIndex || fallbackIndex),
    sceneTitle: s(input?.sceneTitle || `Scene ${fallbackIndex}`).trim(),
    scenePrompt: s(input?.scenePrompt).trim(),
    primarySubject: s(input?.primarySubject || input?.character).trim(),
    voiceover: s(input?.voiceover || input?.scenePrompt).trim(),
    voiceType: s(input?.voiceType || "female").trim() || "female",
    voiceStyle: s(input?.voiceStyle || "").trim(),
    environment: s(input?.environment || "cinematic environment").trim(),
    character: s(input?.character || "same main character identity").trim(),
    duration: Number(input?.duration || 0) || fallbackDuration,
    camera: s(input?.camera || "medium").trim() || "medium",
    mood: s(input?.mood || "cinematic").trim() || "cinematic",
    lighting: s(input?.lighting || "dramatic lighting").trim() || "dramatic lighting",
    action: s(input?.action || "character-driven cinematic action").trim() || "character-driven cinematic action",
    renderStillNeeded: Boolean(input?.renderStillNeeded),
    renderStillPrompt: s(input?.renderStillPrompt || input?.scenePrompt).trim(),
  };
}

function getStoryboardDraftFromBody(workflow: any, body: any) {
  const scenesInput = Array.isArray(body?.storyboard) ? body.storyboard : workflow?.outputs?.storyboard;
  return Array.isArray(scenesInput)
    ? scenesInput.map((scene: any, idx: number) =>
        normalizeStoryboardScene(scene, idx + 1, Number(workflow?.outputs?.sceneDuration || 0) || 8),
      )
    : [];
}

function getSceneCharacterImages(item: any): string[] {
  const explicit = Array.isArray(item?.characterImages)
    ? item.characterImages
    : [item?.characterImageUrl || item?.characterPngUrl || item?.referenceCharacterUrl].filter(Boolean);
  const normalized = explicit.map((value: any) => s(value).trim()).filter(Boolean);
  if (normalized.length) return normalized.slice(0, 1);

  const legacy = Array.isArray(item?.imageUrls)
    ? item.imageUrls
    : Array.isArray(item?.images)
      ? item.images
      : [];
  return legacy.map((value: any) => s(value).trim()).filter(Boolean).slice(0, 1);
}

function getSceneEnvironmentImages(item: any): string[] {
  const selected = s(item?.selectedSceneImageUrl).trim();
  const explicit = Array.isArray(item?.sceneImageUrls)
    ? item.sceneImageUrls
    : Array.isArray(item?.sceneImages)
      ? item.sceneImages
      : [];
  const normalized = explicit.map((value: any) => s(value).trim()).filter(Boolean);
  if (normalized.length) {
    const ordered = selected && normalized.includes(selected)
      ? [selected, ...normalized.filter((value: string) => value !== selected)]
      : normalized;
    return ordered.slice(0, 1);
  }

  const legacy = Array.isArray(item?.imageUrls)
    ? item.imageUrls
    : Array.isArray(item?.images)
      ? item.images
      : [];
  const normalizedLegacy = legacy.map((value: any) => s(value).trim()).filter(Boolean).slice(1, 2);
  if (selected && normalizedLegacy.includes(selected)) {
    return [selected, ...normalizedLegacy.filter((value: string) => value !== selected)].slice(0, 1);
  }
  return normalizedLegacy;
}

function buildSceneAssetBundle(existing: any, sceneIndex: number, patch: Record<string, any>) {
  const nextCharacterImages = Array.isArray(patch.characterImages)
    ? patch.characterImages.map((value: any) => s(value).trim()).filter(Boolean).slice(0, 1)
    : getSceneCharacterImages(existing);
  const nextSceneImages = Array.isArray(patch.sceneImages)
    ? patch.sceneImages.map((value: any) => s(value).trim()).filter(Boolean).slice(0, 1)
    : getSceneEnvironmentImages(existing);
  const combinedImages = [...nextSceneImages, ...nextCharacterImages].filter(Boolean);

  return {
    ...(existing || {}),
    ...patch,
    sceneIndex,
    characterImages: nextCharacterImages,
    characterImageUrl: nextCharacterImages[0] || "",
    sceneImages: nextSceneImages,
    sceneImageUrls: nextSceneImages,
    selectedSceneImageUrl: s(patch.selectedSceneImageUrl ?? existing?.selectedSceneImageUrl).trim() || nextSceneImages[0] || "",
    images: combinedImages,
    imageUrls: combinedImages,
    renderStillImageUrl: s(patch.renderStillImageUrl ?? existing?.renderStillImageUrl).trim(),
    renderStillPrompt: s(patch.renderStillPrompt ?? existing?.renderStillPrompt).trim(),
    sceneVoiceUrl: s(patch.sceneVoiceUrl ?? existing?.sceneVoiceUrl).trim(),
    sceneVoicePrompt: s(patch.sceneVoicePrompt ?? existing?.sceneVoicePrompt).trim(),
    sceneVoiceType: s(patch.sceneVoiceType ?? existing?.sceneVoiceType).trim(),
    sceneVoiceStyle: s(patch.sceneVoiceStyle ?? existing?.sceneVoiceStyle).trim(),
    sceneVoiceVoice: s(patch.sceneVoiceVoice ?? existing?.sceneVoiceVoice).trim(),
  } as WorkflowStoryboardImageItem;
}

function buildCharacterReferenceImagePrompt(scene: any, lockedCharacterPrompt?: string) {
  const parts = [
    "单人角色参考图。只生成一名人物，不要第二个人，不要群像，不要多人同框。",
    "人物主体完整清晰，适合作为后续 reference-to-video 的人物参考图。",
    "背景保持干净简洁，避免复杂场景和额外角色。",
  ];
  const identity = s(lockedCharacterPrompt).trim() || s(scene?.character).trim();
  const primarySubject = s(scene?.primarySubject).trim();
  if (primarySubject) parts.push(`主要人物：${primarySubject}`);
  if (identity) parts.push(`人物设定：${identity}`);
  if (s(scene?.scenePrompt).trim()) parts.push(`镜头对应情境：${s(scene.scenePrompt).trim()}`);
  if (s(scene?.action).trim()) parts.push(`人物动作：${s(scene.action).trim()}`);
  if (s(scene?.mood).trim()) parts.push(`情绪：${s(scene.mood).trim()}`);
  if (s(scene?.lighting).trim()) parts.push(`光影：${s(scene.lighting).trim()}`);
  return parts.join(" ");
}

function buildEnvironmentReferenceImagePrompt(scene: any) {
  const parts = [
    "场景环境参考图。不要出现任何人物、人脸、肢体、剪影或倒影。",
    "只保留环境、道具、动物或其他物体，适合作为后续 reference-to-video 的场景参考图。",
  ];
  if (Boolean(scene?.renderStillNeeded)) parts.push("如果原场景有人物互动，也不要把人物画进这张场景图。");
  if (s(scene?.environment).trim()) parts.push(`环境：${s(scene.environment).trim()}`);
  if (s(scene?.scenePrompt).trim()) parts.push(`场景描述：${s(scene.scenePrompt).trim()}`);
  if (s(scene?.camera).trim()) parts.push(`镜头：${s(scene.camera).trim()}`);
  if (s(scene?.mood).trim()) parts.push(`氛围：${s(scene.mood).trim()}`);
  if (s(scene?.lighting).trim()) parts.push(`光影：${s(scene.lighting).trim()}`);
  if (s(scene?.action).trim()) parts.push(`动作感：${s(scene.action).trim()}`);
  return parts.join(" ");
}

async function generateSceneCharacterImages(scene: any, workflow: any, warnings?: string[]) {
  const lockedCharacterPrompt = s(workflow.outputs?.lockedCharacterPrompt).trim();
  const characterPrompt = buildCharacterReferenceImagePrompt(scene, lockedCharacterPrompt || undefined);
  try {
    const characterGenerated = await generateImageWithBanana({
      prompt: characterPrompt,
      numImages: 1,
      aspectRatio: "9:16",
      imageSize: "1024x1536",
    });
    return await uploadWorkflowImagesToBlob(
      (characterGenerated.imageUrls || []).slice(0, 1),
      `storyboard-scene-${scene.sceneIndex}-character`,
    );
  } catch (error: any) {
    warnings?.push(`scene ${scene.sceneIndex} character image failed: ${error?.message || String(error)}`);
    return [];
  }
}

async function generateSceneEnvironmentImages(scene: any, warnings?: string[]) {
  const environmentPrompt = buildEnvironmentReferenceImagePrompt(scene);
  try {
    const environmentGenerated = await generateImageWithBanana({
      prompt: environmentPrompt,
      numImages: 1,
      aspectRatio: "16:9",
      imageSize: "1536x864",
    });
    return await uploadWorkflowImagesToBlob(
      (environmentGenerated.imageUrls || []).slice(0, 1),
      `storyboard-scene-${scene.sceneIndex}-scene`,
    );
  } catch (error: any) {
    warnings?.push(`scene ${scene.sceneIndex} scene image failed: ${error?.message || String(error)}`);
    return [];
  }
}

async function generateSceneAssetImages(scene: any, workflow: any) {
  const warnings: string[] = [];
  const [characterImages, sceneImages] = await Promise.all([
    generateSceneCharacterImages(scene, workflow, warnings),
    generateSceneEnvironmentImages(scene, warnings),
  ]);
  return { characterImages, sceneImages, warnings };
}

function sceneNeedsRenderStill(scene: any) {
  return Boolean(scene?.renderStillNeeded);
}

function buildRenderStillPrompt(scene: any, customPrompt?: string) {
  const manual = s(customPrompt).trim();
  if (manual) return manual;
  const parts = [
    "电影感多人静态展示图",
    "高质量影视级画面",
    "用于最终 render 阶段的静态插帧，不用于 AI 视频生成",
    s(scene?.renderStillPrompt || scene?.scenePrompt).trim(),
    s(scene?.environment).trim() ? `环境：${s(scene?.environment).trim()}` : "",
    s(scene?.camera).trim() ? `镜头：${s(scene?.camera).trim()}` : "",
    s(scene?.lighting).trim() ? `光影：${s(scene?.lighting).trim()}` : "",
    s(scene?.mood).trim() ? `情绪：${s(scene?.mood).trim()}` : "",
  ].filter(Boolean);
  return parts.join("，");
}

function buildStoryboardFromScript(input: {
  script: string;
  prompt?: string;
  targetScenes?: number;
  sceneDuration?: number;
}) {
  const script = s(input.script).trim();
  const prompt = s(input.prompt).trim();
  const rawLines = script
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const desiredScenes = Math.min(12, Math.max(1, Number(input.targetScenes || 0) || rawLines.length || 1));
  const fallbackDuration = Math.max(1, Number(input.sceneDuration || 0) || 5);
  const lines = rawLines.length > 0 ? rawLines : [prompt || "cinematic scene"];
  const out: WorkflowStoryboardScene[] = [];
  for (let i = 0; i < desiredScenes; i += 1) {
    const line = lines[i % lines.length];
    out.push({
      sceneIndex: i + 1,
      scenePrompt: line,
      duration: fallbackDuration,
      camera: i % 2 === 0 ? "medium" : "wide",
      mood: "cinematic",
    });
  }
  return out;
}

async function callGoogleGateway(payload: Record<string, any>) {
  const mod = await import("./google.js");
  const handler = mod.default;
  const req: any = { method: "POST", body: payload, query: {}, headers: { "content-type": "application/json" } };
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    },
  };
  await handler(req, res);
  return { statusCode: res.statusCode, ...(res.body || {}) };
}

function extractGoogleText(raw: any): string {
  return (
    raw?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("\n").trim() ||
    ""
  );
}

function stripJsonFence(text: string) {
  const src = s(text).trim();
  if (!src.startsWith("```")) return src;
  return src
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function sanitizeScenePrompt(value: any, sceneIndex: number, topic: string) {
  const cleaned = s(value)
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^---+$/gm, "")
    .replace(/\r/g, "")
    .trim();
  if (!cleaned) return `Scene ${sceneIndex}: ${topic}，电影感镜头推进。`;
  return cleaned;
}

function simplifySceneVideoPrompt(scene: any) {
  const source = s(scene?.scenePrompt || scene?.prompt).trim();
  const firstSentence = source.split(/[。！？!?\n]/).map((part) => part.trim()).filter(Boolean)[0] || source;
  const compact = firstSentence.replace(/\s+/g, " ").trim();
  return compact.slice(0, 120);
}

function buildSceneVoiceText(scene: any, overrideText?: string) {
  const manual = s(overrideText).trim();
  if (manual) return manual;
  return s(scene?.voiceover || scene?.scenePrompt || scene?.prompt).trim();
}

function mapSceneVoiceTypeToVoice(voiceType: string) {
  const normalized = s(voiceType).trim().toLowerCase();
  if (normalized === "male") return "onyx";
  if (normalized === "cartoon") return "echo";
  return "shimmer";
}

function buildSceneVoiceStyleText(scene: any, overrideStyle?: string) {
  const voiceType = s(scene?.voiceType || "female").trim() || "female";
  const baseStyle = s(overrideStyle || scene?.voiceStyle).trim();
  const descriptors = [
    `旁白角色类型：${voiceType}`,
    baseStyle ? `情绪风格：${baseStyle}` : "",
    voiceType === "male" ? "音色：成年男性旁白，低沉、有力、克制，明确避免女性音色" : "",
    voiceType === "cartoon" ? "音色：夸张卡通感，轻快、明亮、活泼，非写实播报腔" : "",
    voiceType === "female" ? "音色：成年女性旁白，明亮、柔和、带电影感，明确避免男性低沉音色" : "",
  ].filter(Boolean);
  return descriptors.join("，");
}

function truncateText(value: string, maxLength: number) {
  const trimmed = s(value).replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function deriveMusicSeedFromStoryboard(storyboard: any[], fallbackScript: string) {
  const combined = [
    ...(Array.isArray(storyboard) ? storyboard : []).slice(0, 4).map((scene: any) => [s(scene?.scenePrompt), s(scene?.mood), s(scene?.lighting)].join(" ")),
    s(fallbackScript).trim(),
  ].join(" ");
  const style =
    /(间谍|特工|潜行|追逐|杀手)/.test(combined) ? "间谍电影风格" :
    /(拉丁|热带|舞蹈|海边)/.test(combined) ? "拉丁电影风格" :
    "电影配乐";
  const mood =
    /(紧张|惊险|悬疑|危机|追逐)/.test(combined) ? "紧张悬疑" :
    /(浪漫|温柔|治愈)/.test(combined) ? "温柔抒情" :
    /(悲伤|孤独|诀别)/.test(combined) ? "伤感克制" :
    "电影感推进";
  const instrumentation =
    /(紧张|惊险|悬疑|危机|追逐)/.test(combined)
      ? "管弦乐与电子脉冲"
      : "弦乐与钢琴";
  const lead =
    /(拉丁|热带)/.test(combined) ? "拉丁打击乐主律动" :
    /(间谍|特工|潜行|追逐|杀手)/.test(combined) ? "低音弦乐与钢琴主旋律" :
    "钢琴主旋律";
  return truncateText(`${style}，${mood}，${instrumentation}，${lead}，纯音乐，无人声。`, 100);
}

/** Nuro GET /task 常為扁平欄位；轉成與 Sonic `data[]` clip 相容，前端與 jobs runner 無需改動 */
function normalizeNuroPollJson(json: any): any {
  if (!json || typeof json !== "object") return json;
  if (Array.isArray(json.data) && json.data.length) return json;
  const status = json.status ?? json.state;
  const audio = s(json.audio_url || json.audioUrl).trim();
  const tid = s(json.task_id || json.taskId).trim();
  if (!audio && !s(status).trim() && !tid) return json;
  return {
    ...json,
    data: [
      {
        ...json,
        id: tid || 0,
        clip_id: tid || 0,
        state: status,
        status,
        audio_url: audio || json.audio_url || json.audioUrl,
      },
    ],
  };
}

function extractMusicUrlFromPayload(payload: any): string {
  const candidates: string[] = [];
  const seen = new Set<any>();
  const visit = (value: any) => {
    if (!value || seen.has(value)) return;
    if (typeof value !== "object") return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const localCandidates = [
      value.audio_url,
      value.audioUrl,
      value.music_url,
      value.musicUrl,
      value.stream_url,
      value.streamUrl,
      value.download_url,
      value.downloadUrl,
      value.url,
    ];
    for (const candidate of localCandidates) {
      const normalized = s(candidate).trim();
      if (normalized) candidates.push(normalized);
    }
    Object.values(value).forEach(visit);
  };
  visit(payload);
  return candidates.find((candidate) => /^https?:\/\//i.test(candidate)) || "";
}

function deriveMusicProvider(payload: any) {
  const text = JSON.stringify(payload || {}).toLowerCase();
  if (text.includes("udio")) return "udio";
  if (text.includes("suno")) return "suno";
  return "aimusic";
}

function normalizeMusicProvider(value: any) {
  const provider = s(value).trim().toLowerCase();
  return provider === "udio" ? "udio" : "suno";
}

function deriveMusicError(status: string, payload: any) {
  const source = payload?.data || payload?.result || payload || {};
  return (
    s(source?.error_message).trim() ||
    s(source?.errorMessage).trim() ||
    s(source?.message).trim() ||
    s(source?.error).trim() ||
    status
  );
}

function getBlobPathname(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+/, "");
  } catch {
    return s(url).replace(/^\/+/, "").trim();
  }
}

function getPublicAssetBaseUrl() {
  return s(process.env.OAUTH_SERVER_URL).trim() || "https://mvstudiopro.com";
}

/**
 * 取当前登录用户；无 cookie / 校验失败一律返回 null（不抛），供各 op 做登录闸门。
 *
 * `sdk.authenticateRequest` 在缺 cookie 时是 **throw ForbiddenError**（不是返回 null），
 * 所以这里必须包 try/catch，否则未登录请求会变成 500。
 */
async function resolveJobUser(
  req: VercelRequest,
): Promise<{ userId: number; role: string } | null> {
  try {
    const { sdk } = await import("../server/_core/sdk.js");
    const user = await sdk.authenticateRequest(req as any, { silentMissing: true });
    const userId = Number((user as any)?.id);
    if (!Number.isFinite(userId) || userId <= 0) return null;
    return { userId, role: String((user as any)?.role || "") };
  } catch {
    return null;
  }
}

/**
 * 画布成片扣费：验登录 → 预检余额 → 扣 → 跑 → 失败退回。
 *
 * 此前 `/canvas` 与漫剧编剧室的成片**一分钱不收**（本文件从无扣费、画布前端也没扣），
 * 一集 4–6 段等于白烧上游账单。这里统一收口在服务端，前端绕不过去。
 *
 * - supervisor / admin 免扣（内部验收），与 `server/jobs/runner.ts` 的成长营口径一致。
 * - 自动重试不会重复扣：失败即退回，只有真正出片的那次留下扣款。
 * - 探针请求（`probe=1`）由调用方决定是否走这里，默认不扣。
 */
type CanvasVideoChargeOpts = {
  /** 成片秒数，决定 15 秒档还是加长档 */
  durationSec?: number | null;
  /** 漫剧集号：有值即按整集折算段价 */
  episodeIndex?: unknown;
  /** 账本描述后缀，便于对账 */
  label: string;
  /** 探针请求（`probe=1`）：脚本没有 cookie，既不验登录也不扣费 */
  skipCharge?: boolean;
  /**
   * 客户端幂等键：会以 [chargeKey:…] 埋进扣费描述。重试请求先按标记查账，
   * 查到（上一次扣完费在建任务前崩了）就直接复用那笔扣费，不再扣第二次。
   */
  idempotencyKey?: string;
  /** 输出分辨率：1080p 单价是 720p 的 2.25 倍 */
  resolution?: string | null;
  /**
   * 成片引擎。只有 Mini 草稿档要靠它分流到单独一个价（39 / 整集段 28）；
   * 其余引擎不传也不影响，仍按时长与画质分档。
   */
  videoModel?: string | null;
  /** 首页照片人物动起来按秒计费；缺省保持原画布分档计费。 */
  pricingMode?: "canvas" | "homePhotoAnimate";
};

/** 只扣费、立刻返回；异步成片用。失败路径由 canvasVideoTask 退款。 */
/** 幂等键 → 扣费标记：进扣费描述（creditTransactions / stripeUsageLogs 均可查） */
function chargeMarkerFor(userId: number, idempotencyKey: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${userId}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 24);
  return `[chargeKey:${hash}]`;
}

/** 查这笔幂等扣费是否已入账（上一次「扣费成功→建任务前」崩溃的补救线） */
async function findPriorChargeByMarker(
  userId: number,
  marker: string,
): Promise<{ credits: number; deduct: PaidJobDeductSnapshot } | null> {
  try {
    const { getDb } = await import("../server/db.js");
    const db = await getDb();
    if (!db) return null;
    const { stripeUsageLogs } = await import("../drizzle/schema.js");
    const { and, eq, like } = await import("drizzle-orm");
    const [row] = await db
      .select({
        creditsCost: stripeUsageLogs.creditsCost,
        metadata: stripeUsageLogs.metadata,
      })
      .from(stripeUsageLogs)
      .where(and(eq(stripeUsageLogs.userId, userId), like(stripeUsageLogs.description, `%${marker}%`)))
      .limit(1);
    if (!row) return null;
    let deduct: PaidJobDeductSnapshot = { source: "personal" };
    try {
      const meta = JSON.parse(String(row.metadata || "{}")) as {
        source?: string;
        teamId?: number;
        memberId?: number;
      };
      if (meta.source === "team" && meta.teamId != null && meta.memberId != null) {
        deduct = { source: "team", teamId: meta.teamId, teamMemberId: meta.memberId };
      }
    } catch {
      // metadata 缺失/损坏按个人来源处理
    }
    return { credits: Math.max(0, Number(row.creditsCost) || 0), deduct };
  } catch (e: any) {
    console.warn(`[chargeCanvasVideoCredits] findPriorChargeByMarker 查询失败：${e?.message}`);
    return null;
  }
}

async function chargeCanvasVideoCredits(
  req: VercelRequest,
  opts: CanvasVideoChargeOpts,
): Promise<
  | {
      ok: true;
      credits: number;
      userId: number;
      deduct?: PaidJobDeductSnapshot;
      alreadyCharged?: boolean;
      /** 幂等扣费 marker（有 idempotencyKey 时）；创建失败退款用它做稳定 refund jobId */
      chargeKey?: string;
    }
  | { ok: false; status: number; error: string }
> {
  if (opts.skipCharge) {
    const viewer = await resolveJobUser(req);
    return { ok: true, credits: 0, userId: viewer?.userId ?? 0 };
  }
  const viewer = await resolveJobUser(req);
  if (!viewer) return { ok: false, status: 401, error: "请先登录后再生成成片" };

  /**
   * 成片一律限正式会员（用户 2026-08-05 明文：不开放给邀请码用户）。
   * 邀请码兑换的只是积分，plan 仍是 free，有余额也不放行。
   */
  const { resolvePaidVideoAccess } = await import("../shared/paidVideoAccess.js");
  const { getUserPlan } = await import("../server/credits.js");
  const plan = await getUserPlan(viewer.userId).catch(() => "free");
  const access = resolvePaidVideoAccess({ plan: String(plan || "free"), role: viewer.role });
  if (!access.allowed) {
    return { ok: false, status: 403, error: access.message || "成片功能仅向正式会员开放" };
  }

  const episodeIndex = Number(opts.episodeIndex);
  const isEpisodeSegment = Number.isFinite(episodeIndex) && episodeIndex > 0;
  let credits: number;
  if (opts.pricingMode === "homePhotoAnimate") {
    const {
      HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION,
      homePhotoAnimateCredits,
      isHomePhotoAnimateDuration,
      isHomePhotoAnimateResolution,
    } = await import("../shared/homePhotoTools.js");
    if (!isHomePhotoAnimateDuration(opts.durationSec)) {
      return { ok: false, status: 400, error: "照片动起来只支持 5、10 或 15 秒" };
    }
    const resolution = isHomePhotoAnimateResolution(opts.resolution)
      ? opts.resolution
      : HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION;
    credits = homePhotoAnimateCredits(opts.durationSec, resolution);
  } else {
    const { canvasVideoClipCredits } = await import("../shared/canvasGenerationPricing.js");
    credits = canvasVideoClipCredits({
      durationSec: opts.durationSec ?? undefined,
      isEpisodeSegment,
      resolution: opts.resolution ?? undefined,
      videoModel: opts.videoModel ?? undefined,
    });
  }

  const idemKey = String(opts.idempotencyKey || "").trim();
  const marker = idemKey ? chargeMarkerFor(viewer.userId, idemKey) : "";
  if (marker) {
    const prior = await findPriorChargeByMarker(viewer.userId, marker);
    if (prior) {
      return {
        ok: true,
        credits: prior.credits,
        userId: viewer.userId,
        deduct: prior.deduct,
        alreadyCharged: true,
        chargeKey: marker,
      };
    }
  }

  const { deductCreditsAmount, InsufficientCreditsError } = await import("../server/credits.js");
  try {
    const action = opts.pricingMode === "homePhotoAnimate" ? "homePhotoAnimate" : "canvasVideoClip";
    const out = await deductCreditsAmount(
      viewer.userId,
      credits,
      action,
      marker ? `${opts.label} ${marker}` : opts.label,
      // DB 唯一索引兜底：SELECT-再-扣 的 TOCTOU（旧执行超时未取消 vs 重排执行并跑）
      marker ? { chargeKey: marker } : undefined,
    );
    return {
      ok: true,
      credits: out.cost,
      userId: viewer.userId,
      deduct: {
        source: out.source,
        teamId: "teamId" in out ? out.teamId : undefined,
        teamMemberId: "teamMemberId" in out ? out.teamMemberId : undefined,
      },
      chargeKey: marker || undefined,
    };
  } catch (error) {
    // 只有真·余额不足才回 402；其余异常（DB 抖动等）是「扣费未执行」，
    // 伪装成 402 会误导用户充值，且重试语义完全不同
    if (error instanceof InsufficientCreditsError) {
      return {
        ok: false,
        status: 402,
        error: `积分不足：本段成片需要 ${credits} 积分，请补充积分后重试`,
      };
    }
    console.error("[chargeCanvasVideoCredits] deduct failed (not charged):", error);
    return {
      ok: false,
      status: 503,
      error: "扣费服务暂不可用，本次未扣费，请稍后重试",
    };
  }
}

/**
 * 成片任务「已扣费、创建失败」的统一退款（第七轮 P0·1 重写）。
 * 两段独立处理，禁止一个大 catch：
 *   1) 注册 hold 失败（hold 明确不存在）→ 允许按 deduct 同源直退，
 *      退款认领键 = canonicalRefundKey（与账本同一把）——即使注册"写成功但返回异常"，
 *      之后 reaper 对同一 hold 退款也因同键 DB 唯一认领只会到账一次；
 *   2) hold 已注册、账本退款失败 → 绝不直退，保持 active/refund_pending 交给 reaper 对账。
 * chargeKey 存在时 jobId 稳定：重试复用旧扣费又失败，不会重复退。
 */
async function refundCanvasChargeOnCreateFail(
  charged: { userId: number; credits: number; deduct?: PaidJobDeductSnapshot; chargeKey?: string },
  label: string,
  reasonSuffix = "创建失败退回",
): Promise<"refunded" | "pending" | "failed" | "skipped"> {
  if (!(charged.credits > 0)) return "skipped";
  const d = charged.deduct;
  if (d?.source === "admin" || d?.source === "none") return "skipped";

  const { registerActiveJob, refundCreditsOnFailure, refundMarkerFor, canonicalRefundKey } =
    await import("../server/services/paidJobLedger.js");
  const { createHash } = await import("node:crypto");
  const jobId = charged.chargeKey
    ? `cf_${createHash("sha256").update(charged.chargeKey).digest("hex").slice(0, 24)}`
    : `cf_${Date.now().toString(36)}_${createHash("sha256").update(`${label}:${Math.random()}`).digest("hex").slice(0, 12)}`;
  const marker = refundMarkerFor("canvasVideoCreateFail", jobId);
  const refundKey = canonicalRefundKey("canvasVideoCreateFail", jobId);
  const reason = `${label}·${reasonSuffix} ${marker}`;

  // 同源直退（个人/团队都走同一把 canonical 认领键）
  const refundDirectSameSource = async (): Promise<void> => {
    const { refundCredits, refundCreditsForDeductAmount } = await import("../server/credits.js");
    if (d?.source === "team" && d.teamId != null && d.teamMemberId != null) {
      await refundCreditsForDeductAmount(
        charged.userId,
        reason,
        {
          success: true,
          cost: charged.credits,
          remainingBalance: -1,
          source: "team",
          teamId: d.teamId,
          teamMemberId: d.teamMemberId,
        } as Awaited<ReturnType<typeof import("../server/credits.js")["deductCreditsAmount"]>>,
        label,
        { refundKey },
      );
      return;
    }
    await refundCredits(charged.userId, charged.credits, reason, { refundKey });
  };

  // 第一段：只管注册 hold
  try {
    await registerActiveJob({
      jobId,
      taskType: "canvasVideoCreateFail",
      userId: charged.userId,
      creditsBilled: charged.credits,
      action: `${label}·${reasonSuffix}`.slice(0, 80),
      deduct: d,
    });
  } catch (registerError) {
    console.error(`[canvasVideo] create-fail hold 注册失败，转同源直退 label=${label}`, registerError);
    try {
      await refundDirectSameSource();
      return "refunded";
    } catch (directError) {
      console.error(`[canvasVideo] create-fail 直退也失败（需人工对账）label=${label}`, directError);
      return "failed";
    }
  }

  // 第二段：账本两阶段退款；失败绝不直退（hold 已在，reaper 会对账补偿）
  try {
    const out = await refundCreditsOnFailure(
      jobId,
      "canvasVideoCreateFail",
      "task_failed",
      `${label}·${reasonSuffix}`,
    );
    if (out.refunded || out.status === "refunded" || out.status === "settled") return "refunded";
    return "pending";
  } catch (ledgerError) {
    console.error(
      `[canvasVideo] create-fail 账本退款未完成（hold 已注册，等 reaper 对账）jobId=${jobId}`,
      ledgerError,
    );
    return "pending";
  }
}

async function chargeCanvasVideoAndRun<T>(
  req: VercelRequest,
  opts: CanvasVideoChargeOpts,
  work: () => Promise<T>,
): Promise<{ ok: true; result: T; credits: number } | { ok: false; status: number; error: string }> {
  if (opts.skipCharge) return { ok: true, result: await work(), credits: 0 };
  const charged = await chargeCanvasVideoCredits(req, opts);
  if (!charged.ok) return charged;
  try {
    return { ok: true, result: await work(), credits: charged.credits };
  } catch (err) {
    let refundFailed = false;
    if (charged.credits > 0) {
      const refundOutcome = await refundCanvasChargeOnCreateFail(charged, opts.label, "生成失败退回");
      refundFailed = refundOutcome === "failed";
      if (opts.pricingMode === "homePhotoAnimate") {
        if (refundFailed) {
          throw new Error("照片动画生成失败；积分退款处理异常，请联系客服核对");
        }
        if (refundOutcome === "pending") {
          throw new Error("照片动画生成失败，退款处理中，将自动补退");
        }
        if (charged.credits > 0) {
          throw new Error("照片动画生成失败，积分已自动退回");
        }
      }
    }
    if (opts.pricingMode === "homePhotoAnimate") {
      throw new Error("照片动画生成失败，请稍后重试");
    }
    throw err;
  }
}

/** Seedance 2.5：正式上线后仍只向正式会员（pro/enterprise）开放。 */
async function assertSeedance25PaidAccess(
  req: VercelRequest,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { resolveSeedance25Access } = await import("../shared/seedance25Access.js");
  try {
    const { sdk } = await import("../server/_core/sdk.js");
    const user = await sdk.authenticateRequest(req as any, { silentMissing: true });
    const userId = Number((user as any)?.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      return { ok: false, status: 401, error: "请先登录后再使用 Seedance 2.5" };
    }
    const role = String((user as any)?.role || "");
    const { getUserPlan } = await import("../server/credits.js");
    const plan = await getUserPlan(userId);
    const access = resolveSeedance25Access({ plan, role });
    if (!access.allowed) {
      return {
        ok: false,
        status: access.reason === "before_launch" ? 503 : 403,
        error: access.message || "Seedance 2.5 暂不可用",
      };
    }
    return { ok: true };
  } catch (e: any) {
    const msg = String(e?.message || e || "");
    if (/Invalid session|Forbidden|Unauthorized|未登录|登录/i.test(msg)) {
      return { ok: false, status: 401, error: "请先登录后再使用 Seedance 2.5" };
    }
    throw e;
  }
}

/**
 * Seedance 2.5 五模式共用主链：契约预检 → 服务配置 → 服务端计费 → 异步落盘任务。
 * 两个历史 API 入口都必须调用这里，避免 `/canvas` 与兼容入口再次分叉。
 */
async function runSeedance25EvolinkJob(
  req: VercelRequest,
  body: any,
  query: any,
  labelPrefix: string,
): Promise<
  | { ok: false; status: number; error: string; paidOnly?: boolean }
  | {
      ok: true;
      async: true;
      taskId: string;
      status: string;
      credits: number;
      resolution: "480p" | "720p" | "1080p";
      duration: number;
      workMode: string;
      videoUrl?: string;
      provider?: string;
    }
> {
  const access = await assertSeedance25PaidAccess(req);
  if (!access.ok) return { ...access, paidOnly: true };

  const prompt =
    s(body.prompt || query.prompt || "").trim() ||
    "Cinematic motion shot with stable camera and rich detail.";
  const imageUrl = s(body.imageUrl || query.imageUrl || "").trim() || undefined;
  const imageUrls = Array.isArray(body.imageUrls)
    ? body.imageUrls.map((url: unknown) => s(url).trim()).filter(Boolean)
    : [];
  const videoUrls = Array.isArray(body.videoUrls)
    ? body.videoUrls.map((url: unknown) => s(url).trim()).filter(Boolean)
    : [];
  const audioUrls = Array.isArray(body.audioUrls)
    ? body.audioUrls.map((url: unknown) => s(url).trim()).filter(Boolean)
    : [];
  const {
    clampSeedanceDuration,
    normalizeSeedance25EvolinkMode,
    normalizeSeedanceQuality,
    SEEDANCE_EVOLINK_CONTENT_FILTER,
  } = await import("../shared/seedanceEvolinkModels.js");
  const mode = normalizeSeedance25EvolinkMode(body.workMode || query.workMode, {
    imageUrls: [...(imageUrl ? [imageUrl] : []), ...imageUrls],
    videoUrls,
    audioUrls,
  });
  const rawDuration = body.duration ?? query.duration ?? body.durationSec ?? 15;
  // extend 官方支持 -1 自动（跟内容走）；显式时长 4–30s。原实现把 -1 clamp 成 4，自动档不可达
  const wantsAutoDuration =
    Number(rawDuration) === -1 || String(rawDuration).trim().toLowerCase() === "auto";
  /**
   * edit 产出与主片等长：时长由服务端 ffprobe 亲测远程主片，
   * 客户端传值（editSourceDurationSec）一律不信——可被改成 1s 把
   * 30s 编辑压成最低价（2026-08-11 审计 P0 高风险）。
   * 探测失败按 clamp 上限 30s 报价：fail-closed，宁多勿漏；
   * 多收的部分产出短于报价时走既有对账退款路径。
   */
  let editSourceSec = 0;
  if (mode === "video_edit") {
    const mainVideoUrl = String(videoUrls?.[0] || "").trim();
    if (/^https:\/\//i.test(mainVideoUrl)) {
      try {
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const probe = await promisify(execFile)(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            mainVideoUrl,
          ],
          { timeout: 15_000 },
        );
        const parsed = Number(String(probe.stdout || "").trim());
        if (Number.isFinite(parsed) && parsed > 0) {
          editSourceSec = Math.max(1, Math.round(parsed));
        }
      } catch {
        // 探测不到就走上限，不回落到客户端值
      }
    }
    if (!editSourceSec) editSourceSec = 30;
  }
  const duration = clampSeedanceDuration(
    "2.5",
    mode === "video_edit" && editSourceSec > 0
      ? editSourceSec
      : wantsAutoDuration
        ? mode === "video_extend"
          ? 5 // 官方 extend 自动档默认产出 5s，计费按 5 不多收
          : 15
        : rawDuration,
  );
  const providerDuration =
    mode === "video_edit" ? -1 : mode === "video_extend" && wantsAutoDuration ? -1 : duration;
  const resolution = normalizeSeedanceQuality(
    "2.5",
    body.resolution || query.resolution || "720p",
  );
  const aspectRatio = s(body.aspectRatio || query.aspectRatio || "16:9").trim() || "16:9";
  const generateAudio = !(
    String(body.generateAudio ?? query.generateAudio ?? "1").trim() === "0" ||
    body.generateAudio === false
  );
  const {
    buildEvolinkSeedanceRequest,
    isEvolinkSeedanceConfigured,
  } = await import("../server/services/evolinkSeedanceVideo.js");
  const {
    buildByteplusSeedance25SubmitBody,
    isByteplusSeedanceConfigured,
  } = await import("../server/services/byteplusSeedanceVideo.js");
  const { resolveSeedance25CanvasEngine } = await import(
    "../server/services/canvasVideoTask.js"
  );
  const { hasPhotorealReferenceUrl } = await import("../shared/photorealMediaSignal.js");
  const preferByteplus = isByteplusSeedanceConfigured();
  // 仿真人（photoreal 素材信号）只能走 EvoLink：BytePlus 拦真人照参考。
  // 有 BytePlus 没 EvoLink 时不能扣费后必败，扣费前 503。
  const isPhotorealRequest = hasPhotorealReferenceUrl([imageUrl, ...imageUrls, ...videoUrls]);
  if (isPhotorealRequest && !isEvolinkSeedanceConfigured()) {
    return { ok: false, status: 503, error: "仿真人通道暂不可用，请稍后重试" };
  }
  if (!preferByteplus && !isEvolinkSeedanceConfigured()) {
    return { ok: false, status: 503, error: "视频服务暂不可用，请稍后重试" };
  }

  const runInput = {
    prompt,
    imageUrl,
    imageUrls,
    videoUrls,
    audioUrls,
    quality: resolution,
    aspectRatio,
    duration: providerDuration,
    generateAudio,
    contentFilter: SEEDANCE_EVOLINK_CONTENT_FILTER,
    mode,
    version: "2.5" as const,
  };
  try {
    // 扣费前先跑纯函数契约验证，缺素材不应经历“先扣再退”。
    if (preferByteplus) {
      buildByteplusSeedance25SubmitBody({
        prompt,
        imageUrl,
        imageUrls,
        videoUrls,
        audioUrls,
        aspectRatio,
        duration: providerDuration === -1 ? 15 : providerDuration,
        resolution,
        generateAudio,
        watermark: false,
        mode,
      });
      // 预校验 EvoLink 契约，保证 BytePlus 失败时可无感回落
      if (isEvolinkSeedanceConfigured()) {
        buildEvolinkSeedanceRequest(runInput);
      }
    } else {
      buildEvolinkSeedanceRequest(runInput);
    }
  } catch (error: any) {
    return { ok: false, status: 400, error: error?.message || "Seedance 2.5 请求参数无效" };
  }

  const modeLabel = {
    text_to_video: "文生视频",
    image_to_video: "图生视频",
    reference_to_video: "多模态参考生成",
    video_edit: "视频编辑",
    video_extend: "视频延长",
  }[mode];
  const label = `${labelPrefix}·${modeLabel}（${duration}s）`;
  try {
    // 第五轮复审 P0·6：稳定请求键——客户端带则用客户端的（跨重试稳定），
    // 缺省服务端生成（至少保证本次扣费与其退款/任务稳定关联）
    const requestKey =
      String((body as Record<string, unknown>).idempotencyKey || "").trim() ||
      `srv25_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
    const charged = await chargeCanvasVideoCredits(req, {
      durationSec: duration,
      episodeIndex: body.episodeIndex,
      label,
      idempotencyKey: requestKey,
    });
    if (!charged.ok) return charged;

    const { createCanvasVideoTask } = await import("../server/services/canvasVideoTask.js");
    try {
      const task = await createCanvasVideoTask({
        userId: charged.userId,
        creditsCharged: charged.credits,
        deduct: charged.deduct,
        idempotencyKey: requestKey,
        engine: resolveSeedance25CanvasEngine(mode, {
          // 共享信号（覆盖 photoreal-age/、photoreal-gen/ 等派生路径），与 2.0 路由同口径；
          // EvoLink 缺配置的 photoreal 已在扣费前 503，这里选中 EvoLink 引擎必有配置
          photoreal: isPhotorealRequest,
        }),
        label,
        prompt,
        imageUrl,
        imageUrls,
        videoUrls,
        audioUrls,
        aspectRatio,
        duration: providerDuration,
        resolution,
        generateAudio,
        workMode: mode,
      });
      return {
        ok: true,
        async: true,
        taskId: task.taskId,
        status: task.status,
        credits: charged.credits,
        resolution,
        duration,
        workMode: mode,
        videoUrl: task.videoUrl,
        provider: task.provider || (preferByteplus ? "byteplus" : "evolink"),
      };
    } catch (error: any) {
      const refundOutcome = await refundCanvasChargeOnCreateFail(charged, label);
      if (error instanceof Error && refundOutcome !== "skipped") {
        error.message +=
              refundOutcome === "refunded"
                ? "（费用已退回）"
                : refundOutcome === "pending"
                  ? "（退款处理中，将自动补退）"
                  : "（退款受阻已记录，需人工对账）";
      }
      throw error;
    }
  } catch (error: any) {
    return { ok: false, status: 502, error: error?.message || "seedance25_failed" };
  }
}

function buildBlobMediaUrlFromPath(pathname: string) {
  const normalized = s(pathname).replace(/^\/+/, "").trim();
  if (!normalized) return "";
  return `${getPublicAssetBaseUrl()}/api/jobs?op=blobMedia&blobPath=${encodeURIComponent(normalized)}`;
}

async function proxyBlobAssetByPath(pathname: string) {
  const normalizedPath = s(pathname).replace(/^\/+/, "").trim();
  if (!normalizedPath) throw new Error("blobPath is required");
  const tokens = Array.from(
    new Set(
      [
        env.mvspReadWriteToken,
        process.env.MVSP_READ_WRITE_TOKEN,
        process.env.BLOB_READ_WRITE_TOKEN,
      ].map((value) => s(value).trim()).filter(Boolean),
    ),
  );
  if (!tokens.length) throw new Error("MVSP_READ_WRITE_TOKEN is required for blob proxy");
  const errors: string[] = [];

  for (const token of tokens) {
    try {
      const byPath = await get(normalizedPath, { token, access: "public" });
      const statusCode = byPath?.statusCode ?? 0;
      if (byPath && statusCode === 200 && byPath.stream) {
        return {
          buffer: Buffer.from(await new Response(byPath.stream).arrayBuffer()),
          contentType: byPath.blob.contentType || "application/octet-stream",
          cacheControl: byPath.blob.cacheControl || "public, max-age=300",
        };
      }
      errors.push(`get-path:${statusCode}`);
    } catch (error: any) {
      errors.push(`get-path:${error?.message || String(error)}`);
    }
  }

  throw new Error(`blob_path_proxy_failed:${errors.join("|")}`);
}

async function proxyBlobAsset(url: string) {
  const target = s(url).trim();
  if (!target) throw new Error("url is required");
  if (!/\.blob\.vercel-storage\.com\//i.test(target)) {
    const response = await fetch(target, { redirect: "follow" });
    if (!response.ok) throw new Error(`asset_fetch_failed:${response.status}`);
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") || "application/octet-stream",
      cacheControl: response.headers.get("cache-control") || "public, max-age=300",
    };
  }
  const tokens = Array.from(
    new Set(
      [
        env.mvspReadWriteToken,
        process.env.MVSP_READ_WRITE_TOKEN,
        process.env.BLOB_READ_WRITE_TOKEN,
      ].map((value) => s(value).trim()).filter(Boolean),
    ),
  );
  if (!tokens.length) throw new Error("MVSP_READ_WRITE_TOKEN is required for blob proxy");
  const errors: string[] = [];

  for (const token of tokens) {
    try {
      const direct = await fetch(target, {
        headers: { authorization: `Bearer ${token}` },
        redirect: "follow",
      });
      if (direct.ok) {
        return {
          buffer: Buffer.from(await direct.arrayBuffer()),
          contentType: direct.headers.get("content-type") || "application/octet-stream",
          cacheControl: direct.headers.get("cache-control") || "public, max-age=300",
        };
      }
      errors.push(`direct:${direct.status}`);
    } catch (error: any) {
      errors.push(`direct:${error?.message || String(error)}`);
    }

    try {
      const byUrl = await get(target, { token, access: "public" });
      const statusCode = byUrl?.statusCode ?? 0;
      if (byUrl && statusCode === 200 && byUrl.stream) {
        return {
          buffer: Buffer.from(await new Response(byUrl.stream).arrayBuffer()),
          contentType: byUrl.blob.contentType || "application/octet-stream",
          cacheControl: byUrl.blob.cacheControl || "public, max-age=300",
        };
      }
      errors.push(`get-url:${statusCode}`);
    } catch (error: any) {
      errors.push(`get-url:${error?.message || String(error)}`);
    }

    try {
      const byPath = await get(getBlobPathname(target), { token, access: "public" });
      const statusCode = byPath?.statusCode ?? 0;
      if (byPath && statusCode === 200 && byPath.stream) {
        return {
          buffer: Buffer.from(await new Response(byPath.stream).arrayBuffer()),
          contentType: byPath.blob.contentType || "application/octet-stream",
          cacheControl: byPath.blob.cacheControl || "public, max-age=300",
        };
      }
      errors.push(`get-path:${statusCode}`);
    } catch (error: any) {
      errors.push(`get-path:${error?.message || String(error)}`);
    }
  }

  throw new Error(`blob_proxy_failed:${errors.join("|")}`);
}

function callGeminiScriptGateway(prompt: string) {
  return callGoogleGateway({ op: "geminiScript", prompt });
}

function normalizeStructuredStoryboard(input: {
  rawScenes: any;
  targetScenes: number;
  sceneDuration: number;
  topic: string;
  mainCharacter?: any;
}) {
  const targetScenes = Math.max(1, Math.min(12, Number(input.targetScenes || 0) || 6));
  const sceneDuration = Math.max(1, Number(input.sceneDuration || 0) || 5);
  const src = Array.isArray(input.rawScenes) ? input.rawScenes : [];
  const mainAppearance = s(input.mainCharacter?.appearance).trim();
  const mainOutfit = s(input.mainCharacter?.outfit).trim();
  const out: WorkflowStoryboardScene[] = [];
  for (let i = 0; i < targetScenes; i += 1) {
    const item = src[i] || {};
    const character = s(item?.character).trim() || [mainAppearance, mainOutfit].filter(Boolean).join(", ");
    out.push({
      sceneIndex: i + 1,
      sceneTitle: s(item?.sceneTitle).trim() || `Scene ${i + 1}`,
      scenePrompt: sanitizeScenePrompt(item?.scenePrompt, i + 1, input.topic),
      environment: s(item?.environment).trim() || "cinematic environment",
      character: character || "same main character identity",
      duration: sceneDuration,
      camera: s(item?.camera || "medium").trim() || "medium",
      mood: s(item?.mood || "cinematic").trim() || "cinematic",
      lighting: s(item?.lighting || "dramatic lighting").trim() || "dramatic lighting",
      action: s(item?.action || "character-driven cinematic action").trim() || "character-driven cinematic action",
    });
  }
  return out;
}

async function generateScriptViaPromptBuilder(input: {
  prompt: string;
  targetWords?: number;
  targetScenes?: number;
  sceneDuration?: number;
}) {
  const prompt = s(input.prompt).trim();
  const targetWords = Number(input.targetWords || 0) || 900;
  const targetScenes = Number(input.targetScenes || 0) || 6;
  const sceneDuration = Number(input.sceneDuration || 0) || 5;
  if (!prompt) throw new Error("prompt is required");

  const scriptPrompt = buildScriptPrompt({ prompt, targetWords, targetScenes, sceneDuration });
  const scriptResult = await callGeminiScriptGateway(scriptPrompt);
  if (scriptResult?.ok !== true) {
    throw new Error(s(scriptResult?.message || scriptResult?.error || "gemini_script_failed") || "gemini_script_failed");
  }
  const script = stripJsonFence(extractGoogleText(scriptResult?.raw));
  if (!script) throw new Error("empty_script");

  const storyboardPrompt = buildStoryboardPrompt({
    prompt,
    script,
    targetScenes,
    sceneDuration,
  });
  const storyboardResult = await callGeminiScriptGateway(storyboardPrompt);
  if (storyboardResult?.ok !== true) {
    throw new Error(s(storyboardResult?.message || storyboardResult?.error || "gemini_storyboard_failed") || "gemini_storyboard_failed");
  }
  const storyboardText = stripJsonFence(extractGoogleText(storyboardResult?.raw));
  const parsed = jparse(storyboardText);
  if (!parsed || typeof parsed !== "object") throw new Error("gemini_storyboard_invalid_json");

  const storyboard = normalizeStructuredStoryboard({
    rawScenes: (parsed as any).scenes,
    targetScenes,
    sceneDuration,
    topic: prompt,
    mainCharacter: (parsed as any).mainCharacter,
  });
  return {
    script,
    storyboard,
    provider: "google-vertex",
    model: s(process.env.VERTEX_GEMINI_MODEL || "gemini-3.1-pro-preview").trim() || "gemini-3.1-pro-preview",
  };
}

async function generateScriptOnlyViaPromptBuilder(input: {
  prompt: string;
  targetWords?: number;
  targetScenes?: number;
  sceneDuration?: number;
}) {
  const scriptPrompt = buildScriptPrompt(input);
  const scriptResult = await callGeminiScriptGateway(scriptPrompt);
  if (scriptResult?.ok !== true) {
    throw new Error(s(scriptResult?.message || scriptResult?.error || "gemini_script_failed") || "gemini_script_failed");
  }
  const script = stripJsonFence(extractGoogleText(scriptResult?.raw));
  if (!script) throw new Error("empty_script");
  return {
    script,
    provider: "google-vertex",
    model: s(process.env.VERTEX_GEMINI_MODEL || "gemini-3.1-pro-preview").trim() || "gemini-3.1-pro-preview",
  };
}

function createServerWorkflowTask(input: {
  sourceType: string;
  inputType?: "script" | "image";
  prompt: string;
  imageUrl?: string;
  targetWords?: number;
  targetScenes?: number;
}) {
  const inputType = input.inputType === "image" ? "image" : "script";
  const now = Date.now();
  const task: WorkflowTask = {
    workflowId: randomUUID(),
    sourceType: input.sourceType || "workflow",
    inputType,
    payload: {
      prompt: input.prompt,
      imageUrl: s(input.imageUrl).trim(),
      targetWords: input.targetWords,
      targetScenes: input.targetScenes,
    },
    currentStep: inputType === "image" ? "image" : "script",
    status: "pending",
    outputs: {},
    createdAt: now,
    updatedAt: now,
  } as WorkflowTask;
  return task;
}

function fail(error: string, message?: string, extra?: Record<string, any>) {
  return {
    ok: false,
    error,
    message: message || error,
    ...(extra || {}),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const q: any = req.query || {};
    const b: any = req.method === "POST" ? getBody(req) : {};
    const queryOp =
      s(q.op).trim() ||
      s(q.OP).trim() ||
      s(q.Op).trim() ||
      s(q.oP).trim();
    const bodyOp = s(b.op || b.OP || b.Op || b.oP).trim();
    const op = queryOp || bodyOp;
    const opNormalized = op.toLowerCase();
    if (!op) return res.status(400).json({ ok: false, error: "missing_op" });

    const KLING_BASE = (s(process.env.KLING_CN_BASE_URL) || "https://api-beijing.klingai.com").replace(/\/+$/, "");
    const COMET_KEY = getCometApiKey();
    const VAK = s(process.env.KLING_CN_VIDEO_ACCESS_KEY).trim();
    const VSK = s(process.env.KLING_CN_VIDEO_SECRET_KEY).trim();
    const IAK = s(process.env.KLING_CN_IMAGE_ACCESS_KEY).trim();
    const ISK = s(process.env.KLING_CN_IMAGE_SECRET_KEY).trim();

    const AIM_BASE = (s(process.env.AIMUSIC_BASE_URL) || "https://api.aimusicapi.ai").replace(/\/+$/, "");
    const AIM_KEY  = s(process.env.AIMUSIC_API_KEY || process.env.AIMUSICAPI_KEY).trim();

    if (opNormalized === "envstatus") {
      if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      return res.status(200).json({
        ok: true,
        env: getEnvStatus(),
      });
    }

    /**
     * 密钥探针（不回传密钥本身）：
     * - OpenRouter 生图：`POST /api/v1/images` · openai/gpt-image-2
     * - OpenAI 官方文案：`POST /v1/chat/completions` · gpt-5.6-sol
     * - OpenRouter 文案：`POST /api/v1/chat/completions` · openai/gpt-5.6-sol
     * - OpenAI 生图：gpt-image-2
     * which=sol → 同时打官方 Sol + OpenRouter Sol（跳过生图）
     */
    if (opNormalized === "probegptkeys") {
      if (req.method !== "POST" && req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const want = String(b.which || q.which || "all")
        .trim()
        .toLowerCase();
      const runOrImg = want === "all" || want === "openrouter" || want === "or";
      const runOpenAiChat =
        want === "all" || want === "openai_chat" || want === "sol" || want === "gpt56" || want === "openai_sol";
      const runOrChat =
        want === "all" ||
        want === "sol" ||
        want === "gpt56" ||
        want === "openrouter_sol" ||
        want === "or_sol" ||
        want === "openrouter_chat";
      const runImg = want === "all" || want === "openai_image" || want === "image";

      const out: Record<string, unknown> = { ok: true, at: new Date().toISOString() };

      if (runOrImg) {
        const t0 = Date.now();
        try {
          const { isOpenRouterGptImage2Configured, postOpenRouterGptImage2AndUpload } = await import(
            "../server/services/openrouterGptImage2.js"
          );
          const configured = isOpenRouterGptImage2Configured();
          if (!configured) {
            out.openrouter_image = { ok: false, configured: false, error: "OPENROUTER_API_KEY missing/invalid", ms: Date.now() - t0 };
          } else {
            const err: { message?: string } = {};
            const url = await postOpenRouterGptImage2AndUpload(
              "A simple red ceramic mug on a white table, soft studio light, no text.",
              "probe-openrouter",
              { aspectRatio: "9:16", quality: "low", captureError: err },
            );
            out.openrouter_image = {
              ok: Boolean(url),
              configured: true,
              ms: Date.now() - t0,
              imageUrlPrefix: url ? String(url).slice(0, 120) : null,
              error: err.message || null,
            };
          }
        } catch (e: any) {
          out.openrouter_image = { ok: false, error: e?.message || String(e), ms: Date.now() - t0 };
        }
      }

      if (runOpenAiChat) {
        const t0 = Date.now();
        const apiKey = String(process.env.OPENAI_API_KEY || process.env.OPENAI_CHAT_API_KEY || "").trim();
        const keyShape = !apiKey
          ? "missing"
          : /^sk-[A-Za-z0-9]/.test(apiKey)
            ? `sk…len=${apiKey.length}`
            : `invalid_shape len=${apiKey.length}`;
        if (!apiKey || !/^sk-[A-Za-z0-9]/.test(apiKey)) {
          out.openai_gpt56_sol = { ok: false, configured: false, keyShape, error: "OPENAI_API_KEY missing/invalid", ms: Date.now() - t0 };
        } else {
          try {
            const r = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "gpt-5.6-sol",
                messages: [{ role: "user", content: "Reply with exactly: pong" }],
                max_completion_tokens: 16,
              }),
              signal: AbortSignal.timeout(60_000),
            });
            const json: any = await r.json().catch(() => ({}));
            const text = String(json?.choices?.[0]?.message?.content || "").trim();
            out.openai_gpt56_sol = {
              ok: r.ok && Boolean(text),
              configured: true,
              keyShape,
              status: r.status,
              ms: Date.now() - t0,
              reply: text.slice(0, 80) || null,
              error: r.ok ? null : json?.error?.message || JSON.stringify(json).slice(0, 240),
            };
          } catch (e: any) {
            out.openai_gpt56_sol = { ok: false, configured: true, keyShape, error: e?.message || String(e), ms: Date.now() - t0 };
          }
        }
      }

      if (runOrChat) {
        const t0 = Date.now();
        const orKey = String(process.env.OPENROUTER_API_KEY || "").trim();
        const configured = Boolean(orKey && /^sk-[A-Za-z0-9]/.test(orKey));
        if (!configured) {
          out.openrouter_gpt56_sol = {
            ok: false,
            configured: false,
            error: "OPENROUTER_API_KEY missing/invalid",
            ms: Date.now() - t0,
          };
        } else {
          try {
            // 连通性测法：显式 HTTP-Referer / X-Title + 简短 Connection test（model 用 gpt-5.6-sol）
            const model = String(b.model || q.model || "gpt-5.6-sol").trim() || "gpt-5.6-sol";
            const referer = String(
              b.httpReferer || process.env.OPENROUTER_HTTP_REFERER || "https://your-drama-website.com",
            )
              .trim()
              .replace(/\/+$/, "");
            const title = String(
              b.xTitle || process.env.OPENROUTER_APP_TITLE || "Comic Drama Automation Workflow",
            ).trim() || "Comic Drama Automation Workflow";
            const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${orKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": referer,
                "X-Title": title,
              },
              body: JSON.stringify({
                model,
                messages: [{ role: "user", content: "Connection test. Please reply with only 'OK'." }],
              }),
              signal: AbortSignal.timeout(90_000),
            });
            const json: any = await r.json().catch(() => ({}));
            const text = String(json?.choices?.[0]?.message?.content || "").trim();
            out.openrouter_gpt56_sol = {
              ok: r.ok && Boolean(text),
              configured: true,
              model,
              httpReferer: referer,
              xTitle: title,
              status: r.status,
              ms: Date.now() - t0,
              reply: text.slice(0, 240) || null,
              error: r.ok ? null : json?.error?.message || JSON.stringify(json).slice(0, 240),
            };
          } catch (e: any) {
            out.openrouter_gpt56_sol = {
              ok: false,
              configured: true,
              error: e?.message || String(e),
              ms: Date.now() - t0,
            };
          }
        }
      }

      if (runImg) {
        const t0 = Date.now();
        try {
          const { isOpenAiGptImage2Configured, postOpenAiGptImage2AndUpload } = await import(
            "../server/services/openaiGptImage2.js"
          );
          const configured = isOpenAiGptImage2Configured();
          if (!configured) {
            out.openai_gpt_image2 = { ok: false, configured: false, error: "OPENAI_IMAGE/API_KEY missing/invalid", ms: Date.now() - t0 };
          } else {
            const err: { message?: string } = {};
            const url = await postOpenAiGptImage2AndUpload(
              "A simple red ceramic mug on a white table, soft studio light, no text.",
              "probe-openai-image",
              { aspectRatio: "9:16", quality: "low", captureError: err },
            );
            out.openai_gpt_image2 = {
              ok: Boolean(url),
              configured: true,
              ms: Date.now() - t0,
              imageUrlPrefix: url ? String(url).slice(0, 120) : null,
              error: err.message || null,
            };
          }
        } catch (e: any) {
          out.openai_gpt_image2 = { ok: false, error: e?.message || String(e), ms: Date.now() - t0 };
        }
      }

      const fails = ["openrouter_image", "openai_gpt56_sol", "openrouter_gpt56_sol", "openai_gpt_image2"].filter(
        (k) => out[k] && (out[k] as { ok?: boolean }).ok === false,
      );
      out.ok = fails.length === 0;
      out.failed = fails;
      return res.status(fails.length ? 502 : 200).json(out);
    }

    /**
     * Responses API 探针：`POST /v1/responses` · gpt-5.6-sol
     * which=pro → reasoning.mode=pro；默认 standard；store=false
     */
    if (opNormalized === "proberesponses") {
      if (req.method !== "POST" && req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const which = String(b.which || q.which || "standard")
        .trim()
        .toLowerCase();
      const usePro = which === "pro" || which === "gpt56pro";
      const t0 = Date.now();
      try {
        const { getOfficialOpenAiApiKey } = await import("../server/services/gpt56CopywritingGateway.js");
        const { invokeGpt56Responses } = await import("../server/services/gpt56ResponsesClient.js");
        const key = getOfficialOpenAiApiKey();
        if (!key) {
          return res.status(200).json({
            ok: false,
            configured: false,
            error: "OPENAI_API_KEY missing/invalid",
            ms: Date.now() - t0,
          });
        }
        const r = await invokeGpt56Responses({
          input: "Reply with exactly: pong",
          reasoningMode: usePro ? "pro" : "standard",
          reasoningEffort: "medium",
          store: false,
          fallbackChatCompletions: false,
          timeoutMs: 90_000,
        });
        return res.status(200).json({
          ok: Boolean(r.text),
          configured: true,
          via: r.via,
          reasoningMode: r.reasoningMode,
          reply: String(r.text || "").slice(0, 80),
          responseId: r.responseId || null,
          ms: Date.now() - t0,
        });
      } catch (e: any) {
        return res.status(502).json({
          ok: false,
          configured: true,
          error: e?.message || String(e),
          ms: Date.now() - t0,
        });
      }
    }

    /** IA 参谋：产出 /platform 主次 UI 文案简报（Responses Pro） */
    if (opNormalized === "platformiabrief") {
      if (req.method !== "POST" && req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const t0 = Date.now();
      try {
        const { invokeGpt56ResponsesText } = await import("../server/services/gpt56ResponsesClient.js");
        const markdown = await invokeGpt56ResponsesText({
          reasoningMode: "pro",
          reasoningEffort: "medium",
          store: false,
          timeoutMs: 180_000,
          instructions: `你是产品信息架构顾问。只输出 Markdown，不要代码围栏。面向中文创作者，语气干脆、可落地。`,
          input: `产品：mvstudiopro /platform。Skill 墙挡住主功能；动效PPT 被打断；选题扩写难找；全案不应强迫用户翻完整 Skill 墙。
主功能大字：趋势分析、全案创作分析、选题初选/扩写、动效PPT（Tab 直达）。
陪衬中小号：Skill 折叠、顾问、上传。
核心 Skill 默认开；分类折叠；智能推荐非核心。
请输出：两区线框说明、CTA/字阶、推荐 Skill 摘要文案、动效PPT 不断档原则、ASCII 线框。`,
        });
        return res.status(200).json({
          ok: Boolean(markdown && markdown.length > 80),
          markdown,
          ms: Date.now() - t0,
        });
      } catch (e: any) {
        return res.status(502).json({
          ok: false,
          error: e?.message || String(e),
          ms: Date.now() - t0,
        });
      }
    }

    /** IA 参谋：产出 /canvas 模式选择文案简报（Responses Pro） */
    if (opNormalized === "canvasiabrief") {
      if (req.method !== "POST" && req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const t0 = Date.now();
      try {
        const { invokeGpt56ResponsesText } = await import("../server/services/gpt56ResponsesClient.js");
        const markdown = await invokeGpt56ResponsesText({
          reasoningMode: "pro",
          reasoningEffort: "medium",
          store: false,
          timeoutMs: 180_000,
          instructions: `你是产品信息架构顾问。只输出 Markdown，不要代码围栏。面向中文创作者，语气干脆、可落地。`,
          input: `当前产品形态：/canvas 先让用户选模式，而不是左右分栏同屏铺开。
- 选「漫剧创作」→ 展开编剧室→编导→工厂画布节点→成片坞
- 选「自由画布」→ 不铺漫剧流水线，只开多节点自由接线（文生图/文生视频/图生视频、提文字、文案整理等）
- 可「切换模式」回到选择页；不拆路由

请输出一份简报，含：
1. 模式选择页两张卡文案（漫剧创作 / 自由画布）：标题、一句说明、主 CTA
2. Hero 主标题 + 副句（禁止以供应商/模型名作品牌主角）
3. 用户决策树：连载短剧 / 单次图视频任务 / 只有一句题材
4. 按钮命名建议（扩写剧情、确认进编导、切换模式等）
5. 附录：/platform 若要商用加值，列 5 条以后可做的引导点（本阶段不实现）

约束：模式切换、非左右分栏；文案短、可直接贴进 UI。`,
        });
        return res.status(200).json({
          ok: Boolean(markdown && markdown.length > 80),
          markdown,
          ms: Date.now() - t0,
        });
      } catch (e: any) {
        return res.status(502).json({
          ok: false,
          error: e?.message || String(e),
          ms: Date.now() - t0,
        });
      }
    }

    if (opNormalized === "blobmedia") {
      if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const blobPath = s(q.blobPath || b.blobPath).trim();
      if (blobPath) {
        const asset = await proxyBlobAssetByPath(blobPath);
        res.setHeader("Content-Type", asset.contentType);
        res.setHeader("Cache-Control", asset.cacheControl);
        return res.status(200).send(asset.buffer);
      }
      const targetUrl = s(q.url || b.url).trim();
      if (!targetUrl) {
        return res.status(400).json({ ok: false, error: "url or blobPath is required" });
      }
      const asset = await proxyBlobAsset(targetUrl);
      res.setHeader("Content-Type", asset.contentType);
      res.setHeader("Cache-Control", asset.cacheControl);
      return res.status(200).send(asset.buffer);
    }

    if (opNormalized === "flyvolumemedia") {
      if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const relPath = s(q.relPath || q.relpath || b.relPath).trim();
      if (!relPath) {
        return res.status(400).json({ ok: false, error: "relPath is required" });
      }
      const resolved = resolveSafeFlyPlatformImageReadPath(relPath);
      if (!resolved.ok) {
        return res.status(400).json({ ok: false, error: `invalid_rel_path:${resolved.reason}` });
      }
      try {
        const buf = await fs.readFile(resolved.abs);
        if (!buf.length) {
          return res.status(404).json({ ok: false, error: "empty_file" });
        }
        const lower = resolved.abs.toLowerCase();
        const mime = lower.endsWith(".png")
          ? "image/png"
          : lower.endsWith(".webp")
            ? "image/webp"
            : "image/jpeg";
        res.setHeader("Content-Type", mime);
        res.setHeader("Cache-Control", "public, max-age=3600");
        return res.status(200).send(buf);
      } catch {
        return res.status(404).json({ ok: false, error: "not_found" });
      }
    }

    if (opNormalized === "workflowstatus") {
      if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const id = s(q.id || q.workflowId || q.workflow_id || b.id || b.workflowId).trim();
      const workflow = id ? getCoreWorkflow(id) : null;
      return res.status(200).json({
        ok: true,
        workflow: normalizeWorkflowForResponse(workflow, id),
      });
    }

    if (opNormalized === "workflowtest") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const sourceType = b.sourceType;
      const inputType = s(b.inputType || "script").trim().toLowerCase();
      const payload = b.payload ?? {};

      if (sourceType !== "direct" && sourceType !== "remix" && sourceType !== "showcase" && sourceType !== "workflow") {
        return res.status(400).json({ ok: false, error: "sourceType must be direct/remix/showcase/workflow" });
      }
      if (inputType !== "script" && inputType !== "image") {
        return res.status(400).json({ ok: false, error: "inputType must be script or image" });
      }
      if (sourceType === "remix" && inputType !== "image") {
        return res.status(400).json({ ok: false, error: "remix only supports image workflow" });
      }
      if (inputType === "script" && !s(payload.prompt).trim()) {
        return res.status(400).json({ ok: false, error: "payload.prompt is required for script workflow" });
      }
      if (sourceType === "remix" && !s(payload.imageUrl).trim()) {
        return res.status(400).json({ ok: false, error: "payload.imageUrl is required for remix workflow" });
      }
      if (inputType === "image" && !s(payload.imageUrl).trim() && !s(payload.prompt).trim()) {
        return res.status(400).json({ ok: false, error: "payload.imageUrl or payload.prompt is required for image workflow" });
      }
      const task = createServerWorkflowTask({
        sourceType,
        inputType: inputType as "script" | "image",
        prompt: s(payload.prompt).trim(),
        imageUrl: s(payload.imageUrl).trim(),
        targetWords: Number(payload.targetWords || 0) || undefined,
        targetScenes: Number(payload.targetScenes || 0) || undefined,
      });
      saveCoreWorkflow(task);
      if (sourceType === "remix") {
        try {
          const completedWorkflow = await startCoreWorkflow(task);
          return res.status(200).json({
            ok: true,
            workflowId: completedWorkflow?.workflowId || task.workflowId,
            status: completedWorkflow?.status || task.status,
            currentStep: completedWorkflow?.currentStep || task.currentStep,
            workflow: completedWorkflow || task,
          });
        } catch {
          const failedWorkflow = getCoreWorkflow(task.workflowId) || task;
          return res.status(200).json({
            ok: true,
            workflowId: failedWorkflow.workflowId,
            status: failedWorkflow.status,
            currentStep: failedWorkflow.currentStep,
            workflow: failedWorkflow,
          });
        }
      }
      void startCoreWorkflow(task).catch(() => {
        // startWorkflow persists its own failed status/error path
      });
      return res.status(200).json({
        ok: true,
        workflowId: task.workflowId,
        status: task.status,
        currentStep: task.currentStep,
        workflow: task,
      });
    }

    if (opNormalized === "startworkflow") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const prompt = s(b.prompt).trim();
      if (!prompt) return res.status(400).json({ ok: false, error: "prompt is required" });
      const task = createServerWorkflowTask({
        sourceType: "workflow",
        prompt,
        targetWords: Number(b.targetWords || 0) || undefined,
        targetScenes: Number(b.targetScenes || 0) || undefined,
      });
      saveCoreWorkflow(task);
      return res.status(200).json({
        ok: true,
        workflowId: task.workflowId,
        status: "pending",
        currentStep: "script",
        workflow: task,
      });
    }

    if (opNormalized === "workflowgeneratescript") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const prompt = s(b.prompt).trim();
      if (!prompt) return res.status(400).json(fail("prompt is required"));

      const workflowId = s(b.workflowId).trim();
      const targetWords = Number(b.targetWords || 0) || undefined;
      const targetScenes = Number(b.targetScenes || 0) || undefined;
      const sceneDuration = Number(b.sceneDuration || 0) || 5;

      let task: WorkflowTask;
      if (workflowId) {
        try {
          task = readWorkflow(workflowId, b.workflow);
        } catch (error: any) {
          if ((error?.message || "") !== "workflow not found") throw error;
          task = createServerWorkflowTask({ sourceType: "workflow", prompt, targetWords, targetScenes });
          saveCoreWorkflow(task);
        }
      } else {
        task = createServerWorkflowTask({ sourceType: "workflow", prompt, targetWords, targetScenes });
        saveCoreWorkflow(task);
      }

      let generated: { script: string; storyboard: WorkflowStoryboardScene[]; provider: string; model: string };
      try {
        generated = await generateScriptViaPromptBuilder({
          prompt,
          targetWords,
          targetScenes,
          sceneDuration,
        });
      } catch (error: any) {
        const message = error?.message || String(error) || "script_generation_failed";
        return res.status(502).json(fail("script_generation_failed", message));
      }
      const script = generated.script;
      const storyboard = generated.storyboard;
      const scriptProvider = generated.provider;
      const scriptModel = generated.model;
      const scriptIsFallback = false;
      const scriptErrorMessage = "";
      const workflow = saveWorkflowPatch(task, {
        currentStep: "script",
        status: "running",
        outputs: {
          script,
          scriptProvider,
          scriptModel,
          scriptIsFallback,
          scriptErrorMessage,
          storyboard,
          storyboardStructuredStatus: "structured",
          storyboardConfirmed: false,
          targetWords,
          targetScenes,
          sceneDuration,
        },
      });
      return res.status(200).json({
        ok: true,
        script,
        storyboard,
        scriptProvider,
        scriptModel,
        scriptIsFallback,
        scriptErrorMessage,
        workflowId: workflow.workflowId,
        workflow,
      });
    }

    if (opNormalized === "workflowgeneratestoryboard") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const script = s(workflow.outputs?.script || b.script).trim();
      const storyboardCurrent = Array.isArray(workflow.outputs?.storyboard) ? workflow.outputs.storyboard : [];
      if (!script) return res.status(400).json(fail("script is required"));
      if (!storyboardCurrent.length) return res.status(400).json(fail("storyboard is required from workflowGenerateScript"));
      const next = saveWorkflowPatch(workflow, {
        currentStep: "storyboard",
        status: "running",
        outputs: {
          script,
          storyboard: storyboardCurrent,
          storyboardConfirmed: false,
        },
      });
      return res.status(200).json({ ok: true, workflow: next });
    }

    if (opNormalized === "workflowgeneratestoryboardimages") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const scenes = getStoryboardDraftFromBody(workflow, b);
      if (!Array.isArray(scenes) || scenes.length === 0) {
        return res.status(400).json(fail("storyboard is required"));
      }
      const warnings: string[] = [];
      const settled = await Promise.allSettled(
        scenes.map(async (scene) => {
          const generatedAssets = await generateSceneAssetImages(scene, workflow);
          return {
            sceneIndex: scene.sceneIndex,
            warnings: generatedAssets.warnings || [],
            bundle: buildSceneAssetBundle(null, scene.sceneIndex, {
              prompt: scene.scenePrompt,
              duration: 8,
              sceneVideoUrl: "",
              renderStillPrompt: s(scene.renderStillPrompt || scene.scenePrompt).trim(),
              characterLocked: false,
              referenceCharacterUrl: "",
              backgroundStatus: "not_removed",
              characterImages: generatedAssets.characterImages,
              sceneImages: generatedAssets.sceneImages,
            }),
          };
        }),
      );
      const results: WorkflowStoryboardImageItem[] = [];
      for (const result of settled) {
        if (result.status === "fulfilled") {
          warnings.push(...result.value.warnings);
          results.push(result.value.bundle);
        } else {
          warnings.push(result.reason?.message || String(result.reason) || "scene asset generation failed");
        }
      }
      results.sort((a, b) => Number(a?.sceneIndex || 0) - Number(b?.sceneIndex || 0));
      const next = saveWorkflowPatch(workflow, {
        currentStep: "storyboardImages",
        status: "running",
        outputs: {
          script: s(b.script || workflow.outputs?.script).trim(),
          storyboard: scenes,
          storyboardImages: results,
          storyboardImageWarnings: warnings,
          storyboardConfirmed: false,
        },
      });
      return res.status(200).json({ ok: true, workflow: next, warnings });
    }

    if (opNormalized === "workflowregeneratesceneimages") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const sceneIndex = Number(b.sceneIndex || 0);
      if (!sceneIndex) return res.status(400).json(fail("sceneIndex is required"));
      const storyboard = getStoryboardDraftFromBody(workflow, b);
      const currentImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const targetScene = storyboard.find((scene: any) => Number(scene?.sceneIndex) === sceneIndex);
      if (!targetScene) return res.status(404).json(fail("scene not found"));
      const generatedAssets = await generateSceneAssetImages(targetScene, workflow);
      const updated = upsertStoryboardImageItem(currentImages, sceneIndex, (existing: any) => buildSceneAssetBundle(existing, sceneIndex, {
        prompt: s(targetScene.scenePrompt).trim(),
        duration: 8,
        sceneVideoUrl: s(existing?.sceneVideoUrl).trim(),
        renderStillPrompt: s(targetScene.renderStillPrompt || targetScene.scenePrompt).trim(),
        backgroundStatus: s(existing?.backgroundStatus).trim() || "not_removed",
        characterLocked: Boolean(existing?.characterLocked),
        referenceCharacterUrl: s(existing?.referenceCharacterUrl).trim(),
        characterPngUrl: s(existing?.characterPngUrl).trim(),
        characterImages: generatedAssets.characterImages,
        sceneImages: generatedAssets.sceneImages,
      }));
      const next = saveWorkflowPatch(workflow, {
        currentStep: "storyboardImages",
        outputs: {
          script: s(b.script || workflow.outputs?.script).trim(),
          storyboard,
          storyboardImages: updated,
          storyboardImageWarnings: generatedAssets.warnings || [],
          storyboardConfirmed: false,
        },
      });
      return res.status(200).json({ ok: true, workflow: next, warnings: generatedAssets.warnings || [] });
    }

    if (opNormalized === "workflowgeneratesceneimage") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const sceneIndex = Number(b.sceneIndex || 0);
      if (!sceneIndex) return res.status(400).json(fail("sceneIndex is required"));
      const storyboard = getStoryboardDraftFromBody(workflow, b);
      const targetScene = storyboard.find((scene: any) => Number(scene?.sceneIndex) === sceneIndex);
      if (!targetScene) return res.status(404).json(fail("scene not found"));
      const generatedAssets = await generateSceneAssetImages(targetScene, workflow);

      const currentImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const storyboardImages = upsertStoryboardImageItem(currentImages, sceneIndex, (existing: any) => buildSceneAssetBundle(existing, sceneIndex, {
        prompt: s(targetScene.scenePrompt).trim(),
        duration: 8,
        sceneVideoUrl: s(existing?.sceneVideoUrl).trim(),
        renderStillPrompt: s(targetScene.renderStillPrompt || targetScene.scenePrompt).trim(),
        backgroundStatus: s(existing?.backgroundStatus).trim() || "not_removed",
        characterLocked: Boolean(existing?.characterLocked),
        referenceCharacterUrl: s(existing?.referenceCharacterUrl).trim(),
        characterPngUrl: s(existing?.characterPngUrl).trim(),
        characterImages: generatedAssets.characterImages,
        sceneImages: generatedAssets.sceneImages,
      }));

      const next = saveWorkflowPatch(workflow, {
        currentStep: "storyboardImages",
        outputs: {
          script: s(b.script || workflow.outputs?.script).trim(),
          storyboard,
          storyboardImages,
          storyboardImageWarnings: generatedAssets.warnings || [],
          storyboardConfirmed: false,
        },
      });
      return res.status(200).json({ ok: true, workflow: next, warnings: generatedAssets.warnings || [] });
    }

    if (opNormalized === "workflowregeneratesceneasset") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const sceneIndex = Number(b.sceneIndex || 0);
      const assetType = s(b.assetType || "").trim().toLowerCase();
      if (!sceneIndex) return res.status(400).json(fail("sceneIndex is required"));
      if (assetType !== "character" && assetType !== "scene") return res.status(400).json(fail("assetType must be character or scene"));
      const storyboard = getStoryboardDraftFromBody(workflow, b);
      const targetScene = storyboard.find((scene: any) => Number(scene?.sceneIndex) === sceneIndex);
      if (!targetScene) return res.status(404).json(fail("scene not found"));

      const warnings: string[] = [];
      const generatedImages = assetType === "character"
        ? await generateSceneCharacterImages(targetScene, workflow, warnings)
        : await generateSceneEnvironmentImages(targetScene, warnings);

      const currentImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const storyboardImages = upsertStoryboardImageItem(currentImages, sceneIndex, (existing: any) => buildSceneAssetBundle(existing, sceneIndex, {
        prompt: s(targetScene.scenePrompt).trim(),
        duration: 8,
        sceneVideoUrl: s(existing?.sceneVideoUrl).trim(),
        renderStillPrompt: s(targetScene.renderStillPrompt || targetScene.scenePrompt).trim(),
        backgroundStatus: s(existing?.backgroundStatus).trim() || "not_removed",
        characterLocked: Boolean(existing?.characterLocked),
        referenceCharacterUrl: s(existing?.referenceCharacterUrl).trim(),
        characterPngUrl: s(existing?.characterPngUrl).trim(),
        characterImages: assetType === "character" ? generatedImages : getSceneCharacterImages(existing),
        sceneImages: assetType === "scene" ? generatedImages : getSceneEnvironmentImages(existing),
        selectedSceneImageUrl: assetType === "scene" ? s(generatedImages[0]).trim() : s(existing?.selectedSceneImageUrl).trim(),
      }));

      const next = saveWorkflowPatch(workflow, {
        currentStep: "storyboardImages",
        outputs: {
          script: s(b.script || workflow.outputs?.script).trim(),
          storyboard,
          storyboardImages,
          storyboardImageWarnings: warnings,
          storyboardConfirmed: false,
        },
      });
      return res.status(200).json({ ok: true, workflow: next, warnings });
    }

    if (opNormalized === "workflowuploadsceneimage") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const sceneIndex = Number(b.sceneIndex || 0);
      const imageUrl = s(b.imageUrl).trim();
      const assetType = s(b.assetType || "scene").trim().toLowerCase();
      if (!sceneIndex) return res.status(400).json(fail("sceneIndex is required"));
      if (!imageUrl) return res.status(400).json(fail("imageUrl is required"));

      const currentImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const storyboard = getStoryboardDraftFromBody(workflow, b);
      const targetScene: any = storyboard.find((scene: any) => Number(scene?.sceneIndex) === sceneIndex) || {};
      const storyboardImages = upsertStoryboardImageItem(currentImages, sceneIndex, (existing: any) => {
        const currentCharacterImages = getSceneCharacterImages(existing);
        const currentSceneImages = getSceneEnvironmentImages(existing);
        return buildSceneAssetBundle(existing, sceneIndex, {
          prompt: s(targetScene.scenePrompt || existing?.prompt).trim(),
          duration: 8,
          sceneVideoUrl: s(existing?.sceneVideoUrl).trim(),
          renderStillImageUrl: assetType === "renderstill" ? imageUrl : s(existing?.renderStillImageUrl).trim(),
          renderStillPrompt: s(targetScene.renderStillPrompt || targetScene.scenePrompt || existing?.renderStillPrompt).trim(),
          backgroundStatus: s(existing?.backgroundStatus).trim() || "not_removed",
          characterLocked: Boolean(existing?.characterLocked),
          referenceCharacterUrl: s(existing?.referenceCharacterUrl).trim(),
          characterPngUrl: s(existing?.characterPngUrl).trim(),
          characterImages: assetType === "character" ? [imageUrl] : currentCharacterImages,
          sceneImages: assetType === "character"
            ? currentSceneImages
            : assetType === "scene"
              ? [imageUrl, ...currentSceneImages.filter((value: string) => value !== imageUrl)].slice(0, 1)
              : currentSceneImages,
        });
      });

      const next = saveWorkflowPatch(workflow, {
        currentStep: "storyboardImages",
        outputs: {
          script: s(b.script || workflow.outputs?.script).trim(),
          storyboard,
          storyboardImages,
          storyboardConfirmed: false,
        },
      });
      return res.status(200).json({ ok: true, workflow: next });
    }

    if (opNormalized === "workflowselectsceneimage") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const sceneIndex = Number(b.sceneIndex || 0);
      const imageUrl = s(b.imageUrl).trim();
      if (!sceneIndex) return res.status(400).json(fail("sceneIndex is required"));
      if (!imageUrl) return res.status(400).json(fail("imageUrl is required"));

      const currentImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const storyboard = getStoryboardDraftFromBody(workflow, b);
      const storyboardImages = upsertStoryboardImageItem(currentImages, sceneIndex, (existing: any) => {
        const currentSceneImages = getSceneEnvironmentImages(existing);
        if (!currentSceneImages.includes(imageUrl)) {
          return buildSceneAssetBundle(existing, sceneIndex, {
            selectedSceneImageUrl: s(existing?.selectedSceneImageUrl).trim() || currentSceneImages[0] || "",
          });
        }
        return buildSceneAssetBundle(existing, sceneIndex, {
          selectedSceneImageUrl: imageUrl,
          sceneImages: [imageUrl, ...currentSceneImages.filter((value) => value !== imageUrl)].slice(0, 1),
        });
      });

      const next = saveWorkflowPatch(workflow, {
        currentStep: "storyboardImages",
        outputs: {
          script: s(b.script || workflow.outputs?.script).trim(),
          storyboard,
          storyboardImages,
        },
      });
      return res.status(200).json({ ok: true, workflow: next, selectedSceneImageUrl: imageUrl });
    }

    if (opNormalized === "workflowgeneraterenderstill") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const sceneIndex = Number(b.sceneIndex || 0);
      if (!sceneIndex) return res.status(400).json(fail("sceneIndex is required"));
      const storyboard = getStoryboardDraftFromBody(workflow, b);
      const scene = storyboard.find((item: any) => Number(item?.sceneIndex) === sceneIndex);
      if (!scene) return res.status(404).json(fail("scene not found"));
      const prompt = buildRenderStillPrompt(scene, b.renderStillPrompt);
      if (!prompt) return res.status(400).json(fail("renderStillPrompt is required"));

      const generated = await generateImageWithBanana({
        prompt,
        numImages: 1,
        aspectRatio: "16:9",
        imageSize: "1536x864",
      });
      const uploadedImages = await uploadWorkflowImagesToBlob(
        (generated.imageUrls || []).slice(0, 1),
        `storyboard-scene-${sceneIndex}-render-still`,
      );
      const renderStillImageUrl = s(uploadedImages[0]).trim();
      if (!renderStillImageUrl) return res.status(502).json(fail("render still generation failed"));

      const currentImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const storyboardImages = upsertStoryboardImageItem(currentImages, sceneIndex, (existing: any) =>
        buildSceneAssetBundle(existing, sceneIndex, {
          prompt: s(scene?.scenePrompt || existing?.prompt).trim(),
          duration: 8,
          sceneVideoUrl: s(existing?.sceneVideoUrl).trim(),
          renderStillImageUrl,
          renderStillPrompt: prompt,
          backgroundStatus: s(existing?.backgroundStatus).trim() || "not_removed",
          characterLocked: Boolean(existing?.characterLocked),
          referenceCharacterUrl: s(existing?.referenceCharacterUrl).trim(),
          characterPngUrl: s(existing?.characterPngUrl).trim(),
        }),
      );

      const nextStoryboard = storyboard.map((item: any) =>
        Number(item?.sceneIndex) === sceneIndex ? { ...item, renderStillNeeded: true, renderStillPrompt: prompt } : item,
      );
      const next = saveWorkflowPatch(workflow, {
        currentStep: "storyboardImages",
        outputs: {
          script: s(b.script || workflow.outputs?.script).trim(),
          storyboard: nextStoryboard,
          storyboardImages,
          storyboardConfirmed: false,
        },
      });
      return res.status(200).json({ ok: true, workflow: next, renderStillImageUrl });
    }

    if (opNormalized === "workflowlockcharacter") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const sceneIndex = Number(b.sceneIndex || 0);
      if (!sceneIndex) return res.status(400).json(fail("sceneIndex is required"));
      const locked = Boolean(b.locked);
      const storyboard = Array.isArray(workflow.outputs?.storyboard) ? workflow.outputs.storyboard : [];
      const scene = storyboard.find((item: any) => Number(item?.sceneIndex) === sceneIndex) || {};
      const lockPrompt = buildCharacterLockPrompt({
        gender: s(b.gender).trim(),
        age: s(b.age).trim(),
        appearance: s(b.appearance || scene.character).trim(),
        outfit: s(b.outfit).trim(),
        hair: s(b.hair).trim(),
        optionalReferenceImage: s(b.optionalReferenceImage).trim(),
      });
      const currentImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const sceneImage = currentImages.find((item: any) => Number(item?.sceneIndex) === sceneIndex)?.images?.[0] || "";
      const lockResult = locked && sceneImage ? await characterLockStep({ sceneImageUrl: sceneImage }) : { referenceCharacterUrl: "" };
      const updated = currentImages.map((item: any) =>
        Number(item?.sceneIndex) === sceneIndex
          ? { ...item, characterLocked: locked, referenceCharacterUrl: lockResult.referenceCharacterUrl || item?.referenceCharacterUrl }
          : item,
      );
      const next = saveWorkflowPatch(workflow, {
        currentStep: "characterLock",
        outputs: {
          storyboardImages: updated,
          storyboardConfirmed: false,
          lockedCharacterPrompt: lockPrompt,
          referenceCharacterUrl: lockResult.referenceCharacterUrl || workflow.outputs?.referenceCharacterUrl || "",
        },
      });
      return res.status(200).json({ ok: true, workflow: next });
    }

    if (opNormalized === "workflowuploadreferencecharacter") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const sceneIndex = Number(b.sceneIndex || 0);
      const referenceCharacterUrl = s(b.referenceCharacterUrl).trim();
      if (!sceneIndex) return res.status(400).json(fail("sceneIndex is required"));
      if (!referenceCharacterUrl) return res.status(400).json(fail("referenceCharacterUrl is required"));
      const currentImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const updated = currentImages.map((item: any) =>
        Number(item?.sceneIndex) === sceneIndex ? { ...item, referenceCharacterUrl } : item,
      );
      const next = saveWorkflowPatch(workflow, {
        currentStep: "characterLock",
        outputs: {
          storyboardImages: updated,
          storyboardConfirmed: false,
          referenceImages: Array.from(new Set([...(workflow.outputs?.referenceImages || []), referenceCharacterUrl])),
          lockedCharacters: [{ characterId: `scene-${sceneIndex}`, referenceImage: referenceCharacterUrl }],
          referenceCharacterUrl,
        },
      });
      return res.status(200).json({ ok: true, workflow: next });
    }

    if (opNormalized === "workflowbackgroundremove") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const sceneIndex = Number(b.sceneIndex || 0);
      if (!sceneIndex) return res.status(400).json(fail("sceneIndex is required"));
      const currentImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const target = currentImages.find((item: any) => Number(item?.sceneIndex) === sceneIndex);
      const sourceUrl = s(target?.referenceCharacterUrl || target?.images?.[0]).trim();
      if (!sourceUrl) return res.status(400).json(fail("reference character image is required"));
      const removed = await backgroundRemoveStep({ imageUrl: sourceUrl });
      const updated = currentImages.map((item: any) =>
        Number(item?.sceneIndex) === sceneIndex
          ? { ...item, backgroundStatus: "removed", characterPngUrl: removed.characterPngUrl }
          : item,
      );
      const next = saveWorkflowPatch(workflow, {
        currentStep: "backgroundRemove",
        outputs: {
          storyboardImages: updated,
          storyboardConfirmed: false,
          characterPngUrl: removed.characterPngUrl,
        },
      });
      return res.status(200).json({ ok: true, workflow: next });
    }

    if (opNormalized === "workflowconfirmstoryboard") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const scenesInput = Array.isArray(b.storyboard) ? b.storyboard : workflow.outputs?.storyboard;
      if (!Array.isArray(scenesInput) || scenesInput.length === 0) {
        return res.status(400).json(fail("storyboard is required"));
      }
      const scenes = scenesInput.map((scene: any, idx: number) =>
        normalizeStoryboardScene(scene, idx + 1, Number(workflow.outputs?.sceneDuration || 0) || 5),
      );
      const next = saveWorkflowPatch(workflow, {
        currentStep: "storyboard",
        outputs: { storyboard: scenes, storyboardConfirmed: true, storyboardConfirmedAt: Date.now() },
      });
      return res.status(200).json({ ok: true, workflow: next });
    }

    if (opNormalized === "workflowgeneratevideo") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      if (!COMET_KEY && (!VAK || !VSK || !IAK || !ISK)) {
        return res.status(500).json(fail("COMETAPI_KEY or KLING_CN_VIDEO_ACCESS_KEY/KLING_CN_VIDEO_SECRET_KEY and KLING_CN_IMAGE_ACCESS_KEY/KLING_CN_IMAGE_SECRET_KEY are required"));
      }
      const storyboard = Array.isArray(workflow.outputs?.storyboard) ? workflow.outputs.storyboard : [];
      const storyboardImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const lockedCharacterPrompt = s(workflow.outputs?.lockedCharacterPrompt).trim();
      const promptFromStoryboard = storyboard
        .map((scene: any) =>
          buildVideoPrompt({
            scenePrompt: s(scene?.scenePrompt).trim(),
            character: s(scene?.character).trim(),
            action: s(scene?.action).trim(),
            camera: s(scene?.camera).trim(),
            mood: s(scene?.mood).trim(),
            lighting: s(scene?.lighting).trim(),
            sceneDuration: Number(scene?.duration || 0) || Number(workflow.outputs?.sceneDuration || 0) || 5,
            lockedCharacterPrompt: lockedCharacterPrompt || undefined,
          }),
        )
        .filter(Boolean)
        .join("\n");
      const prompt = promptFromStoryboard || buildVideoPrompt({
        scenePrompt: s(workflow.outputs?.script || workflow.payload?.prompt).trim(),
        sceneDuration: Number(workflow.outputs?.sceneDuration || 0) || 5,
        lockedCharacterPrompt: lockedCharacterPrompt || undefined,
      });
      if (!prompt) return res.status(400).json(fail("missing prompt for video generation"));

      const uploadedRef = s(b.referenceImageUrl || b.referenceCharacterUrl || "").trim();
      const refsFromScenes = storyboardImages
        .map((item: any) =>
          s(
            item?.characterPngUrl ||
            item?.referenceCharacterUrl ||
            (Array.isArray(item?.images) ? item.images[0] : ""),
          ).trim(),
        )
        .filter(Boolean);
      const refsFromOutputs = [
        s(workflow.outputs?.characterPngUrl).trim(),
        s(workflow.outputs?.referenceCharacterUrl).trim(),
        ...(Array.isArray(workflow.outputs?.referenceImages) ? workflow.outputs.referenceImages.map((x: any) => s(x).trim()) : []),
      ].filter(Boolean);
      const referenceCandidates = Array.from(new Set([uploadedRef, ...refsFromScenes, ...refsFromOutputs].filter(Boolean)));
      const referenceImageUrl = referenceCandidates[0] || "";
      if (!referenceImageUrl) {
        return res.status(400).json(fail("reference image is required before video generation"));
      }

      const videoToken = jwtHS256(VAK, VSK);
      const imageToken = jwtHS256(IAK, ISK);
      const model = s(b.model || "kling-v2-6").trim() || "kling-v2-6";
      const created = await createKlingI2VTask(
        KLING_BASE,
        videoToken,
        imageToken,
        referenceImageUrl,
        prompt,
        model,
        "5"
      );
      if (!created.taskId) {
        const rawDetail = created.raw.json ?? created.raw.rawText;
        const rawMessage =
          s((created.raw.json as any)?.message).trim() ||
          s((created.raw.json as any)?.error).trim() ||
          s((created.raw.json as any)?.detail).trim() ||
          "";
        const detailMessage = rawMessage || "kling i2v task creation failed";
        return res.status(502).json(fail("kling i2v task creation failed", detailMessage, { raw: rawDetail }));
      }
      const polled = await pollKlingI2VTask(KLING_BASE, videoToken, created.taskId);
      if (!polled.ok) return res.status(502).json(fail(String(polled.error || "video generation failed")));
      const next = saveWorkflowPatch(workflow, {
        currentStep: "video",
        outputs: {
          videoProvider: "kling",
          videoModel: model,
          videoUrl: polled.videoUrl,
          referenceCharacterUrl: s(workflow.outputs?.referenceCharacterUrl).trim() || referenceImageUrl,
          referenceImages: Array.from(new Set([...(workflow.outputs?.referenceImages || []), referenceImageUrl])),
          videoErrorMessage: "",
        },
      });
      return res.status(200).json({ ok: true, workflow: next });
    }

    if (opNormalized === "workflowgeneratescenevideo") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const sceneIndex = Number(b.sceneIndex || 0);
      if (!sceneIndex) return res.status(400).json(fail("sceneIndex is required"));

      const storyboard = getStoryboardDraftFromBody(workflow, b);
      const storyboardImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const scene = storyboard.find((item: any) => Number(item?.sceneIndex) === sceneIndex);
      if (!scene) return res.status(404).json(fail("scene not found"));
      const effectiveScene = {
        ...scene,
        scenePrompt: s(b.scenePrompt || scene.scenePrompt).trim() || s(scene.scenePrompt).trim(),
        primarySubject: s(b.primarySubject || scene.primarySubject || scene.character).trim() || s(scene.primarySubject || scene.character).trim(),
        character: s(b.character || scene.character).trim() || s(scene.character).trim(),
        action: s(b.action || scene.action).trim() || s(scene.action).trim(),
        camera: s(b.camera || scene.camera).trim() || s(scene.camera).trim(),
        mood: s(b.mood || scene.mood).trim() || s(scene.mood).trim(),
        lighting: s(b.lighting || scene.lighting).trim() || s(scene.lighting).trim(),
      };
      if (sceneNeedsRenderStill(effectiveScene)) {
        return res.status(409).json(fail(
          "multi-character scenes must use render stills instead of AI scene video generation",
          "此分镜检测为多角色或多人场景，请改为上传或生成静态展示图，最终在 Render 阶段插入。",
        ));
      }
      const sceneBundle = storyboardImages.find((item: any) => Number(item?.sceneIndex) === sceneIndex) || {};
      const characterImageUrl =
        s(sceneBundle?.characterPngUrl).trim() ||
        s(sceneBundle?.referenceCharacterUrl).trim() ||
        getSceneCharacterImages(sceneBundle)[0] ||
        "";
      const sceneImageUrls = getSceneEnvironmentImages(sceneBundle);
      const referenceImages = [...sceneImageUrls.slice(0, 1), characterImageUrl].map((value) => s(value).trim()).filter(Boolean);
      if (!characterImageUrl) return res.status(400).json(fail("character image is required before scene video generation"));
      if (!sceneImageUrls.length) return res.status(400).json(fail("at least one scene image is required before scene video generation"));

      const prompt = simplifySceneVideoPrompt(effectiveScene);
      const preparedReferenceImages = await Promise.all(
        referenceImages.map((imageUrl, idx) => uploadWorkflowImageToBlob(imageUrl, `scene-video-${sceneIndex}-ref-${idx + 1}`, { mode: "video" })),
      );

      const videoEngine = s(b.videoEngine || "veo").trim().toLowerCase();
      const aspectRatioInput = s(b.aspectRatio || "16:9").trim() || "16:9";
      const videoResolution = s(b.videoResolution || "720p").trim() === "1080p" ? "1080p" : "720p";

      if (videoEngine === "seedance") {
        let sceneVideoUrl = "";
        let videoDurationForUi = 8;
        let videoModel = "seedance-2.0";
        try {
          const { isEvolinkSeedanceConfigured, runEvolinkSeedanceVideo } = await import(
            "../server/services/evolinkSeedanceVideo.js"
          );
          if (!isEvolinkSeedanceConfigured()) {
            return res.status(503).json(fail("evolink_not_configured", "EVOLINK_API_KEY 未配置，Seedance 仅支持 EvoLink"));
          }
          const durationInput = parseSeedanceDurationInput(b.videoDuration ?? b.duration ?? effectiveScene.duration);
          const seedanceOut = await runEvolinkSeedanceVideo({
            prompt,
            imageUrl: preparedReferenceImages[0] || "",
            quality: videoResolution,
            duration: durationInput === "auto" ? 8 : durationInput,
            aspectRatio: aspectRatioInput,
            generateAudio: b.generateSceneVideoAudio !== false && b.generateSceneVideoAudio !== 0,
            version: "2.0",
          });
          sceneVideoUrl = seedanceOut.videoUrl;
          videoModel = seedanceOut.model;
          videoDurationForUi = durationInput === "auto" ? 8 : durationInput;
        } catch (err: any) {
          return res.status(502).json(fail("seedance_failed", err?.message || "Seedance 视频生成失败"));
        }

        const scene: any = storyboard.find((item: any) => Number(item?.sceneIndex) === sceneIndex) || {};
        const nextStoryboardImages = upsertStoryboardImageItem(storyboardImages, sceneIndex, (existing: any) => buildSceneAssetBundle(existing, sceneIndex, {
          prompt: s(scene?.scenePrompt).trim(),
          duration: videoDurationForUi,
          sceneVideoUrl,
          backgroundStatus: s(existing?.backgroundStatus).trim() || "not_removed",
          characterLocked: Boolean(existing?.characterLocked),
          referenceCharacterUrl: s(existing?.referenceCharacterUrl).trim(),
          characterPngUrl: s(existing?.characterPngUrl).trim(),
        }));
        const next = saveWorkflowPatch(workflow, {
          currentStep: "video",
          outputs: {
            script: s(b.script || workflow.outputs?.script).trim(),
            storyboard: storyboard.map((item: any) =>
              Number(item?.sceneIndex) === sceneIndex ? effectiveScene : item,
            ),
            storyboardImages: nextStoryboardImages,
            videoProvider: "evolink",
            videoModel,
            sceneVideoAspectRatio: aspectRatioInput,
            sceneVideoResolution: videoResolution,
          },
        });
        return res.status(200).json({
          ok: true,
          workflow: next,
          sceneVideoUrl,
          sceneIndex,
          status: "completed",
          videoEngine: "seedance",
        });
      }

      let operationName = "";
      let veoModel = "veo-3.1-generate-001";
      let veoLocation = "us-central1";
      try {
        const { startVideo } = await import("../server/veo.js");
        const started = await startVideo({
          prompt,
          imageUrl: preparedReferenceImages[0] || "",
          quality: "standard",
          aspectRatio: mapVeoAspectRatio(aspectRatioInput),
          resolution: videoResolution,
          negativePrompt: "multiple people, extra limbs, duplicate subject, distorted face",
        });
        operationName = started.operationName;
        veoModel = started.model;
        veoLocation = started.location;
      } catch (err: any) {
        return res.status(502).json(fail("veo_start_failed", err?.message || "Veo 3.1 task creation failed"));
      }

      const next = saveWorkflowPatch(workflow, {
        currentStep: "video",
        outputs: {
          script: s(b.script || workflow.outputs?.script).trim(),
          storyboard: storyboard.map((item: any) =>
            Number(item?.sceneIndex) === sceneIndex ? effectiveScene : item,
          ),
          storyboardImages: storyboardImages,
          videoProvider: "vertex",
          videoModel: veoModel,
          sceneVideoAspectRatio: aspectRatioInput,
          sceneVideoResolution: videoResolution,
        },
      });
      return res.status(200).json({
        ok: true,
        workflow: next,
        taskId: operationName,
        veoModel,
        veoLocation,
        sceneIndex,
        status: "pending",
        videoEngine: "veo",
      });
    }

    // ─── Veo 轮询（单次）────────────────────────────────────────────────────
    if (opNormalized === "workflowveopoll") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const taskId = s(b.taskId).trim();
      const veoModel = s(b.veoModel || "veo-3.1-generate-001").trim();
      const veoLocation = s(b.veoLocation || "us-central1").trim();
      if (!taskId) return res.status(400).json(fail("taskId is required"));
      try {
        const { pollVideo } = await import("../server/veo.js");
        const result = await pollVideo(taskId, veoModel, veoLocation);
        return res.status(200).json({ ok: true, ...result });
      } catch (err: any) {
        return res.status(502).json(fail("veo_poll_failed", err?.message || "poll failed"));
      }
    }

    // ─── 将完成的 Veo 视频 URL 保存回 workflow ──────────────────────────────
    if (opNormalized === "workflowveosave") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const sceneIndex = Number(b.sceneIndex || 0);
      const videoUrl = s(b.videoUrl).trim();
      if (!sceneIndex || !videoUrl) return res.status(400).json(fail("sceneIndex and videoUrl are required"));

      const storyboard = getStoryboardDraftFromBody(workflow, b);
      const storyboardImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const scene: any = storyboard.find((item: any) => Number(item?.sceneIndex) === sceneIndex) || {};

      const nextStoryboardImages = upsertStoryboardImageItem(storyboardImages, sceneIndex, (existing: any) => buildSceneAssetBundle(existing, sceneIndex, {
        prompt: s(scene?.scenePrompt).trim(),
        duration: 8,
        sceneVideoUrl: videoUrl,
        backgroundStatus: s(existing?.backgroundStatus).trim() || "not_removed",
        characterLocked: Boolean(existing?.characterLocked),
        referenceCharacterUrl: s(existing?.referenceCharacterUrl).trim(),
        characterPngUrl: s(existing?.characterPngUrl).trim(),
      }));
      const next = saveWorkflowPatch(workflow, {
        currentStep: "video",
        outputs: {
          storyboardImages: nextStoryboardImages,
          videoProvider: "vertex",
          videoModel: s(b.veoModel || "veo-3.1-generate-001").trim(),
        },
      });
      return res.status(200).json({ ok: true, workflow: next, sceneVideoUrl: videoUrl });
    }

    if (opNormalized === "workflowgeneratevoice") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const dialogueText = s(b.dialogueText).trim() || s(workflow.outputs?.script).trim();
      const voicePrompt = buildVoicePrompt({
        dialogueText,
        style: s(b.voicePrompt || workflow.outputs?.voicePrompt).trim(),
        language: s(b.language || "中文").trim() || "中文",
      });
      const voice = s(b.voice || "nova").trim() || "nova";
      const voiceType = s(b.voiceType || workflow.outputs?.voiceType || "female").trim() || "female";
      const voiceStyle = s(b.voiceStyle || workflow.outputs?.voiceStyle).trim();
      if (!dialogueText) return res.status(400).json(fail("dialogueText is required"));
      const voiceResult = await generateSceneVoice({ dialogueText, voicePrompt, voice, voiceType, voiceStyle });
      if (!s(voiceResult.voiceUrl).trim()) {
        return res.status(502).json(
          fail(
            "voice_generation_failed",
            voiceResult.voiceErrorMessage || "Voice synthesis did not return a voiceUrl",
            {
              provider: voiceResult.voiceProvider,
              model: voiceResult.voiceModel,
              voice: voiceResult.voiceVoice,
            },
          ),
        );
      }
      const next = saveWorkflowPatch(workflow, {
        currentStep: "voice",
        outputs: {
          dialogueText,
          voicePrompt,
          voiceProvider: voiceResult.voiceProvider,
          voiceModel: voiceResult.voiceModel,
          voiceVoice: voiceResult.voiceVoice,
          voiceUrl: voiceResult.voiceUrl,
          voiceIsFallback: voiceResult.voiceIsFallback,
          voiceErrorMessage: voiceResult.voiceErrorMessage,
        },
      });
      return res.status(200).json({ ok: true, workflow: next });
    }

    if (opNormalized === "workflowgeneratescenevoice") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const sceneIndex = Number(b.sceneIndex || 0);
      if (!sceneIndex) return res.status(400).json(fail("sceneIndex is required"));
      const storyboard = getStoryboardDraftFromBody(workflow, b);
      const scene = storyboard.find((item: any) => Number(item?.sceneIndex) === sceneIndex);
      if (!scene) return res.status(404).json(fail("scene not found"));

      const dialogueText = buildSceneVoiceText(scene, b.dialogueText);
      if (!dialogueText) return res.status(400).json(fail("dialogueText is required"));
      const voiceType = s(b.voiceType || scene.voiceType || "female").trim() || "female";
      const voiceStyle = s(b.voiceStyle || scene.voiceStyle).trim();
      const voicePrompt = buildVoicePrompt({
        dialogueText,
        style: [s(b.voicePrompt || workflow.outputs?.voicePrompt).trim(), buildSceneVoiceStyleText(scene, voiceStyle)].filter(Boolean).join("，"),
        language: s(b.language || "中文").trim() || "中文",
      });
      const voice = s(b.voice || mapSceneVoiceTypeToVoice(voiceType)).trim() || mapSceneVoiceTypeToVoice(voiceType);
      const voiceResult = await generateSceneVoice({ dialogueText, voicePrompt, voice, voiceType, voiceStyle });
      if (!s(voiceResult.voiceUrl).trim()) {
        return res.status(502).json(
          fail(
            "voice_generation_failed",
            voiceResult.voiceErrorMessage || "Voice synthesis did not return a voiceUrl",
            { provider: voiceResult.voiceProvider, model: voiceResult.voiceModel, voice: voiceResult.voiceVoice },
          ),
        );
      }

      const currentImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const storyboardImages = upsertStoryboardImageItem(currentImages, sceneIndex, (existing: any) =>
        buildSceneAssetBundle(existing, sceneIndex, {
          prompt: s(scene?.scenePrompt || existing?.prompt).trim(),
          sceneVoiceUrl: voiceResult.voiceUrl,
          sceneVoicePrompt: voicePrompt,
          sceneVoiceType: voiceType,
          sceneVoiceStyle: voiceStyle,
          sceneVoiceVoice: voiceResult.voiceVoice,
        }),
      );
      const nextStoryboard = storyboard.map((item: any) =>
        Number(item?.sceneIndex) === sceneIndex ? { ...item, voiceover: dialogueText, voiceType, voiceStyle } : item,
      );

      const next = saveWorkflowPatch(workflow, {
        currentStep: "voice",
        outputs: {
          storyboard: nextStoryboard,
          storyboardImages,
          voiceProvider: voiceResult.voiceProvider,
          voiceModel: voiceResult.voiceModel,
          voiceVoice: voiceResult.voiceVoice,
        },
      });
      return res.status(200).json({
        ok: true,
        workflow: next,
        sceneVoiceUrl: voiceResult.voiceUrl,
        sceneVoiceVoice: voiceResult.voiceVoice,
        sceneVoiceType: voiceType,
        sceneVoiceStyle: voiceStyle,
      });
    }

    if (opNormalized === "workflowgeneratemusic") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      if (!AIM_KEY) return res.status(500).json(fail("missing_env", "AIMUSIC_API_KEY is required", { detail: "AIMUSIC_API_KEY" }));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const requestedMusicProvider = normalizeMusicProvider(b.musicProvider || workflow.outputs?.musicProvider || "suno");
      const musicDuration = Number(b.musicDuration || 0) || 30;
      const storyboard = getStoryboardDraftFromBody(workflow, b);
      const scriptText = s(b.script || workflow.outputs?.script || workflow.payload?.prompt).trim();

      // ── 用 Gemini 3.1 Pro 生成 Suno 专用 music prompt（与成长营同链路）──
      let aiMusicPrompt = s(b.musicPrompt).trim(); // 若前端手动传入则直接用
      if (!aiMusicPrompt) {
        const storyboardMoodSummary = (Array.isArray(storyboard) ? storyboard : [])
          .slice(0, 20)
          .map((sc: any, idx: number) => {
            const themeLine = s(sc?.theme || sc?.mood || "").trim();
            const lighting = s(sc?.lighting).trim();
            const action = s(sc?.action).trim();
            const camera = s(sc?.camera).trim();
            const excerpt = truncateText(s(sc?.scenePrompt || ""), 140);
            return [
              `[Scene ${idx + 1}]`,
              themeLine && `theme:${themeLine}`,
              lighting && `light:${lighting}`,
              action && `action:${truncateText(action, 80)}`,
              camera && `camera:${camera}`,
              excerpt && `prompt:${excerpt}`,
            ].filter(Boolean).join(" · ");
          })
          .join("\n");
        const geminiMusicPromptRequest = `You are a professional film composer and music director.

The FIRST LINE must be one short English phrase distilling the **overall video theme / north-star mood** (like a logline for the score).

After that, on the same output, write the **Suno AI V5.5 instrumental prompt** (English only):
- Max 120 words total (including the first line)
- Genre, mood, tempo, key instruments, energy arc
- Purely instrumental, no vocals
- Suitable as cinematic short-video BGM

Output only this combined text (first line = theme distill, then the Suno prompt). No bullets, no explanation.

Script (excerpt):
${truncateText(scriptText, 500)}

Per-scene distilled themes / moods / beats:
${truncateText(storyboardMoodSummary, 3500)}`;

        try {
          const geminiResult = await callGeminiScriptGateway(geminiMusicPromptRequest);
          const geminiText = extractGoogleText(geminiResult?.raw).trim();
          if (geminiText) aiMusicPrompt = truncateText(geminiText, 200);
        } catch (_err) {
          // Gemini 失败时回退到关键词推导
        }
      }

      // 最终兜底：机械推导
      if (!aiMusicPrompt) {
        aiMusicPrompt = deriveMusicSeedFromStoryboard(storyboard, scriptText);
      }
      if (!aiMusicPrompt) return res.status(400).json(fail("musicPrompt is required"));

      // 送给 Suno 的 prompt 直接使用 Gemini 输出，不再套 buildMusicPrompt 壳
      const prompt = aiMusicPrompt;

      const createUrl = requestedMusicProvider === "udio" ? `${AIM_BASE}/api/v1/nuro/create` : `${AIM_BASE}/api/v1/sonic/create`;
      const taskUrlBase = requestedMusicProvider === "udio" ? `${AIM_BASE}/api/v1/nuro/task/` : `${AIM_BASE}/api/v1/sonic/task/`;
      const nuroWorkflowDuration = Math.max(30, Math.min(120, Math.floor(Number(musicDuration) || 60)));
      const createBody = requestedMusicProvider === "udio"
        ? {
            type: "bgm",
            version: "v2.0",
            description: truncateText(prompt, 200),
            duration: nuroWorkflowDuration,
          }
        : {
            task_type: "create_music",
            custom_mode: false,
            mv: "sonic-v5-5",
            gpt_description_prompt: prompt,
          };

      const created = await fetchJson(createUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${AIM_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(createBody),
      });
      if (!created.ok) return res.status(502).json(fail("music_create_failed", "Music create request failed", { provider: requestedMusicProvider, raw: created.json ?? created.rawText }));
      const taskId = s(
        created.json?.data?.task_id ||
          created.json?.task_id ||
          created.json?.taskId ||
          created.json?.data?.id ||
          created.json?.id,
      ).trim();
      if (!taskId) return res.status(502).json(fail("missing_music_task_id", "Music task id is missing", { provider: requestedMusicProvider, raw: created.json ?? created.rawText }));

      let musicUrl = "";
      let rawTask: any = null;
      for (let i = 0; i < 40; i += 1) {
        await sleep(3000);
        const polled = await fetchJson(`${taskUrlBase}${encodeURIComponent(taskId)}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${AIM_KEY}`, Accept: "application/json" },
        });
        let pollJson: any = polled.json ?? polled.rawText;
        if (requestedMusicProvider === "udio") {
          pollJson = normalizeNuroPollJson(pollJson);
        }
        rawTask = pollJson;
        const status = s(
          pollJson?.status ||
            pollJson?.state ||
            pollJson?.data?.[0]?.status ||
            pollJson?.data?.[0]?.state ||
            "",
        ).toLowerCase();
        musicUrl = extractMusicUrlFromPayload(pollJson);
        if (musicUrl) break;
        if (status === "failed" || status === "error" || status === "cancelled") {
          return res.status(502).json(fail("music_task_failed", deriveMusicError(status, rawTask), { provider: requestedMusicProvider, raw: rawTask }));
        }
      }
      if (!musicUrl) return res.status(502).json(fail("music_task_timeout_or_missing_music_url", "Music task timeout or missing music url", { provider: requestedMusicProvider, raw: rawTask }));
      let persistedMusicUrl = "";
      try {
        persistedMusicUrl = await uploadWorkflowAudioToBlob(musicUrl, "workflow-music");
      } catch (error: any) {
        return res.status(502).json(fail("music_download_failed", error?.message || String(error) || "music download failed", { provider: requestedMusicProvider, raw: rawTask }));
      }

      const next = saveWorkflowPatch(workflow, {
        currentStep: "music",
        outputs: {
          storyboard,
          musicProvider: requestedMusicProvider,
          musicPrompt: aiMusicPrompt,
          musicModel: "sonic-v5-5",
          musicDuration,
          musicUrl: persistedMusicUrl,
        },
      });
      return res.status(200).json({ ok: true, workflow: next, musicPrompt: aiMusicPrompt });
    }

    if (opNormalized === "workflowrendervideo" || opNormalized === "workflowrenderfinalvideo") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const storyboardImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const storyboard = Array.isArray(workflow.outputs?.storyboard) ? workflow.outputs.storyboard : [];
      const includeSceneVoiceIndexes = Array.isArray(b.includeSceneVoiceIndexes)
        ? b.includeSceneVoiceIndexes.map((value: any) => Number(value || 0)).filter((value: number) => value > 0)
        : [];
      const hasExplicitSceneVoiceSelection = Array.isArray(b.includeSceneVoiceIndexes);
      const includeSceneVoiceSet = new Set(includeSceneVoiceIndexes);
      const sceneVideos = storyboardImages
        .filter((item: any) => s(item?.sceneVideoUrl).trim())
        .sort((a: any, b: any) => Number(a?.sceneIndex || 0) - Number(b?.sceneIndex || 0))
        .map((item: any) => ({
          sceneIndex: Number(item?.sceneIndex || 0),
          url: s(item?.sceneVideoUrl).trim(),
          duration: "8s",
          stillImageUrl: s(item?.renderStillImageUrl).trim() || undefined,
          stillDuration: sceneNeedsRenderStill(storyboard.find((scene: any) => Number(scene?.sceneIndex) === Number(item?.sceneIndex || 0))) ? "1.5s" : undefined,
          voiceUrl: !hasExplicitSceneVoiceSelection
            ? s(item?.sceneVoiceUrl).trim() || undefined
            : includeSceneVoiceSet.has(Number(item?.sceneIndex || 0))
            ? s(item?.sceneVoiceUrl).trim() || undefined
            : undefined,
          includeVoice: !hasExplicitSceneVoiceSelection || includeSceneVoiceSet.has(Number(item?.sceneIndex || 0)),
        }));
      if (!sceneVideos.length) return res.status(400).json(fail("sceneVideos are required before render"));
      const musicStartSec = Number(b.musicStartSec || 0);
      const musicEndSec = Number(b.musicEndSec || 0);
      const musicVolume = Number(b.musicVolume);
      const voiceVolume = Number(b.voiceVolume);
      const musicFadeInSec = Number(b.musicFadeInSec || 0);
      const musicFadeOutSec = Number(b.musicFadeOutSec || 0);
      const finalVideoUrl = await renderWorkflowFinalVideo({
        sceneVideos,
        musicUrl: s(b.musicUrl || workflow.outputs?.musicUrl || workflow.outputs?.generatedMusicUrl || "").trim() || undefined,
        voiceUrl: s(b.voiceUrl || workflow.outputs?.voiceUrl || workflow.outputs?.generatedVoiceUrl || "").trim() || undefined,
        musicStartSec: Number.isFinite(musicStartSec) && musicStartSec >= 0 ? musicStartSec : undefined,
        musicEndSec: Number.isFinite(musicEndSec) && musicEndSec > 0 ? musicEndSec : undefined,
        musicVolume: Number.isFinite(musicVolume) ? Math.max(0, musicVolume) : undefined,
        voiceVolume: Number.isFinite(voiceVolume) ? Math.max(0, voiceVolume) : undefined,
        musicFadeInSec: Number.isFinite(musicFadeInSec) && musicFadeInSec >= 0 ? musicFadeInSec : undefined,
        musicFadeOutSec: Number.isFinite(musicFadeOutSec) && musicFadeOutSec >= 0 ? musicFadeOutSec : undefined,
      });
      const next = saveWorkflowPatch(workflow, {
        currentStep: "render",
        status: "done",
        outputs: {
          finalVideoUrl,
          sceneVideos,
          musicStartSec: Number.isFinite(musicStartSec) && musicStartSec >= 0 ? musicStartSec : 0,
          musicEndSec: Number.isFinite(musicEndSec) && musicEndSec > 0 ? musicEndSec : 0,
          musicVolume: Number.isFinite(musicVolume) ? Math.max(0, musicVolume) : 0.35,
          voiceVolume: Number.isFinite(voiceVolume) ? Math.max(0, voiceVolume) : 1,
          musicFadeInSec: Number.isFinite(musicFadeInSec) && musicFadeInSec >= 0 ? musicFadeInSec : 0,
          musicFadeOutSec: Number.isFinite(musicFadeOutSec) && musicFadeOutSec >= 0 ? musicFadeOutSec : 0,
          includeSceneVoiceIndexes,
          renderProvider: "workflow-render",
          renderIsFallback: false,
          renderErrorMessage: "",
        },
      });
      return res.status(200).json({ ok: true, workflow: next, finalVideoUrl });
    }

    /**
     * 漫剧成片坞：各集 clip → 配乐 → 同源 Final Render 拼成长片。
     * Body: { clips?: [...], sceneVideos?: [...], musicUrl?, musicPrompt?, topic?, seriesTitle?, logline?, musicDuration? }
     */
    if (opNormalized === "manhuaassemblefinal") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      // 同步调试入口；正式前台走 POST /api/jobs 入队 + GET 轮询（见 manhua_assemble_final worker）
      try {
        const { runManhuaAssembleFinal } = await import("../server/services/manhuaAssembleFinalService.js");
        const result = await runManhuaAssembleFinal({
          clips: Array.isArray(b.clips) ? b.clips : undefined,
          sceneVideos: Array.isArray(b.sceneVideos) ? b.sceneVideos : undefined,
          episodeIndexes: Array.isArray(b.episodeIndexes) ? b.episodeIndexes : undefined,
          musicUrl: s(b.musicUrl).trim() || undefined,
          musicPrompt: s(b.musicPrompt).trim() || undefined,
          topic: s(b.topic),
          seriesTitle: s(b.seriesTitle),
          logline: s(b.logline),
          musicDuration: Number(b.musicDuration) || undefined,
          musicProvider: s(b.musicProvider).trim() || undefined,
          musicVolume: Number(b.musicVolume),
          musicFadeInSec: Number(b.musicFadeInSec),
          musicFadeOutSec: Number(b.musicFadeOutSec),
          transition: s(b.transition).trim() || undefined,
          resolution: s(b.resolution).trim() || undefined,
        });
        return res.status(200).json({ ok: true, ...result });
      } catch (error: any) {
        const code = s(error?.code).trim() || "manhua_assemble_failed";
        const msg = error?.message || String(error) || "assemble failed";
        const status = code === "manhua_assemble_no_clips" ? 400 : 502;
        return res.status(status).json(fail(code, msg));
      }
    }

    if (opNormalized === "generatevoice") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }

      const dialogueText = s(b.dialogueText || b.text).trim();
      const voicePrompt = buildVoicePrompt({
        dialogueText,
        style: [s(b.voicePrompt).trim(), s(b.voiceStyle).trim()].filter(Boolean).join("，"),
        language: s(b.language || "中文").trim() || "中文",
      });
      const voice = s(b.voice || "nova").trim() || "nova";
      const voiceType = s(b.voiceType || "female").trim() || "female";
      const voiceStyle = s(b.voiceStyle).trim();
      const workflowId = s(b.workflowId).trim();

      const voiceResult = await generateSceneVoice({ dialogueText, voicePrompt, voice, voiceType, voiceStyle });
      let workflow: any = undefined;
      if (workflowId) {
        const current = getCoreWorkflow(workflowId);
        if (current) {
          workflow = {
            ...current,
            updatedAt: Date.now(),
            outputs: {
              ...(current.outputs || {}),
              dialogueText,
              voicePrompt,
              voiceProvider: voiceResult.voiceProvider,
              voiceModel: voiceResult.voiceModel,
              voiceVoice: voiceResult.voiceVoice,
              voiceUrl: voiceResult.voiceUrl,
              voiceIsFallback: voiceResult.voiceIsFallback,
              voiceErrorMessage: voiceResult.voiceErrorMessage,
              voiceType,
              voiceStyle,
            },
          };
          saveCoreWorkflow(workflow as any);
        }
      }

      return res.status(200).json({
        ok: true,
        ...voiceResult,
        workflow,
      });
    }

    if (op === "scriptGenerate") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const prompt = s(b.prompt).trim();
      if (!prompt) return res.status(400).json({ ok: false, error: "missing prompt" });
      const generated = await generateScriptOnlyViaPromptBuilder({
        prompt,
        targetWords: Number(b.targetWords || 0) || undefined,
        targetScenes: Number(b.targetScenes || 0) || undefined,
        sceneDuration: Number(b.sceneDuration || 0) || undefined,
      });

      return res.status(200).json({
        ok: true,
        script: generated.script,
        provider: generated.provider,
        model: generated.model,
      });
    }

    if (op === "bananaGenerate" || op === "falImageGenerate" || op === "falImage") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const prompt = s(b.prompt).trim();
      const numImages = Number(b.numImages || 1);
      const aspectRatio = s(b.aspectRatio || "auto");
      if (!prompt) return res.status(400).json({ ok: false, error: "missing prompt" });

      const result = await generateImageWithBanana({ prompt, numImages, aspectRatio });
      return res.status(200).json({
        ok: true,
        ...result,
        imageUrl: result.imageUrls[0] || null,
      });
    }

    /** /canvas 自由画布 · GPT-Image-2（OpenAI → OpenRouter）；勿与 workflowGenerateSceneImage 混淆 */
    if (opNormalized === "canvasgptimage2") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      // 四审 P0-1:成图所有权在交付时由服务端登记,登记需要真实 userId → 出图要求登录
      const imageViewer = await resolveJobUser(req);
      if (!imageViewer) {
        return res.status(401).json({ ok: false, error: "请先登录后再出图" });
      }
      const prompt = s(b.prompt || b.scenePrompt || "").trim();
      if (!prompt) return res.status(400).json({ ok: false, error: "missing prompt" });
      const aspectRatio = s(b.aspectRatio || "9:16") === "16:9" ? "16:9" : "9:16";
      const referenceImageUrl = s(b.referenceImageUrl || b.imageUrl || "").trim();
      const referenceImageUrlsRaw = Array.isArray(b.referenceImageUrls)
        ? (b.referenceImageUrls as unknown[])
            .map((u) => s(u).trim())
            .filter(Boolean)
        : [];
      const referenceImageUrls = Array.from(
        new Set([referenceImageUrl, ...referenceImageUrlsRaw].filter(Boolean)),
      ).slice(0, 16);
      const maskUrl = s(b.maskUrl || b.editMaskUrl || "").trim();
      const generalImageEdit =
        Boolean(b.generalImageEdit) ||
        s(b.imageMode || "").toLowerCase() === "edit" ||
        referenceImageUrls.length > 0;
      const providerRaw = s(b.provider || b.gptImage2Provider || "").trim().toLowerCase();
      const providerOverride =
        providerRaw === "openai" || providerRaw === "openrouter" || providerRaw === "auto"
          ? (providerRaw as "openai" | "openrouter" | "auto")
          : undefined;
      const laneRaw = s(b.imageLane || "").trim().toLowerCase();
      const imageLane = laneRaw === "asset" || laneRaw === "keyart" ? laneRaw : undefined;
      try {
        const { generateGptImage2FromRawEnglishPrompt } = await import("../server/services/proxyImageService.js");
        const captureError: {
          message?: string;
          moderationBlocked?: boolean;
          openaiConfigured?: boolean;
          openrouterConfigured?: boolean;
          openaiError?: string;
          openrouterError?: string;
        } = {};
        const imageUrl = await generateGptImage2FromRawEnglishPrompt({
          englishPrompt: prompt,
          aspectRatio,
          gcsSubdir: "canvas-gpt-image2",
          referenceImageUrls: referenceImageUrls.length ? referenceImageUrls : undefined,
          maskUrl: maskUrl || undefined,
          // Canvas：有参考图即按通用改图，勿注入平台封面换脸指令
          generalImageEdit: referenceImageUrls.length > 0 || generalImageEdit,
          // 画布画面一律禁字；与 server/jobs/runner.ts 的画布出图保持同一口径
          onImageText: "forbid",
          providerOverride,
          imageLane,
          captureError,
        });
        if (!imageUrl) {
          return res.status(502).json({
            ok: false,
            error: captureError.message || "gpt_image2_empty",
            moderationBlocked: Boolean(captureError.moderationBlocked),
            openaiConfigured: Boolean(captureError.openaiConfigured),
            openrouterConfigured: Boolean(captureError.openrouterConfigured),
            openaiError: captureError.openaiError || null,
            openrouterError: captureError.openrouterError || null,
          });
        }
        // 四审 P0-1:交付即登记权威所有权——服务器亲手生成、亲手交给这位登录用户,
        // 这一刻是唯一不可伪造的归属证据;登记失败不阻断交付,但记日志待补。
        try {
          const { extractCanvasMediaObjectPath, registerCanvasMediaOwner } = await import(
            "../server/services/canvasMediaOwnership.js"
          );
          const objectPath = extractCanvasMediaObjectPath(imageUrl);
          if (objectPath) {
            await registerCanvasMediaOwner({
              objectPath,
              ownerUserId: imageViewer.userId,
              source: "canvasgptimage2",
            });
          }
        } catch (ownErr) {
          console.warn("[canvasgptimage2] owner register failed:", ownErr);
        }
        return res.status(200).json({ ok: true, imageUrl, imageUrls: [imageUrl] });
      } catch (e: any) {
        return res.status(502).json({ ok: false, error: e?.message || "canvas_gpt_image2_failed" });
      }
    }

    if (op === "klingT2V" || op === "klingI2V") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const model = s(b.model || "kling-video").trim();
      const prompt = s(b.prompt).trim();

      if (!COMET_KEY && (!VAK || !VSK)) {
        return res.status(500).json({ ok: false, error: "COMETAPI_KEY or KLING_CN_VIDEO_ACCESS_KEY/KLING_CN_VIDEO_SECRET_KEY is not configured" });
      }
      const videoToken = jwtHS256(VAK, VSK);

      if (op === "klingI2V" && !s(b.imageUrl).trim()) {
        return res.status(400).json({ ok: false, error: "missing imageUrl" });
      }
      if (op === "klingT2V" && !prompt) {
        return res.status(400).json({ ok: false, error: "missing prompt" });
      }

      if (op === "klingI2V") {
        if (!COMET_KEY && (!IAK || !ISK)) {
          return res.status(500).json({ ok: false, error: "COMETAPI_KEY or KLING_CN_IMAGE_ACCESS_KEY/KLING_CN_IMAGE_SECRET_KEY is not configured" });
        }
        const imageToken = jwtHS256(IAK, ISK);
        const created = await createKlingI2VTask(
          KLING_BASE,
          videoToken,
          imageToken,
          s(b.imageUrl).trim(),
          prompt || "Cinematic motion shot with stable camera and rich detail.",
          model
        );
        if (!created.taskId) {
          const rawDetail = created.raw.json ?? created.raw.rawText;
          const rawMessage =
            s((created.raw.json as any)?.message).trim() ||
            s((created.raw.json as any)?.error).trim() ||
            s((created.raw.json as any)?.detail).trim() ||
            "kling i2v task creation failed";
          return res.status(502).json({ ok: false, error: rawMessage, raw: rawDetail });
        }
        const polled = await pollKlingI2VTask(KLING_BASE, videoToken, created.taskId);
        if (!polled.ok) return res.status(502).json({ ok: false, error: polled.error });
        return res.status(200).json({ ok: true, videoUrl: polled.videoUrl, provider: "kling", model });
      }

      const created = await createKlingT2VTask(KLING_BASE, videoToken, prompt, model);
      if (!created.taskId) {
        return res.status(502).json({ ok: false, error: "kling t2v task creation failed", raw: created.raw.json ?? created.raw.rawText });
      }
      const polled = await pollKlingT2VTask(KLING_BASE, videoToken, created.taskId);
      if (!polled.ok) {
        return res.status(502).json({ ok: false, error: polled.error });
      }
      return res.status(200).json({
        ok: true,
        videoUrl: polled.videoUrl,
        provider: "kling",
        model,
      });
    }

    if (op === "aimusicSunoCreate") {
      if (!AIM_KEY) return res.status(500).json({ ok:false, error:"missing_env", detail:"AIMUSIC_API_KEY" });
      const r = await fetchJson(`${AIM_BASE}/api/v1/sonic/create`,{
        method:"POST",
        headers:{ "Authorization":"Bearer "+AIM_KEY, "Content-Type":"application/json", "Accept":"application/json" },
        body: JSON.stringify({ task_type:"create_music", custom_mode:false, mv:"sonic-v5-5", gpt_description_prompt: s(b.gpt_description_prompt || q.gpt_description_prompt || b.prompt || q.prompt || "") })
      });
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, url:r.url, raw:r.json ?? r.rawText });
    }

    if (op === "aimusicSunoTask") {
      if (!AIM_KEY) return res.status(500).json({ ok:false, error:"missing_env", detail:"AIMUSIC_API_KEY" });
      const taskId = s(q.taskId || q.task_id || b.taskId || b.task_id).trim();
      if (!taskId) return res.status(400).json({ ok:false, error:"missing_task_id" });
      const r = await fetchJson(`${AIM_BASE}/api/v1/sonic/task/${encodeURIComponent(taskId)}`,{
        method:"GET",
        headers:{ "Authorization":"Bearer "+AIM_KEY, "Accept":"application/json" }
      });
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, url:r.url, raw:r.json ?? r.rawText });
    }

    if (op === "aimusicUdioCreate") {
      if (!AIM_KEY) return res.status(500).json({ ok:false, error:"missing_env", detail:"AIMUSIC_API_KEY" });
      const desc = s(b.prompt || q.prompt || "").trim();
      const durRaw = Number(b.duration ?? q.duration ?? 60);
      const duration = Math.max(30, Math.min(120, Number.isFinite(durRaw) ? Math.floor(durRaw) : 60));
      const r = await fetchJson(`${AIM_BASE}/api/v1/nuro/create`,{
        method:"POST",
        headers:{ "Authorization":"Bearer "+AIM_KEY, "Content-Type":"application/json", "Accept":"application/json" },
        body: JSON.stringify({
          type: "bgm",
          version: "v2.0",
          description: truncateText(desc || "instrumental background music", 200),
          duration,
        }),
      });
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, url:r.url, raw:r.json ?? r.rawText });
    }

    if (op === "aimusicUdioTask") {
      if (!AIM_KEY) return res.status(500).json({ ok:false, error:"missing_env", detail:"AIMUSIC_API_KEY" });
      const taskId = s(q.taskId || q.task_id || b.taskId || b.task_id).trim();
      if (!taskId) return res.status(400).json({ ok:false, error:"missing_task_id" });
      const r = await fetchJson(`${AIM_BASE}/api/v1/nuro/task/${encodeURIComponent(taskId)}`,{
        method:"GET",
        headers:{ "Authorization":"Bearer "+AIM_KEY, "Accept":"application/json" }
      });
      const rawOut = normalizeNuroPollJson(r.json ?? null) ?? r.rawText;
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, url:r.url, raw: rawOut });
    }

    /**
     * Seedance：产品档 2.0 / 2.0-fast → OpenRouter（不回退 EvoLink）。
     * 已去掉产品侧 Mini 选项；仅 `probe=1` 内部探针可走 EvoLink Mini。
     * 2.5 仍走独立 op=seedance25。
     */
    /** 成片静音检测 → 建议细剪进出点（MVP，无大模型） */
    if (op === "suggestClipCuts") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const videoUrl = s(b.videoUrl || q.videoUrl || "").trim();
      if (!/^https:\/\//i.test(videoUrl)) {
        return res.status(400).json({ ok: false, error: "请提供成片 HTTPS 地址" });
      }
      const rawShots = Array.isArray(b.shots) ? b.shots : [];
      const shots = rawShots
        .map((row: any) => ({
          shotIndex: Math.floor(Number(row?.shotIndex) || 0),
          durationSec: Number(row?.durationSec) || 0,
        }))
        .filter((row: { shotIndex: number; durationSec: number }) => row.shotIndex >= 1);
      const directorPrompt = s(b.directorPrompt || q.directorPrompt || "").trim();
      try {
        const { suggestManhuaClipCutsFromVideo } = await import(
          "../server/services/manhuaSuggestClipCuts.js"
        );
        const out = await suggestManhuaClipCutsFromVideo({
          videoUrl,
          shots,
          directorPrompt: directorPrompt || undefined,
        });
        return res.status(200).json({
          ok: true,
          durationSec: out.durationSec,
          speechRegions: out.speechRegions,
          segmentTrim: out.segmentTrim,
          segmentLabelZh: out.segmentLabelZh,
          fineCutByShot: out.fineCutByShot,
          windows: out.windows,
          windowSource: out.windowSource,
          shotPieces: out.shotPieces,
        });
      } catch (e: any) {
        const msg = String(e?.message || "suggest_failed");
        return res.status(502).json({
          ok: false,
          error:
            /ffmpeg|ffprobe|ENOENT/i.test(msg)
              ? "切点分析失败，请稍后重试"
              : msg.includes("download")
                ? "成片下载失败，请稍后重试"
                : "切点分析失败，请稍后重试",
        });
      }
    }

    /** 从有声成片抠参考音色 mp3（挂到 @角色 声线锁） */
    if (op === "extractClipAudio") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const videoUrl = s(b.videoUrl || q.videoUrl || "").trim();
      const startSec = Number(b.startSec ?? q.startSec ?? 0);
      const durationSec = Number(b.durationSec ?? q.durationSec ?? 8);
      if (!/^https:\/\//i.test(videoUrl)) {
        return res.status(400).json({ ok: false, error: "请提供成片 HTTPS 地址" });
      }
      try {
        const { extractManhuaClipAudioToGcs } = await import(
          "../server/services/manhuaExtractClipAudio.js"
        );
        const out = await extractManhuaClipAudioToGcs({
          videoUrl,
          startSec,
          durationSec,
        });
        return res.status(200).json({
          ok: true,
          audioUrl: out.audioUrl,
          gcsUri: out.gcsUri,
          startSec: out.startSec,
          durationSec: out.durationSec,
          bytes: out.bytes,
        });
      } catch (e: any) {
        const msg = String(e?.message || "extract_failed");
        return res.status(502).json({
          ok: false,
          error:
            /ffmpeg|ENOENT/i.test(msg)
              ? "音频提取失败，请稍后重试"
              : msg.includes("download")
                ? "成片下载失败，请稍后重试"
                : "音频提取失败，请稍后重试",
        });
      }
    }

    /** 成片左上角标后期修补（本地 ffmpeg，不走上游无标导出） */
    if (op === "eraseAiCornerMark") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const videoUrl = s(b.videoUrl || q.videoUrl || "").trim();
      if (!/^https:\/\//i.test(videoUrl)) {
        return res.status(400).json({ ok: false, error: "请提供成片 HTTPS 地址" });
      }
      try {
        const { eraseAiCornerMarkToGcs } = await import(
          "../server/services/eraseAiCornerMark.js"
        );
        const out = await eraseAiCornerMarkToGcs({ videoUrl });
        return res.status(200).json({
          ok: true,
          videoUrl: out.videoUrl,
          gcsUri: out.gcsUri,
          bytes: out.bytes,
          width: out.width,
          height: out.height,
          roi: out.roi,
        });
      } catch (e: any) {
        const msg = String(e?.message || "erase_failed");
        return res.status(502).json({
          ok: false,
          error:
            /ffmpeg|ffprobe|ENOENT/i.test(msg)
              ? "清除角标失败，请稍后重试"
              : /download/i.test(msg)
                ? "成片下载失败，请稍后重试"
                : /too_large/i.test(msg)
                  ? "成片过大，请缩短后再试"
                  : "清除角标失败，请稍后重试",
        });
      }
    }

    if (op === "manhuaCropSheet2x2") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const sheetUrl = s(b.sheetUrl || q.sheetUrl || "").trim();
      if (!/^https:\/\//i.test(sheetUrl)) {
        return res.status(400).json({ ok: false, error: "请提供拼板 HTTPS 地址" });
      }
      try {
        const { cropManhuaSheet2x2ToGcs } = await import(
          "../server/services/manhuaSheetGridCrop.js"
        );
        const tiles = await cropManhuaSheet2x2ToGcs({
          sheetUrl,
          objectPrefix: s(b.objectPrefix || q.objectPrefix || "").trim() || undefined,
        });
        return res.status(200).json({
          ok: true,
          tiles: tiles.map((t) => ({
            slot: t.slot,
            labelZh: t.labelZh,
            url: t.url,
            bytes: t.bytes,
          })),
        });
      } catch (e: any) {
        const msg = String(e?.message || "crop_failed");
        return res.status(502).json({
          ok: false,
          error: /download/i.test(msg)
            ? "拼板下载失败，请稍后重试"
            : /too_small|invalid/i.test(msg)
              ? "这张图不是四格拼板，无法切分"
              : "拼板切分失败，请稍后重试",
        });
      }
    }

    /**
     * 视频高清放大（WaveSpeed · ByteDance Video Upscaler）。
     *
     * **不绑漫剧**：自由画布的单条成片、合成后的整集、用户自己上传的视频都能走这条，
     * 单独按秒计费。有人就是拿 2.5 出单条视频、根本不做漫剧，这条也得赚得到。
     *
     * 为什么必须有：**2K 在 Seedance 全系不存在**（上游枚举只有 480p/720p/1080p/4K），
     * 2.5 更是只到 720p —— 用最贵的模型反而卡在最低画质。超分把 720p 补到 2K/4K，
     * 成本只占总花费的 12.7%（4K 超分 $0.0288/秒 vs 原生 4K 生成 $1.0126/秒）。
     */
    if (op === "videoUpscale") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const {
        canWavespeedUpscale,
        normalizeWavespeedUpscaleTarget,
      } = await import("../shared/wavespeedVideoUpscaleModels.js");
      const { canvasVideoUpscaleCredits } = await import("../shared/canvasGenerationPricing.js");
      const { isWavespeedUpscaleConfigured } = await import(
        "../server/services/wavespeedVideoUpscale.js"
      );
      if (!isWavespeedUpscaleConfigured()) {
        return res.status(503).json({ ok: false, error: "高清放大暂不可用，请稍后重试" });
      }

      const videoUrl = s(b.videoUrl || b.url || q.videoUrl || "").trim();
      if (!/^https?:\/\//i.test(videoUrl)) {
        return res.status(400).json({ ok: false, error: "请提供一条可访问的视频地址" });
      }
      const target = normalizeWavespeedUpscaleTarget(b.target ?? b.resolution ?? q.target);
      if (!target || target === "1080p") {
        return res.status(400).json({ ok: false, error: "高清放大目标只支持 2K 或 4K" });
      }
      const sourceResolution = s(b.sourceResolution || q.sourceResolution || "720p").trim();
      if (!canWavespeedUpscale(sourceResolution, target)) {
        return res.status(400).json({
          ok: false,
          error: `${sourceResolution} 无法放大到 ${target.toUpperCase()}；已是该档或更高时无需放大`,
        });
      }
      const durationSec = Math.max(1, Math.round(Number(b.durationSec ?? q.durationSec) || 0));
      if (!durationSec) {
        return res.status(400).json({ ok: false, error: "请提供视频时长（秒）" });
      }

      /**
       * 按秒计费：整集合成后跑一次是主流用法，不能按条收。
       * 无 episodeIndex 即视作自由画布散客，按 1.1 倍零售价——批发价与零售价不同价。
       */
      const isFreeform = !(Number(b.episodeIndex) > 0);
      const credits = canvasVideoUpscaleCredits(target, durationSec, { freeform: isFreeform });
      const label = `高清放大·${target.toUpperCase()}（${durationSec}s）`;
      const viewer = await resolveJobUser(req);
      if (!viewer) return res.status(401).json({ ok: false, error: "请先登录后再使用高清放大" });

      /**
       * 异步任务化（原先同步等上游 3–10+ 分钟，部署重启会「钱扣了、退款逻辑随进程
       * 一起死」）。幂等键缺省用「用户+源视频+档位」这个天然业务键：同一条片升同一档，
       * POST 重试/断线重发都只有一笔扣费一个任务。既有任务 failed（已退分）时放行重开。
       */
      const idemKey =
        s(b.idempotencyKey || "").trim() || `upscale:${videoUrl}:${target}`;
      const marker = chargeMarkerFor(viewer.userId, idemKey);
      const { deductCreditsAmount, refundCredits } = await import("../server/credits.js");
      let charged = 0;
      let reusedPriorCharge = false;
      let deduct: PaidJobDeductSnapshot | undefined;
      const prior = await findPriorChargeByMarker(viewer.userId, marker);
      if (prior) {
        charged = prior.credits;
        deduct = prior.deduct;
        reusedPriorCharge = true;
      } else {
        try {
          const out = await deductCreditsAmount(
            viewer.userId,
            credits,
            "canvasVideoClip",
            `${label} ${marker}`,
            // DB 唯一键：并发重试双扣的最后防线（第五轮复审 P0·7）
            { chargeKey: marker },
          );
          charged = out.cost;
          deduct = {
            source: out.source,
            teamId: "teamId" in out ? out.teamId : undefined,
            teamMemberId: "teamMemberId" in out ? out.teamMemberId : undefined,
          };
        } catch (deductError) {
          const { InsufficientCreditsError } = await import("../server/credits.js");
          if (deductError instanceof InsufficientCreditsError) {
            return res.status(402).json({
              ok: false,
              error: `积分不足：本次高清放大需要 ${credits} 积分`,
            });
          }
          console.error("[videoUpscale] 扣费失败（未扣费）:", deductError);
          return res.status(503).json({ ok: false, error: "扣费服务暂不可用，本次未扣费，请稍后重试" });
        }
      }
      try {
        const { createCanvasVideoTask } = await import("../server/services/canvasVideoTask.js");
        const task = await createCanvasVideoTask({
          userId: viewer.userId,
          creditsCharged: charged,
          engine: "wavespeed-upscale",
          label,
          prompt: "",
          duration: durationSec,
          resolution: target,
          idempotencyKey: idemKey,
          deduct,
          upscaleSourceUrl: videoUrl,
          upscaleTarget: target,
        });
        return res.status(200).json({
          ok: true,
          async: true,
          taskId: task.taskId,
          status: task.status,
          target,
          durationSec,
          creditsUsed: task.creditsCharged || charged,
          provider: "wavespeed",
          videoUrl: task.videoUrl || undefined,
        });
      } catch (error: unknown) {
        // 只退本请求周期新扣的那笔；复用的旧扣费属于上一次周期，乱退会与其任务对不上账。
        // 统一走账本两阶段退款：按 deduct 同源退（团队不退个人）、失败有 durable 兜底
        let refundNote = "";
        if (charged > 0 && !reusedPriorCharge) {
          const outcome = await refundCanvasChargeOnCreateFail(
            { userId: viewer.userId, credits: charged, deduct, chargeKey: marker },
            label,
          );
          refundNote =
            outcome === "refunded"
              ? "（费用已退回）"
              : outcome === "pending"
                ? "（退款处理中，将自动补退）"
                : "（退款受阻已记录，需人工对账）";
        }
        return res.status(502).json({
          ok: false,
          error: (error instanceof Error ? error.message : "高清放大失败，请稍后重试") + refundNote,
        });
      }
    }

    /**
     * MiniMax H3（Hailuo 3）· OpenRouter POST /api/v1/videos。
     * 画布 videoModel=minimax-hailuo-3；不走 EvoLink。
     */
    if (op === "hailuo3Video") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      // 成片一段真金白银（2K · 15s），未登录不得起片
      if (!(await resolveJobUser(req))) {
        return res.status(401).json({ ok: false, error: "请先登录后再生成成片" });
      }
      const prompt =
        s(b.prompt || q.prompt || "").trim() || "Cinematic motion shot with stable camera and rich detail.";
      const imageUrl = s(b.imageUrl || q.imageUrl || "").trim() || undefined;
      const imageUrls = Array.isArray(b.imageUrls)
        ? b.imageUrls.map((u: unknown) => s(u)).filter(Boolean)
        : undefined;
      const aspectRatio = s(b.aspectRatio || q.aspectRatio || "16:9").trim() || "16:9";
      const generateAudio = !(
        String(b.generateAudio ?? q.generateAudio ?? "1").trim() === "0" || b.generateAudio === false
      );
      try {
        const { isOpenRouterHailuoConfigured } = await import(
          "../server/services/openrouterHailuoVideo.js"
        );
        if (!isOpenRouterHailuoConfigured()) {
          return res.status(503).json({
            ok: false,
            error: "视频服务暂不可用，请稍后重试",
          });
        }
        const {
          CANVAS_VIDEO_MODEL_HAILUO_H3,
          clampHailuoOpenRouterDuration,
          normalizeHailuoOpenRouterResolution,
        } = await import("../shared/hailuoOpenRouterModels.js");
        /**
         * 时长三档 5/10/15，画质两档 768p/2K（用户 2026-08-09 拍板）。
         * 认不出一律回落 15s / 768p——宁可便宜出片，不要按高清收钱却拿不到高清。
         */
        const duration = clampHailuoOpenRouterDuration(b.duration ?? q.duration);
        const resolution = normalizeHailuoOpenRouterResolution(
          b.videoResolution ?? b.resolution ?? q.resolution,
        );
        /**
         * 只算一次，label / 扣费 / 任务参数 / 响应全用它，避免四处各归一化一遍再漂移。
         * 计价表没有 768p 档，H3 草稿档折到 720p 价；2K 才按 2K 收。
         */
        const billedResolution = resolution === "2K" ? "2K" : "720p";
        const label = `画布成片·H3（${resolution}·${duration}s）`;
        const requestKey =
          s(b.idempotencyKey || q.idempotencyKey || "").trim() ||
          `srvh3_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
        const charged = await chargeCanvasVideoCredits(req, {
          idempotencyKey: requestKey,
          durationSec: duration,
          episodeIndex: b.episodeIndex,
          label,
          resolution: billedResolution,
          videoModel: CANVAS_VIDEO_MODEL_HAILUO_H3,
        });
        if (!charged.ok) {
          return res.status(charged.status).json({ ok: false, error: charged.error });
        }
        try {
          const { createCanvasVideoTask } = await import("../server/services/canvasVideoTask.js");
          const task = await createCanvasVideoTask({
            userId: charged.userId,
            creditsCharged: charged.credits,
            deduct: charged.deduct,
            idempotencyKey: requestKey,
            engine: "hailuo-openrouter",
            label,
            prompt,
            imageUrl,
            imageUrls,
            aspectRatio,
            duration,
            resolution,
            generateAudio,
          });
          return res.status(200).json({
            ok: true,
            async: true,
            taskId: task.taskId,
            status: task.status,
            videoUrl: task.videoUrl || undefined,
            provider: "openrouter",
            version: "hailuo-3",
            resolution,
            creditsUsed: charged.credits,
          });
        } catch (error: any) {
          const refundOutcome = await refundCanvasChargeOnCreateFail(charged, label);
          if (error instanceof Error && refundOutcome !== "skipped") {
            error.message +=
              refundOutcome === "refunded"
                ? "（费用已退回）"
                : refundOutcome === "pending"
                  ? "（退款处理中，将自动补退）"
                  : "（退款受阻已记录，需人工对账）";
          }
          throw error;
        }
      } catch (e: any) {
        return res.status(502).json({ ok: false, error: e?.message || "hailuo3_failed" });
      }
    }

    /**
     * Happy Horse 1.1 · OpenRouter。
     * 画布 videoModel=happyhorse-1.1；首帧图生；时长钳制 5/10/15（最长 15s）。
     */
    if (op === "wan30Video") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      if (!(await resolveJobUser(req))) {
        return res.status(401).json({ ok: false, error: "请先登录后再生成成片" });
      }
      const prompt =
        s(b.prompt || q.prompt || "").trim() || "Cinematic motion shot with stable camera and rich detail.";
      const rawImages: unknown[] = Array.isArray(b.imageUrls) ? b.imageUrls : [];
      const imageUrls = rawImages
        .map((u) => s(u).trim())
        .filter((u) => /^https?:\/\//i.test(u));
      const firstImage = s(b.imageUrl || q.imageUrl || "").trim();
      if (firstImage && !imageUrls.includes(firstImage)) imageUrls.unshift(firstImage);
      if (!imageUrls.length) {
        return res.status(400).json({ ok: false, error: "Wan 3.0 成片需要至少一张参考图" });
      }
      const rawAudios: unknown[] = Array.isArray(b.audioUrls) ? b.audioUrls : [];
      const audioUrls = rawAudios
        .map((u) => s(u).trim())
        .filter((u) => /^https?:\/\//i.test(u));
      const aspectRatio = s(b.aspectRatio || q.aspectRatio || "9:16").trim() || "9:16";
      try {
        const { isWavespeedWanConfigured } = await import("../server/services/wavespeedWanVideo.js");
        if (!isWavespeedWanConfigured()) {
          return res.status(503).json({ ok: false, error: "Wan 3.0 通道暂不可用，请稍后重试" });
        }
        const { clampWan30Duration, normalizeWan30Resolution, WAN30_REFERENCE_MAX } = await import(
          "../shared/wanWavespeedModels.js"
        );
        const duration = clampWan30Duration(b.duration ?? b.durationSec ?? q.duration);
        const resolution = normalizeWan30Resolution(b.resolution || q.resolution);
        const label = `画布成片·Wan 3.0 公测（${resolution}·${duration}s·排队较长）`;
        const requestKey =
          s(b.idempotencyKey || q.idempotencyKey || "").trim() ||
          `srvwan_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
        const charged = await chargeCanvasVideoCredits(req, {
          idempotencyKey: requestKey,
          durationSec: duration,
          episodeIndex: b.episodeIndex,
          label,
          resolution,
        });
        if (!charged.ok) {
          return res.status(charged.status).json({ ok: false, error: charged.error });
        }
        try {
          const { createCanvasVideoTask } = await import("../server/services/canvasVideoTask.js");
          const task = await createCanvasVideoTask({
            userId: charged.userId,
            creditsCharged: charged.credits,
            deduct: charged.deduct,
            idempotencyKey: requestKey,
            engine: "wan30-wavespeed",
            label,
            prompt,
            imageUrl: imageUrls[0],
            imageUrls: imageUrls.slice(0, WAN30_REFERENCE_MAX.image),
            audioUrls: audioUrls.slice(0, WAN30_REFERENCE_MAX.audio),
            aspectRatio,
            duration,
            resolution,
            generateAudio: b.generateAudio !== false,
            ...(Number.isFinite(Number(b.seed)) && Number(b.seed) >= 0 && Number(b.seed) <= 2147483647
              ? { seed: Math.floor(Number(b.seed)) }
              : {}),
          });
          return res.status(200).json({
            ok: true,
            async: true,
            taskId: task.taskId,
            status: task.status,
            videoUrl: task.videoUrl || undefined,
            provider: "wavespeed",
            version: "wan-3.0",
            resolution,
            creditsUsed: charged.credits,
          });
        } catch (error: any) {
          const refundOutcome = await refundCanvasChargeOnCreateFail(charged, label);
          if (error instanceof Error && refundOutcome !== "skipped") {
            error.message +=
              refundOutcome === "refunded"
                ? "（费用已退回）"
                : refundOutcome === "pending"
                  ? "（退款处理中，将自动补退）"
                  : "（退款受阻已记录，需人工对账）";
          }
          throw error;
        }
      } catch (e: any) {
        return res.status(502).json({ ok: false, error: e?.message || "wan30_failed" });
      }
    }

    if (op === "happyHorseVideo") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      if (!(await resolveJobUser(req))) {
        return res.status(401).json({ ok: false, error: "请先登录后再生成成片" });
      }
      const prompt =
        s(b.prompt || q.prompt || "").trim() || "Cinematic motion shot with stable camera and rich detail.";
      const imageUrl = s(b.imageUrl || q.imageUrl || "").trim();
      if (!imageUrl) {
        return res.status(400).json({ ok: false, error: "Happy Horse 成片需要至少一张首帧参考图" });
      }
      const aspectRatio = s(b.aspectRatio || q.aspectRatio || "9:16").trim() || "9:16";
      try {
        const { isOpenRouterHappyHorseConfigured } = await import(
          "../server/services/openrouterHappyHorseVideo.js"
        );
        const { isBailianHappyHorseConfigured } = await import(
          "../server/services/bailianHappyHorseVideo.js"
        );
        // 0820 拍板:百炼官方为主通道,OpenRouter 兜底——任一在配即可开闸
        if (!isBailianHappyHorseConfigured() && !isOpenRouterHappyHorseConfigured()) {
          return res.status(503).json({
            ok: false,
            error: "视频服务暂不可用，请稍后重试",
          });
        }
        const {
          clampHappyHorseCanvasDuration,
          normalizeHappyHorseCanvasResolution,
        } = await import("../shared/happyHorseOpenRouterModels.js");
        const duration = clampHappyHorseCanvasDuration(b.duration ?? b.durationSec ?? q.duration);
        const resolution = normalizeHappyHorseCanvasResolution(b.resolution || q.resolution);
        const label = `画布成片·Happy Horse 1.1（${resolution}·${duration}s）`;
        const requestKey =
          s(b.idempotencyKey || q.idempotencyKey || "").trim() ||
          `srvhh_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
        const charged = await chargeCanvasVideoCredits(req, {
          idempotencyKey: requestKey,
          durationSec: duration,
          episodeIndex: b.episodeIndex,
          label,
          resolution,
        });
        if (!charged.ok) {
          return res.status(charged.status).json({ ok: false, error: charged.error });
        }
        try {
          const { createCanvasVideoTask } = await import("../server/services/canvasVideoTask.js");
          const task = await createCanvasVideoTask({
            userId: charged.userId,
            creditsCharged: charged.credits,
            deduct: charged.deduct,
            idempotencyKey: requestKey,
            engine: "happyhorse-openrouter",
            label,
            prompt,
            imageUrl,
            aspectRatio,
            duration,
            resolution,
            generateAudio: true,
          });
          return res.status(200).json({
            ok: true,
            async: true,
            taskId: task.taskId,
            status: task.status,
            videoUrl: task.videoUrl || undefined,
            provider: "openrouter",
            version: "happyhorse-1.1",
            resolution,
            creditsUsed: charged.credits,
          });
        } catch (error: any) {
          const refundOutcome = await refundCanvasChargeOnCreateFail(charged, label);
          if (error instanceof Error && refundOutcome !== "skipped") {
            error.message +=
              refundOutcome === "refunded"
                ? "（费用已退回）"
                : refundOutcome === "pending"
                  ? "（退款处理中，将自动补退）"
                  : "（退款受阻已记录，需人工对账）";
          }
          throw error;
        }
      } catch (e: any) {
        return res.status(502).json({ ok: false, error: e?.message || "happyhorse_failed" });
      }
    }

    if (op === "homePhotoAnimate") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const imageUrl = s(b.imageUrl || "").trim();
      if (!imageUrl) {
        return res.status(400).json({ ok: false, error: "请先上传一张照片" });
      }
      const duration = Number(b.duration ?? b.durationSec);
      const {
        HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION,
        isHomePhotoAnimateDuration,
        isHomePhotoAnimateResolution,
      } = await import("../shared/homePhotoTools.js");
      if (!isHomePhotoAnimateDuration(duration)) {
        return res.status(400).json({ ok: false, error: "照片动起来只支持 5、10 或 15 秒" });
      }
      const resolutionRaw = s(b.resolution || HOME_PHOTO_ANIMATE_DEFAULT_RESOLUTION).trim();
      if (!isHomePhotoAnimateResolution(resolutionRaw)) {
        return res.status(400).json({ ok: false, error: "照片动起来只支持 720p 或 1080p" });
      }
      const resolution = resolutionRaw;
      const prompt =
        s(b.prompt || "").trim().slice(0, 500) ||
        "让照片中的人物做自然、克制的微动作，保持身份、脸部特征、服装、背景与原始构图稳定；动作连贯，镜头稳定，不新增人物或物件。";
      const aspectRatio = s(b.aspectRatio || "16:9").trim() || "16:9";

      try {
        const { isOpenRouterHappyHorseConfigured } = await import(
          "../server/services/openrouterHappyHorseVideo.js"
        );
        const { isBailianHappyHorseConfigured } = await import(
          "../server/services/bailianHappyHorseVideo.js"
        );
        // 0820 拍板:百炼官方为主通道,OpenRouter 兜底——任一在配即可开闸
        if (!isBailianHappyHorseConfigured() && !isOpenRouterHappyHorseConfigured()) {
          return res.status(503).json({ ok: false, error: "视频服务暂不可用，请稍后重试" });
        }

        const viewer = await resolveJobUser(req);
        if (!viewer) {
          return res.status(401).json({ ok: false, error: "请先登录后再生成成片" });
        }
        const { resolvePaidVideoAccess } = await import("../shared/paidVideoAccess.js");
        const { deductCreditsAmount, getUserPlan, refundCredits } = await import(
          "../server/credits.js"
        );
        const { homePhotoAnimateCredits } = await import("../shared/homePhotoTools.js");
        const plan = await getUserPlan(viewer.userId).catch(() => "free");
        const access = resolvePaidVideoAccess({
          plan: String(plan || "free"),
          role: viewer.role,
        });
        if (!access.allowed) {
          return res
            .status(403)
            .json({ ok: false, error: access.message || "成片功能仅向正式会员开放" });
        }

        const creditsNeeded = homePhotoAnimateCredits(duration, resolution);
        const hpaChargeKey = `hpanim:${viewer.userId}:${Date.now().toString(36)}:${randomUUID().slice(0, 8)}`;
        let creditsCharged = 0;
        let hpaDeduct: PaidJobDeductSnapshot | undefined;
        try {
          const out = await deductCreditsAmount(
            viewer.userId,
            creditsNeeded,
            "homePhotoAnimate",
            `首页照片人物动起来（${resolution} · ${duration}s）[chargeKey:${hpaChargeKey}]`,
            { chargeKey: hpaChargeKey },
          );
          creditsCharged = out.cost;
          hpaDeduct = {
            source: out.source,
            teamId: "teamId" in out ? out.teamId : undefined,
            teamMemberId: "teamMemberId" in out ? out.teamMemberId : undefined,
          };
        } catch (deductError) {
          const { InsufficientCreditsError } = await import("../server/credits.js");
          if (deductError instanceof InsufficientCreditsError) {
            return res.status(402).json({
              ok: false,
              error: `积分不足：本次照片动画需要 ${creditsNeeded} 积分，请补充积分后重试`,
            });
          }
          console.error("[homePhotoAnimate] 扣费失败（未扣费）:", deductError);
          return res.status(503).json({ ok: false, error: "扣费服务暂不可用，本次未扣费，请稍后重试" });
        }

        // 异步：扣费后立刻落盘并提交上游，返回 taskId；客户端短轮询，部署不会掐掉整段等待。
        try {
          const { createHomePhotoAnimateTask } = await import(
            "../server/services/homePhotoAnimateTask.js"
          );
          const task = await createHomePhotoAnimateTask({
            deduct: hpaDeduct,
            userId: viewer.userId,
            creditsCharged,
            imageUrl,
            prompt,
            duration,
            resolution,
            aspectRatio,
          });
          console.info(
            `[homePhotoAnimate] accepted taskId=${task.taskId} duration=${duration}s resolution=${resolution} credits=${creditsCharged}`,
          );
          return res.status(200).json({
            ok: true,
            async: true,
            taskId: task.taskId,
            status: task.status,
            duration,
            resolution,
            creditsUsed: creditsCharged,
            videoUrl: task.videoUrl || undefined,
          });
        } catch (error: any) {
          const outcome = await refundCanvasChargeOnCreateFail(
            { userId: viewer.userId, credits: creditsCharged, deduct: hpaDeduct, chargeKey: hpaChargeKey },
            "首页照片人物动起来",
          );
          if (error instanceof Error && outcome !== "skipped") {
            error.message +=
              outcome === "refunded"
                ? "（费用已退回）"
                : outcome === "pending"
                  ? "（退款处理中，将自动补退）"
                  : "（退款受阻已记录，需人工对账）";
          }
          throw error;
        }
      } catch (error: any) {
        const message = String(error?.message || "照片动起来失败，请稍后重试");
        console.error("[homePhotoAnimate] failed", message);
        return res.status(502).json({
          ok: false,
          error: message,
        });
      }
    }

    if (op === "homePhotoAnimateStatus") {
      if (req.method !== "GET" && req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const taskId = s(b.taskId || q.taskId || "").trim();
      if (!taskId) {
        return res.status(400).json({ ok: false, error: "缺少任务编号" });
      }
      const viewer = await resolveJobUser(req);
      if (!viewer) {
        return res.status(401).json({ ok: false, error: "请先登录后再查询进度" });
      }
      try {
        const { getHomePhotoAnimateTask } = await import(
          "../server/services/homePhotoAnimateTask.js"
        );
        const task = await getHomePhotoAnimateTask(taskId, viewer.userId);
        if (!task) {
          return res.status(404).json({ ok: false, error: "任务不存在或无权查看" });
        }
        return res.status(200).json({
          ok: true,
          taskId: task.taskId,
          status: task.status,
          videoUrl: task.videoUrl || undefined,
          error: task.error || undefined,
          duration: task.duration,
          resolution: task.resolution,
          creditsUsed: task.creditsCharged,
        });
      } catch (error: any) {
        return res.status(502).json({
          ok: false,
          error: error?.message || "查询照片动画进度失败",
        });
      }
    }

    if (op === "homePhotoUpscale") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const imageUrl = s(b.imageUrl || "").trim();
      if (!imageUrl) {
        return res.status(400).json({ ok: false, error: "请先上传一张照片" });
      }
      const upscaleFactorRaw = s(b.upscaleFactor || "").trim();
      if (upscaleFactorRaw !== "x2" && upscaleFactorRaw !== "x4") {
        return res.status(400).json({ ok: false, error: "仅支持 2× 或 4× 高清放大" });
      }
      const upscaleFactor = upscaleFactorRaw as "x2" | "x4";
      const qualityWarningAccepted = b.qualityWarningAccepted === true;
      const sourceBlurScore =
        typeof b.sourceBlurScore === "number" && Number.isFinite(b.sourceBlurScore)
          ? Number(b.sourceBlurScore)
          : undefined;

      try {
        const { isImageUpscaleConfigured } = await import(
          "../server/services/geminiApiImageUpscale.js"
        );
        if (!isImageUpscaleConfigured(upscaleFactor)) {
          return res.status(503).json({ ok: false, error: "高清放大服务暂不可用，请稍后重试" });
        }

        const viewer = await resolveJobUser(req);
        if (!viewer) {
          return res.status(401).json({ ok: false, error: "请先登录后再高清放大" });
        }
        const { deductCreditsAmount, refundCredits } = await import("../server/credits.js");
        const { imageUpscaleTotalCredits } = await import("../shared/plans.js");
        const creditsNeeded = imageUpscaleTotalCredits("homePhotoUpscaleBase", upscaleFactor);

        const hpuChargeKey = `hpupscale:${viewer.userId}:${Date.now().toString(36)}:${randomUUID().slice(0, 8)}`;
        let creditsCharged = 0;
        let hpuDeduct: PaidJobDeductSnapshot | undefined;
        try {
          const out = await deductCreditsAmount(
            viewer.userId,
            creditsNeeded,
            "imageUpscale",
            `首页照片高清放大 ${upscaleFactor}${
              qualityWarningAccepted ? "；已确认原图模糊风险提示" : ""
            }[chargeKey:${hpuChargeKey}]`,
            { chargeKey: hpuChargeKey },
          );
          creditsCharged = out.cost;
          hpuDeduct = {
            source: out.source,
            teamId: "teamId" in out ? out.teamId : undefined,
            teamMemberId: "teamMemberId" in out ? out.teamMemberId : undefined,
          };
        } catch (deductError) {
          const { InsufficientCreditsError } = await import("../server/credits.js");
          if (deductError instanceof InsufficientCreditsError) {
            return res.status(402).json({
              ok: false,
              error: `积分不足：本次高清放大需要 ${creditsNeeded} 积分，请补充积分后重试`,
            });
          }
          console.error("[homePhotoUpscale] 扣费失败（未扣费）:", deductError);
          return res.status(503).json({ ok: false, error: "扣费服务暂不可用，本次未扣费，请稍后重试" });
        }

        try {
          const { createHomePhotoUpscaleTask } = await import(
            "../server/services/homePhotoUpscaleTask.js"
          );
          const task = await createHomePhotoUpscaleTask({
            deduct: hpuDeduct,
            userId: viewer.userId,
            creditsCharged,
            imageUrl,
            upscaleFactor,
            qualityWarningAccepted,
            sourceBlurScore,
          });
          console.info(
            `[homePhotoUpscale] accepted taskId=${task.taskId} factor=${upscaleFactor} credits=${creditsCharged}`,
          );
          return res.status(200).json({
            ok: true,
            async: true,
            taskId: task.taskId,
            status: task.status,
            upscaleFactor,
            creditsUsed: creditsCharged,
            imageUrl: task.resultImageUrl || undefined,
          });
        } catch (error: any) {
          const outcome = await refundCanvasChargeOnCreateFail(
            { userId: viewer.userId, credits: creditsCharged, deduct: hpuDeduct, chargeKey: hpuChargeKey },
            "首页照片高清放大",
          );
          if (error instanceof Error && outcome !== "skipped") {
            error.message +=
              outcome === "refunded"
                ? "（费用已退回）"
                : outcome === "pending"
                  ? "（退款处理中，将自动补退）"
                  : "（退款受阻已记录，需人工对账）";
          }
          throw error;
        }
      } catch (error: any) {
        const message = String(error?.message || "高清放大失败，请稍后重试");
        console.error("[homePhotoUpscale] failed", message);
        return res.status(502).json({ ok: false, error: message });
      }
    }

    if (op === "homePhotoUpscaleStatus") {
      if (req.method !== "GET" && req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const taskId = s(b.taskId || q.taskId || "").trim();
      if (!taskId) {
        return res.status(400).json({ ok: false, error: "缺少任务编号" });
      }
      const viewer = await resolveJobUser(req);
      if (!viewer) {
        return res.status(401).json({ ok: false, error: "请先登录后再查询进度" });
      }
      try {
        const { getHomePhotoUpscaleTask } = await import(
          "../server/services/homePhotoUpscaleTask.js"
        );
        const task = await getHomePhotoUpscaleTask(taskId, viewer.userId);
        if (!task) {
          return res.status(404).json({ ok: false, error: "任务不存在或无权查看" });
        }
        return res.status(200).json({
          ok: true,
          taskId: task.taskId,
          status: task.status,
          imageUrl: task.resultImageUrl || undefined,
          error: task.error || undefined,
          upscaleFactor: task.upscaleFactor,
          creditsUsed: task.creditsCharged,
          inputWidth: task.inputWidth,
          inputHeight: task.inputHeight,
          outputWidth: task.outputWidth,
          outputHeight: task.outputHeight,
        });
      } catch (error: any) {
        return res.status(502).json({
          ok: false,
          error: error?.message || "查询高清放大进度失败",
        });
      }
    }

    if (op === "seedanceI2V") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const prompt =
        s(b.prompt || q.prompt || "").trim() || "Cinematic motion shot with stable camera and rich detail.";
      const imageUrl = s(b.imageUrl || q.imageUrl || "").trim() || undefined;
      const imageUrls = Array.isArray(b.imageUrls)
        ? b.imageUrls.map((u: unknown) => s(u)).filter(Boolean)
        : undefined;
      const videoUrls = Array.isArray(b.videoUrls)
        ? b.videoUrls.map((u: unknown) => s(u)).filter(Boolean)
        : undefined;
      const audioUrls = Array.isArray(b.audioUrls)
        ? b.audioUrls.map((u: unknown) => s(u)).filter(Boolean)
        : undefined;

      const {
        parseSeedanceProductVersion,
        isOpenRouterSeedanceVersion,
        normalizeSeedanceOpenRouterQuality,
      } = await import("../shared/seedanceOpenRouterModels.js");
      const { parseSeedanceVersion, normalizeSeedanceQuality } = await import(
        "../shared/seedanceEvolinkModels.js"
      );
      let isProbe =
        b.probe === true || String(b.probe ?? q.probe ?? "").trim() === "1";
      if (isProbe) {
        // 审查必须修（P0）：probe=1 曾是公网免登录免扣费的真实上游开关。
        // 收紧为须匹配服务端密钥；未配置密钥则一律拒绝探针。
        // 只收专用 header（query/body 会进网关日志与浏览器历史）；恒时比较防时序侧信道。
        const headerSecret = String(req.headers["x-canvas-probe-secret"] ?? "").trim();
        const expected = String(process.env.CANVAS_PROBE_SECRET || "").trim();
        const { timingSafeEqual, createHash: sha } = await import("node:crypto");
        const ok =
          Boolean(expected) &&
          Boolean(headerSecret) &&
          timingSafeEqual(
            sha("sha256").update(headerSecret).digest(),
            sha("sha256").update(expected).digest(),
          );
        if (!ok) {
          return res.status(403).json({ ok: false, error: "探针未授权" });
        }
      }
      const productVersion = parseSeedanceProductVersion(b.version || q.version || "2.0");
      /** Seedance 2.5 正式版：五种 EvoLink 路由，共用计费与异步任务主链。 */
      if (productVersion === "2.5") {
        const result = await runSeedance25EvolinkJob(req, b, q, "画布 Seedance 2.5");
        if (!result.ok) {
          return res.status(result.status).json({
            ok: false,
            error: result.error,
            version: "2.5",
            ...(result.paidOnly ? { paidOnly: true } : {}),
          });
        }
        return res.status(200).json({
          ok: true,
          async: true,
          taskId: result.taskId,
          status: result.status,
          videoUrl: result.videoUrl || undefined,
          version: "2.5",
          workMode: result.workMode,
          resolution: result.resolution,
          duration: result.duration,
          creditsUsed: result.credits,
        });
      }
      const aspectRatio = s(b.aspectRatio || q.aspectRatio || "16:9").trim() || "16:9";
      const generateAudio = !(
        String(b.generateAudio ?? q.generateAudio ?? "1").trim() === "0" || b.generateAudio === false
      );

      try {
        if (isOpenRouterSeedanceVersion(productVersion)) {
          const { isOpenRouterSeedanceConfigured, runOpenRouterSeedanceVideo } = await import(
            "../server/services/openrouterSeedanceVideo.js"
          );
          /**
           * 闸门顺序（审查必须修）：先识别 photoreal 信号定通道，再只校验被选中的通道。
           * 老写法先要求 OpenRouter 配置——EvoLink 可用时仿真人请求被误 503；
           * 反过来 EvoLink 缺配置时 photoreal 静默降级 OpenRouter，扣费后必撞人脸拦截。
           * 信号覆盖全部参考素材（含 videoUrls，2.0 r2v 也吃参考视频）。
           */
          const { hasPhotorealReferenceUrl: hasPhotorealSignal } = await import(
            "../shared/photorealMediaSignal.js"
          );
          const { isEvolinkSeedanceConfigured: evolinkConfigured } = await import(
            "../server/services/evolinkSeedanceVideo.js"
          );
          const isPhotorealRequest = hasPhotorealSignal([
            imageUrl,
            ...(imageUrls || []),
            ...(videoUrls || []),
          ]);
          if (isPhotorealRequest && !evolinkConfigured()) {
            return res.status(503).json({
              ok: false,
              error: "仿真人通道暂不可用，请稍后重试",
            });
          }
          if (!isPhotorealRequest && !isOpenRouterSeedanceConfigured()) {
            return res.status(503).json({
              ok: false,
              error: "视频服务暂不可用，请稍后重试",
            });
          }
          /**
           * 只算一次，label / 扣费 / 上游参数 / 响应全用同一个值。
           *
           * 之前 `normalizeSeedanceOpenRouterQuality` 对标准 2.0 会放行 "2K"/"4K"，
           * 而扣费那边又没传 videoModel，`resolveCanvasVideoResolution` 拿不到引擎就放行全档
           * —— 2K 照 388 收、照发上游，然后被 BytePlus 拒（实测：Supported values 里没有 2K）。
           * 先按引擎钳一次，再喂给 provider 的归一化，两层同源。
           */
          /**
           * 仿真人正向路由（2026-08-10）：真人照参考（photoreal 素材路径）在
           * BytePlus/OpenRouter 必被拦，老路是撞一次失败再退费。现在扣费前就按
           * 信号切 EvoLink（不拦真人脸；官方 2.0 九模型 standard/fast/mini 齐全）。
           * 标准/快速各按原档交付计费，不换档不换价。
           */
          const photorealToEvolink = isPhotorealRequest;

          const { resolveCanvasVideoResolution } = await import(
            "../shared/canvasGenerationPricing.js"
          );
          const billingVideoModel =
            productVersion === "2.0-fast"
              ? ("seedance-2.0-fast" as const)
              : ("seedance-2.0" as const);
          const requestedResolution = b.resolution || q.resolution || "720p";
          const effectiveResolution = resolveCanvasVideoResolution(
            billingVideoModel,
            requestedResolution,
          );
          // EvoLink 2.0 标准最高 1080p（fast 720p）：photoreal 下 4K 请求按最近档 1080p 交付并计费
          const resolution = photorealToEvolink
            ? normalizeSeedanceQuality(
                productVersion === "2.0-fast" ? "2.0-fast" : "2.0",
                /^4k$/i.test(String(effectiveResolution)) ? "1080p" : effectiveResolution,
              )
            : normalizeSeedanceOpenRouterQuality(productVersion, effectiveResolution);
          const duration = parseSeedanceDurationInput(
            b.duration ?? q.duration ?? b.durationSec ?? 15,
          );
          const durationSec = typeof duration === "number" ? duration : 15;
          const label = `画布成片·${productVersion === "2.0-fast" ? "快速" : "标准"}${
            photorealToEvolink ? "·仿真人" : ""
          }·${resolution}（${durationSec}s）`;
          // 探针仍走同步，方便脚本一次拿结果；正式用户走异步 task
          if (isProbe) {
            const charged = await chargeCanvasVideoAndRun(
              req,
              { durationSec, episodeIndex: b.episodeIndex, resolution, label, skipCharge: true },
              async () => {
                // 探针复用正式 provider 选择：photoreal 走 EvoLink，与真实用户同路
                if (photorealToEvolink) {
                  const { runEvolinkSeedanceVideo } = await import(
                    "../server/services/evolinkSeedanceVideo.js"
                  );
                  return runEvolinkSeedanceVideo({
                    prompt,
                    imageUrl,
                    imageUrls,
                    videoUrls,
                    audioUrls,
                    quality: resolution,
                    aspectRatio,
                    duration: durationSec,
                    generateAudio,
                    version: productVersion === "2.0-fast" ? "2.0-fast" : "2.0",
                  });
                }
                return runOpenRouterSeedanceVideo({
                  prompt,
                  imageUrl,
                  imageUrls,
                  audioUrls,
                  quality: resolution,
                  aspectRatio,
                  duration: durationSec,
                  generateAudio,
                  version: productVersion,
                });
              },
            );
            if (!charged.ok) {
              return res.status(charged.status).json({ ok: false, error: charged.error });
            }
            const out = charged.result;
            return res.status(200).json({
              ok: true,
              videoUrl: out.videoUrl,
              provider: out.provider,
              model: out.model,
              version: out.version,
              resolution,
              creditsUsed: charged.credits,
            });
          }
          const requestKey =
            s(b.idempotencyKey || q.idempotencyKey || "").trim() ||
            `srv20_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
          const charged = await chargeCanvasVideoCredits(req, {
            idempotencyKey: requestKey,
            durationSec,
            episodeIndex: b.episodeIndex,
            resolution,
            label,
            // 不传 videoModel 的话按引擎钳制拿不到引擎，等于没钳；仿真人按标准 2.0 口径
            videoModel: billingVideoModel,
          });
          if (!charged.ok) {
            return res.status(charged.status).json({ ok: false, error: charged.error });
          }
          try {
            const { createCanvasVideoTask } = await import("../server/services/canvasVideoTask.js");
            const task = await createCanvasVideoTask({
              userId: charged.userId,
              creditsCharged: charged.credits,
              deduct: charged.deduct,
              idempotencyKey: requestKey,
              engine: photorealToEvolink ? "seedance20-evolink" : "seedance-openrouter",
              label,
              prompt,
              imageUrl,
              imageUrls,
              // 连续性素材：EvoLink reference-to-video 收 0–3 条视频；OpenRouter 路径不消费无副作用
              videoUrls,
              audioUrls,
              aspectRatio,
              duration: durationSec,
              resolution,
              generateAudio,
              seedanceVersion: productVersion === "2.0-fast" ? "2.0-fast" : "2.0",
            });
            return res.status(200).json({
              ok: true,
              async: true,
              taskId: task.taskId,
              status: task.status,
              videoUrl: task.videoUrl || undefined,
              version: productVersion,
              resolution,
              creditsUsed: charged.credits,
            });
          } catch (error: any) {
            const refundOutcome = await refundCanvasChargeOnCreateFail(charged, label);
            if (error instanceof Error && refundOutcome !== "skipped") {
              error.message +=
              refundOutcome === "refunded"
                ? "（费用已退回）"
                : refundOutcome === "pending"
                  ? "（退款处理中，将自动补退）"
                  : "（退款受阻已记录，需人工对账）";
            }
            throw error;
          }
        }

        /**
         * Mini 草稿档（用户 2026-08-09 拍板产品化）。上游只有 EvoLink 有 mini 型号，
         * BytePlus ModelArk 无对应模型，所以这条没有回落路径：失败即失败退费。
         * 2.5 在本函数开头已被 runSeedance25EvolinkJob 接走，走不到这里。
         */
        const seedanceVersion = parseSeedanceVersion(productVersion);
        if (seedanceVersion !== "2.0-mini") {
          return res.status(400).json({
            ok: false,
            error: "请使用成片·草稿、成片·标准或成片·快速",
          });
        }
        const resolution = normalizeSeedanceQuality(
          seedanceVersion,
          b.resolution || q.resolution || (isProbe ? "480p" : "720p"),
        );
        const rawDuration = parseSeedanceDurationInput(
          b.duration ?? q.duration ?? b.durationSec ?? (isProbe ? 5 : 15),
        );
        const durationSec = typeof rawDuration === "number" ? rawDuration : isProbe ? 5 : 15;
        const { isEvolinkSeedanceConfigured, runEvolinkSeedanceVideo } = await import(
          "../server/services/evolinkSeedanceVideo.js"
        );
        if (!isEvolinkSeedanceConfigured()) {
          return res.status(503).json({
            ok: false,
            error: "视频服务暂不可用，请稍后重试",
          });
        }
        const label = `画布成片·草稿·${resolution}（${durationSec}s）`;
        // 探针仍走同步，方便脚本一次拿结果；正式用户走异步 task，避免 HTTP 超时
        if (isProbe) {
          const out = await runEvolinkSeedanceVideo({
            prompt,
            imageUrl,
            imageUrls,
            videoUrls,
            audioUrls,
            quality: resolution,
            aspectRatio,
            duration: durationSec,
            generateAudio,
            version: seedanceVersion,
          });
          return res.status(200).json({
            ok: true,
            videoUrl: out.videoUrl,
            provider: out.provider,
            model: out.model,
            mode: out.mode,
            version: out.version,
            resolution,
          });
        }
        const requestKey =
          s(b.idempotencyKey || q.idempotencyKey || "").trim() ||
          `srvmini_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
        const chargedMini = await chargeCanvasVideoCredits(req, {
          idempotencyKey: requestKey,
          durationSec,
          episodeIndex: b.episodeIndex,
          resolution,
          videoModel: "seedance-2.0-mini",
          label,
        });
        if (!chargedMini.ok) {
          return res.status(chargedMini.status).json({ ok: false, error: chargedMini.error });
        }
        try {
          const { createCanvasVideoTask } = await import("../server/services/canvasVideoTask.js");
          const task = await createCanvasVideoTask({
            userId: chargedMini.userId,
            creditsCharged: chargedMini.credits,
            deduct: chargedMini.deduct,
            idempotencyKey: requestKey,
            engine: "seedance-mini-evolink",
            label,
            prompt,
            imageUrl,
            imageUrls,
            videoUrls,
            audioUrls,
            aspectRatio,
            duration: durationSec,
            resolution,
            generateAudio,
            seedanceVersion: "2.0-mini",
          });
          return res.status(200).json({
            ok: true,
            async: true,
            taskId: task.taskId,
            status: task.status,
            videoUrl: task.videoUrl || undefined,
            version: "2.0-mini",
            resolution,
            creditsUsed: chargedMini.credits,
          });
        } catch (error: any) {
          const refundOutcome = await refundCanvasChargeOnCreateFail(chargedMini, label);
          if (error instanceof Error && refundOutcome !== "skipped") {
            error.message +=
              refundOutcome === "refunded"
                ? "（费用已退回）"
                : refundOutcome === "pending"
                  ? "（退款处理中，将自动补退）"
                  : "（退款受阻已记录，需人工对账）";
          }
          throw error;
        }
      } catch (e: any) {
        return res.status(502).json({ ok: false, error: e?.message || "seedance_failed" });
      }
    }

    /** Seedance 2.5 兼容入口；与 `/canvas` 共用同一条 EvoLink 五模式主链。 */
    if (op === "seedance25") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const result = await runSeedance25EvolinkJob(req, b, q, "Seedance 2.5");
      if (!result.ok) {
        return res.status(result.status).json({
          ok: false,
          error: result.error,
          version: "2.5",
          ...(result.paidOnly ? { paidOnly: true } : {}),
        });
      }
      return res.status(200).json({
        ok: true,
        async: true,
        taskId: result.taskId,
        status: result.status,
        videoUrl: result.videoUrl || undefined,
        version: "2.5",
        workMode: result.workMode,
        resolution: result.resolution,
        duration: result.duration,
        creditsUsed: result.credits,
      });
    }

    if (op === "canvasVideoStatus") {
      if (req.method !== "GET" && req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const taskId = s(b.taskId || q.taskId || "").trim();
      if (!taskId) {
        return res.status(400).json({ ok: false, error: "缺少任务编号" });
      }
      const viewer = await resolveJobUser(req);
      if (!viewer) {
        return res.status(401).json({ ok: false, error: "请先登录后再查询进度" });
      }
      try {
        const { getCanvasVideoTask } = await import("../server/services/canvasVideoTask.js");
        const task = await getCanvasVideoTask(taskId, viewer.userId);
        if (!task) {
          return res.status(404).json({ ok: false, error: "任务不存在或无权查看" });
        }
        return res.status(200).json({
          ok: true,
          taskId: task.taskId,
          status: task.status,
          videoUrl: task.videoUrl || undefined,
          error: task.error || undefined,
          engine: task.engine,
          provider: task.provider,
          model: task.model,
          workMode: task.workMode,
          resolution: task.resolution,
          duration: task.duration,
          creditsUsed: task.creditsCharged,
          // 超分任务：原片地址与目标档（结果在 videoUrl，原片不被覆盖）
          upscaleSourceUrl: task.upscaleSourceUrl || undefined,
          upscaleTarget: task.upscaleTarget || undefined,
          // 超时对账诊断：UI 把 timed_out_pending_reconcile 显示为「超时对账中，不会白扣」
          timedOutAt: task.timedOutAt || undefined,
          lastTransientError: task.lastTransientError || undefined,
        });
      } catch (error: any) {
        return res.status(502).json({
          ok: false,
          error: error?.message || "查询成片进度失败",
        });
      }
    }

    if (op === "klingCreate") {
      if (!COMET_KEY && (!VAK || !VSK)) return res.status(500).json({ ok:false, error:"missing_env", detail:"COMETAPI_KEY or KLING_CN_VIDEO_ACCESS_KEY/SECRET_KEY" });
      if (!COMET_KEY && (!IAK || !ISK)) return res.status(500).json({ ok:false, error:"missing_env", detail:"COMETAPI_KEY or KLING_CN_IMAGE_ACCESS_KEY/SECRET_KEY" });

      const videoToken = jwtHS256(VAK, VSK);
      const imageToken = jwtHS256(IAK, ISK);

      const imageUrl = s(b.imageUrl || q.imageUrl).trim();
      if (!imageUrl) return res.status(400).json({ ok:false, error:"missing_image_url" });

      const prompt = s(b.prompt || q.prompt || "");
      const duration = s(b.duration || "10");
      if (duration !== "5" && duration !== "10") return res.status(400).json({ ok:false, error:"invalid_duration", detail:duration });

      const { buffer: buf } = await fetchImageAsset(imageUrl);
      const first = await buildFirstFrameJpeg(buf, prompt, KLING_BASE, imageToken);

      const r = await fetchJson(`${KLING_BASE}/v1/videos/image2video`,{
        method:"POST",
        headers:{ "Authorization":"Bearer "+videoToken, "Content-Type":"application/json", "Accept":"application/json" },
        body: JSON.stringify({ model_name: s(b.model_name || "kling-v2-6"), image: first.jpeg.toString("base64"), prompt, duration, mode: s(b.mode || "pro"), sound: s(b.sound || "off") })
      });

      const taskId = r.json?.data?.task_id || null;
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, taskId, imageBytes:first.bytes, raw:r.json ?? r.rawText });
    }

    if (op === "klingTask") {
      if (!COMET_KEY && (!VAK || !VSK)) return res.status(500).json({ ok:false, error:"missing_env", detail:"COMETAPI_KEY or KLING_CN_VIDEO_ACCESS_KEY/SECRET_KEY" });
      const videoToken = jwtHS256(VAK, VSK);
      const taskId = s(q.taskId || q.task_id || b.taskId || b.task_id).trim();
      if (!taskId) return res.status(400).json({ ok:false, error:"missing_task_id" });

      const r = await fetchJson(`${KLING_BASE}/v1/videos/image2video/${encodeURIComponent(taskId)}`,{
        method:"GET",
        headers:{ "Authorization":"Bearer "+videoToken, "Accept":"application/json" }
      });

      const taskStatus = s(r.json?.data?.task_status || "");
      const videoUrl = r.json?.data?.task_result?.videos?.[0]?.url || null;
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, taskStatus, videoUrl, raw:r.json ?? r.rawText });
    }

    return res.status(400).json(fail("unknown_op", "unknown_op", { op }));
  } catch (e: any) {
    const message = e?.message || String(e) || "server_error";
    return res.status(500).json(fail("server_error", message));
  }
}
