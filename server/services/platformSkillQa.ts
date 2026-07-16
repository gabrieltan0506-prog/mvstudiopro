/**
 * /platform 创作顾问问答：每日免费额度 + 可选单页生图（首张封面九折）。
 * 文案默认 GPT-5.6 Terra（reasoning high）；不对普通用户展示模型名。
 * supervisor 可切换 Sol / Terra。
 */
import { and, count, eq, gte } from "drizzle-orm";
import { extractFirstChoicePlainText, extractJsonString, invokeLLM } from "../_core/llm.js";
import {
  resolvePlatformSkillQaOpenAiModel,
  resolvePlatformSkillQaReasoningEffort,
} from "../config/platformSwitches.js";
import { getDb } from "../db.js";
import { stripeUsageLogs } from "../../drizzle/schema-stripe.js";
import {
  PLATFORM_SKILL_QA_DAILY_FREE_LIMIT,
  platformSkillQaImageCredits,
} from "../../shared/plans.js";
import { composePlatformImageSkillHints } from "../../shared/platformNativeVariants.js";
import { resolvePlatformSkillsPrompt } from "./platformSkillsService.js";
import { translateMattingUserPromptToEnglish } from "./platformCustomMatting.js";
import { generateGptImage2FromRawEnglishPrompt, appendImageFlowLog } from "./proxyImageService.js";

export const PLATFORM_SKILL_QA_ACTION = "platformSkillQa";
export const PLATFORM_SKILL_QA_IMAGE_ACTION = "platformSkillQaImage";

/** 创作顾问问答输出上限（用户指定 65535） */
const PLATFORM_SKILL_QA_MAX_OUTPUT_TOKENS = 65_535;

export type PlatformSkillQaAskResult = {
  answer: string;
  remainingFreeToday: number;
  usedToday: number;
  dailyLimit: number;
  imageOffer: null | {
    creationRelated: boolean;
    suggestedPrompt: string;
    creditCost: number;
    isFirstImageDiscount: boolean;
    guideMessage: string;
  };
};

export type PlatformSkillQaImageResult = {
  imageUrl: string;
  creditsCharged: number;
  isFirstImageDiscount: boolean;
  englishPrompt: string;
  imageGenFlowLog: string[];
};

function startOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function countPlatformSkillQaToday(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ c: count() })
    .from(stripeUsageLogs)
    .where(
      and(
        eq(stripeUsageLogs.userId, userId),
        eq(stripeUsageLogs.action, PLATFORM_SKILL_QA_ACTION),
        gte(stripeUsageLogs.createdAt, startOfTodayLocal()),
      ),
    );
  return Number(row?.c || 0);
}

export async function countPlatformSkillQaImagesEver(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ c: count() })
    .from(stripeUsageLogs)
    .where(
      and(eq(stripeUsageLogs.userId, userId), eq(stripeUsageLogs.action, PLATFORM_SKILL_QA_IMAGE_ACTION)),
    );
  return Number(row?.c || 0);
}

export async function logPlatformSkillQaFreeUse(userId: number, question: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(stripeUsageLogs).values({
    userId,
    action: PLATFORM_SKILL_QA_ACTION,
    creditsCost: 0,
    isFreeQuota: 1,
    description: `创作顾问问答（免费）· ${String(question || "").slice(0, 80)}`,
    balanceAfter: null,
  });
}

const ASK_SYSTEM = `你是 mvstudiopro /platform 页的「创作顾问」。用户可问任何问题：创作、Skill、选题文案、封面节奏、平台运营、行业时令、虚拟/电子资料赛道、生活咨询等——凡用户想问的都可以认真答。

硬规则：
1. 回答用简体中文，幽默清晰，禁说教训话；可给可执行建议；需要时可分点、分时节/人群/行业展开。
2. 若问题涉及 Skill：主动告知 Skill **可自由勾选/取消**；若 Skill 没法满足诉求，请用户把要求写进「人物背景与创作诉求」或自定义提示词——**只要有提示词要求，优先级高于 Skill 设定**。
3. 若用户只是提问/求写法/求改句/求分析/求解释 → imageIntent=false。
4. 若用户明确要求「生图/画一张/出封面图/生成图片」→ imageIntent=true，并写 suggestedImagePrompt（中文，可直接给生图模型，含主体/姿势/场景/少字封面气质）。
5. 若生图诉求属于「创作相关」（选题封面、分镜格、全案人物设定、系列笔记视觉、人设 IP 视觉体系等）→ creationRelated=true，guideMessage 必须劝用户去「自定义创作工作台」或「开始全案分析」，说明按人设+选题推演再出图，效果远好于本栏盲盒抽卡；仍可提供 suggestedImagePrompt 供用户确认试一张。
6. 若只是随便画无关创作体系的单张（风景、表情包试玩等）→ creationRelated=false，guideMessage 可简短说明本栏单页价。
7. 若提供了挂载 Skill 摘要，回答与 suggestedImagePrompt **默认**参考；但用户提问/提示词里的明确要求冲突时，**以用户要求为准**。
8. 禁止在回答里写出具体模型名称、API、供应商或内部引擎代号。

只输出 JSON：
{
  "answer": "给用户看的完整回答（Markdown 短文可）",
  "imageIntent": false,
  "creationRelated": false,
  "suggestedImagePrompt": "",
  "guideMessage": ""
}`;

