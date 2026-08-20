/** Canvas 共用的 Google 文本、图像与素材 API 封装（文件名仅为历史兼容）。 */
import { resolveGeminiScriptFallbackModel } from "@shared/geminiScriptFallback";

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

export async function resolveCanvasMaterialUrl(gcsUri: string): Promise<string> {
  const resp = await fetch(`/api/google?op=materialReadUrl&gcsUri=${encodeURIComponent(gcsUri)}`, {
    credentials: "include",
  });
  const json = await parseJson(resp);
  if (!resp.ok || !json.ok) throw new Error(String(json.message || json.error || "签名 URL 失败"));
  return String(json.url || "");
}

function isTransientGeminiHttp(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Canvas 文案（故事/角色卡/节拍等）。
 * 对 429/5xx 在客户端再退避；Pro 仍失败时换 Flash 再试（服务端也会换；勿泄漏模型名）。
 */
export async function runGeminiScript(prompt: string, model?: string) {
  // 静态导入：长跑中途若部署换了 hashed chunk，动态 import 会 404 整段工厂中断
  const primary = model || "gemini-3.1-pro-preview";
  const models = [primary];
  const fallback = resolveGeminiScriptFallbackModel(primary);
  if (fallback && fallback !== primary) models.push(fallback);

  let lastError = "文字生成失败，请稍后重试";
  for (let mi = 0; mi < models.length; mi++) {
    const useModel = models[mi]!;
    const maxAttempts = mi === 0 ? 3 : 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const resp = await fetch("/api/google?op=geminiScript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          model: useModel,
        }),
      });
      const json = await parseJson(resp);
      if (resp.ok && json.ok) {
        const text = String(
          (json.raw as any)?.candidates?.[0]?.content?.parts?.[0]?.text || json.text || "",
        ).trim();
        if (text) return text;
        lastError = "文字生成返回为空，请稍后重试";
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        break;
      }
      const upstream = Number(json?.status || resp.status || 0) || resp.status;
      lastError =
        String(json.error || "").trim() ||
        (upstream >= 500 || upstream === 429
          ? `算力紧张，请稍后重试（${upstream}）`
          : "文字生成失败，请稍后重试");
      if (attempt < maxAttempts - 1 && isTransientGeminiHttp(upstream)) {
        await new Promise((r) => setTimeout(r, 1600 * (attempt + 1)));
        continue;
      }
      // 主模型瞬时失败 → 换下一模型；非瞬时直接抛
      if (!isTransientGeminiHttp(upstream)) {
        throw new Error(lastError);
      }
      break;
    }
  }
  throw new Error(lastError);
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
