/**
 * B 端「爆款决策与增长管线」智库报告资料结构。
 * 用于内部决策／智库 PDF 等场景；数值由参考历史数据与蓝图的预测引擎填充，并可持续对接真实模型。
 */

export type AdvancedMABVariantMode = "utilize" | "explore";

export interface AdvancedAIReportHitPotentialRadar {
  /** 预期播放量维度（雷达 0–100） */
  views: number;
  conversion: number;
  brandFit: number;
  platformPotential: number;
  mabEfficiency: number;
}

export interface AdvancedAIReportGlobalPredictions {
  totalViewsPredicted: number;
  averageConversionRate: number;
  hitPotentialRadar: AdvancedAIReportHitPotentialRadar;
  /**
   * 主战场平台切片雷达（五维定义与全局一致，数值依平台特性与蓝图独立演算）。
   * 旧存档可能阙漏，前端可退回为从全局衍生之保守近似。
   */
  platformHitPotentialRadar?: AdvancedAIReportHitPotentialRadar;
}

export interface AdvancedAIReportCoreInsight {
  id: number;
  title: string;
  content: string;
  metricsText?: string;
}

export interface AdvancedAIReportMABVariant {
  id: string;
  type: AdvancedMABVariantMode;
  title: string;
  viewsPredicted: number;
  conversionRatePredicted: number;
  ucbScore?: number;
}

export interface AdvancedAIReportPersonalizationRow {
  topicDirection: string;
  brandMatchScore: number;
  viewsPredicted: number;
}

export interface AdvancedAIReportExecutionSuggestions {
  mabVariants: AdvancedAIReportMABVariant[];
  personalization: AdvancedAIReportPersonalizationRow[];
}

export interface AdvancedAIReportTopicStructureExample {
  title: string;
  structure: string;
  predictedCtr: number;
  predictedConversion: number;
  brandMatchFit: number;
}

/**
 * 平台详细区块：保留弹性，对应原热榜／多平台图表 JSON。
 */
export type AdvancedAIReportPlatformDetailedData = Record<string, unknown>;

export interface AdvancedAIReportData {
  topic: string;
  dateRange: string;
  globalPredictions: AdvancedAIReportGlobalPredictions;
  coreInsights: AdvancedAIReportCoreInsight[];
  executionSuggestions: AdvancedAIReportExecutionSuggestions;
  topicStructureExamples: AdvancedAIReportTopicStructureExample[];
  platformDetailedData: AdvancedAIReportPlatformDetailedData;
}
