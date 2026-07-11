/**
 * 高级预测引擎：对齐智库报告「爆款决策与增长管线」字段（结合内容蓝图与历史窗口数据推演）。
 * 前后端共用：付费入库与锁定态示意预览必须同一套逻辑与同一组输入，避免「外制 Demo」。
 */

import type { AdvancedAIReportData, AdvancedAIReportMABVariant } from "./advancedAIReport";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** 由字符串种子产生 [0,1) 伪随机，同一输入同结果。 */
export function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

function jitter(seed: string, salt: string, amplitude: number): number {
  const u = hash01(`${seed}::${salt}`);
  return (u - 0.5) * 2 * amplitude;
}

export function predictViewsAdvanced(contentBlueprint: unknown, platformData: { platform?: string }): number {
  const platform = (platformData.platform || "douyin").toLowerCase();
  let baseViews = platform === "bilibili" ? 500_000 : 1_000_000;
  const text = JSON.stringify(contentBlueprint);
  const seed = text.slice(0, 2000);

  if (text.includes("女性") && (text.includes("情绪") || text.includes("内耗") || text.includes("银发"))) baseViews *= 1.6;
  if (text.includes("跨界美学") || text.includes("跨界")) baseViews *= 1.5;
  if (text.includes("爵士乐") || text.includes("爵士")) baseViews *= 1.8;
  if (text.includes("史记") || text.includes("战国") || text.includes("文物") || text.includes("唐诗")) baseViews *= 1.35;

  const variance = jitter(seed, "views", 0.1);
  return Math.round(baseViews * (1 + variance));
}

export function predictConversionRateAdvanced(
  contentBlueprint: unknown,
  thinkingLevel: "HIGH" | "MEDIUM",
): number {
  const text = JSON.stringify(contentBlueprint);
  const seed = text.slice(0, 2000);
  let baseRate = thinkingLevel === "HIGH" ? 8.0 : 5.0;

  if (text.includes("医学卫教") || text.includes("预防医学") || text.includes("生命科学") || text.includes("康养")) baseRate += 3.5;
  if (text.includes("史记") || text.includes("文物") || text.includes("唐诗") || text.includes("元曲")) baseRate += 1.5;
  if (text.includes("情感疗愈") || text.includes("生活美学") || text.includes("觉察")) baseRate += 1.5;

  const variance = jitter(seed, "conv", 0.1);
  return parseFloat(clamp(baseRate * (1 + variance), 1, 25).toFixed(2));
}

/** 品牌基因契合度 0–100（进度条） */
export function calculateIPFit(contentBlueprint: unknown, userProfile: { brandGenes: string[] }): number {
  const text = JSON.stringify(contentBlueprint);
  const genes = userProfile.brandGenes.filter(Boolean);
  let hits = 0;
  for (const g of genes) {
    if (text.includes(g)) {
      hits++;
      continue;
    }
    if (g === "生活美学" && (text.includes("生活美学") || text.includes("审美"))) hits++;
    else if (g === "生命科学" && (text.includes("生命") || text.includes("觉察"))) hits++;
    else if (g === "古典对照" && (text.includes("史记") || text.includes("唐诗") || text.includes("文物"))) hits++;
  }
  const base = 38;
  const add = genes.length ? Math.min(58, (hits / genes.length) * 55 + hits * 6) : 20;
  return Math.round(clamp(base + add, 0, 100));
}

/**
 * UCB1：以 clicks/impressions 为报酬；冷启动优先未曝光臂。
 */
export function calculateAdvancedMABVariant(
  variants: Array<{ id: string; title: string; impressions: number; clicks: number }>,
): string {
  if (!variants.length) return "";
  const totalImpressions = variants.reduce((sum, v) => sum + v.impressions, 0);
  if (totalImpressions === 0) return variants[0].id;

  for (const v of variants) {
    if (v.impressions === 0) return v.id;
  }

  let bestVariantId = variants[0].id;
  let maxUcb = -Infinity;
  for (const v of variants) {
    const meanReward = v.clicks / v.impressions;
    const bonus = Math.sqrt((2 * Math.log(totalImpressions)) / v.impressions);
    const ucb = meanReward + bonus;
    if (ucb > maxUcb) {
      maxUcb = ucb;
      bestVariantId = v.id;
    }
  }
  return bestVariantId;
}

