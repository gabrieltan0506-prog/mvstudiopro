import { fal } from "@fal-ai/client";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";

/**
 * Hunyuan3D 2D to 3D Service
 *
 * 支持两种模式：
 * - Rapid（闪电 3D）：fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d，$0.225/次
 * - Pro（精雕 3D）：fal-ai/hunyuan-3d/v3.1/pro/image-to-3d，$0.375/次
 *
 * 输出格式：GLB + OBJ（可导入 Blender / Unity / Unreal）
 */

// ─── Endpoints ──────────────────────────────────────────
const ENDPOINTS = {
  rapid: "fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d",
  pro: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",
} as const;

export type ModelTier = "rapid" | "pro";

// ─── 类型定义 ──────────────────────────────────────────
export interface Hunyuan3DInput {
  image_url: string;
  tier?: ModelTier;
  texture_resolution?: 512 | 1024 | 2048;
  output_format?: "glb" | "obj";
  enable_pbr?: boolean;
  /** Pro 专属：多视角输入图片 URLs */
  multiview_urls?: string[];
  /** Pro 专属：自定义面数 */
  target_face_count?: number;
  num_inference_steps?: number;
}

export interface Hunyuan3DOutput {
  /** GLB 模型 URL（可直接导入 Blender/Unity/Unreal） */
  model_url: string;
  /** OBJ 模型 URL */
  obj_url?: string;
  /** 纹理图片 URL */
  texture_url?: string;
  /** 预览缩略图 URL */
  preview_url?: string;
  /** 可用的导出格式 */
  available_formats: string[];
}

export interface Hunyuan3DTask {
  request_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  output?: Hunyuan3DOutput;
  error?: string;
  time_taken?: number;
}

// ─── 初始化 ─────────────────────────────────────────────
function ensureFalConfigured() {
  const falKey = process.env.FAL_API_KEY;
  if (!falKey) {
    throw new Error("FAL_API_KEY 环境变量未设置。请在 Settings → Secrets 中添加 FAL_API_KEY。");
  }
  fal.config({ credentials: falKey });
}

export function isHunyuan3DAvailable(): boolean {
  return !!process.env.FAL_API_KEY;
}

// ─── BiRefNet 去背景 ───────────────────────────────────
/**
 * Use fal.ai BiRefNet to remove background from image before 3D conversion.
 * This significantly improves 3D model quality by preventing background from being baked into the mesh.
 */
export async function removeBackground(imageUrl: string): Promise<string> {
  ensureFalConfigured();
  console.log("[BiRefNet] Starting background removal...");
  const startTime = Date.now();

  try {
    const accessibleUrl = await ensureAccessibleUrl(imageUrl);
    const result = await fal.subscribe("fal-ai/birefnet", {
      input: {
        image_url: accessibleUrl,
        model: "General Use (Heavy)",
        operating_resolution: "2048x2048",
        output_format: "png",
      },
      logs: true,
    });

    const data = result.data as any;
    const outputUrl = data?.image?.url;
    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);

    if (!outputUrl) {
      console.error("[BiRefNet] No output image URL in response:", JSON.stringify(data, null, 2));
      throw new Error("去背景失敗：未返回有效的图片");
    }

    console.log(`[BiRefNet] Background removed in ${timeTaken}s. Output: ${outputUrl.substring(0, 80)}`);
    return outputUrl;
  } catch (error: any) {
    const timeTaken = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`[BiRefNet] Failed after ${timeTaken}s:`, error.message);
    // Fall back to original image if background removal fails
    console.log("[BiRefNet] Falling back to original image...");
    return imageUrl;
  }
}

// ─── 生成 3D 模型 ───────────────────────────────────────
/**
 * Ensure image URL is accessible by fal.ai — download and convert to base64 or upload to fal storage
 */
