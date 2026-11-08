/**
 * 共用素材检索合同（2026-11-08）：参考 MoneyPrinterTurbo material.py 的
 * 「关键词 → 素材搜索 → 画幅/时长筛选 → 下载」思路，只抽素材检索这一段，
 * 不引入其 LLM 脚本、Edge TTS、moviepy 合成。下游（MV / 数字人 / 营销 / 漫剧）
 * 只消费「已采用」的永久资产（本人 GCS + 来源证据），绝不消费候选预览地址。
 */
import { z } from "zod";

export const STOCK_FOOTAGE_PROVIDERS = ["pexels"] as const;
export type StockFootageProvider = (typeof STOCK_FOOTAGE_PROVIDERS)[number];
export const STOCK_FOOTAGE_KINDS = ["video", "photo"] as const;
export type StockFootageKind = (typeof STOCK_FOOTAGE_KINDS)[number];
export const STOCK_FOOTAGE_ORIENTATIONS = ["landscape", "portrait", "square"] as const;
export type StockFootageOrientation = (typeof STOCK_FOOTAGE_ORIENTATIONS)[number];

/** 业务用途：决定采用后谁能消费、怎么消费。 */
export const STOCK_FOOTAGE_PURPOSES = ["mv", "digital_human", "marketing", "manhua"] as const;
export type StockFootagePurpose = (typeof STOCK_FOOTAGE_PURPOSES)[number];

/**
 * 采用方式：
 * - insert：可直接入片（MV 镜头 footage、数字人覆盖/回切、营销补充画面、漫剧空镜）
 * - reference：只作参考图（漫剧场景参考），不得直接入片
 * 漫剧只允许 reference 或 empty_shot（无人物空镜），见 assertStockUsageAllowed。
 */
export const STOCK_FOOTAGE_USAGES = ["insert", "reference", "empty_shot"] as const;
export type StockFootageUsage = (typeof STOCK_FOOTAGE_USAGES)[number];

export const PEXELS_LICENSE = {
  name: "Pexels License",
  url: "https://www.pexels.com/license/",
} as const;

/** 只允许从这些主机下载素材原文件；候选里客户端回传的地址一律不信任。 */
export const STOCK_FOOTAGE_DOWNLOAD_HOSTS = ["videos.pexels.com", "images.pexels.com"] as const;

export const STOCK_VIDEO_MAX_BYTES = 200 * 1024 * 1024;
export const STOCK_PHOTO_MAX_BYTES = 30 * 1024 * 1024;

export const stockFootageSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(100),
    kind: z.enum(STOCK_FOOTAGE_KINDS).default("video"),
    orientation: z.enum(STOCK_FOOTAGE_ORIENTATIONS).optional(),
    /** 视频时长筛选（秒）；照片忽略。 */
    minDurationSec: z.number().int().min(1).max(600).optional(),
    maxDurationSec: z.number().int().min(1).max(600).optional(),
    page: z.number().int().min(1).max(50).default(1),
    perPage: z.number().int().min(1).max(40).default(15),
    purpose: z.enum(STOCK_FOOTAGE_PURPOSES),
    /** Pexels locale，如 zh-CN / zh-TW / en-US。 */
    locale: z.string().trim().regex(/^[a-z]{2}-[A-Z]{2}$/).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.minDurationSec && v.maxDurationSec && v.minDurationSec > v.maxDurationSec)
      ctx.addIssue({ code: "custom", path: ["maxDurationSec"], message: "最长时长不能小于最短时长" });
  });
export type StockFootageSearchInput = z.input<typeof stockFootageSearchInputSchema>;
export type StockFootageSearchParams = z.output<typeof stockFootageSearchInputSchema>;

export const stockFootageAuthorSchema = z
  .object({ name: z.string().max(300), url: z.string().url().max(1000).optional() })
  .strict();

/** 搜索候选：只用于预览与挑选，不是可入片资产。 */
export type StockFootageCandidate = {
  provider: StockFootageProvider;
  providerAssetId: string;
  kind: StockFootageKind;
  pageUrl: string;
  previewImageUrl: string;
  /** 视频候选的低清预览（sd），用于 hover 预览；照片为空。 */
  previewVideoUrl?: string;
  width: number;
  height: number;
  durationSec?: number;
  author: { name: string; url?: string };
  alt?: string;
};

export type StockFootageSearchResult = {
  provider: StockFootageProvider;
  page: number;
  perPage: number;
  totalResults: number;
  hasMore: boolean;
  candidates: StockFootageCandidate[];
  /** 上游剩余配额（若响应头提供）。 */
  rateLimitRemaining?: number;
  cached: boolean;
};