function radarFromBlueprint(text: string, seed: string): AdvancedAIReportData["globalPredictions"]["hitPotentialRadar"] {
  let views = 72;
  let conversion = 70;
  let brandFit = 68;
  let platformPotential = 75;
  let mabEfficiency = 78;

  if (text.includes("女性") && (text.includes("情绪") || text.includes("内耗"))) {
    views += 8;
    brandFit += 6;
  }
  if (text.includes("史记") || text.includes("文物") || text.includes("唐诗") || text.includes("银发")) {
    views += 8;
    platformPotential += 6;
  }
  if (text.includes("爵士")) {
    conversion += 7;
    mabEfficiency += 5;
  }

  const j = (k: string, max = 6) => jitter(seed, k, max);
  return {
    views: Math.round(clamp(views + j("r1"), 40, 98)),
    conversion: Math.round(clamp(conversion + j("r2"), 40, 98)),
    brandFit: Math.round(clamp(brandFit + j("r3"), 40, 98)),
    platformPotential: Math.round(clamp(platformPotential + j("r4"), 40, 98)),
    mabEfficiency: Math.round(clamp(mabEfficiency + j("r5"), 40, 98)),
  };
}

type SimRadar = AdvancedAIReportData["globalPredictions"]["hitPotentialRadar"];

/**
 * 各主战场典型五维轮廓（与 {@link radarFromBlueprint} 的全局雷达解耦）。
 * 抖音偏传播与爆款势能、小红书偏转化与品牌契合、B 站偏深度与赛马验证等，避免两张雷达仅是缩放关系。
 */
const PLATFORM_RADAR_SILHOUETTE: Record<string, SimRadar> = {
  douyin: { views: 86, conversion: 62, brandFit: 56, platformPotential: 91, mabEfficiency: 73 },
  xiaohongshu: { views: 54, conversion: 78, brandFit: 91, platformPotential: 58, mabEfficiency: 69 },
  bilibili: { views: 48, conversion: 74, brandFit: 76, platformPotential: 66, mabEfficiency: 89 },
  kuaishou: { views: 89, conversion: 56, brandFit: 52, platformPotential: 87, mabEfficiency: 77 },
};

function normalizePlatformRadarKey(platformKey: string): string {
  const p = String(platformKey || "douyin").toLowerCase();
  if (p === "xiaohongshu" || p === "bilibili" || p === "kuaishou" || p === "douyin") return p;
  return "douyin";
}

/** 依蓝图关键词给予较轻的轴向 nudge（纯平台雷达用，强度低于全局）。 */
function applyBlueprintRadarNudgesForPlatformSlice(text: string, r: SimRadar, strength: number): SimRadar {
  const k = strength;
  let { views, conversion, brandFit, platformPotential, mabEfficiency } = r;

  if (text.includes("女性") && (text.includes("情绪") || text.includes("内耗"))) {
    brandFit += Math.round(6 * k);
    views += Math.round(4 * k);
  }
  if (text.includes("史记") || text.includes("文物") || text.includes("唐诗") || text.includes("银发")) {
    views += Math.round(6 * k);
    platformPotential += Math.round(6 * k);
  }
  if (text.includes("爵士")) {
    conversion += Math.round(5 * k);
    mabEfficiency += Math.round(4 * k);
  }

  return { views, conversion, brandFit, platformPotential, mabEfficiency };
}

