import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import * as db from "./db";
import * as sessionDb from "./sessionDb";
import { invokeLLM } from "./_core/llm";
import { generateImage } from "./_core/imageGeneration";
import { storagePut, storageGet } from "./storage";
import { usageRouter, incrementUsageCount } from "./routers/usage";
import { phoneRouter } from "./routers/phone";
import { studentRouter } from "./routers/student";
import { paymentRouter } from "./routers/payment";
import { emailAuthRouter } from "./routers/emailAuth";
import { betaRouter } from "./routers/beta";
import { emailOtpRouter, phoneOtpRouter } from "./routers/emailOtp";
import { stripeRouter } from "./routers/stripe";
import { teamRouter } from "./routers/team";
import { videoSubmissionRouter } from "./routers/videoSubmission";
import { nanoBananaRouter } from "./routers/nanoBanana";
import { showcaseRouter } from "./routers/showcase";
import { klingRouter } from "./routers/kling";
import { hunyuan3dRouter } from "./routers/hunyuan3d";
import { sunoRouter } from "./routers/suno";
import { creationsRouter, recordCreation } from "./routers/creations";
import { generateGeminiImage, isGeminiImageAvailable } from "./gemini-image";
import { deductCredits, getCredits, getUserPlan, addCredits, getCreditTransactions } from "./credits";
import { CREDIT_COSTS } from "./plans";
import { generateVideo, isVeoAvailable } from "./veo";
import { isGeminiAudioAvailable, analyzeAudioWithGemini } from "./gemini-audio";
import { getAdminStats, getVideoComments, addVideoComment, deleteVideoComment, toggleCommentLike, createStoryboard, updateStoryboardStatus } from "./db";
import { getOrCreateBalance } from "./credits";
import { checkUsageLimit, getOrCreateUsageTracking, getAllBetaQuotas, createBetaQuota, getAllTeams, getAllStoryboards, getPaymentSubmissions, updatePaymentSubmissionStatus, createVideoGeneration, getVideoGenerationById, getVideoGenerationsByUserId, updateVideoGeneration, getVideoLikeStatus, toggleVideoLike, getUserCommentLikes, isAdmin } from "./db-extended";
import { registerOriginalVideo } from "./video-signature";
import { nanoid } from "nanoid";

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  usage: usageRouter,
  phone: phoneRouter,
  student: studentRouter,
  payment: paymentRouter,
  emailAuth: emailAuthRouter,
  beta: betaRouter,
  emailOtp: emailOtpRouter,
  stripe: stripeRouter,
  team: teamRouter,
  videoSubmission: videoSubmissionRouter,
  nanoBanana: nanoBananaRouter,
  showcase: showcaseRouter,
  kling: klingRouter,
  hunyuan3d: hunyuan3dRouter,
  suno: sunoRouter,
  creations: creationsRouter,
  // phoneOtp: phoneOtpRouter, // 暂不上线，等短信服务开通后取消注释
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      // Delete session from database
      const authHeader = ctx.req.headers.authorization || ctx.req.headers.Authorization;
      let token: string | undefined;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        token = authHeader.slice("Bearer ".length).trim();
      }
      const cookieToken = ctx.req.cookies?.[COOKIE_NAME];
      const sessionToken = token || cookieToken;
      if (sessionToken) {
        await sessionDb.deleteSessionByToken(sessionToken);
      }

      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  mvReviews: router({
    // Submit a new review for an MV (public, no auth required)
    submit: publicProcedure
      .input(
        z.object({
          mvId: z.string().min(1).max(64),
          nickname: z.string().min(1, "请输入暱称").max(100),
          rating: z.number().int().min(1).max(5),
          comment: z.string().min(1, "请输入评论").max(2000),
        })
      )
      .mutation(async ({ input }) => {
        const id = await db.createMvReview({
          mvId: input.mvId,
          nickname: input.nickname,
          rating: input.rating,
          comment: input.comment,
        });
        return { success: true, id };
      }),

    // Get reviews for a specific MV
    list: publicProcedure
      .input(z.object({ mvId: z.string().min(1), limit: z.number().min(1).max(100).default(20) }))
      .query(async ({ input }) => {
        return db.getMvReviews(input.mvId, input.limit);
      }),

    // Get rating stats for a specific MV
    stats: publicProcedure
      .input(z.object({ mvId: z.string().min(1) }))
      .query(async ({ input }) => {
        return db.getMvRatingStats(input.mvId);
      }),
  }),

  // Video PK Rating - upload video frame and get AI analysis
  mvAnalysis: router({
    analyzeFrame: publicProcedure
      .input(z.object({
        imageBase64: z.string().min(1),
        mimeType: z.string().default("image/jpeg"),
        context: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        // Upload the frame to S3 first
        const buffer = Buffer.from(input.imageBase64, "base64");
        const { url: frameUrl } = await storagePut(
          `analysis/${Date.now()}.jpg`,
          buffer,
          input.mimeType
        );

        // Use LLM to analyze the frame
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是一位专业的视频视觉分析师。请分析这张视频画面截屏，从以下维度给出评分和建议：
1. 构图评分 (1-100)
2. 色彩运用评分 (1-100)
3. 光影效果评分 (1-100)
4. 整体视觉冲击力评分 (1-100)
5. 爆款潜力评分 (1-100)
6. 优点分析（2-3 点）
7. 改进建议（2-3 点）
8. 适合的发布平台推荐

请用 JSON 格式回复：
{
  "composition": number,
  "color": number,
  "lighting": number,
  "impact": number,
  "viralPotential": number,
  "strengths": ["string"],
  "improvements": ["string"],
  "platforms": ["string"],
  "summary": "string"
}`
            },
            {
              role: "user",
              content: [
                { type: "text", text: input.context || "请分析这张视频画面" },
                { type: "image_url", image_url: { url: frameUrl } }
              ]
            }
          ],
          response_format: { type: "json_object" }
        });

        const analysis = JSON.parse(response.choices[0].message.content as string);
        return { success: true, analysis, frameUrl };
      }),

    // Analyze a single segment frame (used by full video analysis)
    analyzeSegment: publicProcedure
      .input(z.object({
        imageBase64: z.string().min(1),
        mimeType: z.string().default("image/jpeg"),
        segmentIndex: z.number(),
        totalSegments: z.number(),
        timestampSec: z.number(),
        videoDurationSec: z.number(),
        context: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.imageBase64, "base64");
        const { url: frameUrl } = await storagePut(
          `analysis/segment_${Date.now()}_${input.segmentIndex}.jpg`,
          buffer,
          input.mimeType
        );

        const minutes = Math.floor(input.timestampSec / 60);
        const seconds = Math.floor(input.timestampSec % 60);
        const timeLabel = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是一位专业的视频视觉分析师。这是一支 MV 的第 ${input.segmentIndex + 1}/${input.totalSegments} 个片段（时间点 ${timeLabel}，视频总长 ${Math.round(input.videoDurationSec)} 秒）。

请从以下维度分析这个片段的画面：
1. 构图评分 (1-100)
2. 色彩运用评分 (1-100)
3. 光影效果评分 (1-100)
4. 视觉冲击力评分 (1-100)
5. 这个片段的主要优点（1-2 点，具体描述画面内容）
6. 这个片段的改进建议（1-2 点，具体且可操作）
7. 画面内容简述（一句话描述这个片段在做什么）

请用 JSON 格式回复：
{
  "composition": number,
  "color": number,
  "lighting": number,
  "impact": number,
  "strengths": ["string"],
  "improvements": ["string"],
  "sceneDescription": "string"
}`
            },
            {
              role: "user",
              content: [
                { type: "text", text: input.context || `请分析这个视频片段（${timeLabel}）` },
                { type: "image_url", image_url: { url: frameUrl } }
              ]
            }
          ],
          response_format: { type: "json_object" }
        });

        const segmentAnalysis = JSON.parse(response.choices[0].message.content as string);
        return {
          success: true,
          segmentIndex: input.segmentIndex,
          timestampSec: input.timestampSec,
          timeLabel,
          frameUrl,
          analysis: segmentAnalysis,
        };
      }),

    // Generate final summary report from all segment analyses
    generateReport: publicProcedure
      .input(z.object({
        segments: z.array(z.object({
          segmentIndex: z.number(),
          timestampSec: z.number(),
          timeLabel: z.string(),
          frameUrl: z.string(),
          analysis: z.object({
            composition: z.number(),
            color: z.number(),
            lighting: z.number(),
            impact: z.number(),
            strengths: z.array(z.string()),
            improvements: z.array(z.string()),
            sceneDescription: z.string(),
          }),
        })),
        videoDurationSec: z.number(),
        fileName: z.string().optional(),
        context: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const segmentSummaries = input.segments.map((seg) => {
          const avgScore = Math.round(
            (seg.analysis.composition + seg.analysis.color + seg.analysis.lighting + seg.analysis.impact) / 4
          );
          return `[${seg.timeLabel}] 场景：${seg.analysis.sceneDescription}｜平均分：${avgScore}｜优点：${seg.analysis.strengths.join("；")}｜改进：${seg.analysis.improvements.join("；")}`;
        }).join("\n");

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是一位资深视频导演和视觉分析专家。以下是一支视频各个时间片段的逐段分析结果。请基于这些数据生成一份完整的视频分析总报告。

## 要求
1. 给出整体评分（构图、色彩、光影、冲击力、爆款潜力，各 1-100）
2. 列出 3-5 个关键优点，每个优点要标明对应的时间节点和帧号
3. 列出 3-5 个改进建议，每个建议要标明对应的时间节点和帧号，说明具体需要优化的片段
4. 给出整体总结和推荐发布平台
5. 标记出全片最佳片段和最需改进片段的时间点

## 输出 JSON 格式
{
  "overallScores": {
    "composition": number,
    "color": number,
    "lighting": number,
    "impact": number,
    "viralPotential": number
  },
  "keyStrengths": [
    { "point": "string", "timeLabel": "string", "segmentIndex": number }
  ],
  "keyImprovements": [
    { "point": "string", "timeLabel": "string", "segmentIndex": number }
  ],
  "bestMoment": { "timeLabel": "string", "segmentIndex": number, "reason": "string" },
  "worstMoment": { "timeLabel": "string", "segmentIndex": number, "reason": "string" },
  "platforms": ["string"],
  "summary": "string",
  "detailedNarrative": "string"
}`
            },
            {
              role: "user",
              content: `视频名称：${input.fileName || "未命名视频"}\n视频时长：${Math.round(input.videoDurationSec)} 秒\n分析片段数：${input.segments.length}\n${input.context ? `补充说明：${input.context}\n` : ""}\n逐段分析结果：\n${segmentSummaries}`
            }
          ],
          response_format: { type: "json_object" }
        });

        const report = JSON.parse(response.choices[0].message.content as string);
        return { success: true, report };
      }),
  }),

  // Virtual Idol Generation
  virtualIdol: router({
    generate: protectedProcedure
      .input(z.object({
        style: z.enum(["anime", "realistic", "chibi", "cyberpunk", "fantasy"]),
        gender: z.enum(["female", "male", "neutral"]),
        description: z.string().max(500).optional(),
        referenceImageUrl: z.string().url().optional(),
        quality: z.enum(["free", "2k", "4k", "kling_1k", "kling_2k"]).default("free"),
      }))
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin";
        const stylePrompts: Record<string, string> = {
          anime: "anime style virtual idol singer, vibrant colors, detailed eyes, professional character design, concert stage background, high quality anime illustration",
          realistic: "ultra photorealistic portrait photo of a real person, natural skin texture with pores and fine details, real human being not CGI not 3D render not anime not cartoon, shot on Canon EOS R5 85mm f/1.4 lens, natural golden hour sunlight, shallow depth of field bokeh background, professional fashion photography, 8K resolution, RAW photo quality, real person photographed in outdoor garden setting",
          chibi: "chibi style cute virtual idol singer, kawaii, big eyes, colorful outfit, stage performance, adorable character design",
          cyberpunk: "cyberpunk virtual idol singer, neon lights, futuristic outfit, holographic effects, digital art, sci-fi aesthetic",
          fantasy: "fantasy virtual idol singer, ethereal glow, magical effects, elegant costume, enchanted stage, dreamlike atmosphere",
        };
        const genderPrompts: Record<string, string> = {
          female: "young East Asian woman, beautiful natural face, long flowing hair, wearing fashionable outfit",
          male: "young East Asian man, handsome natural face, styled hair, wearing modern outfit",
          neutral: "young East Asian person, attractive androgynous features, stylish modern look",
        };

        // Build prompt based on style
        let prompt: string;
        if (input.referenceImageUrl) {
          const refNote = "Use the provided reference image as the base appearance and facial features. Transform the person in the reference image into";
          if (input.style === "realistic") {
            prompt = `${refNote} ${stylePrompts[input.style]}, ${genderPrompts[input.gender]}${input.description ? `, ${input.description}` : ""}, maintain the facial features from the reference, NOT anime NOT cartoon NOT illustration NOT 3D render, real human photograph`;
          } else {
            prompt = `${refNote} ${stylePrompts[input.style]}, ${genderPrompts[input.gender]}${input.description ? `, ${input.description}` : ""}, maintain the facial features from the reference, high quality, detailed, professional`;
          }
        } else {
          if (input.style === "realistic") {
            prompt = `${stylePrompts[input.style]}, ${genderPrompts[input.gender]}${input.description ? `, ${input.description}` : ""}, NOT anime NOT cartoon NOT illustration NOT 3D render, real human photograph`;
          } else {
            prompt = `${stylePrompts[input.style]}, ${genderPrompts[input.gender]}${input.description ? `, ${input.description}` : ""}, high quality, detailed, professional`;
          }
        }

        // ─── FREE tier: use built-in Forge AI ───────────────
        if (input.quality === "free") {
          const originalImages = input.referenceImageUrl
            ? [{ url: input.referenceImageUrl, mimeType: "image/jpeg" }]
            : undefined;

          const { url } = await generateImage({ prompt, originalImages });
          if (!url) throw new Error("Image generation failed - no URL returned");
          
          // 免費生圖添加 MVStudioPro.com 水印（管理員跳過）
          let finalUrl = url;
          if (!isAdminUser) {
            try {
              const { addWatermarkToUrl } = await import("./watermark");
              const { storagePut } = await import("./storage");
              const watermarkedBuffer = await addWatermarkToUrl(url, "bottom-right");
              const key = `watermarked/${userId}/${Date.now()}-idol.png`;
              const uploaded = await storagePut(key, watermarkedBuffer, "image/png");
              finalUrl = uploaded.url;
            } catch (wmErr) {
              console.error("[VirtualIdol] Watermark failed, using original:", wmErr);
            }
          }
          
          await incrementUsageCount(userId, "avatar");
          // Auto-record creation
          try {
            const plan = await getUserPlan(userId);
            await recordCreation({
              userId,
              type: "idol_image",
              title: input.description?.slice(0, 100) || `${input.style} ${input.gender} 偶像`,
              outputUrl: finalUrl,
              thumbnailUrl: finalUrl,
              quality: "free",
              creditsUsed: 0,
              plan,
            });
          } catch (e) { console.error("[VirtualIdol] recordCreation failed:", e); }
          return { success: true, imageUrl: finalUrl, quality: "free" as const };
        }

        // ─── Kling tier: use Kling Image Generation API ─────
        if (input.quality === "kling_1k" || input.quality === "kling_2k") {
          const resolution = input.quality === "kling_2k" ? "2k" : "1k";
          const creditKey = input.quality === "kling_2k" ? "klingImageO1_2K" as const : "klingImageO1_1K" as const;

          if (!isAdminUser) {
            const deduction = await deductCredits(userId, creditKey);
            if (!deduction.success) {
              return { success: false, error: "Credits 不足，請充值後再試", quality: input.quality };
            }
          }

          try {
            // Ensure Kling client is initialized with API keys from env
            const { configureKlingClient, parseKeysFromEnv, getKlingClient } = await import("./kling/client");
            const klingKeys = parseKeysFromEnv();
            if (klingKeys.length > 0) {
              const defaultRegion = (process.env.KLING_DEFAULT_REGION as "global" | "cn") ?? "cn";
              configureKlingClient(klingKeys, defaultRegion);
            } else {
              return { success: false, error: "Kling API 未配置，請聯繫管理員設置 KLING_ACCESS_KEY 和 KLING_SECRET_KEY", quality: input.quality };
            }
            const { createImageTask, getImageTask, buildImageRequest } = await import("./kling/image-generation");
            const request = buildImageRequest({
              prompt,
              model: "kling-image-o1",
              resolution: resolution as "1k" | "2k",
              aspectRatio: "1:1",
              referenceImageUrl: input.referenceImageUrl,
              imageFidelity: input.referenceImageUrl ? 0.5 : undefined,
              count: 1,
            });
            const taskResult = await createImageTask(request, "cn");

            if (!taskResult.task_id) {
              if (!isAdminUser) {
                try { await addCredits(userId, CREDIT_COSTS[creditKey], "bonus"); } catch (e) { console.error("Refund failed:", e); }
              }
              return { success: false, error: taskResult.task_status_msg || "Kling 圖片生成失敗", quality: input.quality };
            }

            // Poll for result (max 120 seconds)
            const taskId = taskResult.task_id;
            const startTime = Date.now();
            const maxWait = 120000;
            let imageResult: any = null;
            while (Date.now() - startTime < maxWait) {
              await new Promise(resolve => setTimeout(resolve, 5000));
              imageResult = await getImageTask(taskId, "cn");
              if (imageResult.task_status === "succeed" || imageResult.task_status === "failed") break;
            }
            if (imageResult?.task_status === "succeed" && imageResult?.task_result?.images?.[0]?.url) {
              await incrementUsageCount(userId, "avatar");
              // Auto-record Kling creation
              try {
                const plan = await getUserPlan(userId);
                await recordCreation({
                  userId,
                  type: "idol_image",
                  title: input.description?.slice(0, 100) || `Kling ${resolution} 偶像`,
                  outputUrl: imageResult.task_result.images[0].url,
                  thumbnailUrl: imageResult.task_result.images[0].url,
                  quality: `kling-o1-${resolution}`,
                  creditsUsed: CREDIT_COSTS[creditKey],
                  plan,
                });
              } catch (e) { console.error("[VirtualIdol] recordCreation failed:", e); }
              return { success: true, imageUrl: imageResult.task_result.images[0].url, quality: input.quality };
            } else {
              if (!isAdminUser) {
                try { await addCredits(userId, CREDIT_COSTS[creditKey], "bonus"); } catch (e) { console.error("Refund failed:", e); }
              }
              return { success: false, error: imageResult?.task_status_msg || "Kling 圖片生成超時", quality: input.quality };
            }
          } catch (err: any) {
            if (!isAdminUser) {
              try { await addCredits(userId, CREDIT_COSTS[creditKey], "bonus"); } catch (e) { console.error("[VirtualIdol] Refund failed:", e); }
            }
            console.error("[VirtualIdol] Kling image generation failed:", err);
            return { success: false, error: `Kling 圖片生成失敗: ${err.message || '請稍後再試'}`, quality: input.quality };
          }
        }

        // ─── 2K / 4K tier: use Gemini API (Nano Banana Pro) ─────
        const creditKey = input.quality === "4k" ? "nbpImage4K" as const : "nbpImage2K" as const;

        // Admin skips credits deduction
        if (!isAdminUser) {
          const deduction = await deductCredits(userId, creditKey);
          if (!deduction.success) {
            return { success: false, error: "Credits 不足，请充值后再试", quality: input.quality };
          }
        }

        // Check if Gemini is available
        if (!isGeminiImageAvailable()) {
          // Refund credits if Gemini not available (admin doesn't need refund)
          console.warn("[VirtualIdol] Gemini API not configured, falling back to Forge");
          const originalImages = input.referenceImageUrl
            ? [{ url: input.referenceImageUrl, mimeType: "image/jpeg" }]
            : undefined;
          const { url } = await generateImage({ prompt, originalImages });
          if (!url) throw new Error("Image generation failed - no URL returned");
          await incrementUsageCount(userId, "avatar");
          return { success: true, imageUrl: url, quality: "free" as const, fallback: true };
        }

        try {
          const qualityHint = input.quality === "4k" ? "ultra high resolution 4K 4096x4096, extremely detailed" : "high resolution 2K 2048x2048, detailed";
          const result = await generateGeminiImage({
            prompt: `${qualityHint}, ${prompt}`,
            quality: input.quality as "2k" | "4k",
            referenceImageUrl: input.referenceImageUrl,
          });
          await incrementUsageCount(userId, "avatar");
          // Auto-record Gemini creation
          try {
            const plan = await getUserPlan(userId);
            await recordCreation({
              userId,
              type: "idol_image",
              title: input.description?.slice(0, 100) || `NBP ${input.quality} 偶像`,
              outputUrl: result.imageUrl,
              thumbnailUrl: result.imageUrl,
              quality: `nbp-${input.quality}`,
              creditsUsed: CREDIT_COSTS[creditKey],
              plan,
            });
          } catch (e) { console.error("[VirtualIdol] recordCreation failed:", e); }
          return { success: true, imageUrl: result.imageUrl, quality: input.quality };
        } catch (err: any) {
          // Refund credits on failure (admin doesn't need refund)
          if (!isAdminUser) {
            try {
              const { addCredits } = await import("./credits");
              await addCredits(userId, CREDIT_COSTS[creditKey], "bonus");
            } catch (refundErr) {
              console.error("[VirtualIdol] Failed to refund credits:", refundErr);
            }
          }
          console.error("[VirtualIdol] Gemini image generation failed:", err);
          return { success: false, error: `图片生成失败: ${err.message || '请稍后再试'}`, quality: input.quality };
        }
      }),

    // ─── 偶像图片转 3D（仅限 Pro 以上方案） ────────────
    convertTo3D: protectedProcedure
      .input(z.object({
        imageUrl: z.string().url(),
        enablePbr: z.boolean().default(true),
      }))
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const userRole = ctx.user.role;

        // 管理员直接放行
        if (userRole !== "admin") {
          // 检查是否为 Pro 以上方案
          const { getUserPlan } = await import("./credits");
          const plan = await getUserPlan(userId);
          if (plan === "free") {
            throw new Error("偶像转 3D 功能仅限专业版以上用户使用，请升级您的方案");
          }

          // 扣除 Credits
          const { deductCredits } = await import("./credits");
          await deductCredits(userId, "idol3D", "偶像图片转 3D (Hunyuan3D)");
        }

        // 检查 fal.ai 是否已配置
        const { isFalConfigured, imageToThreeD } = await import("./fal-3d");
        if (!isFalConfigured()) {
          // 回退到 LLM 图片生成仿真
          const prompt = `Convert this 2D character image into a high-quality 3D render. Pixar 3D animation style, smooth subsurface scattering skin, big expressive eyes, stylized proportions, Disney quality rendering, volumetric lighting, 3D character render, three-quarter view portrait, dynamic angle, maintain the original character's identity and outfit details, professional 3D modeling quality, octane render, depth of field`;
          const { url } = await generateImage({
            prompt,
            originalImages: [{ url: input.imageUrl, mimeType: "image/jpeg" }],
          });
          if (!url) throw new Error("3D 转换失败，请稍后再试");
          return {
            success: true,
            mode: "fallback" as const,
            imageUrl3D: url,
            glbUrl: null,
            objUrl: null,
            textureUrl: null,
            thumbnailUrl: null,
            availableFormats: ["image"],
            timeTaken: 0,
          };
        }

        // 使用 fal.ai Hunyuan3D v3.1 Rapid 生成真实 3D 模型
        const result = await imageToThreeD({
          imageUrl: input.imageUrl,
          enablePbr: input.enablePbr,
        });

        // Auto-record 3D creation
        try {
          const plan = await getUserPlan(userId);
          await recordCreation({
            userId,
            type: "idol_3d",
            title: "3D 模型轉換",
            outputUrl: result.glbUrl,
            secondaryUrl: result.objUrl ?? undefined,
            thumbnailUrl: result.thumbnailUrl || result.glbUrl,
            metadata: { mode: "real3d", enablePbr: input.enablePbr },
            quality: input.enablePbr ? "PBR" : "Basic",
            creditsUsed: CREDIT_COSTS.idol3D,
            plan,
          });
        } catch (e) { console.error("[VirtualIdol] 3D recordCreation failed:", e); }

        return {
          success: true,
          mode: "real3d" as const,
          imageUrl3D: result.thumbnailUrl || result.glbUrl,
          glbUrl: result.glbUrl,
          objUrl: result.objUrl,
          textureUrl: result.textureUrl,
          thumbnailUrl: result.thumbnailUrl,
          availableFormats: result.availableFormats,
          timeTaken: result.timeTaken,
        };
      }),

    // ─── 检查 fal.ai 3D 服务状态 ─────────────────────
    check3DService: protectedProcedure
      .query(async () => {
        const { isFalConfigured } = await import("./fal-3d");
        return {
          configured: isFalConfigured(),
          provider: isFalConfigured() ? "fal.ai Hunyuan3D v3.1 Rapid" : "LLM Fallback (2D Simulation)",
          costPerGeneration: isFalConfigured() ? 0.225 : 0,
          creditsRequired: 10,
        };
      }),
  }),

  // Video Storyboard Script Generator
  storyboard: router({
    generate: protectedProcedure
      .input(z.object({
        lyrics: z.string().min(1),
        sceneCount: z.number().min(1).max(20).default(5),
        model: z.enum(["flash", "gpt5", "pro"]).default("flash"),
        visualStyle: z.enum(["cinematic", "anime", "documentary", "realistic", "scifi"]).default("cinematic"),
        referenceImageUrl: z.string().url().optional(),
        referenceStyleDescription: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin";

        // 付費模型需要額外 Credits，管理員免費，flash 免費
        if (input.model !== "flash" && !isAdminUser) {
          const { deductCredits, hasEnoughCredits } = await import("./credits");
          const creditKey = input.model === "gpt5" ? "storyboardGpt5" : "storyboard";
          const canAfford = await hasEnoughCredits(userId, creditKey);
          if (!canAfford) {
            const modelLabel = input.model === "gpt5" ? "GPT 5.1" : "Gemini 3.0 Pro";
            throw new Error(`Credits 不足，無法使用 ${modelLabel} 模型。請充值 Credits 或切換為 Gemini 3.0 Flash（0 Credits）。`);
          }
          await deductCredits(userId, creditKey, `分鏡腳本生成 (${input.model === "gpt5" ? "GPT 5.1" : "Gemini 3.0 Pro"})`);
        }

        // Use LLM to analyze lyrics and generate storyboard
        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是一位专业的视频导演和电影摄影师，拥有丰富的视觉叙事经验。请根据歌词或文本内容，生成一个完整且专业的 视频分镜脚本。

## 视觉风格
本次分镜脚本的视觉风格为：**${{
  cinematic: "电影感（Cinematic）— 使用电影级别的光影、色彩分级、宽银幕构图。追求胶片质感、浅景深、戏剧性光线。参考风格：王家卫、扎克·施奈德、罗杰·迪金斯。",
  anime: "动漫风（Anime）— 使用日系动漫的视觉语言。鲜艳色彩、夸张表情、速度线、光效粒子、樱花飘落等经典元素。参考风格：新海诚、宫崎骏、MAPPA。",
  documentary: "纪录片（Documentary）— 使用纪录片的真实感和沉浸感。自然光线、手持镜头、长镜头、采访式构图。追求真实、客观、有深度的视觉叙事。",
  realistic: "写实片（Realistic）— 使用写实主义的视觉风格。自然色调、真实场景、生活化的光线和构图。追求贴近现实的质感，避免过度修饰。",
  scifi: "科幻片（Sci-Fi）— 使用科幻电影的视觉语言。霓虹灯光、全息投影、赛博朋克色调、未来感建筑和科技元素。参考风格：银翼杀手、攻壳机动队、星际穿越。"
}[input.visualStyle]}**

请确保所有场景的视觉元素、色彩分级、光影设计和特效都严格遵循此风格。

## 音乐分析维度
请从以下维度分析歌曲特性：
1. **BPM（节奏速度）**：根据歌词情绪和节奏推测，范围 60-180
2. **情感基调**：如欢快、忧郁、激昂、温柔、怀旧、希望、悲伤、狂野等
3. **音乐风格**：如流行、摇滚、电子、民谣、R&B、嘻哈、爵士、古典等
4. **调性**：如 C大调、A小调、G大调等（根据情感推测）

## 分镜场景要求
每个场景必须包含以下专业元素：

### 1. 场景描述（description）
- 详细描述视觉画面，与歌词内容紧密结合
- 包含场景地点、时间、人物动作、环境氛围
- 使用电影化的描述语言，具体且富有画面感
- 例如：「黄昏时分的海边，主角背对镜头站在礁石上，海风吹动长发，远处夕阳将天空染成橙红色」

### 2. 镜头运动（cameraMovement）
使用专业的镜头语言，从以下类型中选择并详细说明：

**基础运动镜头**：
- **推镜（Push In / Dolly In）**：镜头向前推进，强调主体或情绪升级
- **拉镜（Pull Out / Dolly Out）**：镜头向后拉远，展现环境或情绪释放
- **摇镜（Pan）**：水平旋转，展现空间或跟随动作（左摇 / 右摇）
- **倾斜（Tilt）**：垂直旋转，展现高度或视角变化（上倾 / 下倾）
- **跟镜（Follow / Tracking）**：跟随主体移动，营造动态感
- **环绕（Orbit / Arc）**：围绕主体旋转，展现立体空间

**高端运动镜头**：
- **推轨（Dolly Track）**：使用轨道推拉，流畅且稳定
- **摇臂（Jib / Crane）**：大幅度升降运动，展现宏大场景
- **斯坦尼康（Steadicam）**：手持稳定器跟拍，自然且灵活
- **航拍（Drone / Aerial）**：俯瞰或大范围移动，展现空间感
- **变焦（Zoom In / Out）**：镜头焦距变化，营造视觉冲击
- **手持（Handheld）**：手持晃动，营造真实感或紧张感

**特殊镜头**：
- **固定镜头（Static / Locked）**：静止不动，强调稳定或凝视
- **升格（Slow Motion）**：慢动作，强调细节或情感
- **降格（Fast Motion / Time-lapse）**：快动作或延时，展现时间流逝
- **第一人称视角（POV）**：主观视角，增强代入感
- **旋转镜头（Rotation / Roll）**：画面旋转，营造失重或迷幻感

**组合运动**：
- 例如：「推轨 + 摇臂上升」、「航拍环绕 + 降格」、「斯坦尼康跟拍 + 升格」

### 3. 情绪氛围（mood）
- 描述场景的情感色彩和氛围感受
- 例如：浪漫、紧张、梦幻、孤独、希望、忧伤、狂野、宁静、压抑、释放等
- 可以组合多个情绪，例如：「忧伤中带着希望」、「狂野且自由」

### 4. 视觉效果（visualElements）
必须包含以下专业视觉设计元素（每个场景至少 3-5 个）：

**光影设计**：
- 自然光：金色时光（Golden Hour）、蓝调时光（Blue Hour）、正午强光、阴天柔光
- 人工光：逆光、侧光、顶光、底光、轮廓光、Rembrandt 光
- 特殊光效：光束、光晕（Lens Flare）、体积光（Volumetric Light）、霓虹灯

**色彩分级（Color Grading）**：
- 暖色调：橙黄、金色、琥珀色
- 冷色调：蓝色、青色、银灰色
- 对比色：橙蓝对比、红绿对比、黄紫对比
- 风格化：复古胶片感、赛博朋克、黑白高反差、褪色复古、电影感

**特效与后期**：
- 粒子效果：灰尘、雨滴、雪花、火花、光点
- 动态模糊：运动模糊、径向模糊
- 景深效果：浅景深（背景虚化）、深景深（全景清晰）
- 画面质感：颗粒感、胶片划痕、漏光效果
- 特殊效果：重曝（Double Exposure）、分屏、镜像、故障艺术（Glitch）

**构图元素**：
- 前景元素：树叶、窗框、人物剪影
- 几何线条：引导线、对称构图、三分法
- 环境元素：烟雾、雾气、水面倒影、玻璃反射

### 5. 场景转场建议（transition）
在 JSON 中添加 "transition" 字段，描述如何过渡到下一个场景：
- 淡入淡出（Fade In / Out）
- 交叉溶解（Cross Dissolve）
- 硬切（Hard Cut）
- 匹配剪辑（Match Cut）：动作匹配或形状匹配
- 擦除转场（Wipe）
- 推拉转场（Push / Pull）
- 旋转转场（Spin）
- 故障转场（Glitch Transition）

## JSON 输出格式
请严格按照以下格式输出：

\`\`\`json
{
  "title": "视频标题（根据歌词主题命名）",
  "musicInfo": {
    "bpm": 120,
    "emotion": "情感基调",
    "style": "音乐风格",
    "key": "调性"
  },
  "scenes": [
    {
      "sceneNumber": 1,
      "timestamp": "00:00-00:15",
      "duration": "15秒",
      "description": "详细的场景描述，包含地点、人物、动作、环境",
      "cameraMovement": "具体的镜头运动类型和说明，例如：推轨 + 摇臂上升，从地面推进至主角特写，展现情绪升级",
      "mood": "情绪氛围描述",
      "visualElements": [
        "光影设计：金色时光逆光",
        "色彩分级：暖色调橙黄色",
        "特效：镜头光晕",
        "粒子效果：漂浮的灰尘",
        "构图：浅景深背景虚化"
      ],
      "transition": "转场方式：交叉溶解过渡到下一场景"
    }
  ],
  "summary": "整体建议和创意方向，包含视觉风格统一性、叙事节奏、情感曲线、技术实现建议等"
}
\`\`\`

## 人物一致性要求（极其重要）
- 在 JSON 输出中增加一个顶层字段 "characterDescription"，详细描述主角的外观特征：性别、年龄、发型发色、五官特征、体型、服装风格、标志性配饰等
- 每个场景的 description 中必须重复描述主角的外观，确保 AI 生图时人物外观一致
- 主角的服装、发型、体型在所有场景中保持一致（除非剧情需要换装）
- 如果歌词中没有明确的人物描述，请根据歌词情感和风格创造一个合适的主角形象
${input.referenceImageUrl ? `
## 参考图风格
用户上传了参考图片，请在生成分镜时参考该图片的视觉风格、色彩、构图和氛围。
${input.referenceStyleDescription ? `参考图风格分析：${input.referenceStyleDescription}` : ''}
` : ''}
## 创意要求
1. **视觉叙事**：每个场景要与歌词内容和情感紧密结合，形成完整的视觉故事线
2. **节奏把控**：镜头运动和转场要与音乐节奏（BPM）相匹配
3. **情感曲线**：场景情绪要有起伏变化，符合歌曲的情感发展
4. **视觉统一**：整体色彩和风格要保持一致性，形成独特的视觉语言
5. **技术可行性**：建议的镜头和效果要考虑实际拍摄的可行性
6. **创意亮点**：每个视频要有 1-2 个视觉记忆点，让观众印象深刻
7. **人物一致性**：主角在所有场景中必须保持外观一致，包括发型、服装、体型、配饰等

请确保生成的分镜脚本专业、详细、具有电影感，能够直接用于视频拍摄指导。`
            },
            {
              role: "user",
              content: input.referenceImageUrl
                ? [
                    { type: "text" as const, text: `请根据以下歌词或文本内容，生成 ${input.sceneCount} 个视频分镜场景。同时参考附图的视觉风格、色彩和氛围：\n\n${input.lyrics}` },
                    { type: "image_url" as const, image_url: { url: input.referenceImageUrl, detail: "high" as const } },
                  ]
                : `请根据以下歌词或文本内容，生成 ${input.sceneCount} 个 视频分镜场景：\n\n${input.lyrics}`
            }
          ],
          response_format: { type: "json_object" },
          model: input.model === "gpt5" ? ("gpt5" as any) : input.model === "pro" ? ("pro" as any) : undefined,
        });

        const storyboardData = JSON.parse(response.choices[0].message.content as string);
        
        // Generate preview images for all scenes in parallel
        const sceneImagePromises = storyboardData.scenes.map(async (scene: any) => {
          // Create a detailed prompt for image generation based on scene description
          // 人物一致性優化：提取主角外觀描述並在每個場景中重複使用
          const characterLock = storyboardData.characterDescription || "";
          const refStyleNote = input.referenceStyleDescription ? ` Reference style: ${input.referenceStyleDescription}.` : "";
          const stylePromptMap: Record<string, string> = {
            cinematic: "Cinematic film style, anamorphic lens, shallow depth of field, teal-orange color grading, dramatic volumetric lighting, 2.39:1 composition.",
            anime: "Japanese anime cel-shaded style, vibrant saturated colors, bold outlines, speed lines, sparkle effects, Studio Ghibli aesthetic.",
            documentary: "Documentary photography style, natural lighting, handheld camera feel, film grain, muted earth tones, photojournalistic composition.",
            realistic: "Hyper-realistic photography, natural colors, DSLR quality, accurate skin textures, soft natural daylight, lifestyle aesthetic.",
            scifi: "Sci-fi concept art style, neon lighting, holographic displays, cyberpunk color palette with teals and magentas, futuristic architecture.",
          };
          const styleNote = stylePromptMap[input.visualStyle] || stylePromptMap.cinematic;
          const imagePrompt = `${styleNote} ${scene.description}. ${scene.visualElements.join(", ")}. ${scene.mood} mood.${characterLock ? ` IMPORTANT - Main character consistency: ${characterLock}. The main character MUST look exactly the same across all scenes.` : ""}${refStyleNote} High quality, detailed, 16:9 aspect ratio.`;
          
          try {
            const { url } = await generateImage({ prompt: imagePrompt });
            // 免費生圖添加水印（管理員跳過）
            let finalUrl = url;
            if (!isAdminUser && url) {
              try {
                const { addWatermarkToUrl } = await import("./watermark");
                const { storagePut } = await import("./storage");
                const wmBuf = await addWatermarkToUrl(url, "bottom-right");
                const wmKey = `watermarked/${userId}/${Date.now()}-scene-${scene.sceneNumber}.png`;
                const wmUp = await storagePut(wmKey, wmBuf, "image/png");
                finalUrl = wmUp.url;
              } catch { /* fallback to original */ }
            }
            return { ...scene, previewImageUrl: finalUrl };
          } catch (error) {
            console.error(`Failed to generate preview image for scene ${scene.sceneNumber}:`, error);
            return { ...scene, previewImageUrl: null };
          }
        });
        
        // Wait for all images to be generated
        const scenesWithImages = await Promise.all(sceneImagePromises);
        storyboardData.scenes = scenesWithImages;
        
        // Increment usage count after successful generation
        await incrementUsageCount(userId, "storyboard");
        
        // Return storyboard data with preview images
        return { 
          success: true, 
          storyboard: storyboardData,
          message: "分镜脚本已生成！"
        };
      }),

    // Export storyboard to PDF
    exportPDF: protectedProcedure
      .input(z.object({
        storyboard: z.object({
          title: z.string(),
          musicInfo: z.object({
            bpm: z.number(),
            emotion: z.string(),
            style: z.string(),
            key: z.string(),
          }),
          scenes: z.array(z.object({
            sceneNumber: z.number(),
            timestamp: z.string(),
            duration: z.string(),
            description: z.string(),
            cameraMovement: z.string(),
            mood: z.string(),
            visualElements: z.array(z.string()),
            transition: z.string().optional(),
            previewImageUrl: z.string().nullable().optional(),
          })),
          summary: z.string(),
        }),
        format: z.enum(["pdf", "word"]).default("pdf"),
      }))
      .mutation(async ({ input }) => {
        const { exportToPDF, exportToWord } = await import("./storyboard-export");

        if (input.format === "word") {
          const result = await exportToWord(input.storyboard);
          return { success: true, pdfUrl: result.url, message: result.message };
        }

        const result = await exportToPDF(input.storyboard);
        return { success: true, pdfUrl: result.url, message: result.message };
      }),

    // Get pending storyboards for admin review
    getPendingReviews: protectedProcedure
      .query(async ({ ctx }) => {
        // Only admin can access pending reviews
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can access pending reviews");
        }
        return db.getPendingStoryboards(50);
      }),

    // Approve a storyboard
    approveStoryboard: protectedProcedure
      .input(z.object({ storyboardId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        // Only admin can approve storyboards
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can approve storyboards");
        }
        await db.updateStoryboardStatus(input.storyboardId, "approved", ctx.user.id);
        return { success: true };
      }),

    // Reject a storyboard
    rejectStoryboard: protectedProcedure
      .input(z.object({
        storyboardId: z.number(),
        rejectionReason: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        // Only admin can reject storyboards
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can reject storyboards");
        }
        await db.updateStoryboardStatus(
          input.storyboardId,
          "rejected",
          ctx.user.id,
          input.rejectionReason
        );
        return { success: true };
      }),

    // Get user's storyboards (for checking review status)
    getUserStoryboards: protectedProcedure
      .query(async ({ ctx }) => {
        return db.getUserStoryboards(ctx.user.id, 20);
      }),

    // Batch approve storyboards
    batchApproveStoryboards: protectedProcedure
      .input(z.object({ storyboardIds: z.array(z.number()).min(1) }))
      .mutation(async ({ input, ctx }) => {
        // Only admin can approve storyboards
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can approve storyboards");
        }
        // Approve each storyboard
        for (const storyboardId of input.storyboardIds) {
          await db.updateStoryboardStatus(storyboardId, "approved", ctx.user.id);
        }
        return { success: true, count: input.storyboardIds.length };
      }),

    // Batch reject storyboards
    batchRejectStoryboards: protectedProcedure
      .input(z.object({
        storyboardIds: z.array(z.number()).min(1),
        rejectionReason: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        // Only admin can reject storyboards
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can reject storyboards");
        }
        // Reject each storyboard with the same reason
        for (const storyboardId of input.storyboardIds) {
          await db.updateStoryboardStatus(
            storyboardId,
            "rejected",
            ctx.user.id,
            input.rejectionReason
          );
        }
        return { success: true, count: input.storyboardIds.length };
      }),
    // AI 改寫分鏡腳本 - 用戶提供 3 句話修改意見，AI 重新生成
    rewrite: protectedProcedure
      .input(z.object({
        originalStoryboard: z.object({
          title: z.string(),
          musicInfo: z.object({
            bpm: z.number(),
            emotion: z.string(),
            style: z.string(),
            key: z.string(),
          }),
          scenes: z.array(z.object({
            sceneNumber: z.number(),
            timestamp: z.string(),
            duration: z.string(),
            description: z.string(),
            cameraMovement: z.string(),
            mood: z.string(),
            visualElements: z.array(z.string()),
            transition: z.string().optional(),
            previewImageUrl: z.string().nullable().optional(),
          })),
          summary: z.string(),
        }),
        userFeedback: z.string().min(1).max(500),
        visualStyle: z.enum(["cinematic", "anime", "documentary", "realistic", "scifi"]).default("cinematic"),
        model: z.enum(["flash", "gpt5", "pro"]).default("flash"),
      }))
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin";

        // 扣除 Credits（管理員免扣）
        if (!isAdminUser) {
          const creditsInfo = await getCredits(userId);
          if (creditsInfo.totalAvailable < CREDIT_COSTS.storyboardRewrite) {
            throw new Error(`Credits 不足，AI 改寫需要 ${CREDIT_COSTS.storyboardRewrite} Credits`);
          }
          await deductCredits(userId, "storyboardRewrite", "AI 改寫分鏡腳本");
        }

        const styleLabels: Record<string, string> = {
          cinematic: "電影感",
          anime: "動漫風",
          documentary: "紀錄片",
          realistic: "寫實片",
          scifi: "科幻片",
        };

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是一位專業的視頻導演。用戶對之前生成的分鏡腳本不滿意，提供了修改意見。請根據用戶的反饋，重新改寫整個分鏡腳本。

