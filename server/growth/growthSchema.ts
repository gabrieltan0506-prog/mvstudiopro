import {
  type GrowthAnalysisScores,
  type GrowthBusinessInsight,
  type GrowthMonetizationTrack,
  type GrowthPlatform,
  type GrowthPlatformRecommendation,
  type GrowthPlatformSnapshot,
  type GrowthPlanStep,
  type GrowthSnapshot,
  growthSnapshotSchema,
} from "@shared/growth";
import type { PlatformTrendCollection } from "./trendCollector";

export const PLATFORM_LABELS: Record<GrowthPlatform, string> = {
  douyin: "抖音",
  weixin_channels: "视频号",
  xiaohongshu: "小红书",
  bilibili: "B站",
  kuaishou: "快手",
  toutiao: "今日头条",
};

export const PLATFORM_ALIASES = Object.fromEntries([
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

export function normalizePlatforms(input?: string[]): GrowthPlatform[] {
  const mapped = (input || [])
    .map((item) => PLATFORM_ALIASES[String(item || "").trim().toLowerCase()] || PLATFORM_ALIASES[String(item || "").trim()])
    .filter(Boolean) as GrowthPlatform[];
  const unique = Array.from(new Set(mapped));
  return unique.length ? unique.slice(0, 4) : ["douyin", "kuaishou", "bilibili", "xiaohongshu"];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function topDurationRangeFor(platform: GrowthPlatform) {
  return platform === "bilibili"
    ? "45-120 秒"
    : platform === "xiaohongshu"
    ? "20-45 秒"
    : "12-35 秒";
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

function buildPlatformSummaryFromCollection(
  platform: GrowthPlatform,
  analysis: GrowthAnalysisScores,
  collection: PlatformTrendCollection,
) {
  const topItem = collection.items[0];
  const baseSummary = buildPlatformSummary(platform, analysis);
  if (!topItem) return baseSummary;
  return `${baseSummary} 当前样本里最强势的话题/内容是「${topItem.title}」，说明最近分发仍然偏向更直接、更高可读性的表达。`;
}

function buildMetricWindowFromCollection(platform: GrowthPlatform, analysis: GrowthAnalysisScores, collection: PlatformTrendCollection) {
  const likes = collection.items.map((item) => item.likes || item.hotValue || 0).filter(Boolean);
  const comments = collection.items.map((item) => item.comments || 0).filter(Boolean);
  const shares = collection.items.map((item) => item.shares || 0).filter(Boolean);
  const views = collection.items.map((item) => item.views || 0).filter(Boolean);
  const creators = new Set(collection.items.map((item) => item.author).filter(Boolean));
  const engagementBase = median(likes) + median(comments) * 4 + median(shares) * 6;
  const engagementRateMedian = clamp(Number(((engagementBase || analysis.viralPotential * 100) / Math.max(median(views) || 50_000, 10_000) * 100).toFixed(1)), 1.6, 18.5);
  const growthRate = clamp(Number((analysis.impact * 0.18 + (median(shares) || 0) / 600 - 4).toFixed(1)), -10, 28);
  const saveRateMedian = clamp(Number((((median(likes) || analysis.color * 100) / Math.max(median(views) || 50_000, 10_000)) * 100).toFixed(1)), 0.6, 12.5);

  return {
    postsAnalyzed: collection.items.length,
    creatorsTracked: creators.size || Math.round(collection.items.length * 0.65),
    avgViews: Math.round(median(views) || (analysis.impact + analysis.viralPotential) * 900),
    avgLikes: Math.round(median(likes) || analysis.color * 120),
    avgComments: Math.round(median(comments) || analysis.composition * 3),
    avgShares: Math.round(median(shares) || analysis.impact * 2),
    engagementRateMedian,
    growthRate,
    saveRateMedian,
    topDurationRange: topDurationRangeFor(platform),
    sampleSizeLabel: collection.source === "live" ? "live-sample-30d" : "seed-sample-30d",
  };
}

function buildContentPatternsFromCollections(collections: PlatformTrendCollection[]) {
  const titles = collections.flatMap((collection) => collection.items.slice(0, 6).map((item) => item.title));
  const hasCase = titles.some((title) => /案例|复盘|教程|拆解/.test(title));
  const hasAesthetic = titles.some((title) => /治愈|灵感|穿搭|家居|日常|妆|拍照/.test(title));

  return [
    {
      id: "pattern-hook-result-first",
      title: "结果前置 + 快速交代冲突",
      description: "高频热门内容仍然偏向一上来就给结果、反差或结论，不再适合长铺垫开场。",
      momentum: "rising" as const,
      platforms: ["douyin", "xiaohongshu"] as GrowthPlatform[],
      hookTemplate: "先抛结果或反差，再用一句话交代为什么值得继续看。",
      monetizationHint: "适合挂服务咨询、案例转化、私域入口。",
    },
    {
      id: "pattern-breakdown-storytelling",
      title: hasCase ? "案例拆解 + 方法复盘" : "过程叙事 + 可复制模板",
      description: hasCase
        ? "最近热门样本里“案例 / 复盘 / 拆解”密度较高，说明幕后方法论仍有承接空间。"
        : "过程化表达和模板化表达仍然稳定，适合把单条内容延展成系列。",
      momentum: "stable" as const,
      platforms: ["bilibili", "xiaohongshu"] as GrowthPlatform[],
      hookTemplate: "先抛结果，再拆三步方法，把过程讲成可复制模板。",
      monetizationHint: hasAesthetic
        ? "适合模板售卖、课程和品牌合作。"
        : "适合陪跑、案例库、交付服务。",
    },
  ];
}

function buildOpportunitiesFromCollections(collections: PlatformTrendCollection[], requestedPlatforms: GrowthPlatform[]) {
  const totalLiveItems = collections.reduce((sum, collection) => sum + collection.items.length, 0);
  return [
    {
      id: "opp-platform-fit",
      title: "先做平台适配版本，而不是一稿通发",
      whyNow: totalLiveItems >= 20
        ? `当前已抓到 ${totalLiveItems} 条平台样本，平台偏好差异明显，应该先做版本适配再验证分发。`
        : "平台样本已经显示出明显结构差异，先做 2-3 个版本能更快找到反馈。",
      nextAction: "先产出抖音强钩子版 + 小红书拆解版 + B站幕后版。",
      linkedPlatforms: requestedPlatforms,
    },
    {
      id: "opp-commercial-bridge",
      title: "把内容流量桥接到明确商业入口",
      whyNow: "热门结构不等于商业转化，内容一旦有基础吸引力，就应该立刻补上 CTA 和服务承接。",
      nextAction: "下一条内容开始增加服务说明、案例 CTA 或私域承接动作。",
      linkedPlatforms: requestedPlatforms.slice(0, 2),
    },
  ];
}

function buildStructurePatterns(
  analysis: GrowthAnalysisScores,
  requestedPlatforms: GrowthPlatform[],
  collections: PlatformTrendCollection[],
) {
  const titles = collections.flatMap((collection) => collection.items.slice(0, 8).map((item) => item.title));
  const hasCase = titles.some((title) => /案例|复盘|教程|拆解/.test(title));
  const hasEmotion = titles.some((title) => /哭|崩溃|救命|离谱|逆天|震惊/.test(title));
  const hasLifestyle = titles.some((title) => /日常|穿搭|家居|生活|vlog|探店/.test(title));

  return [
    {
      id: "structure-result-proof",
      title: "结果先出 + 证据补强",
      angle: hasEmotion
        ? "先抛结果或反差，再用一条最强证据把情绪拉满。"
        : "先给结果，再快速交代为什么可信，减少无效铺垫。",
      hook: "开头 2 秒只做一件事：给结果、给反差、给结论。",
      cta: "结尾补“要模板/案例/链接”的单一行动指令。",
      recommendedPlatforms: requestedPlatforms.slice(0, 2) as GrowthPlatform[],
      evidence: "近 30 天热门样本里，结果前置类结构在短平台更稳定。",
    },
    {
      id: "structure-breakdown-template",
      title: hasCase ? "案例拆解 + 方法模板" : "过程拆解 + 可复制模板",
      angle: hasCase
        ? "把案例讲成方法，把结果讲成可复制路径。"
        : "把过程拆成三步，观众更容易收藏和转发。",
      hook: "先说最终结果，再说三步方法或两个误区。",
      cta: "引导到咨询、课程、陪跑或案例包。",
      recommendedPlatforms: ["xiaohongshu", "bilibili"] as GrowthPlatform[],
      evidence: hasLifestyle
        ? "小红书样本里，带模板感和生活方式包装的内容更容易被收藏。"
        : "B站 / 小红书样本对拆解、复盘、教程的承接更强。",
    },
    {
      id: "structure-series-promise",
      title: "系列承诺 + 连续更新",
      angle: analysis.viralPotential >= 75
        ? "把单条潜力内容延展成系列，尽快形成稳定记忆点。"
        : "先用系列结构降低试错成本，让内容方向更快收敛。",
      hook: "这一条先给结论，下一条专门讲过程或资源。",
      cta: "让用户评论关键词、预约下一集或进入私域。",
      recommendedPlatforms: ["douyin", "xiaohongshu", "bilibili"] as GrowthPlatform[],
      evidence: "当单条内容已有基础反馈，系列化通常比继续单发更容易形成商业承接。",
    },
  ];
}

function buildMonetizationTracks(
  analysis: GrowthAnalysisScores,
  context: string,
  platformSnapshots: GrowthPlatformSnapshot[],
): GrowthMonetizationTrack[] {
  const text = context.trim();
  const xiaohongshuFit = platformSnapshots.find((item) => item.platform === "xiaohongshu")?.audienceFitScore || 0;
  const bilibiliFit = platformSnapshots.find((item) => item.platform === "bilibili")?.audienceFitScore || 0;
  const douyinFit = platformSnapshots.find((item) => item.platform === "douyin")?.audienceFitScore || 0;

  return [
    {
      name: "品牌合作",
      fit: clamp(Math.round((analysis.color + analysis.composition + xiaohongshuFit) / 3 + (/品牌|招商|案例|客户|服务/.test(text) ? 6 : 0)), 36, 96),
      reason: "视觉包装和表达统一性更强时，更容易承接品牌合作、案例展示和商业合作页。",
      nextStep: "补一版案例导向标题和服务说明，让合作方快速理解你擅长的商业结果。",
    },
    {
      name: "电商带货",
      fit: clamp(Math.round((analysis.impact + analysis.viralPotential + douyinFit) / 3 + (/带货|商品|电商|转化/.test(text) ? 8 : 0)), 36, 96),
      reason: "冲击力和节奏更适合转化型表达，但产品利益点和 CTA 必须更直接。",
      nextStep: "把前三秒改成结果或利益点前置，并把行动指令明确到橱窗、评论区或私域入口。",
    },
    {
      name: "知识付费",
      fit: clamp(Math.round((analysis.composition + analysis.viralPotential + bilibiliFit) / 3 + (/课程|教学|知识|教程|陪跑/.test(text) ? 10 : 0)), 36, 96),
      reason: "适合把内容拆成方法、结构和案例复盘，再沉淀成课程、模板或陪跑服务。",
      nextStep: "把当前内容整理成“结果 + 三步方法 + 常见误区”的结构，形成可复用的方法论入口。",
    },
    {
      name: "社群会员",
      fit: clamp(Math.round((analysis.color + analysis.lighting + xiaohongshuFit) / 3 + 4), 36, 96),
      reason: "只要能持续输出同主题内容和过程感，就更容易建立陪伴感并承接社群或会员。",
      nextStep: "连续发布 3 条同主题内容，并在结尾加入系列承诺和进群/订阅理由。",
    },
  ].sort((a, b) => b.fit - a.fit);
}

function buildPlatformRecommendations(
  requestedPlatforms: GrowthPlatform[],
  analysis: GrowthAnalysisScores,
  platformSnapshots: GrowthPlatformSnapshot[],
): GrowthPlatformRecommendation[] {
  const selectedPlatforms: GrowthPlatform[] = requestedPlatforms.length ? requestedPlatforms : ["douyin", "xiaohongshu", "bilibili"];
  return selectedPlatforms.slice(0, 3).map((platform, index) => {
    const snapshot = platformSnapshots.find((item) => item.platform === platform);
    if (platform === "douyin") {
      return {
        name: PLATFORM_LABELS[platform],
        reason: analysis.impact >= 70
          ? "当前画面冲击力较强，适合先在高分发效率的平台验证强钩子和转化动作。"
          : "适合先测试更强开场，但需要把开头刺激和结果感再往前提。",
        action: index === 0
          ? "先发 9:16 强钩子版，前 2 秒直接给结果或冲突点。"
          : "补一版更强标题和对比封面，再做第二轮测试。",
      };
    }
    if (platform === "xiaohongshu") {
      return {
        name: PLATFORM_LABELS[platform],
        reason: "适合放大审美、方法感和可收藏的结构，尤其适合做拆解版和模板版。",
        action: "补一段创作思路或场景拆解，并强化封面主信息和收藏理由。",
      };
    }
    if (platform === "bilibili") {
      return {
        name: PLATFORM_LABELS[platform],
        reason: "适合承接完整叙事、幕后复盘和创作过程，更利于延长内容生命周期。",
        action: "把当前内容扩成幕后讲解版或案例复盘版，提高完播和评论讨论。",
      };
    }
    return {
      name: snapshot?.displayName || PLATFORM_LABELS[platform as GrowthPlatform],
      reason: "适合作为次分发渠道，验证不同标题、封面和叙事强度的版本差异。",
      action: "保留核心卖点，输出一版平台适配文案后再投放。",
    };
  });
}

function buildBusinessInsights(
  analysis: GrowthAnalysisScores,
  context: string,
  monetizationTracks: GrowthMonetizationTrack[],
): GrowthBusinessInsight[] {
  const primaryTrack = monetizationTracks[0]?.name || "品牌合作";
  return [
    {
      title: "商业判断",
      detail: analysis.viralPotential >= 75
        ? "内容已有放大基础，下一步不是继续堆信息，而是把流量导向可复制的服务、课程、案例页或咨询入口。"
        : "当前仍应先把内容结构、信息顺序和包装一致性做稳，再补上行动引导（CTA）和承接入口。",
    },
    {
      title: "包装能力",
      detail: analysis.color + analysis.composition >= 145
        ? "视觉包装已具备系列化潜力，适合尽快固定封面模板、标题句式和栏目识别。"
        : "视觉统一性还不够，建议先固定封面模板、标题句式、字幕样式和片头格式。",
    },
    {
      title: "承接路径",
      detail: context.trim()
        ? `你给出的业务背景「${context.trim().slice(0, 36)}${context.trim().length > 36 ? "..." : ""}」适合先验证「${primaryTrack}」方向。`
        : `建议先围绕「${primaryTrack}」验证一条最短商业路径，而不是同时试多个承接方向。`,
    },
  ];
}

function buildGrowthPlan(
  analysis: GrowthAnalysisScores,
  platformRecommendations: GrowthPlatformRecommendation[],
): GrowthPlanStep[] {
  const topPlatform = platformRecommendations[0]?.name || "抖音";
  return [
    { day: 1, title: "聚焦卖点", action: "重新定义这条内容的单一目标，只保留一个最强卖点，并重写开头 3 秒。" },
    { day: 2, title: "准备测试素材", action: "基于当前画面生成 2 个封面版本和 2 个标题版本，准备 A/B 测试。" },
    { day: 3, title: "首发验证", action: `先在 ${topPlatform} 发第一版，重点观察停留、完播和评论关键词。` },
    { day: 4, title: "节奏重写", action: "根据反馈重写中段节奏，把弱镜头删掉，强化转折点。" },
    { day: 5, title: "矩阵延展", action: "补一版幕后、拆解或教学内容，让单条内容变成内容矩阵。" },
    { day: 6, title: "模板沉淀", action: "将表现最好的表达方式整理成模板，开始做系列化发布。" },
    {
      day: 7,
      title: "商业承接",
      action: analysis.viralPotential >= 75
        ? "加入明确商业转化动作，比如咨询入口、服务介绍和预约表单。"
        : "复盘数据，确认下一轮优先优化的是开头冲击力还是画面统一性。",
    },
  ];
}

function buildCreationAssist(
  analysis: GrowthAnalysisScores,
  context: string,
  requestedPlatforms: GrowthPlatform[],
  monetizationTracks: GrowthMonetizationTrack[],
) {
  const primaryTrack = monetizationTracks[0]?.name || "品牌合作";
  const primaryPlatform = PLATFORM_LABELS[requestedPlatforms[0] || "douyin"] || "抖音";
  const backgroundLine = context.trim()
    ? `业务背景：${context.trim()}`
    : "业务背景：未填写，建议补充目标受众、成交方式和想放大的内容主题。";

  return {
    brief: [
      `内容目标：把当前素材升级成更适合 ${primaryPlatform} 分发，并服务于「${primaryTrack}」转化的内容版本。`,
      `核心分析：${analysis.summary}`,
      "开场建议：前 2-3 秒先给结果、反差或利益点，不要从铺垫开始。",
      "商业动作：结尾必须补 CTA，把观众导向案例咨询、服务介绍、商品入口或私域承接。",
      backgroundLine,
    ].join("\n"),
    storyboardPrompt: `请基于这条素材，输出一个适合 ${primaryPlatform} 的短视频脚本。要求：结果前置、3 段式结构、结尾加 ${primaryTrack} 对应的 CTA。${backgroundLine}`,
    workflowPrompt: `请把这条内容拆成可执行工作流：封面标题、开场钩子、主体结构、结尾 CTA、平台适配版本。优先服务于 ${primaryTrack} 转化。`,
  };
}

function buildGrowthHandoff(
  context: string,
  requestedPlatforms: GrowthPlatform[],
  monetizationTracks: GrowthMonetizationTrack[],
  creationAssist: ReturnType<typeof buildCreationAssist>,
) {
  const recommendedTrack = monetizationTracks[0]?.name || "品牌合作";
  return {
    brief: creationAssist.brief,
    storyboardPrompt: creationAssist.storyboardPrompt,
    workflowPrompt: creationAssist.workflowPrompt,
    recommendedTrack,
    recommendedPlatforms: requestedPlatforms.slice(0, 3),
    businessGoal: context.trim() || `优先验证「${recommendedTrack}」这条商业承接路径。`,
  };
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
  const monetizationTracks = buildMonetizationTracks(params.analysis, context, platformSnapshots);
  const platformRecommendations = buildPlatformRecommendations(requestedPlatforms, params.analysis, platformSnapshots);
  const businessInsights = buildBusinessInsights(params.analysis, context, monetizationTracks);
  const growthPlan = buildGrowthPlan(params.analysis, platformRecommendations);
  const creationAssist = buildCreationAssist(params.analysis, context, requestedPlatforms, monetizationTracks);

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
      freshnessLabel: "结构化参考样本，非真实 30 天历史库",
      collectorReady: false,
      missingConnectors: [
        "douyin.trends.fetch30d",
        "xiaohongshu.trends.fetch30d",
        "bilibili.trends.fetch30d",
      ],
      notes: [
        "当前为结构化 fallback 数据，不代表真实 30 天平台历史统计。",
        "字段已按后续真实抓取任务需要的 30 天窗口指标展开。",
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
    structurePatterns: buildStructurePatterns(params.analysis, requestedPlatforms, []),
    monetizationTracks,
    platformRecommendations,
    businessInsights,
    growthPlan,
    creationAssist,
    growthHandoff: buildGrowthHandoff(context, requestedPlatforms, monetizationTracks, creationAssist),
  } satisfies GrowthSnapshot;

  return growthSnapshotSchema.parse(snapshot);
}

export function buildGrowthSnapshotFromCollections(params: {
  analysis: GrowthAnalysisScores;
  context?: string;
  requestedPlatforms?: string[];
  collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>;
  errors?: Partial<Record<GrowthPlatform, string>>;
}): GrowthSnapshot {
  const requestedPlatforms = normalizePlatforms(params.requestedPlatforms || params.analysis.platforms);
  const context = String(params.context || "").trim();
  const activeCollections = requestedPlatforms
    .map((platform) => params.collections[platform])
    .filter(Boolean) as PlatformTrendCollection[];

  if (!activeCollections.length) {
    return buildMockGrowthSnapshot({
      analysis: params.analysis,
      context,
      requestedPlatforms,
    });
  }

  const platformSnapshots = requestedPlatforms.map((platform) => {
    const collection = params.collections[platform];
    if (!collection || !collection.items.length) {
      return buildPlatformSnapshot(platform, params.analysis, context);
    }
    const base = buildPlatformSnapshot(platform, params.analysis, context);
    const metricWindow = buildMetricWindowFromCollection(platform, params.analysis, collection);
    return {
      ...base,
      summary: buildPlatformSummaryFromCollection(platform, params.analysis, collection),
      last30d: metricWindow,
      momentumScore: clamp(Math.round(metricWindow.growthRate * 3 + 60), 35, 96),
      audienceFitScore: clamp(Math.round((base.audienceFitScore + metricWindow.engagementRateMedian * 4) / 2), 38, 95),
      competitionLevel:
        metricWindow.avgLikes >= 30_000 ? "high" :
        metricWindow.avgLikes >= 8_000 ? "medium" :
        "low",
      sampleTopics: collection.items.slice(0, 3).map((item) => item.title),
    } satisfies GrowthPlatformSnapshot;
  });

  const livePlatforms = activeCollections.filter((item) => item.source === "live").map((item) => item.platform);
  const missingPlatforms = requestedPlatforms.filter((platform) => !params.collections[platform]?.items.length);
  const monetizationTracks = buildMonetizationTracks(params.analysis, context, platformSnapshots);
  const platformRecommendations = buildPlatformRecommendations(requestedPlatforms, params.analysis, platformSnapshots);
  const businessInsights = buildBusinessInsights(params.analysis, context, monetizationTracks);
  const growthPlan = buildGrowthPlan(params.analysis, platformRecommendations);
  const creationAssist = buildCreationAssist(params.analysis, context, requestedPlatforms, monetizationTracks);

  const snapshot = {
    status: {
      source: missingPlatforms.length ? "hybrid" : "live",
      generatedAt: new Date().toISOString(),
      windowDays: 30,
      freshnessLabel: missingPlatforms.length ? "当前 live sample + 结构化补位，并非完整 30 天历史库" : "当前 live sample，非完整 30 天历史库",
      collectorReady: true,
      missingConnectors: missingPlatforms.map((platform) => `${platform}.trends.fetch30d`),
      notes: [
        `Live collectors ready for ${livePlatforms.join(", ") || "none"}.`,
        "当前 live 数据来自平台实时热门样本，不等于完整 30 天历史数据仓。",
        ...activeCollections.flatMap((item) => item.notes.slice(0, 2)),
        ...Object.entries(params.errors || {}).map(([platform, error]) => `${platform}: ${error}`),
      ],
    },
    requestedPlatforms,
    overview: {
      summary: "趋势模块已经开始消费真实平台实时样本，并保留 fallback 结构；当前仍是样本级参考，不应表述为完整 30 天历史库。",
      trendNarrative:
        params.analysis.impact >= 72
          ? "当前内容适合先打强钩子和分发效率高的平台，再用拆解版和幕后版承接长尾讨论。"
          : "当前内容更适合先做结构重写、封面测试和平台化版本，再逐步扩大投放。",
      nextCollectionPlan: "继续扩展采样深度、增加多页抓取和定时调度，再把当前 live sample 收敛成稳定的 30 天趋势库。",
    },
    platformSnapshots,
    contentPatterns: buildContentPatternsFromCollections(activeCollections),
    opportunities: buildOpportunitiesFromCollections(activeCollections, requestedPlatforms),
    structurePatterns: buildStructurePatterns(params.analysis, requestedPlatforms, activeCollections),
    monetizationTracks,
    platformRecommendations,
    businessInsights,
    growthPlan,
    creationAssist,
    growthHandoff: buildGrowthHandoff(context, requestedPlatforms, monetizationTracks, creationAssist),
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