/** 平台切片雷达：以平台轮廓为主体 + 蓝图弱调 + 独立种子抖动，形状与全局面板显着不同。 */
function platformHitPotentialRadarFromBlueprint(text: string, seed: string, platformKey: string): SimRadar {
  const key = normalizePlatformRadarKey(platformKey);
  let base = { ...PLATFORM_RADAR_SILHOUETTE[key] };
  base = applyBlueprintRadarNudgesForPlatformSlice(text, base, 0.52);
  const j = (salt: string, max = 11) => jitter(`${seed}|platformRadar|${key}`, salt, max);
  return {
    views: Math.round(clamp(base.views + j("v"), 40, 98)),
    conversion: Math.round(clamp(base.conversion + j("c"), 40, 98)),
    brandFit: Math.round(clamp(base.brandFit + j("b"), 40, 98)),
    platformPotential: Math.round(clamp(base.platformPotential + j("p"), 40, 98)),
    mabEfficiency: Math.round(clamp(base.mabEfficiency + j("m"), 40, 98)),
  };
}

/**
 * 旧存档缺少 `platformHitPotentialRadar` 时，依主战场 key 补一张与全局不成比例的切片雷达（供仪表盘显示）。
 */
export function fallbackPlatformHitPotentialRadar(platformKey: string, seed: string): SimRadar {
  const key = normalizePlatformRadarKey(platformKey);
  const base = { ...PLATFORM_RADAR_SILHOUETTE[key] };
  const j = (salt: string, max = 12) => jitter(`${seed}|platformRadarLegacy|${key}`, salt, max);
  return {
    views: Math.round(clamp(base.views + j("v"), 40, 98)),
    conversion: Math.round(clamp(base.conversion + j("c"), 40, 98)),
    brandFit: Math.round(clamp(base.brandFit + j("b"), 40, 98)),
    platformPotential: Math.round(clamp(base.platformPotential + j("p"), 40, 98)),
    mabEfficiency: Math.round(clamp(base.mabEfficiency + j("m"), 40, 98)),
  };
}

const PLATFORM_LABEL_ZH: Record<string, string> = {
  douyin: "抖音",
  bilibili: "B站",
  xiaohongshu: "小红书",
  kuaishou: "快手",
};

function buildMabVariantsFromTitles(
  v1Title: string,
  v2Title: string,
  blueprintText: string,
): AdvancedAIReportMABVariant[] {
  const impressions = 1200;
  const clicksA = Math.round(impressions * (0.08 + hash01(blueprintText + "a") * 0.04));
  const clicksB = Math.round(impressions * (0.05 + hash01(blueprintText + "b") * 0.05));
  const ucbPick = calculateAdvancedMABVariant([
    { id: "v1", title: v1Title, impressions, clicks: clicksA },
    { id: "v2", title: v2Title, impressions, clicks: clicksB },
  ]);

  const views1 = predictViewsAdvanced({ title: v1Title, body: blueprintText }, { platform: "douyin" });
  const views2 = predictViewsAdvanced({ title: v2Title, body: blueprintText }, { platform: "douyin" });
  const conv1 = predictConversionRateAdvanced({ title: v1Title, body: blueprintText }, "HIGH");
  const conv2 = predictConversionRateAdvanced({ title: v2Title, body: blueprintText }, "HIGH");

  const totalI = impressions * 2;
  const ucb1 = clicksA / impressions + Math.sqrt((2 * Math.log(totalI)) / impressions);
  const ucb2 = clicksB / impressions + Math.sqrt((2 * Math.log(totalI)) / impressions);

  return [
    {
      id: "v1",
      type: ucbPick === "v1" ? "utilize" : "explore",
      title: v1Title,
      viewsPredicted: views1,
      conversionRatePredicted: conv1,
      ucbScore: parseFloat(ucb1.toFixed(4)),
    },
    {
      id: "v2",
      type: ucbPick === "v2" ? "utilize" : "explore",
      title: v2Title,
      viewsPredicted: views2,
      conversionRatePredicted: conv2,
      ucbScore: parseFloat(ucb2.toFixed(4)),
    },
  ];
}

