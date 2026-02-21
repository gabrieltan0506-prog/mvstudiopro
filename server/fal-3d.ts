/**
 * fal.ai 3D Generation Service — Trellis 引擎
 * 計費：$0.02/次，輸出 GLB
 */

import { fal } from "@fal-ai/client";

function initFal() {
  const falKey = process.env.FAL_API_KEY;
  if (!falKey) {
    throw new Error("FAL_API_KEY 环境变量未设置。请在 Settings → Secrets 中添加 FAL_API_KEY。");
  }
  fal.config({ credentials: falKey });
}

export interface Image3DResult {
  glbUrl: string;
  objUrl: string | null;
  textureUrl: string | null;
  thumbnailUrl: string | null;
  availableFormats: string[];
  timeTaken: number;
}

export interface Image3DOptions {
  imageUrl: string;
  enablePbr?: boolean;
  numInferenceSteps?: number;
}

async function ensureAccessibleUrl(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith("data:") || imageUrl.includes("fal.media") || imageUrl.includes("fal-cdn")) {
    console.log("[Trellis 3D] URL 已可访问，直接使用");
    return imageUrl;
  }

  console.log("[Trellis 3D] 图片 URL 可能不可公开访问，正在转换...");

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`下载图片失败: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const sizeMB = buffer.length / (1024 * 1024);
    console.log(`[Trellis 3D] 图片大小: ${sizeMB.toFixed(2)} MB, 类型: ${contentType}`);

    if (sizeMB > 6) {
      console.log("[Trellis 3D] 文件较大，使用 fal.storage.upload...");
      const blob = new Blob([buffer], { type: contentType });
      const falUrl = await fal.storage.upload(blob);
      console.log("[Trellis 3D] 已上传到 fal.ai storage:", falUrl);
      return falUrl;
    }

    const base64 = buffer.toString("base64");
    const mimeType = contentType.includes("png") ? "image/png" : "image/jpeg";
    const dataUri = `data:${mimeType};base64,${base64}`;
    console.log(`[Trellis 3D] 已转换为 base64 data URI (${(base64.length / 1024).toFixed(1)} KB)`);
    return dataUri;
  } catch (downloadError: any) {
    console.error("[Trellis 3D] 下载图片失败:", downloadError.message);
    console.log("[Trellis 3D] 回退：尝试直接使用原始 URL...");
    return imageUrl;
  }
}

export async function imageToThreeD(options: Image3DOptions): Promise<Image3DResult> {
  initFal();

  const startTime = Date.now();

  try {
    const accessibleUrl = await ensureAccessibleUrl(options.imageUrl);
    console.log("[Trellis 3D] 开始调用 Trellis Image-to-3D...");

    const result = await fal.subscribe("fal-ai/trellis", {
      input: {
        image_url: accessibleUrl,
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS" && update.logs) {
          update.logs.forEach((log) => console.log(`[Trellis 3D] ${log.message}`));
        }
      },
    });

    const timeTaken = (Date.now() - startTime) / 1000;
    const data = result.data as any;

    console.log("[Trellis 3D] 返回数据 keys:", Object.keys(data));

    const glbUrl = data?.model_mesh?.url || "";
    const objUrl = null;
    const textureUrl = null;
    const thumbnailUrl = null;

    const availableFormats: string[] = [];
    if (glbUrl) availableFormats.push("glb");

    if (!glbUrl) {
      console.error("[Trellis 3D] 返回数据结构:", JSON.stringify(data, null, 2));
      throw new Error("3D 模型生成失败：未返回有效的模型文档");
    }

    console.log(`[Trellis 3D] 生成成功！耗时 ${timeTaken.toFixed(1)}s`);
    if (glbUrl) console.log("[Trellis 3D] GLB:", glbUrl.substring(0, 80));

    return { glbUrl, objUrl, textureUrl, thumbnailUrl, availableFormats, timeTaken };
  } catch (error: any) {
    console.error("[Trellis 3D] Error:", JSON.stringify(error, null, 2));

    if (error.message?.includes("credentials")) {
      throw new Error("FAL_API_KEY 无效或已过期，请检查环境变量设置");
    }
    if (error.message?.includes("insufficient")) {
      throw new Error("fal.ai 帐户余额不足，请充值后重试");
    }
    if (error.status === 422) {
      const detail = error.body?.detail || error.message || "";
      throw new Error(`3D 模型生成失败 (422): ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    }

    throw new Error(`3D 模型生成失败: ${error.message || "未知错误"}`);
  }
}

export function isFalConfigured(): boolean {
  return !!process.env.FAL_API_KEY;
}
