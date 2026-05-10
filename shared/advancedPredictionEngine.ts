/**
 * 高級模擬預測引擎：對齊智庫報告「爆款決策與增長管線」欄位。
 * 前後端共用：付費入庫與鎖定態示意預覽必須同一套邏輯與同一組輸入，避免「外製 Demo」。
 */

import type { AdvancedAIReportData, AdvancedAIReportMABVariant } from "./advancedAIReport";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** 由字串種子產生 [0,1) 偽隨機，同一輸入同結果。 */
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

  if (text.includes("女性心病") && text.includes("宋代點茶")) baseViews *= 2.5;
  if (text.includes("跨界美學")) baseViews *= 1.5;
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

  if (text.includes("醫學衛教") || text.includes("預防醫學")) baseRate += 3.5;
  if (text.includes("宋代點茶")) baseRate += 2.0;
  if (text.includes("情感療癒")) baseRate += 1.5;

  const variance = jitter(seed, "conv", 0.1);
  return parseFloat(clamp(baseRate * (1 + variance), 1, 25).toFixed(2));
}

/** 品牌基因契合度 0–100（進度條） */
export function calculateIPFit(contentBlueprint: unknown, userProfile: { brandGenes: string[] }): number {
  const text = JSON.stringify(contentBlueprint);
  const genes = userProfile.brandGenes.filter(Boolean);
  let hits = 0;
  for (const g of genes) {
    if (text.includes(g)) hits++;
  }
  const base = 38;
  const add = genes.length ? Math.min(58, (hits / genes.length) * 55 + hits * 6) : 20;
  return Math.round(clamp(base + add, 0, 100));
}

/**
 * UCB1：以 clicks/impressions 為報酬；冷啟動優先未曝光臂。
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
  if (text.includes("宋代點茶") || text.includes("點茶")) {
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
  /** 可選：自訂 MAB 兩臂標題 */
  mabTitles?: [string, string];
}

/**
 * 組裝完整 AdvancedAIReportData，供 API、入庫與前端鎖定預覽共用。
 */
