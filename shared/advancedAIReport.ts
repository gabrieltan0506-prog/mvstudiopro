/**
 * B 端「爆款決策與增長管線」智庫報告資料結構。
 * 用于内部决策／智库 PDF 等场景；数值由参考历史数据与蓝图的预测引擎填充，并可持续对接真实模型。
 */

export type AdvancedMABVariantMode = "utilize" | "explore";

export interface AdvancedAIReportHitPotentialRadar {
  /** 預期播放量維度（雷達 0–100） */
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
   * 主戰場平台切片雷達（五維定義與全局一致，數值依平台特性與藍圖獨立演算）。
   * 舊存檔可能闕漏，前端可退回為從全局衍生之保守近似。
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
 * 平台詳細區塊：保留彈性，對應原熱榜／多平台圖表 JSON。
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