要求：
1. 保持原有的場景數量（${input.originalStoryboard.scenes.length} 個場景）
2. 視覺風格：${styleLabels[input.visualStyle] || "電影感"}
3. 根據用戶反饋大幅調整場景描述、鏡頭運動、情緒氛圍和視覺效果
4. 保持 JSON 格式輸出，與原始格式完全一致
5. 確保改寫後的腳本質量更高、更符合用戶期望

輸出格式與原始腳本相同的 JSON 結構。`
            },
            {
              role: "user",
              content: `原始分鏡腳本：\n${JSON.stringify(input.originalStoryboard, null, 2)}\n\n用戶修改意見：\n${input.userFeedback}\n\n請根據以上修改意見，重新改寫整個分鏡腳本。`
            }
          ],
          response_format: { type: "json_object" },
          model: input.model === "gpt5" ? ("gpt5" as any) : input.model === "pro" ? ("pro" as any) : undefined,
        });

        const rewrittenData = JSON.parse(response.choices[0].message.content as string);

        return {
          success: true,
          storyboard: rewrittenData,
          message: "分鏡腳本已根據您的意見重新改寫！",
        };
      }),

    // AI Inspiration Generator - generate script from 3 sentences (Gemini, consumes Credits)
    generateInspiration: protectedProcedure
      .input(z.object({
        briefDescription: z.string().min(1).max(200),
      }))
      .mutation(async ({ input, ctx }) => {
        // 检查并扣除 Credits（管理员免扣）
        const { deductCredits, hasEnoughCredits } = await import("./credits");
        const userId = ctx.user.id;

        const canAfford = await hasEnoughCredits(userId, "aiInspiration");
        if (!canAfford) {
          throw new Error("Credits 不足，无法使用 AI 灵感助手。请充值 Credits 后重试。");
        }

        await deductCredits(userId, "aiInspiration", "AI 灵感助手生成脚本 (Gemini)");

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是一位专业的视频创作助手，擅长将简短的灵感描述扩展成完整的视频脚本文本。

用户会给你一段简短的描述（通常 1-3 句话），你需要将它扩展成一个完整的视频脚本，包含：

1. **故事线**：明确的开头、发展、高潮、结尾
2. **场景描述**：具体的场景、时间、氛围
3. **情感表达**：情绪的起伏变化
4. **视觉元素**：色调、光影、特效建议

输出要求：
- 用中文书写
- 字数控制在 300-500 字
- 分段落书写，每段落代表一个场景
- 语言要有画面感，像电影剧本一样
- 不要加标题或分镜号，直接输出文本内容
- 可以适当加入对话、旁白、音乐描述`
            },
            {
              role: "user",
              content: `请根据以下灵感描述，扩展成一个完整的视频脚本文本：\n\n${input.briefDescription}`
            }
          ],
        });

        const generatedText = response.choices[0].message.content as string;

        return {
          success: true,
          text: generatedText.trim(),
          message: "灵感脚本已生成！",
        };
      }),

    // AI 推荐 BGM 描述 - 使用 Gemini 3.0 Pro 分析分鏡內容生成 BGM 描述
    recommendBGM: protectedProcedure
      .input(z.object({
        storyboard: z.object({
          title: z.string(),
          musicInfo: z.object({
            bpm: z.number(),
            emotion: z.string(),
            style: z.string(),
            key: z.string(),
          }),
          scenes: z.array(z.object({
            sceneNumber: z.number(),
            description: z.string(),
            mood: z.string(),
            visualElements: z.array(z.string()),
          })),
          summary: z.string(),
        }),
        model: z.enum(["pro", "gpt5"]).default("pro"),
      }))
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin";

        if (!isAdminUser) {
          const creditsInfo = await getCredits(userId);
          if (creditsInfo.totalAvailable < CREDIT_COSTS.recommendBGM) {
            throw new Error(`Credits 不足，AI 推薦 BGM 需要 ${CREDIT_COSTS.recommendBGM} Credits`);
          }
          await deductCredits(userId, "recommendBGM", `AI 推薦 BGM 描述 (${input.model === "gpt5" ? "GPT 5.1" : "Gemini 3.0 Pro"})`);
        }

        const sceneSummary = input.storyboard.scenes.map(s =>
          `场景${s.sceneNumber}: ${s.description} (情绪: ${s.mood})`
        ).join("\n");

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是一位专业的影视配乐师和音乐总监。请根据分镜脚本的内容、情绪和音乐信息，生成一段详细的 BGM 描述，用于 Suno AI 音乐生成。

