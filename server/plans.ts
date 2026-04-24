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
    nameCn: "入门版",
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
      "视频 PK 评分（前 2 次 0 Credits）",
      "虚拟偶像生成（前 3 个 0 Credits，Forge AI）",
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
      "所有入门版功能",
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
  // ─── 创作者成长营（内测三大产品，1cr ≈ ¥0.70 人民币）────────
  growthCampGrowth: 40,         // GROWTH 模式主分析：40 cr
  growthCampGrowthMusic: 10,    // 成长营·配乐生成（GROWTH）：10 cr
  growthCampRemix: 60,          // 二创分析（REMIX）：60 cr
  growthCampRemixMusic: 8,      // 二创·配乐生成（REMIX）：8 cr
  platformTrend: 50,            // 平台数据分析（主看板）：50 cr
  platformTrendFollowUp: 6,     // 平台趋势·趋势数据续分析：正式包每日首次免费，之后 6 cr
  platformRefImage: 12,         // 平台趋势·生成参考图：12 cr/张
  platformRefImageUpscale2x: 36, // 参考图高清放大 2×：36 cr
  platformRefImageUpscale4x: 48, // 参考图高清放大 4×：48 cr
  workflowNodes: 20,            // 节点工作流整体（已废弃，改为逐步计费）

  // ─── 节点工作流（逐步计费，脚本每日首通免费）────────
  workflowScript: 0,           // 脚本生成：每日第 1 次免费
  workflowScriptExtra: 2,      // 脚本生成：当日第 2 次起每次 2 cr（防薅 API）
  workflowStoryboard: 5,       // 故事板：5 cr（Gemini Pro 文本生成，成本 ≈¥0.04）
  workflowSceneImage: 5,       // 分镜图（NBP 2K）：5 cr/张（成本 ≈¥0.08）
  workflowRenderStill: 9,      // 多人静帧（NBP 4K）：9 cr/次（成本 ≈¥0.10）
  workflowSceneVideo: 80,      // 场景视频（Veo 3.1 · Vertex AI）：80 cr/次（成本 ≈¥1.12）
  workflowSceneVoice: 5,       // 场景配音（TTS）：5 cr/次（成本 ≈¥0.05）
  workflowMusic: 12,           // 自动配乐（Suno V5.5）：12 cr（成本 ≈¥0.42）
  workflowFinalRender: 5,      // 最终合成：5 cr（计算资源）

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

  // ─── Kling 图片生成 ────────────────────────────
  klingImageO1_1K: 8,           // Kling O1 1K 图片消耗 8 credits（$0.028/張）
  klingImageO1_2K: 10,          // Kling O1 2K 图片消耗 10 credits（$0.028/張，高分辨率）
  klingImageV2_1K: 5,           // Kling V2.1 1K 图片消耗 5 credits（$0.014/張）
  klingImageV2_2K: 7,           // Kling V2.1 2K 图片消耗 7 credits（$0.014/張，高分辨率）

  // ─── 分镜脚本 AI 改写 ────────────────────────────
  storyboardRewrite: 8,          // AI 改写分镜脚本消耗 8 credits

  // ─── AI 推荐 BGM 描述 ────────────────────────────
  recommendBGM: 5,               // AI 推荐 BGM 描述消耗 5 credits（Gemini 分析分镜内容生成 BGM 描述）

  // ─── 参考图风格分析 ────────────────────────────────
  referenceImageAnalysis: 3,     // 参考图风格分析消耗 3 credits（Gemini Vision 分析图片风格）

  // ─── 音频分析 ────────────────────────────────────
  audioAnalysis: 8,             // Gemini 音频分析消耗 8 credits
} as const;

/** 1 Credit ≈ ¥0.70（人民币，用于展示） */
export const CREDIT_TO_CNY = 0.7;

export interface CreditFeatureBreakdownRow {
  product: string;
  subFeature: string;
  credits: number;
  note?: string;
}

/**
 * 全站功能细项 Credits 定价表（与 CREDIT_COSTS 一致，供后台与文档展示）
 */
