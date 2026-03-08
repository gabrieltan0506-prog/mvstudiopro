import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { env, getEnvStatus } from "../server/config/env";
import { startWorkflow } from "../server/workflow/engine";
import { getWorkflow } from "../server/workflow/store/workflowStore";
import type { WorkflowTask } from "../server/workflow/types/workflow";
import { generateImageWithBanana } from "../server/models/banana";
import {
  buildI2VRequest,
  buildT2VRequest,
  configureKlingClient,
  createOmniVideoTask,
  getOmniVideoTask,
  parseKeysFromEnv,
} from "../server/kling";

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const q: any = req.query || {};
    const b: any = req.method === "POST" ? getBody(req) : {};
    const op = s(q.op || b.op).trim();
    if (!op) return res.status(400).json({ ok: false, error: "missing_op" });

    const KLING_BASE = (s(process.env.KLING_CN_BASE_URL) || "https://api-beijing.klingai.com").replace(/\/+$/, "");
    const VAK = s(process.env.KLING_CN_VIDEO_ACCESS_KEY).trim();
    const VSK = s(process.env.KLING_CN_VIDEO_SECRET_KEY).trim();
    const IAK = s(process.env.KLING_CN_IMAGE_ACCESS_KEY).trim();
    const ISK = s(process.env.KLING_CN_IMAGE_SECRET_KEY).trim();

    const AIM_BASE = (s(process.env.AIMUSIC_BASE_URL) || "https://api.aimusicapi.ai").replace(/\/+$/, "");
    const AIM_KEY  = s(process.env.AIMUSIC_API_KEY || process.env.AIMUSICAPI_KEY).trim();

    if (op === "envStatus") {
      if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      return res.status(200).json({
        ok: true,
        env: getEnvStatus(),
      });
    }

    if (op === "workflowStatus") {
      if (req.method !== "GET") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const id = s(q.id || b.id).trim();
      const workflow = getWorkflow(id);
      if (!workflow) {
        return res.status(404).json({ ok: false, error: "workflow not found" });
      }
      return res.status(200).json({ ok: true, workflow });
    }

    if (op === "workflowTest") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const sourceType = b.sourceType;
      const inputType = b.inputType;
      const payload = b.payload ?? {};

      if (sourceType !== "direct" && sourceType !== "remix" && sourceType !== "showcase" && sourceType !== "workflow") {
        return res.status(400).json({ ok: false, error: "sourceType must be direct/remix/showcase/workflow" });
      }
      if (inputType !== "script" && inputType !== "image") {
        return res.status(400).json({ ok: false, error: "inputType must be script or image" });
      }

      const now = Date.now();
      const task: WorkflowTask = {
        workflowId: randomUUID(),
        sourceType,
        inputType,
        currentStep: "input",
        status: "pending",
        payload,
        outputs: {},
        createdAt: now,
        updatedAt: now,
      };

      const workflow = await startWorkflow(task);
      return res.status(200).json({ ok: true, workflow });
    }

    if (op === "scriptGenerate") {
      if (req.method !== "POST") {
        return res.status(405).json({ ok: false, error: "Method not allowed" });
      }
      const prompt = s(b.prompt).trim();
      const model = s(b.model || "gemini-3.1").trim();
      if (!prompt) return res.status(400).json({ ok: false, error: "missing prompt" });
      if (!env.geminiApiKey) return res.status(500).json({ ok: false, error: "GEMINI_API_KEY is not configured" });

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

      if (!script) {
        return res.status(502).json({ ok: false, error: "empty script from gemini" });
      }

      return res.status(200).json({
        ok: true,
        script,
        provider: "google",
        model,
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

      const keys = parseKeysFromEnv();
      if (!keys.length) {
        return res.status(500).json({ ok: false, error: "KLING_CN_VIDEO_ACCESS_KEY/KLING_CN_VIDEO_SECRET_KEY is not configured" });
      }
      configureKlingClient(keys, "cn");

      const request =
        op === "klingI2V"
          ? buildI2VRequest({
              prompt: prompt || "Cinematic motion shot with stable camera and rich detail.",
              imageUrl: s(b.imageUrl).trim(),
              imageType: "first_frame",
              aspectRatio: "16:9",
              mode: "pro",
              duration: "5",
            })
          : buildT2VRequest({
              prompt,
              aspectRatio: "16:9",
              mode: "pro",
              duration: "5",
            });

      if (op === "klingI2V" && !s(b.imageUrl).trim()) {
        return res.status(400).json({ ok: false, error: "missing imageUrl" });
      }
      if (op === "klingT2V" && !prompt) {
        return res.status(400).json({ ok: false, error: "missing prompt" });
      }

      request.model_name = (model as any) || request.model_name;
      const created = await createOmniVideoTask(request, "cn");
      if (!created.task_id) {
        return res.status(502).json({ ok: false, error: "kling task creation failed" });
      }

      const timeoutMs = 90_000;
      const pollMs = 5_000;
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        const task = await getOmniVideoTask(created.task_id, "cn");
        if (task.task_status === "succeed") {
          const videoUrl = task.task_result?.videos?.[0]?.url;
          if (!videoUrl) {
            return res.status(502).json({ ok: false, error: "kling succeeded without video url" });
          }
          return res.status(200).json({
            ok: true,
            videoUrl,
            provider: "kling",
            model,
          });
        }
        if (task.task_status === "failed") {
          return res.status(502).json({ ok: false, error: task.task_status_msg || "kling generation failed" });
        }
      }

      return res.status(504).json({ ok: false, error: "kling generation timeout" });
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
