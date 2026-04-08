import {
  type GrowthAnalysisScores,
  type GrowthAudienceTrigger,
  type GrowthBusinessInsight,
  type GrowthDataLibrarySection,
  type GrowthDecisionFramework,
  type GrowthIndustryTemplate,
  type GrowthMonetizationTrack,
  type GrowthMonetizationStrategy,
  type GrowthPlatform,
  type GrowthPlatformActivity,
  type GrowthPlatformRecommendation,
  type GrowthPlatformSnapshot,
  type GrowthPlanStep,
  type GrowthReferenceExample,
  type GrowthSnapshot,
  type GrowthTitleExecution,
  type GrowthTopicLibraryItem,
  growthSnapshotSchema,
} from "@shared/growth";
import { matchIndustryTemplate } from "./industryTemplates";
import { getPlatformTemplate } from "./platformTemplates";
import type { PlatformTrendCollection } from "./trendCollector";
import { normalizeStringList } from "./trendNormalize";

export const PLATFORM_LABELS: Record<GrowthPlatform, string> = {
  douyin: "抖音",
  weixin_channels: "视频号",
  xiaohongshu: "小红书",
  bilibili: "B站",
  kuaishou: "快手",
  toutiao: "今日头条",
};

const DEFAULT_GROWTH_WINDOW_DAYS = Math.max(30, Number(process.env.GROWTH_TARGET_WINDOW_DAYS || 365) || 365);

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

const PLATFORM_BY_LABEL = Object.fromEntries(
  Object.entries(PLATFORM_LABELS).map(([platform, label]) => [label, platform as GrowthPlatform]),
) as Record<string, GrowthPlatform>;

