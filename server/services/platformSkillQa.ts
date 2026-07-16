/**
 * /platform 创作顾问问答：每日免费额度 + 可选单页生图（首张封面九折）。
 * 文案默认 GPT-5.6 Terra（reasoning high）；不对普通用户展示模型名。
 * supervisor 可切换 Sol / Terra。
 *
 * 核心口径：像可调用趋势库的 ChatGPT——**先直接回答用户问题**；
 * Skill 仅作软参考，禁止被 Skill 带跑成全案策略看板。
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

/** 市场/赛道/定价类提问：需趋势库证据，且不应灌入大量创作 Skill */
export type PlatformSkillQaKind = "market_research" | "creative_help" | "general";

export function classifyPlatformSkillQaKind(question: string): PlatformSkillQaKind {
  const q = String(question || "").trim();
  if (!q) return "general";
  if (
    /虚拟资料|电子资料|资料包|网盘|课件|题库|模板店|小报童|知识付费|卖什么|销量|持续量大|利润|定价|价格带|客单价|时间节点|节点营销|赛道|蓝海|能不能卖|卖点类型|哪些类型/.test(
      q,
    )
  ) {
    return "market_research";
  }
  if (/改写|封面|分镜|选题|文案|钩子|Skill|怎么写|润色|人设|脚本/.test(q)) {
    return "creative_help";
  }
  return "general";
}

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

