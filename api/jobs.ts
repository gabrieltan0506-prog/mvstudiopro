import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { get, put } from "@vercel/blob";
import { env, getEnvStatus } from "../server/vercel-api-core/env.js";
import { renderWorkflowFinalVideo } from "../server/vercel-api-core/render.js";
import { generateImageWithBanana } from "../server/vercel-api-core/banana.js";
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
  const r = await fetchJson(`${klingBase}/v1/images/generations`,{
    method:"POST",
    headers:{ "Authorization":"Bearer "+imageToken, "Content-Type":"application/json", "Accept":"application/json" },
    body: JSON.stringify({ prompt, n: 1, image_size: "1024x576" })
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
  duration = "8"
) {
  const { buffer: buf } = await fetchImageAsset(imageUrl);
  const first = await buildFirstFrameJpeg(buf, prompt, klingBase, imageToken);
  const r = await fetchJson(`${klingBase}/v1/videos/image2video`, {
    method: "POST",
    headers: { Authorization: "Bearer " + videoToken, "Content-Type": "application/json", Accept: "application/json" },
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

async function pollKlingI2VTask(klingBase: string, videoToken: string, taskId: string, timeoutMs = 90_000) {
  const pollMs = 5_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const r = await fetchJson(`${klingBase}/v1/videos/image2video/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: { Authorization: "Bearer " + videoToken, Accept: "application/json" },
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
  const r = await fetchJson(`${klingBase}/v1/videos/text2video`, {
    method: "POST",
    headers: { Authorization: "Bearer " + videoToken, "Content-Type": "application/json", Accept: "application/json" },
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

async function pollKlingT2VTask(klingBase: string, videoToken: string, taskId: string, timeoutMs = 90_000) {
  const pollMs = 5_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const r = await fetchJson(`${klingBase}/v1/videos/text2video/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: { Authorization: "Bearer " + videoToken, Accept: "application/json" },
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
  return s(process.env.OAUTH_SERVER_URL).trim() || "https://mvstudiopro.fly.dev";
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
    model: s(process.env.VERTEX_GEMINI_MODEL || "gemini-2.5-pro").trim() || "gemini-2.5-pro",
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
    model: s(process.env.VERTEX_GEMINI_MODEL || "gemini-2.5-pro").trim() || "gemini-2.5-pro",
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
      if (inputType === "script" && !s(payload.prompt).trim()) {
        return res.status(400).json({ ok: false, error: "payload.prompt is required for script workflow" });
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
      if (!VAK || !VSK || !IAK || !ISK) {
        return res.status(500).json(fail("KLING_CN_VIDEO_ACCESS_KEY/KLING_CN_VIDEO_SECRET_KEY and KLING_CN_IMAGE_ACCESS_KEY/KLING_CN_IMAGE_SECRET_KEY are required"));
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
        "8"
      );
      if (!created.taskId) {
        return res.status(502).json(fail("kling i2v task creation failed", "kling i2v task creation failed", { raw: created.raw.json ?? created.raw.rawText }));
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
      const generated = await generateVideoWithVeo({
        scenePrompt: prompt,
        referenceImages: preparedReferenceImages,
        imageUrls: preparedReferenceImages,
      });
      if (!generated.videoUrl) {
        return res.status(502).json(fail("fal veo task creation failed", generated.errorMessage || "scene video generation failed"));
      }

      const nextStoryboardImages = upsertStoryboardImageItem(storyboardImages, sceneIndex, (existing: any) => buildSceneAssetBundle(existing, sceneIndex, {
        prompt: s(effectiveScene?.scenePrompt).trim(),
        duration: 8,
        sceneVideoUrl: s(generated.videoUrl).trim(),
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
          videoProvider: "fal",
          videoModel: "fal-ai/veo3.1/reference-to-video",
          videoErrorMessage: generated.errorMessage || "",
        },
      });
      return res.status(200).json({ ok: true, workflow: next, sceneVideoUrl: generated.videoUrl });
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
      const musicMood = s(b.musicMood || "cinematic").trim() || "cinematic";
      const musicBpm = Number(b.musicBpm || 0) || 110;
      const musicDuration = Number(b.musicDuration || 0) || 30;
      const storyboard = getStoryboardDraftFromBody(workflow, b);
      const autoMusicPrompt = deriveMusicSeedFromStoryboard(storyboard, s(b.script || workflow.outputs?.script || workflow.payload?.prompt).trim());
      const rawPrompt = truncateText(
        s(b.musicPrompt).trim() || autoMusicPrompt || s(workflow.outputs?.script).trim() || s(workflow.payload?.prompt).trim(),
        100,
      );
      if (!rawPrompt) return res.status(400).json(fail("musicPrompt is required"));
      const prompt = buildMusicPrompt({
        genre: rawPrompt,
        mood: musicMood,
        pace: s(b.musicPace || "medium-fast").trim() || "medium-fast",
        duration: musicDuration,
        hasVocal: Boolean(b.hasVocal),
        bpm: musicBpm,
      });

      const createUrl = requestedMusicProvider === "udio" ? `${AIM_BASE}/api/v1/producer/create` : `${AIM_BASE}/api/v1/sonic/create`;
      const taskUrlBase = requestedMusicProvider === "udio" ? `${AIM_BASE}/api/v1/producer/task/` : `${AIM_BASE}/api/v1/sonic/task/`;
      const createBody = requestedMusicProvider === "udio"
        ? {
            task_type: "create_music",
            mv: "FUZZ-2.0",
            title: truncateText(rawPrompt, 80) || "MV Studio Pro music",
            prompt,
            lyrics_type: Boolean(b.hasVocal) ? "generate" : "instrumental",
          }
        : {
            task_type: "create_music",
            custom_mode: false,
            mv: "sonic-v5",
            gpt_description_prompt: prompt,
          };

      const created = await fetchJson(createUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${AIM_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(createBody),
      });
      if (!created.ok) return res.status(502).json(fail("music_create_failed", "Music create request failed", { provider: requestedMusicProvider, raw: created.json ?? created.rawText }));
      const taskId = s(created.json?.data?.task_id || created.json?.task_id || created.json?.taskId || created.json?.data?.id || created.json?.id).trim();
      if (!taskId) return res.status(502).json(fail("missing_music_task_id", "Music task id is missing", { provider: requestedMusicProvider, raw: created.json ?? created.rawText }));

      let musicUrl = "";
      let rawTask: any = null;
      for (let i = 0; i < 40; i += 1) {
        await sleep(3000);
        const polled = await fetchJson(`${taskUrlBase}${encodeURIComponent(taskId)}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${AIM_KEY}`, Accept: "application/json" },
        });
        rawTask = polled.json ?? polled.rawText;
        const data = polled.json?.data || {};
        const status = s(data.status || data.task_status || polled.json?.status || "").toLowerCase();
        musicUrl = extractMusicUrlFromPayload(polled.json ?? rawTask);
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
          musicPrompt: rawPrompt,
          musicMood,
          musicBpm,
          musicDuration,
          musicUrl: persistedMusicUrl,
        },
      });
      return res.status(200).json({ ok: true, workflow: next });
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

    if (op === "klingT2V" || op === "klingI2V") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const model = s(b.model || "kling-video").trim();
      const prompt = s(b.prompt).trim();

      if (!VAK || !VSK) {
        return res.status(500).json({ ok: false, error: "KLING_CN_VIDEO_ACCESS_KEY/KLING_CN_VIDEO_SECRET_KEY is not configured" });
      }
      const videoToken = jwtHS256(VAK, VSK);

      if (op === "klingI2V" && !s(b.imageUrl).trim()) {
        return res.status(400).json({ ok: false, error: "missing imageUrl" });
      }
      if (op === "klingT2V" && !prompt) {
        return res.status(400).json({ ok: false, error: "missing prompt" });
      }

      if (op === "klingI2V") {
        if (!IAK || !ISK) {
          return res.status(500).json({ ok: false, error: "KLING_CN_IMAGE_ACCESS_KEY/KLING_CN_IMAGE_SECRET_KEY is not configured" });
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
        if (!created.taskId) return res.status(502).json({ ok: false, error: "kling i2v task creation failed", raw: created.raw.json ?? created.raw.rawText });
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
        body: JSON.stringify({ task_type:"create_music", custom_mode:false, mv:"sonic-v4-5", gpt_description_prompt: s(b.prompt || q.prompt || "") })
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
      const r = await fetchJson(`${AIM_BASE}/api/v1/producer/create`,{
        method:"POST",
        headers:{ "Authorization":"Bearer "+AIM_KEY, "Content-Type":"application/json", "Accept":"application/json" },
        body: JSON.stringify({ task_type:"create_music", sound: s(b.prompt || q.prompt || ""), make_instrumental: (b.make_instrumental !== undefined) ? b.make_instrumental : true, mv: s(b.mv || "FUZZ-2.0") })
      });
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, url:r.url, raw:r.json ?? r.rawText });
    }

    if (op === "aimusicUdioTask") {
      if (!AIM_KEY) return res.status(500).json({ ok:false, error:"missing_env", detail:"AIMUSIC_API_KEY" });
      const taskId = s(q.taskId || q.task_id || b.taskId || b.task_id).trim();
      if (!taskId) return res.status(400).json({ ok:false, error:"missing_task_id" });
      const r = await fetchJson(`${AIM_BASE}/api/v1/producer/task/${encodeURIComponent(taskId)}`,{
        method:"GET",
        headers:{ "Authorization":"Bearer "+AIM_KEY, "Accept":"application/json" }
      });
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, url:r.url, raw:r.json ?? r.rawText });
    }

    if (op === "klingCreate") {
      if (!VAK || !VSK) return res.status(500).json({ ok:false, error:"missing_env", detail:"KLING_CN_VIDEO_ACCESS_KEY/SECRET_KEY" });
      if (!IAK || !ISK) return res.status(500).json({ ok:false, error:"missing_env", detail:"KLING_CN_IMAGE_ACCESS_KEY/SECRET_KEY" });

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
      if (!VAK || !VSK) return res.status(500).json({ ok:false, error:"missing_env", detail:"KLING_CN_VIDEO_ACCESS_KEY/SECRET_KEY" });
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
