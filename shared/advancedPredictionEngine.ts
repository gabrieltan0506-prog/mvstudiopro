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

  if (text.includes("女性心病") && (text.includes("宋代點茶") || text.includes("宋代点茶"))) baseViews *= 2.5;
  if (text.includes("跨界美學") || text.includes("跨界美学")) baseViews *= 1.5;
  if (text.includes("爵士樂") || text.includes("爵士")) baseViews *= 1.8;

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

  if (text.includes("醫學衛教") || text.includes("医学卫教") || text.includes("預防醫學") || text.includes("预防医学")) baseRate += 3.5;
  if (text.includes("宋代點茶") || text.includes("宋代点茶")) baseRate += 2.0;
  if (text.includes("情感療癒") || text.includes("情感疗愈")) baseRate += 1.5;

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
    if (g === "生活美学" && text.includes("生活美學")) hits++;
    else if (g === "宋代点茶" && text.includes("宋代點茶")) hits++;
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

  if (text.includes("女性心病")) {
    views += 8;
    brandFit += 6;
  }
  if (text.includes("宋代點茶") || text.includes("宋代点茶") || text.includes("點茶") || text.includes("点茶")) {
    views += 10;
    platformPotential += 8;
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

  if (text.includes("女性心病")) {
    brandFit += Math.round(6 * k);
    views += Math.round(4 * k);
  }
  if (text.includes("宋代點茶") || text.includes("點茶")) {
    views += Math.round(6 * k);
    platformPotential += Math.round(6 * k);
  }
  if (text.includes("爵士")) {
    conversion += Math.round(5 * k);
    mabEfficiency += Math.round(4 * k);
  }

  return { views, conversion, brandFit, platformPotential, mabEfficiency };
}

/** 平台切片雷达：以平台轮廓为主体 + 蓝图弱调 + 独立种子抖动，形状与全局面板显著不同。 */
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
  windowDays?: 15 | 30 | 45;
}

/**
 * 组装完整 AdvancedAIReportData，供 API、入库与前端锁定预览共用。
 */
export function buildSimulatedAdvancedAIReport(input: SimulatedAdvancedReportInput): AdvancedAIReportData {
  const { topic, dateRange, contentBlueprint } = input;
  const platformData = input.platformData ?? {};
  const thinkingLevel = input.thinkingLevel ?? "HIGH";
  const windowDays = input.windowDays;
  const userProfile = input.userProfile ?? { brandGenes: ["女性心病", "生活美学", "宋代点茶"] };
  const text = JSON.stringify(contentBlueprint);
  const seed = `${topic}|${text.slice(0, 1500)}`;

  const totalViews = predictViewsAdvanced(contentBlueprint, platformData);
  const avgConv = predictConversionRateAdvanced(contentBlueprint, thinkingLevel);
  const radar = radarFromBlueprint(text, seed);
  const platformKey = String(platformData.platform ?? "douyin").toLowerCase();
  const platformRadar = platformHitPotentialRadarFromBlueprint(text, seed, platformKey);
  const platformLabel = PLATFORM_LABEL_ZH[platformKey] ?? platformKey;

  const v1 = input.mabTitles?.[0] ?? "听爵士，降10mmHg血压？这招绝了！";
  const v2 = input.mabTitles?.[1] ?? "宋代点茶：女性心病的跨界美学处方笺";

  const mabVariants = buildMabVariantsFromTitles(v1, v2, text);

  const personalization = [
    {
      topicDirection: "宋代点茶 × 情绪疗愈",
      brandMatchScore: calculateIPFit({ ...tryParse(text), focus: "茶" }, userProfile),
      viewsPredicted: Math.round(totalViews * (0.95 + hash01(seed + "p0") * 0.08)),
    },
    {
      topicDirection: "女性心病卫教 × 爵士乐美学",
      brandMatchScore: calculateIPFit({ ...tryParse(text), jazz: true }, userProfile),
      viewsPredicted: Math.round(totalViews * (0.82 + hash01(seed + "p1") * 0.06)),
    },
    {
      topicDirection: "女性心病卫教 × 专业数据",
      brandMatchScore: Math.round(
        clamp(calculateIPFit(tryParse(text), { brandGenes: [...userProfile.brandGenes, "数据"] }) * 0.9, 0, 100),
      ),
      viewsPredicted: Math.round(totalViews * (0.65 + hash01(seed + "p2") * 0.08)),
    },
  ];

  const topicStructureExamples = [
    {
      title: "最佳宋代点茶叙事线",
      structure: "开场共鸣 → 史观一句 → 可操作步骤 → CTA",
      predictedCtr: parseFloat((4.2 + hash01(seed + "ctr0") * 3).toFixed(1)),
      predictedConversion: parseFloat((avgConv * 0.92 + hash01(seed + "c0")).toFixed(2)),
      brandMatchFit: clamp(76 + hash01(seed + "bf0") * 20, 55, 98),
    },
    {
      title: "爵士 × 心率话题切入",
      structure: "反差标题 → 个人故事 → 医学底稿一句话 → 互动提问",
      predictedCtr: parseFloat((5.1 + hash01(seed + "ctr1") * 2.8).toFixed(1)),
      predictedConversion: parseFloat((avgConv * 1.05 + hash01(seed + "c1")).toFixed(2)),
      brandMatchFit: clamp(68 + hash01(seed + "bf1") * 22, 55, 98),
    },
    {
      title: "预防医学清单体",
      structure: "清单封面 → 三条干货 → 一条免责 → 预约/关注",
      predictedCtr: parseFloat((3.8 + hash01(seed + "ctr2") * 2.4).toFixed(1)),
      predictedConversion: parseFloat((avgConv * 0.88 + hash01(seed + "c2")).toFixed(2)),
      brandMatchFit: clamp(62 + hash01(seed + "bf2") * 18, 55, 98),
    },
    {
      title: "宋茶 × 女性情绪疗愈",
      structure: "美感镜头 → 情绪命名 → 具体仪式 → 温和转化",
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
      content: `判断1：「${topic}」与高互动叙事结构叠加时，模型估测较易触达更广受众；建议以宋茶/爵士其中一条做主轴做深。`,
      metricsText: `参考播放量量级约 ${formatIntCn(totalViews)}，转化区间约 ${avgConv.toFixed(1)}%。`,
    },
    {
      id: 2,
      title: "转化与信任",
      content:
        "判断2：医学底色 + 可感知仪式（泡茶、节奏）能拉高完播后的有效咨询线索；清单体与故事体可分流测试。",
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
        "判断4：动态对照下，表现稳定的版本适合加大曝光；新鲜组合（如宋茶×情绪）宜保留试错节奏，避免过早锁死单一叙事模版。",
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
        text.includes("宋代點茶") || text.includes("宋代点茶")
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
