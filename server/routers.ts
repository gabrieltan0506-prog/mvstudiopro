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
} from "./db";
import { generateVideo, isVeoAvailable } from "./veo";
import { CREDIT_COSTS } from "../shared/plans";

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

  // ─── MV Analysis ──────────────────────
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
          { role: "system", content: `你是一位專業的 MV 影片分析師。請對用戶提供的 MV 影片進行全面分析，包括：
1. 畫面構圖評分 (1-100)
2. 色彩風格評分 (1-100)
3. 節奏感評分 (1-100)
4. 爆款潛力評分 (1-100)
5. 綜合評分 (1-100)
6. 改進建議（至少 3 條）
7. 亮點分析
請用 JSON 格式回覆。` },
          { role: "user", content: [{ type: "text", text: `請分析這個 MV 影片: ${input.fileName || "uploaded video"}` }, { type: "file_url" as const, file_url: { url: input.videoUrl, mime_type: "video/mp4" as const } }] },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "mv_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                composition: { type: "integer", description: "畫面構圖評分 1-100" },
                colorStyle: { type: "integer", description: "色彩風格評分 1-100" },
                rhythm: { type: "integer", description: "節奏感評分 1-100" },
                viralPotential: { type: "integer", description: "爆款潛力評分 1-100" },
                overall: { type: "integer", description: "綜合評分 1-100" },
                improvements: { type: "array", items: { type: "string" }, description: "改進建議" },
                highlights: { type: "array", items: { type: "string" }, description: "亮點分析" },
                summary: { type: "string", description: "總結評語" },
              },
              required: ["composition", "colorStyle", "rhythm", "viralPotential", "overall", "improvements", "highlights", "summary"],
              additionalProperties: false,
            },
          },
        },
      });
      const rawContent = String(response.choices[0].message.content ?? "{}");
      const analysis = JSON.parse(rawContent);
      return { success: true, analysis };
    }),
  }),

  // ─── Virtual Idol ─────────────────────
  virtualIdol: router({
    generate: protectedProcedure.input(z.object({
      style: z.enum(["anime", "realistic", "cyberpunk", "fantasy", "chibi"]),
      description: z.string().min(1).max(500),
      referenceImageUrl: z.string().url().optional(),
    })).mutation(async ({ ctx, input }) => {
      const usage = await checkUsageLimit(ctx.user.id, "avatar");
      if (!usage.allowed) {
        const deduction = await deductCredits(ctx.user.id, "idolGeneration");
        if (!deduction.success) return { success: false, error: "Credits 不足，請充值後再試" };
      } else {
        await incrementUsageCount(ctx.user.id, "avatar");
      }
      const stylePrompts: Record<string, string> = {
        anime: "anime style, vibrant colors, detailed cel-shading",
        realistic: "photorealistic, ultra-detailed, studio lighting, 8K",
        cyberpunk: "cyberpunk style, neon lights, futuristic, dark atmosphere",
        fantasy: "fantasy art style, ethereal, magical, dreamy atmosphere",
        chibi: "chibi style, cute, big eyes, small body, kawaii",
      };
      const prompt = `Virtual idol character portrait: ${input.description}. Style: ${stylePrompts[input.style]}. Full body, high quality, professional illustration.`;
      const opts: any = { prompt };
      if (input.referenceImageUrl) {
        opts.originalImages = [{ url: input.referenceImageUrl, mimeType: "image/jpeg" }];
      }
      const { url } = await generateImage(opts);
      return { success: true, imageUrl: url };
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
});
export type AppRouter = typeof appRouter;
