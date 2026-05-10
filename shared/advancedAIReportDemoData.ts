import type { AdvancedAIReportData } from "./advancedAIReport";

/** 离线／组件预设演示用；上线产品请用 {@link ./advancedPredictionEngine.ts} 与当前战略上下文组装。 */
export const DEMO_ADVANCED_AI_REPORT_DATA: AdvancedAIReportData = {
  topic: "女性心病 × 生活美学",
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
    platformHitPotentialRadar: {
      views: 82,
      conversion: 88,
      brandFit: 86,
      platformPotential: 79,
      mabEfficiency: 91,
    },
  },
  coreInsights: [
    {
      id: 1,
      title: "核心洞察 1",
      content:
        "判断1：女性心病 × 宋代点茶，是近 15 天最强劲的跨界赛道；适合主轴故事化 + 清单体分流。",
      metricsText: "预测播放量区间与转化率已纳入叙事结构加权。",
    },
    {
      id: 2,
      title: "核心洞察 2",
      content: "判断2：爵士情绪线可拉高活跃客群停留，建议前 3 秒给出可感知结果。",
      metricsText: "转化模型对「情绪 + 节奏」组合给予正向偏置。",
    },
    {
      id: 3,
      title: "核心洞察 3",
      content: "判断3：卫教清单在图文场景下更易承接私域；短视频则需强封面主句。",
      metricsText: "平台爆款潜力雷达已区分图文/短视频权重。",
    },
    {
      id: 4,
      title: "核心洞察 4",
      content: "判断4：应保留试错节奏给新题组合，避免过早锁死单一标题模版。",
      metricsText: "右栏为多版本对照与执行节奏标记（利用／探索）。",
    },
  ],
  executionSuggestions: {
    mabVariants: [
      {
        id: "v1",
        type: "utilize",
        title: "爵士与心悸：女性心病的跨界处方",
        viewsPredicted: 1_250_000,
        conversionRatePredicted: 9.2,
        ucbScore: 0.112,
      },
      {
        id: "v2",
        type: "explore",
        title: "宋茶养心：被忽视的女性情绪疗愈",
        viewsPredicted: 950_000,
        conversionRatePredicted: 7.1,
        ucbScore: 0.098,
      },
    ],
    personalization: [
      { topicDirection: "宋代点茶 × 情绪疗愈", brandMatchScore: 98, viewsPredicted: 2_150_000 },
      { topicDirection: "女性心病卫教 × 爵士乐美学", brandMatchScore: 85, viewsPredicted: 1_190_000 },
      { topicDirection: "女性心病卫教 × 专业数据", brandMatchScore: 60, viewsPredicted: 770_000 },
    ],
  },
  topicStructureExamples: [
    {
      title: "最佳宋代点茶叙事线",
      structure: "共鸣开场 → 史观一句 → 可重复步骤 → 温和转化",
      predictedCtr: 5.2,
      predictedConversion: 8.1,
      brandMatchFit: 91,
    },
    {
      title: "爵士 × 心率话题切入",
      structure: "反差标题 → 个人故事 → 医学底稿一句 → 互动提问",
      predictedCtr: 6.4,
      predictedConversion: 9.0,
      brandMatchFit: 86,
    },
    {
      title: "预防医学清单体",
      structure: "清单封面 → 三条干货 → 免责一句 → 关注引导",
      predictedCtr: 4.1,
      predictedConversion: 7.4,
      brandMatchFit: 78,
    },
    {
      title: "宋茶 × 女性情绪疗愈",
      structure: "美感镜头 → 情绪命名 → 仪式步骤 → 预约/留言",
      predictedCtr: 5.8,
      predictedConversion: 8.6,
      brandMatchFit: 93,
    },
  ],
  platformDetailedData: {
    summary: "热榜 + 品牌契合（可挂接现有 growth 管线输出）",
    miniRadarNote: "多平台雷达可由此处延伸为子图卡片",
    matchedPlatform: "douyin",
    matchedPlatformLabel: "抖音",
    autoMatchExplanation: "演示数据：实线上将依您的看板自动对齐主战场平台。",
  },
};
