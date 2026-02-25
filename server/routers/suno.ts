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
import { deductCredits, getCredits } from "../credits";
import { CREDIT_COSTS } from "../plans";
import { addGeneratedByMetadataToAudioUrl } from "../audio-metadata";
import { ensureGenerationConsent, isPaidUser } from "../generation-consent";

// Suno API 配置（通过 sunoapi.org 或 kie.ai 第三方代理）
const SUNO_API_BASE = process.env.SUNO_API_BASE || "https://api.sunoapi.org";
const SUNO_API_KEY = process.env.SUNO_API_KEY || "";

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

// 模型版本映射
const MODEL_MAP = {
  V4: "V4",
  V5: "V5",
} as const;

type SunoModel = keyof typeof MODEL_MAP;

// ─── Suno API 调用 ───────────────────────────────

async function callSunoAPI(endpoint: string, body: Record<string, unknown>) {
  if (!SUNO_API_KEY) {
    throw new Error("Suno API Key 未配置，请联系管理员");
  }

  const response = await fetch(`${SUNO_API_BASE}/api/v1/${endpoint}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${SUNO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Suno API 错误 (${response.status}): ${errorText}`);
  }

  const result = await response.json();
  if (result.code !== 200) {
    throw new Error(`Suno API 返回错误: ${result.msg}`);
  }

  return result.data;
}

