import {
  type GrowthAnalysisScores,
  type GrowthBusinessInsight,
  type GrowthIndustryTemplate,
  type GrowthMonetizationTrack,
  type GrowthPlatform,
  type GrowthPlatformRecommendation,
  type GrowthPlatformSnapshot,
  type GrowthPlanStep,
  type GrowthSnapshot,
  type GrowthTopicLibraryItem,
  growthSnapshotSchema,
} from "@shared/growth";
import { matchIndustryTemplate } from "./industryTemplates";
import { getPlatformTemplate } from "./platformTemplates";
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

function isBeautyFashionContext(text: string) {
  return /美妆|穿搭|形象|妆|护肤|造型|时尚/.test(text);
}

function extractContextKeywords(context: string) {
  return Array.from(new Set(String(context || "").match(/[\u4e00-\u9fa5A-Za-z]{2,}/g) || [])).slice(0, 10);
}

function filterRelevantTopics(topics: string[], context: string) {
  const text = String(context || "").trim();
  if (!text) return topics.slice(0, 3);
  const beautyKeywords = ["穿搭", "妆", "护肤", "造型", "时尚", "审美", "运动穿搭", "网球穿搭", "防晒", "发型"];
  const wanted = isBeautyFashionContext(text)
    ? beautyKeywords
    : extractContextKeywords(text).slice(0, 6);
  const relevant = topics.filter((topic) =>
    wanted.some((keyword) => String(topic).toLowerCase().includes(keyword.toLowerCase())),
  );
  return (relevant.length ? relevant : topics).slice(0, 3);
}

function inferCommercialIntent(context: string) {
  if (/课程|教学|知识|教程|陪跑|训练营/.test(context)) return "课程 / 服务转化";
  if (/商品|带货|橱窗|单品|电商/.test(context)) return "产品转化";
  if (/品牌|招商|合作|案例页/.test(context)) return "品牌合作";
  if (/咨询|顾问|预约|私信/.test(context)) return "咨询预约";
  if (/社群|会员|社群运营|私域/.test(context)) return "社群承接";
  return "内容放大后的商业承接";
}

function inferAudienceArchetype(context: string) {
  if (isBeautyFashionContext(context)) return "美妆 / 穿搭 / 形象受众";
  if (/教育|老师|知识|课程|咨询/.test(context)) return "愿意为方法和结果付费的知识型受众";
  if (/品牌|创业|老板|客户/.test(context)) return "关心案例和商业结果的决策人";
  return "与你当前内容主题高度相关的精准受众";
}

function buildBeautyFashionTopicTemplates(context: string) {
  const intent = inferCommercialIntent(context);
  const audience = inferAudienceArchetype(context);
  return [
    {
      key: "sports_makeup",
      matchers: ["网球", "比赛", "运动", "赛场", "发型", "防晒", "妆", "穿搭"],
      title: "把运动赛场拆成可复制的妆容与穿搭方案",
      rationale: `你的素材里有运动场景、人物状态和审美元素，这类内容对 ${audience} 的相关度远高于泛热点。`,
      executionHint: "用“赛场场景 + 妆容细节 + 穿搭解决方案”三段写法，不讲比赛输赢，讲用户能拿走什么。",
      commercialAngle: `${intent} 可优先落到防晒、持妆、功能护肤、运动穿搭或造型服务。`,
    },
    {
      key: "tennis_style",
      matchers: ["网球", "比赛", "球员", "穿搭", "造型", "时尚"],
      title: "把网球风格改写成日常可执行的形象模板",
      rationale: "赛场素材天然带有风格识别度，适合改写成普通人也能照着做的形象方案。",
      executionHint: "直接输出“什么人适合、怎么穿、怎么避坑”，不要停留在赛事解说。",
      commercialAngle: `${intent} 可承接运动服饰、配件、美妆、防晒和形象咨询。`,
    },
    {
      key: "sun_protection",
      matchers: ["防晒", "户外", "赛场", "阳光", "汗", "持妆"],
      title: "从高强度户外场景切入防晒与持妆痛点",
      rationale: "户外运动画面天然强化了出汗、暴晒、脱妆这些真实痛点，比空讲产品更容易建立信任。",
      executionHint: "先抛一个具体痛点，再给一套防晒 / 底妆 / 补妆组合建议。",
      commercialAngle: `${intent} 更适合功能护肤、防晒、底妆和随身补妆产品。`,
    },
    {
      key: "body_language",
      matchers: ["表情", "镜头", "气质", "姿态", "近景", "特写"],
      title: "把镜头里的气质、姿态和表情管理拆成形象表达课",
      rationale: "人物表情和动作能直接转成形象管理内容，这比泛泛谈审美更有可执行性。",
      executionHint: "用“镜头里哪里有效 / 为什么 / 普通人怎么借用”来写，不要长篇主观感受。",
      commercialAngle: `${intent} 可延展到形象咨询、课程、训练营或高客单服务。`,
    },
  ];
}

