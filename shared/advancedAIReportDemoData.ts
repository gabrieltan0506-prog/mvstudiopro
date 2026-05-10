import type { AdvancedAIReportData } from "./advancedAIReport";

/** 離線／元件預設演示用；上線產品請用 {@link ./advancedPredictionEngine.ts} 與當前戰略上下文組裝。 */
export const DEMO_ADVANCED_AI_REPORT_DATA: AdvancedAIReportData = {
  topic: "女性心病 × 生活美學",
  dateRange: "2026/04/25 — 2026/05/10",
  globalPredictions: {
    totalViewsPredicted: 2_150_000,
    averageConversionRate: 8.5,
    hitPotentialRadar: {
      views: 90,
      conversion: 85,
      brandFit: 75,
      platformPotential: 88,
      mabEfficiency: 95,
    },
  },
  coreInsights: [
    {
      id: 1,
      title: "核心洞察 1",
      content:
        "判斷1：女性心病 × 宋代點茶，是近 15 天最強勁的跨界賽道；適合主軸故事化 + 清單體分流。",
      metricsText: "預測播放量區間與轉化率已納入敘事結構加權。",
    },
    {
      id: 2,
      title: "核心洞察 2",
      content: "判斷2：爵士情緒線可拉高高活躍客群停留，建議前 3 秒給出可感知結果。",
      metricsText: "轉化模型對「情緒 + 節奏」組合給予正向偏置。",
    },
    {
      id: 3,
      title: "核心洞察 3",
      content: "判斷3：衛教清單在圖文場景下更易承接私域；短視頻則需強封面主句。",
      metricsText: "平台爆款潛力雷達已區分圖文/短視頻權重。",
    },
    {
      id: 4,
      title: "核心洞察 4",
      content: "判斷4：應保留試錯節奏給新題組合，避免過早鎖死單一標題模版。",
      metricsText: "右欄為多版本對照與執行節奏標記（利用／探索）。",
    },
  ],
  executionSuggestions: {
    mabVariants: [
      {
        id: "v1",
        type: "utilize",
        title: "爵士與心悸：女性心病的跨界處方",
        viewsPredicted: 1_250_000,
        conversionRatePredicted: 9.2,
        ucbScore: 0.112,
      },
      {
        id: "v2",
        type: "explore",
        title: "宋茶養心：被忽視的女性情緒療癒",
        viewsPredicted: 950_000,
        conversionRatePredicted: 7.1,
        ucbScore: 0.098,
      },
    ],
    personalization: [
      { topicDirection: "宋代點茶 × 情緒療癒", brandMatchScore: 98, viewsPredicted: 2_150_000 },
      { topicDirection: "女性心病衛教 × 爵士樂美學", brandMatchScore: 85, viewsPredicted: 1_190_000 },
      { topicDirection: "女性心病衛教 × 專業數據", brandMatchScore: 60, viewsPredicted: 770_000 },
    ],
  },
  topicStructureExamples: [
    {
      title: "最佳宋代點茶敘事線",
      structure: "共鳴開場 → 史觀一句 → 可重複步驟 → 溫和轉化",
      predictedCtr: 5.2,
      predictedConversion: 8.1,
      brandMatchFit: 91,
    },
    {
      title: "爵士 × 心率話題切入",
      structure: "反差標題 → 個人故事 → 醫學底稿一句 → 互動提問",
      predictedCtr: 6.4,
      predictedConversion: 9.0,
      brandMatchFit: 86,
    },
    {
      title: "預防醫學清單體",
      structure: "清單封面 → 三條幹貨 → 免責一句 → 關注引導",
      predictedCtr: 4.1,
      predictedConversion: 7.4,
      brandMatchFit: 78,
    },
    {
      title: "宋茶 × 女性情緒療癒",
      structure: "美感鏡頭 → 情緒命名 → 儀式步驟 → 預約/留言",
      predictedCtr: 5.8,
      predictedConversion: 8.6,
      brandMatchFit: 93,
    },
  ],
  platformDetailedData: {
    summary: "熱榜 + 品牌契合（可掛接現有 growth 管線輸出）",
    miniRadarNote: "多平台雷達可由此處延伸為子圖卡片",
  },
};
