import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import {
  generate3DModel,
  get3DTaskStatus,
  estimate3DCost,
  isFalConfigured,
  type ModelTier,
} from "../services/hunyuan3d";
import { TRPCError } from "@trpc/server";
import { deductCredits, getUserPlan, getCredits } from "../credits";
import { CREDIT_COSTS } from "../../shared/credits";

/**
 * Hunyuan3D 2D to 3D Router
 *
 * 支持两种模式：
 * - rapid（闪电 3D）：5-8 Credits，15-30 秒
 * - pro（精雕 3D）：9-18 Credits，45-90 秒
 *
 * 输出格式：GLB / OBJ（可导入 Blender / Unity / Unreal Engine）
 */

// 根据选项计算 Credit action key
function getCreditAction(
  tier: ModelTier,
  enablePbr: boolean,
  enableMultiview: boolean,
  enableCustomFaces: boolean,
): keyof typeof CREDIT_COSTS {
  if (tier === "rapid") {
    return enablePbr ? "rapid3D_pbr" : "rapid3D";
  }
  if (enablePbr && enableMultiview && enableCustomFaces) return "pro3D_full";
  if (enablePbr && enableMultiview) return "pro3D_pbr_mv";
  if (enablePbr) return "pro3D_pbr";
  return "pro3D";
}

export const hunyuan3dRouter = router({
  /**
   * 生成 3D 模型（支持 Rapid / Pro）
   * 返回 GLB URL + OBJ URL，可直接下载导入 3D 软件
   */
  generate: protectedProcedure
    .input(
      z.object({
        imageUrl: z.string().url(),
        tier: z.enum(["rapid", "pro"]).default("rapid"),
        textureResolution: z.enum(["512", "1024", "2048"]).optional(),
        outputFormat: z.enum(["glb", "obj"]).optional(),
        enablePbr: z.boolean().default(false),
        multiviewUrls: z.array(z.string().url()).optional(),
        targetFaceCount: z.number().min(1000).max(500000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const userRole = ctx.user.role;
      const tier = input.tier as ModelTier;
      const enableMultiview = !!(tier === "pro" && input.multiviewUrls?.length);
      const enableCustomFaces = !!(tier === "pro" && input.targetFaceCount);

      const creditAction = getCreditAction(tier, input.enablePbr, enableMultiview, enableCustomFaces);
      const creditsRequired = CREDIT_COSTS[creditAction];

      // 管理员免扣费
      if (userRole !== "admin") {
        const balanceInfo = await getCredits(userId);
        const availableBalance = typeof balanceInfo === "number" ? balanceInfo : balanceInfo.totalAvailable;
        if (availableBalance < creditsRequired) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Credits 不足，需要 ${creditsRequired} Credits，当前余额 ${availableBalance}`,
          });
        }

        const tierLabel = tier === "rapid" ? "闪电 3D" : "精雕 3D";
        const extras = [
          input.enablePbr && "PBR 材质",
          enableMultiview && "多视角",
          enableCustomFaces && "自定义面数",
        ].filter(Boolean).join(" + ");
        const desc = `${tierLabel}${extras ? ` + ${extras}` : ""} (Hunyuan3D)`;
        await deductCredits(userId, creditAction, desc);
      }

      if (!isFalConfigured()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "3D 生成服务未配置（FAL_API_KEY 未设置），请联系管理员",
        });
      }

      const result = await generate3DModel({
        image_url: input.imageUrl,
        tier,
        texture_resolution: input.textureResolution
          ? (parseInt(input.textureResolution) as 512 | 1024 | 2048)
          : 1024,
        output_format: input.outputFormat || "glb",
        enable_pbr: input.enablePbr,
        multiview_urls: input.multiviewUrls,
        target_face_count: input.targetFaceCount,
      });

      if (result.status === "failed") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: result.error || "3D 模型生成失败",
        });
      }

      return {
        success: true,
        requestId: result.request_id,
        status: result.status,
        tier,
        output: result.output,
        creditsUsed: creditsRequired,
        timeTaken: result.time_taken,
      };
    }),

  /**
   * 查询生成任务状态
   */
  getStatus: protectedProcedure
    .input(
      z.object({
        requestId: z.string(),
        tier: z.enum(["rapid", "pro"]).default("rapid"),
      })
    )
    .query(async ({ input }) => {
      const result = await get3DTaskStatus(input.requestId, input.tier as ModelTier);
      return {
        success: true,
        requestId: result.request_id,
        status: result.status,
        output: result.output,
        error: result.error,
      };
    }),

  /**
   * 估算生成成本
   */
  estimateCost: protectedProcedure
    .input(
      z.object({
        tier: z.enum(["rapid", "pro"]).default("rapid"),
        enablePbr: z.boolean().default(false),
        enableMultiview: z.boolean().default(false),
        enableCustomFaces: z.boolean().default(false),
      })
    )
    .query(async ({ input }) => {
      const costEstimate = estimate3DCost(
        input.tier as ModelTier,
        input.enablePbr,
        input.enableMultiview,
        input.enableCustomFaces,
      );
      return { success: true, ...costEstimate };
    }),

  /**
   * 检查 3D 服务状态
   */
  // AI 去背景抠图（BiRefNet v2）
  removeBackground: protectedProcedure
    .input(z.object({ imageUrl: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      // 扣除 2 Credits
      const credits = await getCredits(userId);
      if (credits.totalAvailable < 2) {
        throw new TRPCError({ code: "FORBIDDEN", message: "積分不足，去背景需要 2 Credits" });
      }
      await deductCredits(userId, "removeBg", "AI 去背景");

      try {
        const { fal } = await import("@fal-ai/client");
        const falKey = process.env.FAL_KEY;
        if (!falKey) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "FAL_KEY 未配置" });
        fal.config({ credentials: falKey });

        const result = await fal.subscribe("fal-ai/birefnet/v2", {
          input: { image_url: input.imageUrl },
        }) as any;

        const outputUrl = result?.data?.image?.url || result?.image?.url || result?.data?.url;
        if (!outputUrl) throw new Error("去背景失败，未返回结果");

        return { success: true, outputUrl };
      } catch (e: any) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e.message || "去背景失败" });
      }
    }),

  checkService: protectedProcedure.query(async () => {
    const configured = isFalConfigured();
    return {
      configured,
      provider: configured ? "fal.ai Hunyuan3D v3.1" : "未配置",
      tiers: {
        rapid: { name: "闪电 3D", endpoint: "v3.1/rapid", costPerGen: "$0.225" },
        pro: { name: "精雕 3D", endpoint: "v3.1/pro", costPerGen: "$0.375" },
      },
    };
  }),
});
