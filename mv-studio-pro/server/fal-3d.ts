/**
 * fal.ai 3D Generation Service
 *
 * 使用 fal.ai 的 Trellis 模型将 2D 图片转换为 3D 模型。
 * 支持 Image-to-3D 模式。
 *
 * 计费：$0.02/次
 * 输出：GLB 模型
 *
 * 图片 URL 处理：
 * 由于 Manus S3 存储的 URL 可能带有认证限制，fal.ai 无法直接访问，
 * 因此采用以下策略：
 * 1. 先从 S3 下载图片到服务器内存
 * 2. 转为 base64 data URI 或上传到 fal.ai storage
 * 3. 使用可访问的 URL 调用 3D 生成
 */

import { fal } from "@fal-ai/client";

// ─── 初始化 fal.ai 客户端 ─────────────────────────────
function initFal() {
  const falKey = process.env.FAL_API_KEY;
  if (!falKey) {
    throw new Error("FAL_API_KEY 环境变量未设置。请在 Settings → Secrets 中添加 FAL_API_KEY。");
  }
  fal.config({ credentials: falKey });
}

// ─── 类型定义 ──────────────────────────────────────────
export interface Image3DResult {
  /** GLB 模型文档 URL */
  glbUrl: string;
  /** OBJ 模型文档 URL */
  objUrl: string | null;
  /** 纹理图片 URL */
  textureUrl: string | null;
  /** 预览缩略图 URL */
  thumbnailUrl: string | null;
  /** 模型格式列表 */
  availableFormats: string[];
  /** 生成耗时（秒） */
  timeTaken: number;
}

export interface Image3DOptions {
  /** 输入图片 URL */
  imageUrl: string;
  /** 是否激活 PBR 材质（更真实的光照效果） */
  enablePbr?: boolean;
  /** 生成步数（越高质量越好，但更慢） */
  numInferenceSteps?: number;
}

// ─── 图片 URL 转换为 fal.ai 可访问的 URL ──────────────
async function ensureAccessibleUrl(imageUrl: string): Promise<string> {
  // 如果已经是 fal.ai storage URL 或 data URI，直接返回
  if (imageUrl.startsWith("data:") || imageUrl.includes("fal.media") || imageUrl.includes("fal-cdn")) {
    console.log("[Trellis 3D] URL 已可访问，直接使用");
    return imageUrl;
  }

  console.log("[Trellis 3D] 图片 URL 可能不可公开访问，正在转换...");

  try {
    // 下载图片到服务器内存
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
      // 大文件使用 fal.storage.upload
      console.log("[Trellis 3D] 文件较大，使用 fal.storage.upload...");
      const blob = new Blob([buffer], { type: contentType });
      const falUrl = await fal.storage.upload(blob);
      console.log("[Trellis 3D] 已上传到 fal.ai storage:", falUrl);
      return falUrl;
    }

    // 小文件直接用 base64 data URI
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

// ─── Image to 3D (Trellis) ───────────────────────────
export async function imageToThreeD(options: Image3DOptions): Promise<Image3DResult> {
  initFal();

  const startTime = Date.now();

  try {
    // 确保图片 URL 可被 fal.ai 访问
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

    // Trellis 实际返回结构：
    // model_mesh: { url, content_type, file_name, file_size }
    // timings: { prepare, generation, export }
    const glbUrl = data?.model_mesh?.url || "";
    const objUrl = null;
    const textureUrl = null;
    const thumbnailUrl = null;

    const availableFormats: string[] = [];
    if (glbUrl) availableFormats.push("glb");
    if (objUrl) availableFormats.push("obj");

    // 至少要有一个模型文件
    if (!glbUrl && !objUrl) {
      console.error("[Trellis 3D] 返回数据结构:", JSON.stringify(data, null, 2));
      throw new Error("3D 模型生成失败：未返回有效的模型文档");
    }

    console.log(`[Trellis 3D] 生成成功！耗时 ${timeTaken.toFixed(1)}s, 格式: ${availableFormats.join(", ")}`);
    if (glbUrl) console.log("[Trellis 3D] GLB:", glbUrl.substring(0, 80));

    return {
      glbUrl,
      objUrl,
      textureUrl,
      thumbnailUrl,
      availableFormats,
      timeTaken,
    };
  } catch (error: any) {
    console.error("[Trellis 3D] Error:", JSON.stringify(error, null, 2));
    console.error("[Trellis 3D] Error message:", error.message);
    console.error("[Trellis 3D] Error status:", error.status);
    console.error("[Trellis 3D] Error body:", error.body);

    if (error.message?.includes("credentials")) {
      throw new Error("FAL_API_KEY 无效或已过期，请检查环境变量设置");
    }
    if (error.message?.includes("insufficient")) {
      throw new Error("fal.ai 帐户余额不足，请充值后重试");
    }
    if (error.status === 422) {
      const detail = error.body?.detail || error.message || "";
      console.error("[Trellis 3D] 422 detail:", JSON.stringify(detail));
      throw new Error(`3D 模型生成失败 (422): ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    }

    throw new Error(`3D 模型生成失败: ${error.message || "未知错误"}`);
  }
}

// ─── 检查 fal.ai 是否已配置 ──────────────────────────
export function isFalConfigured(): boolean {
  return !!process.env.FAL_API_KEY;
}
