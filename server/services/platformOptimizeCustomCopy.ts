import {
  extractFirstChoicePlainText,
  extractJsonString,
  invokeLLM,
} from "../_core/llm";
import {
  getPlatformStage2OpenAiModel,
  resolvePlatformStage2OpenAiReasoningEffort,
} from "../config/platformSwitches";
import { isOhMyGptChatConfigured } from "./ohmygptChat";
import {
  callGemini35FlashCopywriting,
  resolveGemini35FlashCopywritingMaxOutputTokens,
  resolvePlatformStage2GeminiModel,
} from "./gemini35FlashRuntime";

export type OptimizeCustomCopyInput = {
  sourceText: string;
  optimizationBrief?: string;
  /** 素材视觉分析摘要（来自 growth_analyze_images，禁止走 snapshot 模板） */
  visionContext?: string;
  /** 为 true 时附加 readTrendStoreForPlatforms 近期 live 样本 */
  includeLiveTrends?: boolean;
  liveTrendWindowDays?: number;
  /** /platform 挂载 Skill 拼块 */
  platformSkillsPrompt?: string;
};

export type OptimizeCustomCopyResult = {
  summary: string;
  optimizedMarkdown: string;
  titles: string[];
  hooks: string[];
  platformNotes: Array<{ platform: string; angle: string; copySnippet: string }>;
  storyboardNotes?: string;
  coverNotes?: string;
};

/** GPT / Gemini 链路均失败时统一对用户展示的提示。 */
export const OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE = "算力紧张，请稍后再试";

const SYSTEM_PROMPT = `你是 mvstudiopro 平台页的资深内容顾问，专门帮创作者把「已有封面文案、分镜脚本、商业背景」深度改写成可直接发布的版本。

硬性要求：
1. **必须紧扣用户原文**：人物、场景、专业背景、产品卖点、情绪主线不得被替换成无关模板（例如电竞、京剧、泛化「爆款指数」套话）。
2. **禁止**输出与用户素材无关的示例标题；禁止「首先其次综上所述」公文腔；禁止空泛平台话术堆砌。
3. 若用户提到封面 / 分镜 / 八格 / 2×4，分别给出可执行的优化建议（主标、副标、各格叙事节奏、口播/字幕要点）。
4. 若提供【Platform 挂载 Skill】块，优化稿**必须遵守**（文化/生活场域、封面停滑、蓝海词、平台母语、强监管表达等）；与软建议冲突时以 Skill 为准。
5. 输出 JSON，字段见 schema；optimizedMarkdown 为完整可读 Markdown（含分段标题，便于复制到生图或发布）。

JSON schema:
{
  "summary": "一句话说明本次优化重点",
  "optimizedMarkdown": "完整优化稿（Markdown）",
  "titles": ["主标题候选1", "主标题候选2", "主标题候选3"],
  "hooks": ["开场钩子1", "开场钩子2"],
  "platformNotes": [
    { "platform": "小红书|抖音|B站|快手", "angle": "该平台切入角度", "copySnippet": "该平台可直接用的短文案片段" }
  ],
  "storyboardNotes": "若涉及分镜/八格：逐格或分段优化建议（可选）",
  "coverNotes": "若涉及封面：主视觉/主标/副标/信息层级建议（可选）"
}`;

function buildUserBlock(input: OptimizeCustomCopyInput, liveTrendBrief?: string): string {
  const sourceText = String(input.sourceText || "").trim();
  const brief = String(input.optimizationBrief || "").trim();
  const vision = String(input.visionContext || "").trim();
  const skills = String(input.platformSkillsPrompt || "").trim();
  const parts = ["【待优化原文】", sourceText];
  if (brief) parts.push("\n【用户优化要求】\n" + brief);
  if (vision) parts.push("\n【上传素材视觉分析（须紧扣，禁止忽略）】\n" + vision.slice(0, 8000));
  if (skills) parts.push("\n" + skills.slice(0, 12000));
  if (liveTrendBrief?.trim()) parts.push("\n" + liveTrendBrief.trim());
  return parts.join("\n");
}

