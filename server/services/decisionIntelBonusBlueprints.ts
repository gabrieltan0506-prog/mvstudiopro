/**
 * 决策智库 · 战略地图选题扩写为可执行级专属文案（随 mutation 返回，不入库展示）。
 */

import type { AdvancedAIReportData } from "@shared/advancedAIReport";
import type { DecisionIntelTopicPick } from "@shared/decisionIntelTopicPicks";
import { selectDecisionIntelBonusTopics } from "@shared/decisionIntelBonusTopics";
import { buildAutoPickedTitleVariantsForBlueprint } from "@shared/platformTitleVariants";
import {
  PLATFORM_HOOK_SOLUTION_CONSULTATION_GUIDANCE,
  PLATFORM_REVIEW_SAFE_VOICE_GUIDANCE,
  needsReviewSafeVoice,
} from "@shared/platformCreatorInsightFraming";
import {
  PLATFORM_CULTURAL_MATERIAL_DIVERSITY_GUIDANCE,
  needsCulturalMaterialDiversity,
} from "@shared/platformCulturalMaterialDiversity";
import { STAGE2_LIGHTING_EMOTION_DIRECTOR_HINT_ZH } from "@shared/storyboardLightingEmotion";
import { extractJsonString } from "../_core/llm";
import { callDecisionIntelGpt55StructuredJson } from "./decisionIntelGpt55Copywriting.js";

function blueprintJsonForPrompt(contentBlueprint: unknown, maxChars = 10_000): string {
  try {
    return JSON.stringify(contentBlueprint ?? {}).slice(0, maxChars);
  } catch {
    return "{}";
  }
}

type BonusBlueprintOutput = {
  contentBlueprints?: Array<Record<string, unknown>>;
};

function picksToPromptBlock(picks: DecisionIntelTopicPick[]): string {
  return picks
    .map(
      (ex, i) =>
        `${i + 1}. 标题：${ex.title}\n   结构骨架：${ex.structure}${
          ex.predictedCtr != null || ex.predictedConversion != null || ex.brandMatchFit != null
            ? `\n   预估：封面 CTR ${ex.predictedCtr ?? "—"}% · 转化 ${ex.predictedConversion ?? "—"}% · 契合 ${ex.brandMatchFit ?? "—"}`
            : ""
        }`,
    )
    .join("\n\n");
}

/**
 * 为指定战略地图选题列表扩写与 Stage2 兼容的 contentBlueprint 条目。
 */
