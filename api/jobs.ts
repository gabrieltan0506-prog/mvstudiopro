

// sunoPollingFix
async function pollSuno(taskId){

  for(let i=0;i<60;i++){

    const r = await fetch(`/api/jobs?op=aimusicSunoTask&taskId=${taskId}`)
    const j = await r.json()

    if(j?.music_url){
      return j.music_url
    }

    await new Promise(r=>setTimeout(r,3000))
  }

  throw new Error("suno_poll_timeout")
}

import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { put } from "@vercel/blob";
import { env, getEnvStatus } from "./_core/env.js";
import { generateImageWithBanana } from "./_core/banana.js";
import {
  getWorkflow as getCoreWorkflow,
  saveWorkflow as saveCoreWorkflow,
  type WorkflowTask,
} from "./_core/workflow.js";
import { buildScriptPrompt } from "../server/workflow/prompts/scriptPrompt.js";
import { buildStoryboardPrompt } from "../server/workflow/prompts/storyboardPrompt.js";
import { buildStoryboardImagePrompt } from "../server/workflow/prompts/storyboardImagePrompt.js";
import { buildCharacterLockPrompt } from "../server/workflow/prompts/characterLockPrompt.js";
import { buildVideoPrompt } from "../server/workflow/prompts/videoPrompt.js";
import { buildVoicePrompt } from "../server/workflow/prompts/voicePrompt.js";
import { buildMusicPrompt } from "../server/workflow/prompts/musicPrompt.js";
import { characterLockStep } from "../server/workflow/steps/characterLockStep.js";
import { backgroundRemoveStep } from "../server/workflow/steps/backgroundRemoveStep.js";

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

function extractFalVideoUrl(payload: any): string {
  const direct = s(
    payload?.video?.url ||
    payload?.data?.video?.url ||
    payload?.result?.video?.url ||
    payload?.output?.video?.url ||
    payload?.response?.video?.url ||
    payload?.response?.data?.video?.url ||
    payload?.response?.result?.video?.url ||
    payload?.response?.output?.video?.url ||
    payload?.response?.video_url ||
    payload?.video_url ||
    payload?.url,
  ).trim();
  if (direct) return direct;

  const fromArray =
    payload?.videos?.[0]?.url ||
    payload?.data?.videos?.[0]?.url ||
    payload?.result?.videos?.[0]?.url ||
    payload?.output?.videos?.[0]?.url ||
    payload?.response?.videos?.[0]?.url ||
    payload?.response?.data?.videos?.[0]?.url ||
    payload?.response?.result?.videos?.[0]?.url ||
    payload?.response?.output?.videos?.[0]?.url;
  return s(fromArray).trim();
}

