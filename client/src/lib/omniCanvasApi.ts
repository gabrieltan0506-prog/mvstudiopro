/** Gemini Omni Canvas · 前端 API 封装 */
export type OmniCanvasVideoEngine = "omni" | "seedance25";

export type OmniVideoTask =
  | "unspecified"
  | "text_to_video"
  | "image_to_video"
  | "reference_to_video"
  | "edit_video";

async function parseJson(resp: Response) {
  const text = await resp.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    if (/^An error\b/i.test(text) || /ROUTER_EXTERNAL_TARGET_ERROR/i.test(text)) {
      return { ok: false, error: "算力紧张或网关超时，请稍后重试", rawText: text.slice(0, 200) };
    }
    return { ok: false, error: "上游返回非 JSON", rawText: text.slice(0, 200) };
  }
}

export async function resolveOmniMaterialUrl(gcsUri: string): Promise<string> {
  const resp = await fetch(`/api/google?op=omniMaterialUrl&gcsUri=${encodeURIComponent(gcsUri)}`);
  const json = await parseJson(resp);
  if (!resp.ok || !json.ok) throw new Error(String(json.message || json.error || "签名 URL 失败"));
  return String(json.url || "");
}

export async function createOmniInteraction(body: {
  prompt: string;
  task?: OmniVideoTask;
  aspectRatio?: "9:16" | "16:9";
  durationSeconds?: number;
  imageUrl?: string;
  videoUrl?: string;
  gcsUri?: string;
  systemInstruction?: string;
}) {
  const resp = await fetch("/api/google?op=omniInteractionCreate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await parseJson(resp);
  if (!resp.ok || !json.ok) {
    throw new Error(String(json.message || json.error || "Omni 任务创建失败"));
  }
  return json as { id: string; model: string; task: string };
}

export async function getOmniInteraction(interactionId: string) {
  const resp = await fetch(
    `/api/google?op=omniInteractionGet&interactionId=${encodeURIComponent(interactionId)}`,
  );
  const json = await parseJson(resp);
  if (!resp.ok || !json.ok) {
    throw new Error(String(json.message || json.error || "Omni 轮询失败"));
  }
  return json as {
    status: string;
    videoUrl?: string | null;
    text?: string | null;
    imageUrls?: string[];
    failed?: boolean;
    error?: unknown;
  };
}

export async function pollOmniInteractionUntilDone(
  interactionId: string,
  opts?: { maxAttempts?: number; intervalMs?: number },
) {
  const maxAttempts = opts?.maxAttempts ?? 120;
  const intervalMs = opts?.intervalMs ?? 4000;
  for (let i = 0; i < maxAttempts; i++) {
    const row = await getOmniInteraction(interactionId);
    const status = String(row.status || "").toLowerCase();
    if (row.videoUrl || (row.imageUrls && row.imageUrls.length > 0) || (row.text && status === "completed")) {
      return row;
    }
    if (row.failed || status === "failed" || status === "cancelled") {
      throw new Error(String((row.error as any)?.message || "Omni 任务失败"));
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Omni 任务超时，请稍后再试");
}

export async function runGeminiScript(prompt: string, model?: string) {
  const resp = await fetch("/api/google?op=geminiScript", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      model: model || "gemini-3.1-pro-preview",
    }),
  });
  const json = await parseJson(resp);
  if (!resp.ok || !json.ok) {
    const upstream = Number(json?.status || resp.status || 0) || resp.status;
    // 带状态码，供工厂 isTransientFactoryError 识别并退避（勿泄漏供应商/模型名）
    throw new Error(
      String(json.error || "").trim() ||
        (upstream >= 500 || upstream === 429
          ? `算力紧张，请稍后重试（${upstream}）`
          : "文字生成失败，请稍后重试"),
    );
  }
  const text = String((json.raw as any)?.candidates?.[0]?.content?.parts?.[0]?.text || json.text || "").trim();
  if (!text) throw new Error("文字生成返回为空，请稍后重试");
  return text;
}

export async function runNanoImage(body: {
  prompt: string;
  aspectRatio?: string;
  imageUrl?: string;
  imageSize?: string;
  model?: string;
  tier?: "flash" | "pro";
  numberOfImages?: number;
}) {
  const tier = body.tier || "flash";
  const model = body.model || "gemini-3.1-flash-image-preview";
  const numberOfImages = Math.max(1, Math.min(4, Number(body.numberOfImages || 1) || 1));
  const resp = await fetch(`/api/google?op=nanoImage&tier=${tier}&model=${encodeURIComponent(model)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: body.prompt,
      aspectRatio: body.aspectRatio || "9:16",
      imageUrl: body.imageUrl || undefined,
      imageSize: body.imageSize || "1K",
      tier,
      model,
      numberOfImages,
    }),
  });
  const json = await parseJson(resp);
  if (!resp.ok || !json.ok) throw new Error(String(json.error || "图片生成失败"));
  const urls = Array.isArray(json.imageUrls) ? json.imageUrls.map(String) : [];
  if (!urls.length) throw new Error("图片生成返回为空");
  return urls;
}

export async function runUpscaleImage(body: { imageUrl: string; upscaleFactor?: "x2" | "x4"; prompt?: string }) {
  const resp = await fetch("/api/google?op=upscaleImage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageUrl: body.imageUrl,
      upscaleFactor: body.upscaleFactor || "x2",
      prompt: body.prompt || "",
    }),
  });
  const json = await parseJson(resp);
  if (!resp.ok || !json.ok) throw new Error(String(json.error || json.message || "高清放大失败"));
  const url = String(json.imageUrl || json.url || "");
  if (!url) throw new Error("高清放大返回为空");
  return url;
}

export async function uploadFileToSignedUrl(params: {
  file: File;
  uploadUrl: string;
  headers?: Record<string, string>;
}) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", params.uploadUrl, true);
    xhr.onerror = () => reject(new Error("上传失败，请检查网络"));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(xhr.responseText || `上传失败 (${xhr.status})`));
        return;
      }
      resolve();
    };
    xhr.setRequestHeader("Content-Type", params.file.type || "application/octet-stream");
    for (const [key, value] of Object.entries(params.headers || {})) {
      if (value) xhr.setRequestHeader(key, value);
    }
    xhr.send(params.file);
  });
}

/** Seedance 2.5 · 预留（后续同页接入，接口签名先占位） */
export async function runSeedance25Video(_body: {
  prompt: string;
  imageUrl: string;
  aspectRatio?: string;
  durationSeconds?: number;
}): Promise<string> {
  throw new Error("Seedance 2.5 即将在本页接入，当前为预留位");
}
