/**
 * 后期工坊任务输入契约:路由与 worker 共用同一份 Zod Schema。
 * 字段、数组长度、数值范围在创建任务前统一整理;worker 对旧任务数据再解析一次,
 * 不信任队列里已存的形状(强 schema 是防"半格式任务"进 ffmpeg 的第一道闸)。
 */
import { z } from "zod";

const mediaSourceSchema = z.string().trim().min(1).max(2048);

/**
 * `volumeExpr` 最终进入 ffmpeg filter_complex，必须只允许卡点表会生成的
 * 数字表达式。ffmpeg 由 execFile 启动，不经过 shell；这里再禁止滤镜分隔符、
 * 标签与未知函数，避免借表达式追加第二条滤镜链。
 */
export function isSafePostProdVolumeExpr(value: string): boolean {
  const expression = String(value || "").trim();
  if (!expression || expression.length > 4000) return false;
  if (!/^[0-9A-Za-z_.,()+\-*/\s]+$/.test(expression)) return false;
  const identifiers = expression.match(/[A-Za-z_]+/g) || [];
  return identifiers.every((identifier) =>
    identifier === "if" || identifier === "between" || identifier === "t");
}

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
    /** 从 BGM 曲内第几秒开始取；对应 ffmpeg atrim=start。 */
    bgmSeekSec: z.number().min(0).max(3600).default(0),
    fadeInSec: z.number().min(0).max(30).default(0.5),
    fadeOutSec: z.number().min(0).max(30).default(1),
    /** 卡点表产出的片内分窗增益；缺省时保持旧版固定 bgmVolume。 */
    volumeExpr: z
      .string()
      .trim()
      .max(4000)
      .refine(isSafePostProdVolumeExpr, "卡点音量表达式格式不正确")
      .optional(),
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
/** 队列旧记录/直接服务调用的解析前形状；带 default 的字段允许缺省。 */
export type RawPostProdJobInput = z.input<typeof postProdJobInputSchema>;
export type ConcatParams = z.infer<typeof concatParamsSchema>;
export type BgmMountParams = z.infer<typeof bgmMountParamsSchema>;
export type RawBgmMountParams = z.input<typeof bgmMountParamsSchema>;
export type LoudnessParams = z.infer<typeof loudnessParamsSchema>;