export async function generateDecisionIntelTopicBlueprints(params: {
  picks: DecisionIntelTopicPick[];
  contentBlueprint: unknown;
  topic: string;
  platformHint: string;
  idPrefix?: string;
  abortSignal?: AbortSignal;
  /** 平台蓝海词 / 标签推演词表（可选） */
  blueOceanLexicon?: {
    flat?: string[];
    grouped?: unknown[];
    tagCandidates?: string[];
  } | null;
  /** /platform 挂载 Skill 拼块（可选） */
  platformSkillsPrompt?: string | null;
}): Promise<Record<string, unknown>[]> {
  const picks = params.picks.filter((p) => p.title.trim() && p.structure.trim());
  if (picks.length === 0) return [];

  const platformLabelMap = {
    douyin: "抖音",
    bilibili: "B站",
    xiaohongshu: "小红书",
    kuaishou: "快手",
  } as const;
  const platformLabel =
    platformLabelMap[params.platformHint as keyof typeof platformLabelMap] ?? params.platformHint;

  const topicsBlock = picksToPromptBlock(picks);
  const lexicon = params.blueOceanLexicon;
  const flatWords = Array.isArray(lexicon?.flat) ? lexicon!.flat!.filter(Boolean).slice(0, 24) : [];
  const tagWords = Array.isArray(lexicon?.tagCandidates)
    ? lexicon!.tagCandidates!.filter(Boolean).slice(0, 12)
    : [];
  const blueOceanBlock =
    flatWords.length > 0 || tagWords.length > 0
      ? `\n【平台蓝海词与标签（数据推演，须自然嵌入文案/分镜/发布建议；highlightKeywords 标注本条所用词）】\n蓝海词：${flatWords.join("、") || "（无）"}\n标签种子：${tagWords.join("、") || "（无）"}\n`
      : "";

  const contextBlob = [
    params.topic,
    blueprintJsonForPrompt(params.contentBlueprint, 4000),
    topicsBlock,
  ].join("\n");
  const reviewBlock = needsReviewSafeVoice(contextBlob)
    ? `\n${PLATFORM_REVIEW_SAFE_VOICE_GUIDANCE}\n`
    : "";
  const diversityBlock = needsCulturalMaterialDiversity(contextBlob)
    ? `\n${PLATFORM_CULTURAL_MATERIAL_DIVERSITY_GUIDANCE}\n`
    : "";
  const skillsBlock = String(params.platformSkillsPrompt || "").trim();

  const system = `你是资深内容策划，负责把「战略地图选题结构」扩写为可立刻开拍、并能促成咨询意向的执行方案。
【规则】
- 只输出一个 JSON 对象，键名 contentBlueprints，数组长度必须恰好等于输入选题条数（${picks.length}）。
- 每条须含：title、format（「短视频」或「图文」）、hook（≥30字）、copywriting（≥180字）、suitablePlatforms（字符串数组）、actionableSteps（≥3条）、detailedScript（≥280字）、publishingAdvice、highlightKeywords（字符串数组 2–6 个）、executionDetails（含 environmentAndWardrobe、lightingAndCamera、stepByStepScript 数组≥4步）。
- 【场景生动化】文案与分镜中的拍摄场景须具体、可拍、能打动用户；包括但不局限于例如博物馆、户外旅行、知名景区、游泳池、网球场、音乐厅、饭店餐厅、路边大排档、商场、街景、自然风光等（可据人设拓展）；禁止多条扎堆书房、客厅等同质布景。
${PLATFORM_HOOK_SOLUTION_CONSULTATION_GUIDANCE}
${reviewBlock}
${diversityBlock}
${skillsBlock ? `${skillsBlock}\n` : ""}${STAGE2_LIGHTING_EMOTION_DIRECTOR_HINT_ZH}
- 若输入标题已是某一人物/词人模板且同批将复读，**强烈建议改写扩写**为同痛点但换人物/典籍/影视桥段/反差切口的新标题；宋朝范仲淹、文天祥、王安石等皆可写，勿自我禁止某朝代。
- 若提供蓝海词/标签，须在 copywriting、detailedScript、publishingAdvice 中自然嵌入 1–3 个，禁止堆砌 hashtag。
- 须严格延续输入选题的主线痛点与人设，不得偏题；语气专业、可拍、简体中文。
- **高度需求** executionDetails.lightingAndCamera 与 stepByStepScript 写清运镜、灯光与情绪（见上方手法卡）；只借手法，禁止点名导演/致敬；分镜表六栏含运镜、灯光安排与情绪表达。
- 禁止 markdown 代码块；第一个字符必须是 {。`;

  const user = `【账号选题方向】${params.topic}
【主战场平台】${platformLabel}
【既有内容蓝图参考】${blueprintJsonForPrompt(params.contentBlueprint)}
${blueOceanBlock}
请为以下 ${picks.length} 条战略地图选题各写 1 套完整执行文案（顺序与编号一致）。
每条必须先从主人公/人设推断「客户是谁、痛点是什么」，再写吸睛标题、钩子、半成品解法与咨询 CTA：

${topicsBlock}`;

  const raw = await callDecisionIntelGpt55StructuredJson({
    taskSystemInstruction: system,
    userText: user,
    abortSignal: params.abortSignal,
  });
  let parsed: BonusBlueprintOutput;
  try {
    parsed = JSON.parse(extractJsonString(raw)) as BonusBlueprintOutput;
  } catch {
    return [];
  }

  const list = Array.isArray(parsed.contentBlueprints) ? parsed.contentBlueprints : [];
  const out: Record<string, unknown>[] = [];
  const idPrefix = params.idPrefix ?? "decision-intel-topic";

  for (let i = 0; i < Math.min(picks.length, list.length); i++) {
    const bp = list[i];
    if (!bp || typeof bp !== "object") continue;
    const pick = picks[i]!;
    const seed = {
      ...bp,
      title: String(bp.title ?? pick.title).trim() || pick.title,
      structure: pick.structure,
      decisionIntelBonus: idPrefix.includes("bonus"),
      decisionIntelPicked: idPrefix.includes("picked"),
      predictedCtr: pick.predictedCtr,
      predictedConversion: pick.predictedConversion,
      brandMatchFit: pick.brandMatchFit,
    };
    const titleVariants = buildAutoPickedTitleVariantsForBlueprint(seed, 20 + i);
    const pickedTitle = String(titleVariants[0]?.title ?? "").trim();
    out.push({
      ...seed,
      id: `${idPrefix}-${i}-${Date.now()}`,
      title: pickedTitle || seed.title,
      titleVariants,
    });
  }

  return out;
}

/**
 * 依战略地图选题结构实例筛选 Top2，并扩写为与 Stage2 兼容的 contentBlueprint 条目。
 */
export async function generateDecisionIntelBonusBlueprints(params: {
  report: AdvancedAIReportData;
  contentBlueprint: unknown;
  topic: string;
  platformHint: string;
  abortSignal?: AbortSignal;
  /** 平台蓝海词 / 标签推演词表（可选） */
  blueOceanLexicon?: {
    flat?: string[];
    grouped?: unknown[];
    tagCandidates?: string[];
  } | null;
}): Promise<Record<string, unknown>[]> {
  const selected = selectDecisionIntelBonusTopics(params.report.topicStructureExamples);
  if (selected.length === 0) return [];

  return generateDecisionIntelTopicBlueprints({
    picks: selected.map((ex) => ({
      title: ex.title,
      structure: ex.structure,
      predictedCtr: ex.predictedCtr,
      predictedConversion: ex.predictedConversion,
      brandMatchFit: ex.brandMatchFit,
      source: "structure" as const,
    })),
    contentBlueprint: params.contentBlueprint,
    topic: params.topic,
    platformHint: params.platformHint,
    idPrefix: "decision-intel-bonus",
    abortSignal: params.abortSignal,
    blueOceanLexicon: params.blueOceanLexicon,
  });
}
