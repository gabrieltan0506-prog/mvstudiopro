/**
 * MV Studio Pro 方案定义
 *
 * 包含 Free / Pro / Enterprise 三个方案的配置，
 * Credits 消耗定价，以及 Credits 加值包定义。
 *
 * NBP (Nano Banana Pro) 集成：
 * - 免费用户：Forge AI 免费生图（有水印），最多 10 个分镜/次
 * - Pro 用户：NBP 2K（有水印），最多 30 个分镜/次，第 25 个提醒升级
 * - Enterprise 用户：NBP 2K/4K（无水印），最多 70 个分镜/次
 * - Credits 不足时自动降级到 Forge AI（有水印）
 */

export type PlanType = "free" | "pro" | "enterprise";

export interface PlanConfig {
  name: string;
  nameCn: string;
  monthlyPrice: number;
  yearlyPrice: number;
  monthlyCredits: number;
  features: string[];
  featuresCn: string[];
  limits: {
    mvAnalysis: number;           // 视频 PK 评分次数/月
    idolGeneration: number;       // 虚拟偶像生成次数/月
    storyboard: number;           // 分镜脚本生成次数/月
    videoGeneration: number;      // 视频生成次数/月
    idol3D: number;               // 偶像图片转 3D 次数/月
    storyboardImages: number;     // 每次分镜图生成上限
    storyboardImageUpgradeAt: number; // 第几张时提醒升级（0=不提醒）
  };
  nbp: {
    enabled: boolean;             // 是否可用 NBP
    maxResolution: "none" | "2k" | "4k"; // 最高可用分辨率
    watermark: boolean;           // 是否加水印
  };
}

export const PLANS: Record<PlanType, PlanConfig> = {
  free: {
    name: "Free",
    nameCn: "免费版",
    monthlyPrice: 0,
    yearlyPrice: 0,
    monthlyCredits: 50,
    features: [
      "Video PK Rating (first 2 free)",
      "Virtual Idol Generation (first 3 free)",
      "Storyboard Script (unlimited text, no char limit)",
      "Storyboard Images (up to 10/session, watermarked)",
      "Video Gallery Browsing",
      "Basic Community Features",
    ],
    featuresCn: [
      "视频 PK 评分（前 2 次免费）",
      "虚拟偶像生成（前 3 个免费）",
      "分镜脚本生成（不限字数）",
      "分镜图生成（每次最多 10 张，含水印）",
      "视频展厅浏览",
      "基础社区功能",
    ],
    limits: {
      mvAnalysis: 2,
      idolGeneration: 3,
      storyboard: -1,
      videoGeneration: 0,
      idol3D: 0,
      storyboardImages: 10,
      storyboardImageUpgradeAt: 0,
    },
    nbp: {
      enabled: false,
      maxResolution: "none",
      watermark: true,
    },
  },
  pro: {
    name: "Pro",
    nameCn: "初级会员",
    monthlyPrice: 108,
    yearlyPrice: 1036,
    monthlyCredits: 200,
    features: [
      "All Free features",
      "Unlimited Video PK Rating",
      "Unlimited Virtual Idol Generation",
      "NBP 2K Storyboard Images (up to 30/session, watermarked)",
      "NBP 2K Virtual Idol Generation",
      "Video Generation",
      "Idol Image to 3D",
      "PDF Report Export",
      "Priority Processing Queue",
      "200 Credits/month",
    ],
    featuresCn: [
      "所有免费版功能",
      "无限视频 PK 评分",
      "无限虚拟偶像生成",
      "NBP 2K 分镜图（每次最多 30 张，含水印）",
      "NBP 2K 虚拟偶像生成",
      "视频生成",
      "偶像图片转 3D",
      "PDF 报告导出",
      "优先处理队列",
      "每月 200 Credits",
    ],
    limits: {
      mvAnalysis: -1,
      idolGeneration: -1,
      storyboard: -1,
      videoGeneration: -1,
      idol3D: -1,
      storyboardImages: 30,
      storyboardImageUpgradeAt: 25,
    },
    nbp: {
      enabled: true,
      maxResolution: "2k",
      watermark: true,
    },
  },
  enterprise: {
    name: "Enterprise",
    nameCn: "高级会员",
    monthlyPrice: 358,
    yearlyPrice: 3437,
    monthlyCredits: 800,
    features: [
      "All Pro features",
      "NBP 2K/4K Storyboard Images (up to 70/session, no watermark)",
      "NBP 2K/4K Virtual Idol Generation (no watermark)",
      "API Access",
      "White-label License",
      "Dedicated Support",
      "Team Seats",
      "Custom Branding",
      "800 Credits/month",
      "Invoice Payment",
    ],
    featuresCn: [
      "所有初级会员功能",
      "NBP 2K/4K 分镜图（每次最多 70 张，无水印）",
      "NBP 2K/4K 虚拟偶像生成（无水印）",
      "API 访问",
      "白标授权",
      "专属客服",
      "团队席位",
      "自订品牌",
      "每月 800 Credits",
      "发票付款",
    ],
    limits: {
      mvAnalysis: -1,
      idolGeneration: -1,
      storyboard: -1,
      videoGeneration: -1,
      idol3D: -1,
      storyboardImages: 70,
      storyboardImageUpgradeAt: 0,
    },
    nbp: {
      enabled: true,
      maxResolution: "4k",
      watermark: false,
    },
  },
};

