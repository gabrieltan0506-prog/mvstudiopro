/**
 * B 端「爆款決策與增長管線」智庫報告資料結構。
 * 用於內部決策／智庫 PDF 等場景；數值可由模擬引擎或日後真實模型填充。
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