export const CREDIT_FEATURE_BREAKDOWN: readonly CreditFeatureBreakdownRow[] = [
  // ─── 创作者成长营 ─────────────────────────────────────────
  { product: "创作者成长营", subFeature: "GROWTH 主分析", credits: CREDIT_COSTS.growthCampGrowth, note: "视频分析 + 策划报告" },
  { product: "创作者成长营", subFeature: "GROWTH 配乐生成", credits: CREDIT_COSTS.growthCampGrowthMusic, note: "额外扣费" },
  { product: "创作者成长营", subFeature: "二创分析（REMIX）", credits: CREDIT_COSTS.growthCampRemix, note: "图/文/视频参考 + 二创策划" },
  { product: "创作者成长营", subFeature: "REMIX 配乐生成", credits: CREDIT_COSTS.growthCampRemixMusic, note: "额外扣费" },
  // ─── 平台趋势分析 ─────────────────────────────────────────
  { product: "平台数据分析", subFeature: "主看板分析", credits: CREDIT_COSTS.platformTrend, note: "按次扣费" },
  { product: "平台数据分析", subFeature: "趋势数据续分析", credits: CREDIT_COSTS.platformTrendFollowUp, note: "正式包每日首次免费，之后 6 cr；试用包不支持" },
  { product: "平台数据分析", subFeature: "生成参考图（每张）", credits: CREDIT_COSTS.platformRefImage },
  { product: "平台数据分析", subFeature: "参考图高清放大 2×", credits: CREDIT_COSTS.platformRefImageUpscale2x },
  { product: "平台数据分析", subFeature: "参考图高清放大 4×", credits: CREDIT_COSTS.platformRefImageUpscale4x },
  // ─── 节点工作流（逐步） ───────────────────────────────────
  { product: "节点工作流", subFeature: "脚本生成（每日第1次）", credits: CREDIT_COSTS.workflowScript, note: "第2次起 2 cr/次" },
  { product: "节点工作流", subFeature: "脚本生成（当日第2次起）", credits: CREDIT_COSTS.workflowScriptExtra, note: "同用户按自然日计" },
  { product: "节点工作流", subFeature: "故事板确认", credits: CREDIT_COSTS.workflowStoryboard },
  { product: "节点工作流", subFeature: "分镜图（每场景 NBP 2K）", credits: CREDIT_COSTS.workflowSceneImage, note: "按场景张数" },
  { product: "节点工作流", subFeature: "多人静帧（NBP 4K）", credits: CREDIT_COSTS.workflowRenderStill, note: "每场景一次" },
  { product: "节点工作流", subFeature: "场景视频（Veo 3.1）", credits: CREDIT_COSTS.workflowSceneVideo, note: "每场景一次" },
  { product: "节点工作流", subFeature: "场景配音（TTS）", credits: CREDIT_COSTS.workflowSceneVoice, note: "每场景一次" },
  { product: "节点工作流", subFeature: "自动配乐（Suno V5.5 + Gemini Prompt）", credits: CREDIT_COSTS.workflowMusic },
  { product: "节点工作流", subFeature: "最终合成", credits: CREDIT_COSTS.workflowFinalRender },
  // ─── 基础与创作工具 ───────────────────────────────────────
  { product: "视频 PK / 分析", subFeature: "MV 对比评分", credits: CREDIT_COSTS.mvAnalysis },
  { product: "虚拟偶像", subFeature: "Forge 2D 生成", credits: CREDIT_COSTS.idolGeneration },
  { product: "分镜脚本", subFeature: "Gemini 3.0 Pro", credits: CREDIT_COSTS.storyboard },
  { product: "分镜脚本", subFeature: "Gemini 3.0 Flash", credits: CREDIT_COSTS.storyboardFlash },
  { product: "分镜脚本", subFeature: "GPT 5.1", credits: CREDIT_COSTS.storyboardGpt5 },
  { product: "Forge 生图", subFeature: "单张", credits: CREDIT_COSTS.forgeImage },
  { product: "AI 灵感", subFeature: "灵感脚本", credits: CREDIT_COSTS.aiInspiration },
  { product: "NBP", subFeature: "2K 图", credits: CREDIT_COSTS.nbpImage2K },
  { product: "NBP", subFeature: "4K 图", credits: CREDIT_COSTS.nbpImage4K },
  // ─── 3D ─────────────────────────────────────────────────
  { product: "腾讯混元 3D", subFeature: "闪电 Rapid", credits: CREDIT_COSTS.rapid3D },
  { product: "腾讯混元 3D", subFeature: "闪电 + PBR", credits: CREDIT_COSTS.rapid3D_pbr },
  { product: "腾讯混元 3D", subFeature: "精雕 Pro", credits: CREDIT_COSTS.pro3D },
  { product: "腾讯混元 3D", subFeature: "精雕 + PBR", credits: CREDIT_COSTS.pro3D_pbr },
  { product: "腾讯混元 3D", subFeature: "精雕 + PBR + 多视角", credits: CREDIT_COSTS.pro3D_pbr_mv },
  { product: "腾讯混元 3D", subFeature: "精雕全选项", credits: CREDIT_COSTS.pro3D_full },
  // ─── 高门槛 ─────────────────────────────────────────────
  { product: "视频生成（通用）", subFeature: "单条", credits: CREDIT_COSTS.videoGeneration },
  { product: "偶像 3D", subFeature: "单条", credits: CREDIT_COSTS.idol3D },
  // ─── Suno ───────────────────────────────────────────────
  { product: "Suno", subFeature: "V4 音乐", credits: CREDIT_COSTS.sunoMusicV4 },
  { product: "Suno", subFeature: "V5 音乐", credits: CREDIT_COSTS.sunoMusicV5 },
  { product: "Suno", subFeature: "歌词生成", credits: CREDIT_COSTS.sunoLyrics },
  { product: "Suno", subFeature: "单曲购买池", credits: CREDIT_COSTS.audioSinglePurchase },
  { product: "Suno", subFeature: "套餐内生成", credits: CREDIT_COSTS.audioPackageGeneration },
  // ─── Kling 视频 / 图 ─────────────────────────────────────
  { product: "可灵", subFeature: "图生视频", credits: CREDIT_COSTS.klingVideo },
  { product: "可灵", subFeature: "动作迁移", credits: CREDIT_COSTS.klingMotionControl },
  { product: "可灵", subFeature: "口型同步", credits: CREDIT_COSTS.klingLipSync },
  { product: "可灵 图", subFeature: "O1 1K", credits: CREDIT_COSTS.klingImageO1_1K },
  { product: "可灵 图", subFeature: "O1 2K", credits: CREDIT_COSTS.klingImageO1_2K },
  { product: "可灵 图", subFeature: "V2.1 1K", credits: CREDIT_COSTS.klingImageV2_1K },
  { product: "可灵 图", subFeature: "V2.1 2K", credits: CREDIT_COSTS.klingImageV2_2K },
  // ─── 其他 AI ────────────────────────────────────────────
  { product: "分镜", subFeature: "AI 改写脚本", credits: CREDIT_COSTS.storyboardRewrite },
  { product: "分镜", subFeature: "推荐 BGM 描述", credits: CREDIT_COSTS.recommendBGM },
  { product: "参考图", subFeature: "风格分析", credits: CREDIT_COSTS.referenceImageAnalysis },
  { product: "音频", subFeature: "Gemini 音频分析", credits: CREDIT_COSTS.audioAnalysis },
] as const;

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
  /** ¥19.9 试用：按 ¥0.6/积分 → floor(19.9/0.6)=33 Credits */
  trial199: {
    credits: 33,
    price: 19.9,
    label: "33 Credits Trial",
    labelCn: "¥19.9 试用包",
    perCredit: 0.6,
    discount: "约 ¥0.60/积分 · 33 Credits · 每人限 2 次",
  },
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
    credits: 300,
    price: 198,
    label: "300 Credits",
    labelCn: "300 Credits 超值包",
    perCredit: 0.66,
    discount: "省 4% · 可覆盖一次完整 3 场景工作流",
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
