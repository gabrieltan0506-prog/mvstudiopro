/**
 * Kling AI tRPC Router
 * 
 * Provides endpoints for:
 * - 3.0 Omni Video (T2V, I2V, Storyboard, All-in-One)
 * - 2.6 Motion Control
 * - Lip-Sync (Face Identify + Audio Sync)
 * - Elements 3.0 (Image/Video Character)
 * - Task polling and management
 * - API key status and configuration
 * - Cost estimation
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { storagePut } from "../storage";
import {
  getKlingClient,
  configureKlingClient,
  parseKeysFromEnv,
  // Omni Video
  createOmniVideoTask,
  getOmniVideoTask,
  listOmniVideoTasks,
  buildT2VRequest,
  buildI2VRequest,
  buildStoryboardRequest,
  buildAllInOneRequest,
  // Motion Control
  createMotionControlTask,
  getMotionControlTask,
  buildMotionControlRequest,
  validateMotionControlInputs,
  // Lip-Sync
  identifyFaces,
  getFaceIdentifyResult,
  createLipSyncTask,
  getLipSyncTask,
  buildLipSyncWithAudio,
  // Elements
  createImageElement,
  createVideoElement,
  getElement,
  listElements,
  deleteElement,
  // Cost
  estimateOmniVideoCost,
  estimateMotionControlCost,
  estimateLipSyncCost,
  // Image Generation
  createImageTask,
  getImageTask,
  buildImageRequest,
  estimateImageCost,
} from "../kling";
import { deductCredits, getUserPlan, addCredits } from "../credits";
import { CREDIT_COSTS } from "../plans";
import { recordCreation } from "./creations";

// ─── Initialize Kling client from env on module load ─

let initialized = false;
function ensureInitialized() {
  if (initialized) return;
  const keys = parseKeysFromEnv();
  if (keys.length > 0) {
    const defaultRegion = (process.env.KLING_DEFAULT_REGION as "global" | "cn") ?? "cn";
    configureKlingClient(keys, defaultRegion);
    console.log(`[Kling] Initialized with ${keys.length} API key(s), default region: ${defaultRegion}`);
  }
  initialized = true;
}

// ─── Zod Schemas ────────────────────────────────────

const modeSchema = z.enum(["std", "pro"]).default("std");
const aspectRatioSchema = z.enum(["16:9", "9:16", "1:1"]).default("16:9");
const durationSchema = z.enum(["3", "4", "5", "6", "7", "8", "9", "10", "15"]).default("5");
const regionSchema = z.enum(["global", "cn"]).optional();

// ─── Router ─────────────────────────────────────────

export const klingRouter = router({

  // ═══════════════════════════════════════════════════
  // API Status & Configuration
  // ═══════════════════════════════════════════════════

  status: protectedProcedure.query(async () => {
    ensureInitialized();
    const client = getKlingClient();
    const stats = client.getKeyStats();
    return {
      configured: stats.length > 0,
      keys: stats.map((k) => ({
        id: k.id,
        region: k.region,
        enabled: k.enabled,
        remainingUnits: k.remainingUnits,
        expiresAt: k.expiresAt?.toISOString(),
      })),
      totalKeys: stats.length,
      activeKeys: stats.filter((k) => k.enabled).length,
    };
  }),

  // ═══════════════════════════════════════════════════
  // Cost Estimation
  // ═══════════════════════════════════════════════════

  estimateCost: protectedProcedure
    .input(z.object({
      type: z.enum(["omniVideo", "motionControl", "lipSync"]),
      mode: modeSchema,
      duration: z.number().min(3).max(30),
      hasVideoInput: z.boolean().default(false),
      hasAudio: z.boolean().default(false),
    }))
    .query(({ input }) => {
      switch (input.type) {
        case "omniVideo":
          return estimateOmniVideoCost({
            mode: input.mode,
            duration: input.duration,
            hasVideoInput: input.hasVideoInput,
            hasAudio: input.hasAudio,
          });
        case "motionControl":
          return estimateMotionControlCost({
            mode: input.mode,
            duration: input.duration,
          });
        case "lipSync":
          return estimateLipSyncCost({
            durationSec: input.duration,
          });
      }
    }),

  // ═══════════════════════════════════════════════════
  // 3.0 Omni Video
  // ═══════════════════════════════════════════════════

  omniVideo: router({
    // Text-to-Video
    createT2V: protectedProcedure
      .input(z.object({
        prompt: z.string().min(1).max(2500),
        negativePrompt: z.string().max(500).optional(),
        mode: modeSchema,
        aspectRatio: aspectRatioSchema,
        duration: durationSchema,
        cfgScale: z.number().min(0).max(1).default(0.5),
        region: regionSchema,
      }))
      .mutation(async ({ input }) => {
        ensureInitialized();
        const request = buildT2VRequest({
          prompt: input.prompt,
          negativePrompt: input.negativePrompt,
          mode: input.mode,
          aspectRatio: input.aspectRatio,
          duration: input.duration,
          cfgScale: input.cfgScale,
        });
        const result = await createOmniVideoTask(request, input.region);
        return { success: true, taskId: result.task_id };
      }),

    // Image-to-Video
    createI2V: protectedProcedure
      .input(z.object({
        prompt: z.string().min(1).max(2500),
        imageUrl: z.string().min(1),
        imageType: z.enum(["first_frame", "end_frame"]).default("first_frame"),
        negativePrompt: z.string().max(500).optional(),
        mode: modeSchema,
        aspectRatio: aspectRatioSchema,
        duration: durationSchema,
        cfgScale: z.number().min(0).max(1).default(0.5),
        region: regionSchema,
      }))
      .mutation(async ({ input }) => {
        ensureInitialized();
        const request = buildI2VRequest({
          prompt: input.prompt,
          imageUrl: input.imageUrl,
          imageType: input.imageType,
          negativePrompt: input.negativePrompt,
          mode: input.mode,
          aspectRatio: input.aspectRatio,
          duration: input.duration,
          cfgScale: input.cfgScale,
        });
        const result = await createOmniVideoTask(request, input.region);
        return { success: true, taskId: result.task_id };
      }),

    // Multi-shot Storyboard
    createStoryboard: protectedProcedure
      .input(z.object({
        shots: z.array(z.object({
          prompt: z.string().min(1).max(2500),
          duration: z.string(),
        })).min(1).max(6),
        mode: modeSchema,
        aspectRatio: aspectRatioSchema,
        elementIds: z.array(z.number()).optional(),
        imageUrl: z.string().optional(),
        region: regionSchema,
      }))
      .mutation(async ({ input }) => {
        ensureInitialized();
        const request = buildStoryboardRequest({
          shots: input.shots,
          mode: input.mode,
          aspectRatio: input.aspectRatio,
          elementIds: input.elementIds,
          imageUrl: input.imageUrl,
        });
        const result = await createOmniVideoTask(request, input.region);
        return { success: true, taskId: result.task_id };
      }),

    // All-in-One Reference
    createAllInOne: protectedProcedure
      .input(z.object({
        prompt: z.string().min(1).max(2500),
        elementIds: z.array(z.number()).optional(),
        imageUrls: z.array(z.object({
          url: z.string(),
          type: z.enum(["first_frame", "end_frame"]).optional(),
        })).optional(),
        videoUrl: z.string().optional(),
        videoReferType: z.enum(["feature", "base"]).default("feature"),
        keepOriginalSound: z.boolean().default(false),
        mode: modeSchema,
        aspectRatio: aspectRatioSchema,
        duration: durationSchema,
        region: regionSchema,
      }))
      .mutation(async ({ input }) => {
        ensureInitialized();
        const request = buildAllInOneRequest({
          prompt: input.prompt,
          elementIds: input.elementIds,
          imageUrls: input.imageUrls,
          videoUrl: input.videoUrl,
          videoReferType: input.videoReferType,
          keepOriginalSound: input.keepOriginalSound,
          mode: input.mode,
          aspectRatio: input.aspectRatio,
          duration: input.duration,
        });
        const result = await createOmniVideoTask(request, input.region);
        return { success: true, taskId: result.task_id };
      }),

    // Query task status
    getTask: protectedProcedure
      .input(z.object({
        taskId: z.string().min(1),
        region: regionSchema,
      }))
      .query(async ({ input }) => {
        ensureInitialized();
        return getOmniVideoTask(input.taskId, input.region);
      }),

    // List tasks
    listTasks: protectedProcedure
      .input(z.object({
        pageNum: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(30),
        region: regionSchema,
      }))
      .query(async ({ input }) => {
        ensureInitialized();
        return listOmniVideoTasks(input.pageNum, input.pageSize, input.region);
      }),
  }),

  // ═══════════════════════════════════════════════════
  // 2.6 Motion Control
  // ═══════════════════════════════════════════════════

  motionControl: router({
    create: protectedProcedure
      .input(z.object({
        imageUrl: z.string().min(1),
        videoUrl: z.string().min(1),
        orientation: z.enum(["image", "video"]).default("video"),
        mode: modeSchema,
        prompt: z.string().max(2500).optional(),
        keepOriginalSound: z.boolean().default(true),
        region: regionSchema,
      }))
      .mutation(async ({ input }) => {
        ensureInitialized();
        const request = buildMotionControlRequest({
          imageUrl: input.imageUrl,
          videoUrl: input.videoUrl,
          orientation: input.orientation,
          mode: input.mode,
          prompt: input.prompt,
          keepOriginalSound: input.keepOriginalSound,
        });
        const result = await createMotionControlTask(request, input.region);
        return { success: true, taskId: result.task_id };
      }),

    getTask: protectedProcedure
      .input(z.object({
        taskId: z.string().min(1),
        region: regionSchema,
      }))
      .query(async ({ input }) => {
        ensureInitialized();
        return getMotionControlTask(input.taskId, input.region);
      }),

    validate: protectedProcedure
      .input(z.object({
        orientation: z.enum(["image", "video"]),
        estimatedDurationSec: z.number().optional(),
      }))
      .query(({ input }) => {
        return validateMotionControlInputs({
          orientation: input.orientation,
          estimatedDurationSec: input.estimatedDurationSec,
        });
      }),
  }),

  // ═══════════════════════════════════════════════════
  // Lip-Sync
  // ═══════════════════════════════════════════════════

  lipSync: router({
    // Step 1: Identify faces in video
    identifyFaces: protectedProcedure
      .input(z.object({
        videoUrl: z.string().min(1),
        region: regionSchema,
      }))
      .mutation(async ({ input }) => {
        ensureInitialized();
        const result = await identifyFaces({ video_url: input.videoUrl }, input.region);
        return result;
      }),

    // Query face identification result
    getFaceResult: protectedProcedure
      .input(z.object({
        taskId: z.string().min(1),
        region: regionSchema,
      }))
      .query(async ({ input }) => {
        ensureInitialized();
        return getFaceIdentifyResult(input.taskId, input.region);
      }),

    // Step 2: Create lip-sync task
    create: protectedProcedure
      .input(z.object({
        sessionId: z.string().min(1),
        faceId: z.string().min(1),
        audioUrl: z.string().min(1),
        audioStartTime: z.number().optional(),
        audioEndTime: z.number().optional(),
        insertTime: z.number().default(0),
        soundVolume: z.number().min(0).max(2).default(1),
        originalAudioVolume: z.number().min(0).max(2).default(0),
        region: regionSchema,
      }))
      .mutation(async ({ input }) => {
        ensureInitialized();
        const request = buildLipSyncWithAudio({
          sessionId: input.sessionId,
          faceId: input.faceId,
          audioUrl: input.audioUrl,
          audioStartTime: input.audioStartTime,
          audioEndTime: input.audioEndTime,
          insertTime: input.insertTime,
          soundVolume: input.soundVolume,
          originalAudioVolume: input.originalAudioVolume,
        });
        const result = await createLipSyncTask(request, input.region);
        return { success: true, taskId: result.task_id };
      }),

    // Query lip-sync task status
    getTask: protectedProcedure
      .input(z.object({
        taskId: z.string().min(1),
        region: regionSchema,
      }))
      .query(async ({ input }) => {
        ensureInitialized();
        return getLipSyncTask(input.taskId, input.region);
      }),
  }),

  // ═══════════════════════════════════════════════════
  // Elements 3.0
  // ═══════════════════════════════════════════════════

  elements: router({
    // Create image character element
    createImage: protectedProcedure
      .input(z.object({
        imageUrls: z.array(z.string().min(1)).min(1),
        name: z.string().max(100).optional(),
        region: regionSchema,
      }))
      .mutation(async ({ input }) => {
        ensureInitialized();
        const result = await createImageElement({
          image_list: input.imageUrls.map((url) => ({ image_url: url })),
          name: input.name,
        }, input.region);
        return { success: true, elementId: result.element_id };
      }),

    // Create video character element (Elements 3.0 with audio capture)
    createVideo: protectedProcedure
      .input(z.object({
        videoUrl: z.string().min(1),
        name: z.string().max(100).optional(),
        region: regionSchema,
      }))
      .mutation(async ({ input }) => {
        ensureInitialized();
        const result = await createVideoElement({
          video_url: input.videoUrl,
          name: input.name,
        }, input.region);
        return { success: true, elementId: result.element_id };
      }),

    // Get element details
    get: protectedProcedure
      .input(z.object({
        elementId: z.number(),
        region: regionSchema,
      }))
      .query(async ({ input }) => {
        ensureInitialized();
        return getElement(input.elementId, input.region);
      }),

    // List all elements
    list: protectedProcedure
      .input(z.object({
        pageNum: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(30),
        region: regionSchema,
      }))
      .query(async ({ input }) => {
        ensureInitialized();
        return listElements(input.pageNum, input.pageSize, input.region);
      }),

    // Delete element
    delete: protectedProcedure
      .input(z.object({
        elementId: z.number(),
        region: regionSchema,
      }))
      .mutation(async ({ input }) => {
        ensureInitialized();
        await deleteElement(input.elementId, input.region);
        return { success: true };
      }),
  }),

  // ═══════════════════════════════════════════════════
  // Image Generation
  // ═══════════════════════════════════════════════════

  imageGen: router({
    create: protectedProcedure
      .input(z.object({
        prompt: z.string().min(1).max(2500),
        negativePrompt: z.string().max(500).optional(),
        model: z.enum(["kling-image-o1", "kling-v2-1"]).default("kling-image-o1"),
        resolution: z.enum(["1k", "2k"]).default("1k"),
        aspectRatio: z.string().default("1:1"),
        referenceImageUrl: z.string().optional(),
        imageFidelity: z.number().min(0).max(1).optional(),
        humanFidelity: z.number().min(0).max(1).optional(),
        count: z.number().min(1).max(4).default(1),
        region: regionSchema,
      }))
      .mutation(async ({ input, ctx }) => {
        ensureInitialized();
        const userId = ctx.user.id;
        const isAdmin = ctx.user.role === "admin";

        // Determine credit key
        const creditKey = input.model === "kling-image-o1"
          ? (input.resolution === "2k" ? "klingImageO1_2K" as const : "klingImageO1_1K" as const)
          : (input.resolution === "2k" ? "klingImageV2_2K" as const : "klingImageV2_1K" as const);

        // Deduct credits (admin skips)
        if (!isAdmin) {
          const totalCredits = CREDIT_COSTS[creditKey] * input.count;
          const deduction = await deductCredits(userId, creditKey, `Kling ${input.model} ${input.resolution} x${input.count}`);
          if (!deduction.success) {
            return { success: false, error: "Credits 不足，請充值後再試" };
          }
        }

        try {
          const request = buildImageRequest({
            prompt: input.prompt,
            negativePrompt: input.negativePrompt,
            model: input.model,
            resolution: input.resolution,
            aspectRatio: input.aspectRatio,
            referenceImageUrl: input.referenceImageUrl,
            imageFidelity: input.imageFidelity,
            humanFidelity: input.humanFidelity,
            count: input.count,
          });
          const result = await createImageTask(request, input.region);

          // Record creation
          const plan = await getUserPlan(userId);
          await recordCreation({
            userId,
            type: "kling_image",
            title: input.prompt.slice(0, 100),
            metadata: { model: input.model, resolution: input.resolution, aspectRatio: input.aspectRatio, taskId: result.task_id },
            quality: `${input.model}-${input.resolution}`,
            creditsUsed: CREDIT_COSTS[creditKey] * input.count,
            plan,
            status: "pending",
          });

          return { success: true, taskId: result.task_id };
        } catch (err: any) {
          // Refund credits on failure
          if (!isAdmin) {
            try {
              await addCredits(userId, CREDIT_COSTS[creditKey] * input.count, "bonus");
            } catch (refundErr) {
              console.error("[Kling Image] Failed to refund credits:", refundErr);
            }
          }
          throw err;
        }
      }),

    getTask: protectedProcedure
      .input(z.object({
        taskId: z.string().min(1),
        region: regionSchema,
      }))
      .query(async ({ input }) => {
        ensureInitialized();
        return getImageTask(input.taskId, input.region);
      }),

    estimateCost: protectedProcedure
      .input(z.object({
        model: z.enum(["kling-image-o1", "kling-v2-1"]).default("kling-image-o1"),
        resolution: z.enum(["1k", "2k"]).default("1k"),
        count: z.number().min(1).max(4).default(1),
      }))
      .query(({ input }) => {
        return estimateImageCost(input);
      }),
  }),

  // ═══════════════════════════════════════════════════
  // File Upload Helper (upload to S3 for Kling API)
  // ═══════════════════════════════════════════════════

  uploadFile: protectedProcedure
    .input(z.object({
      fileBase64: z.string().min(1),
      fileName: z.string().min(1),
      mimeType: z.string().default("application/octet-stream"),
      folder: z.enum(["images", "videos", "audio"]).default("images"),
    }))
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const key = `kling/${input.folder}/${Date.now()}-${input.fileName}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      return { success: true, url };
    }),
});