/**
 * Credits 消耗定价
 *
 * NBP 图片生成成本：
 * - NBP 2K: API 成本 ~$0.15/张 → 5 credits
 * - NBP 4K: API 成本 ~$0.27/张 → 9 credits
 * - Forge AI: 免费（平台内置）→ 0 credits
 */
export const CREDIT_COSTS = {
  // ─── 创作者成长营 / 平台趋势 / 大师级视频基地（与 server/plans 数值一致，供前端定价展示与扣费逻辑共用）─
  growthCampGrowth: 40,
  growthCampRemix: 50,
  platformTrend: 50,
  platformTrendFollowUp: 18,
  workflowNodes: 20,
  workflowScript: 0,
  workflowScriptExtra: 2,
  workflowStoryboard: 5,
  workflowSceneImage: 5,
  workflowRenderStill: 9,
  workflowSceneVideo: 80,
  workflowSceneVoice: 5,
  workflowMusic: 12,
  workflowFinalRender: 5,

  // ─── 基础功能 ───────────────────────────────────
  mvAnalysis: 8,
  idolGeneration: 3,
  storyboard: 15,
  storyboardFlash: 8,
  storyboardGpt5: 20,
  forgeImage: 3,

  // ─── AI 文本生成（Gemini）─────────────────────
  aiInspiration: 5,
  /** @deprecated use aiInspiration */
  inspiration: 5,

  // ─── NBP 图片生成 ────────────────────────────
  nbpImage2K: 5,
  nbpImage4K: 9,
  /** @deprecated use nbpImage2K */
  storyboardImage2K: 5,
  /** @deprecated use nbpImage4K */
  storyboardImage4K: 9,

  // ─── 2D 转 3D（Hunyuan3D v3.1）────────────────
  rapid3D: 5,
  rapid3D_pbr: 8,
  pro3D: 9,
  pro3D_pbr: 12,
  pro3D_pbr_mv: 15,
  pro3D_full: 18,
  /** @deprecated use rapid3D / pro3D */
  idol3D: 10,
  idol3DRapid: 5,
  idol3DPro: 9,

  // ─── 高级功能（Credits 设高，限制使用）────────
  videoGeneration: 50,
  videoGenerationFast720: 15,
  videoGenerationFast1080: 25,
  videoGenerationStd720: 30,
  videoGenerationStd1080: 50,

  // ─── Suno 音乐生成 ────────────────────
  sunoMusicV4: 12,
  sunoMusicV5: 22,
  sunoLyrics: 3,

  // ─── 音频分析 ────────────────────────────
  audioAnalysis: 10,

  // ─── Kling 视频生成（最高门槛）────────────────
  klingVideo: 80,
  klingLipSync: 60,

  // ─── Kling 图片（与 server/plans 一致）──────────
  klingImageO1_1K: 8,
  klingImageO1_2K: 10,
  klingImageV2_1K: 5,
  klingImageV2_2K: 7,

  // ─── 平台趋势·参考图 / 生图（与 server/plans 一致 · 扣点 3× 慎用完）────────────
  platformRefImage: 36,
  /** 平台页：选题单帧 · 图文/小红书竖版封面（GPT-IMAGE-2）；单张「生成封面」统一走此价 */
  platformTopicFrameGraphic: 48,
  /**
   * Skill 问答栏·单页生图「账号生涯首张」九折价（相对 {@link platformTopicFrameGraphic}）。
   * 第二张起恢复封面原价。
   */
  platformSkillQaImageFirst: 43,
  /** 短视频向·分镜 2×4 宽幅 **60**（`storyboard_sheet_*`，非图文笔记八格） */
  platformStoryboardSheet: 60,
  /** 图文笔记·小红书 2×4 八格 **72**（`xiaohongshu_dual_note`，非分镜主表） */
  platformXhsDualNote: 72,
  /** 单页连贯图文知识卡片 **25/篇**（`single_page_knowledge_card`，自定义文案）；上篇+下篇合计 50 */
  platformSinglePageKnowledgeCard: 25,
  /** 自定义文案 · 深度优化（纯 LLM，无出图；GPT-5.5 结构化改写） */
  platformOptimizeCustomCopy: 25,
  /** 自定义抠像·单张原价（GPT-IMAGE-2 场景/主体图；去背景为白底主体直出）；2 张九折、4 张八折 */
  platformCustomMattingImage: 32,
  /** 3×4 十二格分镜 **120**（`storyboard_sheet_landscape` + gridVariant=3x4）；后端分 2 段生成拼接 */
  platformStoryboardSheet3x4: 120,
  /** 3×4 十二格图文 **144**（`xiaohongshu_dual_note` + gridVariant=3x4）；后端分 2 段生成拼接 */
  platformXhsDualNote3x4: 144,
  /**
   * @deprecated 单条封面+分镜请用 {@link platformCoverCompositeBundleCreditsForFormat} 动态九折价；保留键供旧数据/文档兼容。
   */
  platformTopicCoverAndCompositeBundle: 388,
  /** @deprecated 批量 2×4 请用 {@link platformCompositeBundleTotalCredits}（54×选题数）；保留键供旧数据/文档兼容。 */
  platformCompositeBulkFourTopics: 238,
  /** 平台页增值：个性化战略地图／决策智库报告，之后每次原价 */
  decisionIntelligenceReport: 200,
  /** 同功能首次体验优惠价（与 decisionIntelligenceReport 搭配后端计次） */
  decisionIntelligenceReportFirst: 150,
  /** 平台页：全案流程之专属选题与长文案／分镜稿（platform_build_content · 任务入队时扣费） */
  platformStage2Copywriting: 60,
  /** 战略地图：同一选题第二次起「重新生成文案」 */
  decisionIntelTopicExecutionCopyRegenerate: 20,
} as const;