export const stockFootageAdoptContextSchema = z
  .object({
    /** 业务项目/作品标识，仅作归属记录与筛选，不作权限依据。 */
    projectId: z.string().trim().min(1).max(200).optional(),
    shotId: z.string().trim().min(1).max(200).optional(),
    segmentId: z.string().trim().min(1).max(200).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const stockFootageAdoptInputSchema = z
  .object({
    /** 客户端生成并持久保存的幂等编号；断线后用同一编号查询/续做，不重复下载。 */
    requestId: z.string().uuid(),
    provider: z.enum(STOCK_FOOTAGE_PROVIDERS).default("pexels"),
    providerAssetId: z.string().trim().regex(/^\d{1,20}$/),
    kind: z.enum(STOCK_FOOTAGE_KINDS),
    purpose: z.enum(STOCK_FOOTAGE_PURPOSES),
    usage: z.enum(STOCK_FOOTAGE_USAGES).default("insert"),
    /** 画幅偏好：服务端据此从上游文件列表挑选，不接受客户端直接给下载地址。 */
    orientation: z.enum(STOCK_FOOTAGE_ORIENTATIONS).optional(),
    context: stockFootageAdoptContextSchema.default({}),
  })
  .strict()
  .superRefine((v, ctx) => {
    try {
      assertStockUsageAllowed(v.purpose, v.usage);
    } catch (error) {
      ctx.addIssue({ code: "custom", path: ["usage"], message: (error as Error).message });
    }
  });
export type StockFootageAdoptInput = z.input<typeof stockFootageAdoptInputSchema>;
export type StockFootageAdoptParams = z.output<typeof stockFootageAdoptInputSchema>;

export const stockFootageSourceEvidenceSchema = z
  .object({
    provider: z.enum(STOCK_FOOTAGE_PROVIDERS),
    providerAssetId: z.string(),
    pageUrl: z.string().url(),
    author: stockFootageAuthorSchema,
    license: z.object({ name: z.string(), url: z.string().url() }).strict(),
    /** 实际下载的上游文件地址（服务端从上游元数据取得）。 */
    downloadedFrom: z.string().url(),
    /** 上游文件标识（视频为 video_files[].id，照片为 src 键名）。 */
    providerFileId: z.string(),
    retrievedAt: z.string(),
  })
  .strict();
export type StockFootageSourceEvidence = z.infer<typeof stockFootageSourceEvidenceSchema>;

/** 已采用资产：本人永久 GCS + 来源证据。下游只认这个。 */
export const stockFootageAssetSchema = z
  .object({
    assetId: z.string().regex(/^sf_[0-9a-f]{48}$/),
    requestId: z.string().uuid(),
    kind: z.enum(STOCK_FOOTAGE_KINDS),
    purpose: z.enum(STOCK_FOOTAGE_PURPOSES),
    usage: z.enum(STOCK_FOOTAGE_USAGES),
    gcsUri: z.string().regex(/^gs:\/\/[^/]+\/.+/),
    mimeType: z.string(),
    bytes: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    /** 视频时长（秒，来自上游元数据）。 */
    durationSec: z.number().positive().optional(),
    source: stockFootageSourceEvidenceSchema,
    context: stockFootageAdoptContextSchema,
    adoptedAt: z.string(),
  })
  .strict();
export type StockFootageAsset = z.infer<typeof stockFootageAssetSchema>;

/** 带签名读地址的资产（API 响应用；签名地址会过期，持久化只存 gcsUri / assetId）。 */
export type StockFootageAssetView = StockFootageAsset & { url: string };

export type StockFootageAdoptionStatus = "running" | "succeeded" | "failed" | "reconcile_manual";
export type StockFootageAdoptionResponse = {
  assetId: string;
  requestId: string;
  status: StockFootageAdoptionStatus;
  message?: string;
  asset?: StockFootageAssetView;
};

export class StockUsageNotAllowedError extends Error {}

/** 用途 × 采用方式白名单。漫剧不能把图库素材当角色直接入片。 */
export function assertStockUsageAllowed(purpose: StockFootagePurpose, usage: StockFootageUsage): void {
  if (purpose === "manhua" && usage === "insert")
    throw new StockUsageNotAllowedError("漫剧只能把图库素材用作参考图或无人物空镜，不能替换既定角色直接入片");
  if (purpose !== "manhua" && usage === "empty_shot")
    throw new StockUsageNotAllowedError("空镜用法仅限漫剧");
}

/** 资产是否可直接进入时间线（参考图不能入片）。 */
export function isStockAssetInsertable(asset: Pick<StockFootageAsset, "usage">): boolean {
  return asset.usage === "insert" || asset.usage === "empty_shot";
}

export function isAllowedStockDownloadUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && (STOCK_FOOTAGE_DOWNLOAD_HOSTS as readonly string[]).includes(url.hostname);
  } catch {
    return false;
  }
}

/** 视频时长换帧（MV 30fps 时间线用），向下取整避免裁点越界。 */
export function stockDurationFrames(durationSec: number, fps = 30): number {
  return Math.max(0, Math.floor(durationSec * fps));
}

/** 按画幅判定候选是否匹配（square 容忍 ±10%）。 */
export function matchesOrientation(width: number, height: number, orientation?: StockFootageOrientation): boolean {
  if (!orientation || width <= 0 || height <= 0) return true;
  const ratio = width / height;
  if (orientation === "landscape") return ratio > 1.1;
  if (orientation === "portrait") return ratio < 0.9;
  return ratio >= 0.9 && ratio <= 1.1;
}

export const STOCK_FOOTAGE_PURPOSE_LABEL: Record<StockFootagePurpose, string> = {
  mv: "MV 镜头",
  digital_human: "数字人补充画面",
  marketing: "营销/知识口播",
  manhua: "漫剧参考/空镜",
};

/** 署名文案（导出、图注、成片说明统一使用）。 */
export function stockAttributionText(source: Pick<StockFootageSourceEvidence, "provider" | "author">): string {
  const provider = source.provider === "pexels" ? "Pexels" : source.provider;
  return `${source.author.name} / ${provider}`;
}