function buildGenericTopicTemplates(context: string, industryTemplate: GrowthIndustryTemplate) {
  const keywords = extractContextKeywords(context);
  const intent = inferCommercialIntent(context);
  const audience = inferAudienceArchetype(context);
  const head = keywords[0] || "当前主题";
  return [
    {
      key: "pain_solution",
      matchers: keywords,
      title: `围绕「${head}」做痛点到方案的直接表达`,
      rationale: `这类话题更容易让 ${audience} 立刻理解内容价值。当前更该围绕「${industryTemplate.painPoint}」组织表达，而不是被无关热点分散注意力。`,
      executionHint: `先点出用户最痛的问题，再给一套可执行方案。${industryTemplate.analysisHint}`,
      commercialAngle: `${intent} 要用单一路径承接。优先考虑：${industryTemplate.offerExamples.slice(0, 2).join("、") || industryTemplate.primaryConversion}。`,
    },
    {
      key: "case_breakdown",
      matchers: keywords,
      title: `把「${head}」讲成案例拆解，而不是泛分享`,
      rationale: "案例化表达更容易同时建立可信度和成交意图。",
      executionHint: `按“结果 -> 关键步骤 -> 常见误区”组织，不再平铺过程。优先展示：${industryTemplate.trustAsset}`,
      commercialAngle: `${intent} 更适合接${industryTemplate.primaryConversion}。`,
    },
  ];
}

function scoreTopicTemplate(
  template: { matchers: string[] },
  titles: string[],
  contextKeywords: string[],
) {
  const titleHits = titles.reduce((sum, title) => (
    sum + (template.matchers.some((matcher) => matcher && title.includes(matcher)) ? 1 : 0)
  ), 0);
  const contextHits = contextKeywords.reduce((sum, keyword) => (
    sum + (template.matchers.some((matcher) => matcher && matcher.includes(keyword)) || template.matchers.includes(keyword) ? 1 : 0)
  ), 0);
  return titleHits * 16 + contextHits * 10;
}

function countKeywordHits(values: string[], keywords: string[]) {
  return values.reduce((sum, value) => (
    sum + keywords.reduce((matched, keyword) => matched + (keyword && value.includes(keyword) ? 1 : 0), 0)
  ), 0);
}

function buildPlatformSignalCluster(collection?: PlatformTrendCollection) {
  const contentItems = (collection?.items || []).filter((item) => item.bucket !== "douyin_topics" && item.contentType !== "topic");
  const topicItems = (collection?.items || []).filter((item) => item.bucket === "douyin_topics" || item.contentType === "topic");
  const tags = contentItems.flatMap((item) => item.tags || []).filter(Boolean);
  const avgLikes = contentItems.length
    ? contentItems.reduce((sum, item) => sum + (item.likes || item.hotValue || 0), 0) / contentItems.length
    : 0;
  const avgComments = contentItems.length
    ? contentItems.reduce((sum, item) => sum + (item.comments || 0), 0) / contentItems.length
    : 0;
  const avgShares = contentItems.length
    ? contentItems.reduce((sum, item) => sum + (item.shares || 0), 0) / contentItems.length
    : 0;

  const signalLabel =
    topicItems.length > contentItems.length * 0.5 ? "热点牵引" :
    avgShares > avgComments * 1.3 && avgShares > 0 ? "扩散传播" :
    avgComments > avgLikes * 0.08 && avgComments > 0 ? "讨论互动" :
    "稳定内容";

  return {
    label: signalLabel,
    keywords: Array.from(new Set(tags)).slice(0, 8),
    contentRatio: contentItems.length / Math.max(contentItems.length + topicItems.length, 1),
  };
}