function looksLikeUpstreamGarbage(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return true;
  if (/^An error\b/i.test(t)) return true;
  if (t.startsWith("<!DOCTYPE") || t.startsWith("<html")) return true;
  if (/Unexpected token|is not valid JSON/i.test(t)) return true;
  return false;
}

function parseAskJson(raw: string): {
  answer: string;
  imageIntent: boolean;
  creationRelated: boolean;
  suggestedImagePrompt: string;
  guideMessage: string;
} {
  const text = String(raw || "").trim();
  if (looksLikeUpstreamGarbage(text)) {
    throw new Error("算力紧张或请求超时，请稍后重试");
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(extractJsonString(text) || text) as Record<string, unknown>;
  } catch {
    // 非 JSON 但可读正文：直接当 answer（勿把网关错误原文抛给用户）
    if (looksLikeUpstreamGarbage(text) || text.length < 8) {
      throw new Error("算力紧张或请求超时，请稍后重试");
    }
    parsed = { answer: text };
  }
  const answer = String(parsed.answer || "").trim();
  if (!answer || looksLikeUpstreamGarbage(answer)) {
    throw new Error("算力紧张或请求超时，请稍后重试");
  }
  return {
    answer: answer.slice(0, 8000),
    imageIntent: Boolean(parsed.imageIntent),
    creationRelated: Boolean(parsed.creationRelated),
    suggestedImagePrompt: String(parsed.suggestedImagePrompt || "").trim().slice(0, 2000),
    guideMessage: String(parsed.guideMessage || "").trim().slice(0, 1200),
  };
}

export async function askPlatformSkillQa(params: {
  userId: number;
  question: string;
  enabledSkillIds?: string[] | null;
  allowBloggerTitle?: boolean;
  /** 跳过每日免费次数上限（admin / supervisor 角色） */
  isAdmin?: boolean;
  /** 允许覆盖问答模型（admin / supervisor / 合法 supervisorToken） */
  allowQaModelOverride?: boolean;
  /** supervisor 可选；一般用户忽略，强制 Terra */
  qaModel?: string | null;
}): Promise<PlatformSkillQaAskResult> {
  const question = String(params.question || "").trim();
  if (question.length < 2) throw new Error("请先输入问题");

  const usedToday = await countPlatformSkillQaToday(params.userId);
  const dailyLimit = PLATFORM_SKILL_QA_DAILY_FREE_LIMIT;
  if (!params.isAdmin && usedToday >= dailyLimit) {
    throw new Error(`今日免费问答已达上限（${dailyLimit} 次），明天再来，或去「自定义 / 全案」继续创作。`);
  }

  const modelName = resolvePlatformSkillQaOpenAiModel({
    requested: params.qaModel,
    isSupervisor: Boolean(params.allowQaModelOverride),
  });
  const reasoningEffort = resolvePlatformSkillQaReasoningEffort();

  const skillsPrompt = await resolvePlatformSkillsPrompt({
    userId: params.userId,
    enabledSkillIds: params.enabledSkillIds,
    allowBloggerTitle: Boolean(params.allowBloggerTitle),
    routeContext: question,
    sheetKind: "unknown",
  }).catch(() => "");

  const userText = [
    "【用户提问】",
    question,
    skillsPrompt ? `\n${skillsPrompt.slice(0, 10000)}` : "",
  ].join("\n");

  const ASK_MAX_ATTEMPTS = 2;
  let parsed: ReturnType<typeof parseAskJson> | null = null;
  let lastErr = "";
  for (let attempt = 1; attempt <= ASK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await invokeLLM({
        provider: "openai",
        modelName,
        max_tokens: PLATFORM_SKILL_QA_MAX_OUTPUT_TOKENS,
        temperature: 0.7,
        response_format: { type: "json_object" },
        reasoningEffort,
        messages: [
          { role: "system", content: ASK_SYSTEM },
          { role: "user", content: userText },
        ],
      });
      const raw = extractFirstChoicePlainText(response);
      parsed = parseAskJson(raw);
      lastErr = "";
      break;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      console.warn(`[askPlatformSkillQa] attempt ${attempt}/${ASK_MAX_ATTEMPTS}:`, lastErr.slice(0, 240));
      if (attempt < ASK_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 350 * attempt));
      }
    }
  }
  if (!parsed) {
    const friendly =
      /Unexpected token|is not valid JSON|An error|非 JSON|空内容|timeout|超时|fetch failed|算力/i.test(lastErr)
        ? "算力紧张或请求超时，请稍后重试"
        : lastErr.slice(0, 160) || "问答失败，请稍后重试";
    throw new Error(friendly);
  }

  if (!params.isAdmin) {
    await logPlatformSkillQaFreeUse(params.userId, question);
  }
  const usedAfter = params.isAdmin ? usedToday : usedToday + 1;

  const imageCount = await countPlatformSkillQaImagesEver(params.userId);
  const { cost, isFirstDiscount } = platformSkillQaImageCredits(imageCount);

  let imageOffer: PlatformSkillQaAskResult["imageOffer"] = null;
  if (parsed.imageIntent && parsed.suggestedImagePrompt) {
    const defaultGuide = parsed.creationRelated
      ? "创作相关出图更建议走「自定义创作」或「全案分析」：先定人设与选题再出图，比在此盲盒抽卡稳得多。若仍想先试一张，可点下方确认（首张封面九折）。"
      : "可确认生成一张单页图。首张按封面九折，之后恢复封面原价。";
    imageOffer = {
      creationRelated: parsed.creationRelated,
      suggestedPrompt: parsed.suggestedImagePrompt,
      creditCost: cost,
      isFirstImageDiscount: isFirstDiscount,
      guideMessage: parsed.guideMessage || defaultGuide,
    };
  }

  return {
    answer: parsed.answer,
    remainingFreeToday: Math.max(0, dailyLimit - usedAfter),
    usedToday: usedAfter,
    dailyLimit,
    imageOffer,
  };
}

