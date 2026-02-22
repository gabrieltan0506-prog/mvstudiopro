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
      "虛擬偶像生成（前 3 個免費）",
      "分镜脚本生成（不限字数）",
      "分鏡圖生成（每次最多 10 張，含浮水印）",
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
  // ─── 基础功能 ───────────────────────────────────
  mvAnalysis: 8,
  idolGeneration: 3,
  storyboard: 15,
  forgeImage: 0,

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
} as const;

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
  small: {
    credits: 50,
    price: 35,
    label: "50 Credits",
    labelCn: "50 Credits 入门包",
    perCredit: 0.70,
    discount: "",
  },
  medium: {
    credits: 100,
    price: 68,
    label: "100 Credits",
    labelCn: "100 Credits 高端包",
    perCredit: 0.68,
    discount: "省 2.9%",
  },
  large: {
    credits: 250,
    price: 168,
    label: "250 Credits",
    labelCn: "250 Credits 超值包",
    perCredit: 0.672,
    discount: "省 4%",
  },
  mega: {
    credits: 500,
    price: 328,
    label: "500 Credits",
    labelCn: "500 Credits 专业包",
    perCredit: 0.656,
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

/**
 * 导演包定义
 *
 * 初级导演包：Forge 免费脚本生成 + 分镜转视频 + Suno V4 配乐
 * 高级导演包：Gemini 脚本生成 + 分镜转视频 + Suno V5 配乐
 */
export type DirectorPackType = "junior" | "senior";

export interface DirectorPackConfig {
  name: string;
  nameCn: string;
  nameEn: string;
  description: string;
  descriptionCn: string;
  totalCredits: number;
  savings: number;
  includes: {
    scriptEngine: "forge" | "gemini";
    scriptCredits: number;
    storyboardToVideo: boolean;
    videoCredits: number;
    musicEngine: "v4" | "v5";
    musicCredits: number;
  };
  features: string[];
  featuresCn: string[];
}

export const DIRECTOR_PACKS: Record<DirectorPackType, DirectorPackConfig> = {
  junior: {
    name: "Junior Director Pack",
    nameCn: "初级导演包",
    nameEn: "Junior Director Pack",
    description: "Free script generation with Forge AI, storyboard-to-video conversion, and Suno V4 background music",
    descriptionCn: "Forge AI 免费脚本生成 + 分镜转视频 + Suno V4 配乐",
    totalCredits: 62,
    savings: 0,
    includes: {
      scriptEngine: "forge",
      scriptCredits: 0,
      storyboardToVideo: true,
      videoCredits: 50,
      musicEngine: "v4",
      musicCredits: 12,
    },
    features: [
      "Free Script Generation",
      "Storyboard to Video Conversion",
      "Suno V4 Background Music",
    ],
    featuresCn: [
      "免費腳本生成",
      "分镜转视频",
      "Suno V4 配乐",
    ],
  },
  senior: {
    name: "Senior Director Pack",
    nameCn: "高级导演包",
    nameEn: "Senior Director Pack",
    description: "Gemini AI script generation, storyboard-to-video conversion, and Suno V5 premium music",
    descriptionCn: "Gemini AI 脚本生成 + 分镜转视频 + Suno V5 高品质配乐",
    totalCredits: 77,
    savings: 0,
    includes: {
      scriptEngine: "gemini",
      scriptCredits: 5,
      storyboardToVideo: true,
      videoCredits: 50,
      musicEngine: "v5",
      musicCredits: 22,
    },
    features: [
      "Gemini AI Script Generation",
      "Storyboard to Video Conversion",
      "Suno V5 Premium Music",
    ],
    featuresCn: [
      "Gemini AI 脚本生成",
      "分镜转视频",
      "Suno V5 高品质配乐",
    ],
  },
};

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
      "虛擬偶像 2D 生成（無限）",
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
      "虛擬偶像 2D 生成（無限）",
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
