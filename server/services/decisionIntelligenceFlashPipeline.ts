/**
 * 決策智庫 · 雙軌 Gemini Flash 擴寫（與 {@link ../../shared/advancedPredictionEngine.ts} 數字殼解耦）。
 * Call A：核心洞察；Call B：賽馬標題、個性化方向、選題結構。並行 + allSettled，雙reject 則拋錯。
 */

import { createHash } from "node:crypto";

import type { AdvancedAIReportData } from "@shared/advancedAIReport";
import { extractJsonString, invokeLLM } from "../_core/llm";
import { resolveGrowthCampExtractorModel } from "../growth/extractorPipeline";

const PLATFORM_LABEL: Record<string, string> = {
  douyin: "抖音",
  bilibili: "B站",
  xiaohongshu: "小紅書",
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

/** 與 mutation 側一致：穩定指紋，用於快取命中。 */
export function hashDecisionIntelligenceRequest(payload: {
  topic: string;
  contentBlueprint: unknown;
  platformHint: string;
}): string {
  const payloadString = JSON.stringify({
    topic: payload.topic,
    platformHint: payload.platformHint,
    blueprint: payload.contentBlueprint,
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
  const modelName = resolveGrowthCampExtractorModel();
  const system = `你是一位頂級的商業戰略顧問與數據分析師。
你的任務是根據提供的「內容藍圖」與「大盤預測數據」，撰寫出 4 條「核心洞察 (Core Insights)」。
【語氣】
- 專業、客觀；輸出繁體中文為主。
- 嚴禁「保證」「絕對能達到」等字眼；改用「預期具備潛力」「模型推演顯示」等。
- 只輸出一個 JSON 物件，鍵名 coreInsights；陣列長度必須為 4，id 依序 1～4。`;

  const user = `【選題方向】：${params.topic}
【全局數據快照】：${globalPredictionsJson(params.base)}
【內容藍圖】：${blueprintJsonForPrompt(params.contentBlueprint)}

請給出 4 條戰略洞察。每條 content 約 50～90 字；metricsText 簡要呼應快照中的數量級（勿與快照數字矛盾）。`;

  const response = await invokeLLM({
    model: "flash",
    provider: "vertex",
    modelName,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    maxTokens: 4096,
    abortSignal: params.abortSignal,
  });
  const raw = String(response.choices[0]?.message?.content ?? "{}");
  return JSON.parse(extractJsonString(raw)) as CallAOutput;
}

async function flashCallCreativeEngine(params: {
  topic: string;
  contentBlueprint: unknown;
  platformHint: string;
  base: AdvancedAIReportData;
  abortSignal?: AbortSignal;
}): Promise<CallBOutput> {
  const modelName = resolveGrowthCampExtractorModel();
  const platformLabel = PLATFORM_LABEL[params.platformHint] || params.platformHint;
  const ids = params.base.executionSuggestions.mabVariants.map((v) => v.id).join(", ");
  const system = `你是深諳抖音、小紅書、B 站等平台的資深內容操盤手。
根據內容藍圖產出高吸引力的賽馬標題、延伸選題與內容結構。
【規則】
- 只負責文字；不計算分數、機率、CTR 小數。
- 只輸出一個 JSON，欄位：mabVariants、personalization、topicStructureExamples。
- mabVariants 必須與輸入 id 完全一致且順序一致（通常 2 條）。
- personalization 必須恰好 3 條（與本地骨架列數一致）。
- topicStructureExamples 必須恰好 4 條，每條含 title、structure（structure 可用「段落1 → 段落2」）。`;

  const user = `【選題方向】：${params.topic}
【目標平台】：${platformLabel}
【內容藍圖】：${blueprintJsonForPrompt(params.contentBlueprint)}

請產出：
1) mabVariants：為 id 序 ${ids} 各寫 1 個吸睛標題（JSON 內含 id 與 title）。
2) personalization：3 個延伸個性化選題方向（topicDirection）。
3) topicStructureExamples：4 組 title + structure。`;

  const response = await invokeLLM({
    model: "flash",
    provider: "vertex",
    modelName,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    maxTokens: 4096,
    abortSignal: params.abortSignal,
  });
  const raw = String(response.choices[0]?.message?.content ?? "{}");
  return JSON.parse(extractJsonString(raw)) as CallBOutput;
}

function mergeFlashIntoBase(base: AdvancedAIReportData, parsedA: CallAOutput | null, parsedB: CallBOutput | null): AdvancedAIReportData {
  const enriched: AdvancedAIReportData = JSON.parse(JSON.stringify(base));

  if (parsedA?.coreInsights && Array.isArray(parsedA.coreInsights) && parsedA.coreInsights.length > 0) {
    enriched.coreInsights = base.coreInsights.map((row, index) => {
      const insight = parsedA.coreInsights![index];
      if (!insight) return row;
      return {
        id: row.id,
        title: typeof insight.title === "string" && insight.title.trim() ? insight.title.trim() : row.title,
        content: typeof insight.content === "string" && insight.content.trim() ? insight.content.trim() : row.content,
        metricsText:
          typeof insight.metricsText === "string" && insight.metricsText.trim()
            ? insight.metricsText.trim()
            : row.metricsText,
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

  return enriched;
}

/**
 * 並行 Call A / Call B；僅當兩者 Promise 皆 rejected 時拋錯（不扣點由呼叫方處理）。
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

  /** 兩路都沒帶回可 merge 的結構時，與「雙 reject」同等：不應扣點。 */
  if (!parsedA && !parsedB) {
    throw new Error(
      `DECISION_INTEL_FLASH_ALL_FAILED: no_usable_json (A=${settledA.status}, B=${settledB.status})`,
    );
  }

  return mergeFlashIntoBase(base, parsedA, parsedB);
}
