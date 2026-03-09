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
  scenePrompt: string;
  duration: number;
  camera: string;
  mood: string;
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

function readWorkflow(workflowId: string): any {
  const id = s(workflowId).trim();
  if (!id) throw new Error("workflowId is required");
  const task = getCoreWorkflow(id);
  if (!task) throw new Error("workflow not found");
  return task;
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
    scenePrompt: s(input?.scenePrompt).trim(),
    duration: Number(input?.duration || 0) || fallbackDuration,
    camera: s(input?.camera || "medium").trim() || "medium",
    mood: s(input?.mood || "cinematic").trim() || "cinematic",
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

async function generateScriptWithGemini(input: { prompt: string; model?: string }) {
  const prompt = s(input.prompt).trim();
  const model = s(input.model || "gemini-3.1").trim() || "gemini-3.1";
  if (!prompt) throw new Error("missing prompt");
  if (!env.geminiApiKey) throw new Error("GEMINI_API_KEY is not configured");

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: env.geminiApiKey });
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              "请把下面创意写成可拍摄的短视频脚本（中文，120-220字，包含场景、动作、镜头和情绪节奏）：" +
              `\n${prompt}`,
          },
        ],
      },
    ],
  });

  const script =
    response.candidates?.[0]?.content?.parts
      ?.map((part: any) => part?.text || "")
      .join("")
      .trim() || "";
  if (!script) throw new Error("empty script from gemini");
  return { script, provider: "google", model };
}

