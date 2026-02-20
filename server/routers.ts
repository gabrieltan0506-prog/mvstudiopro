import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import { generateImage } from "./_core/imageGeneration";
import { storagePut } from "./storage";
import { nanoid } from "nanoid";
import { getStripe, SUBSCRIPTION_PRODUCTS, CREDIT_PACK_PRODUCTS, getOrCreatePrice } from "./stripe-products";
import { stripeCustomers } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import {
  createGuestbookMessage, getGuestbookMessages,
  createMvReview, getMvReviewsByMvId,
  createStoryboard, getStoryboardsByUserId, getAllStoryboards, updateStoryboardStatus,
  createPaymentSubmission, getPaymentSubmissions, updatePaymentSubmissionStatus,
  getOrCreateUsageTracking, incrementUsageCount, checkUsageLimit,
  getOrCreateBalance, deductCredits, addCredits, getCreditTransactions,
  createTeam, getTeamById, getTeamByOwnerId, getTeamByInviteCode, addTeamMember, getTeamMembers, getUserTeamMembership, removeTeamMember, logTeamActivity, getAllTeams,
  createBetaQuota, getBetaQuotaByUserId, getAllBetaQuotas, updateBetaQuota,
  getAdminStats,
  createVideoGeneration, updateVideoGeneration, getVideoGenerationsByUserId, getVideoGenerationById,
  createIdol3dGeneration, updateIdol3dGeneration, getIdol3dGenerationsByUserId, getIdol3dGenerationById,
  addVideoComment, getVideoComments, deleteVideoComment,
  toggleVideoLike, getVideoLikeStatus,
  toggleCommentLike, getUserCommentLikes,
} from "./db";
import { generateVideo, isVeoAvailable } from "./veo";
import { generate3DModel, isHunyuan3DAvailable } from "./hunyuan3d";
import { generateGeminiImage, isGeminiImageAvailable } from "./gemini-image";
import { CREDIT_COSTS } from "../shared/plans";
import { registerOriginalVideo, registerRemixVideo, verifyVideoSignature } from "./video-signature";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Guestbook / Contact ──────────────
  guestbook: router({
    submit: publicProcedure.input(z.object({
      name: z.string().min(1).max(100),
      email: z.string().email().optional(),
      phone: z.string().max(30).optional(),
      company: z.string().max(200).optional(),
      subject: z.string().min(1).max(255),
      message: z.string().min(1).max(2000),
    })).mutation(async ({ input }) => {
      const id = await createGuestbookMessage(input);
      return { success: true, id };
    }),
    list: adminProcedure.query(async () => getGuestbookMessages(100)),
  }),

  // ─── MV Reviews ───────────────────────
  mvReview: router({
    submit: publicProcedure.input(z.object({
      mvId: z.string(),
      nickname: z.string().min(1).max(100),
      rating: z.number().min(1).max(5),
      comment: z.string().min(1).max(1000),
    })).mutation(async ({ input }) => {
      const id = await createMvReview(input);
      return { success: true, id };
    }),
    list: publicProcedure.input(z.object({ mvId: z.string() })).query(async ({ input }) => getMvReviewsByMvId(input.mvId)),
  }),

  // ─── MV Analysis (视频 PK 评分) ──────────────────────
  mvAnalysis: router({
    analyze: protectedProcedure.input(z.object({
      videoUrl: z.string().url(),
      fileName: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      const usage = await checkUsageLimit(ctx.user.id, "analysis");
      if (!usage.allowed) {
        const deduction = await deductCredits(ctx.user.id, "mvAnalysis");
        if (!deduction.success) return { success: false, error: "Credits 不足，請充值後再試" };
      } else {
        await incrementUsageCount(ctx.user.id, "analysis");
      }
      const response = await invokeLLM({
        messages: [
          { role: "system", content: `你是一位資深的影片評審專家，擅長從多個專業維度對短視頻（5分鐘以內）進行深度分析。

請對用戶提供的視頻進行全面 PK 評分，評分維度如下：

1. **故事情感** (1-100)：視頻是否傳達了清晰的情感？是否能引起觀眾共鳴？情感表達是否自然、有層次？
2. **鏡頭運鏡** (1-100)：攝影機運動是否流暢？構圖是否專業？景別切換是否合理？是否有創意的運鏡手法？
3. **敘事邏輯** (1-100)：故事線是否清晰？起承轉合是否完整？節奏把控是否得當？觀眾是否能跟上敘事？
4. **視頻清晰度** (1-100)：畫面是否清晰銳利？色彩是否準確？曝光是否正確？是否有明顯的畫質問題？
5. **綜合評分** (1-100)：基於以上四個維度的加權綜合評分，同時考慮整體觀感和爆款潛力。

同時請提供：
- 每個維度的詳細分析說明（每個維度至少 2-3 句話）
- 至少 3 條具體的改進建議
- 亮點分析（做得好的地方）
- 總結評語

請用 JSON 格式回覆。評分要客觀嚴格，不要輕易給高分。` },
          { role: "user", content: [{ type: "text", text: `請分析這個視頻: ${input.fileName || "uploaded video"}` }, { type: "file_url" as const, file_url: { url: input.videoUrl, mime_type: "video/mp4" as const } }] },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "mv_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                storyEmotion: { type: "integer", description: "故事情感評分 1-100" },
                storyEmotionAnalysis: { type: "string", description: "故事情感詳細分析" },
                cameraWork: { type: "integer", description: "鏡頭運鏡評分 1-100" },
                cameraWorkAnalysis: { type: "string", description: "鏡頭運鏡詳細分析" },
                narrativeLogic: { type: "integer", description: "敘事邏輯評分 1-100" },
                narrativeLogicAnalysis: { type: "string", description: "敘事邏輯詳細分析" },
                videoClarity: { type: "integer", description: "視頻清晰度評分 1-100" },
                videoClarityAnalysis: { type: "string", description: "視頻清晰度詳細分析" },
                overall: { type: "integer", description: "綜合評分 1-100" },
                improvements: { type: "array", items: { type: "string" }, description: "改進建議" },
                highlights: { type: "array", items: { type: "string" }, description: "亮點分析" },
                summary: { type: "string", description: "總結評語" },
              },
              required: ["storyEmotion", "storyEmotionAnalysis", "cameraWork", "cameraWorkAnalysis", "narrativeLogic", "narrativeLogicAnalysis", "videoClarity", "videoClarityAnalysis", "overall", "improvements", "highlights", "summary"],
              additionalProperties: false,
            },
          },
        },
      });
      const rawContent = String(response.choices[0].message.content ?? "{}");
      const analysis = JSON.parse(rawContent);

      // 验证视频来源（Hash 水印）
      const verification = await verifyVideoSignature(input.videoUrl);

      // 根据综合评分计算奖励 Credits
      const { getRewardTier } = await import("../shared/plans");
      const reward = getRewardTier(analysis.overall);
      let rewardGiven = false;

      if (verification.verified && reward.credits > 0) {
        // 平台视频（原创或二次创作）才发放奖励
        await addCredits(ctx.user.id, reward.credits, `视频PK评分奖励 - ${reward.labelCn} (${analysis.overall}分)`);
        rewardGiven = true;
      }

      return {
        success: true,
        analysis,
        verification: {
          verified: verification.verified,
          source: verification.source || null,
        },
        reward: {
          tier: reward.labelCn,
          emoji: reward.emoji,
          credits: reward.credits,
          given: rewardGiven,
          reason: !verification.verified ? "非平台视频，无法获得奖励" : undefined,
        },
      };
    }),
    // 注册二次创作视频签名（外来视频在平台编辑后可参加奖励）
    registerRemix: protectedProcedure.input(z.object({
      videoUrl: z.string().url(),
      originalVideoUrl: z.string().url().optional(),
    })).mutation(async ({ ctx, input }) => {
      const sig = await registerRemixVideo(ctx.user.id, input.videoUrl, input.originalVideoUrl);
      return { success: true, signatureHash: sig.signatureHash };
    }),
    // 验证视频来源
    verify: protectedProcedure.input(z.object({
      videoUrl: z.string().url(),
    })).query(async ({ input }) => {
      return verifyVideoSignature(input.videoUrl);
    }),
  }),

  // ─── Virtual Idol ─────────────────────
  virtualIdol: router({
    /** Check available generation tiers */
    status: publicProcedure.query(() => ({
      geminiAvailable: isGeminiImageAvailable(),
      tiers: [
        { id: "free", label: "免费版", desc: "标准画质", credits: 0, price: "免费" },
        { id: "2k", label: "2K 高清", desc: "2048×2048 Nano Banana Pro", credits: CREDIT_COSTS.storyboardImage2K, price: "$0.134/张" },
        { id: "4k", label: "4K 超清", desc: "4096×4096 Nano Banana Pro", credits: CREDIT_COSTS.storyboardImage4K, price: "$0.24/张" },
      ],
    })),

    generate: protectedProcedure.input(z.object({
      style: z.enum(["anime", "realistic", "cyberpunk", "fantasy", "chibi"]),
      description: z.string().min(1).max(500),
      referenceImageUrl: z.string().url().optional(),
      quality: z.enum(["free", "2k", "4k"]).default("free"),
    })).mutation(async ({ ctx, input }) => {
      const stylePrompts: Record<string, string> = {
        anime: "anime style, vibrant colors, detailed cel-shading",
        realistic: "photorealistic, ultra-detailed, studio lighting, 8K",
        cyberpunk: "cyberpunk style, neon lights, futuristic, dark atmosphere",
        fantasy: "fantasy art style, ethereal, magical, dreamy atmosphere",
        chibi: "chibi style, cute, big eyes, small body, kawaii",
      };
      const prompt = `Virtual idol character portrait: ${input.description}. Style: ${stylePrompts[input.style]}. Full body, high quality, professional illustration.`;

      if (input.quality === "free") {
        // Free tier: use built-in generateImage, check free usage limit
        const usage = await checkUsageLimit(ctx.user.id, "avatar");
        if (!usage.allowed) {
          const deduction = await deductCredits(ctx.user.id, "idolGeneration");
          if (!deduction.success) return { success: false, error: "Credits 不足，請充值後再試" };
        } else {
          await incrementUsageCount(ctx.user.id, "avatar");
        }
        const opts: any = { prompt };
        if (input.referenceImageUrl) {
          opts.originalImages = [{ url: input.referenceImageUrl, mimeType: "image/jpeg" }];
        }
        const { url } = await generateImage(opts);
        return { success: true, imageUrl: url, quality: "free" };
      } else {
        // 2K / 4K: use Gemini API (Nano Banana Pro), always deduct credits
        const creditKey = input.quality === "2k" ? "storyboardImage2K" : "storyboardImage4K";
        const deduction = await deductCredits(ctx.user.id, creditKey);
        if (!deduction.success) return { success: false, error: "Credits 不足，請充值後再試" };
        try {
          const result = await generateGeminiImage({
            prompt,
            quality: input.quality,
            referenceImageUrl: input.referenceImageUrl,
          });
          return { success: true, imageUrl: result.imageUrl, quality: input.quality };
        } catch (err: any) {
          // Refund credits on failure
          await addCredits(ctx.user.id, CREDIT_COSTS[creditKey], `偶像生成失败退款 (${input.quality.toUpperCase()})`);
          console.error("[VirtualIdol] Gemini image generation failed:", err);
          return { success: false, error: "图片生成失败，Credits 已退回" };
        }
      }
    }),
  }),

  // ─── Storyboard ───────────────────────
  storyboard: router({
    generate: protectedProcedure.input(z.object({
      lyrics: z.string().min(1).max(5000),
      sceneCount: z.number().min(2).max(20).default(6),
    })).mutation(async ({ ctx, input }) => {
      const usage = await checkUsageLimit(ctx.user.id, "storyboard");
      if (!usage.allowed) {
        const deduction = await deductCredits(ctx.user.id, "storyboard");
        if (!deduction.success) return { success: false, error: "Credits 不足，請充值後再試" };
      } else {
        await incrementUsageCount(ctx.user.id, "storyboard");
      }
      const response = await invokeLLM({
        messages: [
          { role: "system", content: `你是一位專業的 MV 導演和分鏡師。根據用戶提供的歌詞，生成 ${input.sceneCount} 個分鏡場景。每個場景包含：場景編號、時間段、畫面描述、鏡頭運動、情緒氛圍、色調建議。請用 JSON 格式回覆。` },
          { role: "user", content: input.lyrics },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "storyboard",
            strict: true,
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                scenes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      sceneNumber: { type: "integer" },
                      timeRange: { type: "string" },
                      description: { type: "string" },
                      cameraMovement: { type: "string" },
                      mood: { type: "string" },
                      colorTone: { type: "string" },
                      lyrics: { type: "string" },
                    },
                    required: ["sceneNumber", "timeRange", "description", "cameraMovement", "mood", "colorTone", "lyrics"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["title", "scenes"],
              additionalProperties: false,
            },
          },
        },
      });
      const storyboardData = String(response.choices[0].message.content ?? "{}");
      const id = await createStoryboard({ userId: ctx.user.id, lyrics: input.lyrics, sceneCount: input.sceneCount, storyboard: storyboardData });
      return { success: true, id, storyboard: JSON.parse(storyboardData) };
    }),
    myList: protectedProcedure.query(async ({ ctx }) => {
      const items = await getStoryboardsByUserId(ctx.user.id);
      return items.map(s => ({ ...s, storyboard: JSON.parse(s.storyboard) }));
    }),
    generateImage: protectedProcedure.input(z.object({ sceneDescription: z.string(), colorTone: z.string().optional() })).mutation(async ({ ctx, input }) => {
      const deduction = await deductCredits(ctx.user.id, "storyboardImage2K");
      if (!deduction.success) return { success: false, error: "Credits 不足" };
      const { url } = await generateImage({ prompt: `MV storyboard scene: ${input.sceneDescription}. Color tone: ${input.colorTone || "cinematic"}. Professional cinematography, wide angle, film quality.` });
      return { success: true, imageUrl: url };
    }),
  }),

  // ─── Veo Video Generation ─────────────
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
      const deduction = await deductCredits(ctx.user.id, costKey);
      if (!deduction.success) {
        return { success: false, error: "Credits 不足，请充值后再试" };
      }

      // Create DB record
      const genId = await createVideoGeneration({
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
        creditsUsed: deduction.cost,
      });

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
        await addCredits(ctx.user.id, deduction.cost, "refund", "视频生成失败退款");
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
      if (!gen || gen.userId !== ctx.user.id) return null;
      return gen;
    }),
  }),

  // ─── Payment Submissions ──────────────
  payment: router({
    submit: protectedProcedure.input(z.object({
      packageType: z.string(),
      amount: z.string(),
      paymentMethod: z.string().optional(),
      screenshotUrl: z.string().url(),
    })).mutation(async ({ ctx, input }) => {
      const id = await createPaymentSubmission({ userId: ctx.user.id, ...input });
      return { success: true, id };
    }),
    myList: protectedProcedure.query(async ({ ctx }) => {
      const db = await import("./db").then(m => m.getPaymentSubmissions);
      return db("pending", 50);
    }),
  }),

  // ─── Credits ──────────────────────────
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

  // ─── Teams ────────────────────────────
  team: router({
    create: protectedProcedure.input(z.object({ name: z.string().min(1).max(100) })).mutation(async ({ ctx, input }) => {
      const existing = await getTeamByOwnerId(ctx.user.id);
      if (existing) return { success: false, error: "您已擁有一個團隊" };
      const inviteCode = nanoid(8).toUpperCase();
      const teamId = await createTeam({ name: input.name, ownerId: ctx.user.id, inviteCode });
      await addTeamMember({ teamId, userId: ctx.user.id, role: "owner", status: "active", invitedAt: new Date(), joinedAt: new Date() });
      await logTeamActivity({ teamId, userId: ctx.user.id, action: "team_created", description: `創建團隊: ${input.name}` });
      return { success: true, teamId, inviteCode };
    }),
    myTeam: protectedProcedure.query(async ({ ctx }) => {
      const team = await getTeamByOwnerId(ctx.user.id);
      if (!team) {
        const membership = await getUserTeamMembership(ctx.user.id);
        if (!membership) return null;
        return getTeamById(membership.teamId);
      }
      return team;
    }),
    members: protectedProcedure.input(z.object({ teamId: z.number() })).query(async ({ input }) => getTeamMembers(input.teamId)),
    join: protectedProcedure.input(z.object({ inviteCode: z.string() })).mutation(async ({ ctx, input }) => {
      const team = await getTeamByInviteCode(input.inviteCode);
      if (!team) return { success: false, error: "邀請碼無效" };
      const members = await getTeamMembers(team.id);
      if (members.length >= team.maxMembers) return { success: false, error: "團隊已滿" };
      if (members.some(m => m.userId === ctx.user.id)) return { success: false, error: "您已是團隊成員" };
      await addTeamMember({ teamId: team.id, userId: ctx.user.id, status: "active", joinedAt: new Date() });
      await logTeamActivity({ teamId: team.id, userId: ctx.user.id, action: "member_joined", description: "加入團隊" });
      return { success: true };
    }),
    removeMember: protectedProcedure.input(z.object({ memberId: z.number() })).mutation(async ({ ctx, input }) => {
      await removeTeamMember(input.memberId);
      return { success: true };
    }),
  }),

  // ─── Beta ─────────────────────────────
  beta: router({
    myQuota: protectedProcedure.query(async ({ ctx }) => getBetaQuotaByUserId(ctx.user.id)),
  }),

  // ─── Welcome Message ──────────────────
  welcomeMessage: router({
    generate: protectedProcedure.mutation(async ({ ctx }) => {
      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是 MV Studio Pro 的 AI 助手。請用熱情、專業的語氣為新用戶生成一段歡迎語（50-100字），提及平台的核心功能（视频PK评分、虛擬偶像工坊、智能分镜脚本、分镜转视频）。" },
          { role: "user", content: `用戶名: ${ctx.user.name || "創作者"}` },
        ],
      });
      return { message: response.choices[0].message.content ?? "歡迎來到 MV Studio Pro！" };
    }),
  }),

  // ─── Admin ────────────────────────────
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
        const submissions = await getPaymentSubmissions("approved", 1);
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
      await createBetaQuota({ userId: input.userId, totalQuota: input.totalQuota, grantedBy: ctx.user.id, inviteCode, note: input.note ?? null });
      return { success: true, inviteCode };
    }),
     teamList: adminProcedure.query(async () => getAllTeams()),
  }),

  // ─── Stripe Payment ───────────────────────
  stripe: router({
    // Get current user's subscription status
    status: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { plan: "free", credits: 0 };
      const [customer] = await db.select().from(stripeCustomers).where(eq(stripeCustomers.userId, ctx.user.id)).limit(1);
      const balance = await getOrCreateBalance(ctx.user.id);
      return {
        plan: customer?.plan || "free",
        subscriptionId: customer?.stripeSubscriptionId || null,
        currentPeriodEnd: customer?.currentPeriodEnd || null,
        cancelAtPeriodEnd: customer?.cancelAtPeriodEnd === 1,
        credits: balance.balance,
      };
    }),

    // Create checkout session for subscription
    createSubscription: protectedProcedure.input(z.object({
      planType: z.enum(["pro", "enterprise"]),
      interval: z.enum(["month", "year"]),
    })).mutation(async ({ ctx, input }) => {
      const stripe = getStripe();
      const productKey = `${input.planType}_${input.interval === "month" ? "monthly" : "yearly"}` as keyof typeof SUBSCRIPTION_PRODUCTS;
      const product = SUBSCRIPTION_PRODUCTS[productKey];
      if (!product) throw new Error("Invalid plan");

      const priceId = await getOrCreatePrice(productKey, product);
      const origin = ctx.req.headers.origin || "https://mvstudiopro.com";

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: ctx.user.id.toString(),
        customer_email: ctx.user.email || undefined,
        allow_promotion_codes: true,
        metadata: {
          user_id: ctx.user.id.toString(),
          customer_name: ctx.user.name || "",
          plan_type: input.planType,
        },
        subscription_data: {
          metadata: { plan_type: input.planType, user_id: ctx.user.id.toString() },
        },
        success_url: `${origin}/dashboard?payment=success`,
        cancel_url: `${origin}/pricing?payment=canceled`,
      });

      // Ensure stripe customer record exists
      const db = await getDb();
      if (db && session.customer) {
        const existing = await db.select().from(stripeCustomers).where(eq(stripeCustomers.userId, ctx.user.id)).limit(1);
        if (existing.length === 0) {
          await db.insert(stripeCustomers).values({
            userId: ctx.user.id,
            stripeCustomerId: session.customer as string,
            plan: "free",
          });
        }
      }

      return { url: session.url };
    }),

    // Create checkout session for credit pack
    purchaseCredits: protectedProcedure.input(z.object({
      pack: z.enum(["small", "medium", "large"]),
    })).mutation(async ({ ctx, input }) => {
      const stripe = getStripe();
      const product = CREDIT_PACK_PRODUCTS[input.pack];
      if (!product) throw new Error("Invalid pack");

      const priceId = await getOrCreatePrice(`credits_${input.pack}`, product);
      const origin = ctx.req.headers.origin || "https://mvstudiopro.com";

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: ctx.user.id.toString(),
        customer_email: ctx.user.email || undefined,
        allow_promotion_codes: true,
        metadata: {
          user_id: ctx.user.id.toString(),
          customer_name: ctx.user.name || "",
          credits: product.credits.toString(),
          pack: input.pack,
        },
        success_url: `${origin}/dashboard?credits=purchased`,
        cancel_url: `${origin}/pricing?payment=canceled`,
      });

      return { url: session.url };
    }),

    // Cancel subscription
    cancelSubscription: protectedProcedure.mutation(async ({ ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("DB not available");
      const [customer] = await db.select().from(stripeCustomers).where(eq(stripeCustomers.userId, ctx.user.id)).limit(1);
      if (!customer?.stripeSubscriptionId) throw new Error("No active subscription");

      const stripe = getStripe();
      await stripe.subscriptions.update(customer.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });

      await db.update(stripeCustomers).set({ cancelAtPeriodEnd: 1 }).where(eq(stripeCustomers.userId, ctx.user.id));
      return { success: true };
    }),

    // Get payment history (from Stripe API)
    history: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return [];
      const [customer] = await db.select().from(stripeCustomers).where(eq(stripeCustomers.userId, ctx.user.id)).limit(1);
      if (!customer?.stripeCustomerId) return [];

      try {
        const stripe = getStripe();
        const charges = await stripe.charges.list({
          customer: customer.stripeCustomerId,
          limit: 20,
        });
        return charges.data.map(c => ({
          id: c.id,
          amount: c.amount,
          currency: c.currency,
          status: c.status,
          description: c.description,
          created: c.created * 1000,
          receiptUrl: c.receipt_url,
        }));
      } catch {
        return [];
      }
    }),
  }),

  // ─── Hunyuan3D 2D转3D ──────────────
  hunyuan3d: router({
    /** Check if Hunyuan3D API is available */
    status: publicProcedure.query(() => ({ available: isHunyuan3DAvailable() })),

    /** Generate 3D model from 2D image */
    generate: protectedProcedure.input(z.object({
      inputImageUrl: z.string().url(),
      mode: z.enum(["rapid", "pro"]).default("rapid"),
      enablePbr: z.boolean().default(false),
      enableGeometry: z.boolean().default(false),
    })).mutation(async ({ ctx, input }) => {
      // Determine credit cost based on mode
      const costKey = input.mode === "pro" ? "idol3DPro" : "idol3DRapid";
      const deduction = await deductCredits(ctx.user.id, costKey);
      if (!deduction.success) {
        return { success: false as const, error: "Credits 不足，请充值后再试" };
      }

      // Create DB record
      const genId = await createIdol3dGeneration({
        userId: ctx.user.id,
        inputImageUrl: input.inputImageUrl,
        mode: input.mode,
        enablePbr: input.enablePbr,
        enableGeometry: input.enableGeometry,
        status: "generating",
        creditsUsed: deduction.cost,
      });

      try {
        const result = await generate3DModel({
          inputImageUrl: input.inputImageUrl,
          mode: input.mode,
          enablePbr: input.enablePbr,
          enableGeometry: input.enableGeometry,
        });

        await updateIdol3dGeneration(genId, {
          thumbnailUrl: result.thumbnailUrl,
          modelGlbUrl: result.modelGlbUrl,
          modelObjUrl: result.modelObjUrl,
          modelFbxUrl: result.modelFbxUrl,
          modelUsdzUrl: result.modelUsdzUrl,
          textureUrl: result.textureUrl,
          status: "completed",
          completedAt: new Date(),
        });

        return { success: true as const, id: genId, ...result };
      } catch (err: any) {
        // Refund credits on failure
        await addCredits(ctx.user.id, deduction.cost, "refund", "3D模型生成失败退款");
        await updateIdol3dGeneration(genId, {
          status: "failed",
          errorMessage: err.message || "Unknown error",
        });
        return { success: false as const, error: err.message || "3D模型生成失败，请稍后重试" };
      }
    }),

    /** Get user's 3D generation history */
    myList: protectedProcedure.query(async ({ ctx }) => {
      return getIdol3dGenerationsByUserId(ctx.user.id);
    }),

    /** Get single 3D generation by ID */
    get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
      const gen = await getIdol3dGenerationById(input.id);
      if (!gen || gen.userId !== ctx.user.id) return null;
      return gen;
    }),
  }),

  // ═══════════════════════════════════════════
  // Community: 评论与分享
  // ═══════════════════════════════════════════
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
      return getUserCommentLikes(input.commentIds, ctx.user.id);
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
});
export type AppRouter = typeof appRouter;
