/**
 * Suno 音乐生成路由
 * 
 * 支持两种模式：
 * 1. 主题曲模式 — Gemini 将分镜脚本转成歌词 → Suno 生成带人声的歌曲
 * 2. BGM 模式 — 用户选风格 + 指定时长 → Suno 生成纯配乐
 * 
 * 引擎选择：V4（便宜）/ V5（贵，音质更好）
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { recordCreation } from "./creations";
import { invokeLLM } from "../_core/llm";
import { deductCredits, getCredits, getUserPlan } from "../credits";
import { CREDIT_COSTS } from "../plans";
import {
  createProducerTask,
  getProducerTaskStatus,
  type ProducerModel,
  type ProducerQuality,
} from "../services/aimusic-producer";

// BGM 风格缺省选项
export const BGM_STYLE_PRESETS = [
  { id: "cinematic_epic", label: "史诗电影", labelEn: "Cinematic Epic", style: "Cinematic, Epic Orchestral, Dramatic, Powerful Strings, Brass" },
  { id: "cinematic_emotional", label: "感人电影", labelEn: "Cinematic Emotional", style: "Cinematic, Emotional, Piano, Strings, Gentle, Heartfelt" },
  { id: "lofi_chill", label: "Lo-Fi 放松", labelEn: "Lo-Fi Chill", style: "Lo-Fi, Chill, Relaxing, Soft Beats, Ambient Piano" },
  { id: "electronic_dance", label: "电子舞曲", labelEn: "Electronic Dance", style: "Electronic, Dance, Upbeat, Synth, EDM, Energetic" },
  { id: "acoustic_folk", label: "民谣吉他", labelEn: "Acoustic Folk", style: "Acoustic, Folk, Guitar, Warm, Gentle, Storytelling" },
  { id: "jazz_smooth", label: "爵士轻音乐", labelEn: "Smooth Jazz", style: "Jazz, Smooth, Saxophone, Piano, Relaxing, Elegant" },
  { id: "rock_energetic", label: "摇滚活力", labelEn: "Rock Energetic", style: "Rock, Energetic, Electric Guitar, Drums, Powerful" },
  { id: "chinese_traditional", label: "中国风", labelEn: "Chinese Traditional", style: "Chinese Traditional, Guzheng, Erhu, Bamboo Flute, Elegant, Oriental" },
  { id: "japanese_anime", label: "日系动漫", labelEn: "Japanese Anime", style: "J-Pop, Anime, Bright, Energetic, Synth, Catchy Melody" },
  { id: "kpop_idol", label: "韩流偶像", labelEn: "K-Pop Idol", style: "K-Pop, Idol, Dance Pop, Catchy, Modern, Polished Production" },
  { id: "hip_hop", label: "嘻哈节奏", labelEn: "Hip Hop", style: "Hip Hop, Trap, 808 Bass, Rhythmic, Urban, Modern Beats" },
  { id: "ambient_meditation", label: "冥想氛围", labelEn: "Ambient Meditation", style: "Ambient, Meditation, Calm, Ethereal, Pad, Peaceful" },
  { id: "pop_catchy", label: "流行抓耳", labelEn: "Pop Catchy", style: "Pop, Catchy, Modern, Bright, Uplifting, Radio-Friendly" },
  { id: "rnb_soul", label: "R&B 灵魂", labelEn: "R&B Soul", style: "R&B, Soul, Smooth, Groovy, Warm Vocals, Neo-Soul" },
  { id: "custom", label: "自定义风格", labelEn: "Custom Style", style: "" },
] as const;

type AudioBillingPolicy = "free" | "single_purchase" | "package";

function mapInputModelToProducer(inputModel: "V4" | "V5" | "suno" | "udio"): ProducerModel {
  if (inputModel === "suno" || inputModel === "udio") return inputModel;
  return inputModel === "V5" ? "udio" : "suno";
}

function normalizeProducerStatus(status: string): "PENDING" | "SUCCESS" | "FAILED" {
  if (status.includes("FAIL")) return "FAILED";
  if (status.includes("SUCCESS") || status.includes("DONE") || status.includes("COMPLETED")) return "SUCCESS";
  return "PENDING";
}

function getRetentionDays(policy: AudioBillingPolicy): number {
  return policy === "package" ? 30 : 3;
}

function getPolicyFromPlan(plan: string): AudioBillingPolicy {
  return plan === "pro" || plan === "enterprise" ? "package" : "free";
}

// ─── Gemini 歌词生成 ────────────────────────────

async function generateLyricsFromScript(script: string, mood: string, language: string): Promise<string> {
  const languageMap: Record<string, string> = {
    zh: "中文",
    en: "English",
    ja: "日语",
    ko: "韩语",
  };
  const langLabel = languageMap[language] || "中文";

  const result = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `你是一位专业的歌词创作者。根据用户提供的分镜脚本或故事大纲，创作一首适合作为 MV 主题曲的歌词。

要求：
- 语言：${langLabel}
- 情绪氛围：${mood}
- 歌词结构：包含主歌（Verse）、副歌（Chorus），可选加入桥段（Bridge）
- 每段歌词前用 [Verse]、[Chorus]、[Bridge] 等标记
- 歌词要与脚本的故事主题和情感呼应
- 总长度控制在 200-400 字之间（适合 3-4 分钟歌曲）
- 只输出歌词文本，不要解释或说明`,
      },
      {
        role: "user",
        content: `以下是分镜脚本/故事大纲，请据此创作歌词：\n\n${script}`,
      },
    ],
  });

  const content = result.choices[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map(c => c.text)
      .join("\n");
  }
  return "";
}

// ─── 路由定义 ────────────────────────────────────

export const sunoRouter = router({
  // 获取 BGM 风格缺省列表
  getStylePresets: protectedProcedure.query(() => {
    return BGM_STYLE_PRESETS.map(p => ({
      id: p.id,
      label: p.label,
      labelEn: p.labelEn,
    }));
  }),

  // 从分镜脚本生成歌词（Gemini）
  generateLyrics: protectedProcedure
    .input(z.object({
      script: z.string().min(1).max(5000),
      mood: z.string().min(1).max(200),
      language: z.enum(["zh", "en", "ja", "ko"]).default("zh"),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const isAdmin = ctx.user.role === "admin";

      // 扣除 Credits（管理员免扣）
      if (!isAdmin) {
        const creditsInfo = await getCredits(userId);
        if (creditsInfo.totalAvailable < CREDIT_COSTS.sunoLyrics) {
          throw new Error(`Credits 不足，歌词生成需要 ${CREDIT_COSTS.sunoLyrics} Credits`);
        }
        await deductCredits(userId, "sunoLyrics");
      }

      const lyrics = await generateLyricsFromScript(input.script, input.mood, input.language);
      return { lyrics };
    }),

  // 生成音乐（主题曲或 BGM）
  generateMusic: protectedProcedure
    .input(z.object({
      mode: z.enum(["theme_song", "bgm"]),
      model: z.enum(["V4", "V5", "suno", "udio"]).default("suno"),
      // 主题曲模式需要
      lyrics: z.string().max(5000).optional(),
      // BGM 模式需要
      stylePresetId: z.string().optional(),
      customStyle: z.string().max(1000).optional(),
      // 共用参数
      title: z.string().min(1).max(80),
      mood: z.string().max(200).optional(),
      duration: z.number().int().min(30).max(600).optional(),
      // 回调 URL（可选，前端可以轮询）
      callbackUrl: z.string().url().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const isAdmin = ctx.user.role === "admin";

      const plan = isAdmin ? "enterprise" : await getUserPlan(userId);
      let billingPolicy: AudioBillingPolicy = getPolicyFromPlan(plan);

      const duration = input.duration ?? (input.mode === "bgm" ? 60 : 120);
      const isFreeEligible = input.mode === "bgm" && duration <= 120;
      if (billingPolicy === "free" && !isFreeEligible) {
        billingPolicy = "single_purchase";
      }

      const quality: ProducerQuality = billingPolicy === "package" ? "high" : "normal";
      const creditCost =
        billingPolicy === "free"
          ? 0
          : billingPolicy === "single_purchase"
          ? CREDIT_COSTS.audioSinglePurchase
          : CREDIT_COSTS.audioPackageGeneration;

      if (!isAdmin && creditCost > 0) {
        const creditsInfo = await getCredits(userId);
        if (creditsInfo.totalAvailable < creditCost) {
          throw new Error(`Credits 不足，本次音乐生成需要 ${creditCost} Credits`);
        }
        await deductCredits(
          userId,
          billingPolicy === "single_purchase" ? "audioSinglePurchase" : "audioPackageGeneration",
          billingPolicy === "single_purchase" ? "音乐单次购买生成" : "音乐套餐生成"
        );
      }

      let prompt = "";
      if (input.mode === "theme_song") {
        if (!input.lyrics) throw new Error("主题曲模式需要提供歌词");
        prompt = input.lyrics.trim();
      } else {
        let style = "";
        if (input.stylePresetId && input.stylePresetId !== "custom") {
          const preset = BGM_STYLE_PRESETS.find((p) => p.id === input.stylePresetId);
          if (preset) style = preset.style;
        }
        if (input.customStyle) style = input.customStyle;
        if (!style) style = "Cinematic, Emotional, Instrumental";
        if (input.mood) style = `${style}, ${input.mood}`;
        prompt = style;
      }

      const producerModel = mapInputModelToProducer(input.model);
      const created = await createProducerTask({
        model: producerModel,
        prompt,
        duration,
        quality,
      });

      try {
        const retentionDays = getRetentionDays(billingPolicy);
        await recordCreation({
          userId,
          type: "music",
          title: input.title || (input.mode === "bgm" ? "BGM" : "主题曲"),
          metadata: {
            mode: input.mode,
            model: producerModel,
            taskId: created.taskId,
            billingPolicy,
            retentionDays,
            allowDownload: billingPolicy !== "free",
          },
          quality,
          creditsUsed: creditCost,
          plan,
          status: "pending",
          expiresAt: new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000),
        });
      } catch (e) {
        console.error("[AIMusic] recordCreation failed:", e);
      }

      return {
        taskId: created.taskId,
        mode: input.mode,
        model: producerModel,
        quality,
        creditCost,
        retentionDays: getRetentionDays(billingPolicy),
        allowDownload: billingPolicy !== "free",
        billingPolicy,
      };
    }),

  // 查找音乐生成状态
  getTaskStatus: protectedProcedure
    .input(z.object({
      taskId: z.string().min(1),
    }))
    .query(async ({ input, ctx }) => {
      const status = await getProducerTaskStatus(input.taskId);
      const plan = ctx.user.role === "admin" ? "enterprise" : await getUserPlan(ctx.user.id);
      const billingPolicy = getPolicyFromPlan(plan);
      const allowDownload = billingPolicy !== "free";

      return {
        taskId: input.taskId,
        status: normalizeProducerStatus(status.status),
        songs: status.songs.map((song) => ({
          id: song.id,
          audioUrl: allowDownload ? song.audioUrl ?? song.downloadUrl ?? song.streamUrl : undefined,
          streamUrl: song.streamUrl ?? song.audioUrl,
          imageUrl: song.imageUrl,
          title: song.title,
          tags: song.tags,
          duration: song.duration,
        })),
        errorMessage: status.errorMessage,
        allowDownload,
      };
    }),

  // 获取音频水印 URL（免費用户播放前加入 MVStudioPro.com 语音）
  getWatermarkAudio: protectedProcedure
    .query(async ({ ctx }) => {
      const isAdmin = ctx.user.role === "admin";
      if (isAdmin) {
        return { watermarkUrl: null, enabled: false };
      }
      try {
        const { getWatermarkAudioUrl } = await import("../audio-watermark");
        const url = await getWatermarkAudioUrl();
        return { watermarkUrl: url, enabled: true };
      } catch (err) {
        console.error("[Suno] Failed to get watermark audio:", err);
        return { watermarkUrl: null, enabled: false };
      }
    }),

  // 获取 Credits 消耗信息
  getCreditCosts: protectedProcedure.query(() => {
    return {
      free: 0,
      singlePurchase: CREDIT_COSTS.audioSinglePurchase,
      package: CREDIT_COSTS.audioPackageGeneration,
      // Backward compatibility for existing UI labels
      v4: CREDIT_COSTS.audioSinglePurchase,
      v5: CREDIT_COSTS.audioPackageGeneration,
      lyrics: CREDIT_COSTS.sunoLyrics,
    };
  }),
});
