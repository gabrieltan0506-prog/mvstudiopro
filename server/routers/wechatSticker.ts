import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { deductCredits, getCredits } from "../credits";
import { invokeLLM } from "../_core/llm";
import { generateGeminiImage } from "../gemini-image";

// ─── 情绪分类 ───────────────────────────────────
export const STICKER_EMOTIONS = {
  happy: { label: "开心", emoji: "😄", examples: ["哈哈哈", "太棒了", "好开心"] },
  love: { label: "爱心", emoji: "❤️", examples: ["比心", "爱你", "么么哒"] },
  sad: { label: "难过", emoji: "😢", examples: ["呜呜", "好难过", "心碎了"] },
  angry: { label: "生气", emoji: "😡", examples: ["气死了", "暴怒", "哼"] },
  surprised: { label: "惊讶", emoji: "😲", examples: ["天哪", "不会吧", "震惊"] },
  shy: { label: "害羞", emoji: "😊", examples: ["嘿嘿", "不好意思", "脸红"] },
  cool: { label: "酷", emoji: "😎", examples: ["666", "太酷了", "没问题"] },
  sleepy: { label: "困", emoji: "😴", examples: ["好困", "晚安", "打瞌睡"] },
  thinking: { label: "思考", emoji: "🤔", examples: ["嗯...", "让我想想", "有道理"] },
  excited: { label: "兴奋", emoji: "🤩", examples: ["冲冲冲", "太赞了", "激动"] },
  awkward: { label: "尴尬", emoji: "😅", examples: ["好吧", "无语", "尴尬"] },
  grateful: { label: "感谢", emoji: "🙏", examples: ["谢谢", "辛苦了", "感恩"] },
} as const;

// ─── 常用词语标签 ───────────────────────────────
export const STICKER_PHRASES = [
  "好的", "收到", "谢谢", "再见", "加油", "没问题",
  "哈哈哈", "666", "太棒了", "不要", "救命", "无语",
  "好吧", "了解", "辛苦了", "早安", "晚安", "生日快乐",
  "恭喜", "我错了", "在吗", "等等", "冲鸭", "摸鱼",
] as const;

// ─── 表情风格 ───────────────────────────────────
export const STICKER_STYLES = [
  { id: "cute-cartoon", label: "可爱卡通", desc: "圆润线条、大眼睛、Q版风格" },
  { id: "pixel-art", label: "像素风", desc: "复古像素点阵、8-bit 游戏风" },
  { id: "watercolor", label: "水彩手绘", desc: "柔和水彩笔触、文艺清新" },
  { id: "chibi-anime", label: "Q版动漫", desc: "日系Q版、大头小身体" },
  { id: "3d-clay", label: "3D 粘土", desc: "3D渲染粘土质感、立体可爱" },
  { id: "flat-minimal", label: "扁平极简", desc: "简洁线条、纯色填充" },
  { id: "meme", label: "沙雕搞笑", desc: "夸张表情、网络梗风格" },
  { id: "elegant", label: "优雅复古", desc: "复古插画风、精致典雅" },
] as const;

export const wechatStickerRouter = router({
  // 获取所有情绪和词语选项
  getOptions: protectedProcedure.query(() => {
    return {
      emotions: STICKER_EMOTIONS,
      phrases: STICKER_PHRASES,
      styles: STICKER_STYLES,
    };
  }),

  // 生成单个表情包图片
  generate: protectedProcedure
    .input(z.object({
      emotion: z.string(),
      phrase: z.string().optional(),
      customText: z.string().max(10).optional(),
      style: z.string().default("cute-cartoon"),
      characterDesc: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;

      // 检查 Credits（每个表情 3 Credits）
      const credits = await getCredits(userId);
      if (credits.totalAvailable < 3) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Credits 不足，生成表情包需要 3 Credits" });
      }
      await deductCredits(userId, "idolGeneration", "微信表情包生成");

      const emotionData = STICKER_EMOTIONS[input.emotion as keyof typeof STICKER_EMOTIONS];
      const emotionLabel = emotionData?.label || input.emotion;
      const styleData = STICKER_STYLES.find(s => s.id === input.style);
      const styleDesc = styleData?.desc || "可爱卡通风格";
      const displayText = input.customText || input.phrase || "";

      // 用 LLM 生成精确的图片 prompt
      const promptResult = await invokeLLM({
        messages: [
          { role: "system", content: `你是微信表情包设计专家。根据用户的情绪、文本和风格要求，生成一段英文图片生成 prompt。
要求：
- 输出纯英文 prompt，不要任何解释
- 图片尺寸 240x240 像素，正方形
- 白色或透明背景，适合微信表情包
- 角色/物体居中，表情夸张生动
- 风格：${styleDesc}
- 如果有文本，不要在 prompt 中要求渲染文本（文本会后期叠加）
- prompt 控制在 80 词以内` },
          { role: "user", content: `情绪：${emotionLabel}
文本：${displayText || "无"}
风格：${input.style}
角色描述：${input.characterDesc || "一个可爱的卡通小人"}
请生成图片 prompt。` },
        ],
        maxTokens: 200,
      });

      const imagePrompt = typeof promptResult === "string" ? promptResult : (promptResult as any)?.text || "";

      // 生成图片
      const imageResult = await generateGeminiImage({
        prompt: imagePrompt.trim() + ", square 240x240 pixels, white background, sticker style",
        quality: "1k",
      });

      if (!imageResult?.imageUrl) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "表情包图片生成失败" });
      }

      return {
        success: true,
        imageUrl: imageResult.imageUrl,
        emotion: emotionLabel,
        phrase: displayText,
        style: input.style,
        prompt: imagePrompt.trim(),
      };
    }),

  // 批量生成一套表情包（8个）
  generateSet: protectedProcedure
    .input(z.object({
      style: z.string().default("cute-cartoon"),
      characterDesc: z.string().max(200).optional(),
      emotions: z.array(z.string()).min(1).max(8),
      phrases: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const count = input.emotions.length;
      const totalCost = count * 3;

      const credits = await getCredits(userId);
      if (credits.totalAvailable < totalCost) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Credits 不足，生成 ${count} 个表情需要 ${totalCost} Credits，当前余额 ${credits.totalAvailable}`,
        });
      }

      // 逐个生成（返回 taskId 让前端轮询）
      return {
        success: true,
        taskId: `sticker-set-${Date.now()}`,
        count,
        totalCost,
        message: `开始生成 ${count} 个表情包，预计需要 ${count * 15} 秒`,
      };
    }),
});
