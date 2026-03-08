import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../server/config/env";
import { generateImageWithBanana } from "../server/models/banana";
import {
  buildI2VRequest,
  buildT2VRequest,
  configureKlingClient,
  createOmniVideoTask,
  getOmniVideoTask,
  parseKeysFromEnv,
} from "../server/kling";

function parseBody(body: unknown): Record<string, any> {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      throw new Error("invalid_json_body");
    }
  }
  if (typeof body === "object") return body as Record<string, any>;
  return {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = parseBody(req.body);
    const op = String(body.op || "").trim();
    if (!op) return res.status(400).json({ ok: false, error: "missing op" });

    if (op === "scriptGenerate") {
      const prompt = String(body.prompt || "").trim();
      const model = String(body.model || "gemini-3.1").trim();
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

    if (op === "bananaGenerate") {
      const prompt = String(body.prompt || "").trim();
      const numImages = Number(body.numImages || 1);
      const aspectRatio = String(body.aspectRatio || "auto");
      if (!prompt) return res.status(400).json({ ok: false, error: "missing prompt" });

      const result = await generateImageWithBanana({ prompt, numImages, aspectRatio });
      return res.status(200).json({ ok: true, ...result });
    }

    if (op === "klingT2V" || op === "klingI2V") {
      const model = String(body.model || "kling-video").trim();
      const prompt = String(body.prompt || "").trim();

      const keys = parseKeysFromEnv();
      if (!keys.length) {
        return res.status(500).json({ ok: false, error: "KLING_CN_VIDEO_ACCESS_KEY/KLING_CN_VIDEO_SECRET_KEY is not configured" });
      }
      configureKlingClient(keys, "cn");

      const request =
        op === "klingI2V"
          ? buildI2VRequest({
              prompt: prompt || "Cinematic motion shot with stable camera and rich detail.",
              imageUrl: String(body.imageUrl || "").trim(),
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

      if (op === "klingI2V" && !String(body.imageUrl || "").trim()) {
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

    return res.status(400).json({ ok: false, error: `unknown op: ${op}` });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message || String(error),
    });
  }
}