/** Skill 问答：每日免费次数上限（登录用户） */
export const PLATFORM_SKILL_QA_DAILY_FREE_LIMIT = 30;

/**
 * Skill 问答栏单页生图积分：账号生涯第 1 张九折，之后封面原价。
 * @param priorImageCount 已成功记入 platformSkillQaImage 的次数
 */
export function platformSkillQaImageCredits(priorImageCount: number): {
  cost: number;
  isFirstDiscount: boolean;
} {
  const prior = Math.max(0, Math.floor(Number(priorImageCount) || 0));
  if (prior <= 0) {
    return { cost: CREDIT_COSTS.platformSkillQaImageFirst, isFirstDiscount: true };
  }
  return { cost: CREDIT_COSTS.platformTopicFrameGraphic, isFirstDiscount: false };
}

/** 自定义抠像可选比例 */
export const PLATFORM_MATTING_ASPECT_RATIOS = ["9:16", "16:9", "3:4", "4:3", "21:9"] as const;
export type PlatformMattingAspectRatio = (typeof PLATFORM_MATTING_ASPECT_RATIOS)[number];

/** 自定义抠像一次生成张数 */
export const PLATFORM_MATTING_BATCH_COUNTS = [1, 2, 4] as const;
export type PlatformMattingBatchCount = (typeof PLATFORM_MATTING_BATCH_COUNTS)[number];

