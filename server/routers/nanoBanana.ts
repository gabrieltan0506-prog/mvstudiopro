/**
 * Nano Banana Pro (NBP) Router
 * 
 * 提供 NBP 图片生成 API 代理，包含：
 * - 分镜图生成（单张/批量）
 * - 虚拟偶像 2K/4K 生成
 * - 水印逻辑（免费/初级有水印，高级无水印）
 * - Credits 不足自动降级到 Nano Banana Flash (1K)
 * - 会员层级限制（免费 10 张、初级 30 张、高级 70 张）
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { generateGeminiImage } from "../gemini-image";
import { storagePut } from "../storage";
import { deductNbpCredits, checkNbpCapacity, getUserPlan, deductCredits } from "../credits";
import { PLANS, CREDIT_COSTS } from "../plans";

// ─── NBP 图片生成（通过用户的 Gemini API Key）─────────
async function generateNbpImage(
  apiKey: string,
  prompt: string,
  resolution: "2k" | "4k",
  referenceImageUrl?: string
): Promise<{ imageData: Buffer; mimeType: string } | null> {
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });

    const contents: any[] = [];

    // 如果有参考图片，先添加参考图
    if (referenceImageUrl) {
      try {
        const resp = await fetch(referenceImageUrl);
        const imgBuffer = Buffer.from(await resp.arrayBuffer());
        const base64 = imgBuffer.toString("base64");
        const mimeType = resp.headers.get("content-type") || "image/png";
        contents.push({
          inlineData: { mimeType, data: base64 },
        });
      } catch (e) {
        console.warn("[NBP] Failed to load reference image:", e);
      }
    }

    contents.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: "nano-banana-pro-preview",
      contents,
      config: {
        responseModalities: ["image", "text"],
      },
    });

    // 从回应中提取图片
    if (response.candidates?.[0]?.content?.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData?.data) {
          const imageData = Buffer.from(part.inlineData.data, "base64");
          return {
            imageData,
            mimeType: part.inlineData.mimeType || "image/png",
          };
        }
      }
    }

    return null;
  } catch (error) {
    console.error("[NBP] Generation failed:", error);
    return null;
  }
}

// ─── 添加水印 ──────────────────────────────────────
async function addWatermark(imageBuffer: Buffer, _mimeType: string): Promise<Buffer> {
  try {
    const sharp = (await import("sharp")).default;
    const image = sharp(imageBuffer);
    const metadata = await image.metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;

    const fontSize = Math.max(16, Math.floor(width / 40));
    const watermarkText = "Powered by MV Studio Pro";
    const svgWatermark = `
      <svg width="${width}" height="${height}">
        <style>
          .watermark {
            fill: rgba(255, 255, 255, 0.5);
            font-size: ${fontSize}px;
            font-family: Arial, sans-serif;
            font-weight: bold;
          }
        </style>
        <text x="${width - 20}" y="${height - 20}" text-anchor="end" class="watermark">${watermarkText}</text>
        <text x="${width - 20}" y="${height - 20 - fontSize - 5}" text-anchor="end" class="watermark" style="font-size: ${fontSize * 0.7}px;">mvstudiopro.com</text>
      </svg>
    `;

    const watermarked = await image
      .composite([{
        input: Buffer.from(svgWatermark),
        gravity: "southeast",
      }])
      .png()
      .toBuffer();

    return watermarked;
  } catch (error) {
    console.warn("[NBP] Watermark failed, returning original:", error);
    return imageBuffer;
  }
}

// ─── 上传图片到 S3 ─────────────────────────────────
async function uploadImage(imageBuffer: Buffer, filename: string, mimeType: string): Promise<string> {
  const { url } = await storagePut(filename, imageBuffer, mimeType);
  return url;
}

// ─── Router ────────────────────────────────────────
export const nanoBananaRouter = router({

  /**
   * 检查用户的 NBP 容量（可生成多少张图）
   */
  checkCapacity: protectedProcedure
    .input(z.object({
      resolution: z.enum(["2k", "4k"]).default("2k"),
    }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user!.id;
      const plan = await getUserPlan(userId);
      const planConfig = PLANS[plan];

      const capacity = await checkNbpCapacity(userId, input.resolution);

      return {
        plan,
        nbpEnabled: planConfig.nbp.enabled,
        maxResolution: planConfig.nbp.maxResolution,
        watermark: planConfig.nbp.watermark,
        maxImagesPerSession: planConfig.limits.storyboardImages,
        upgradeAt: planConfig.limits.storyboardImageUpgradeAt,
        creditsAvailable: capacity.totalAvailable,
        maxAffordableImages: capacity.maxImages,
        costPerImage: capacity.costPerImage,
      };
    }),

  /**
   * 生成单张分镜图
   * - 有 NBP API Key + Credits → NBP 生成
   * - 无 Key 或 Credits 不足 → Nano Banana Flash 1K 降级（有水印）
   */
  generateStoryboardImage: protectedProcedure
    .input(z.object({
      sceneDescription: z.string().min(1),
      sceneIndex: z.number().int().min(0),
      totalScenes: z.number().int().min(1),
      geminiApiKey: z.string().optional(),
      referenceImageUrl: z.string().url().optional(),
      resolution: z.enum(["2k", "4k"]).default("2k"),
      style: z.enum(["realistic", "anime", "cinematic"]).default("cinematic"),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user!.id;
      const plan = await getUserPlan(userId);
      const planConfig = PLANS[plan];

      // 检查分镜图数量限制
      if (input.sceneIndex >= planConfig.limits.storyboardImages) {
        return {
          success: false,
          error: `您的方案最多支持 ${planConfig.limits.storyboardImages} 张分镜图/次`,
          needUpgrade: true,
          currentPlan: plan,
        };
      }

      // 检查是否到达升级提醒阈值
      const showUpgradeHint = planConfig.limits.storyboardImageUpgradeAt > 0
        && input.sceneIndex >= planConfig.limits.storyboardImageUpgradeAt - 1;

      // 构建 Prompt
      const styleMap = {
        realistic: "photorealistic, cinematic photography, 8K detail",
        anime: "anime style, vibrant colors, detailed illustration",
        cinematic: "cinematic film still, dramatic lighting, movie quality",
      };

      const fullPrompt = `Professional video storyboard frame. Scene ${input.sceneIndex + 1} of ${input.totalScenes}. ${styleMap[input.style]}. ${input.sceneDescription}. Aspect ratio 16:9, high quality, detailed.`;

      let imageUrl: string;
      let engine: "nbp" | "flash" = "flash";
      let resolution = input.resolution;

      // 尝试 NBP 生成
      if (planConfig.nbp.enabled && input.geminiApiKey) {
        if (resolution === "4k" && planConfig.nbp.maxResolution !== "4k") {
          resolution = "2k";
        }

        const capacity = await checkNbpCapacity(userId, resolution);
        if (capacity.maxImages > 0) {
          const deductResult = await deductNbpCredits(userId, 1, resolution, `分镜图 #${input.sceneIndex + 1}`);

          if (deductResult.success) {
            const result = await generateNbpImage(
              input.geminiApiKey,
              fullPrompt,
              resolution,
              input.referenceImageUrl
            );

            if (result) {
              let finalImage = result.imageData;
              if (planConfig.nbp.watermark) {
                finalImage = await addWatermark(finalImage, result.mimeType);
              }

              const filename = `storyboard/nbp_scene_${input.sceneIndex + 1}_${Date.now()}.png`;
              imageUrl = await uploadImage(finalImage, filename, "image/png");
              engine = "nbp";

              return {
                success: true,
                imageUrl,
                engine,
                resolution,
                watermark: planConfig.nbp.watermark,
                showUpgradeHint,
                creditsRemaining: deductResult.remainingBalance,
              };
            }
          }
        }
      }

      // Nano Banana Flash 1K 降级生成（免费，有水印）
      const flashResult = await generateGeminiImage({ prompt: fullPrompt, quality: "1k" });
      if (flashResult?.imageUrl) {
        try {
          const resp = await fetch(flashResult.imageUrl);
          const buffer = Buffer.from(await resp.arrayBuffer());
          const watermarked = await addWatermark(buffer, "image/png");
          const filename = `storyboard/flash_scene_${input.sceneIndex + 1}_${Date.now()}.png`;
          imageUrl = await uploadImage(watermarked, filename, "image/png");
        } catch {
          imageUrl = flashResult.imageUrl;
        }
      } else {
        return {
          success: false,
          error: "图片生成失败，请稍后重试",
          needUpgrade: false,
          currentPlan: plan,
        };
      }

      return {
        success: true,
        imageUrl,
        engine: "flash" as const,
        resolution: "standard",
        watermark: true,
        showUpgradeHint,
        creditsRemaining: 0,
        fallbackMessage: planConfig.nbp.enabled
          ? "Credits 不足，已自动切换至 Nano Banana Flash（1K，含水印）。充值即可恢复高清体验。"
          : undefined,
      };
    }),

  /**
   * 批量生成分镜图
   * NBP 生成到 Credits 用完为止，剩余用 Nano Banana Flash 1K 降级
   */
  batchGenerateStoryboardImages: protectedProcedure
    .input(z.object({
      scenes: z.array(z.object({
        description: z.string(),
        index: z.number().int(),
      })),
      geminiApiKey: z.string().optional(),
      referenceImageUrl: z.string().url().optional(),
      resolution: z.enum(["2k", "4k"]).default("2k"),
      style: z.enum(["realistic", "anime", "cinematic"]).default("cinematic"),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user!.id;
      const plan = await getUserPlan(userId);
      const planConfig = PLANS[plan];

      const maxScenes = planConfig.limits.storyboardImages;
      const scenes = input.scenes.slice(0, maxScenes);

      const results: Array<{
        index: number;
        imageUrl: string;
        engine: "nbp" | "flash";
        success: boolean;
        error?: string;
      }> = [];

      let nbpRemaining = 0;
      let resolution = input.resolution;

      if (planConfig.nbp.enabled && input.geminiApiKey) {
        if (resolution === "4k" && planConfig.nbp.maxResolution !== "4k") {
          resolution = "2k";
        }
        const capacity = await checkNbpCapacity(userId, resolution);
        nbpRemaining = capacity.maxImages;
      }

      const styleMap = {
        realistic: "photorealistic, cinematic photography, 8K detail",
        anime: "anime style, vibrant colors, detailed illustration",
        cinematic: "cinematic film still, dramatic lighting, movie quality",
      };

      for (const scene of scenes) {
        const fullPrompt = `Professional video storyboard frame. Scene ${scene.index + 1} of ${input.scenes.length}. ${styleMap[input.style]}. ${scene.description}. Aspect ratio 16:9, high quality, detailed.`;

        try {
          if (nbpRemaining > 0 && input.geminiApiKey) {
            const deductResult = await deductNbpCredits(userId, 1, resolution, `批量分镜图 #${scene.index + 1}`);

            if (deductResult.success) {
              const result = await generateNbpImage(
                input.geminiApiKey,
                fullPrompt,
                resolution,
                input.referenceImageUrl
              );

              if (result) {
                let finalImage = result.imageData;
                if (planConfig.nbp.watermark) {
                  finalImage = await addWatermark(finalImage, result.mimeType);
                }
                const filename = `storyboard/nbp_batch_${scene.index + 1}_${Date.now()}.png`;
                const imageUrl = await uploadImage(finalImage, filename, "image/png");
                results.push({ index: scene.index, imageUrl, engine: "nbp", success: true });
                nbpRemaining--;
                continue;
              }
            }
            nbpRemaining = 0;
          }

          // Nano Banana Flash 1K 降级
          const flashResult = await generateGeminiImage({ prompt: fullPrompt, quality: "1k" });
          if (flashResult?.imageUrl) {
            try {
              const resp = await fetch(flashResult.imageUrl);
              const buffer = Buffer.from(await resp.arrayBuffer());
              const watermarked = await addWatermark(buffer, "image/png");
              const filename = `storyboard/flash_batch_${scene.index + 1}_${Date.now()}.png`;
              const imageUrl = await uploadImage(watermarked, filename, "image/png");
              results.push({ index: scene.index, imageUrl, engine: "flash", success: true });
            } catch {
              results.push({ index: scene.index, imageUrl: flashResult.imageUrl, engine: "flash", success: true });
            }
          } else {
            results.push({ index: scene.index, imageUrl: "", engine: "flash", success: false, error: "生成失败" });
          }
        } catch (error) {
          results.push({
            index: scene.index,
            imageUrl: "",
            engine: "flash",
            success: false,
            error: error instanceof Error ? error.message : "未知错误",
          });
        }
      }

      const nbpCount = results.filter(r => r.engine === "nbp").length;
      const flashCount = results.filter(r => r.engine === "flash").length;
      const failCount = results.filter(r => !r.success).length;

      return {
        results,
        summary: {
          total: results.length,
          nbpGenerated: nbpCount,
          flashGenerated: flashCount,
          failed: failCount,
          truncated: input.scenes.length > maxScenes,
          truncatedCount: Math.max(0, input.scenes.length - maxScenes),
          showUpgradeHint: planConfig.limits.storyboardImageUpgradeAt > 0
            && results.length >= planConfig.limits.storyboardImageUpgradeAt,
        },
        plan,
        watermark: planConfig.nbp.watermark,
      };
    }),

  /**
   * NBP 虚拟偶像生成（2K/4K）
   */
  generateIdolImage: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      style: z.enum(["realistic", "anime", "3d"]).default("realistic"),
      description: z.string().min(1),
      geminiApiKey: z.string(),
      referenceImageUrl: z.string().url().optional(),
      resolution: z.enum(["2k", "4k"]).default("2k"),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user!.id;
      const plan = await getUserPlan(userId);
      const planConfig = PLANS[plan];

      if (!planConfig.nbp.enabled) {
        return {
          success: false,
          error: "您的方案不支持 NBP 生成，请升级到初级会员或使用 Nano Banana Flash（1K）",
          needUpgrade: true,
        };
      }

      let resolution = input.resolution;
      if (resolution === "4k" && planConfig.nbp.maxResolution !== "4k") {
        resolution = "2k";
      }

      const deductResult = await deductNbpCredits(userId, 1, resolution, `NBP 偶像: ${input.name}`);
      if (!deductResult.success) {
        return {
          success: false,
          error: "Credits 不足，请充值后重试。或使用 Nano Banana Flash（1K，含水印）。",
          needUpgrade: false,
          creditsNeeded: CREDIT_COSTS[resolution === "4k" ? "nbpImage4K" : "nbpImage2K"],
          creditsAvailable: deductResult.remainingBalance,
        };
      }

      const styleMap = {
        realistic: "photorealistic portrait, professional photography, studio lighting, 8K detail",
        anime: "anime character design, vibrant colors, detailed illustration, high quality",
        "3d": "3D rendered character, Pixar-style, detailed textures, professional quality",
      };

      const prompt = `Virtual idol character design. ${styleMap[input.style]}. Character name: ${input.name}. ${input.description}. Full body or upper body portrait, clean background, suitable for music video production.`;

      const result = await generateNbpImage(
        input.geminiApiKey,
        prompt,
        resolution,
        input.referenceImageUrl
      );

      if (!result) {
        return {
          success: false,
          error: "NBP 图片生成失败，请检查 API Key 或稍后重试",
          needUpgrade: false,
        };
      }

      let finalImage = result.imageData;
      if (planConfig.nbp.watermark) {
        finalImage = await addWatermark(finalImage, result.mimeType);
      }

      const filename = `idol/nbp_${input.name}_${resolution}_${Date.now()}.png`;
      const imageUrl = await uploadImage(finalImage, filename, "image/png");

      return {
        success: true,
        imageUrl,
        resolution,
        watermark: planConfig.nbp.watermark,
        creditsRemaining: deductResult.remainingBalance,
        engine: "nbp" as const,
      };
    }),

  /**
   * 获取 Credits 充值包列表
   */
  getCreditPacks: protectedProcedure
    .query(async () => {
      const { CREDIT_PACKS, SINGLE_PURCHASE } = await import("../plans");
      return {
        creditPacks: CREDIT_PACKS,
        singlePurchase: SINGLE_PURCHASE,
      };
    }),
});