async function ensureAccessibleUrl(imageUrl: string): Promise<string> {
  if (imageUrl.startsWith("data:") || imageUrl.includes("fal.media") || imageUrl.includes("fal-cdn")) {
    console.log("[Hunyuan3D] URL 已可访问，直接使用");
    return imageUrl;
  }

  console.log("[Hunyuan3D] 图片 URL 可能不可公开访问，正在转换...");

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`下载图片失败: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const sizeMB = buffer.length / (1024 * 1024);
    console.log(`[Hunyuan3D] 图片大小: ${sizeMB.toFixed(2)} MB, 类型: ${contentType}`);

    if (sizeMB > 6) {
      console.log("[Hunyuan3D] 文件较大，使用 fal.storage.upload...");
      const blob = new Blob([buffer], { type: contentType });
      const falUrl = await fal.storage.upload(blob);
      console.log("[Hunyuan3D] 已上传到 fal.ai storage:", falUrl);
      return falUrl;
    }

    const base64 = buffer.toString("base64");
    const mimeType = contentType.includes("png") ? "image/png" : "image/jpeg";
    const dataUri = `data:${mimeType};base64,${base64}`;
    console.log(`[Hunyuan3D] 已转换为 base64 data URI (${(base64.length / 1024).toFixed(1)} KB)`);
    return dataUri;
  } catch (downloadError: any) {
    console.error("[Hunyuan3D] 下载图片失败:", downloadError.message);
    console.log("[Hunyuan3D] 回退：尝试直接使用原始 URL...");
    return imageUrl;
  }
}

export async function generate3DModel(input: Hunyuan3DInput): Promise<Hunyuan3DTask> {
  const startTime = Date.now();
  const tier = input.tier || "rapid";
  const endpoint = ENDPOINTS[tier];

  try {
    ensureFalConfigured();

    // Ensure image URL is accessible for fal.ai
    const accessibleUrl = await ensureAccessibleUrl(input.image_url);
    console.log(`[Hunyuan3D] Using image URL: ${accessibleUrl}`);

    // 构建请求参数
    const falInput: Record<string, any> = {
      input_image_url: accessibleUrl,
      num_inference_steps: input.num_inference_steps ?? (tier === "pro" ? 50 : 30),
    };

    if (input.enable_pbr !== undefined) {
      falInput.enable_pbr = input.enable_pbr;
    }
    if (input.texture_resolution) {
      falInput.texture_resolution = input.texture_resolution;
    }
    if (input.output_format) {
      falInput.output_format = input.output_format;
    }

    // Pro 专属参数
    if (tier === "pro") {
      if (input.multiview_urls && input.multiview_urls.length > 0) {
        falInput.multiview_images = input.multiview_urls.map((url) => ({ url }));
      }
      if (input.target_face_count) {
        falInput.target_face_count = input.target_face_count;
      }
    }

    console.log(`[Hunyuan3D] Starting ${tier} generation at ${endpoint}...`);

    const result = await fal.subscribe(endpoint, {
      input: falInput,
      logs: true,
      onQueueUpdate: (update: any) => {
        if (update.status === "IN_PROGRESS") {
          const logMessages = update.logs?.map((l: any) => l.message).join("; ") || "";
          console.log(`[Hunyuan3D ${tier}] In progress... ${logMessages}`);
        }
      },
    });

    const timeTaken = (Date.now() - startTime) / 1000;
    const data = result.data as any;

    // 解析返回结果 — fal.ai 返回结构可能有多种形式
    const glbUrl = data?.model_urls?.glb?.url || data?.model_glb?.url || data?.model_mesh?.url || data?.glb?.url || data?.model_url || "";
    const objUrl = data?.model_urls?.obj?.url || data?.model_glb?.url || data?.obj?.url || data?.obj_url || null;
    const textureUrl = data?.texture?.url || data?.textures?.[0]?.url || data?.texture_url || null;
    const previewUrl = data?.thumbnail?.url || data?.preview?.url || data?.preview_url || null;

    const availableFormats: string[] = [];
    if (glbUrl) availableFormats.push("glb");
    if (objUrl) availableFormats.push("obj");

    if (!glbUrl) {
      console.error("[Hunyuan3D] 返回数据结构:", JSON.stringify(data, null, 2));
      throw new Error("3D 模型生成失败：未返回有效的模型文件");
    }

    console.log(`[Hunyuan3D] ${tier} generation completed in ${timeTaken.toFixed(1)}s. Formats: ${availableFormats.join(", ")}`);

    return {
      request_id: result.requestId || `local-${Date.now()}`,
      status: "completed",
      output: {
        model_url: glbUrl,
        obj_url: objUrl ?? undefined,
        texture_url: textureUrl ?? undefined,
        preview_url: previewUrl ?? undefined,
        available_formats: availableFormats,
      },
      time_taken: timeTaken,
    };
  } catch (error: any) {
    const timeTaken = (Date.now() - startTime) / 1000;
    console.error(`[Hunyuan3D ${tier}] Generation failed after ${timeTaken.toFixed(1)}s:`, error);

    if (error.message?.includes("credentials") || error.message?.includes("FAL_API_KEY") || error.message?.includes("FAL_KEY")) {
      return { request_id: "", status: "failed", error: "FAL_API_KEY 无效或已过期，请检查环境变量设置", time_taken: timeTaken };
    }
    if (error.message?.includes("insufficient")) {
      return { request_id: "", status: "failed", error: "fal.ai 帐户余额不足，请充值后重试", time_taken: timeTaken };
    }
    if (error.status === 422) {
      return { request_id: "", status: "failed", error: "图片格式不支持或无法访问，请使用 JPG/PNG 格式的公开 URL", time_taken: timeTaken };
    }

    return {
      request_id: "",
      status: "failed",
      error: error instanceof Error ? error.message : "未知错误",
      time_taken: timeTaken,
    };
  }
}

// ─── 查询任务状态 ───────────────────────────────────────
export async function get3DTaskStatus(requestId: string, tier: ModelTier = "rapid"): Promise<Hunyuan3DTask> {
  try {
    ensureFalConfigured();
    const endpoint = ENDPOINTS[tier];

    const result = await fal.queue.status(endpoint, {
      requestId,
      logs: true,
    }) as any;

    if (result.status === "COMPLETED") {
      const data = result.data;
      const glbUrl = data?.model_mesh?.url || data?.glb?.url || data?.model_url || "";
      const objUrl = data?.obj?.url || data?.obj_url || null;

      return {
        request_id: requestId,
        status: "completed",
        output: {
          model_url: glbUrl,
          obj_url: objUrl ?? undefined,
          texture_url: data?.texture?.url || data?.texture_url,
          preview_url: data?.thumbnail?.url || data?.preview_url,
          available_formats: [glbUrl && "glb", objUrl && "obj"].filter(Boolean) as string[],
        },
      };
    } else if (result.status === "IN_QUEUE" || result.status === "IN_PROGRESS") {
      return { request_id: requestId, status: "processing" };
    } else {
      return { request_id: requestId, status: "failed", error: "任务失败或已取消" };
    }
  } catch (error) {
    console.error("[Hunyuan3D] Status check failed:", error);
    return {
      request_id: requestId,
      status: "failed",
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}

// ─── 成本估算 ───────────────────────────────────────────
export interface CostEstimate {
  tier: ModelTier;
  apiCostUSD: number;
  apiCostCNY: number;
  credits: number;
  enablePbr: boolean;
  enableMultiview: boolean;
  enableCustomFaces: boolean;
}

export function estimate3DCost(
  tier: ModelTier = "rapid",
  enablePbr: boolean = false,
  enableMultiview: boolean = false,
  enableCustomFaces: boolean = false,
): CostEstimate {
  const baseCost = tier === "rapid" ? 0.225 : 0.375;
  const pbrCost = enablePbr ? 0.15 : 0;
  const mvCost = (tier === "pro" && enableMultiview) ? 0.15 : 0;
  const faceCost = (tier === "pro" && enableCustomFaces) ? 0.15 : 0;
  const totalUSD = baseCost + pbrCost + mvCost + faceCost;

  let credits: number;
  if (tier === "rapid") {
    credits = enablePbr ? 8 : 5;
  } else {
    if (enablePbr && enableMultiview && enableCustomFaces) credits = 18;
    else if (enablePbr && enableMultiview) credits = 15;
    else if (enablePbr) credits = 12;
    else credits = 9;
  }

  return {
    tier,
    apiCostUSD: totalUSD,
    apiCostCNY: Math.round(totalUSD * 7.2 * 10) / 10,
    credits,
    enablePbr,
    enableMultiview,
    enableCustomFaces,
  };
}