/** 自定义抠像合计积分：1 张原价；2 张九折；4 张八折 */
export function platformCustomMattingTotalCredits(count: PlatformMattingBatchCount): number {
  const unit = CREDIT_COSTS.platformCustomMattingImage;
  if (count === 1) return unit;
  if (count === 2) return Math.round(unit * 2 * 0.9);
  return Math.round(unit * 4 * 0.8);
}

/** 素材视觉分析合计积分：按张计费（与 {@link CREDIT_COSTS.growthCampGrowth} 同价） */
export function platformAssetAnalysisTotalCredits(imageCount: number, videoCount = 0): number {
  const images = Math.max(0, Math.floor(Number(imageCount) || 0));
  const videos = Math.max(0, Math.floor(Number(videoCount) || 0));
  const total = images + videos;
  if (total <= 0) return 0;
  return total * CREDIT_COSTS.growthCampGrowth;
}

/** 一键套装·九折文案（按钮/说明统一后缀） */
export const PLATFORM_BUNDLE_NINE_DISCOUNT_LABEL = "（九折优惠）";

/** 封面套装单价（散买 {@link CREDIT_COSTS.platformTopicFrameGraphic} 为 48） */
export const PLATFORM_COVER_BUNDLE_UNIT_CREDITS = 40;

/** 2×4/八格套装单价（散买短视频 60 · 图文/小红书 72） */
export const PLATFORM_COMPOSITE_BUNDLE_UNIT_CREDITS = 54;

export const PLATFORM_BUNDLE_NINE_DISCOUNT = 0.9;

export function platformIsGraphicTopicFormat(format: string): boolean {
  return format === "图文" || format === "小红书";
}

export function platformCompositeSingleCreditsForFormat(format: string): number {
  return platformIsGraphicTopicFormat(format)
    ? CREDIT_COSTS.platformXhsDualNote
    : CREDIT_COSTS.platformStoryboardSheet;
}