const ASK_SYSTEM = `你是 mvstudiopro「创作顾问」——行为对标「可查内部趋势库、也可参考联网摘要的 ChatGPT」：
用户问什么就答什么；工具与资料都是辅助，不是牢笼。

【绝对优先】
1. 【用户提问】是唯一主任务。回答结构必须对齐用户问法（例如「类型 / 持续量大 / 利润高 / 时间节点 / 定价」就按块答）。缺证据就写清「库内不足 / 联网未证实 / 需再验证」，禁止装懂。
2. 禁止被 Skill 带跑成全案看板：禁止「平台优先级与切入方式」「个性化分析」「现在就能执行的动作」「第1步发帖排期」等格式，除非用户明确要排期计划。
3. 证据用法（都可用，按需组合，勿写死只用一种）：
   - 【趋势库样本】：平台真实抓取痕迹，适合看「什么内容在冒头」。
   - 【联网检索摘要】：公开网页/资讯归纳，适合政策、品类、定价口径、行业常识；注明「来自公开信息归纳」。
   - 两者都可引用；冲突时说明差异；都没有就给可执行验证步骤。
4. 禁止伪造精确成交额、精确搜索量、伪造「官方数据」链接。可给价格带区间并标明假设。
5. Skill 摘要仅在文案/封面/钩子写法时软参考；与本问无关则忽略。冲突以用户提问为准。
6. 简体中文；禁止写出模型名、API、供应商、内部引擎代号。
7. 生图：只提问/求分析 → imageIntent=false；明确要生图 → imageIntent=true。

只输出 JSON：
{
  "answer": "完整回答（Markdown 可，必须直接回应用户每一问）",
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
    if (looksLikeUpstreamGarbage(text) || text.length < 8) {
      throw new Error("算力紧张或请求超时，请稍后重试");
    }
    parsed = { answer: text };
  }
  const answer = String(parsed.answer || "").trim();
  if (!answer || looksLikeUpstreamGarbage(answer)) {
    throw new Error("算力紧张或请求超时，请稍后重试");
  }
  // 若模型仍吐出看板腔，硬拒并让上层重试
  if (
    /平台优先级与切入方式|现在就能执行的动作|个性化分析\s*$/m.test(answer) &&
    /第\s*1\s*步|周四|周六|周日/.test(answer)
  ) {
    throw new Error("回答偏离用户问题（策略看板腔），请重试");
  }
  return {
    answer: answer.slice(0, 12_000),
    imageIntent: Boolean(parsed.imageIntent),
    creationRelated: Boolean(parsed.creationRelated),
    suggestedImagePrompt: String(parsed.suggestedImagePrompt || "").trim().slice(0, 2000),
    guideMessage: String(parsed.guideMessage || "").trim().slice(0, 1200),
  };
}

/** 是否值得拉趋势库（软启发，非硬门禁） */
export function shouldFetchTrendEvidence(question: string): boolean {
  return /小红书|小紅書|抖音|快手|B站|bilibili|赛道|选题|爆款|虚拟资料|电子资料|销量|笔记|带货|趋势|热搜|平台/.test(
    String(question || ""),
  );
}

/** 是否值得联网检索（软启发；用户点名「网络/官网/政策」时更积极） */
export function shouldFetchWebEvidence(question: string): boolean {
  const q = String(question || "");
  if (/根据数据库以及网络|网络的相关|联网|官网|政策|合规|最新|现在|目前|公开信息|搜索一下/.test(q)) {
    return true;
  }
  return /定价|利润|虚拟资料|电子资料|知识付费|小报童|资料包|赛道|能不能卖|哪些类型|时间节点/.test(q);
}

async function buildTrendEvidenceForQuestion(question: string): Promise<string> {
  if (!shouldFetchTrendEvidence(question)) return "";
  const q = String(question || "");
  const wantsXhs = /小红书|小紅書|xhs|rednote/i.test(q);
  const platforms = (wantsXhs
    ? (["xiaohongshu"] as const)
    : (["xiaohongshu", "douyin", "bilibili", "kuaishou"] as const)
  ).slice(0, wantsXhs ? 1 : 2);

  try {
    const { readTrendStoreForPlatforms } = await import("../growth/trendStore.js");
    const store = await Promise.race([
      readTrendStoreForPlatforms([...platforms], { preferDerivedFiles: true }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)),
    ]);
    if (!store) return "";

    const lines: string[] = [];
    for (const platform of platforms) {
      const col = (store.collections as Record<string, { items?: unknown[] }> | undefined)?.[platform];
      const items = Array.isArray(col?.items) ? col!.items! : [];
      const picked = items
        .slice(0, 18)
        .map((raw) => {
          const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
          const title = String(o.title || o.keyword || o.desc || "").trim().slice(0, 80);
          const tags = Array.isArray(o.tags)
            ? o.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 4).join("/")
            : "";
          const likes = Number(o.likes || o.likeCount || o.diggCount || 0);
          if (!title) return "";
          return `- ${title}${tags ? ` · 标签:${tags}` : ""}${likes > 0 ? ` · 赞≈${likes}` : ""}`;
        })
        .filter(Boolean);
      if (picked.length) {
        lines.push(`平台=${platform} · 近窗样本 ${picked.length} 条：`);
        lines.push(...picked);
      }
    }
    if (!lines.length) return "";
    return [
      "【趋势库样本（内部抓取痕迹；只作论据，勿编造成交额/精确搜索量）】",
      ...lines.slice(0, 40),
    ].join("\n");
  } catch (e) {
    console.warn("[askPlatformSkillQa] trend evidence failed:", e instanceof Error ? e.message : e);
    return "";
  }
}

/** 联网摘要：Gemini googleSearch；失败则空串，不阻断主问答 */
async function buildWebEvidenceForQuestion(question: string): Promise<string> {
  if (!shouldFetchWebEvidence(question)) return "";
  try {
    const { callGemini35FlashCopywriting } = await import("./gemini35FlashRuntime.js");
    const brief = await Promise.race([
      callGemini35FlashCopywriting({
        taskSystemInstruction: `你是调研助手。请针对用户问题做简短联网核实摘要（简体中文）。
