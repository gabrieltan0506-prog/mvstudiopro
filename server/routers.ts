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

/** 管理员跳过 Credits 扣费 */
function isAdmin(user: { role: string }) { return user.role === "admin"; }
import { generate3DModel, isHunyuan3DAvailable, estimate3DCost, type ModelTier } from "./hunyuan3d";
import { generateGeminiImage, isGeminiImageAvailable } from "./gemini-image";
import { analyzeAudioWithGemini, isGeminiAudioAvailable } from "./gemini-audio";
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
      if (!isAdmin(ctx.user)) {
        const usage = await checkUsageLimit(ctx.user.id, "analysis");
        if (!usage.allowed) {
          const deduction = await deductCredits(ctx.user.id, "mvAnalysis");
          if (!deduction.success) return { success: false, error: "Credits 不足，請充值後再試" };
        } else {
          await incrementUsageCount(ctx.user.id, "analysis");
        }
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
        { id: "free", label: "免费版", desc: "标准画质", credits: 0 },
        { id: "2k", label: "2K 高清", desc: "2048×2048 Nano Banana Pro", credits: CREDIT_COSTS.storyboardImage2K },
        { id: "4k", label: "4K 超清", desc: "4096×4096 Nano Banana Pro", credits: CREDIT_COSTS.storyboardImage4K },
      ],
    })),

    generate: protectedProcedure.input(z.object({
      style: z.enum(["anime", "realistic", "cyberpunk", "fantasy", "chibi"]),
      description: z.string().min(1).max(500),
      referenceImageUrl: z.string().url().optional(),
      quality: z.enum(["free", "2k", "4k"]).default("free"),
    })).mutation(async ({ ctx, input }) => {
      const stylePrompts: Record<string, string> = {
        anime: "Japanese anime art style, vibrant colors, detailed cel-shading, anime character design, manga illustration",
        realistic: "photorealistic photograph of a real person, ultra-detailed skin texture, natural studio lighting, DSLR camera shot, 8K resolution, real human face, NOT anime NOT cartoon NOT illustration NOT drawing",
        cyberpunk: "cyberpunk style portrait, neon lights, futuristic cityscape, dark atmosphere, glowing accents, cinematic",
        fantasy: "fantasy art style, ethereal glow, magical particles, dreamy atmosphere, enchanted, painterly",
        chibi: "chibi style character, cute, big round eyes, small body proportions, kawaii, pastel colors, adorable",
      };
      const styleContext: Record<string, string> = {
        anime: "anime character illustration, full body",
        realistic: "professional photography portrait of a real person, full body shot, natural pose",
        cyberpunk: "cyberpunk character portrait, full body, cinematic composition",
        fantasy: "fantasy character art, full body, magical setting",
        chibi: "chibi character design, full body, cute pose",
      };
      const prompt = `${styleContext[input.style]}: ${input.description}. ${stylePrompts[input.style]}. High quality, masterpiece.`;

      if (input.quality === "free") {
        // Free tier: use built-in generateImage, check free usage limit
        if (!isAdmin(ctx.user)) {
          const usage = await checkUsageLimit(ctx.user.id, "avatar");
          if (!usage.allowed) {
            const deduction = await deductCredits(ctx.user.id, "idolGeneration");
            if (!deduction.success) return { success: false, error: "Credits 不足，請充值後再試" };
          } else {
            await incrementUsageCount(ctx.user.id, "avatar");
          }
        }
        const opts: any = { prompt };
        if (input.referenceImageUrl) {
          opts.originalImages = [{ url: input.referenceImageUrl, mimeType: "image/jpeg" }];
        }
        const { url } = await generateImage(opts);
        return { success: true, imageUrl: url, quality: "free" };
      } else {
        // 2K / 4K: use Gemini API (Nano Banana Pro), always deduct credits (admin skips)
        const creditKey = input.quality === "2k" ? "storyboardImage2K" : "storyboardImage4K";
        if (!isAdmin(ctx.user)) {
          const deduction = await deductCredits(ctx.user.id, creditKey);
          if (!deduction.success) return { success: false, error: "Credits 不足，請充值後再試" };
        }
        try {
          const result = await generateGeminiImage({
            prompt,
            quality: input.quality,
            referenceImageUrl: input.referenceImageUrl,
          });
          return { success: true, imageUrl: result.imageUrl, quality: input.quality };
        } catch (err: any) {
          // Refund credits on failure (admin doesn't need refund)
          if (!isAdmin(ctx.user)) await addCredits(ctx.user.id, CREDIT_COSTS[creditKey], `偶像生成失败退款 (${input.quality.toUpperCase()})`);
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
      if (!isAdmin(ctx.user)) {
        const usage = await checkUsageLimit(ctx.user.id, "storyboard");
        if (!usage.allowed) {
          const deduction = await deductCredits(ctx.user.id, "storyboard");
          if (!deduction.success) return { success: false, error: "Credits 不足，請充值後再試" };
        } else {
          await incrementUsageCount(ctx.user.id, "storyboard");
        }
      }

      const systemPrompt = `你是一位世界级的 MV 导演、电影摄影指导和分镜师，拥有丰富的影视制作经验。
根据用户提供的歌词或文本，生成 ${input.sceneCount} 个专业级分镜场景。

【每个分镜必须包含以下维度】
1. 场景编号与时间段
2. 画面描述（场景环境、空间布局、视觉元素）
3. 灯光设计（主光源方向、色温冷暖、光影对比、补光方式、特殊光效如逆光/侧光/顶光/轮廓光）
4. 人物表情（面部微表情、眼神方向、情绪传达）
5. 人物动作（肢体动作、手势、身体姿态、运动轨迹）
6. 人物神态（内心状态、气质表现、情绪张力）
7. 人物互动（角色之间的空间关系、眼神交流、肢体接触、情感互动）
8. 摄影机位（远景/全景/中景/近景/特写/大特写）
9. 镜头运动（推/拉/摇/移/跟/升降/手持/稳定器/航拍/旋转）
10. 色调与调色（整体色调、色彩倾向、对比度、饱和度）
11. 配乐节奏（建议BPM范围、节奏强弱、音乐情绪）
12. 情绪氛围（整体情绪基调、氛围营造手法）
13. 对应歌词段落
14. 分镜图提示词（用于AI图片生成的英文prompt，包含场景、灯光、人物、构图等关键视觉信息）

请确保每个分镜之间有视觉节奏变化，镜头语言丰富多样，避免重复单调。`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
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
                title: { type: "string", description: "分镜脚本标题" },
                overallMood: { type: "string", description: "整体情绪基调" },
                suggestedBPM: { type: "string", description: "建议配乐BPM范围，如 90-110" },
                colorPalette: { type: "string", description: "整体色彩方案" },
                scenes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      sceneNumber: { type: "integer" },
                      timeRange: { type: "string", description: "时间段如 0:00-0:15" },
                      description: { type: "string", description: "画面描述：场景环境、空间布局、视觉元素" },
                      lighting: { type: "string", description: "灯光设计：主光源方向、色温、光影效果、特殊光效" },
                      characterExpression: { type: "string", description: "人物表情：面部微表情、眼神方向、情绪传达" },
                      characterAction: { type: "string", description: "人物动作：肢体动作、手势、身体姿态、运动轨迹" },
                      characterDemeanor: { type: "string", description: "人物神态：内心状态、气质表现、情绪张力" },
                      characterInteraction: { type: "string", description: "人物互动：角色间空间关系、眼神交流、肢体接触" },
                      shotType: { type: "string", description: "机位景别：远景/全景/中景/近景/特写/大特写" },
                      cameraMovement: { type: "string", description: "镜头运动：推/拉/摇/移/跟/升降/手持/航拍" },
                      colorTone: { type: "string", description: "色调与调色：色彩倾向、对比度、饱和度" },
                      bpm: { type: "string", description: "配乐节奏：BPM范围、节奏强弱" },
                      mood: { type: "string", description: "情绪氛围" },
                      lyrics: { type: "string", description: "对应歌词段落" },
                      imagePrompt: { type: "string", description: "分镜图AI生成提示词（英文），包含场景、灯光、人物、构图等视觉信息，用于生成分镜概念图" },
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
      const id = await createStoryboard({ userId: ctx.user.id, lyrics: input.lyrics, sceneCount: input.sceneCount, storyboard: storyboardData });

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

      return { success: true, id, storyboard: parsed };
    }),
    myList: protectedProcedure.query(async ({ ctx }) => {
      const items = await getStoryboardsByUserId(ctx.user.id);
      return items.map(s => ({ ...s, storyboard: JSON.parse(s.storyboard) }));
    }),
    /** 灵感文案生成：用户给三句话，AI 生成完整文案/歌词 */
    generateInspiration: protectedProcedure.input(z.object({
      keywords: z.string().min(1).max(500),
      mode: z.enum(["free", "gemini"]).default("free"),
    })).mutation(async ({ ctx, input }) => {
      const maxChars = input.mode === "gemini" ? 2000 : 1000;
      const maxScenes = input.mode === "gemini" ? 20 : 10;

      // Gemini mode costs credits
      if (input.mode === "gemini" && !isAdmin(ctx.user)) {
        const deduction = await deductCredits(ctx.user.id, "inspiration");
        if (!deduction.success) return { success: false, error: "Credits 不足，请充值后再试" };
      }

      const freePrompt = `你是一位顶级的视频剧本作家和歌词创作者。用户会给你几句简短的描述或关键词，你需要根据这些灵感生成一份完整的视频文案或歌词。

要求：
- 文案内容不超过 ${maxChars} 字
- 内容要有画面感、情感层次、节奏变化
- 适合拍摄视频或 MV
- 如果是歌词，要有押韵和旋律感
- 可以拆分成段落（主歌/副歌/桥段）
- 建议配乐BPM范围
- 建议可以生成 ${maxScenes} 个分镜场景`;

      const geminiPrompt = `你是一位世界级的影视编剧、作词人和视觉叙事大师。用户会给你几句简短的描述或关键词，你需要根据这些灵感生成一份极其精致的视频文案或歌词。

【Gemini 增强版要求】
- 文案内容不超过 ${maxChars} 字
- 歌词要有精妙的押韵、内韵、双关和意象叠加
- 每段歌词要配合具体的视觉画面描述
- 包含详细的情绪起伏曲线（从开场到高潮到尾声）
- 建议具体的色彩心理学运用（如冷色调表达孤独、暖色调表达温暖）
- 建议配乐风格、BPM范围、乐器编排
- 建议灯光氛围（自然光/人造光/混合光）
- 建议拍摄手法（长镜头/蒙太奇/平行剪辑）
- 建议可以生成 ${maxScenes} 个分镜场景
- 整体叙事要有电影感，有起承转合`;

      const systemPrompt = input.mode === "gemini" ? geminiPrompt : freePrompt;

      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `我的灵感关键词：${input.keywords}` },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "inspiration",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  content: { type: "string", description: "完整的文案/歌词内容" },
                  suggestedScenes: { type: "integer" },
                  mood: { type: "string" },
                  style: { type: "string", description: "建议的视觉风格" },
                  suggestedBPM: { type: "string", description: "建议配乐BPM范围" },
                  colorScheme: { type: "string", description: "建议色彩方案" },
                },
                required: ["title", "content", "suggestedScenes", "mood", "style", "suggestedBPM", "colorScheme"],
                additionalProperties: false,
              },
            },
          },
        });
        const data = JSON.parse(String(response.choices[0].message.content ?? "{}"));
        return { success: true, ...data, mode: input.mode, maxChars, maxScenes };
      } catch (err: any) {
        if (input.mode === "gemini" && !isAdmin(ctx.user)) {
          await addCredits(ctx.user.id, CREDIT_COSTS.inspiration, "refund", "灵感文案生成失败退款");
        }
        return { success: false, error: err.message || "文案生成失败" };
      }
    }),
    /** 生成分镜图：免费版 Forge 基础图 / 2K 收费 / 4K 收费 */
    generateImage: protectedProcedure.input(z.object({
      sceneDescription: z.string(),
      imagePrompt: z.string().optional(),
      colorTone: z.string().optional(),
      quality: z.enum(["free", "2k", "4k"]).default("free"),
    })).mutation(async ({ ctx, input }) => {
      // 2K and 4K cost credits
      if (input.quality === "2k" && !isAdmin(ctx.user)) {
        const deduction = await deductCredits(ctx.user.id, "storyboardImage2K");
        if (!deduction.success) return { success: false, error: "Credits 不足" };
      } else if (input.quality === "4k" && !isAdmin(ctx.user)) {
        const deduction = await deductCredits(ctx.user.id, "storyboardImage4K");
        if (!deduction.success) return { success: false, error: "Credits 不足" };
      }
      // Free uses Forge, 2K/4K use Gemini image generation
      const prompt = input.imagePrompt || input.sceneDescription;
      if (input.quality === "free") {
        const { url } = await generateImage({
          prompt: `Cinematic MV storyboard frame: ${prompt}. Color tone: ${input.colorTone || "cinematic"}. Professional film quality, 16:9 aspect ratio.`,
        });
        return { success: true, imageUrl: url, quality: "free" };
      } else {
        // 2K/4K use Gemini for higher quality
        const qualityHint = input.quality === "4k" ? "ultra high resolution 4K, extremely detailed" : "high resolution 2K, detailed";
        try {
          const geminiAvailable = isGeminiImageAvailable();
          if (geminiAvailable) {
            const result = await generateGeminiImage({
              prompt: `${qualityHint} cinematic MV storyboard: ${prompt}. Color tone: ${input.colorTone || "cinematic"}. Professional cinematography, film grain, detailed lighting.`,
              quality: input.quality as "2k" | "4k",
            });
            return { success: true, imageUrl: result.imageUrl, quality: input.quality };
          } else {
            // Fallback to Forge if Gemini unavailable
            const { url } = await generateImage({
              prompt: `${qualityHint} cinematic MV storyboard: ${prompt}. Color tone: ${input.colorTone || "cinematic"}. Professional film quality.`,
            });
            return { success: true, imageUrl: url, quality: input.quality };
          }
        } catch {
          // Refund on failure
          if (!isAdmin(ctx.user)) {
            const refundKey = input.quality === "4k" ? "storyboardImage4K" : "storyboardImage2K";
            await addCredits(ctx.user.id, CREDIT_COSTS[refundKey as keyof typeof CREDIT_COSTS], "refund", `${input.quality}分镜图生成失败退款`);
          }
          return { success: false, error: "图片生成失败" };
        }
      }
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
      let creditsUsed = 0;
      if (!isAdmin(ctx.user)) {
        const deduction = await deductCredits(ctx.user.id, costKey);
        if (!deduction.success) {
          return { success: false, error: "Credits 不足，请充值后再试" };
        }
        creditsUsed = deduction.cost;
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
        creditsUsed,
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

    /** Estimate generation cost */
    estimateCost: publicProcedure.input(z.object({
      tier: z.enum(["rapid", "pro"]).default("rapid"),
      enablePbr: z.boolean().default(false),
      enableMultiview: z.boolean().default(false),
      enableCustomFaces: z.boolean().default(false),
    })).query(({ input }) => {
      return estimate3DCost(input.tier, input.enablePbr, input.enableMultiview, input.enableCustomFaces);
    }),

    /** Generate 3D model from 2D image */
    generate: protectedProcedure.input(z.object({
      imageUrl: z.string().url(),
      tier: z.enum(["rapid", "pro"]).default("rapid"),
      enablePbr: z.boolean().default(false),
      enableMultiview: z.boolean().default(false),
      multiviewUrls: z.array(z.string().url()).optional(),
      enableCustomFaces: z.boolean().default(false),
      targetFaceCount: z.number().optional(),
      textureResolution: z.enum(["512", "1024", "2048"]).optional(),
      outputFormat: z.enum(["glb", "obj"]).optional(),
    })).mutation(async ({ ctx, input }) => {
      // Estimate cost and deduct credits
      const costEst = estimate3DCost(input.tier, input.enablePbr, input.enableMultiview, input.enableCustomFaces);
      let creditsUsed3d = 0;
      if (!isAdmin(ctx.user)) {
        const deduction = await deductCredits(ctx.user.id, input.tier === "pro" ? "idol3DPro" : "idol3DRapid");
        if (!deduction.success) {
          return { success: false as const, error: `Credits 不足（需要 ${costEst.credits} Credits），请充值后再试` };
        }
        creditsUsed3d = deduction.cost;
      }

      // Create DB record
      const genId = await createIdol3dGeneration({
        userId: ctx.user.id,
        inputImageUrl: input.imageUrl,
        mode: input.tier,
        enablePbr: input.enablePbr,
        enableGeometry: input.enableMultiview,
        status: "generating",
        creditsUsed: creditsUsed3d,
      });

      try {
        const result = await generate3DModel({
          image_url: input.imageUrl,
          tier: input.tier,
          enable_pbr: input.enablePbr,
          multiview_urls: input.multiviewUrls,
          target_face_count: input.targetFaceCount,
          texture_resolution: input.textureResolution ? parseInt(input.textureResolution) as 512 | 1024 | 2048 : undefined,
          output_format: input.outputFormat,
        });

        if (result.status === "failed") {
          // Refund credits on failure
          if (creditsUsed3d > 0) await addCredits(ctx.user.id, creditsUsed3d, "refund", "3D模型生成失败退款");
          await updateIdol3dGeneration(genId, {
            status: "failed",
            errorMessage: result.error || "生成失败",
          });
          return { success: false as const, error: result.error || "3D模型生成失败，请稍后重试" };
        }

        await updateIdol3dGeneration(genId, {
          thumbnailUrl: result.output?.preview_url ?? null,
          modelGlbUrl: result.output?.model_url ?? null,
          modelObjUrl: result.output?.obj_url ?? null,
          modelFbxUrl: null,
          modelUsdzUrl: null,
          textureUrl: result.output?.texture_url ?? null,
          status: "completed",
          completedAt: new Date(),
        });

        return {
          success: true as const,
          id: genId,
          requestId: result.request_id,
          modelUrl: result.output?.model_url ?? null,
          objUrl: result.output?.obj_url ?? null,
          textureUrl: result.output?.texture_url ?? null,
          previewUrl: result.output?.preview_url ?? null,
          availableFormats: result.output?.available_formats ?? [],
          timeTaken: result.time_taken,
          creditsUsed: creditsUsed3d,
        };
      } catch (err: any) {
        // Refund credits on failure
        if (creditsUsed3d > 0) await addCredits(ctx.user.id, creditsUsed3d, "refund", "3D模型生成失败退款");
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

  // ─── Audio Lab: 歌曲上传分析 ──────────────
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

      return { success: true, id, storyboard: parsed };
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