输出要求（严格 JSON 格式）：
{
  "title": "BGM 标题（英文，简洁有力）",
  "description": "用英文描述 BGM 的风格、情绪、节奏、乐器组合，适合 Suno AI 的 prompt 格式，200字以内",
  "style": "音乐风格标签（如 cinematic orchestral, electronic ambient, lo-fi hip hop 等）",
  "mood": "情绪标签（如 melancholic, uplifting, intense, dreamy 等）",
  "bpm": 推荐 BPM 数值,
  "instruments": ["主要乐器列表"],
  "duration": "推荐时长（如 2:30）"
}`
            },
            {
              role: "user",
              content: `请根据以下分镜脚本信息，生成适合的 BGM 描述：

标题：${input.storyboard.title}
音乐信息：BPM ${input.storyboard.musicInfo.bpm}, 情感 ${input.storyboard.musicInfo.emotion}, 风格 ${input.storyboard.musicInfo.style}, 调性 ${input.storyboard.musicInfo.key}

场景概要：
${sceneSummary}

整体建议：${input.storyboard.summary}`
            }
          ],
          response_format: { type: "json_object" },
          model: input.model === "gpt5" ? ("gpt5" as any) : ("pro" as any),
        });

        const bgmData = JSON.parse(response.choices[0].message.content as string);

        return {
          success: true,
          bgm: bgmData,
          message: "BGM 描述已生成！可直接用于 Suno 生成音乐。",
        };
      }),

    // 參考圖風格分析 - 使用 Gemini Vision 分析上傳的參考圖片
    analyzeReferenceImage: protectedProcedure
      .input(z.object({
        imageUrl: z.string().url(),
      }))
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin";

        if (!isAdminUser) {
          const creditsInfo = await getCredits(userId);
          if (creditsInfo.totalAvailable < CREDIT_COSTS.referenceImageAnalysis) {
            throw new Error(`Credits 不足，參考圖分析需要 ${CREDIT_COSTS.referenceImageAnalysis} Credits`);
          }
          await deductCredits(userId, "referenceImageAnalysis", "參考圖風格分析 (Gemini Vision)");
        }

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是一位专业的视觉设计师和电影摄影师。请分析这张参考图片的视觉风格，输出一段英文描述，用于指导 AI 生成类似风格的分镜图片。

分析维度：
1. 色彩调性（color palette, grading）
2. 光影风格（lighting style）
3. 构图特点（composition）
4. 氛围感受（mood, atmosphere）
5. 艺术风格（art style, medium）
6. 特效元素（special effects, textures）

输出格式：一段 100-200 字的英文描述，可直接用于 AI 生图 prompt。不要加任何 JSON 或标记，直接输出纯文本。`
            },
            {
              role: "user",
              content: [
                { type: "text" as const, text: "请分析这张参考图片的视觉风格：" },
                { type: "image_url" as const, image_url: { url: input.imageUrl, detail: "high" as const } },
              ]
            }
          ],
        });

        const styleDescription = response.choices[0].message.content as string;

        return {
          success: true,
          styleDescription: styleDescription.trim(),
          message: "參考圖風格分析完成！",
        };
      }),
  }),

  paymentSubmission: router({
    // Upload payment screenshot to S3
    uploadScreenshot: protectedProcedure
      .input(
        z.object({
          imageBase64: z.string().min(1),
          mimeType: z.string().default("image/jpeg"),
        })
      )
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.imageBase64, "base64");
        const { url } = await storagePut(
          `payment-screenshots/${Date.now()}.jpg`,
          buffer,
          input.mimeType
        );
        return { url };
      }),

    // Submit payment screenshot for review
    submit: protectedProcedure
      .input(
        z.object({
          packageType: z.string().min(1),
          amount: z.string().min(1),
          paymentMethod: z.string().optional(),
          screenshotUrl: z.string().url(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        await db.createPaymentSubmission({
          userId,
          packageType: input.packageType,
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          screenshotUrl: input.screenshotUrl,
        });
        return { 
          success: true,
          message: "付款截屏已提交，正在等待人工审核..."
        };
      }),

    // Get user's payment submissions
    getUserPayments: protectedProcedure
      .query(async ({ ctx }) => {
        return db.getUserPayments(ctx.user.id, 50);
      }),

    // Get pending payments for admin review
    getPendingPayments: protectedProcedure
      .query(async ({ ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can access pending payments");
        }
        return db.getPendingPayments(50);
      }),

    // Approve a payment
    approvePayment: protectedProcedure
      .input(z.object({ paymentId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can approve payments");
        }
        
        // Get payment details to determine package type and user
        const payment = await db.getPaymentById(input.paymentId);
        
        if (!payment) {
          throw new Error("Payment not found");
        }
        
        // Update payment status
        await db.updatePaymentStatus(input.paymentId, "approved", ctx.user.id);
        
        // Grant usage credits based on package type
        const packageCredits = {
          basic: 4,      // 基础版：4次
          pro: 2,        // 专业版：2次
          enterprise: 30 // 企业版：30次（仿真月付无限次）
        };
        
        const credits = packageCredits[payment.packageType as keyof typeof packageCredits] || 0;
        
        if (credits > 0) {
          // Add credits to all three features
          const { decreaseUsageCount } = await import("../server/db-extended");
          await decreaseUsageCount(payment.userId, "storyboard", credits);
          await decreaseUsageCount(payment.userId, "analysis", credits);
          await decreaseUsageCount(payment.userId, "avatar", credits);
        }
        
        return { success: true };
      }),

    // Reject a payment
    rejectPayment: protectedProcedure
      .input(z.object({
        paymentId: z.number(),
        rejectionReason: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can reject payments");
        }
        await db.updatePaymentStatus(input.paymentId, "rejected", ctx.user.id, input.rejectionReason);
        return { success: true };
      }),

    // Batch approve payments
    batchApprovePayments: protectedProcedure
      .input(z.object({ paymentIds: z.array(z.number()) }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can batch approve payments");
        }
        
        const { decreaseUsageCount } = await import("../server/db-extended");
        
        const packageCredits = {
          basic: 4,      // 基础版：4次
          pro: 2,        // 专业版：2次
          enterprise: 30 // 企业版：30次（仿真月付无限次）
        };
        
        for (const paymentId of input.paymentIds) {
          // Get payment details for each payment ID
          const payment = await db.getPaymentById(paymentId);
          
          if (!payment) {
            continue; // Skip if payment not found
          }
          
          // Update payment status
          await db.updatePaymentStatus(paymentId, "approved", ctx.user.id);
          
          // Grant usage credits
          const credits = packageCredits[payment.packageType as keyof typeof packageCredits] || 0;
          
          if (credits > 0) {
            await decreaseUsageCount(payment.userId, "storyboard", credits);
            await decreaseUsageCount(payment.userId, "analysis", credits);
            await decreaseUsageCount(payment.userId, "avatar", credits);
          }
        }
        
        return { success: true, count: input.paymentIds.length };
      }),

    // Batch reject payments
    batchRejectPayments: protectedProcedure
      .input(z.object({
        paymentIds: z.array(z.number()),
        rejectionReason: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can batch reject payments");
        }
        for (const paymentId of input.paymentIds) {
          await db.updatePaymentStatus(paymentId, "rejected", ctx.user.id, input.rejectionReason);
        }
        return { success: true, count: input.paymentIds.length };
      }),
  }),

  guestbook: router({
    // Submit a new guestbook message (public, no auth required)
    submit: publicProcedure
      .input(
        z.object({
          name: z.string().min(1, "请输入姓名").max(100),
          email: z.string().email("请输入有效的电子邮件").max(320).optional().or(z.literal("")),
          phone: z.string().max(30).optional().or(z.literal("")),
          company: z.string().max(200).optional().or(z.literal("")),
          subject: z.string().min(1, "请选择咨询主题").max(255),
          message: z.string().min(1, "请输入咨询内容").max(5000),
        })
      )
      .mutation(async ({ input }) => {
        const data = {
          name: input.name,
          email: input.email || null,
          phone: input.phone || null,
          company: input.company || null,
          subject: input.subject,
          message: input.message,
        };
        const id = await db.createGuestbookMessage(data);
        return { success: true, id };
      }),

    // List recent guestbook messages (public)
    list: publicProcedure
      .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
      .query(async ({ input }) => {
        const limit = input?.limit ?? 20;
        return db.getGuestbookMessages(limit);
      }),
  }),

  // ─── 会员欢迎语生成 ──────────────────────────
  welcomeMessage: router({
    generate: protectedProcedure
      .input(z.object({
        planName: z.string(),
        userName: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const displayName = input.userName || ctx.user.name || "创作者";

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是 MV Studio Pro 的 AI 助手，一个一站式视频创作平台。请为新升级的会员生成一段个性化、热情的欢迎语。

要求：
1. 称呼用户名称，让他们感受到被重视
2. 根据方案等级提及专属功能亮点
3. 鼓励他们开始创作之旅
4. 语气热情但不过度夸张，像一个专业的音乐制作人在欢迎新团队成员
5. 使用繁体中文
6. 长度控制在 100-150 字以内
7. 可以加入 1-2 个音乐相关的 emoji

方案功能参考：
- 专业版：无限视频 PK 评分、偶像生成、分镜脚本、偶像转 3D、视频生成、500 Credits/月
- 企业版：所有专业版功能 + API 访问、团队席位、白标授权、专属客服、2000 Credits/月`,
            },
            {
              role: "user",
              content: `用户名称：${displayName}
升级方案：${input.planName}
请生成欢迎语。`,
            },
          ],
        });

        const rawContent = response.choices?.[0]?.message?.content;
        const msg = typeof rawContent === "string" ? rawContent : "";
        return {
          success: true,
          message: msg,
        };
      }),
  }),


  // === Restored routes from previous version ===

  admin: router({
    stats: adminProcedure.query(async () => getAdminStats()),
    paymentList: adminProcedure.input(z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() }).optional()).query(async ({ input }) => getPaymentSubmissions(input?.status)),
    paymentReview: adminProcedure.input(z.object({
      id: z.number(),
      status: z.enum(["approved", "rejected"]),
      rejectionReason: z.string().optional(),
      creditsToAdd: z.number().optional(),
    })).mutation(async ({ ctx, input }) => {
      await updatePaymentSubmissionStatus(input.id, input.status, ctx.user.id, input.rejectionReason);
      if (input.status === "approved" && input.creditsToAdd) {
        // Find the payment submission to get userId
        const submissions = await getPaymentSubmissions("approved", 100);
        const sub = submissions.find(s => s.id === input.id);
        if (sub) await addCredits(sub.userId, input.creditsToAdd, "payment", "付款審核通過");
      }
      return { success: true };
    }),
    storyboardList: adminProcedure.query(async () => getAllStoryboards()),
    storyboardReview: adminProcedure.input(z.object({
      id: z.number(),
      status: z.enum(["approved", "rejected"]),
      rejectionReason: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      await updateStoryboardStatus(input.id, input.status, ctx.user.id, input.rejectionReason);
      return { success: true };
    }),
    betaList: adminProcedure.query(async () => getAllBetaQuotas()),
    betaGrant: adminProcedure.input(z.object({
      userId: z.number(),
      totalQuota: z.number().default(20),
      note: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      const inviteCode = nanoid(8).toUpperCase();
      await createBetaQuota({ userId: input.userId, feature: 'beta', totalQuota: input.totalQuota });
      return { success: true, inviteCode };
    }),
     teamList: adminProcedure.query(async () => getAllTeams()),
  }),

  audioLab: router({
    /** Check if Gemini audio analysis is available */
    status: publicProcedure.query(() => ({ available: isGeminiAudioAvailable() })),

    /** Analyze uploaded audio with Gemini */
    analyze: protectedProcedure.input(z.object({
      audioUrl: z.string().url(),
      fileName: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      // Gemini audio analysis costs credits
      if (!isAdmin(ctx.user)) {
        const deduction = await deductCredits(ctx.user.id, "audioAnalysis");
        if (!deduction.success) return { success: false as const, error: "Credits 不足，请充值后再试" };
      }

      try {
        const analysis = await analyzeAudioWithGemini(input.audioUrl);
        return { success: true as const, analysis };
      } catch (err: any) {
        // Refund on failure
        if (!isAdmin(ctx.user)) {
          await addCredits(ctx.user.id, CREDIT_COSTS.audioAnalysis, "refund", "音频分析失败退款");
        }
        return { success: false as const, error: err.message || "音频分析失败" };
      }
    }),

    /** Generate storyboard from audio analysis result */
    generateStoryboard: protectedProcedure.input(z.object({
      lyrics: z.string(),
      bpm: z.number(),
      bpmRange: z.string(),
      overallMood: z.string(),
      genre: z.string(),
      sections: z.array(z.object({
        name: z.string(),
        timeRange: z.string(),
        mood: z.string(),
        energy: z.string(),
        instruments: z.string(),
        rhythmPattern: z.string(),
        lyrics: z.string().optional(),
      })),
      suggestedColorPalette: z.string(),
      suggestedVisualStyle: z.string(),
      instrumentation: z.string(),
      sceneCount: z.number().min(2).max(20).default(8),
    })).mutation(async ({ ctx, input }) => {
      // Uses storyboard credits (same as normal storyboard)
      if (!isAdmin(ctx.user)) {
        const usage = await checkUsageLimit(ctx.user.id, "storyboard");
        if (!usage.allowed) {
          const deduction = await deductCredits(ctx.user.id, "storyboard");
          if (!deduction.success) return { success: false, error: "Credits 不足" };
        } else {
          await incrementUsageCount(ctx.user.id, "storyboard");
        }
      }

      const sectionInfo = input.sections.map(s => `[${s.name}] ${s.timeRange} | 情绪: ${s.mood} | 能量: ${s.energy} | 乐器: ${s.instruments} | 节奏: ${s.rhythmPattern}${s.lyrics ? ` | 歌词: ${s.lyrics}` : ""}`).join("\n");

      const systemPrompt = `你是一位世界级的 MV 导演、电影摄影指导和分镜师。
根据 AI 对歌曲的音频分析结果，生成 ${input.sceneCount} 个专业级分镜场景。

【歌曲分析数据】
- BPM: ${input.bpm}（范围 ${input.bpmRange}）
- 整体情绪: ${input.overallMood}
- 音乐风格: ${input.genre}
- 乐器编排: ${input.instrumentation}
- 建议色彩: ${input.suggestedColorPalette}
- 建议视觉风格: ${input.suggestedVisualStyle}

【歌曲段落结构】
${sectionInfo}

【歌词】
${input.lyrics || "（纯音乐，无歌词）"}

【每个分镜必须包含以下维度】
1. 场景编号与时间段（对应歌曲段落）
2. 画面描述（场景环境、空间布局、视觉元素）
3. 灯光设计（主光源方向、色温冷暖、光影对比、补光方式、特殊光效）
4. 人物表情（面部微表情、眼神方向、情绪传达）
5. 人物动作（肢体动作、手势、身体姿态、运动轨迹）
6. 人物神态（内心状态、气质表现、情绪张力）
7. 人物互动（角色之间的空间关系、眼神交流、肢体接触）
8. 摄影机位（远景/全景/中景/近景/特写/大特写）
9. 镜头运动（推/拉/摇/移/跟/升降/手持/航拍/旋转）
10. 色调与调色（整体色调、色彩倾向、对比度、饱和度）
11. 配乐节奏（对应段落的BPM、节奏强弱、音乐情绪）
12. 情绪氛围（整体情绪基调、氛围营造手法）
13. 对应歌词段落
14. 分镜图提示词（英文prompt，包含场景、灯光、人物、构图等关键视觉信息）

请根据歌曲的节奏变化、情绪起伏和段落结构来安排分镜节奏，确保视觉叙事与音乐完美同步。`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `请根据以上歌曲分析数据生成 ${input.sceneCount} 个分镜场景` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "audio_storyboard",
            strict: true,
            schema: {
              type: "object",
              properties: {
                title: { type: "string", description: "分镜脚本标题" },
                overallMood: { type: "string", description: "整体情绪基调" },
                suggestedBPM: { type: "string", description: "配乐BPM" },
                colorPalette: { type: "string", description: "色彩方案" },
                scenes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      sceneNumber: { type: "integer" },
                      timeRange: { type: "string" },
                      description: { type: "string" },
                      lighting: { type: "string" },
                      characterExpression: { type: "string" },
                      characterAction: { type: "string" },
                      characterDemeanor: { type: "string" },
                      characterInteraction: { type: "string" },
                      shotType: { type: "string" },
                      cameraMovement: { type: "string" },
                      colorTone: { type: "string" },
                      bpm: { type: "string" },
                      mood: { type: "string" },
                      lyrics: { type: "string" },
                      imagePrompt: { type: "string" },
                    },
                    required: ["sceneNumber", "timeRange", "description", "lighting", "characterExpression", "characterAction", "characterDemeanor", "characterInteraction", "shotType", "cameraMovement", "colorTone", "bpm", "mood", "lyrics", "imagePrompt"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["title", "overallMood", "suggestedBPM", "colorPalette", "scenes"],
              additionalProperties: false,
            },
          },
        },
      });

      const storyboardData = String(response.choices[0].message.content ?? "{}");
      const parsed = JSON.parse(storyboardData);
      const id = await createStoryboard({ userId: ctx.user.id, lyrics: input.lyrics || "（音频分析生成）", sceneCount: input.sceneCount, storyboard: storyboardData });

      // Auto-generate storyboard images for each scene using Forge (free)
      const scenesWithImages = await Promise.all(
        (parsed.scenes || []).map(async (scene: any) => {
          try {
            const { url } = await generateImage({
              prompt: `Cinematic MV storyboard frame: ${scene.imagePrompt}. Professional film quality, 16:9 aspect ratio, detailed lighting.`,
            });
            return { ...scene, generatedImageUrl: url };
          } catch {
            return { ...scene, generatedImageUrl: null };
          }
        })
      );
      parsed.scenes = scenesWithImages;

      // Auto-record storyboard creation
      try {
        const plan = await getUserPlan(ctx.user.id);
        await recordCreation({
          userId: ctx.user.id,
          type: "storyboard",
          title: parsed.title || "分鏡腳本",
          metadata: { sceneCount: input.sceneCount, overallMood: parsed.overallMood },
          quality: `${input.sceneCount} 場景`,
          creditsUsed: 0,
          plan,
        });
      } catch (e) { console.error("[Storyboard] recordCreation failed:", e); }

      return { success: true, id, storyboard: parsed };
    }),
  }),

  community: router({
    /** 获取视频评论列表 */
    getComments: publicProcedure.input(z.object({ videoUrl: z.string() })).query(async ({ input }) => {
      return getVideoComments(input.videoUrl);
    }),
    /** 发表评论 */
    addComment: protectedProcedure.input(z.object({
      videoUrl: z.string(),
      content: z.string().min(1).max(500),
      parentId: z.number().optional(),
    })).mutation(async ({ ctx, input }) => {
      const commentId = await addVideoComment({
        videoUrl: input.videoUrl,
        userId: ctx.user.id,
        parentId: input.parentId,
        content: input.content,
      });
      return { success: true, commentId };
    }),
    /** 删除评论（仅自己的） */
    deleteComment: protectedProcedure.input(z.object({ commentId: z.number() })).mutation(async ({ ctx, input }) => {
      await deleteVideoComment(input.commentId, ctx.user.id);
      return { success: true };
    }),
    /** 点赞/取消点赞视频 */
    toggleVideoLike: protectedProcedure.input(z.object({ videoUrl: z.string() })).mutation(async ({ ctx, input }) => {
      return toggleVideoLike(input.videoUrl, ctx.user.id);
    }),
    /** 获取视频点赞状态 */
    getVideoLikeStatus: protectedProcedure.input(z.object({ videoUrl: z.string() })).query(async ({ ctx, input }) => {
      return getVideoLikeStatus(input.videoUrl, ctx.user.id);
    }),
    /** 点赞/取消点赞评论 */
    toggleCommentLike: protectedProcedure.input(z.object({ commentId: z.number() })).mutation(async ({ ctx, input }) => {
      return toggleCommentLike(input.commentId, ctx.user.id);
    }),
    /** 获取用户对评论的点赞状态 */
    getUserCommentLikes: protectedProcedure.input(z.object({ commentIds: z.array(z.number()) })).query(async ({ ctx, input }) => {
      return getUserCommentLikes(ctx.user.id);
    }),
    /** 生成分享链接 */
    generateShareLink: publicProcedure.input(z.object({
      videoUrl: z.string(),
      title: z.string().optional(),
    })).query(async ({ input }) => {
      const shareId = Buffer.from(input.videoUrl).toString('base64url').slice(0, 32);
      return {
        shareId,
        shareUrl: `/share/${shareId}`,
        videoUrl: input.videoUrl,
        title: input.title || 'MV Studio Pro 作品',
      };
    }),
  }),

  credits: router({
    balance: protectedProcedure.query(async ({ ctx }) => {
      const b = await getOrCreateBalance(ctx.user.id);
      return { balance: b.balance, lifetimeEarned: b.lifetimeEarned, lifetimeSpent: b.lifetimeSpent };
    }),
    transactions: protectedProcedure.query(async ({ ctx }) => getCreditTransactions(ctx.user.id)),
    usage: protectedProcedure.query(async ({ ctx }) => {
      const [storyboard, analysis, avatar] = await Promise.all([
        getOrCreateUsageTracking(ctx.user.id, "storyboard"),
        getOrCreateUsageTracking(ctx.user.id, "analysis"),
        getOrCreateUsageTracking(ctx.user.id, "avatar"),
      ]);
      return { storyboard, analysis, avatar };
    }),
  }),

  veo: router({
    /** Check if Veo API is available */
    status: publicProcedure.query(() => ({ available: isVeoAvailable() })),

    /** Generate video from storyboard scene */
    generate: protectedProcedure.input(z.object({
      prompt: z.string().min(1).max(2000),
      imageUrl: z.string().url().optional(),
      quality: z.enum(["fast", "standard"]).default("fast"),
      resolution: z.enum(["720p", "1080p"]).default("720p"),
      aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
      emotionFilter: z.string().optional(),
      transition: z.string().optional(),
      storyboardId: z.number().optional(),
      negativePrompt: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      // Determine credit cost based on quality + resolution
      const costKey = `videoGeneration${input.quality === "fast" ? "Fast" : "Std"}${input.resolution === "1080p" ? "1080" : "720"}` as keyof typeof CREDIT_COSTS;
      let creditsUsed = 0;
      if (!isAdmin(ctx.user)) {
        const deduction = await deductCredits(ctx.user.id, costKey);
        if (!deduction.success) {
          return { success: false, error: "Credits 不足，请充值后再试" };
        }
        creditsUsed = deduction.cost;
      }

      // Create DB record
      const genId = (await createVideoGeneration({
        userId: ctx.user.id,
        storyboardId: input.storyboardId ?? null,
        prompt: input.prompt,
        imageUrl: input.imageUrl ?? null,
        quality: input.quality,
        resolution: input.resolution,
        aspectRatio: input.aspectRatio,
        emotionFilter: input.emotionFilter ?? null,
        transition: input.transition ?? null,
        status: "generating",
        creditsUsed,
      })) as unknown as number;

      try {
        const result = await generateVideo({
          prompt: input.prompt,
          imageUrl: input.imageUrl,
          quality: input.quality,
          resolution: input.resolution,
          aspectRatio: input.aspectRatio,
          negativePrompt: input.negativePrompt,
        });

        await updateVideoGeneration(genId, {
          videoUrl: result.videoUrl,
          status: "completed",
          completedAt: new Date(),
        });

        // 注册平台原创视频签名（用于 PK 评分验证）
        try {
          await registerOriginalVideo(ctx.user.id, result.videoUrl, genId);
        } catch (sigErr) {
          console.error("[Veo] Failed to register video signature:", sigErr);
        }

        return { success: true, id: genId, videoUrl: result.videoUrl };
      } catch (err: any) {
        // Refund credits on failure
        if (creditsUsed > 0) await addCredits(ctx.user.id, creditsUsed, "refund", "视频生成失败退款");
        await updateVideoGeneration(genId, {
          status: "failed",
          errorMessage: err.message || "Unknown error",
        });
        return { success: false, error: err.message || "视频生成失败，请稍后重试" };
      }
    }),

    /** Get user's video generation history */
    myList: protectedProcedure.query(async ({ ctx }) => {
      return getVideoGenerationsByUserId(ctx.user.id);
    }),

    /** Get single video generation by ID */
    get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
      const gen = await getVideoGenerationById(input.id);
      if (!gen || (gen as any).userId !== ctx.user.id) return null;
      return gen;
    }),
  }),

});

export type AppRouter = typeof appRouter;