要求：
1. 只输出事实要点与可核对方向，不要写成发帖计划或策略看板。
2. 分点：品类/类型、需求是否持续、利润与定价常见口径、时间节点/合规注意。
3. 不确定就写「未证实」；禁止伪造具体成交额、伪造链接。
4. 全文控制在 800 字以内。`,
        userText: `用户问题：\n${question}\n\n请检索公开信息后给出摘要。`,
        responseMimeType: "text/plain",
        maxOutputTokens: 2048,
        temperature: 0.3,
      }),
      new Promise<string>((resolve) => setTimeout(() => resolve(""), 28_000)),
    ]);
    const text = String(brief || "").trim();
    if (!text || text.length < 40) return "";
    return `【联网检索摘要（公开信息归纳，非内部库；可与趋势库对照）】\n${text.slice(0, 2400)}`;
  } catch (e) {
    console.warn("[askPlatformSkillQa] web evidence failed:", e instanceof Error ? e.message : e);
    return "";
  }
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
  const qaKind = classifyPlatformSkillQaKind(question);

  // Skill：创作类可挂；市场调研类默认不灌，避免勾选 Skill 把答案带成全案卡
  let skillsPrompt = "";
  if (qaKind === "creative_help") {
    skillsPrompt = await resolvePlatformSkillsPrompt({
      userId: params.userId,
      enabledSkillIds: params.enabledSkillIds,
      allowBloggerTitle: Boolean(params.allowBloggerTitle),
      routeContext: question,
      sheetKind: "unknown",
    }).catch(() => "");
  } else if (qaKind === "general") {
    const full = await resolvePlatformSkillsPrompt({
      userId: params.userId,
      enabledSkillIds: params.enabledSkillIds,
      allowBloggerTitle: Boolean(params.allowBloggerTitle),
      routeContext: question,
      sheetKind: "unknown",
    }).catch(() => "");
    skillsPrompt = full.slice(0, 1800);
  }

  // 证据：库 + 网 可并行，按问题软启发取用；不是「只能查库」
  const [trendEvidence, webEvidence] = await Promise.all([
    buildTrendEvidenceForQuestion(question),
    buildWebEvidenceForQuestion(question),
  ]);

  const evidenceBlocks = [
    trendEvidence || null,
    webEvidence || null,
    !trendEvidence && !webEvidence
      ? "【证据】本问未取到趋势库样本且联网摘要为空；请给可执行框架与验证方法，勿伪造数据。"
      : null,
  ].filter(Boolean);

  const userText = [
    "【用户提问——必须完整回答，勿改写成发帖计划】",
    question,
    "",
    "【回答自检】若答案像「平台优先级 / 现在就能执行的动作 / 发帖排期」，即跑偏，请重写成直接答问。",
    "【证据说明】下面可能同时有「趋势库」与「联网摘要」：按需引用，不必只用一种；都没有就老实说。",
    ...evidenceBlocks.map((b) => `\n${b}`),
    skillsPrompt && qaKind === "creative_help"
      ? `\n【Skill 软参考·仅文案创作相关时参考，可忽略】\n${skillsPrompt.slice(0, 6000)}`
      : skillsPrompt && qaKind === "general"
        ? `\n【Skill 极短摘要·可忽略】\n${skillsPrompt}`
        : "\n【Skill】本问偏事实/赛道分析，已弱化 Skill 灌入，专心答用户问题。",
  ].join("\n");

  const ASK_MAX_ATTEMPTS = 3;
  let parsed: ReturnType<typeof parseAskJson> | null = null;
  let lastErr = "";
  for (let attempt = 1; attempt <= ASK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await invokeLLM({
        provider: "openai",
        modelName,
        max_tokens: PLATFORM_SKILL_QA_MAX_OUTPUT_TOKENS,
        temperature: qaKind === "market_research" ? 0.45 : 0.7,
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
      /Unexpected token|is not valid JSON|An error|非 JSON|空内容|timeout|超时|fetch failed|算力|偏离用户问题/i.test(
        lastErr,
      )
        ? "算力紧张或回答跑偏，请稍后重试同一问题"
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