async function fetchImageBuffer(imageUrl: string): Promise<Buffer> {
  const url = s(imageUrl).trim();
  if (!url) throw new Error("missing_image_url");

  // allow private blob fetch with token
  const token = s(process.env.BLOB_READ_WRITE_TOKEN).trim();
  const headers: Record<string, string> = { "User-Agent": "mvstudiopro/1.0 (+fetch)" };

  let r = await fetch(url, { redirect: "follow", headers });
  if (r.status === 403 && token) {
    headers.Authorization = `Bearer ${token}`;
    r = await fetch(url, { redirect: "follow", headers });
  }
  if (!r.ok) throw new Error(`image_fetch_failed:${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error("empty_image");
  if (buf.length > 10 * 1024 * 1024) throw new Error("image_too_large");
  return buf;
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
  model: string
) {
  const buf = await fetchImageBuffer(imageUrl);
  const first = await buildFirstFrameJpeg(buf, prompt, klingBase, imageToken);
  const r = await fetchJson(`${klingBase}/v1/videos/image2video`, {
    method: "POST",
    headers: { Authorization: "Bearer " + videoToken, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      model_name: model || "kling-v2-6",
      image: first.jpeg.toString("base64"),
      prompt,
      duration: "5",
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

async function generateOpenAiVoice(input: { dialogueText: string; voicePrompt?: string; voice?: string }) {
  const dialogueText = s(input.dialogueText).trim();
  const voicePrompt = s(input.voicePrompt).trim();
  const voice = s(input.voice || "nova").trim() || "nova";
  const baseResult = {
    voiceProvider: "openai" as const,
    voiceModel: "gpt-4o-mini-tts" as const,
    voiceVoice: voice,
  };

  if (!dialogueText) {
    return {
      ...baseResult,
      voiceUrl: "",
      voiceIsFallback: true,
      voiceErrorMessage: "dialogueText is required",
    };
  }
  if (!env.openaiApiKey) {
    return {
      ...baseResult,
      voiceUrl: "",
      voiceIsFallback: true,
      voiceErrorMessage: "OPENAI_API_KEY is not configured",
    };
  }

  try {
    const body: Record<string, any> = {
      model: "gpt-4o-mini-tts",
      voice,
      input: dialogueText,
      format: "mp3",
    };
    if (voicePrompt) body.instructions = voicePrompt;

    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const msg = (await r.text()).slice(0, 600);
      return {
        ...baseResult,
        voiceUrl: "",
        voiceIsFallback: true,
        voiceErrorMessage: `openai_tts_failed:${r.status}:${msg}`,
      };
    }

    const audioBuffer = Buffer.from(await r.arrayBuffer());
    if (!audioBuffer.length) {
      return {
        ...baseResult,
        voiceUrl: "",
        voiceIsFallback: true,
        voiceErrorMessage: "openai_tts_empty_audio",
      };
    }

    const blob = await put(`voices/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`, audioBuffer, {
      access: "public",
      contentType: "audio/mpeg",
    });

    return {
      ...baseResult,
      voiceUrl: blob.url,
      voiceIsFallback: false,
      voiceErrorMessage: "",
    };
  } catch (error: any) {
    return {
      ...baseResult,
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
  environment?: string;
  character?: string;
  duration: number;
  camera: string;
  mood: string;
  lighting?: string;
  action?: string;
};

type WorkflowStoryboardImageItem = {
  sceneIndex: number;
  images: string[];
  characterLocked?: boolean;
  referenceCharacterUrl?: string;
  backgroundStatus?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWorkflowForResponse(input: any, fallbackId = "") {
  const workflowId = s(input?.workflowId || fallbackId).trim();
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
    environment: s(input?.environment || "cinematic environment").trim(),
    character: s(input?.character || "same main character identity").trim(),
    duration: Number(input?.duration || 0) || fallbackDuration,
    camera: s(input?.camera || "medium").trim() || "medium",
    mood: s(input?.mood || "cinematic").trim() || "cinematic",
    lighting: s(input?.lighting || "dramatic lighting").trim() || "dramatic lighting",
    action: s(input?.action || "character-driven cinematic action").trim() || "character-driven cinematic action",
  };
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
  prompt: string;
  targetWords?: number;
  targetScenes?: number;
}) {
  const now = Date.now();
  const task: WorkflowTask = {
    workflowId: randomUUID(),
    sourceType: input.sourceType || "workflow",
    inputType: "script",
    payload: {
      prompt: input.prompt,
      targetWords: input.targetWords,
      targetScenes: input.targetScenes,
    },
    currentStep: "script",
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

    if (opNormalized === "workflowstatus") {
      if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const id = s(q.id || q.workflowId || q.workflow_id || b.id || b.workflowId).trim();
      const workflow = id ? getCoreWorkflow(id) : null;

      if (workflow) {
        const outputs: any = workflow.outputs || {};
        const falRequestId = s(outputs.falRequestId).trim();
        const existingVideoUrl = s(outputs.videoUrl).trim();
        const falKey = s(process.env.FAL_KEY || process.env.FAL_API_KEY).trim();

        if (falRequestId && !existingVideoUrl && falKey) {
          const statusResp = await fetchJson(
            `https://queue.fal.run/fal-ai/veo3.1/reference-to-video/requests/${encodeURIComponent(falRequestId)}/status`,
            { method: "GET", headers: { Authorization: `Key ${falKey}` } },
          );
          const taskStatus = s(
            statusResp.json?.status ||
            statusResp.json?.state ||
            statusResp.json?.request_status,
          ).trim().toUpperCase();

          const canTryReadResult =
            taskStatus === "COMPLETED" ||
            taskStatus === "IN_QUEUE" ||
            taskStatus === "IN_PROGRESS" ||
            taskStatus === "RUNNING" ||
            taskStatus === "PROCESSING";

          if (canTryReadResult) {
            const resultResp = await fetchJson(
              `https://queue.fal.run/fal-ai/veo3.1/reference-to-video/requests/${encodeURIComponent(falRequestId)}`,
              { method: "GET", headers: { Authorization: `Key ${falKey}` } },
            );
            const responseResp = await fetchJson(
              `https://queue.fal.run/fal-ai/veo3.1/reference-to-video/requests/${encodeURIComponent(falRequestId)}/response`,
              { method: "GET", headers: { Authorization: `Key ${falKey}` } },
            );
            const videoUrl = extractFalVideoUrl(resultResp.json) || extractFalVideoUrl(responseResp.json);

            if (videoUrl) {
              const updated = {
                ...workflow,
                status: "done",
                currentStep: "done",
                updatedAt: Date.now(),
                outputs: {
                  ...outputs,
                  videoProvider: "fal",
                  videoModel: "fal-ai/veo3.1/reference-to-video",
                  videoTaskStatus: "COMPLETED",
                  videoUrl,
                  finalVideoUrl: videoUrl,
                  videoErrorMessage: "",
                },
              } as any;
              saveCoreWorkflow(updated);
            } else if (taskStatus === "COMPLETED") {
              const updated = {
                ...workflow,
                status: "failed",
                currentStep: "error",
                updatedAt: Date.now(),
                outputs: {
                  ...outputs,
                  videoProvider: "fal",
                  videoModel: "fal-ai/veo3.1/reference-to-video",
                  videoTaskStatus: taskStatus,
                  videoErrorMessage: "fal_veo_missing_video_url",
                },
              } as any;
              saveCoreWorkflow(updated);
            } else if (taskStatus) {
              const updated = {
                ...workflow,
                updatedAt: Date.now(),
                outputs: {
                  ...outputs,
                  videoProvider: "fal",
                  videoModel: "fal-ai/veo3.1/reference-to-video",
                  videoTaskStatus: taskStatus,
                },
              } as any;
              saveCoreWorkflow(updated);
            }
          } else if (taskStatus === "FAILED" || taskStatus === "ERROR" || taskStatus === "CANCELLED" || taskStatus === "CANCELED") {
            const updated = {
              ...workflow,
              status: "failed",
              currentStep: "error",
              updatedAt: Date.now(),
              outputs: {
                ...outputs,
                videoProvider: "fal",
                videoModel: "fal-ai/veo3.1/reference-to-video",
                videoTaskStatus: taskStatus,
                videoErrorMessage: s(statusResp.json?.error || taskStatus || "fal_veo_failed").trim(),
              },
            } as any;
            saveCoreWorkflow(updated);
          }
        }
      }

      return res.status(200).json({
        ok: true,
        workflow: normalizeWorkflowForResponse(id ? getCoreWorkflow(id) : null, id),
      });
    }

    if (opNormalized === "workflowtest") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const sourceType = b.sourceType;
      const payload = b.payload ?? {};

      if (sourceType !== "direct" && sourceType !== "remix" && sourceType !== "showcase" && sourceType !== "workflow") {
        return res.status(400).json({ ok: false, error: "sourceType must be direct/remix/showcase/workflow" });
      }
      const task = createServerWorkflowTask({
        sourceType,
        prompt: s(payload.prompt).trim(),
        targetWords: Number(payload.targetWords || 0) || undefined,
        targetScenes: Number(payload.targetScenes || 0) || undefined,
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

      const task = workflowId
        ? readWorkflow(workflowId, b.workflow)
        : createServerWorkflowTask({ sourceType: "workflow", prompt, targetWords, targetScenes });
      if (!workflowId) saveCoreWorkflow(task);

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
      const scenesInput = Array.isArray(b.storyboard) ? b.storyboard : workflow.outputs?.storyboard;
      if (!Array.isArray(scenesInput) || scenesInput.length === 0) {
        return res.status(400).json(fail("storyboard is required"));
      }
      const scenes = scenesInput.map((scene: any, idx: number) =>
        normalizeStoryboardScene(scene, idx + 1, Number(workflow.outputs?.sceneDuration || 0) || 5),
      );
      const results: WorkflowStoryboardImageItem[] = [];
      const lockedCharacterPrompt = s(workflow.outputs?.lockedCharacterPrompt).trim();
      for (const scene of scenes) {
        const imagePrompt = buildStoryboardImagePrompt({
          scenePrompt: scene.scenePrompt,
          environment: scene.environment,
          character: scene.character,
          camera: scene.camera,
          mood: scene.mood,
          lighting: scene.lighting,
          action: scene.action,
          lockedCharacterPrompt: lockedCharacterPrompt || undefined,
          referenceImageMode: workflow.outputs?.referenceImages?.length ? "reference-image" : "text-only",
        });
        const generated = await generateImageWithBanana({
          prompt: imagePrompt,
          numImages: 2,
          aspectRatio: "16:9",
          imageSize: "1536x864",
        });
        results.push({
          sceneIndex: scene.sceneIndex,
          images: (generated.imageUrls || []).slice(0, 2),
          characterLocked: false,
          referenceCharacterUrl: "",
          backgroundStatus: "not_removed",
        });
      }
      const next = saveWorkflowPatch(workflow, {
        currentStep: "storyboardImages",
        status: "running",
        outputs: {
          storyboard: scenes,
          storyboardImages: results,
          storyboardConfirmed: false,
        },
      });
      return res.status(200).json({ ok: true, workflow: next });
    }

    if (opNormalized === "workflowregeneratesceneimages") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const sceneIndex = Number(b.sceneIndex || 0);
      if (!sceneIndex) return res.status(400).json(fail("sceneIndex is required"));
      const storyboard = Array.isArray(workflow.outputs?.storyboard) ? workflow.outputs.storyboard : [];
      const currentImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const targetScene = storyboard.find((scene: any) => Number(scene?.sceneIndex) === sceneIndex);
      if (!targetScene) return res.status(404).json(fail("scene not found"));
      const imagePrompt = buildStoryboardImagePrompt({
        scenePrompt: s(targetScene.scenePrompt).trim(),
        environment: s(targetScene.environment).trim(),
        character: s(targetScene.character).trim(),
        camera: s(targetScene.camera).trim(),
        mood: s(targetScene.mood).trim(),
        lighting: s(targetScene.lighting).trim(),
        action: s(targetScene.action).trim(),
        lockedCharacterPrompt: s(workflow.outputs?.lockedCharacterPrompt).trim() || undefined,
        referenceImageMode: workflow.outputs?.referenceImages?.length ? "reference-image" : "text-only",
      });
      const generated = await generateImageWithBanana({
        prompt: imagePrompt,
        numImages: 2,
        aspectRatio: "16:9",
        imageSize: "1536x864",
      });
      const updated = currentImages.map((item: any) =>
        Number(item?.sceneIndex) === sceneIndex
          ? { ...item, images: (generated.imageUrls || []).slice(0, 2), backgroundStatus: item?.backgroundStatus || "not_removed" }
          : item,
      );
      const next = saveWorkflowPatch(workflow, {
        currentStep: "storyboardImages",
        outputs: { storyboardImages: updated, storyboardConfirmed: false },
      });
      return res.status(200).json({ ok: true, workflow: next });
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
      if (!workflow.outputs?.storyboardConfirmed) {
        return res.status(400).json(fail("storyboard must be confirmed before video generation"));
      }
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

      const fallbackRefs = Array.isArray(workflow.outputs?.referenceImages) ? workflow.outputs.referenceImages.map((x: any) => s(x).trim()).filter(Boolean) : [];
      const imageUrls = Array.from(new Set([referenceImageUrl, ...referenceCandidates.slice(1), ...fallbackRefs])).slice(0, 3);
      const falKey = s(process.env.FAL_KEY || process.env.FAL_API_KEY).trim();
      if (!falKey) return res.status(500).json(fail("missing_env_FAL_KEY"));
      const requestedDuration = s(b.duration || "8s").trim().toLowerCase();
      const requestedResolution = s(b.resolution || "720p").trim().toLowerCase();
      const duration = ["5s", "6s", "7s", "8s", "9s", "10s"].includes(requestedDuration)
        ? requestedDuration
        : "8s";
      const resolution = ["540p", "720p", "1080p"].includes(requestedResolution)
        ? requestedResolution
        : "720p";

      const createResp = await fetchJson("https://queue.fal.run/fal-ai/veo3.1/reference-to-video", {
        method: "POST",
        headers: {
          Authorization: `Key ${falKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt,
          image_urls: imageUrls,
          aspect_ratio: "16:9",
          duration,
          resolution,
          generate_audio: false,
          safety_tolerance: "4",
        }),
      });
      const requestId = s(createResp.json?.request_id || createResp.json?.requestId || createResp.json?.id).trim();
      if (!createResp.ok || !requestId) {
        const message = s(createResp.json?.detail || createResp.json?.error || createResp.rawText || "fal_veo_create_failed").trim();
        const failed = saveWorkflowPatch(workflow, {
          currentStep: "error",
          status: "failed",
          outputs: {
            videoProvider: "fal",
            videoModel: "fal-ai/veo3.1/reference-to-video",
            videoErrorMessage: message || "fal_veo_create_failed",
          },
        });
        return res.status(502).json({ ok: false, error: message || "fal_veo_create_failed", workflow: failed });
      }

      const queued = saveWorkflowPatch(workflow, {
        currentStep: "video",
        status: "running",
        outputs: {
          falRequestId: requestId,
          videoProvider: "fal",
          videoModel: "fal-ai/veo3.1/reference-to-video",
          videoTaskStatus: "IN_QUEUE",
          videoDuration: duration,
          videoResolution: resolution,
          referenceCharacterUrl: s(workflow.outputs?.referenceCharacterUrl).trim() || referenceImageUrl,
          referenceImages: Array.from(new Set([...(workflow.outputs?.referenceImages || []), ...imageUrls])),
          videoErrorMessage: "",
        },
      });
      return res.status(200).json({
        ok: true,
        workflow: queued,
        taskId: requestId,
        requestId,
        provider: "fal",
        model: "fal-ai/veo3.1/reference-to-video",
        taskStatus: "IN_QUEUE",
        duration,
        resolution,
      });
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
      if (!dialogueText) return res.status(400).json(fail("dialogueText is required"));
      const voiceResult = await generateOpenAiVoice({ dialogueText, voicePrompt, voice });
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

    if (opNormalized === "workflowgeneratemusic") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      if (!AIM_KEY) return res.status(500).json(fail("missing_env", "AIMUSIC_API_KEY is required", { detail: "AIMUSIC_API_KEY" }));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const musicMood = s(b.musicMood || "cinematic").trim() || "cinematic";
      const musicBpm = Number(b.musicBpm || 0) || 110;
      const musicDuration = Number(b.musicDuration || 0) || 30;
      const rawPrompt = s(b.musicPrompt).trim() || s(workflow.outputs?.script).trim() || s(workflow.payload?.prompt).trim();
      if (!rawPrompt) return res.status(400).json(fail("musicPrompt is required"));
      const prompt = buildMusicPrompt({
        genre: rawPrompt,
        mood: musicMood,
        pace: s(b.musicPace || "medium-fast").trim() || "medium-fast",
        duration: musicDuration,
        hasVocal: Boolean(b.hasVocal),
        bpm: musicBpm,
      });

      const created = await fetchJson(`${AIM_BASE}/api/v1/producer/create`, {
        method: "POST",
        headers: { Authorization: `Bearer ${AIM_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          task_type: "create_music",
          sound: prompt,
          make_instrumental: true,
          mv: s(b.mv || "FUZZ-2.0").trim() || "FUZZ-2.0",
        }),
      });
      if (!created.ok) return res.status(502).json(fail("udio_create_failed", "Udio create request failed", { raw: created.json ?? created.rawText }));
      const taskId = s(created.json?.data?.task_id || created.json?.task_id || created.json?.taskId).trim();
      if (!taskId) return res.status(502).json(fail("missing_udio_task_id", "Udio task id is missing", { raw: created.json ?? created.rawText }));

      let musicUrl = "";
      let rawTask: any = null;
      for (let i = 0; i < 80; i += 1) {
        await sleep(3000);
        const polled = await fetchJson(`${AIM_BASE}/api/v1/producer/task/${encodeURIComponent(taskId)}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${AIM_KEY}`, Accept: "application/json" },
        });
        rawTask = polled.json ?? polled.rawText;
        const data = polled.json?.data || polled.json || {};
        const status = s(data.status || data.task_status || data.state || polled.json?.status || polled.json?.state || "").toLowerCase();
        musicUrl =
          s(data.audio_url).trim() ||
          s(data.music_url).trim() ||
          s(data.url).trim() ||
          s(data.result?.audio_url).trim() ||
          s(data.result?.music_url).trim() ||
          s(data.data?.audio_url).trim() ||
          s(data.data?.music_url).trim() ||
          s(data.data?.url).trim();
        if (musicUrl) break;
        if (status === "failed" || status === "error") {
          return res.status(502).json(fail("udio_task_failed", "Udio task failed", { raw: rawTask }));
        }
      }
      if (!musicUrl) return res.status(502).json(fail("udio_task_timeout_or_missing_music_url", "Udio task timeout or missing music url", { raw: rawTask }));

      const next = saveWorkflowPatch(workflow, {
        currentStep: "music",
        outputs: {
          musicProvider: "udio",
          musicPrompt: rawPrompt,
          musicMood,
          musicBpm,
          musicDuration,
          musicTaskId: taskId,
          musicUrl,
        },
      });
      return res.status(200).json({ ok: true, workflow: next });
    }

    if (opNormalized === "workflowrenderfinalvideo") {
      if (req.method !== "POST") return res.status(405).json(fail("Method not allowed"));
      const workflow = readWorkflow(b.workflowId || b.id, b.workflow);
      const videoUrl = s(workflow.outputs?.videoUrl).trim();
      if (!videoUrl) return res.status(400).json(fail("videoUrl is required before render"));
      const next = saveWorkflowPatch(workflow, {
        currentStep: "render",
        status: "done",
        outputs: {
          finalVideoUrl: videoUrl,
          renderProvider: "workflow-render",
          renderIsFallback: false,
          renderErrorMessage: "",
        },
      });
      return res.status(200).json({ ok: true, workflow: next });
    }

    if (opNormalized === "generatevoice") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }

      const dialogueText = s(b.dialogueText).trim();
      const voicePrompt = buildVoicePrompt({
        dialogueText,
        style: s(b.voicePrompt).trim(),
        language: s(b.language || "中文").trim() || "中文",
      });
      const voice = s(b.voice || "nova").trim() || "nova";
      const workflowId = s(b.workflowId).trim();

      const voiceResult = await generateOpenAiVoice({ dialogueText, voicePrompt, voice });
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

      const buf = await fetchImageBuffer(imageUrl);
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
