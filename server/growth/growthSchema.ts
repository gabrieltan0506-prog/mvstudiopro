import {
  type GrowthAnalysisScores,
  type GrowthPlatform,
  type GrowthPlatformSnapshot,
  type GrowthSnapshot,
  growthSnapshotSchema,
} from "@shared/growth";

const PLATFORM_LABELS: Record<GrowthPlatform, string> = {
  douyin: "抖音",
  weixin_channels: "视频号",
  xiaohongshu: "小红书",
  bilibili: "B站",
  kuaishou: "快手",
  toutiao: "今日头条",
};

const PLATFORM_ALIASES = Object.fromEntries([
  ["douyin", "douyin"],
  ["抖音", "douyin"],
  ["xiaohongshu", "xiaohongshu"],
  ["小红书", "xiaohongshu"],
  ["bilibili", "bilibili"],
  ["b站", "bilibili"],
  ["视频号", "weixin_channels"],
  ["weixin_channels", "weixin_channels"],
  ["微信视频号", "weixin_channels"],
  ["kuaishou", "kuaishou"],
  ["快手", "kuaishou"],
  ["toutiao", "toutiao"],
  ["今日头条", "toutiao"],
]) as Record<string, GrowthPlatform>;

function normalizePlatforms(input?: string[]): GrowthPlatform[] {
  const mapped = (input || [])
    .map((item) => PLATFORM_ALIASES[String(item || "").trim().toLowerCase()] || PLATFORM_ALIASES[String(item || "").trim()])
    .filter(Boolean) as GrowthPlatform[];
  const unique = Array.from(new Set(mapped));
  return unique.length ? unique.slice(0, 4) : ["douyin", "xiaohongshu", "bilibili"];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildMetricWindow(platform: GrowthPlatform, analysis: GrowthAnalysisScores) {
  const base = Math.round((analysis.impact + analysis.viralPotential + analysis.composition) / 3);
  const multiplier =
    platform === "douyin" ? 1.2 :
    platform === "xiaohongshu" ? 0.85 :
    platform === "bilibili" ? 0.95 :
    platform === "weixin_channels" ? 0.7 :
    platform === "kuaishou" ? 0.75 :
    0.65;

  return {
    postsAnalyzed: Math.round(180 + base * multiplier),
    creatorsTracked: Math.round(42 + analysis.viralPotential * 0.6 * multiplier),
    avgViews: Math.round((26000 + analysis.impact * 900) * multiplier),
    avgLikes: Math.round((1500 + analysis.color * 42) * multiplier),
    avgComments: Math.round((120 + analysis.composition * 4.5) * multiplier),
    avgShares: Math.round((85 + analysis.impact * 3.8) * multiplier),
    engagementRateMedian: Number((clamp((analysis.viralPotential / 18) * multiplier, 2.1, 12.8)).toFixed(1)),
    growthRate: Number((clamp((analysis.impact - 55) * 0.45 * multiplier, -12, 22)).toFixed(1)),
    saveRateMedian: Number((clamp((analysis.color / 22) * multiplier, 0.8, 6.4)).toFixed(1)),
    topDurationRange:
      platform === "bilibili" ? "45-120 秒" :
      platform === "xiaohongshu" ? "20-45 秒" :
      "12-35 秒",
    sampleSizeLabel: "mock-30d-seed",
  };
}

function buildPlatformSummary(platform: GrowthPlatform, analysis: GrowthAnalysisScores) {
  const label = PLATFORM_LABELS[platform];
  if (platform === "douyin") {
    return analysis.impact >= 72
      ? `${label} 最近 30 天更偏好结果前置、冲突感强的短节奏内容。你现在的画面冲击力已经接近适配区间。`
      : `${label} 仍然适合做高频测试，但当前内容需要更强的前 2 秒钩子与情绪落点。`;
  }
  if (platform === "xiaohongshu") {
    return `${label} 更偏好可收藏、可复用、审美强的结构，适合把你的视觉优势放大成“模板感”和“方法感”。`;
  }
  if (platform === "bilibili") {
    return `${label} 近 30 天更能承接完整叙事与创作拆解，适合延展出幕后版、教程版或案例复盘版。`;
  }
  return `${label} 可作为次分发平台，适合用不同封面与文案角度验证同一素材的受众匹配度。`;
}

function buildPlatformSnapshot(platform: GrowthPlatform, analysis: GrowthAnalysisScores, context: string): GrowthPlatformSnapshot {
  const momentumBase =
    platform === "douyin" ? analysis.impact :
    platform === "xiaohongshu" ? analysis.color :
    platform === "bilibili" ? analysis.composition :
    Math.round((analysis.impact + analysis.composition) / 2);
  const fitBase =
    platform === "douyin" ? analysis.viralPotential :
    platform === "xiaohongshu" ? Math.round((analysis.color + analysis.lighting) / 2) :
    platform === "bilibili" ? Math.round((analysis.composition + analysis.viralPotential) / 2) :
    Math.round((analysis.impact + analysis.viralPotential) / 2);
  const competitionLevel =
    momentumBase >= 80 ? "high" :
    momentumBase >= 64 ? "medium" :
    "low";

  const recommendedFormats =
    platform === "douyin" ? ["15 秒强钩子版", "剧情结果前置版"] :
    platform === "xiaohongshu" ? ["封面标题拆解版", "审美灵感版"] :
    platform === "bilibili" ? ["完整案例版", "幕后复盘版"] :
    ["轻讲解版", "测试分发版"];

  const watchouts =
    platform === "douyin" ? ["开场 2 秒不能平", "中段镜头需要更密集切换"] :
    platform === "xiaohongshu" ? ["标题需要收藏理由", "封面要有明确主信息"] :
    platform === "bilibili" ? ["信息量不能太薄", "需要补充叙事或讲解"] :
    ["需要平台化文案", "先小流量测试标题"];

  const sampleTopics =
    context.trim()
      ? [`${context.trim().slice(0, 18)}拆解`, `${context.trim().slice(0, 18)}案例`, `${PLATFORM_LABELS[platform]}适配版`]
      : ["案例拆解", "幕后过程", "可复用模板"];

  return {
    platform,
    displayName: PLATFORM_LABELS[platform],
    summary: buildPlatformSummary(platform, analysis),
    fitLabel:
      fitBase >= 80 ? "高适配" :
      fitBase >= 65 ? "可测试" :
      "需优化后再投放",
    momentumScore: clamp(Math.round(momentumBase + 4), 40, 95),
    audienceFitScore: clamp(Math.round(fitBase), 38, 94),
    competitionLevel,
    recommendedFormats,
    bestPostingWindows:
      platform === "douyin" ? ["12:00-13:30", "19:00-22:00"] :
      platform === "xiaohongshu" ? ["11:30-13:00", "20:00-22:30"] :
      platform === "bilibili" ? ["18:00-21:30", "周末 10:00-12:00"] :
      ["12:00-14:00", "19:00-21:00"],
    watchouts,
    sampleTopics,
    last30d: buildMetricWindow(platform, analysis),
  };
}

export function buildMockGrowthSnapshot(params: {
  analysis: GrowthAnalysisScores;
  context?: string;
  requestedPlatforms?: string[];
}): GrowthSnapshot {
  const requestedPlatforms = normalizePlatforms(params.requestedPlatforms || params.analysis.platforms);
  const context = String(params.context || "").trim();
  const platformSnapshots = requestedPlatforms.map((platform) =>
    buildPlatformSnapshot(platform, params.analysis, context),
  );

  const today = new Date();
  const generatedAt = today.toISOString();
  const overview = {
    summary: "趋势模块当前返回的是可落地 mock/fallback 结构，但字段已经按 30 天平台抓取需求设计，明天接入采集任务后可直接替换数据源。",
    trendNarrative:
      params.analysis.impact >= 72
        ? "当前内容更适合先打强钩子和快节奏平台，再用拆解版承接长尾讨论。"
        : "当前内容更适合先做结构重写和封面测试，再逐步扩到分发平台。",
    nextCollectionPlan: "预留了平台快照、热门结构模式和机会点三类对象，后续爬虫只需要填充 30 天窗口指标即可。",
  };

  const snapshot = {
    status: {
      source: "fallback",
      generatedAt,
      windowDays: 30,
      freshnessLabel: "Mock 30-day fallback",
      collectorReady: false,
      missingConnectors: [
        "douyin.trends.fetch30d",
        "xiaohongshu.trends.fetch30d",
        "bilibili.trends.fetch30d",
      ],
      notes: [
        "当前为 schema-ready fallback 数据。",
        "字段已按明日抓取任务需要的 30 天窗口指标展开。",
      ],
    },
    requestedPlatforms,
    overview,
    platformSnapshots,
    contentPatterns: [
      {
        id: "pattern-hook-result-first",
        title: "结果前置 + 快速交代冲突",
        description: "最近更适合先给结果或反差，再补过程，不要从铺垫开场。",
        momentum: params.analysis.impact >= 70 ? "rising" : "stable",
        platforms: ["douyin", "xiaohongshu"],
        hookTemplate: "先给结果 / 反差，再一句话解释为什么值得继续看。",
        monetizationHint: "适合挂咨询入口、案例转化或服务介绍。",
      },
      {
        id: "pattern-breakdown-storytelling",
        title: "案例拆解 + 创作过程叙事",
        description: "适合把单条内容扩展成幕后、教程、方法论和案例库。",
        momentum: "stable",
        platforms: ["bilibili", "xiaohongshu"],
        hookTemplate: "先抛结果，再拆三步方法，把过程讲成可复制模板。",
        monetizationHint: "适合延展为模板售卖、课程、陪跑和项目交付。",
      },
    ],
    opportunities: [
      {
        id: "opp-platform-fit",
        title: "先做平台适配版本，而不是一稿通发",
        whyNow: "不同平台最近 30 天内容结构偏好差异明显，先做 2-3 个版本能更快找到反馈。",
        nextAction: "先产出抖音强钩子版 + 小红书拆解版 + B站幕后版。",
        linkedPlatforms: requestedPlatforms,
      },
      {
        id: "opp-commercial-bridge",
        title: "把内容流量桥接到明确商业入口",
        whyNow: "当前内容已经有基础视觉吸引力，继续只做“好看”会浪费后续转化机会。",
        nextAction: "下一条内容开始增加服务说明、案例 CTA 或私域承接动作。",
        linkedPlatforms: requestedPlatforms.slice(0, 2),
      },
    ],
  } satisfies GrowthSnapshot;

  return growthSnapshotSchema.parse(snapshot);
}

export const sampleGrowthSignals = buildMockGrowthSnapshot({
  analysis: {
    composition: 76,
    color: 81,
    lighting: 74,
    impact: 79,
    viralPotential: 77,
    strengths: ["画面风格清晰"],
    improvements: ["开头还可以更快"],
    platforms: ["抖音", "小红书"],
    summary: "sample",
  },
  context: "城市夜景航拍",
});