export interface SimulatedAdvancedReportInput {
  topic: string;
  dateRange: string;
  contentBlueprint: unknown;
  platformData?: { platform?: string };
  thinkingLevel?: "HIGH" | "MEDIUM";
  userProfile?: { brandGenes: string[] };
  /** 可选：自定义 MAB 两臂标题 */
  mabTitles?: [string, string];
  /** 与平台页时间窗一致，供摘要与入库 metadata 对齐 */
  windowDays?: 3 | 7 | 15 | 30 | 45;
}

/**
 * 组装完整 AdvancedAIReportData，供 API、入库与前端锁定预览共用。
 */
export function buildSimulatedAdvancedAIReport(input: SimulatedAdvancedReportInput): AdvancedAIReportData {
  const { topic, dateRange, contentBlueprint } = input;
  const platformData = input.platformData ?? {};
  const thinkingLevel = input.thinkingLevel ?? "HIGH";
  const windowDays = input.windowDays;
  const userProfile = input.userProfile ?? { brandGenes: ["生命科学", "生活美学", "古典对照"] };
  const text = JSON.stringify(contentBlueprint);
  const seed = `${topic}|${text.slice(0, 1500)}`;

  const totalViews = predictViewsAdvanced(contentBlueprint, platformData);
  const avgConv = predictConversionRateAdvanced(contentBlueprint, thinkingLevel);
  const radar = radarFromBlueprint(text, seed);
  const platformKey = String(platformData.platform ?? "douyin").toLowerCase();
  const platformRadar = platformHitPotentialRadarFromBlueprint(text, seed, platformKey);
  const platformLabel = PLATFORM_LABEL_ZH[platformKey] ?? platformKey;

  const v1 = input.mabTitles?.[0] ?? "史记里那个最会「止损」的人，今天会怎么过中年？";
  const v2 = input.mabTitles?.[1] ?? "为什么爵士乐总在「唱错」的地方安慰你？";

  const mabVariants = buildMabVariantsFromTitles(v1, v2, text);

  const personalization = [
    {
      topicDirection: "史记人物 × 当代边界感与身心节律",
      brandMatchScore: calculateIPFit({ ...tryParse(text), focus: "史记" }, userProfile),
      viewsPredicted: Math.round(totalViews * (0.95 + hash01(seed + "p0") * 0.08)),
    },
    {
      topicDirection: "爵士留白 × 主观时间与恢复美学",
      brandMatchScore: calculateIPFit({ ...tryParse(text), jazz: true }, userProfile),
      viewsPredicted: Math.round(totalViews * (0.82 + hash01(seed + "p1") * 0.06)),
    },
    {
      topicDirection: "银发家庭沟通 × 生活力观察清单",
      brandMatchScore: Math.round(
        clamp(calculateIPFit(tryParse(text), { brandGenes: [...userProfile.brandGenes, "银发"] }) * 0.9, 0, 100),
      ),
      viewsPredicted: Math.round(totalViews * (0.65 + hash01(seed + "p2") * 0.08)),
    },
  ];

  const topicStructureExamples = [
    {
      title: "唐人边塞诗 × 旅行恢复隐喻",
      structure: "反差钩子 → 痛点共鸣 → 半成品解法两点 → 咨询 CTA",
      predictedCtr: parseFloat((4.2 + hash01(seed + "ctr0") * 3).toFixed(1)),
      predictedConversion: parseFloat((avgConv * 0.92 + hash01(seed + "c0")).toFixed(2)),
      brandMatchFit: clamp(76 + hash01(seed + "bf0") * 20, 55, 98),
    },
    {
      title: "爵士 × 主观时间切入",
      structure: "反差标题 → 个人故事 → 可执行觉察动作 → 互动提问",
      predictedCtr: parseFloat((5.1 + hash01(seed + "ctr1") * 2.8).toFixed(1)),
      predictedConversion: parseFloat((avgConv * 1.05 + hash01(seed + "c1")).toFixed(2)),
      brandMatchFit: clamp(68 + hash01(seed + "bf1") * 22, 55, 98),
    },
    {
      title: "网球第三盘 × 中年节律",
      structure: "运动场钩子 → 身体隐喻 → 三条清单 → 预约/关注",
      predictedCtr: parseFloat((3.8 + hash01(seed + "ctr2") * 2.4).toFixed(1)),
      predictedConversion: parseFloat((avgConv * 0.88 + hash01(seed + "c2")).toFixed(2)),
      brandMatchFit: clamp(62 + hash01(seed + "bf2") * 18, 55, 98),
    },
    {
      title: "当代热播剧情绪桥段 × 生命觉察",
      structure: "影视切口 → 情绪命名 → 半成品框架 → 温和转化",
      predictedCtr: parseFloat((4.6 + hash01(seed + "ctr3") * 3.2).toFixed(1)),
      predictedConversion: parseFloat((avgConv * 0.97 + hash01(seed + "c3")).toFixed(2)),
      brandMatchFit: clamp(80 + hash01(seed + "bf3") * 15, 55, 98),
    },
  ].map((row) => ({
    ...row,
    brandMatchFit: Math.round(row.brandMatchFit),
  }));

  const coreInsights = [
    {
      id: 1,
      title: "跨界赛道强度",
      content: `判断1：「${topic}」与高互动叙事结构叠加时，模型估测较易触达更广受众；建议在「典籍人物 / 文物事件 / 爵士生活 / 运动旅行」中轮换主轴，避免锁死单一朝代或单一词人。`,
      metricsText: `参考播放量量级约 ${formatIntCn(totalViews)}，转化区间约 ${avgConv.toFixed(1)}%。`,
    },
    {
      id: 2,
      title: "转化与信任",
      content:
        "判断2：学者底色 + 可感知生活场域（音乐、球场、旅行、市井）能拉高完播后的有效咨询线索；清单体与故事体可分流测试。",
      metricsText: `历史样本对比：清单/分步结构较平铺叙述，预估转化平均高约 ${(avgConv * 0.08).toFixed(1)} 个百分点（为模型估算，非承诺）。`,
    },
    {
      id: 3,
      title: "平台爆款潜力",
      content:
        "判断3：短视频序势偏「反差标题 + 前三秒结论」；图文则偏「封面大字 + 步骤截图」。两者可在同一主题下各做一版。",
      metricsText: `平台潜力雷达维度：${radar.platformPotential}/100。`,
    },
    {
      id: 4,
      title: "战略升级方向",
      content:
        "判断4：动态对照下，表现稳定的版本适合加大曝光；新鲜组合（史记×边界感、文物×观察力、影视×觉察）宜保留试错节奏，避免过早锁死宋词人模板。",
      metricsText: `执行节奏综合评分：${radar.mabEfficiency}/100。`,
    },
  ];

  return {
    topic,
    dateRange,
    globalPredictions: {
      totalViewsPredicted: totalViews,
      averageConversionRate: avgConv,
      hitPotentialRadar: radar,
      platformHitPotentialRadar: platformRadar,
    },
    coreInsights,
    executionSuggestions: {
      mabVariants,
      personalization,
    },
    topicStructureExamples,
    platformDetailedData: {
      note: "热榜＋品牌契合可在此挂接现有 growth JSON",
      hotListBrandFitHint:
        text.includes("史记") || text.includes("爵士") || text.includes("文物") || text.includes("银发")
          ? "跨界话题与账号基因契合度偏高"
          : "建议以主航道关键词对齐榜单",
      matchedPlatform: platformKey,
      matchedPlatformLabel: platformLabel,
      autoMatchExplanation: windowDays
        ? `已依您当前选择的「近 ${windowDays} 天」分析窗口，自动将主战场对齐为「${platformLabel}」：下列「平台雷达」与说明均基于该匹配账号／平台切片，无需手动选择平台。`
        : `已依增长看板自动将主战场对齐为「${platformLabel}」（以平台动量与受众契合加权）；平台雷达为该主战场切片视角。`,
    },
  };
}

function tryParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { raw: json.slice(0, 500) };
  }
}

function formatIntCn(n: number): string {
  return n.toLocaleString("zh-CN");
}