function inferCarryRule(collection?: PlatformTrendCollection) {
  if (!collection?.items.length) return "默认承接到单一 CTA，不要同时挂多个转化动作。";
  const avgComments = collection.items.reduce((sum, item) => sum + (item.comments || 0), 0) / Math.max(collection.items.length, 1);
  const avgShares = collection.items.reduce((sum, item) => sum + (item.shares || 0), 0) / Math.max(collection.items.length, 1);
  const avgLikes = collection.items.reduce((sum, item) => sum + (item.likes || 0), 0) / Math.max(collection.items.length, 1);

  if (avgComments >= Math.max(avgShares, 1) * 1.1) {
    return "优先引导评论区或私信互动承接，再做后续服务转化。";
  }
  if (avgShares >= Math.max(avgComments, 1) * 1.2) {
    return "更适合把案例、结果和服务页放在主承接位，放大转发扩散。";
  }
  if (avgLikes >= Math.max(avgComments + avgShares, 1) * 2) {
    return "更适合用模板、清单或可领取资料做轻承接，不要过早重销售。";
  }
  return "默认承接到单一 CTA，不要同时挂多个转化动作。";
}

function buildTopicLibrary(
  requestedPlatforms: GrowthPlatform[],
  collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>,
  context: string,
  industryTemplate: GrowthIndustryTemplate,
): GrowthTopicLibraryItem[] {
  const contextKeywords = extractContextKeywords(context);
  const templates = isBeautyFashionContext(context)
    ? buildBeautyFashionTopicTemplates(context)
    : buildGenericTopicTemplates(context, industryTemplate);

  const platformPriority: GrowthPlatform[] = requestedPlatforms.length ? requestedPlatforms : ["xiaohongshu", "douyin", "bilibili"];

  const library = platformPriority.flatMap((platform) => {
    const collection = collections[platform];
    const platformTemplate = getPlatformTemplate(platform);
    const titles = (collections[platform]?.items || [])
      .filter((item) => item.bucket !== "douyin_topics" && item.contentType !== "topic")
      .map((item) => item.title);
    const signalCluster = buildPlatformSignalCluster(collection);
    const carryRule = inferCarryRule(collection);

    return templates.map((template, index) => {
      const score = scoreTopicTemplate(template, titles, contextKeywords);
      const tagScore = countKeywordHits(signalCluster.keywords, template.matchers);
      const signalBoost = signalCluster.contentRatio >= 0.6 ? 6 : 0;
      const confidence = clamp(58 + score + tagScore * 4 + signalBoost + (titles.length ? 6 : 0), 52, 95);
      return {
        id: `${platform}-${template.key}-${index}`,
        platform,
        platformLabel: PLATFORM_LABELS[platform],
        title: template.title,
        rationale: `${template.rationale} 当前 ${PLATFORM_LABELS[platform]} 更偏「${signalCluster.label}」信号，平台人群也更接近「${platformTemplate.audienceProfile}」`,
        executionHint: `${template.executionHint} 平台处理规则：${platformTemplate.packagingRule}`,
        commercialAngle: `${template.commercialAngle} ${platformTemplate.conversionRule} ${carryRule}`,
        confidence,
      } satisfies GrowthTopicLibraryItem;
    });
  });

  return library
    .sort((a, b) => b.confidence - a.confidence)
    .filter((item, index, list) => index === list.findIndex((candidate) => candidate.title === item.title))
    .slice(0, 6);
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
  context = "",
) {
  const contentItems = collection.items.filter((item) => item.bucket !== "douyin_topics" && item.contentType !== "topic");
  const relevantItems = filterRelevantTopics(contentItems.map((item) => item.title), context);
  const topItem = relevantItems[0];
  const baseSummary = buildPlatformSummary(platform, analysis);
  if (!topItem) return baseSummary;
  return `${baseSummary} 当前更值得参考的话题方向是「${topItem}」，说明最近更适合用高相关度表达，而不是追无关热点。`;
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

function buildTrendLayers(
  requestedPlatforms: GrowthPlatform[],
  collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>,
) {
  return requestedPlatforms.flatMap((platform) => {
    const label = PLATFORM_LABELS[platform];
    const collection = collections[platform];
    const items = collection?.items || [];
    const topicItems = items.filter((item) => item.bucket === "douyin_topics" || item.contentType === "topic");
    const contentItems = items.filter((item) => item.bucket !== "douyin_topics" && item.contentType !== "topic");

    if (!collection || !items.length) {
      return [{
        id: `${platform}-structure`,
        platform,
        platformLabel: label,
        layerType: "structure" as const,
        sourceType: "structure" as const,
        title: `${label} 结构建议`,
        summary: `${label} 当前没有可用的真实内容样本，这里只保留结构建议，不能当成真实趋势结论。`,
        sampleCount: 0,
        sampleLabel: "结构建议",
        items: [],
      }];
    }

    const layers: Array<{
      id: string;
      platform: GrowthPlatform;
      platformLabel: string;
      layerType: "topic" | "content" | "structure";
      sourceType: "live" | "structure";
      title: string;
      summary: string;
      sampleCount: number;
      sampleLabel: string;
      items: string[];
    }> = [];

    if (platform === "douyin" && topicItems.length) {
      layers.push({
        id: "douyin-topics",
        platform,
        platformLabel: label,
        layerType: "topic",
        sourceType: "live",
        title: "抖音热榜趋势",
        summary: `这部分来自抖音热榜/热点词样本，只反映当前热点话题，不等同于真实内容表现。`,
        sampleCount: topicItems.length,
        sampleLabel: "实时热榜样本",
        items: topicItems.slice(0, 5).map((item) => item.title),
      });
    }

    if (contentItems.length) {
      layers.push({
        id: `${platform}-content`,
        platform,
        platformLabel: label,
        layerType: "content",
        sourceType: collection.source === "live" ? "live" : "structure",
        title: `${label} 真实内容样本`,
        summary: collection.source === "live"
          ? `这部分来自 ${label} 当前抓到的真实内容样本，可用于判断最近内容表达、标题结构和素材方向。`
          : `${label} 当前没有稳定 live 样本，这里只能作为结构补位参考。`,
        sampleCount: contentItems.length,
        sampleLabel: collection.source === "live" ? "真实内容样本" : "结构补位",
        items: contentItems.slice(0, 5).map((item) => item.title),
      });
    } else if (platform !== "douyin") {
      layers.push({
        id: `${platform}-structure`,
        platform,
        platformLabel: label,
        layerType: "structure",
        sourceType: "structure",
        title: `${label} 结构建议`,
        summary: `${label} 当前没有独立的真实内容样本，这里只保留结构建议，不能写成真实趋势。`,
        sampleCount: 0,
        sampleLabel: "结构建议",
        items: [],
      });
    }

    return layers;
  });
}

function buildMonetizationTracks(
  analysis: GrowthAnalysisScores,
  context: string,
  platformSnapshots: GrowthPlatformSnapshot[],
  industryTemplate: GrowthIndustryTemplate,
): GrowthMonetizationTrack[] {
  const text = context.trim();
  const xiaohongshuFit = platformSnapshots.find((item) => item.platform === "xiaohongshu")?.audienceFitScore || 0;
  const bilibiliFit = platformSnapshots.find((item) => item.platform === "bilibili")?.audienceFitScore || 0;
  const douyinFit = platformSnapshots.find((item) => item.platform === "douyin")?.audienceFitScore || 0;

  return [
    {
      name: "品牌合作",
      fit: clamp(Math.round((analysis.color + analysis.composition + xiaohongshuFit) / 3 + (/品牌|招商|案例|客户|服务/.test(text) ? 6 : 0) + (/品牌合作|合作提案/.test(industryTemplate.primaryConversion) ? 6 : 0)), 36, 96),
      reason: isBeautyFashionContext(text)
        ? "更适合承接运动美妆、防晒、功能护肤、运动服饰和生活方式品牌，而不是泛泛而谈的品牌合作。"
        : `只有当表达统一、案例清楚、服务说明完整时，品牌或商单合作才有承接价值。当前更适合围绕「${industryTemplate.commercialFocus}」来组织合作说法。`,
      nextStep: isBeautyFashionContext(text)
        ? "补一版“运动场景妆容 / 穿搭解决方案”案例页，让品牌一眼看懂你能解决什么问题。"
        : `补一版案例导向标题和服务说明，让合作方快速理解你擅长的商业结果。优先展示：${industryTemplate.trustAsset}`,
    },
    {
      name: "电商带货",
      fit: clamp(Math.round((analysis.impact + analysis.viralPotential + douyinFit) / 3 + (/带货|商品|电商|转化/.test(text) ? 8 : 0) + (/商品|电商|带货/.test(industryTemplate.primaryConversion) ? 8 : 0)), 36, 96),
      reason: `冲击力和节奏更适合转化型表达，但产品利益点和 CTA 必须更直接。当前更适合围绕「${industryTemplate.painPoint}」组织购买理由。`,
      nextStep: `把前三秒改成结果或利益点前置，并把行动指令明确到橱窗、评论区或私域入口。优先做：${industryTemplate.offerExamples[0] || "单品转化"}`,
    },
    {
      name: "知识付费",
      fit: clamp(Math.round((analysis.composition + analysis.viralPotential + bilibiliFit) / 3 + (/课程|教学|知识|教程|陪跑/.test(text) ? 10 : 0) + (/课程|训练营|陪跑|模板/.test(industryTemplate.primaryConversion) ? 10 : 0)), 36, 96),
      reason: `适合把内容拆成方法、结构和案例复盘，再沉淀成课程、模板或陪跑服务。当前更该强化「${industryTemplate.analysisHint}」这类表达。`,
      nextStep: `把当前内容整理成“结果 + 三步方法 + 常见误区”的结构，形成可复用的方法论入口。可先验证：${industryTemplate.offerExamples.slice(0, 2).join("、")}`,
    },
    {
      name: "社群会员",
      fit: clamp(Math.round((analysis.color + analysis.lighting + xiaohongshuFit) / 3 + 4 + (/社群|会员|陪跑/.test(industryTemplate.primaryConversion) ? 6 : 0)), 36, 96),
      reason: "只有当主题稳定、更新稳定、服务权益稳定时，社群会员才会成立，不能只靠一句“欢迎进群”。",
      nextStep: `先定社群主题、每周固定更新、群内权益和转化路径，再连续发布 3 条同主题内容验证进群理由。核心权益建议围绕：${industryTemplate.offerExamples.slice(0, 2).join("、") || "固定答疑与模板"}`,
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
    const platformTemplate = getPlatformTemplate(platform);
    if (platform === "douyin") {
      return {
        name: PLATFORM_LABELS[platform],
        reason: analysis.impact >= 70
          ? `当前画面冲击力较强，适合先在高分发效率的平台验证强钩子和转化动作。${platformTemplate.contentPreference}`
          : `适合先测试更强开场，但需要把开头刺激和结果感再往前提。${platformTemplate.contentPreference}`,
        action: index === 0
          ? `先发 9:16 强钩子版，前 2 秒直接给结果或冲突点。${platformTemplate.actionRule}`
          : `补一版更强标题和对比封面，再做第二轮测试。${platformTemplate.actionRule}`,
      };
    }
    if (platform === "xiaohongshu") {
      return {
        name: PLATFORM_LABELS[platform],
        reason: `适合放大审美、方法感和可收藏的结构，尤其适合做拆解版和模板版。${platformTemplate.contentPreference}`,
        action: `补一段创作思路或场景拆解，并强化封面主信息和收藏理由。${platformTemplate.actionRule}`,
      };
    }
    if (platform === "bilibili") {
      return {
        name: PLATFORM_LABELS[platform],
        reason: `适合承接完整叙事、幕后复盘和创作过程，更利于延长内容生命周期。${platformTemplate.contentPreference}`,
        action: `把当前内容扩成幕后讲解版或案例复盘版，提高完播和评论讨论。${platformTemplate.actionRule}`,
      };
    }
    return {
      name: snapshot?.displayName || PLATFORM_LABELS[platform as GrowthPlatform],
      reason: `适合作为次分发渠道，验证不同标题、封面和叙事强度的版本差异。${platformTemplate.contentPreference}`,
      action: `保留核心卖点，输出一版平台适配文案后再投放。${platformTemplate.actionRule}`,
    };
  });
}

function buildBusinessInsights(
  analysis: GrowthAnalysisScores,
  context: string,
  monetizationTracks: GrowthMonetizationTrack[],
  industryTemplate: GrowthIndustryTemplate,
): GrowthBusinessInsight[] {
  const primaryTrack = monetizationTracks[0]?.name || "品牌合作";
  const beautyFashion = isBeautyFashionContext(context);
  const bookingStyle = /咨询|顾问|预约|服务|方案/.test(context);
  const commerceStyle = /带货|商品|单品|橱窗|电商/.test(context);
  const educationStyle = /课程|教学|知识|教程|训练营|陪跑/.test(context);
  const communityStyle = /社群|会员|私域/.test(context);
  const primaryAction = primaryTrack === "品牌合作"
    ? (beautyFashion
        ? "先把你的内容改写成“场景痛点 + 解决方案 + 合作品类”的提案型表达，让品牌知道你能承接哪类问题。"
        : "先补一页案例或服务结果说明，让合作方一眼看懂你解决什么问题。")
    : primaryTrack === "电商带货"
      ? "先把内容改写成“结果前置 + 利益点 + 单一购买动作”，不要继续做泛讨论。"
      : primaryTrack === "知识付费"
        ? "先把内容整理成一套可重复讲述的方法，再把入口统一指向课程、模板或陪跑。"
        : "先验证你是否真的具备固定主题、固定更新和固定权益，再决定要不要做长期社群。";
  return [
    {
      title: "行业判断",
      detail: `当前内容更接近「${industryTemplate.name}」模板。核心人群是：${industryTemplate.audience}。真正要解决的问题不是泛曝光，而是：${industryTemplate.painPoint}`,
    },
    {
      title: "商业判断",
      detail: analysis.viralPotential >= 75
        ? "这条内容已经不是“要不要发”的问题，而是“发出去以后把用户带到哪里”。先定唯一承接动作，再决定标题、封面和结尾。"
        : "当前先别急着讲太多商业化，先把内容变成一个明确的入口：让用户在 3 秒内知道你解决什么问题、为什么值得继续看、下一步该做什么。",
    },
    {
      title: "主承接动作",
      detail: bookingStyle
        ? "你的内容更适合把用户导向预约、咨询或方案沟通页，重点不是讲理念，而是让用户快速判断“你能不能帮我”。"
        : commerceStyle
          ? "你的内容更适合把用户导向商品页或单品推荐，重点不是讲完整故事，而是把利益点、适用场景和购买动作说清楚。"
          : educationStyle
            ? "你的内容更适合把用户导向课程、模板或陪跑入口，重点不是讲灵感，而是讲方法、步骤和结果。"
            : communityStyle || primaryTrack === "社群会员"
            ? "只有当你能长期输出同主题内容并提供稳定权益时，社群才值得做；否则先用轻量私域或预约动作测试承接。"
              : `${primaryAction} 先围绕「${industryTemplate.primaryConversion}」组织承接。`,
    },
    {
      title: "成交说法",
      detail: beautyFashion
        ? "不要只写“品牌合作”或“可商业化”。应该直接写成：适合运动美妆、防晒、功能护肤、服饰配件、造型服务这几类合作或转化。"
        : context.trim()
          ? `你现在的业务背景更适合先验证「${primaryTrack}」这一条成交路径，别同时混合多个方向。`
          : `先围绕「${primaryTrack}」做单一路径验证，先跑通再扩。`,
    },
    {
      title: "下一步落地",
      detail: `${primaryAction} 内容表达上优先补「${industryTemplate.trustAsset}」，承接上优先验证「${industryTemplate.offerExamples[0] || industryTemplate.primaryConversion}」。`,
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
  const industryTemplate = matchIndustryTemplate(context, [
    params.analysis.summary,
    ...params.analysis.strengths,
    ...params.analysis.improvements,
  ]);
  const platformSnapshots = requestedPlatforms.map((platform) =>
    buildPlatformSnapshot(platform, params.analysis, context),
  );
  const monetizationTracks = buildMonetizationTracks(params.analysis, context, platformSnapshots, industryTemplate);
  const platformRecommendations = buildPlatformRecommendations(requestedPlatforms, params.analysis, platformSnapshots);
  const businessInsights = buildBusinessInsights(params.analysis, context, monetizationTracks, industryTemplate);
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
    industryTemplate,
    overview,
    trendLayers: buildTrendLayers(requestedPlatforms, {}),
    topicLibrary: buildTopicLibrary(requestedPlatforms, {}, context, industryTemplate),
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
      summary: buildPlatformSummaryFromCollection(platform, params.analysis, collection, context),
      last30d: metricWindow,
      momentumScore: clamp(Math.round(metricWindow.growthRate * 3 + 60), 35, 96),
      audienceFitScore: clamp(Math.round((base.audienceFitScore + metricWindow.engagementRateMedian * 4) / 2), 38, 95),
      competitionLevel:
        metricWindow.avgLikes >= 30_000 ? "high" :
        metricWindow.avgLikes >= 8_000 ? "medium" :
        "low",
      sampleTopics: filterRelevantTopics(collection.items.map((item) => item.title), context),
    } satisfies GrowthPlatformSnapshot;
  });

  const livePlatforms = activeCollections.filter((item) => item.source === "live").map((item) => item.platform);
  const missingPlatforms = requestedPlatforms.filter((platform) => !params.collections[platform]?.items.length);
  const industryTemplate = matchIndustryTemplate(context, [
    params.analysis.summary,
    ...params.analysis.strengths,
    ...params.analysis.improvements,
    ...activeCollections.flatMap((collection) => collection.items.slice(0, 6).map((item) => item.title)),
  ]);
  const monetizationTracks = buildMonetizationTracks(params.analysis, context, platformSnapshots, industryTemplate);
  const platformRecommendations = buildPlatformRecommendations(requestedPlatforms, params.analysis, platformSnapshots);
  const businessInsights = buildBusinessInsights(params.analysis, context, monetizationTracks, industryTemplate);
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
        livePlatforms.length
          ? `已接入真实抓取平台：${livePlatforms.map((platform) => PLATFORM_LABELS[platform]).join("、")}。`
          : "当前没有已接入的真实抓取平台。",
        "当前实时数据来自平台热门样本，不等于完整 30 天历史数据仓。",
        ...activeCollections.flatMap((item) => item.notes.slice(0, 2)),
        ...Object.entries(params.errors || {}).map(([platform, error]) => `${PLATFORM_LABELS[platform as GrowthPlatform] || platform}：${error}`),
      ],
    },
    requestedPlatforms,
    industryTemplate,
    overview: {
      summary: "趋势模块已经开始消费真实平台实时样本，并保留 fallback 结构；当前仍是样本级参考，不应表述为完整 30 天历史库。",
      trendNarrative:
        params.analysis.impact >= 72
          ? "当前内容适合先打强钩子和分发效率高的平台，再用拆解版和幕后版承接长尾讨论。"
          : "当前内容更适合先做结构重写、封面测试和平台化版本，再逐步扩大投放。",
      nextCollectionPlan: "继续扩展采样深度、增加多页抓取和定时调度，再把当前 live sample 收敛成稳定的 30 天趋势库。",
    },
    trendLayers: buildTrendLayers(requestedPlatforms, params.collections),
    topicLibrary: buildTopicLibrary(requestedPlatforms, params.collections, context, industryTemplate),
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