function normalizePlatformBundleTopicCount(topicCount: number): number {
  const n = Math.floor(Number(topicCount));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

/** 一键封面套装合计：40 × 选题数（无选题时返回 0，供页面初始态展示） */
export function platformCoverBundleTotalCredits(topicCount: number): number {
  const n = normalizePlatformBundleTopicCount(topicCount);
  return n * PLATFORM_COVER_BUNDLE_UNIT_CREDITS;
}

/** 一键分镜/八格套装合计：54 × 选题数（无选题时返回 0） */
export function platformCompositeBundleTotalCredits(topicCount: number): number {
  const n = normalizePlatformBundleTopicCount(topicCount);
  return n * PLATFORM_COMPOSITE_BUNDLE_UNIT_CREDITS;
}

/** 分镜套装单条九折单价（按 2×4 / 3×4 档位）：2×4→round(60×0.9)=54；3×4→round(120×0.9)=108 */
export function platformCompositeBundleUnitCreditsForGrid(is3x4: boolean): number {
  const base = is3x4 ? CREDIT_COSTS.platformStoryboardSheet3x4 : CREDIT_COSTS.platformStoryboardSheet;
  return Math.round(base * PLATFORM_BUNDLE_NINE_DISCOUNT);
}

/** 一键分镜/八格套装合计（含 3×4 档位）：单条九折单价 × 选题数 */
export function platformCompositeBundleTotalCreditsForGrid(topicCount: number, is3x4: boolean): number {
  const n = normalizePlatformBundleTopicCount(topicCount);
  return n * platformCompositeBundleUnitCreditsForGrid(is3x4);
}

export function platformCoverCompositeBundleCreditsForCompositeKind(
  kind: "storyboard_sheet_portrait" | "storyboard_sheet_landscape" | "xiaohongshu_dual_note",
): number {
  return platformCoverCompositeBundleCreditsForFormat(
    kind === "xiaohongshu_dual_note" ? "小红书" : "短视频",
  );
}

/** 单条「封面+分镜」套装（按 compositeKind + 2×4/3×4 档位）九折价 */
export function platformCoverCompositeBundleCreditsForCompositeKindGrid(
  kind: "storyboard_sheet_portrait" | "storyboard_sheet_landscape" | "xiaohongshu_dual_note",
  is3x4: boolean,
): number {
  return platformCoverCompositeBundleCreditsForFormatGrid(
    kind === "xiaohongshu_dual_note" ? "小红书" : "短视频",
    is3x4,
  );
}

/** 自定义选题工作台：按勾选的封面/分镜合计积分（文案另计；两项同时勾选走九折套装价） */
export function platformCustomTopicImageCredits(opts: {
  includeCover: boolean;
  includeStoryboard: boolean;
  is3x4: boolean;
}): number {
  const { includeCover, includeStoryboard, is3x4 } = opts;
  if (!includeCover && !includeStoryboard) return 0;
  if (includeCover && includeStoryboard) {
    return platformCoverCompositeBundleCreditsForFormatGrid("短视频", is3x4);
  }
  let cost = 0;
  if (includeCover) cost += CREDIT_COSTS.platformTopicFrameGraphic;
  if (includeStoryboard) {
    cost += is3x4 ? CREDIT_COSTS.platformStoryboardSheet3x4 : CREDIT_COSTS.platformStoryboardSheet;
  }
  return cost;
}

/** 单条「封面+分镜」套装：（48 + 60|72）× 九折 */
export function platformCoverCompositeBundleCreditsForFormat(format: string): number {
  const cover = CREDIT_COSTS.platformTopicFrameGraphic;
  const composite = platformCompositeSingleCreditsForFormat(format);
  return Math.round((cover + composite) * PLATFORM_BUNDLE_NINE_DISCOUNT);
}

/** 单条体裁的合成价（含 2×4 / 3×4 十二格档位） */
export function platformCompositeSingleCreditsForFormatGrid(format: string, is3x4: boolean): number {
  if (platformIsGraphicTopicFormat(format)) {
    return is3x4 ? CREDIT_COSTS.platformXhsDualNote3x4 : CREDIT_COSTS.platformXhsDualNote;
  }
  return is3x4 ? CREDIT_COSTS.platformStoryboardSheet3x4 : CREDIT_COSTS.platformStoryboardSheet;
}

/** 单条「封面+分镜」套装（含 3×4 档位）：（48 + 合成价[按 2×4/3×4]）× 九折 */
export function platformCoverCompositeBundleCreditsForFormatGrid(format: string, is3x4: boolean): number {
  const cover = CREDIT_COSTS.platformTopicFrameGraphic;
  const composite = platformCompositeSingleCreditsForFormatGrid(format, is3x4);
  return Math.round((cover + composite) * PLATFORM_BUNDLE_NINE_DISCOUNT);
}

/** 批量「封面+分镜」套装合计（按每条体裁分别九折后相加） */
export function platformCoverCompositeBulkBundleTotalCredits(
  topics: ReadonlyArray<{ format: string }>,
): number {
  let sum = 0;
  for (const t of topics) {
    sum += platformCoverCompositeBundleCreditsForFormat(t.format);
  }
  return sum;
}

/** 批量「封面+分镜」套装合计（含 2×4 / 3×4 档位，按每条体裁分别九折后相加） */
export function platformCoverCompositeBulkBundleTotalCreditsForGrid(
  topics: ReadonlyArray<{ format: string }>,
  is3x4: boolean,
): number {
  let sum = 0;
  for (const t of topics) {
    sum += platformCoverCompositeBundleCreditsForFormatGrid(t.format, is3x4);
  }
  return sum;
}

/** 套装总价按序整数分拆到 N 次扣费（各次相加等于 totalCredits） */
export function platformBundleCreditsForSlot(
  totalCredits: number,
  slotIndex: number,
  topicCount: number,
): number {
  if (!Number.isInteger(totalCredits) || totalCredits < 0) {
    throw new RangeError("platformBundleCreditsForSlot: totalCredits must be non-negative integer");
  }
  if (!Number.isInteger(topicCount) || topicCount < 1) {
    throw new RangeError("platformBundleCreditsForSlot: topicCount must be integer >= 1");
  }
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= topicCount) {
    throw new RangeError("platformBundleCreditsForSlot: slotIndex out of range");
  }
  const base = Math.floor(totalCredits / topicCount);
  const rem = totalCredits - base * topicCount;
  return base + (slotIndex < rem ? 1 : 0);
}

