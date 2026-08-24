/**
 * 后期工坊任务输入契约:路由与 worker 共用同一份 Zod Schema。
 * 字段、数组长度、数值范围在创建任务前统一整理;worker 对旧任务数据再解析一次,
 * 不信任队列里已存的形状(强 schema 是防"半格式任务"进 ffmpeg 的第一道闸)。
 */
import { z } from "zod";

const mediaSourceSchema = z.string().trim().min(1).max(2048);

/** 编码器要求画面尺寸为偶数;奇数在 Schema 层就打回,不进 ffmpeg */
function evenDimension(min: number, max: number) {
  return z
    .number()
    .int()
    .min(min)
    .max(max)
    .refine((value) => value % 2 === 0, "画面尺寸必须为偶数");
}

export const concatParamsSchema = z
  .object({
    clips: z.array(mediaSourceSchema).min(2).max(12),
    width: evenDimension(320, 3840).default(1280),
    height: evenDimension(240, 2160).default(720),
    fps: z.number().int().min(12).max(60).default(30),
  })
  .strict();

export const bgmMountParamsSchema = z
  .object({
    videoUri: mediaSourceSchema,
    bgmUri: mediaSourceSchema,
    /** BGM 增益(0-1);0.48 规实弹默认 */
    bgmVolume: z.number().min(0).max(1).default(0.48),
    /** 音乐在片内的进场秒 */
    entrySec: z.number().min(0).max(3600).default(0),
    fadeInSec: z.number().min(0).max(30).default(0.5),
    fadeOutSec: z.number().min(0).max(30).default(1),
    /**
     * 卡点表产出的**分窗增益表达式**（ffmpeg `volume` 的 if/between 串）。
     *
     * 这是贴装一直缺的那块：只有 entry/fade 时，「对白窗压住、高潮窗抬起、
     * 静音窗真空」都做不到，而铁律一（画面静音点 BGM 必须硬切停）正靠它。
     * 缺省时退回单一 bgmVolume，行为与从前一致。
     */
    volumeExpr: z.string().max(2000).optional(),
  })
  .strict();

export const loudnessParamsSchema = z
  .object({
    videoUri: mediaSourceSchema,
    windows: z
      .array(
        z
          .object({
            startSec: z.number().min(0),
            durationSec: z.number().positive().max(600),
          })
          .strict(),
      )
      .max(60)
      .default([]),
  })
  .strict();

export const postProdJobInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("concat"), params: concatParamsSchema }).strict(),
  z.object({ action: z.literal("bgm_mount"), params: bgmMountParamsSchema }).strict(),
  z.object({ action: z.literal("loudness_check"), params: loudnessParamsSchema }).strict(),
]);

export type PostProdJobInput = z.infer<typeof postProdJobInputSchema>;
export type ConcatParams = z.infer<typeof concatParamsSchema>;
export type BgmMountParams = z.infer<typeof bgmMountParamsSchema>;
export type LoudnessParams = z.infer<typeof loudnessParamsSchema>;