export async function confirmPlatformSkillQaImage(params: {
  userId: number;
  imagePrompt: string;
  enabledSkillIds?: string[] | null;
  aspectRatio?: "9:16" | "16:9" | "3:4" | "4:3";
}): Promise<{
  needCharge: number;
  isFirstImageDiscount: boolean;
  runGenerate: () => Promise<PlatformSkillQaImageResult>;
}> {
  const prompt = String(params.imagePrompt || "").trim();
  if (prompt.length < 4) throw new Error("生图提示词过短");

  const imageCount = await countPlatformSkillQaImagesEver(params.userId);
  const { cost, isFirstDiscount } = platformSkillQaImageCredits(imageCount);
  const aspect = params.aspectRatio || "9:16";
  const skillHints = composePlatformImageSkillHints(
    Array.isArray(params.enabledSkillIds) ? params.enabledSkillIds : null,
    { routeContext: prompt, sheetKind: "unknown", forceCoverShortCopy: true },
  );

  return {
    needCharge: cost,
    isFirstImageDiscount: isFirstDiscount,
    runGenerate: async () => {
      const flowLog: string[] = [];
      appendImageFlowLog(flowLog, `[创作顾问生图] 开始 · 九折首张=${isFirstDiscount} · 扣费=${cost}`);
      const skillsPrompt = await resolvePlatformSkillsPrompt({
        userId: params.userId,
        enabledSkillIds: params.enabledSkillIds,
        allowBloggerTitle: false,
        routeContext: prompt,
        sheetKind: "unknown",
      }).catch(() => "");
      const mergedZh = [
        prompt,
        skillHints ? `\n${skillHints}` : "",
        skillsPrompt ? `\n【须遵守的 Skill 视觉约束摘要】\n${skillsPrompt.slice(0, 3500)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
        .trim();
      const englishCore = await translateMattingUserPromptToEnglish(mergedZh, flowLog);
      const englishPrompt = [
        englishCore,
        `Framing aspect ratio ${aspect}.`,
        "Photorealistic or premium editorial still as fits the brief; crisp Simplified Chinese on-image text only if the prompt asks for cover text; no watermark.",
      ].join("\n\n");

      const imageUrl = await generateGptImage2FromRawEnglishPrompt({
        englishPrompt,
        aspectRatio: aspect === "16:9" || aspect === "4:3" ? "16:9" : "9:16",
        gcsSubdir: "platform-skill-qa",
        flowLog,
      });
      if (!imageUrl) throw new Error("生图失败，请稍后重试");

      return {
        imageUrl,
        creditsCharged: cost,
        isFirstImageDiscount: isFirstDiscount,
        englishPrompt,
        imageGenFlowLog: flowLog,
      };
    },
  };
}