/** @deprecated 请用 {@link platformBundleCreditsForSlot} + {@link platformCompositeBundleTotalCredits} */
export function platformCompositeBulkFourSlotCredits(slotIndex: number): number {
  return platformBundleCreditsForSlot(
    platformCompositeBundleTotalCredits(4),
    slotIndex,
    4,
  );
}

/** 允许作为「原图生成单价」基准的 CREDIT_COSTS 键（用于 Imagen 高清放大计费） */
export const IMAGE_UPSCALE_BASE_CREDIT_KEYS = [
  "nbpImage2K",
  "nbpImage4K",
  "forgeImage",
  "workflowSceneImage",
  "workflowRenderStill",
  "idolGeneration",
  "klingImageO1_1K",
  "klingImageO1_2K",
  "klingImageV2_1K",
  "klingImageV2_2K",
  "platformRefImage",
] as const;

export type ImageUpscaleBaseCreditKey = (typeof IMAGE_UPSCALE_BASE_CREDIT_KEYS)[number];

/** 相对原图单价：2× = 3 倍积分，4× = 5 倍积分 */
export const IMAGE_UPSCALE_FACTOR_CREDIT_MULTIPLIERS = { x2: 3, x4: 5 } as const;

/** 固定 upscale 成本覆盖（优先于乘数公式） */
export const UPSCALE_COST_OVERRIDES: Partial<
  Record<ImageUpscaleBaseCreditKey, Record<keyof typeof IMAGE_UPSCALE_FACTOR_CREDIT_MULTIPLIERS, number>>
> = {
  platformRefImage: { x2: 108, x4: 144 },
};

export function imageUpscaleTotalCredits(
  baseKey: ImageUpscaleBaseCreditKey,
  factor: keyof typeof IMAGE_UPSCALE_FACTOR_CREDIT_MULTIPLIERS,
): number {
  const override = UPSCALE_COST_OVERRIDES[baseKey];
  if (override) return override[factor];
  const base = CREDIT_COSTS[baseKey];
  const mult = IMAGE_UPSCALE_FACTOR_CREDIT_MULTIPLIERS[factor];
  return base * mult;
}

/** Upscale 扣费区间（随原图生成单价基准变化，仅用于展示） */
export function imageUpscaleCreditRangeHint(
  factor: keyof typeof IMAGE_UPSCALE_FACTOR_CREDIT_MULTIPLIERS,
): { min: number; max: number } {
  const mult = IMAGE_UPSCALE_FACTOR_CREDIT_MULTIPLIERS[factor];
  const bases = IMAGE_UPSCALE_BASE_CREDIT_KEYS.map((k) => CREDIT_COSTS[k]);
  return { min: Math.min(...bases) * mult, max: Math.max(...bases) * mult };
}

/** 试用包标价与到账积分（积分数由内部规则从标价推导，前台不展示单价换算） */
export const TRIAL_PACK_199_PRICE_CNY = 19.9 as const;
const TRIAL_PACK_199_CREDITS_DIVISOR = 0.6 as const;
export const TRIAL_PACK_199_CREDITS = Math.floor(TRIAL_PACK_199_PRICE_CNY / TRIAL_PACK_199_CREDITS_DIVISOR);

/** 静态收款「¥19.9 试用包」每人最多可购买次数（含待审核订单占用名额） */
export const TRIAL_PACK_199_MAX_PURCHASES_PER_USER = 2 as const;

