/**
 * 决策智库 · 双轨 Gemini Flash 扩写（与 {@link ../../shared/advancedPredictionEngine.ts} 数字壳解耦）。
 * Call A：核心洞察；Call B：赛马标题、个性化方向、选题结构。并行 + allSettled，双 reject 则抛错。
 */

import { createHash } from "node:crypto";

import type { AdvancedAIReportData } from "@shared/advancedAIReport";
import { extractJsonString } from "../_core/llm";
import { callGemini35FlashCopywriting } from "./gemini35FlashRuntime.js";
import { sanitizeDecisionIntelMetricsText } from "@shared/decisionIntelSanitize";

const PLATFORM_LABEL: Record<string, string> = {
  douyin: "抖音",
  bilibili: "B站",
  xiaohongshu: "小红书",
  kuaishou: "快手",
};

function blueprintJsonForPrompt(contentBlueprint: unknown, maxChars = 12_000): string {
  try {
    return JSON.stringify(contentBlueprint ?? {}).slice(0, maxChars);
  } catch {
    return "{}";
  }
}

function globalPredictionsJson(base: AdvancedAIReportData): string {
  try {
    return JSON.stringify(base.globalPredictions, null, 0);
  } catch {
    return "{}";
  }
}

/** 与 mutation 侧一致：稳定指纹，用于缓存命中。（可选 platformAnalysisEpoch 由全案分析递增，避免误命中旧报告。） */
export function hashDecisionIntelligenceRequest(payload: {
  topic: string;
  contentBlueprint: unknown;
  platformHint: string;
  windowDays: number;
  platformAnalysisEpoch?: number;
}): string {
  const payloadString = JSON.stringify({
    topic: payload.topic,
    platformHint: payload.platformHint,
    windowDays: payload.windowDays,
    blueprint: payload.contentBlueprint,
    ...(payload.platformAnalysisEpoch != null ? { platformAnalysisEpoch: payload.platformAnalysisEpoch } : {}),
  });
  return createHash("sha256").update(payloadString).digest("hex");
}

type CallAOutput = { coreInsights?: AdvancedAIReportData["coreInsights"] };
type CallBOutput = {
  mabVariants?: Array<{ id: string; title?: string }>;
  personalization?: Array<{ topicDirection?: string }>;
  topicStructureExamples?: Array<{ title?: string; structure?: string }>;
};

async function flashCallAnalysisEngine(params: {
  topic: string;
  contentBlueprint: unknown;
  base: AdvancedAIReportData;
  abortSignal?: AbortSignal;
}): Promise<CallAOutput> {
  const system = `你是一位顶级的商业战略顾问与数据分析师。
你的任务是根据提供的「内容蓝图」与「大盘预测数据」，撰写出 4 条「核心洞察 (Core Insights)」。
【语气】
- 专业、客观；输出简体中文为主。
- 严禁「保证」「绝对能达到」等字眼；改用「预期具备潜力」「结合历史窗口样本」等。
- metricsText 为一条短附注（建议≤45字）：只用简体中文；禁止出现「模拟」「模擬」「pp」「PP」等字样。
- 若 metricsText 写转化率变化，须用「约高/约低 X 个百分点」，并避免缩写：百分点指转化率数字上的加减（例如从 8% 到 8.6% 即高约 0.6 个百分点）。
- 只输出一个 JSON 对象，键名 coreInsights；数组长度必须为 4，id 依次为 1～4。`;

  const user = `【选题方向】：${params.topic}
【全局数据快照】：${globalPredictionsJson(params.base)}
【内容蓝图】：${blueprintJsonForPrompt(params.contentBlueprint)}

请给出 4 条战略洞察。每条 content 约 50～90 字；metricsText 简要呼应快照中的数量级（勿与快照矛盾），且禁止写「模拟」或「pp」。`;

  const raw = await callGemini35FlashCopywriting({
    taskSystemInstruction: system,
    userText: user,
    responseMimeType: "application/json",
    maxOutputTokens: 4096,
    abortSignal: params.abortSignal,
  });
  return JSON.parse(extractJsonString(raw)) as CallAOutput;
}

async function flashCallCreativeEngine(params: {
  topic: string;
  contentBlueprint: unknown;
  platformHint: string;
  base: AdvancedAIReportData;
  abortSignal?: AbortSignal;
}): Promise<CallBOutput> {
  const platformLabel = PLATFORM_LABEL[params.platformHint] || params.platformHint;
  const ids = params.base.executionSuggestions.mabVariants.map((v) => v.id).join(", ");
  const system = `你是深谙抖音、小红书、B 站等平台的资深内容操盘手。
根据内容蓝图产出高吸引力的赛马标题、延伸选题与内容结构。
【规则】
- 只负责文字；不计算分数、概率、CTR 小数。
- 只输出一个 JSON，字段：mabVariants、personalization、topicStructureExamples。
- mabVariants 必须与输入 id 完全一致且顺序一致（通常 2 条）。
- personalization 必须恰好 3 条（与本地骨架列数一致）。
- topicStructureExamples 必须恰好 4 条，每条含 title、structure（structure 可用「段落1 → 段落2」）。`;

  const user = `【选题方向】：${params.topic}
【目标平台】：${platformLabel}
【内容蓝图】：${blueprintJsonForPrompt(params.contentBlueprint)}

请产出：
1) mabVariants：为 id 序 ${ids} 各写 1 个吸睛标题（JSON 内含 id 与 title）。
2) personalization：3 个延伸个性化选题方向（topicDirection）。
3) topicStructureExamples：4 组 title + structure。`;

  const raw = await callGemini35FlashCopywriting({
    taskSystemInstruction: system,
    userText: user,
    responseMimeType: "application/json",
    maxOutputTokens: 4096,
    abortSignal: params.abortSignal,
  });
  return JSON.parse(extractJsonString(raw)) as CallBOutput;
}