function buildFallbackScriptFromPrompt(prompt: string) {
  const p = s(prompt).trim() || "短视频创意";
  return [
    `开场：${p}，建立视觉风格和主要冲突。`,
    "中段：角色推进目标，交替使用近景与广角镜头，强化节奏与张力。",
    "结尾：冲突在高潮处收束，留下明确情绪落点与记忆点。",
  ].join("\n");
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
      const id = s(q.id || b.id).trim();
      const workflow = getCoreWorkflow(id);
      if (!workflow) {
        return res.status(404).json({ ok: false, error: "workflow not found" });
      }
      return res.status(200).json({ ok: true, workflow });
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
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
      const prompt = s(b.prompt).trim();
      if (!prompt) return res.status(400).json({ ok: false, error: "prompt is required" });

      const workflowId = s(b.workflowId).trim();
      const targetWords = Number(b.targetWords || 0) || undefined;
      const targetScenes = Number(b.targetScenes || 0) || undefined;
      const sceneDuration = Number(b.sceneDuration || 0) || 5;

      const task = workflowId
        ? readWorkflow(workflowId)
        : createServerWorkflowTask({ sourceType: "workflow", prompt, targetWords, targetScenes });
      if (!workflowId) saveCoreWorkflow(task);

      let script = "";
      let scriptProvider = "google";
      let scriptModel = "gemini-3.1";
      let scriptIsFallback = false;
      let scriptErrorMessage = "";
      try {
        const generated = await generateScriptWithGemini({ prompt, model: "gemini-3.1" });
        script = generated.script;
        scriptProvider = generated.provider;
        scriptModel = generated.model;
      } catch (error: any) {
        script = buildFallbackScriptFromPrompt(prompt);
        scriptProvider = "workflow-fallback";
        scriptModel = "local-template";
        scriptIsFallback = true;
        scriptErrorMessage = error?.message || String(error);
      }
      const workflow = saveWorkflowPatch(task, {
        currentStep: "script",
        status: "running",
        outputs: {
          script,
          scriptProvider,
          scriptModel,
          scriptIsFallback,
          scriptErrorMessage,
          storyboardConfirmed: false,
          targetWords,
          targetScenes,
          sceneDuration,
        },
      });
      return res.status(200).json({
        ok: true,
        script,
        scriptProvider,
        scriptModel,
        scriptIsFallback,
        scriptErrorMessage,
        workflowId: workflow.workflowId,
        workflow,
      });
    }

    if (opNormalized === "workflowgeneratestoryboard") {
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
      const workflow = readWorkflow(b.workflowId);
      const script = s(b.script || workflow.outputs?.script).trim();
      if (!script) return res.status(400).json({ ok: false, error: "script is required" });
      const targetScenes = Number(b.targetScenes || workflow.payload?.targetScenes || 0) || undefined;
      const sceneDuration = Number(b.sceneDuration || workflow.outputs?.sceneDuration || 0) || 5;
      const storyboard = buildStoryboardFromScript({
        script,
        prompt: s(workflow.payload?.prompt).trim(),
        targetScenes,
        sceneDuration,
      });
      const next = saveWorkflowPatch(workflow, {
        currentStep: "storyboard",
        status: "running",
        outputs: {
          script,
          storyboard,
          targetScenes,
          sceneDuration,
          storyboardConfirmed: false,
        },
      });
      return res.status(200).json({ ok: true, workflow: next });
    }

    if (opNormalized === "workflowgeneratestoryboardimages") {
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
      const workflow = readWorkflow(b.workflowId);
      const scenesInput = Array.isArray(b.storyboard) ? b.storyboard : workflow.outputs?.storyboard;
      if (!Array.isArray(scenesInput) || scenesInput.length === 0) {
        return res.status(400).json({ ok: false, error: "storyboard is required" });
      }
      const scenes = scenesInput.map((scene: any, idx: number) =>
        normalizeStoryboardScene(scene, idx + 1, Number(workflow.outputs?.sceneDuration || 0) || 5),
      );
      const results: WorkflowStoryboardImageItem[] = [];
      for (const scene of scenes) {
        const generated = await generateImageWithBanana({
          prompt: scene.scenePrompt,
          numImages: 2,
          aspectRatio: "16:9",
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
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
      const workflow = readWorkflow(b.workflowId);
      const sceneIndex = Number(b.sceneIndex || 0);
      if (!sceneIndex) return res.status(400).json({ ok: false, error: "sceneIndex is required" });
      const storyboard = Array.isArray(workflow.outputs?.storyboard) ? workflow.outputs.storyboard : [];
      const currentImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const targetScene = storyboard.find((scene: any) => Number(scene?.sceneIndex) === sceneIndex);
      if (!targetScene) return res.status(404).json({ ok: false, error: "scene not found" });
      const generated = await generateImageWithBanana({
        prompt: s(targetScene.scenePrompt).trim(),
        numImages: 2,
        aspectRatio: "16:9",
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
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
      const workflow = readWorkflow(b.workflowId);
      const sceneIndex = Number(b.sceneIndex || 0);
      if (!sceneIndex) return res.status(400).json({ ok: false, error: "sceneIndex is required" });
      const locked = Boolean(b.locked);
      const currentImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const updated = currentImages.map((item: any) =>
        Number(item?.sceneIndex) === sceneIndex ? { ...item, characterLocked: locked } : item,
      );
      const next = saveWorkflowPatch(workflow, {
        currentStep: "characterLock",
        outputs: { storyboardImages: updated, storyboardConfirmed: false },
      });
      return res.status(200).json({ ok: true, workflow: next });
    }

    if (opNormalized === "workflowuploadreferencecharacter") {
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
      const workflow = readWorkflow(b.workflowId);
      const sceneIndex = Number(b.sceneIndex || 0);
      const referenceCharacterUrl = s(b.referenceCharacterUrl).trim();
      if (!sceneIndex) return res.status(400).json({ ok: false, error: "sceneIndex is required" });
      if (!referenceCharacterUrl) return res.status(400).json({ ok: false, error: "referenceCharacterUrl is required" });
      const currentImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const updated = currentImages.map((item: any) =>
        Number(item?.sceneIndex) === sceneIndex ? { ...item, referenceCharacterUrl } : item,
      );
      const next = saveWorkflowPatch(workflow, {
        currentStep: "characterLock",
        outputs: { storyboardImages: updated, storyboardConfirmed: false },
      });
      return res.status(200).json({ ok: true, workflow: next });
    }

    if (opNormalized === "workflowbackgroundremove") {
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
      const workflow = readWorkflow(b.workflowId);
      const sceneIndex = Number(b.sceneIndex || 0);
      if (!sceneIndex) return res.status(400).json({ ok: false, error: "sceneIndex is required" });
      const currentImages = Array.isArray(workflow.outputs?.storyboardImages) ? workflow.outputs.storyboardImages : [];
      const updated = currentImages.map((item: any) =>
        Number(item?.sceneIndex) === sceneIndex
          ? { ...item, backgroundStatus: item?.referenceCharacterUrl ? "removed" : "no_reference_character" }
          : item,
      );
      const next = saveWorkflowPatch(workflow, {
        currentStep: "characterLock",
        outputs: { storyboardImages: updated, storyboardConfirmed: false },
      });
      return res.status(200).json({ ok: true, workflow: next });
    }

    if (opNormalized === "workflowconfirmstoryboard") {
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
      const workflow = readWorkflow(b.workflowId);
      const scenesInput = Array.isArray(b.storyboard) ? b.storyboard : workflow.outputs?.storyboard;
      if (!Array.isArray(scenesInput) || scenesInput.length === 0) {
        return res.status(400).json({ ok: false, error: "storyboard is required" });
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
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
      const workflow = readWorkflow(b.workflowId);
      if (!workflow.outputs?.storyboardConfirmed) {
        return res.status(400).json({ ok: false, error: "storyboard must be confirmed before video generation" });
      }
      if (!VAK || !VSK) {
        return res.status(500).json({ ok: false, error: "KLING_CN_VIDEO_ACCESS_KEY/KLING_CN_VIDEO_SECRET_KEY is not configured" });
      }
      const storyboard = Array.isArray(workflow.outputs?.storyboard) ? workflow.outputs.storyboard : [];
      const promptFromStoryboard = storyboard
        .map((scene: any) => s(scene?.scenePrompt).trim())
        .filter(Boolean)
        .join("；");
      const prompt = promptFromStoryboard || s(workflow.outputs?.script || workflow.payload?.prompt).trim();
      if (!prompt) return res.status(400).json({ ok: false, error: "missing prompt for video generation" });

      const videoToken = jwtHS256(VAK, VSK);
      const model = s(b.model || "kling-video").trim() || "kling-video";
      const created = await createKlingT2VTask(KLING_BASE, videoToken, prompt, model);
      if (!created.taskId) {
        return res.status(502).json({ ok: false, error: "kling t2v task creation failed", raw: created.raw.json ?? created.raw.rawText });
      }
      const polled = await pollKlingT2VTask(KLING_BASE, videoToken, created.taskId);
      if (!polled.ok) return res.status(502).json({ ok: false, error: polled.error });
      const next = saveWorkflowPatch(workflow, {
        currentStep: "video",
        outputs: {
          videoProvider: "kling",
          videoModel: model,
          videoUrl: polled.videoUrl,
          videoErrorMessage: "",
        },
      });
      return res.status(200).json({ ok: true, workflow: next });
    }

    if (opNormalized === "workflowgeneratevoice") {
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
      const workflow = readWorkflow(b.workflowId);
      const dialogueText = s(b.dialogueText).trim() || s(workflow.outputs?.script).trim();
      const voicePrompt = s(b.voicePrompt).trim();
      const voice = s(b.voice || "nova").trim() || "nova";
      if (!dialogueText) return res.status(400).json({ ok: false, error: "dialogueText is required" });
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
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
      if (!AIM_KEY) return res.status(500).json({ ok: false, error: "missing_env", detail: "AIMUSIC_API_KEY" });
      const workflow = readWorkflow(b.workflowId);
      const musicMood = s(b.musicMood || "cinematic").trim() || "cinematic";
      const musicBpm = Number(b.musicBpm || 0) || 110;
      const musicDuration = Number(b.musicDuration || 0) || 30;
      const rawPrompt = s(b.musicPrompt).trim() || s(workflow.outputs?.script).trim() || s(workflow.payload?.prompt).trim();
      if (!rawPrompt) return res.status(400).json({ ok: false, error: "musicPrompt is required" });
      const prompt = `${rawPrompt}. mood: ${musicMood}. bpm: ${musicBpm}. duration: ${musicDuration}s. instrumental.`;

      const created = await fetchJson(`${AIM_BASE}/api/v1/sonic/create`, {
        method: "POST",
        headers: { Authorization: `Bearer ${AIM_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ task_type: "create_music", custom_mode: false, mv: "sonic-v4-5", gpt_description_prompt: prompt }),
      });
      if (!created.ok) return res.status(502).json({ ok: false, error: "suno_create_failed", raw: created.json ?? created.rawText });
      const taskId = s(created.json?.data?.task_id || created.json?.task_id || created.json?.taskId).trim();
      if (!taskId) return res.status(502).json({ ok: false, error: "missing_suno_task_id", raw: created.json ?? created.rawText });

      let musicUrl = "";
      let rawTask: any = null;
      for (let i = 0; i < 24; i += 1) {
        await sleep(3000);
        const polled = await fetchJson(`${AIM_BASE}/api/v1/sonic/task/${encodeURIComponent(taskId)}`, {
          method: "GET",
          headers: { Authorization: `Bearer ${AIM_KEY}`, Accept: "application/json" },
        });
        rawTask = polled.json ?? polled.rawText;
        const data = polled.json?.data || {};
        const status = s(data.status || data.task_status || polled.json?.status || "").toLowerCase();
        musicUrl =
          s(data.audio_url).trim() ||
          s(data.music_url).trim() ||
          s(data.url).trim() ||
          s(data.result?.audio_url).trim() ||
          s(data.result?.music_url).trim();
        if (musicUrl) break;
        if (status === "failed" || status === "error") {
          return res.status(502).json({ ok: false, error: "suno_task_failed", raw: rawTask });
        }
      }
      if (!musicUrl) return res.status(502).json({ ok: false, error: "suno_task_timeout_or_missing_music_url", raw: rawTask });

      const next = saveWorkflowPatch(workflow, {
        currentStep: "music",
        outputs: {
          musicProvider: "suno",
          musicPrompt: rawPrompt,
          musicMood,
          musicBpm,
          musicDuration,
          musicUrl,
        },
      });
      return res.status(200).json({ ok: true, workflow: next });
    }

    if (opNormalized === "workflowrenderfinalvideo") {
      if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
      const workflow = readWorkflow(b.workflowId);
      const videoUrl = s(workflow.outputs?.videoUrl).trim();
      if (!videoUrl) return res.status(400).json({ ok: false, error: "videoUrl is required before render" });
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
      const voicePrompt = s(b.voicePrompt).trim();
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
      const model = s(b.model || "gemini-3.1").trim();
      if (!prompt) return res.status(400).json({ ok: false, error: "missing prompt" });
      const generated = await generateScriptWithGemini({ prompt, model });

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

    return res.status(400).json({ ok:false, error:"unknown_op", op });
  } catch (e: any) {
    return res.status(500).json({ ok:false, error:"server_error", message: e?.message || String(e) });
  }
}