export function normalizePlatforms(input?: string[]): GrowthPlatform[] {
  const mapped = (input || [])
    .map((item) => PLATFORM_ALIASES[String(item || "").trim().toLowerCase()] || PLATFORM_ALIASES[String(item || "").trim()])
    .filter((item): item is GrowthPlatform => Boolean(item) && item !== "weixin_channels");
  const unique = Array.from(new Set(mapped));
  return unique.length ? unique.slice(0, 4) : ["douyin", "kuaishou", "bilibili", "xiaohongshu"];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isBeautyFashionContext(text: string) {
  return /美妆|穿搭|形象|妆|护肤|造型|时尚/.test(text);
}

function isSportsCommerceContext(text: string) {
  return /健身器材|体育用品|运动器材|器械|哑铃|跑步机|壶铃|拉力器|护具|瑜伽垫|球拍|球类|训练器械|健身装备/.test(text);
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
  const tags = contentItems.flatMap((item) => normalizeStringList(item.tags)).filter(Boolean);
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
  return avgLikes >= Math.max(avgComments, avgShares, 1) * 1.4
    ? "适合先用结果和案例建立信任，再把单一路径转化动作收紧。"
    : "承接动作要尽量单一，先把主问题讲透，再推进后续转化。";
}

function buildTrackPlaybook(
  trackName: string,
  context: string,
  industryTemplate: GrowthIndustryTemplate,
  analysis: GrowthAnalysisScores,
) {
  const offerA = industryTemplate.offerExamples[0] || industryTemplate.primaryConversion;
  const offerB = industryTemplate.offerExamples[1] || industryTemplate.trustAsset;
  const businessContext = summarizeBusinessContext(context);
  if (trackName === "社群会员") {
    return {
      why: "只有当主题固定、更新固定、群内权益固定时，社群才成立；否则用户没有留下来的理由。",
      action: `先把社群主题锁到「${industryTemplate.painPoint}」，围绕 ${businessContext} 每周固定 1 次更新与 1 个群内权益，先用「${offerA}」测试进群理由。`,
      avoid: "不要先写“欢迎进群”或直接做重运营，先验证有没有稳定的同主题内容和明确权益。",
    };
  }
  if (trackName === "知识付费") {
    return {
      why: "用户不是为观点付费，而是为更短路径、更稳结果和可复制方法付费。",
      action: `先做三步：1. 把 ${businessContext} 讲成“结果 + 3 步方法 + 常见误区”；2. 补一页案例或前后对比，证明方法有效；3. 只用「${offerA} / ${offerB}」其中一个轻产品先测付费，不直接卖完整课程。`,
      avoid: "不要一开始就卖完整课程，先用单主题案例、清单或模板验证成交理由。",
    };
  }
  if (trackName === "电商带货") {
    return {
      why: "这条内容的冲击力更适合结果前置和利益点表达，能直接承接单一购买动作。",
      action: `先做四步：1. 开头 3 秒先讲 ${businessContext} 适合谁、解决什么；2. 中段只保留 2 到 3 个利益点，不讲空故事；3. 补「${industryTemplate.trustAsset}」里的一个信任证据；4. 结尾只留一个购买动作，优先测「${offerA}」。`,
      avoid: "不要同一条内容同时挂多个商品、多个动作和多个理由。",
    };
  }
  if (trackName === "品牌合作") {
    return {
      why: "品牌不会为泛流量买单，而是为可对接场景、可展示结果和明确合作品类买单。",
      action: `先补一页“${businessContext} 场景痛点 -> 解决方案 -> 合作品类 -> 结果证明”，优先围绕「${industryTemplate.trustAsset}」展开。`,
      avoid: "不要只写“可接品牌合作”，要写清你替品牌解决什么问题。",
    };
  }
  return {
    why: analysis.viralPotential >= 70 ? "当前内容已有放大基础，但承接路径还没收紧。" : "当前更像内容入口，还不是完整商业入口。",
    action: `先围绕「${industryTemplate.primaryConversion}」做单一路径验证，重点展示「${offerA}」，不要偏离 ${businessContext} 这个核心场景。`,
    avoid: "不要同时堆多个商业方向，先只跑一条最短转化路径。",
  };
}

function assessCollectionReliability(platform: GrowthPlatform, collection?: PlatformTrendCollection) {
  if (!collection?.items.length) {
    return {
      label: "weak" as const,
      multiplier: 0.45,
      summary: "当前没有足够 live 样本，只能作为结构参考。",
    };
  }

  const contentItems = collection.items.filter((item) => item.bucket !== "douyin_topics" && item.contentType !== "topic");
  const itemCount = contentItems.length;
  const uniqueAuthors = collection.stats.uniqueAuthorCount || new Set(contentItems.map((item) => item.author).filter(Boolean)).size;
  const notes = collection.notes.join(" | ");
  const blockedPublicWorks = /profile\/feed .*result=109|blocked with result=109/.test(notes);

  if (platform === "kuaishou") {
    if (blockedPublicWorks || itemCount < 18 || uniqueAuthors < 4) {
      return {
        label: "weak" as const,
        multiplier: 0.52,
        summary: "当前主要是弱样本与补充样本，先不要把它当成主判断依据。",
      };
    }
    return {
      label: "limited" as const,
      multiplier: 0.72,
      summary: "当前样本可做补充判断，但还不适合当唯一平台依据。",
    };
  }

  if (platform === "bilibili") {
    return itemCount >= 40 && uniqueAuthors >= 8
      ? { label: "strong" as const, multiplier: 1, summary: "当前样本强度足够，可直接参与正式判断。" }
      : { label: "limited" as const, multiplier: 0.82, summary: "当前样本可参考，但样本深度还可以继续补强。" };
  }

  if (platform === "xiaohongshu") {
    return itemCount >= 20 && uniqueAuthors >= 6
      ? { label: "strong" as const, multiplier: 1, summary: "当前样本强度足够，可直接参与正式判断。" }
      : { label: "limited" as const, multiplier: 0.84, summary: "当前样本可参考，但更适合做结构判断。" };
  }

  if (platform === "douyin") {
    return itemCount >= 18 && uniqueAuthors >= 5
      ? { label: "strong" as const, multiplier: 1, summary: "当前样本足够看近期表达与放量方向。" }
      : { label: "limited" as const, multiplier: 0.86, summary: "当前样本更适合看近期信号，不适合过度外推。" };
  }

  return itemCount >= 16
    ? { label: "limited" as const, multiplier: 0.8, summary: "当前样本可作辅助判断。" }
    : { label: "weak" as const, multiplier: 0.55, summary: "当前样本偏弱，只能作补充参考。" };
}

function buildTopicLibrary(
  requestedPlatforms: GrowthPlatform[],
  collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>,
  context: string,
  industryTemplate: GrowthIndustryTemplate,
): GrowthTopicLibraryItem[] {
  const contextKeywords = extractContextKeywords(context);
  if (industryTemplate.id === "industry-unspecified" || !contextKeywords.length) return [];
  const templates = isBeautyFashionContext(context)
    ? buildBeautyFashionTopicTemplates(context)
    : buildGenericTopicTemplates(context, industryTemplate);

  const platformPriority: GrowthPlatform[] = requestedPlatforms.length ? requestedPlatforms : ["xiaohongshu", "douyin", "bilibili"];

  const library = platformPriority.flatMap((platform) => {
    const collection = collections[platform];
    const reliability = assessCollectionReliability(platform, collection);
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
      const confidence = clamp(Math.round((58 + score + tagScore * 4 + signalBoost + (titles.length ? 6 : 0)) * reliability.multiplier), 38, 95);
      return {
        id: `${platform}-${template.key}-${index}`,
        platform,
        platformLabel: PLATFORM_LABELS[platform],
        title: template.title,
        rationale: `${template.rationale} 当前 ${PLATFORM_LABELS[platform]} 更偏「${signalCluster.label}」信号，平台人群也更接近「${platformTemplate.audienceProfile}」。${reliability.summary}`,
        executionHint: `${template.executionHint} 平台处理规则：${platformTemplate.packagingRule} 标题建议：${platformTemplate.headlineStyle}`,
        commercialAngle: `${template.commercialAngle} ${platformTemplate.conversionRule} 信任触发：${platformTemplate.trustTrigger}。${carryRule}`,
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
  const reliability = assessCollectionReliability(platform, collection);
  if (!topItem) return `${baseSummary} ${reliability.summary}`;
  return `${baseSummary} 当前更值得参考的话题方向是「${topItem}」，说明最近更适合用高相关度表达，而不是追无关热点。${reliability.summary}`;
}

function buildMetricWindowFromCollection(platform: GrowthPlatform, analysis: GrowthAnalysisScores, collection: PlatformTrendCollection) {
  const likes = collection.items.map((item) => item.likes || item.hotValue || 0).filter(Boolean);
  const comments = collection.items.map((item) => item.comments || 0).filter(Boolean);
  const shares = collection.items.map((item) => item.shares || 0).filter(Boolean);
  const views = collection.items.map((item) => item.views || 0).filter(Boolean);
  const creators = new Set(collection.items.map((item) => item.author).filter(Boolean));
  const engagementBase = median(likes) + median(comments) * 4 + median(shares) * 6;
  const reliability = assessCollectionReliability(platform, collection);
  const engagementRateMedian = clamp(Number(((engagementBase || analysis.viralPotential * 100) / Math.max(median(views) || 50_000, 10_000) * 100).toFixed(1)), 1.6, 18.5);
  const growthRate = clamp(Number((analysis.impact * 0.18 + (median(shares) || 0) / 600 - 4).toFixed(1)), -10, 28);
  const saveRateMedian = clamp(Number((((median(likes) || analysis.color * 100) / Math.max(median(views) || 50_000, 10_000)) * 100).toFixed(1)), 0.6, 12.5);

  return {
    postsAnalyzed: collection.items.length,
    creatorsTracked: creators.size || Math.round(collection.items.length * 0.65),
    avgViews: Math.round((median(views) || (analysis.impact + analysis.viralPotential) * 900) * reliability.multiplier),
    avgLikes: Math.round((median(likes) || analysis.color * 120) * reliability.multiplier),
    avgComments: Math.round((median(comments) || analysis.composition * 3) * reliability.multiplier),
    avgShares: Math.round((median(shares) || analysis.impact * 2) * reliability.multiplier),
    engagementRateMedian: Number((engagementRateMedian * Math.max(reliability.multiplier, 0.6)).toFixed(1)),
    growthRate: Number((growthRate * Math.max(reliability.multiplier, 0.65)).toFixed(1)),
    saveRateMedian: Number((saveRateMedian * Math.max(reliability.multiplier, 0.65)).toFixed(1)),
    topDurationRange: topDurationRangeFor(platform),
    sampleSizeLabel: collection.source === "live"
      ? reliability.label === "strong"
        ? "live-sample-30d"
        : reliability.label === "limited"
          ? "limited-live-sample"
          : "weak-live-sample"
      : "seed-sample-30d",
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
  const commerceDriven = /带货|商品|电商|转化|卖家|店铺|橱窗|陶瓷|瓷砖|家居|建材|下单/.test(text);
  const sportsCommerce = isSportsCommerceContext(text);
  const educationDriven = /课程|教学|知识|教程|陪跑|训练营|方法论/.test(text);
  const serviceDriven = /咨询|顾问|预约|服务|方案/.test(text);
  const offlineDriven = /到店|门店|实体|本地|预约/.test(text);
  const communityDriven = /社群|会员|私域|进群/.test(text) || /社群|会员|陪跑/.test(industryTemplate.primaryConversion);
  const explicitEducationPath = educationDriven || /课程|训练营|模板|教学|知识/.test(industryTemplate.primaryConversion);

  return [
    {
      name: "品牌合作",
      fit: clamp(Math.round((analysis.color + analysis.composition + xiaohongshuFit) / 3 + (/品牌|招商|案例|客户|服务/.test(text) ? 6 : 0) + (/品牌合作|合作提案/.test(industryTemplate.primaryConversion) ? 6 : 0)) - (analysis.viralPotential < 45 ? 18 : 0), 12, 96),
      reason: isBeautyFashionContext(text)
        ? "更适合承接运动美妆、防晒、功能护肤、运动服饰和生活方式品牌，而不是泛泛而谈的品牌合作。"
        : `只有当表达统一、案例清楚、服务说明完整时，品牌或商单合作才有承接价值。当前更适合围绕「${industryTemplate.commercialFocus}」来组织合作说法。`,
      nextStep: isBeautyFashionContext(text)
        ? "补一版“运动场景妆容 / 穿搭解决方案”案例页，让品牌一眼看懂你能解决什么问题。"
        : `补一版案例导向标题和服务说明，让合作方快速理解你擅长的商业结果。优先展示：${industryTemplate.trustAsset}`,
    },
    {
      name: "电商带货",
      fit: clamp(Math.round((analysis.impact + analysis.viralPotential + douyinFit) / 3 + (commerceDriven ? 24 : 0) + (sportsCommerce ? 12 : 0) + (offlineDriven ? 4 : 0) + (/商品|电商|带货/.test(industryTemplate.primaryConversion) ? 8 : 0)), 12, 96),
      reason: sportsCommerce
        ? "你是卖健身器材和体育用品，当前最值钱的不是讲氛围，而是让用户立刻判断“适不适合我、能解决什么训练问题、为什么现在值得买”。这就是标准的成交型内容。"
        : `冲击力和节奏更适合转化型表达，但产品利益点和 CTA 必须更直接。当前更适合围绕「${industryTemplate.painPoint}」组织购买理由。`,
      nextStep: sportsCommerce
        ? "先做成交版：第 1 句讲适合谁，第 2 句讲训练场景，第 3 句讲和普通器材差在哪，结尾只留一个动作，统一导向商品页、橱窗或私聊。"
        : `把前三秒改成结果或利益点前置，并把行动指令明确到橱窗、评论区或私域入口。优先做：${industryTemplate.offerExamples[0] || "单品转化"}`,
    },
    {
      name: "知识付费",
      fit: explicitEducationPath
        ? clamp(Math.round((analysis.composition + analysis.viralPotential + bilibiliFit) / 3 + (educationDriven ? 10 : -18) + (commerceDriven ? -28 : 0) + (sportsCommerce ? -18 : 0) + (serviceDriven ? 4 : 0) + (/课程|训练营|陪跑|模板/.test(industryTemplate.primaryConversion) ? 10 : 0)), 12, 96)
        : clamp(Math.round((analysis.composition + analysis.viralPotential + bilibiliFit) / 3 - 42 - (commerceDriven ? 18 : 0) - (sportsCommerce ? 18 : 0)), 6, 38),
      reason: sportsCommerce
        ? "当前不该先走知识付费。你最短的商业路径是先把器材卖出去，而不是先把训练方法讲成付费课。"
        : `适合把内容拆成方法、结构和案例复盘，再沉淀成课程、模板或陪跑服务。当前更该强化「${industryTemplate.analysisHint}」这类表达。`,
      nextStep: sportsCommerce
        ? "先不要卖课。先把单品成交稿、套装组合稿和场景对照稿跑通，再决定是否补训练方案内容。"
        : `把当前内容整理成“结果 + 三步方法 + 常见误区”的结构，形成可复用的方法论入口。可先验证：${industryTemplate.offerExamples.slice(0, 2).join("、")}`,
    },
    {
      name: "社群会员",
      fit: communityDriven
        ? clamp(Math.round((analysis.color + analysis.lighting + xiaohongshuFit) / 3 + 4 + (/社群|会员|陪跑/.test(industryTemplate.primaryConversion) ? 6 : 0) + (educationDriven ? 4 : 0) - (commerceDriven ? 18 : 0) - (sportsCommerce ? 18 : 0)) - (analysis.composition < 55 ? 10 : 0), 12, 96)
        : clamp(Math.round((analysis.color + analysis.lighting + xiaohongshuFit) / 3 - 40 - (commerceDriven ? 12 : 0) - (sportsCommerce ? 12 : 0)), 6, 35),
      reason: sportsCommerce
        ? "当前不该先做社群。用户买健身器材先看适配、效果和价格，不会因为一句“欢迎进群”就留下。"
        : "只有当主题稳定、更新稳定、服务权益稳定时，社群会员才会成立，不能只靠一句“欢迎进群”。",
      nextStep: sportsCommerce
        ? "先不要把社群写成主路径。先把单品成交、套装组合和复购路径做出来，再考虑售后群或会员群。"
        : `先定社群主题、每周固定更新、群内权益和转化路径，再连续发布 3 条同主题内容验证进群理由。核心权益建议围绕：${industryTemplate.offerExamples.slice(0, 2).join("、") || "固定答疑与模板"}`,
    },
  ].sort((a, b) => b.fit - a.fit);
}

function deriveContentStrategySignals(
  analysis: GrowthAnalysisScores,
  context: string,
  snapshot?: GrowthPlatformSnapshot,
  industryTemplate?: GrowthIndustryTemplate,
) {
  const text = `${context} ${snapshot?.summary || ""} ${(snapshot?.sampleTopics || []).join(" ")}`.trim();
  const lower = text.toLowerCase();
  const visualStory = analysis.composition >= 68 && analysis.color >= 62;
  const strongHook = analysis.impact >= 70 || analysis.viralPotential >= 70;
  const educational = /教程|教学|方法|攻略|步骤|清单|复盘|避坑|经验|模板|知识|分析/.test(text);
  const lifestyle = /旅行|探店|穿搭|妆容|vlog|美食|生活方式|居家|情侣|日常/.test(text);
  const serviceDriven = /咨询|顾问|方案|服务|预约|陪跑|训练营|课程/.test(text) || /咨询|顾问|服务|陪跑|课程/.test(industryTemplate?.primaryConversion || "");
  const commerceDriven = /商品|带货|单品|开箱|好物|购买|下单|橱窗|电商/.test(text) || /商品|带货|电商/.test(industryTemplate?.primaryConversion || "");
  const caseDriven = /案例|客户|合作|改造|前后对比|结果|项目|经验谈/.test(text) || /案例|结果/.test(industryTemplate?.trustAsset || "");
  const narrativeDriven = /故事|经历|纪录|日记|挑战|过程|旅程|人物/.test(text);
  const noteFirst = educational || lifestyle || caseDriven;
  const videoExpansion = strongHook || narrativeDriven || commerceDriven;
  const shortVideoFirst = strongHook || commerceDriven;
  const longVideoFirst = educational || caseDriven || (analysis.composition >= 60 && analysis.viralPotential < 65);

  return {
    text,
    visualStory,
    strongHook,
    educational,
    lifestyle,
    serviceDriven,
    commerceDriven,
    caseDriven,
    narrativeDriven,
    noteFirst,
    videoExpansion,
    shortVideoFirst,
    longVideoFirst,
    summaryLabel: noteFirst
      ? "先做可收藏、可复用的图文结构"
      : shortVideoFirst
        ? "先做结果前置的短视频版本"
        : "先做能讲清问题和方案的首发版本",
  };
}

function buildPlatformRecommendations(
  requestedPlatforms: GrowthPlatform[],
  analysis: GrowthAnalysisScores,
  platformSnapshots: GrowthPlatformSnapshot[],
  collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>,
  context: string,
  industryTemplate: GrowthIndustryTemplate,
): GrowthPlatformRecommendation[] {
  const buildTopicIdeas = (platform: GrowthPlatform, fallbackTitle: string) => {
    const collection = collections[platform];
    const keywords = Array.from(new Set(
      String(context)
        .split(/[\s,，。；;、/]+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2),
    ));
    const liveTopicIdeas = (collection?.items || [])
      .filter((item) => item.title && item.contentType !== "topic")
      .filter((item) => {
        if (!keywords.length) return true;
        const haystack = `${item.title} ${normalizeStringList(item.tags).join(" ")}`.toLowerCase();
        return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
      })
      .sort((left, right) => ((right.likes || 0) + (right.views || 0)) - ((left.likes || 0) + (left.views || 0)))
      .slice(0, 5)
      .map((item, index) => ({
        title: item.title,
        angle: `优先切入 ${normalizeStringList(item.tags).slice(0, 2).join(" / ") || "相似高表现主题"}，把它改写成更贴近你当前业务的人群和结果。`,
        expansion: index === 0
          ? "先做首发版，再拆成对比版和案例版。"
          : "保留同一主题，往不同人群场景或行动指令继续展开。",
      }));
    if (liveTopicIdeas.length) return liveTopicIdeas;
    return [
      {
        title: `${fallbackTitle}适合谁`,
        angle: `先讲清楚这条内容最适合哪类人，以及为什么和 ${industryTemplate.painPoint} 有关系。`,
        expansion: "延展成不同人群版本，对比“适合”和“不适合”的边界。",
      },
      {
        title: `${fallbackTitle}怎么用`,
        angle: `把抽象判断改成步骤、场景或示范，重点补 ${industryTemplate.trustAsset}。`,
        expansion: "拆成步骤版、避坑版和结果前置版。",
      },
      {
        title: `${fallbackTitle}值不值得`,
        angle: "把收藏理由、购买理由或继续看的理由直接说透，不讲后台判断逻辑。",
        expansion: "延展成前后对比、清单和决策建议版。",
      },
    ];
  };
  const selectedPlatforms: GrowthPlatform[] = requestedPlatforms.length ? requestedPlatforms : ["douyin", "xiaohongshu", "bilibili"];
  const commerceDriven = /卖家|商品|电商|带货|陶瓷|瓷砖|家居|建材|橱窗|下单/.test(context);
  const sportsCommerce = isSportsCommerceContext(context);
  const recommendations = selectedPlatforms.map((platform, index) => {
    const snapshot = platformSnapshots.find((item) => item.platform === platform);
    const reliability = assessCollectionReliability(platform, collections[platform]);
    const platformTemplate = getPlatformTemplate(platform);
    const signals = deriveContentStrategySignals(analysis, context, snapshot, industryTemplate);
    const watchouts = snapshot?.watchouts?.slice(0, 2).join("、") || platformTemplate.avoidance;
    const topicHint = industryTemplate.trustAsset;
    if (platform === "douyin") {
      return {
        name: PLATFORM_LABELS[platform],
        reason: commerceDriven
          ? `抖音更适合先做成交验证，因为这里最快能测试“适合谁、解决什么、为什么值得买”这套表达是否成立。对卖健身器材和体育用品来说，先把训练场景、适用人群和一个主卖点讲透，比拍氛围更重要。`
          : signals.shortVideoFirst
          ? `这条内容在抖音不能按原稿平铺，要改成“结果先出现、冲突马上讲清、镜头尽快推进”的短视频表达。重点不是重复小红书文案，而是把「${topicHint}」压成前 2 秒就能懂的开场。`
          : `抖音更适合作为第二阶段视频放大平台。先把图文里最值得传播的一句结论抽出来，再围绕它做强钩子短视频，不要直接搬运原稿。`,
        action: commerceDriven
          ? "按成交稿来改：开头直接说这套器材适合谁；中段演示一个训练场景和一个核心差异；补一条真实证据；结尾只留商品页、橱窗或私聊其中一个动作。"
          : index === 0
          ? `做 1 版 9:16 结果前置短视频：开头先讲结论，中段只保留 2 到 3 个关键画面，结尾只留一个动作。${signals.commerceDriven ? "如果要转化，就把商品利益点或预约动作直接说出来。" : "如果先做增长，就把评论互动问题放在结尾。"} 注意避免：${watchouts}`
          : `把首发图文改写成抖音视频版：删掉解释型段落，保留冲突、结果和一个行动指令。${platformTemplate.actionRule} 注意避免：${watchouts}`,
        playbook: commerceDriven
          ? "发短视频成交稿：封面或前两秒直接说适合谁，中段只保留一个训练场景和一个关键差异，结尾把动作收束到橱窗、商品页或私聊其中一个入口。"
          : "发短视频版本：前两秒先给结果或冲突，中段只保留 2 到 3 个关键镜头，结尾用一个问题或动作收口，不要把后台分析过程讲给用户。",
        topicIdeas: buildTopicIdeas(platform, topicHint),
      };
    }
    if (platform === "xiaohongshu") {
      return {
        name: PLATFORM_LABELS[platform],
        reason: commerceDriven
          ? `小红书更适合做买家决策笔记补充：把器材适合谁、使用场景、参数区别、避坑点和为什么值得买讲清楚，用来承接收藏和对比，不适合做主成交视频。`
          : signals.noteFirst
          ? `小红书适合先做首发验证，但不是因为平台固定模板，而是因为这条内容更适合被整理成“适合谁、解决什么、怎么做”的笔记结构。先让用户愿意收藏，再把它延展成视频。`
          : `如果这条内容先上小红书，不能只发感受或流水账。要把故事线拆成清单、路线、避坑、前后对比或场景建议，让用户一眼知道为什么值得存。`,
        action: commerceDriven
          ? "把它改成决策笔记：封面讲“适合哪类训练人群”，正文按“适用场景 -> 核心差异 -> 参数对比 -> 为什么值得买 -> 一个动作”排。"
          : `先写 1 版小红书笔记：封面只讲一个结果，正文按“场景痛点 -> 做法拆解 -> 收藏理由 -> 下一步动作”排。${signals.videoExpansion ? "首发后立刻把这版拆成分镜，延展出 30 到 60 秒短视频。" : "先把这版笔记跑通，再抽最强一段改成短视频脚本。"} 注意避免：${watchouts}`,
        playbook: commerceDriven
          ? "发小红书决策笔记：标题直接写适合谁和为什么值得买，正文按场景、差异、参数、避坑和一个动作来排。不要塞平台中位数和内部评分。"
          : "发小红书首发版：封面只放一个结果，正文按痛点、做法、证据、收藏理由和下一步动作来写。跑通后再拆出视频版。",
        topicIdeas: buildTopicIdeas(platform, topicHint),
      };
    }
    if (platform === "bilibili") {
      return {
        name: PLATFORM_LABELS[platform],
        reason: signals.longVideoFirst
          ? `B站更适合把这条内容讲完整，尤其是方法、案例、复盘和幕后拆解。这里不是简单“多发一个平台”，而是把同一内容升级成更长尾、更能建立信任的版本。`
          : `如果你要把这条内容继续放大，B站适合承接“为什么这样做、踩了什么坑、如何复用”的后续版，不适合只上传短版切片。`,
        action: `做 1 版 60 到 120 秒复盘或案例拆解视频：先讲结果，再讲步骤和误区，最后告诉用户可以继续看哪一版内容。${signals.serviceDriven ? "如果你卖的是咨询、课程或服务，就把案例结果和方法论说透。" : "如果你做的是内容增长，就重点讲结构、节奏和可复制的方法。"} 注意避免：${watchouts}`,
        playbook: "发 B 站复盘版：标题直接讲结果或案例主题，视频先给结论，再拆步骤、误区和可复用方法，结尾引导用户看下一条延展内容。",
        topicIdeas: buildTopicIdeas(platform, topicHint),
      };
    }
    if (platform === "kuaishou") {
      return {
        name: PLATFORM_LABELS[platform],
        reason: `快手更适合做直给型版本。不要讲平台分析，不要讲抽象定位，只要直接告诉用户“这件事值不值、适不适合、怎么做更省事”。同一主题到快手必须换成更生活化、更结果导向的表达。`,
        action: `把内容改成生活场景口播或真实演示版：开头先讲能解决什么，中段只保留 2 个最实用步骤，结尾留一个最直接的动作。${signals.commerceDriven ? "如果有商品或服务承接，就把价格感、结果感和适用人群讲清楚。" : "如果先做增长，就用一个最直白的问题把评论引出来。"} 注意避免：${watchouts}`,
        playbook: "发快手直给版：开头先说值不值、适不适合，中段只讲两个最实用点，结尾留一个最直接的动作，不讲长背景。",
        topicIdeas: buildTopicIdeas(platform, topicHint),
      };
    }
    return {
      name: snapshot?.displayName || PLATFORM_LABELS[platform as GrowthPlatform],
      reason: `这个平台不该拿来重复发同一份稿，而是拿来验证“同一主题换表达后，哪种结构更容易被接受”。核心是按内容本身改写，不是按平台套模板。`,
      action: `保留同一个核心卖点，单独改写标题、结构和行动指令后再发。当前最该保留的是「${topicHint}」，最该删掉的是平台内部推理和冗长解释。注意避免：${watchouts}`,
      playbook: "按这个平台的内容习惯单独改写，不要把别的平台结构原样搬过去。只保留结果、证据和一个动作。",
      topicIdeas: buildTopicIdeas(platform as GrowthPlatform, topicHint),
    };
  });

  const weightedScore = (item: GrowthPlatformRecommendation) => {
    const platform = Object.entries(PLATFORM_LABELS).find(([, label]) => label === item.name)?.[0] as GrowthPlatform | undefined;
    const snapshot = platform ? platformSnapshots.find((entry) => entry.platform === platform) : null;
    const reliability = platform ? assessCollectionReliability(platform, collections[platform]) : { multiplier: 0.7 };
    const commerceBias =
      commerceDriven && sportsCommerce
        ? platform === "douyin"
          ? 18
          : platform === "kuaishou"
            ? 10
            : platform === "xiaohongshu"
              ? -6
              : 0
        : commerceDriven
          ? platform === "douyin"
            ? 12
            : platform === "xiaohongshu"
              ? -4
              : 0
          : 0;
    return Math.round((((snapshot?.audienceFitScore || 60) + (snapshot?.momentumScore || 60)) * reliability.multiplier) + commerceBias);
  };

  return recommendations.sort((left, right) => weightedScore(right) - weightedScore(left));
}

function parsePlatformFromRecommendation(name?: string): GrowthPlatform | null {
  const value = String(name || "").trim();
  const matched = Object.entries(PLATFORM_LABELS).find(([, label]) => label === value)?.[0];
  return (matched as GrowthPlatform | undefined) || null;
}

function inferPresentationMode(
  platform: GrowthPlatform | null,
  analysis: GrowthAnalysisScores,
  context: string,
  snapshot?: GrowthPlatformSnapshot,
  industryTemplate?: GrowthIndustryTemplate,
) {
  const signals = deriveContentStrategySignals(
    analysis,
    context,
    snapshot,
    industryTemplate || matchIndustryTemplate(context, [analysis.summary, ...analysis.strengths]),
  );
  if (platform === "xiaohongshu" && signals.noteFirst) return "图文" as const;
  if (platform === "bilibili" && signals.longVideoFirst) return "长视频" as const;
  return "短视频" as const;
}

function buildExecutionCopy(
  title: string,
  mode: "图文" | "短视频" | "长视频",
  context: string,
  industryTemplate: GrowthIndustryTemplate,
  openingHook: string,
) {
  const audience = inferAudienceArchetype(context);
  if (mode === "图文") {
    return `封面先写「${title}」。正文按“什么人最需要 -> 为什么会出现这个问题 -> 一套可执行做法 -> 常见误区 -> 现在先做什么”展开。重点把 ${industryTemplate.painPoint} 讲透，让 ${audience} 看完愿意收藏。${openingHook ? `开头提示：${openingHook}` : ""}`.trim();
  }
  if (mode === "长视频") {
    return `视频开头直接抛出「${title}」，前 10 秒先讲结果和适合谁，中段拆 3 个关键判断或案例，后段补方法和误区，最后只收一个动作。重点不是泛分享，而是把 ${industryTemplate.trustAsset} 讲成能建立信任的完整版本。${openingHook ? `开场可直接用：${openingHook}` : ""}`.trim();
  }
  return `短视频直接用「${title}」做前两秒钩子，立刻点出 ${industryTemplate.painPoint} 和结果承诺。主体只留 2 到 3 个证据镜头或动作，中段别解释过长，结尾统一导向一个行动。${openingHook ? `开场建议：${openingHook}` : ""}`.trim();
}

function buildTitleExecutions(
  analysis: GrowthAnalysisScores,
  context: string,
  platformRecommendations: GrowthPlatformRecommendation[],
  platformSnapshots: GrowthPlatformSnapshot[],
  industryTemplate: GrowthIndustryTemplate,
): GrowthTitleExecution[] {
  const titles = (analysis.titleSuggestions || []).filter(Boolean);
  const fallbackTitles = platformRecommendations
    .flatMap((item) => item.topicIdeas?.map((topic) => topic.title) || [])
    .filter(Boolean);
  const primaryHook = analysis.commercialAngles?.[0]?.hook || analysis.timestampSuggestions?.[0]?.fix || "";
  const mergedTitles = Array.from(new Set([...titles, ...fallbackTitles])).slice(0, 3);

  return mergedTitles.map((title, index) => {
    const recommendation = platformRecommendations[index] || platformRecommendations[0] || null;
    const platform = parsePlatformFromRecommendation(recommendation?.name);
    const snapshot = platform ? platformSnapshots.find((item) => item.platform === platform) : platformSnapshots[0];
    const presentationMode = inferPresentationMode(platform, analysis, context, snapshot, industryTemplate);
    const suitablePlatforms = recommendation?.name
      ? [platform || "xiaohongshu"]
      : [platformSnapshots[0]?.platform || "xiaohongshu"];

    return {
      title,
      copywriting: buildExecutionCopy(title, presentationMode, context, industryTemplate, primaryHook),
      presentationMode,
      suitablePlatforms,
      reason: recommendation?.reason || snapshot?.summary || analysis.summary || `这条标题更适合承接「${industryTemplate.painPoint}」这个核心问题。`,
      openingHook: primaryHook,
    };
  });
}

function buildPlatformActivities(
  requestedPlatforms: GrowthPlatform[],
  collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>,
  platformSnapshots: GrowthPlatformSnapshot[],
  platformRecommendations: GrowthPlatformRecommendation[],
): GrowthPlatformActivity[] {
  return requestedPlatforms.map((platform) => {
    const collection = collections[platform];
    const snapshot = platformSnapshots.find((item) => item.platform === platform);
    const recommendation = platformRecommendations.find((item) => parsePlatformFromRecommendation(item.name) === platform);
    const items = (collection?.items || []).filter((item) => item.contentType !== "topic" && item.bucket !== "douyin_topics");
    const hotTopics = items
      .slice()
      .sort((left, right) => ((right.likes || 0) + (right.views || 0) + (right.comments || 0) * 3) - ((left.likes || 0) + (left.views || 0) + (left.comments || 0) * 3))
      .slice(0, 4)
      .map((item) => item.title)
      .filter(Boolean);
    const activityLevel = items.length >= 40 ? "高" : items.length >= 15 ? "中" : "低";
    const suggestedTopics = recommendation?.topicIdeas?.slice(0, 3).map((item) => item.title)
      || snapshot?.sampleTopics?.slice(0, 3)
      || [];

    return {
      platform,
      platformLabel: PLATFORM_LABELS[platform],
      summary: snapshot?.summary || recommendation?.reason || "当前平台适合作为辅助发布阵地。",
      activityLevel,
      hotTopics,
      recommendedFormat: snapshot?.recommendedFormats?.[0] || recommendation?.playbook || "先做适配版再验证反馈。",
      contentAngle: snapshot?.fitLabel || "优先做结果更清楚、场景更具体的表达。",
      suggestedTopics,
    };
  });
}

function buildMonetizationStrategies(
  requestedPlatforms: GrowthPlatform[],
  platformRecommendations: GrowthPlatformRecommendation[],
  monetizationTracks: GrowthMonetizationTrack[],
  context: string,
  industryTemplate: GrowthIndustryTemplate,
): GrowthMonetizationStrategy[] {
  const primaryTrack = monetizationTracks[0]?.name || industryTemplate.primaryConversion;
  const offerType = industryTemplate.offerExamples[0] || industryTemplate.primaryConversion;
  const buildCallToAction = (track: string) => {
    if (track.includes("电商")) return "结尾只留商品页、橱窗或私信关键词其中一个动作。";
    if (track.includes("品牌")) return "引导用户看案例页、合作说明或留下合作关键词。";
    if (track.includes("咨询")) return "统一导向预约、私信关键词或方案咨询页。";
    if (track.includes("课程") || track.includes("知识")) return "引导进入方法清单、案例合集或轻量试学入口。";
    return `统一导向「${industryTemplate.primaryConversion}」这一条动作。`;
  };

  return requestedPlatforms.slice(0, 4).map((platform) => {
    const recommendation = platformRecommendations.find((item) => parsePlatformFromRecommendation(item.name) === platform) || platformRecommendations[0];
    return {
      platform,
      platformLabel: PLATFORM_LABELS[platform],
      primaryTrack,
      strategy: recommendation?.playbook || recommendation?.action || `先把 ${industryTemplate.painPoint} 讲成明确可执行的价值，再做单一路径承接。`,
      callToAction: buildCallToAction(primaryTrack),
      offerType,
      reason: recommendation?.reason || monetizationTracks[0]?.reason || `这个平台当前更适合验证「${primaryTrack}」这条商业路径。`,
    };
  });
}

function buildDataLibraryStructure(
  requestedPlatforms: GrowthPlatform[],
  collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>,
): GrowthDataLibrarySection[] {
  const activePlatforms = requestedPlatforms.filter((platform) => (collections[platform]?.items?.length || 0) > 0);
  return [
    {
      id: "creator-evidence",
      title: "创作者历史证据层",
      purpose: "把用户自己的投稿、表现和重复主题收进判断，不再用同一套模板回答所有人。",
      dataSources: ["video_submissions", "video_platform_links", "用户最近投稿历史"],
      coreFields: ["标题", "平台", "播放/点赞/评论/分享", "viral score", "重复主题"],
      outputBoards: ["个性化增长方向", "最优首发平台", "商业方向判断"],
    },
    {
      id: "platform-trend",
      title: "平台趋势活动层",
      purpose: "提取各平台当前活跃主题、内容结构和热点活动，决定同一主题应该怎么改写。",
      dataSources: activePlatforms.length ? activePlatforms.map((platform) => `${PLATFORM_LABELS[platform]} live collections`) : ["平台实时抓取样本"],
      coreFields: ["热点标题", "作者", "标签", "likes/comments/shares/views", "contentType", "bucket"],
      outputBoards: ["平台近期活动", "参考账号/话题", "推荐呈现方式"],
    },
    {
      id: "conversion-playbook",
      title: "商业承接策略层",
      purpose: "把内容表现和平台分发结果桥接到可执行的变现动作，而不是只给抽象建议。",
      dataSources: ["monetizationTracks", "platformRecommendations", "businessInsights"],
      coreFields: ["主商业路径", "平台打法", "CTA", "offer 类型", "验证动作"],
      outputBoards: ["平台商业变现策略", "现在就能执行的版本", "7天增长规划"],
    },
  ];
}

function buildBusinessInsights(
  analysis: GrowthAnalysisScores,
  context: string,
  monetizationTracks: GrowthMonetizationTrack[],
  industryTemplate: GrowthIndustryTemplate,
): GrowthBusinessInsight[] {
  const primaryTrack = monetizationTracks.find((track) => track.fit >= 60)?.name || "暂不主打变现";
  const playbook = buildTrackPlaybook(primaryTrack, context, industryTemplate, analysis);
  const beautyFashion = isBeautyFashionContext(context);
  const bookingStyle = /咨询|顾问|预约|服务|方案/.test(context);
  const commerceStyle = /带货|商品|单品|橱窗|电商/.test(context);
  const educationStyle = /课程|教学|知识|教程|训练营|陪跑/.test(context);
  const communityStyle = /社群|会员|私域/.test(context);
  const commerceDriven = /卖家|商品|电商|带货|陶瓷|瓷砖|家居|建材|橱窗|下单/.test(context);
  const sportsCommerce = isSportsCommerceContext(context);
  const primaryAction = primaryTrack === "品牌合作"
    ? (beautyFashion
        ? "先把你的内容改写成“场景痛点 + 解决方案 + 合作品类”的提案型表达，让品牌知道你能承接哪类问题。"
        : "先补一页案例或服务结果说明，让合作方一眼看懂你解决什么问题。")
    : primaryTrack === "电商带货"
      ? "先把内容改写成“结果前置 + 利益点 + 单一购买动作”，不要继续做泛讨论。"
      : primaryTrack === "知识付费"
        ? "先把内容整理成一套可重复讲述的方法，再把入口统一指向课程、模板或陪跑。"
        : primaryTrack === "暂不主打变现"
          ? "先解决内容入口、受众痛点、案例表达和结尾动作，不要急着在一条内容里塞进所有商业方向。"
          : "先验证你是否真的具备固定主题、固定更新和固定权益，再决定要不要做长期社群。";
  return [
    {
      title: "当前更该解决的问题",
      detail: `先把「${industryTemplate.painPoint}」讲成一句用户一看就懂的结果，不要继续堆解释。`,
    },
    {
      title: "中长期商业判断",
      detail: primaryTrack === "暂不主打变现"
        ? "当前不是不能变现，而是入口还不够清楚。先补角色、案例和承接动作。"
        : analysis.viralPotential >= 75
          ? `优先主打「${primaryTrack}」，因为现在更缺承接路径，不缺内容题材。`
          : `可以做「${primaryTrack}」，但要先把入口和成交理由说清。`,
    },
    {
      title: "为什么先做",
      detail: commerceDriven && primaryTrack === "电商带货"
        ? sportsCommerce
          ? "因为你卖的是健身器材和体育用品，用户最先要判断的是“适不适合我的训练场景、和普通器材差在哪、为什么现在值得买”。先把这三个问题讲透，才会有成交。"
          : "因为你当前是卖货场景，这条内容最缺的不是观点，而是让用户立刻判断“适不适合我、值不值得买、怎么买”。先把成交稿跑通，比先做知识付费或社群更直接。"
        : playbook.why,
    },
    {
      title: "中长期主承接动作",
      detail: bookingStyle
        ? "优先导向预约、咨询或方案沟通页，让用户快速判断你能不能帮他。"
        : commerceStyle
          ? "优先导向商品页或单品推荐，只保留一个购买动作。"
          : educationStyle
            ? "优先导向课程、模板或陪跑入口，重点讲方法、步骤和结果。"
            : communityStyle || primaryTrack === "社群会员"
            ? "只有你能稳定输出同主题内容并提供固定权益时，社群才值得做；否则先做轻私域测试。"
              : `${primaryAction} 先围绕「${industryTemplate.primaryConversion}」组织承接。`,
    },
    {
      title: "中长期成交说法",
      detail: commerceDriven && primaryTrack === "电商带货"
        ? sportsCommerce
          ? "先讲哪类训练人群适合、能解决什么训练问题、和普通器材差在哪，再补一个真实演示或买家反馈，最后只留一个购买动作。"
          : "先讲适合谁、解决什么、为什么值，再补一个真实使用证据，最后只留一个购买动作。不要再讲泛故事或空泛理念。"
        : primaryTrack === "品牌合作" && beautyFashion
        ? "不要写泛品牌合作，要直接写成可合作场景和品类。"
        : primaryTrack === "暂不主打变现"
          ? "先讲清你解决什么问题和能给什么结果，再谈商业化。"
        : `先只验证「${primaryTrack}」这一条路径，不要同时混多个方向。`,
    },
    {
      title: "中长期下一步落地",
      detail: commerceDriven && primaryTrack === "电商带货"
        ? sportsCommerce
          ? "按四步落地：1. 开头 3 秒直接说适合哪类训练人群；2. 中段演示一个训练场景和一个核心差异；3. 补参数对照或买家反馈；4. 结尾统一导向商品页、橱窗或私聊。"
          : "按四步落地：1. 开头 3 秒讲适合谁和结果；2. 中段只留 2 到 3 个利益点；3. 补一条信任证据；4. 结尾统一导向橱窗、评论区或私聊。"
        : playbook.action,
    },
    {
      title: "当前不要做",
      detail: playbook.avoid,
    },
  ];
}

function buildDashboardConsole(params: {
  analysis: GrowthAnalysisScores;
  context: string;
  requestedPlatforms: GrowthPlatform[];
  platformSnapshots: GrowthPlatformSnapshot[];
  monetizationTracks: GrowthMonetizationTrack[];
  platformRecommendations: GrowthPlatformRecommendation[];
  businessInsights: GrowthBusinessInsight[];
  industryTemplate: GrowthIndustryTemplate;
  referenceExamples?: GrowthReferenceExample[];
}) {
  const { analysis, context, requestedPlatforms, platformSnapshots, monetizationTracks, platformRecommendations, businessInsights, industryTemplate, referenceExamples = [] } = params;
  const topTrack = monetizationTracks[0];
  const secondTrack = monetizationTracks[1];
  const topPlatform = platformRecommendations[0]?.name || PLATFORM_LABELS[requestedPlatforms[0] || "douyin"];
  const primaryAudience = industryTemplate.audience.split("、")[0] || industryTemplate.audience;
  const readiness = Math.round((analysis.composition + analysis.impact + analysis.viralPotential) / 3);
  const primaryPlatformSnapshot = platformSnapshots.find((item) => item.displayName === topPlatform);
  const uploadEvidence = [
    analysis.strengths[0],
    analysis.improvements[0],
    analysis.summary,
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const buildEvidence = (sourceLabel: string, sampleLabel: string) => {
    const source = uploadEvidence[0] || industryTemplate.analysisHint;
    return `上传内容依据：${source}；样本依据：${sampleLabel || sourceLabel}`;
  };

  const buildFunnelStages = (base: number, labels: string[], details: string[]) =>
    labels.map((label, index) => ({
      id: `${label}-${index}`,
      label,
      value: clamp(Math.round(base - index * (12 + index * 3)), 18, 100),
      detail: details[index] || details[details.length - 1] || "保持单一路径推进。",
    }));

  const personalizedRecommendations = [
    {
      id: "audience-core",
      title: `先拿下「${primaryAudience}」`,
      audience: primaryAudience,
      why: compactAudienceReason(context, industryTemplate, businessInsights[0]?.detail || industryTemplate.painPoint),
      evidence: buildEvidence(industryTemplate.painPoint, industryTemplate.trustAsset),
      action: `先把内容改成“${industryTemplate.painPoint} -> ${industryTemplate.primaryConversion}”的单一转化稿。`,
    },
    {
      id: "track-core",
      title: `主打「${topTrack?.name || industryTemplate.primaryConversion}」路径`,
      audience: topTrack?.name || "高意向用户",
      why: topTrack?.reason || "当前这条路径最容易把内容和成交动作接起来。",
      evidence: buildEvidence(topTrack?.reason || industryTemplate.commercialFocus, industryTemplate.primaryConversion),
      action: topTrack?.nextStep || "先验证一个主承接动作，再决定是否扩量。",
    },
    {
      id: "platform-core",
      title: `${topPlatform} 先做首发验证`,
      audience: `${topPlatform} 首发人群`,
      why: platformRecommendations[0]?.reason || "当前平台匹配度最高，适合先用它拿反馈。",
      evidence: buildEvidence(
        platformRecommendations[0]?.reason || industryTemplate.analysisHint,
        primaryPlatformSnapshot?.summary || industryTemplate.trustAsset,
      ),
      action: platformRecommendations[0]?.action || "先做一版首发稿，再看是否扩到第二平台。",
    },
  ];

  return {
    headline: `${topPlatform} 先发，${topTrack?.name || industryTemplate.primaryConversion} 先跑，重点拿下 ${primaryAudience}`,
    summary: `${businessInsights[1]?.detail || "当前先把入口讲清楚。"} ${businessInsights[2]?.detail || ""}`.trim(),
    stats: [
      {
        id: "content_goal",
        label: "当前最该讲清",
        value: industryTemplate.painPoint,
        note: "前台只保留用户能直接理解的内容目标，不展示后台统计口径。",
        delta: "先讲用户会不会买",
      },
      {
        id: "readiness",
        label: "当前先改哪里",
        value: businessInsights[0]?.detail || industryTemplate.painPoint,
        note: "先把最影响成交判断的那一句讲透，不要继续堆背景和氛围。",
        delta: "先改前三秒",
      },
      {
        id: "distribution",
        label: "首发平台",
        value: topPlatform,
        note: platformRecommendations[0]?.reason || "先用最匹配平台拿首轮反馈。",
        delta: secondTrack ? `备选：${secondTrack.name}` : "单路径推进",
      },
      {
        id: "commercial",
        label: "当前主卖法",
        value: topTrack?.name || industryTemplate.primaryConversion,
        note: `围绕「${industryTemplate.primaryConversion}」只做一条主路径，不把多个商业动作混在同一条内容里。`,
        delta: "先跑通一条成交路",
      },
    ],
    trendSeries: [
      {
        id: "platform-fit",
        label: "各平台适配分",
        points: platformSnapshots.slice(0, 4).map((snapshot) => ({
          label: snapshot.displayName,
          value: snapshot.audienceFitScore,
        })),
      },
      {
        id: "conversion-readiness",
        label: "当前转化准备度",
        points: [
          { label: "内容入口", value: analysis.composition },
          { label: "停留钩子", value: analysis.impact },
          { label: "商业承接", value: topTrack?.fit || 0 },
          { label: "扩量潜力", value: analysis.viralPotential },
        ],
      },
      {
        id: "track-comparison",
        label: "候选变现路径分",
        points: monetizationTracks.slice(0, 4).map((track) => ({
          label: track.name,
          value: track.fit,
        })),
      },
    ],
    conversionFunnels: [
      {
        id: "cold-audience",
        label: "冷流量转化漏斗",
        persona: `首次刷到你的 ${primaryAudience}`,
        conversionGoal: "先停留，再收藏，再产生咨询意愿",
        preferredPlatform: topPlatform,
        trigger: "结果先出、问题明确、能立刻看懂自己为什么要继续看",
        action: "首屏只保留一个结果和一个动作，不解释行业背景。",
        stages: buildFunnelStages(
          Math.max(82, readiness),
          ["刷到内容", "停留看完", "收藏 / 点赞", "评论 / 私信", "预约 / 咨询"],
          [
            "先让用户在 2 秒内看懂结果。",
            "中段只保留最关键的 2 到 3 个证据。",
            "结尾给收藏理由，而不是讲理念。",
            "评论区只留一个问题，引导对话。",
            "最后把动作统一到咨询或方案入口。",
          ],
        ),
      },
      {
        id: "problem-aware",
        label: "问题明确用户漏斗",
        persona: `已经意识到「${industryTemplate.painPoint}」的人`,
        conversionGoal: `从“知道问题”推进到「${topTrack?.name || "主承接"}」`,
        preferredPlatform: platformRecommendations[1]?.name || topPlatform,
        trigger: "用案例、对比和误区拆解建立信任，而不是泛讲观点",
        action: topTrack?.nextStep || "先用单一路径验证转化动作。",
        stages: buildFunnelStages(
          Math.max(76, (topTrack?.fit || readiness) + 6),
          ["看到问题", "认可方法", "索取案例", "进入私域 / 预约", "形成成交"],
          [
            "先点出他正在损失什么。",
            "用框架和案例证明方法有效。",
            "给出可领取资料或案例包。",
            "引导进私域或预约诊断。",
            "把成交理由统一成一个主方案。",
          ],
        ),
      },
      {
        id: "high-intent",
        label: "高意向客户漏斗",
        persona: "已经在比较解决方案的高意向客户",
        conversionGoal: "缩短决策时间，直接推进成交",
        preferredPlatform: topPlatform,
        trigger: "结果证明、案例可信、承接页清楚",
        action: `重点补齐 ${industryTemplate.trustAsset}，并把承接页只留一个报价或预约动作。`,
        stages: buildFunnelStages(
          Math.max(70, (secondTrack?.fit || topTrack?.fit || readiness) + 4),
          ["看到案例", "确认适配", "咨询方案", "比较报价", "成交 / 复购"],
          [
            "先让客户知道你做过什么结果。",
            "明确适合谁，不适合谁。",
            "咨询入口只留一个方案动作。",
            "报价前先讲清服务边界。",
            "把成交后的复购场景一起设计进去。",
          ],
        ),
      },
    ],
    personalizedRecommendations,
    referenceExamples,
  };
}

function buildReferenceExamples(
  requestedPlatforms: GrowthPlatform[],
  collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>>,
  context: string,
  industryTemplate: GrowthIndustryTemplate,
): GrowthReferenceExample[] {
  const contextKeywords = extractContextKeywords(context);
  const commerceDriven = /卖家|商品|电商|带货|陶瓷|瓷砖|家居|建材|橱窗|下单/.test(context);
  const items = requestedPlatforms.flatMap((platform) => {
    const collection = collections[platform];
    if (!collection?.items?.length) return [];
    return collection.items
      .map((item) => ({ platform, item }))
      .filter(({ item }) => {
        const haystack = `${item.title} ${item.author || ""} ${normalizeStringList(item.tags).join(" ")} ${normalizeStringList(item.industryLabels).join(" ")}`;
        if (!contextKeywords.length) return true;
        return contextKeywords.some((keyword) => haystack.includes(keyword));
      });
  });

  const scored = items
    .map(({ platform, item }) => {
      const haystack = `${item.title} ${normalizeStringList(item.tags).join(" ")} ${normalizeStringList(item.industryLabels).join(" ")}`;
      const keywordHits = contextKeywords.reduce((sum, keyword) => sum + (haystack.includes(keyword) ? 1 : 0), 0);
      const engagement = (item.likes || 0) + (item.comments || 0) * 3 + (item.shares || 0) * 5 + Math.round((item.views || 0) / 1000);
      return {
        platform,
        item,
        score: keywordHits * 40 + engagement,
      };
    })
    .sort((left, right) => right.score - left.score);

  const deduped = new Map<string, { platform: GrowthPlatform; item: PlatformTrendCollection["items"][number]; score: number }>();
  for (const entry of scored) {
    const key = `${entry.platform}:${entry.item.author || entry.item.id}`;
    if (!deduped.has(key)) deduped.set(key, entry);
    if (deduped.size >= 6) break;
  }

  return Array.from(deduped.values()).slice(0, 6).map(({ platform, item }, index) => ({
    id: `reference-${platform}-${item.id}-${index}`,
    platform,
    platformLabel: PLATFORM_LABELS[platform],
    account: item.author || `${PLATFORM_LABELS[platform]} 参考账号`,
    title: item.title,
    url: item.url,
    reason: commerceDriven
      ? `这条内容和你同样偏成交场景，优先讲适合谁、解决什么、为什么值得买，比泛介绍更容易转化。`
      : `这条内容能跑起来，是因为它把「${industryTemplate.painPoint}」讲得更具体，用户一眼能看懂自己为什么要继续看。`,
    production: commerceDriven
      ? "制作方式：开头先讲用户场景和结果，中段只留 2 到 3 个利益点，补一个真实证据，结尾只留一个动作。"
      : `制作方式：按“痛点 -> 做法 -> 证据 -> 动作”组织，不平铺过程。可重点参考：${industryTemplate.trustAsset}`,
    conversion: commerceDriven
      ? "转化方式：优先导向橱窗、商品页、评论区关键词或私聊，不同时给多个动作。"
      : `转化方式：围绕「${industryTemplate.primaryConversion}」做单一路径承接，不把多个商业方向混在一条内容里。`,
  }));
}

function compactAudienceReason(context: string, industryTemplate: GrowthIndustryTemplate, fallback: string) {
  const contextLabel = String(context || "").trim();
  if (!contextLabel) return fallback;
  const shortened = contextLabel.length > 20 ? `${contextLabel.slice(0, 19)}…` : contextLabel;
  return `你的业务背景是「${shortened}」，所以推荐先集中服务最容易被 ${industryTemplate.primaryConversion} 打动的人群。`;
}

function summarizeBusinessContext(context: string) {
  const keywords = extractContextKeywords(context).slice(0, 3);
  return keywords.length ? keywords.join(" / ") : "当前业务";
}

function creationStructureHint(platformLabel: string) {
  if (platformLabel.includes("小红书")) return "封面先写结果，正文按痛点、做法、证据、动作四段展开。";
  if (platformLabel.includes("B站")) return "先讲结果，再拆步骤和案例，最后补方法与动作。";
  return "前 3 秒先给结果，中段只留 2 到 3 个证据点，结尾只保留一个动作。";
}

function buildDecisionFramework(params: {
  analysis: GrowthAnalysisScores;
  context: string;
  industryTemplate: GrowthIndustryTemplate;
  platformRecommendations: GrowthPlatformRecommendation[];
  monetizationTracks: GrowthMonetizationTrack[];
  businessInsights: GrowthBusinessInsight[];
  platformSnapshots: GrowthPlatformSnapshot[];
}): GrowthDecisionFramework {
  const { analysis, context, industryTemplate, platformRecommendations, monetizationTracks, businessInsights, platformSnapshots } = params;
  const topPlatform = platformRecommendations[0]?.name || PLATFORM_LABELS[platformSnapshots[0]?.platform || "xiaohongshu"];
  const topTrack = monetizationTracks[0];
  const secondTrack = monetizationTracks[1];
  const primarySnapshot = platformSnapshots[0];
  const contextHint = summarizeBusinessContext(context);
  const audienceTriggers: GrowthAudienceTrigger[] = [
    {
      label: "生活方式投射",
      reason: "素材先让用户投射自己想进入的状态，再决定要不要继续看。",
      example: "把赛场、工作或训练场景改写成普通人也能代入的版本。",
    },
    {
      label: "结果先行",
      reason: "先让用户看到结果或反差，比先铺背景更容易停留。",
      example: "开头先说适合谁、解决什么，再补过程和细节。",
    },
    {
      label: "可收藏表达",
      reason: "收藏来自可复用，不来自抽象评价。",
      example: "把内容写成清单、步骤、对照或避坑，而不是只讲感受。",
    },
  ];
  return {
    materialFacts: [
      { title: "素材里真正可用的信号", detail: analysis.strengths[0] || analysis.summary || "当前素材有可放大的视觉或叙事信号。" },
      { title: "当前最大错位", detail: analysis.improvements[0] || `素材表达和「${contextHint}」之间还缺一层桥接。` },
      { title: "先别套现成模板", detail: "先围绕已出现的画面、情绪和动作做判断，不要直接跳到泛商业母版。" },
    ],
    businessTranslation: [
      { title: "这条素材更像什么", detail: topTrack?.reason || `更像一条先吸引目标用户、再承接「${industryTemplate.primaryConversion}」的前置素材。` },
      { title: "它先该卖什么价值", detail: `先把价值收敛到「${topTrack?.name || industryTemplate.primaryConversion}」这一条，不要同时塞多个方向。` },
      { title: "最合理的桥接方式", detail: businessInsights[2]?.detail || `先讲用户问题，再把素材转成 ${industryTemplate.primaryConversion} 的入口。` },
    ],
    evidenceSignals: [
      { title: "视频证据", detail: analysis.summary || "素材本身提供了可转译的内容抓手。", source: "video" },
      { title: "平台证据", detail: primarySnapshot?.summary || `${topPlatform} 目前是更适合先拿反馈的平台。`, source: "platform-data" },
      { title: "业务证据", detail: context.trim() || "当前先按用户输入的业务目标收敛。", source: "business-context" },
    ],
    mainPath: {
      title: topTrack?.name || industryTemplate.primaryConversion,
      summary: businessInsights[1]?.detail || `当前先围绕「${topTrack?.name || industryTemplate.primaryConversion}」做单一路径验证。`,
      whyNow: businessInsights[3]?.detail || `先让 ${topPlatform} 跑出第一轮反馈，再决定是否扩第二条商业路径。`,
      nextAction: topTrack?.nextStep || businessInsights[0]?.detail || "先把内容改成一个用户一看就懂、且愿意继续看的版本。",
    },
    avoidPaths: [
      {
        title: secondTrack?.name || "多路径并行",
        reason: businessInsights[businessInsights.length - 1]?.detail || "当前最该避免的是还没验证入口，就同时推多个商业方向。",
      },
    ],
    assetAdaptation: {
      format: topPlatform.includes("小红书") ? "图文 / 封面强标题版" : "短视频 / 结果前置版",
      firstHook: analysis.titleSuggestions?.[0] || "开头先给结果、适合谁和为什么值得继续看。",
      structure: creationStructureHint(topPlatform),
      callToAction: topTrack?.nextStep || `结尾只留一个动作，统一导向「${industryTemplate.primaryConversion}」。`,
    },
    validationPlan: [
      { label: "首发验证", successSignal: `看 ${topPlatform} 的停留、收藏、评论是否真的围绕核心问题。`, nextMove: "如果反馈聚焦，就继续做第二版；如果散掉，就只改开头和标题。" },
      { label: "承接验证", successSignal: "看用户是否愿意点击、私信、咨询或进入下一步。", nextMove: "如果没有承接动作，就先补清晰 CTA，不要继续加解释。" },
      { label: "放大验证", successSignal: "确认用户是被什么理由打动，而不是只看虚高曝光。", nextMove: "只保留最有效的卖点，再决定是否扩第二平台。" },
    ],
    audienceTriggers,
  };
}

function buildGrowthPlan(
  analysis: GrowthAnalysisScores,
  platformRecommendations: GrowthPlatformRecommendation[],
  monetizationTracks: GrowthMonetizationTrack[],
  industryTemplate: GrowthIndustryTemplate,
  context: string,
): GrowthPlanStep[] {
  const topPlatform = platformRecommendations[0]?.name || "小红书";
  const topTrack = monetizationTracks[0]?.name || industryTemplate.primaryConversion;
  const commerceDriven = /带货|商品|电商|卖家|陶瓷|瓷砖|家居|建材|橱窗|下单/.test(context);
  const storyboardTarget = commerceDriven
    ? "把视频改成“结果 + 使用场景 + 利益点 + 一个购买动作”"
    : `把内容改成更适合 ${topTrack} 承接的版本`;
  return [
    { day: 1, title: "先重写成交开头", action: `${storyboardTarget}，开头 3 秒先讲“适合谁、解决什么、为什么值得看”。` },
    { day: 2, title: "补信任证据", action: `补 2 个信任证据：${industryTemplate.trustAsset}。不要再只讲氛围或抽象观点。` },
    { day: 3, title: "补成交动作", action: commerceDriven ? "结尾只留一个动作：进橱窗、私信关键词或看商品页，不要同时留多个动作。" : `把结尾统一到「${industryTemplate.primaryConversion}」这条路径。` },
    { day: 4, title: "首发验证", action: `先在 ${topPlatform} 发第一版，重点看停留、收藏、评论和咨询是否真的围绕「${industryTemplate.painPoint}」。` },
    { day: 5, title: "二改节奏", action: "根据首发反馈删掉解释段，把弱镜头删掉，保留最能成交的 3 个信息点。" },
    { day: 6, title: "扩第二版本", action: commerceDriven ? "补一版买家视角或使用场景版，再补一版参数/对比版，不要复读同一条。" : "把首发版拆成案例版和方法版，分别测试收藏与咨询。" },
    {
      day: 7,
      title: "复盘成交理由",
      action: analysis.viralPotential >= 75
        ? `复盘用户最终是因为什么动作转化，再决定是否继续放大「${topTrack}」路径。`
        : "复盘用户没转化是因为开头、利益点、信任证据还是动作不够清楚，再定下一轮只改一个点。",
    },
  ];
}

function buildCreationAssist(
  analysis: GrowthAnalysisScores,
  context: string,
  platformRecommendations: GrowthPlatformRecommendation[],
  monetizationTracks: GrowthMonetizationTrack[],
) {
  const primaryTrack = monetizationTracks[0]?.name || "品牌合作";
  const primaryPlatform = platformRecommendations[0]?.name || "小红书";
  const backgroundLine = context.trim()
    ? `业务背景：${context.trim()}`
    : "业务背景：未填写，建议补充目标受众、成交方式和想放大的内容主题。";
  const titleLines = analysis.titleSuggestions?.length
    ? `备选标题：${analysis.titleSuggestions.slice(0, 5).join(" / ")}`
    : "备选标题：先把结果、适合谁、为什么值得看写进标题。";
  const timestampLines = analysis.timestampSuggestions?.length
    ? `秒点优化：${analysis.timestampSuggestions.slice(0, 3).map((item) => `${item.timestamp} ${item.fix}`).join("；")}`
    : "秒点优化：前 3 秒先讲结果，中段只保留最能证明观点的镜头。";
  const weakFrameLines = analysis.weakFrameReferences?.length
    ? `弱帧参考：${analysis.weakFrameReferences.slice(0, 2).map((item) => `${item.timestamp} ${item.reason}，改法：${item.fix}`).join("；")}`
    : "弱帧参考：删掉与主结论无关的弱镜头，保留最能成交的证据镜头。";
  const assetExtensions = (analysis.commercialAngles || []).slice(0, 3).map((angle, index) => ({
    id: `asset-${index + 1}`,
    title: angle.title,
    scenario: angle.scenario,
    commercialGoal: angle.brands?.join("、") || primaryTrack,
    bridgeReason: angle.whyItFits,
    transitionIdea: angle.hook,
    sourceCue: angle.execution,
    veoPrompt: angle.veoPrompt,
    executionNotes: `${angle.execution}；合作品牌方向：${angle.brands?.join("、") || "待确认"}`,
  }));

  return {
    brief: [
      `内容目标：把当前素材升级成更适合 ${primaryPlatform} 分发，并服务于「${primaryTrack}」转化的内容版本。`,
      `核心分析：${analysis.summary}`,
      titleLines,
      timestampLines,
      weakFrameLines,
      "开场建议：前 2-3 秒先给结果、反差或利益点，不要从铺垫开始。",
      "商业动作：结尾必须补 CTA，把观众导向案例咨询、服务介绍、商品入口或私域承接。",
      backgroundLine,
    ].join("\n"),
    storyboardPrompt: `请基于这条素材，输出一个适合 ${primaryPlatform} 的短视频脚本。要求：结果前置、3 段式结构、结尾加 ${primaryTrack} 对应的 CTA，并直接吸收这些秒点建议：${timestampLines}。${backgroundLine}`,
    workflowPrompt: `请把这条内容拆成可执行工作流：封面标题、开场钩子、主体结构、结尾 CTA、平台适配版本，并结合这些弱帧修正：${weakFrameLines}。优先服务于 ${primaryTrack} 转化。`,
    assetExtensions,
  };
}

function buildGrowthHandoff(
  context: string,
  requestedPlatforms: GrowthPlatform[],
  platformRecommendations: GrowthPlatformRecommendation[],
  monetizationTracks: GrowthMonetizationTrack[],
  creationAssist: ReturnType<typeof buildCreationAssist>,
) {
  const recommendedTrack = monetizationTracks[0]?.name || "品牌合作";
  const recommendedPlatform =
    PLATFORM_BY_LABEL[platformRecommendations[0]?.name || ""]
    || requestedPlatforms[0]
    || "xiaohongshu";
  return {
    brief: creationAssist.brief,
    storyboardPrompt: creationAssist.storyboardPrompt,
    workflowPrompt: creationAssist.workflowPrompt,
    recommendedTrack,
    recommendedPlatforms: [recommendedPlatform],
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
  const referenceExamples = buildReferenceExamples(requestedPlatforms, {}, context, industryTemplate);
  const monetizationTracks = buildMonetizationTracks(params.analysis, context, platformSnapshots, industryTemplate);
  const platformRecommendations = buildPlatformRecommendations(requestedPlatforms, params.analysis, platformSnapshots, {}, context, industryTemplate);
  const titleExecutions = buildTitleExecutions(params.analysis, context, platformRecommendations, platformSnapshots, industryTemplate);
  const platformActivities = buildPlatformActivities(requestedPlatforms, {}, platformSnapshots, platformRecommendations);
  const monetizationStrategies = buildMonetizationStrategies(requestedPlatforms, platformRecommendations, monetizationTracks, context, industryTemplate);
  const dataLibraryStructure = buildDataLibraryStructure(requestedPlatforms, {});
  const businessInsights = buildBusinessInsights(params.analysis, context, monetizationTracks, industryTemplate);
  const dashboardConsole = buildDashboardConsole({
    analysis: params.analysis,
    context,
    requestedPlatforms,
    platformSnapshots,
    monetizationTracks,
    platformRecommendations,
    businessInsights,
    industryTemplate,
    referenceExamples,
  });
  const growthPlan = buildGrowthPlan(params.analysis, platformRecommendations, monetizationTracks, industryTemplate, context);
  const creationAssist = buildCreationAssist(params.analysis, context, platformRecommendations, monetizationTracks);
  const decisionFramework = buildDecisionFramework({
    analysis: params.analysis,
    context,
    industryTemplate,
    platformRecommendations,
    monetizationTracks,
    businessInsights,
    platformSnapshots,
  });

  const today = new Date();
  const generatedAt = today.toISOString();
  const windowDays = DEFAULT_GROWTH_WINDOW_DAYS;
  const overview = {
    summary: `趋势模块当前返回的是可落地 mock/fallback 结构，但字段已经按 ${windowDays} 天平台抓取需求设计，后续接入真实采集后可直接替换数据源。`,
    trendNarrative:
      params.analysis.impact >= 72
        ? "当前内容更适合先打强钩子和快节奏平台，再用拆解版承接长尾讨论。"
        : "当前内容更适合先做结构重写和封面测试，再逐步扩到分发平台。",
    nextCollectionPlan: `预留了平台快照、热门结构模式和机会点三类对象，后续爬虫只需要填充 ${windowDays} 天窗口指标即可。`,
  };

  const snapshot = {
    status: {
      source: "fallback",
      generatedAt,
      windowDays,
      freshnessLabel: `结构化参考样本，非真实 ${windowDays} 天历史库`,
      collectorReady: false,
      missingConnectors: [
        "douyin.trends.fetch30d",
        "xiaohongshu.trends.fetch30d",
        "bilibili.trends.fetch30d",
      ],
      notes: [
        `当前为结构化 fallback 数据，不代表真实 ${windowDays} 天平台历史统计。`,
        `字段已按后续真实抓取任务需要的 ${windowDays} 天窗口指标展开。`,
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
    titleExecutions,
    platformActivities,
    monetizationStrategies,
    dataLibraryStructure,
    businessInsights,
    decisionFramework,
    dashboardConsole,
    growthPlan,
    creationAssist,
    growthHandoff: buildGrowthHandoff(context, requestedPlatforms, platformRecommendations, monetizationTracks, creationAssist),
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
  const windowDays = Math.max(DEFAULT_GROWTH_WINDOW_DAYS, ...activeCollections.map((collection) => collection.windowDays || 0));
  const industryTemplate = matchIndustryTemplate(context, [
    params.analysis.summary,
    ...params.analysis.strengths,
    ...params.analysis.improvements,
    ...activeCollections.flatMap((collection) => collection.items.slice(0, 6).map((item) => item.title)),
  ]);
  const monetizationTracks = buildMonetizationTracks(params.analysis, context, platformSnapshots, industryTemplate);
  const platformRecommendations = buildPlatformRecommendations(requestedPlatforms, params.analysis, platformSnapshots, params.collections, context, industryTemplate);
  const titleExecutions = buildTitleExecutions(params.analysis, context, platformRecommendations, platformSnapshots, industryTemplate);
  const platformActivities = buildPlatformActivities(requestedPlatforms, params.collections, platformSnapshots, platformRecommendations);
  const monetizationStrategies = buildMonetizationStrategies(requestedPlatforms, platformRecommendations, monetizationTracks, context, industryTemplate);
  const dataLibraryStructure = buildDataLibraryStructure(requestedPlatforms, params.collections);
  const businessInsights = buildBusinessInsights(params.analysis, context, monetizationTracks, industryTemplate);
  const referenceExamples = buildReferenceExamples(requestedPlatforms, params.collections, context, industryTemplate);
  const dashboardConsole = buildDashboardConsole({
    analysis: params.analysis,
    context,
    requestedPlatforms,
    platformSnapshots,
    monetizationTracks,
    platformRecommendations,
    businessInsights,
    industryTemplate,
    referenceExamples,
  });
  const growthPlan = buildGrowthPlan(params.analysis, platformRecommendations, monetizationTracks, industryTemplate, context);
  const creationAssist = buildCreationAssist(params.analysis, context, platformRecommendations, monetizationTracks);
  const decisionFramework = buildDecisionFramework({
    analysis: params.analysis,
    context,
    industryTemplate,
    platformRecommendations,
    monetizationTracks,
    businessInsights,
    platformSnapshots,
  });

  const snapshot = {
    status: {
      source: missingPlatforms.length ? "hybrid" : "live",
      generatedAt: new Date().toISOString(),
      windowDays,
      freshnessLabel: missingPlatforms.length ? `当前 live sample + 结构化补位，并非完整 ${windowDays} 天历史库` : `当前 live sample，非完整 ${windowDays} 天历史库`,
      collectorReady: true,
      missingConnectors: missingPlatforms.map((platform) => `${platform}.trends.fetch30d`),
      notes: [
        livePlatforms.length
          ? `已接入真实抓取平台：${livePlatforms.map((platform) => PLATFORM_LABELS[platform]).join("、")}。`
          : "当前没有已接入的真实抓取平台。",
        `当前实时数据来自平台热门样本，不等于完整 ${windowDays} 天历史数据仓。`,
        ...activeCollections.flatMap((item) => item.notes.slice(0, 2)),
        ...Object.entries(params.errors || {}).map(([platform, error]) => `${PLATFORM_LABELS[platform as GrowthPlatform] || platform}：${error}`),
      ],
    },
    requestedPlatforms,
    industryTemplate,
    overview: {
      summary: `趋势模块已经开始消费真实平台实时样本，并保留 fallback 结构；当前仍是样本级参考，不应表述为完整 ${windowDays} 天历史库。`,
      trendNarrative:
        params.analysis.impact >= 72
          ? "当前内容适合先打强钩子和分发效率高的平台，再用拆解版和幕后版承接长尾讨论。"
          : "当前内容更适合先做结构重写、封面测试和平台化版本，再逐步扩大投放。",
      nextCollectionPlan: `继续扩展采样深度、增加多页抓取和定时调度，再把当前 live sample 收敛成稳定的 ${windowDays} 天趋势库。`,
    },
    trendLayers: buildTrendLayers(requestedPlatforms, params.collections),
    topicLibrary: buildTopicLibrary(requestedPlatforms, params.collections, context, industryTemplate),
    platformSnapshots,
    contentPatterns: buildContentPatternsFromCollections(activeCollections),
    opportunities: buildOpportunitiesFromCollections(activeCollections, requestedPlatforms),
    structurePatterns: buildStructurePatterns(params.analysis, requestedPlatforms, activeCollections),
    monetizationTracks,
    platformRecommendations,
    titleExecutions,
    platformActivities,
    monetizationStrategies,
    dataLibraryStructure,
    businessInsights,
    decisionFramework,
    dashboardConsole,
    growthPlan,
    creationAssist,
    growthHandoff: buildGrowthHandoff(context, requestedPlatforms, platformRecommendations, monetizationTracks, creationAssist),
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
    titleSuggestions: [],
    creatorCenterSignals: [],
    timestampSuggestions: [],
    weakFrameReferences: [],
    commercialAngles: [],
    followUpPrompt: "",
  },
  context: "城市夜景航拍",
});