function parseOptimizeCustomCopyJson(raw: string): OptimizeCustomCopyResult {
  const trimmed = String(raw || "").trim();
  if (!trimmed || /^an error occurred/i.test(trimmed)) {
    throw new Error(OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(extractJsonString(trimmed)) as Record<string, unknown>;
  } catch {
    throw new Error(OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE);
  }

  const optimizedMarkdown = String(parsed.optimizedMarkdown || parsed.markdown || "").trim();
  if (!optimizedMarkdown) {
    throw new Error(OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE);
  }

  const titles = Array.isArray(parsed.titles)
    ? parsed.titles.map((t) => String(t).trim()).filter(Boolean).slice(0, 5)
    : [];
  const hooks = Array.isArray(parsed.hooks)
    ? parsed.hooks.map((t) => String(t).trim()).filter(Boolean).slice(0, 5)
    : [];
  const platformNotes = Array.isArray(parsed.platformNotes)
    ? parsed.platformNotes
        .map((row) => {
          const r = row as Record<string, unknown>;
          return {
            platform: String(r.platform || "").trim(),
            angle: String(r.angle || "").trim(),
            copySnippet: String(r.copySnippet || "").trim(),
          };
        })
        .filter((r) => r.platform || r.angle || r.copySnippet)
        .slice(0, 6)
    : [];

  return {
    summary: String(parsed.summary || "已完成深度优化").trim(),
    optimizedMarkdown,
    titles,
    hooks,
    platformNotes,
    storyboardNotes: parsed.storyboardNotes ? String(parsed.storyboardNotes).trim() : undefined,
    coverNotes: parsed.coverNotes ? String(parsed.coverNotes).trim() : undefined,
  };
}

async function invokeOptimizeViaGpt55(userBlock: string, reasoningEffort: "low" | "minimal"): Promise<string> {
  const hasOhMy = isOhMyGptChatConfigured();
  const hasEvolink = Boolean(String(process.env.EVOLINK_API_KEY || "").trim());
  if (!hasOhMy && !hasEvolink) {
    throw new Error(OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE);
  }
  const response = await invokeLLM({
    provider: "openai",
    modelName: getPlatformStage2OpenAiModel(),
    reasoningEffort,
    max_tokens: resolveGemini35FlashCopywritingMaxOutputTokens(),
    temperature: 0.8,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userBlock },
    ],
    response_format: { type: "json_object" },
  });
  return extractFirstChoicePlainText(response).trim();
}

async function invokeOptimizeViaGeminiFlash(userBlock: string): Promise<string> {
  const geminiModel = resolvePlatformStage2GeminiModel();
  console.warn(`[optimizeCustomCopy] GPT-5.6 失败 → Gemini 3.1 Pro fallback · model=${geminiModel}`);
  return (
    await callGemini35FlashCopywriting({
      taskSystemInstruction: SYSTEM_PROMPT,
      userText: userBlock,
      responseMimeType: "application/json",
      maxOutputTokens: resolveGemini35FlashCopywritingMaxOutputTokens(),
      temperature: 0.8,
      topP: 0.95,
      modelName: geminiModel,
    })
  ).trim();
}

export async function optimizeCustomCopy(input: OptimizeCustomCopyInput): Promise<OptimizeCustomCopyResult> {
  const sourceText = String(input.sourceText || "").trim();
  if (sourceText.length < 10) {
    throw new Error("请至少提供 10 字以上的待优化文案");
  }

  let liveTrendBrief: string | undefined;
  if (input.includeLiveTrends) {
    const { buildPlatformLiveTrendBriefForOptimize } = await import("./platformLiveTrendBrief.js");
    liveTrendBrief = await buildPlatformLiveTrendBriefForOptimize({
      windowDays: input.liveTrendWindowDays ?? 7,
    });
  }

  const userBlock = buildUserBlock(input, liveTrendBrief);
  const primaryReasoning =
    resolvePlatformStage2OpenAiReasoningEffort() === "high" ||
    resolvePlatformStage2OpenAiReasoningEffort() === "xhigh"
      ? "low"
      : (resolvePlatformStage2OpenAiReasoningEffort() as "low" | "minimal");

  let lastError: unknown;
  for (const reasoningEffort of [primaryReasoning, "minimal"] as const) {
    try {
      const raw = await invokeOptimizeViaGpt55(userBlock, reasoningEffort);
      return parseOptimizeCustomCopyJson(raw);
    } catch (err) {
      lastError = err;
      console.warn(
        `[optimizeCustomCopy] GPT-5.6 失败 (reasoning=${reasoningEffort}):`,
        err instanceof Error ? err.message.slice(0, 240) : err,
      );
    }
  }

  try {
    const raw = await invokeOptimizeViaGeminiFlash(userBlock);
    return parseOptimizeCustomCopyJson(raw);
  } catch (err) {
    lastError = err;
    console.warn(
      "[optimizeCustomCopy] Gemini 3.1 Pro fallback 失败:",
      err instanceof Error ? err.message.slice(0, 240) : err,
    );
  }

  console.warn(
    "[optimizeCustomCopy] GPT-5.6 + Gemini Flash 全部失败:",
    lastError instanceof Error ? lastError.message.slice(0, 240) : lastError,
  );
  throw new Error(OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE);
}

/** @internal 单测用：解析模型 JSON 文本 */
export function parseOptimizeCustomCopyJsonForTest(raw: string): OptimizeCustomCopyResult {
  return parseOptimizeCustomCopyJson(raw);
}
