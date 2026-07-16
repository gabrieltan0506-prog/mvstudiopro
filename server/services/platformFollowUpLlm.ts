/**
 * 平台「深度追问 / 趋势续分析」：仅 Evolink GPT‑5.6 Sol（已取消 OhMyGPT / Gemini fallback）。
 */
import { extractFirstChoicePlainText, invokeLLM } from "../_core/llm.js";
import {
  getPlatformStage2OpenAiModel,
  resolvePlatformStage2OpenAiReasoningEffort,
} from "../config/platformSwitches.js";
import { resolveGemini35FlashCopywritingMaxOutputTokens } from "./gemini35FlashRuntime.js";

const FOLLOW_UP_TEMPERATURE = 0.8;

export function buildPlatformFollowUpSystemPrompt(windowDays: number): string {
  return `你是一位专业、克制、会直接给判断的平台策略顾问，也会把策略翻成用户马上能开拍、开写、开卖的动作。

你的任务是基于用户当前选中的平台趋势看板，回答后续追问。

要求：
1. 回答必须专业，但语气要有温度，像一个成熟顾问在帮用户梳理方向。
2. 第一段必须先给出明确判断，不要先铺垫，不要两边都说。
3. answer 必须明显分成三个部分：结论、为什么、下一步怎么做。可以用自然段，不要写成模板编号。
4. 如果用户问“从哪些平台入手”“怎么实现商业价值”这类问题，必须明确给出优先顺序、适合承接的商业方向，以及短期不建议投入的方向。
5. 如果问题涉及选题、文案、图文、视频、脚本、拍法，你必须写出具体方案，至少覆盖：题目方向、开头怎么说、结构怎么排、视频怎么拍或图文怎么写；拍摄场景须生动具体（包括但不局限于博物馆、户外旅行、知名景区、泳池、球场、音乐厅、饭店餐厅、路边大排档等，须贴合此人设），能打动用户、有画面感。
6. 如果 snapshot 里已经有 titleExecutions、creationAssist、monetizationStrategies、decisionFramework，要优先把这些证据翻译成“这个用户现在就能执行”的动作，而不是继续抽象分析。
7. 变现路径只能保留和这个用户身份、内容方向、平台表达直接相关的 1 到 3 条。不要把带货、课程、咨询、社群、品牌合作全部列一遍。
8. 如果用户背景是专业身份和文化审美内容的结合，就优先写与信任、解释力、审美内容承接有关的路径，而不是默认带货。
9. 不要泄露后台工程逻辑，不要出现 fallback、live sample、historical、verify、数据库、覆盖率、补位、主链、样本裂缝 这类内部词。
10. 只能围绕用户当前选中的 ${windowDays} 天窗口来回答。
11. 回答必须明显带入用户当前问题和关注点，不能输出放在哪个用户身上都成立的套话。
12. 不要把平台介绍或平台画像原样搬给用户，要把后台证据翻译成前台可执行结论。
13. encouragement 必须是一句短的执行提醒，不要像客服安慰。
14. nextQuestions 要像真人顾问会继续往下问的具体问题，最多 4 个。
15. 输出严格 JSON，字段为 title、answer、encouragement、nextQuestions。`;
}

type FollowUpSnapshotSlice = {
  overview?: unknown;
  platformSnapshots?: Array<{
    platform?: string;
    displayName?: string;
    audienceFitScore?: number;
    momentumScore?: number;
    summary?: string;
    fitLabel?: string;
  }>;
  platformRecommendations?: unknown[];
  topicLibrary?: unknown[];
  businessInsights?: unknown[];
  growthPlan?: unknown[];
  titleExecutions?: unknown[];
  monetizationStrategies?: unknown[];
  decisionFramework?: {
    mainPath?: unknown;
    validationPlan?: unknown[];
    assetAdaptation?: unknown;
  };
  creationAssist?: { brief?: unknown };
};

export function buildPlatformFollowUpUserJson(input: {
  windowDays: number;
  context: string;
  question: string;
  snapshot: FollowUpSnapshotSlice;
}): string {
  const snap = input.snapshot;
  return JSON.stringify({
    windowDays: input.windowDays,
    context: input.context || "",
    question: input.question,
    snapshot: {
      overview: snap.overview,
      platformSnapshots: (snap.platformSnapshots || []).slice(0, 4).map((item) => ({
        platform: item.platform,
        displayName: item.displayName,
        audienceFitScore: item.audienceFitScore,
        momentumScore: item.momentumScore,
        summary: item.summary,
        fitLabel: item.fitLabel,
      })),
      platformRecommendations: (snap.platformRecommendations || []).slice(0, 3),
      topicLibrary: (snap.topicLibrary || []).slice(0, 5),
      businessInsights: (snap.businessInsights || []).slice(0, 3),
      growthPlan: (snap.growthPlan || []).slice(0, 2),
      titleExecutions: (snap.titleExecutions || []).slice(0, 3),
      monetizationStrategies: (snap.monetizationStrategies || []).slice(0, 2),
      decisionFramework: {
        mainPath: snap.decisionFramework?.mainPath,
        validationPlan: (snap.decisionFramework?.validationPlan || []).slice(0, 2),
        assetAdaptation: snap.decisionFramework?.assetAdaptation,
      },
      creationAssist: {
        brief: snap.creationAssist?.brief,
      },
    },
  });
}

/** 深度追问 · 纯文本：仅 Evolink GPT-5.6 · JSON 输出。 */
export async function invokePlatformFollowUpGpt55(options: {
  windowDays: number;
  context: string;
  question: string;
  snapshot: FollowUpSnapshotSlice;
  abortSignal?: AbortSignal;
}): Promise<{ raw: string; modelName: string; provider: "openai" | "gemini"; fallbackUsed: boolean }> {
  const systemInstruction = buildPlatformFollowUpSystemPrompt(options.windowDays);
  const userText = buildPlatformFollowUpUserJson(options);
  const openaiModel = getPlatformStage2OpenAiModel();
  const reasoningEffort = resolvePlatformStage2OpenAiReasoningEffort();

  const response = await invokeLLM({
    provider: "openai",
    modelName: openaiModel,
    max_tokens: resolveGemini35FlashCopywritingMaxOutputTokens(),
    temperature: FOLLOW_UP_TEMPERATURE,
    response_format: { type: "json_object" },
    reasoningEffort,
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: userText },
    ],
    abortSignal: options.abortSignal,
  });
  const raw = extractFirstChoicePlainText(response).trim();
  if (!raw) {
    throw new Error("Evolink GPT-5.6 Sol 深度追问返回空内容（已取消 Gemini fallback）");
  }
  return { raw, modelName: openaiModel, provider: "openai", fallbackUsed: false };
}