/** PK 评分奖励等级：根据综合评分给予不同 Credits 奖励 */
export const PK_REWARD_TIERS = [
  { minScore: 90, credits: 25, label: "精品级", labelCn: "精品级", emoji: "\u{1F3C6}" },
  { minScore: 80, credits: 15, label: "优秀级", labelCn: "优秀级", emoji: "\u{1F31F}" },
  { minScore: 0,  credits: 0,  label: "继续加油", labelCn: "继续加油", emoji: "\u{1F4AA}" },
] as const;

/** 根据综合评分获取对应的奖励等级 */
export function getRewardTier(overallScore: number) {
  return PK_REWARD_TIERS.find(t => overallScore >= t.minScore) ?? PK_REWARD_TIERS[PK_REWARD_TIERS.length - 1];
}

/**
 * Credits 加值包
 */
export const CREDIT_PACKS = {
  trial199: {
    credits: TRIAL_PACK_199_CREDITS,
    price: TRIAL_PACK_199_PRICE_CNY,
    label: `${TRIAL_PACK_199_CREDITS} Credits Trial`,
    labelCn: "¥19.9 试用包",
    discount: `${TRIAL_PACK_199_CREDITS} Credits · 每人限 ${TRIAL_PACK_199_MAX_PURCHASES_PER_USER} 次`,
  },
  small: {
    credits: 50,
    price: 35,
    label: "50 Credits",
    labelCn: "50 Credits 入门包",
    discount: "",
  },
  medium: {
    credits: 100,
    price: 68,
    label: "100 Credits",
    labelCn: "100 Credits 高端包",
    discount: "省 2.9%",
  },
  large: {
    credits: 250,
    price: 168,
    label: "250 Credits",
    labelCn: "250 Credits 超值包",
    discount: "省 4%",
  },
  mega: {
    credits: 500,
    price: 328,
    label: "500 Credits",
    labelCn: "500 Credits 专业包",
    discount: "省 6.3%",
  },
} as const;

/**
 * 单次购买包（不需要订阅）
 */
export const SINGLE_PURCHASE = {
  storyboardImages: {
    count: 10,
    price: 64,
    label: "10 Storyboard Images",
    labelCn: "10 张分镜图",
    description: "One-time purchase of 10 NBP 2K/4K storyboard images",
    descriptionCn: "单次购买 10 张 NBP 2K/4K 分镜图",
  },
} as const;

/** 对外用：仅以积分加值包为准的定价展示行（不含单项功能拆价） */
export type ProductPackageDisplayRow = {
  category: string;
  name: string;
  credits: number | null;
  priceCny: number | null;
  summary: string;
  bullets: string[];
};

const CREDIT_PACK_ORDER = ["trial199", "small", "medium", "large", "mega"] as const;

export function getProductPackageDisplayRows(): ProductPackageDisplayRow[] {
  return CREDIT_PACK_ORDER.map((id): ProductPackageDisplayRow => {
    const p = CREDIT_PACKS[id];
    const price = p.price;
    return {
      category: "积分加值包",
      name: p.labelCn,
      credits: p.credits,
      priceCny: typeof price === "number" ? price : Number(price),
      summary: p.discount || `${p.credits} Credits`,
      bullets: [],
    };
  });
}

/**
 * 学生版方案定义
 */
export type StudentPlanType = "student_trial" | "student_6months" | "student_1year";

export interface StudentPlanConfig {
  name: string;
  nameCn: string;
  price: number;
  durationMonths: number;
  durationDays?: number;
  features: string[];
  featuresCn: string[];
  limits: {
    mvAnalysis: number;
    storyboard: number;
    idolGeneration: number;
    idol3D: number;
    lipSync: number;
    videoGeneration: number;
    storyboardImages: number;
  };
  restrictions?: {
    maxVideoResolution?: "720p" | "1080p" | "4k";
  };
}