function mergeFlashIntoBase(base: AdvancedAIReportData, parsedA: CallAOutput | null, parsedB: CallBOutput | null): AdvancedAIReportData {
  const enriched: AdvancedAIReportData = JSON.parse(JSON.stringify(base));

  if (parsedA?.coreInsights && Array.isArray(parsedA.coreInsights) && parsedA.coreInsights.length > 0) {
    enriched.coreInsights = base.coreInsights.map((row, index) => {
      const insight = parsedA.coreInsights![index];
      if (!insight) return row;
      const mergedMetrics =
        typeof insight.metricsText === "string" && insight.metricsText.trim()
          ? insight.metricsText.trim()
          : row.metricsText;
      return {
        id: row.id,
        title: typeof insight.title === "string" && insight.title.trim() ? insight.title.trim() : row.title,
        content: typeof insight.content === "string" && insight.content.trim() ? insight.content.trim() : row.content,
        metricsText:
          typeof mergedMetrics === "string" && mergedMetrics.trim()
            ? sanitizeDecisionIntelMetricsText(mergedMetrics)
            : mergedMetrics,
      };
    });
  }

  if (parsedB?.mabVariants && Array.isArray(parsedB.mabVariants)) {
    enriched.executionSuggestions.mabVariants = base.executionSuggestions.mabVariants.map((baseVar) => {
      const llmVar = parsedB.mabVariants!.find((v) => v && v.id === baseVar.id);
      return {
        ...baseVar,
        title:
          typeof llmVar?.title === "string" && llmVar.title.trim() ? llmVar.title.trim() : baseVar.title,
      };
    });
  }

  if (parsedB?.personalization && Array.isArray(parsedB.personalization)) {
    enriched.executionSuggestions.personalization = base.executionSuggestions.personalization.map((basePers, idx) => {
      const p = parsedB.personalization![idx];
      return {
        ...basePers,
        topicDirection:
          typeof p?.topicDirection === "string" && p.topicDirection.trim()
            ? p.topicDirection.trim()
            : basePers.topicDirection,
      };
    });
  }

  if (parsedB?.topicStructureExamples && Array.isArray(parsedB.topicStructureExamples)) {
    enriched.topicStructureExamples = base.topicStructureExamples.map((baseStruct, idx) => {
      const ex = parsedB.topicStructureExamples![idx];
      return {
        ...baseStruct,
        title: typeof ex?.title === "string" && ex.title.trim() ? ex.title.trim() : baseStruct.title,
        structure:
          typeof ex?.structure === "string" && ex.structure.trim() ? ex.structure.trim() : baseStruct.structure,
      };
    });
  }

  /* 文案扩写不应覆写数字壳；深拷贝后仍显式保留平台切片雷达，避免日后合并字段时被误清。 */
  if (base.globalPredictions?.platformHitPotentialRadar) {
    enriched.globalPredictions.platformHitPotentialRadar = base.globalPredictions.platformHitPotentialRadar;
  }

  return enriched;
}

/**
 * 并行 Call A / Call B；仅当两者 Promise 皆 rejected 时抛错（不扣点由调用方处理）。
 * 若 fulfilled 但 JSON 異常，在內部 try/catch 視為該路徑無效，另一路仍可能成功。
 */
export async function runGeminiFlashPipeline(params: {
  base: AdvancedAIReportData;
  contentBlueprint: unknown;
  platformHint: string;
  topic: string;
  abortSignal?: AbortSignal;
}): Promise<AdvancedAIReportData> {
  const { base, contentBlueprint, platformHint, topic, abortSignal } = params;

  const callA = async (): Promise<CallAOutput> => {
    return flashCallAnalysisEngine({ topic, contentBlueprint, base, abortSignal });
  };
  const callB = async (): Promise<CallBOutput> => {
    return flashCallCreativeEngine({ topic, contentBlueprint, platformHint, base, abortSignal });
  };

  const [settledA, settledB] = await Promise.allSettled([callA(), callB()]);

  if (settledA.status === "rejected" && settledB.status === "rejected") {
    const msgA = settledA.reason instanceof Error ? settledA.reason.message : String(settledA.reason);
    const msgB = settledB.reason instanceof Error ? settledB.reason.message : String(settledB.reason);
    throw new Error(`DECISION_INTEL_FLASH_ALL_FAILED: A=${msgA}; B=${msgB}`);
  }

  let parsedA: CallAOutput | null = null;
  let parsedB: CallBOutput | null = null;

  if (settledA.status === "fulfilled") {
    try {
      parsedA = settledA.value;
      if (!parsedA?.coreInsights?.length) parsedA = null;
    } catch {
      parsedA = null;
    }
  }

  if (settledB.status === "fulfilled") {
    try {
      parsedB = settledB.value;
      if (!parsedB?.mabVariants?.length && !parsedB?.personalization?.length && !parsedB?.topicStructureExamples?.length) {
        parsedB = null;
      }
    } catch {
      parsedB = null;
    }
  }

  /** 两路都没带回可 merge 的结构时，与「双 reject」同等：不应扣点。 */
  if (!parsedA && !parsedB) {
    throw new Error(
      `DECISION_INTEL_FLASH_ALL_FAILED: no_usable_json (A=${settledA.status}, B=${settledB.status})`,
    );
  }

  return mergeFlashIntoBase(base, parsedA, parsedB);
}