async function getSunoTaskStatus(taskId: string) {
  if (!SUNO_API_KEY) {
    throw new Error("Suno API Key 未配置");
  }

  const response = await fetch(
    `${SUNO_API_BASE}/api/v1/generate/record-info?taskId=${taskId}`,
    {
      headers: {
        "Authorization": `Bearer ${SUNO_API_KEY}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`查找任务状态失败 (${response.status})`);
  }

  const result = await response.json();
  if (result.code !== 200) {
    throw new Error(`查找失败: ${result.msg}`);
  }

  return result.data;
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
      await ensureGenerationConsent(userId);

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
      model: z.enum(["V4", "V5"]),
      // 主题曲模式需要
      lyrics: z.string().max(5000).optional(),
      // BGM 模式需要
      stylePresetId: z.string().optional(),
      customStyle: z.string().max(1000).optional(),
      // 共用参数
      title: z.string().min(1).max(80),
      mood: z.string().max(200).optional(),
      // 回调 URL（可选，前端可以轮询）
      callbackUrl: z.string().url().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const isAdmin = ctx.user.role === "admin";
      await ensureGenerationConsent(userId);

      // 根据模型版本确定 Credits 消耗
      const creditCost = input.model === "V5" ? CREDIT_COSTS.sunoMusicV5 : CREDIT_COSTS.sunoMusicV4;

      // 扣除 Credits（管理员免扣）
      if (!isAdmin) {
        const creditsInfo = await getCredits(userId);
        if (creditsInfo.totalAvailable < creditCost) {
          throw new Error(`Credits 不足，${input.model} 音乐生成需要 ${creditCost} Credits`);
        }
        await deductCredits(userId, input.model === "V5" ? "sunoMusicV5" : "sunoMusicV4");
      }

      // 构建 Suno API 请求
      const sunoModel = MODEL_MAP[input.model];

      if (input.mode === "theme_song") {
        // 主题曲模式：customMode + 带歌词
        if (!input.lyrics) {
          throw new Error("主题曲模式需要提供歌词");
        }

        // 确定风格
        let style = input.mood || "Pop, Emotional, Modern";

        const data = await callSunoAPI("generate", {
          customMode: true,
          instrumental: false,
          model: sunoModel,
          prompt: input.lyrics,
          style,
          title: input.title,
          callBackUrl: input.callbackUrl || "",
        });

        // Auto-record creation
        try {
          const { getUserPlan } = await import("../credits");
          const plan = await getUserPlan(userId);
          await recordCreation({
            userId,
            type: "music",
            title: input.title || "主題曲",
            metadata: { mode: "theme_song", model: input.model, taskId: data.taskId },
            quality: input.model,
            creditsUsed: creditCost,
            plan,
            status: "pending",
          });
        } catch (e) { console.error("[Suno] recordCreation failed:", e); }

        return {
          taskId: data.taskId,
          mode: "theme_song" as const,
          model: input.model,
          creditCost,
        };
      } else {
        // BGM 模式：customMode + instrumental
        let style = "";

        if (input.stylePresetId && input.stylePresetId !== "custom") {
          const preset = BGM_STYLE_PRESETS.find(p => p.id === input.stylePresetId);
          if (preset) {
            style = preset.style;
          }
        }

        if (input.customStyle) {
          style = input.customStyle;
        }

        if (!style) {
          style = "Cinematic, Emotional, Instrumental";
        }

        // 如果有 mood 描述，附加到 style
        if (input.mood) {
          style = `${style}, ${input.mood}`;
        }

        const data = await callSunoAPI("generate", {
          customMode: true,
          instrumental: true,
          model: sunoModel,
          style,
          title: input.title,
          callBackUrl: input.callbackUrl || "",
        });

        // Auto-record creation
        try {
          const { getUserPlan } = await import("../credits");
          const plan = await getUserPlan(userId);
          await recordCreation({
            userId,
            type: "music",
            title: input.title || "BGM",
            metadata: { mode: "bgm", model: input.model, taskId: data.taskId },
            quality: input.model,
            creditsUsed: creditCost,
            plan,
            status: "pending",
          });
        } catch (e) { console.error("[Suno] recordCreation failed:", e); }

        return {
          taskId: data.taskId,
          mode: "bgm" as const,
          model: input.model,
          creditCost,
        };
      }
    }),

  // 查找音乐生成状态
  getTaskStatus: protectedProcedure
    .input(z.object({
      taskId: z.string().min(1),
    }))
    .query(async ({ input, ctx }) => {
      const data = await getSunoTaskStatus(input.taskId);
      const paidUser = await isPaidUser(ctx.user.id, ctx.user.role);

      const songs = data.response?.data?.map((song: any) => ({
        id: song.id,
        audioUrl: song.audio_url || song.stream_audio_url,
        streamUrl: song.stream_audio_url,
        imageUrl: song.image_url,
        title: song.title,
        tags: song.tags,
        duration: song.duration,
      })) || [];

      if (!paidUser) {
        for (const song of songs) {
          if (!song.audioUrl || String(song.audioUrl).includes("/watermarked/audio/")) continue;
          try {
            const taggedUrl = await addGeneratedByMetadataToAudioUrl(song.audioUrl);
            song.audioUrl = taggedUrl;
            song.streamUrl = taggedUrl;
            (song as any).metadata = { generated_by: "mvstudiopro_free" };
          } catch (err) {
            console.error("[Suno] Audio metadata tagging failed:", err);
            (song as any).metadata = { generated_by: "mvstudiopro_free" };
          }
        }
      }

      return {
        taskId: data.taskId,
        status: data.status as "PENDING" | "TEXT_SUCCESS" | "FIRST_SUCCESS" | "SUCCESS" | "FAILED",
        songs,
        errorMessage: data.errorMessage,
      };
    }),

  // 获取音频水印 URL（免費用户播放前加入 MVStudioPro.com 语音）
  getWatermarkAudio: protectedProcedure
    .query(async () => {
      // Audio watermark is disabled; free users receive metadata tag only.
      return { watermarkUrl: null, enabled: false };
    }),

  // 获取 Credits 消耗信息
  getCreditCosts: protectedProcedure.query(() => {
    return {
      v4: CREDIT_COSTS.sunoMusicV4,
      v5: CREDIT_COSTS.sunoMusicV5,
      lyrics: CREDIT_COSTS.sunoLyrics,
    };
  }),
});