export function buildSimulatedAdvancedAIReport(input: SimulatedAdvancedReportInput): AdvancedAIReportData {
  const { topic, dateRange, contentBlueprint } = input;
  const platformData = input.platformData ?? {};
  const thinkingLevel = input.thinkingLevel ?? "HIGH";
  const userProfile = input.userProfile ?? { brandGenes: ["女性心病", "生活美學", "宋代點茶"] };
  const text = JSON.stringify(contentBlueprint);
  const seed = `${topic}|${text.slice(0, 1500)}`;

  const totalViews = predictViewsAdvanced(contentBlueprint, platformData);
  const avgConv = predictConversionRateAdvanced(contentBlueprint, thinkingLevel);
  const radar = radarFromBlueprint(text, seed);

  const v1 = input.mabTitles?.[0] ?? "聽爵士，降10mmHg血壓？這招絕了！";
  const v2 = input.mabTitles?.[1] ?? "宋代點茶：女性心病的跨界美學處方箋";

  const mabVariants = buildMabVariantsFromTitles(v1, v2, text);

  const personalization = [
    {
      topicDirection: "宋代點茶 × 情緒療癒",
      brandMatchScore: calculateIPFit({ ...tryParse(text), focus: "茶" }, userProfile),
      viewsPredicted: Math.round(totalViews * (0.95 + hash01(seed + "p0") * 0.08)),
    },
    {
      topicDirection: "女性心病衛教 × 爵士樂美學",
      brandMatchScore: calculateIPFit({ ...tryParse(text), jazz: true }, userProfile),
      viewsPredicted: Math.round(totalViews * (0.82 + hash01(seed + "p1") * 0.06)),
    },
    {
      topicDirection: "女性心病衛教 × 專業數據",
      brandMatchScore: Math.round(
        clamp(calculateIPFit(tryParse(text), { brandGenes: [...userProfile.brandGenes, "數據"] }) * 0.9, 0, 100),
      ),
      viewsPredicted: Math.round(totalViews * (0.65 + hash01(seed + "p2") * 0.08)),
    },
  ];

  const topicStructureExamples = [
    {
      title: "最佳宋代點茶敘事線",
      structure: "開場共鳴 → 史觀一句 → 可操作步驟 → CTA",
      predictedCtr: parseFloat((4.2 + hash01(seed + "ctr0") * 3).toFixed(1)),
      predictedConversion: parseFloat((avgConv * 0.92 + hash01(seed + "c0")).toFixed(2)),
      brandMatchFit: clamp(76 + hash01(seed + "bf0") * 20, 55, 98),
    },
    {
      title: "爵士 × 心率話題切入",
      structure: "反差標題 → 個人故事 → 醫學底稿一句话 → 互動提問",
      predictedCtr: parseFloat((5.1 + hash01(seed + "ctr1") * 2.8).toFixed(1)),
      predictedConversion: parseFloat((avgConv * 1.05 + hash01(seed + "c1")).toFixed(2)),
      brandMatchFit: clamp(68 + hash01(seed + "bf1") * 22, 55, 98),
    },
    {
      title: "預防醫學清單體",
      structure: "清單封面 → 三條干貨 → 一條免責 → 預約/關注",
      predictedCtr: parseFloat((3.8 + hash01(seed + "ctr2") * 2.4).toFixed(1)),
      predictedConversion: parseFloat((avgConv * 0.88 + hash01(seed + "c2")).toFixed(2)),
      brandMatchFit: clamp(62 + hash01(seed + "bf2") * 18, 55, 98),
    },
    {
      title: "宋茶 × 女性情緒療癒",
      structure: "美感鏡頭 → 情緒命名 → 具體儀式 → 溫和轉化",
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
      title: "跨界賽道強度",
      content: `判斷1：「${topic}」與高互動敘事結構疊加時，模型估測較易觸達更廣受眾；建議以宋茶/爵士其中一條做主軸做深。`,
      metricsText: `參考播放量量級約 ${formatIntCn(totalViews)}，轉化區間約 ${avgConv.toFixed(1)}%。`,
    },
    {
      id: 2,
      title: "轉化與信任",
      content:
        "判斷2：醫學底色 + 可感知儀式（泡茶、節奏）能拉高完播後的有效咨詢線索；清單體與故事體可分流測試。",
      metricsText: `結構化內容對轉化較友好（模擬 +${(avgConv * 0.08).toFixed(1)}pp 量級）。`,
    },
    {
      id: 3,
      title: "平台爆款潛力",
      content:
        "判斷3：短視頻序勢偏「反差標題 + 前三秒結論」；圖文則偏「封面大字 + 步驟截圖」。兩者可在同一主題下各做一版。",
      metricsText: `平台潛力雷達維度：${radar.platformPotential}/100。`,
    },
    {
      id: 4,
      title: "MAB 執行節奏",
      content:
        "判斷4：UCB1 會在高考量臂上保留「利用」，在曝光少的臂上保留「探索」；新鮮組合（宋茶×情緒）建議給足探索配額。",
      metricsText: `賽馬效能指標：${radar.mabEfficiency}/100。`,
    },
  ];

  return {
    topic,
    dateRange,
    globalPredictions: {
      totalViewsPredicted: totalViews,
      averageConversionRate: avgConv,
      hitPotentialRadar: radar,
    },
    coreInsights,
    executionSuggestions: {
      mabVariants,
      personalization,
    },
    topicStructureExamples,
    platformDetailedData: {
      note: "熱榜＋品牌契合可在此掛接現有 growth JSON",
      hotListBrandFitHint: text.includes("宋代點茶") ? "跨界話題與帳號基因契合度偏高" : "建議以主航道關鍵詞對齊榜單",
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
