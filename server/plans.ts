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
    nameCn: "入門版",
    monthlyPrice: 0,
    yearlyPrice: 0,
    monthlyCredits: 50,
    features: [
      "Video PK Rating (first 2 free)",
      "Virtual Idol Generation (first 3 free, Forge AI)",
      "Storyboard Script (unlimited text, no char limit)",
      "Storyboard Images (Forge AI, up to 10/session, watermarked)",
      "Video Gallery Browsing",
      "Basic Community Features",
    ],
    featuresCn: [
      "視頻 PK 評分（前 2 次 0 Credits）",
      "虛擬偶像生成（前 3 個 0 Credits，Forge AI）",
      "分镜脚本生成（不限字数）",
      "分镜图生成（Forge AI，每次最多 10 张，含水印）",
      "视频展厅浏览",
      "基础社区功能",
    ],
    limits: {
      mvAnalysis: 2,
      idolGeneration: 3,
      storyboard: -1,             // 文本脚本不限次数
      videoGeneration: 0,
      idol3D: 0,
      storyboardImages: 10,       // 每次最多 10 张分镜图
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
    monthlyPrice: 108,              // ¥108/月
    yearlyPrice: 1036,              // 年付（¥86/月，省 20%）
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
      "所有入門版功能",
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
      storyboardImages: 30,       // 每次最多 30 张分镜图
      storyboardImageUpgradeAt: 25, // 第 25 张时提醒升级
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
    monthlyPrice: 358,              // ¥358/月
    yearlyPrice: 3437,              // 年付（¥286/月，省 20%）
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
      storyboardImages: 70,       // 每次最多 70 张分镜图
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
  mvAnalysis: 8,              // 每次视频 PK 评分消耗 8 credits
  idolGeneration: 3,          // 每次 Forge 偶像生成消耗 3 credits
  storyboard: 15,             // 每次分镜脚本 Gemini 3.0 Pro 消耗 15 credits
  storyboardFlash: 8,           // 每次分镜脚本 Gemini 3.0 Flash 消耗 8 credits
  storyboardGpt5: 20,           // 每次分镜脚本 GPT 5.1 消耗 20 credits
  forgeImage: 3,              // Forge AI 图片每张 3 credits

  // ─── AI 文本生成（Gemini）─────────────────────
  aiInspiration: 5,           // AI 灵感助手生成脚本消耗 5 credits（Gemini API 成本 ~$0.01）

  // ─── NBP 图片生成 ────────────────────────────
  nbpImage2K: 5,              // NBP 2K 图片（分镜图/偶像）每张 5 credits
  nbpImage4K: 9,              // NBP 4K 图片（分镜图/偶像）每张 9 credits

  // ─── 2D 转 3D（Hunyuan3D v3.1）────────────────
  rapid3D: 5,                 // 闪电 3D（Rapid）
  rapid3D_pbr: 8,             // 闪电 3D + PBR 材质
  pro3D: 9,                   // 精雕 3D（Pro）
  pro3D_pbr: 12,              // 精雕 3D + PBR
  pro3D_pbr_mv: 15,           // 精雕 3D + PBR + 多视角
  pro3D_full: 18,             // 精雕 3D 全选项

  // ─── 高级功能（Credits 设高，限制使用）────────
  videoGeneration: 50,        // 每次视频生成消耗 50 credits（高门槛）
  idol3D: 30,                 // 每次偶像转 3D 消耗 30 credits（高门槛）

  // ─── Suno 音乐生成 ────────────────────
  sunoMusicV4: 12,            // Suno V4 音乐生成消耗 12 credits（API 成本 $0.06/2首，利润率 ~73%）
  sunoMusicV5: 22,            // Suno V5 音乐生成消耗 22 credits（最新模型，更高音质，利润率 ~85%）
  sunoLyrics: 3,              // Suno 歌词生成消耗 3 credits（Gemini 转换脚本→歌词）
  audioSinglePurchase: 8,     // 音乐单次购买：每次生成 8 credits
  audioPackageGeneration: 1,  // 音乐套餐：每次生成 1 credit

  // ─── Kling 视频生成（最高门槛）────────────────
  klingVideo: 80,             // Kling 视频生成消耗 80 credits（API 成本高）
  klingMotionControl: 70,     // Kling 动作迁移消耗 70 credits（API 成本高）
  klingLipSync: 60,           // Kling 口型同步消耗 60 credits

  // ─── Kling 圖片生成 ────────────────────────────
  klingImageO1_1K: 8,           // Kling O1 1K 圖片消耗 8 credits（$0.028/張）
  klingImageO1_2K: 10,          // Kling O1 2K 圖片消耗 10 credits（$0.028/張，高解析度）
  klingImageV2_1K: 5,           // Kling V2.1 1K 圖片消耗 5 credits（$0.014/張）
  klingImageV2_2K: 7,           // Kling V2.1 2K 圖片消耗 7 credits（$0.014/張，高解析度）

  // ─── 分镜脚本 AI 改写 ────────────────────────────
  storyboardRewrite: 8,          // AI 改写分镜脚本消耗 8 credits

  // ─── AI 推荐 BGM 描述 ────────────────────────────
  recommendBGM: 5,               // AI 推荐 BGM 描述消耗 5 credits（Gemini 分析分镜内容生成 BGM 描述）

  // ─── 参考图风格分析 ────────────────────────────────
  referenceImageAnalysis: 3,     // 参考图风格分析消耗 3 credits（Gemini Vision 分析图片风格）

  // ─── 音频分析 ────────────────────────────────────
  audioAnalysis: 8,             // Gemini 音频分析消耗 8 credits
} as const;