export const STUDENT_PLANS: Record<StudentPlanType, StudentPlanConfig> = {
  student_trial: {
    name: "Student Trial",
    nameCn: "学生试用版",
    price: 0,
    durationMonths: 0,
    durationDays: 2,
    features: [
      "Video PK Rating (2 total)",
      "Storyboard Script (1 total)",
      "2D Virtual Idol Generation (3 total)",
      "2D to 3D Idol Conversion (1 total)",
      "Video Generation (1 total, 720P only)",
      "Video Gallery Browsing (unlimited)",
    ],
    featuresCn: [
      "视频 PK 评分（2 次）",
      "分镜脚本生成（1 次）",
      "虚拟偶像 2D 生成（3 个）",
      "偶像 2D 转 3D（1 次）",
      "视频生成（1 次，限 720P）",
      "视频展厅浏览（无限）",
    ],
    limits: {
      mvAnalysis: 2,
      storyboard: 1,
      idolGeneration: 3,
      idol3D: 1,
      lipSync: 0,
      videoGeneration: 1,
      storyboardImages: 5,
    },
    restrictions: { maxVideoResolution: "720p" },
  },
  student_6months: {
    name: "Student 6-Month",
    nameCn: "学生半年版",
    price: 138,
    durationMonths: 6,
    features: [
      "Video PK Rating (5/month)",
      "Storyboard Script (3/month)",
      "2D Virtual Idol Generation (unlimited)",
      "Video Gallery Browsing (unlimited)",
      "Basic Community Features",
    ],
    featuresCn: [
      "视频 PK 评分（每月 5 次）",
      "分镜脚本生成（每月 3 次）",
      "虚拟偶像 2D 生成（无限）",
      "视频展厅浏览（无限）",
      "基础社区功能",
    ],
    limits: {
      mvAnalysis: 5,
      storyboard: 3,
      idolGeneration: -1,
      idol3D: 0,
      lipSync: 0,
      videoGeneration: 0,
      storyboardImages: 10,
    },
  },
  student_1year: {
    name: "Student 1-Year",
    nameCn: "学生一年版",
    price: 268,
    durationMonths: 12,
    features: [
      "Video PK Rating (15/month)",
      "Storyboard Script (8/month)",
      "2D Virtual Idol Generation (unlimited)",
      "2D to 3D Idol Conversion (3/month)",
      "Lip-Sync (5/month)",
      "Video Generation (2/month)",
      "Video Gallery + Creation Tools (unlimited)",
      "Priority Support",
    ],
    featuresCn: [
      "视频 PK 评分（每月 15 次）",
      "分镜脚本生成（每月 8 次）",
      "虚拟偶像 2D 生成（无限）",
      "虚拟偶像 2D 转 3D（每月 3 次）",
      "口型同步（每月 5 次）",
      "视频生成（每月 2 次）",
      "视频展厅 + 创作工具（无限）",
      "优先客服支持",
    ],
    limits: {
      mvAnalysis: 15,
      storyboard: 8,
      idolGeneration: -1,
      idol3D: 3,
      lipSync: 5,
      videoGeneration: 2,
      storyboardImages: 15,
    },
  },
};

/**
 * 维度系列 · 3D 专属收费包
 */
export const DIMENSION_PACKS = [
  { name: "维度·体验包", subtitle: "新用户专享", contents: "闪电 3D × 3 次", price: "免费", discount: "", color: "#30D158" },
  { name: "维度·探索包", subtitle: "入门创作", contents: "闪电 3D × 10 + 精雕 3D × 2", price: "¥58", discount: "约 85 折", color: "#64D2FF" },
  { name: "维度·创作包", subtitle: "进阶创作", contents: "闪电 3D × 20 + 精雕 3D × 10（含 PBR）", price: "¥168", discount: "约 75 折", color: "#C77DBA", popular: true },
  { name: "维度·大师包", subtitle: "专业制作", contents: "精雕 3D × 30（含 PBR）+ 多视角 × 10", price: "¥358", discount: "约 70 折", color: "#FFD60A" },
  { name: "维度·工作室包", subtitle: "团队/企业", contents: "精雕 3D × 100（全选项）", price: "¥888", discount: "约 65 折", color: "#FF6B6B" },
] as const;