/**
 * 单次购买包（不需要订阅）
 * 10 张 NBP 2K/4K 分镜图 = $8.90
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
 * 学生版方案定义
 * 
 * 半年版 $20：开放部分功能（有限次数）
 * 一年版 $38：更多次数 + 高端功能
 * 
 * 平台拥有生成内容的展示权（可选匿名）
 * 三年后如需继续使用需支付 IP 或内容版权费用
 */
export type StudentPlanType = "student_trial" | "student_6months" | "student_1year";

export interface StudentPlanConfig {
  name: string;
  nameCn: string;
  price: number;
  durationMonths: number;
  durationDays?: number;          // 试用期天数（仅 trial 使用）
  features: string[];
  featuresCn: string[];
  limits: {
    mvAnalysis: number;           // 视频 PK 评分次数/月
    storyboard: number;           // 分镜脚本生成次数/月
    idolGeneration: number;       // 虚拟偶像 2D 生成次数/月（-1=无限）
    idol3D: number;               // 偶像转 3D 次数/月
    lipSync: number;              // 口型同步次数/月
    videoGeneration: number;      // 视频生成次数/月
    storyboardImages: number;     // 每次分镜图上限
  };
  restrictions?: {
    maxVideoResolution?: "720p" | "1080p" | "4k"; // 视频生成最高分辨率
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
    restrictions: {
      maxVideoResolution: "720p",
    },
  },
  student_6months: {
    name: "Student 6-Month",
    nameCn: "学生半年版",
    price: 138,
    durationMonths: 6,
    features: [
      "Video PK Rating (5/month)",
      "Storyboard Script (3/month)",
      "2D Virtual Idol Generation (unlimited, Forge AI)",
      "Video Gallery Browsing (unlimited)",
      "Basic Community Features",
    ],
    featuresCn: [
      "视频 PK 评分（每月 5 次）",
      "分镜脚本生成（每月 3 次）",
      "虚拟偶像 2D 生成（无限，Forge AI）",
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
      "2D Virtual Idol Generation (unlimited, Forge AI)",
      "2D to 3D Idol Conversion (3/month)",
      "Lip-Sync (5/month)",
      "Video Generation (2/month)",
      "Video Gallery + Creative Tools (unlimited)",
      "Priority Support",
    ],
    featuresCn: [
      "视频 PK 评分（每月 15 次）",
      "分镜脚本生成（每月 8 次）",
      "虚拟偶像 2D 生成（无限，Forge AI）",
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
  totalCredits: number;       // 包内总 Credits 消耗
  savings: number;            // 相比单独购买省多少 Credits
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
    descriptionCn: "Forge AI 腳本生成（0 Credits）+ 分鏡轉視頻 + Suno V4 配樂",
    totalCredits: 62,           // 0 (Forge) + 50 (视频) + 12 (V4音乐)
    savings: 0,                 // 基础包无折扣
    includes: {
      scriptEngine: "forge",
      scriptCredits: 0,         // Forge 0 Credits
      storyboardToVideo: true,
      videoCredits: 50,
      musicEngine: "v4",
      musicCredits: 12,
    },
    features: [
      "Forge AI Script Generation (free)",
      "Storyboard to Video Conversion",
      "Suno V4 Background Music",
    ],
    featuresCn: [
      "Forge AI 腳本生成（0 Credits）",
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
    totalCredits: 77,           // 5 (Gemini) + 50 (视频) + 22 (V5音乐)
    savings: 0,                 // 后续可加折扣
    includes: {
      scriptEngine: "gemini",
      scriptCredits: 5,         // Gemini AI 生成
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
