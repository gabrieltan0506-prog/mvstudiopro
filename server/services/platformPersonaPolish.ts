/**
 * 人物背景「智能优化」：把用户随手写的一段话理顺，并回问 2–3 件他自己该拍板的事。
 *
 * 用户 2026-08-06 的口径：
 * - 头 3 次免费、之后每天 1 次免费；超出按档收（优秀 1 / 卓越 2 积分）；
 * - 免费那次固定走优秀档，白送的成本压在最便宜的通道上；
 * - 不做一键替换：给改写全文 + 待确认问题，让用户自己点，他要有「它懂我」的感觉；
 * - 收尾说句人话（关怀语），别只丢字段。
 *
 * 计价与成本账见 canvas `persona-polish-unit-economics`。
 */
import { extractFirstChoicePlainText, extractJsonString } from "../_core/llm.js";
import { and, count, eq, gte } from "drizzle-orm";
import { getDb } from "../db.js";
import { stripeUsageLogs } from "../../drizzle/schema-stripe.js";
import {
  getEvolinkApiKey,
  getOpenRouterChatHeaders,
  OPENROUTER_CHAT_COMPLETIONS_URL,
} from "./gpt56CopywritingGateway.js";
import { getOpenRouterApiKey } from "./openrouterGptImage2.js";
import {
  PLATFORM_ENGINE_TIER_MODELS,
  platformEngineEffort,
} from "../../shared/platformEngineTiers.js";
import {
  isPlatformTopicGoalId,
  PLATFORM_PERSONA_POLISH_MAX_CHARS,
  PLATFORM_TOPIC_GOALS,
  platformTopicGoalLabel,
  type PlatformPersonaPolishIssueKind,
  type PlatformPersonaPolishQuestion,
  type PlatformPersonaPolishResult,
  type PlatformPersonaPolishTierId,
  type PlatformTopicGoalId,
} from "../../shared/platformPersonaPolish.js";

export const PLATFORM_PERSONA_POLISH_ACTION = "platformPersonaPolish";

export const PLATFORM_PERSONA_POLISH_CAPACITY_MESSAGE = "算力紧张，请稍后再试";

/** 纯文本走 direct：Evolink 文档口径，长连接更稳。 */
const EVOLINK_DIRECT_CHAT_URL = String(
  process.env.EVOLINK_DIRECT_CHAT_COMPLETIONS_URL || "https://direct.evolink.ai/v1/chat/completions",
).trim();

/**
 * 输出封顶。
 *
 * 这一步的成本几乎全在输出：优秀档输出 $5.295/百万、卓越档 $15/百万。
 * 不封顶一旦推理跑飞，卓越档单次能到 ¥0.40，1 积分就掉到 38% 毛利、破 65% 底线。
 */
const POLISH_MAX_TOKENS = 1600;
const POLISH_TIMEOUT_MS = 60_000;

function startOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 历史累计用过多少次（含免费那几次）。 */
export async function countPlatformPersonaPolishEver(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ c: count() })
    .from(stripeUsageLogs)
    .where(
      and(
        eq(stripeUsageLogs.userId, userId),
        eq(stripeUsageLogs.action, PLATFORM_PERSONA_POLISH_ACTION),
      ),
    );
  return Number(row?.c || 0);
}

/** 今天用过多少次。 */
export async function countPlatformPersonaPolishToday(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ c: count() })
    .from(stripeUsageLogs)
    .where(
      and(
        eq(stripeUsageLogs.userId, userId),
        eq(stripeUsageLogs.action, PLATFORM_PERSONA_POLISH_ACTION),
        gte(stripeUsageLogs.createdAt, startOfTodayLocal()),
      ),
    );
  return Number(row?.c || 0);
}

/**
 * 记一笔用量。免费那几次也要落库，否则「头 3 次 + 每天 1 次」根本数不出来
 * （`deductCreditsAmount` 在 0 积分时会提前返回，不写日志）。
 */
export async function logPlatformPersonaPolishUse(params: {
  userId: number;
  tier: PlatformPersonaPolishTierId;
  creditsCost: number;
  isFreeQuota: boolean;
  personaChars: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(stripeUsageLogs).values({
    userId: params.userId,
    action: PLATFORM_PERSONA_POLISH_ACTION,
    creditsCost: Math.max(0, Math.floor(params.creditsCost)),
    isFreeQuota: params.isFreeQuota ? 1 : 0,
    description: `人物背景智能优化·${params.tier === "superb" ? "卓越" : "优秀"}${
      params.isFreeQuota ? "（免费额度）" : "（付费）"
    } · ${params.personaChars} 字`,
    balanceAfter: null,
  });
}

const GOAL_IDS = PLATFORM_TOPIC_GOALS.map((g) => `${g.id}（${g.label}：${g.hint}）`).join("、");

const POLISH_SYSTEM = `你在帮一位内容创作者把「人物背景」这段自我介绍理顺，好让后面的选题有落点。

【最重要的一条】
只能整理、精简、归类他已经写出来的信息。**禁止替他编造事实**：不许凭空加学历、资质、年限、粉丝量、获奖、机构背书、具体收入。
缺的信息不要自己填，改成问题问他。

【改写要求】
- polished：一段话，60–160 字，口语但具体。保留他自己的说法与专业词，别改成官腔或广告腔。
- 顺序按「身份 → 赛道 → 受众 → 想赚什么钱」组织，用「；」分隔，读起来仍是一段话。
- 删掉重复与空话（例如「热爱生活」「持续输出」这类），但删了什么要写进 changes。

【changes】
1–3 条，每条一句，说清你做了什么（例：「把两句重复的定位合成一句」「删掉了『热爱分享』这种没有信息的说法」）。

【questions】最多 3 条，每条 2–3 个 options，用户点一下就能套用
按这五类里最该问的挑：
- vague：他写了笼统词（如「分享生活」），给具体化候选。用 replace：{ from: 原文里的那个片段, to: 更具体的说法 }。
- offtrack：有与赛道无关的描述，你已从 polished 删掉；问他要不要加回来。options 用 append 把原片段还回去。
- missing：受众或商业目标没写；给 2–3 个候选，options 用 append，写成「受众：…」「商业目标：…」这种句式。
- monetize：看不出钱从哪来；给候选（带货 / 知识付费 / 引流到私域 / 接单 / 门店），同样用 append。
- wordy：只在 changes 里交代，不占 questions，除非你删掉的可能是有用信息。
options 的 label ≤ 12 字；replace.from 必须是原文里真实出现过的片段，否则改用 append。

【suggestedGoal】
从 ${GOAL_IDS} 里挑一个最像他这轮想要的，写 id；实在看不出写 null。
goalReason 一句话说为什么，要能让他觉得你真的读懂了他写的东西，不要套话。

【careLine】
最后说一句人话收尾，20–34 字。要贴他写的内容（例如他提到副业很累、刚起号、想陪家人），像同行随口关心一句。
禁止：喊口号、打鸡血、「加油你可以的」、夸他厉害、卖课口吻、表情符号、感叹号连用。

【禁止】
- 不许出现任何模型名、供应商名、接口名、技术栈名。
- 不许提「我是 AI」「作为语言模型」。
- 一律简体中文。

只输出 JSON：
{
  "polished": "…",
  "changes": ["…"],
  "questions": [
    {
      "id": "q1",
      "kind": "vague",
      "question": "…",
      "keepLabel": "先保持原样",
      "options": [
        { "id": "q1a", "label": "…", "replace": { "from": "…", "to": "…" } },
        { "id": "q1b", "label": "…", "append": "…" }
      ]
    }
  ],
  "suggestedGoal": "acquire",
  "goalReason": "…",
  "careLine": "…"
}`;

function buildPolishUserBlock(params: { persona: string; currentGoal?: string | null }): string {
  const lines = [`【用户写的人物背景】\n${params.persona.trim()}`];
  if (isPlatformTopicGoalId(params.currentGoal)) {
    lines.push(
      `【他已经选了的这轮方向】${platformTopicGoalLabel(params.currentGoal)}（suggestedGoal 就沿用这个，别改他的选择）`,
    );
  }
  return lines.join("\n\n");
}

type PolishFetchTarget = {
  url: string;
  key: string;
  model: string;
  headers?: Record<string, string>;
  /** Qwen 在 Evolink 上要用 max_completion_tokens，且不能与 max_tokens 同传。 */
  useMaxCompletionTokens?: boolean;
};

/**
 * 各档的主备通道。
 *
 * 优秀档主走 Evolink 的 Qwen（比 OpenRouter 同款便宜约 12%，成本几乎全在输出），
 * 掉线时换 OpenRouter；卓越档主走 OpenRouter 的 Kimi，备道 Evolink 同价。
 */
function polishTargets(tier: PlatformPersonaPolishTierId): PolishFetchTarget[] {
  const evolinkKey = getEvolinkApiKey();
  const openRouterKey = getOpenRouterApiKey();
  const models = PLATFORM_ENGINE_TIER_MODELS[tier];
  const evolink: PolishFetchTarget | null = evolinkKey
    ? {
        url: EVOLINK_DIRECT_CHAT_URL,
        key: evolinkKey,
        model: models.evolink,
        useMaxCompletionTokens: tier === "excellent",
      }
    : null;
  const openrouter: PolishFetchTarget | null = openRouterKey
    ? {
        url: OPENROUTER_CHAT_COMPLETIONS_URL,
        key: openRouterKey,
        model: models.openrouter,
        headers: getOpenRouterChatHeaders(),
      }
    : null;
  const ordered = tier === "superb" ? [openrouter, evolink] : [evolink, openrouter];
  return ordered.filter((t): t is PolishFetchTarget => Boolean(t));
}

async function callPolishOnce(params: {
  target: PolishFetchTarget;
  tier: PlatformPersonaPolishTierId;
  persona: string;
  currentGoal?: string | null;
}): Promise<string> {
  const effort = platformEngineEffort("polish", params.tier);
  const body: Record<string, unknown> = {
    model: params.target.model,
    messages: [
      { role: "system", content: POLISH_SYSTEM },
      { role: "user", content: buildPolishUserBlock(params) },
    ],
    response_format: { type: "json_object" },
    reasoning_effort: effort,
  };
  if (params.target.useMaxCompletionTokens) {
    body.enable_thinking = true;
    body.max_completion_tokens = POLISH_MAX_TOKENS;
  } else {
    body.max_tokens = POLISH_MAX_TOKENS;
  }

  const res = await fetch(params.target.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.target.key}`,
      "Content-Type": "application/json",
      ...(params.target.headers || {}),
    },
    signal: AbortSignal.timeout(POLISH_TIMEOUT_MS),
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  if (!res.ok) {
    console.warn(
      `[platformPersonaPolish] ${params.target.model} HTTP ${res.status}: ${raw.slice(0, 300)}`,
    );
    throw new Error(PLATFORM_PERSONA_POLISH_CAPACITY_MESSAGE);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(PLATFORM_PERSONA_POLISH_CAPACITY_MESSAGE);
  }
  const text = extractFirstChoicePlainText(
    json as Parameters<typeof extractFirstChoicePlainText>[0],
  ).trim();
  if (!text) throw new Error(PLATFORM_PERSONA_POLISH_CAPACITY_MESSAGE);
  return text;
}

const ISSUE_KINDS: PlatformPersonaPolishIssueKind[] = [
  "vague",
  "offtrack",
  "missing",
  "wordy",
  "monetize",
];

function str(v: unknown, max: number): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeQuestions(raw: unknown): PlatformPersonaPolishQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: PlatformPersonaPolishQuestion[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const question = str(row.question, 80);
    if (!question) continue;
    const kindRaw = String(row.kind || "").trim() as PlatformPersonaPolishIssueKind;
    const kind = ISSUE_KINDS.includes(kindRaw) ? kindRaw : "missing";
    const options = Array.isArray(row.options)
      ? row.options
          .map((opt, j) => {
            if (!opt || typeof opt !== "object") return null;
            const o = opt as Record<string, unknown>;
            const label = str(o.label, 16);
            if (!label) return null;
            const append = str(o.append, 120);
            const replaceRaw = o.replace as Record<string, unknown> | undefined;
            const from = str(replaceRaw?.from, 120);
            const to = str(replaceRaw?.to, 120);
            if (!append && !(from && to)) return null;
            return {
              id: str(o.id, 24) || `q${i + 1}o${j + 1}`,
              label,
              ...(append ? { append } : {}),
              ...(from && to ? { replace: { from, to } } : {}),
            };
          })
          .filter((o): o is NonNullable<typeof o> => Boolean(o))
          .slice(0, 3)
      : [];
    if (options.length === 0) continue;
    out.push({
      id: str(row.id, 24) || `q${i + 1}`,
      kind,
      question,
      options,
      keepLabel: str(row.keepLabel, 16) || undefined,
    });
    if (out.length >= 3) break;
  }
  return out;
}

function parsePolishResult(text: string, fallbackPersona: string): PlatformPersonaPolishResult {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(extractJsonString(text)) as Record<string, unknown>;
  } catch {
    throw new Error(PLATFORM_PERSONA_POLISH_CAPACITY_MESSAGE);
  }
  const polished = str(parsed.polished, PLATFORM_PERSONA_POLISH_MAX_CHARS) || fallbackPersona.trim();
  const changes = Array.isArray(parsed.changes)
    ? parsed.changes.map((c) => str(c, 60)).filter(Boolean).slice(0, 3)
    : [];
  const goalRaw = String(parsed.suggestedGoal ?? "").trim();
  const suggestedGoal: PlatformTopicGoalId | null = isPlatformTopicGoalId(goalRaw) ? goalRaw : null;
  return {
    polished,
    changes,
    questions: normalizeQuestions(parsed.questions),
    suggestedGoal,
    goalReason: str(parsed.goalReason, 60),
    careLine: str(parsed.careLine, 40),
  };
}

/** 跑一次润色。主通道失败换备道，两条都失败才抛业务话术。 */
export async function polishPlatformPersona(params: {
  persona: string;
  tier: PlatformPersonaPolishTierId;
  currentGoal?: string | null;
}): Promise<PlatformPersonaPolishResult> {
  const targets = polishTargets(params.tier);
  if (targets.length === 0) throw new Error(PLATFORM_PERSONA_POLISH_CAPACITY_MESSAGE);
  let lastErr: unknown = null;
  for (const target of targets) {
    try {
      const text = await callPolishOnce({ ...params, target });
      return parsePolishResult(text, params.persona);
    } catch (err) {
      lastErr = err;
    }
  }
  console.warn(
    `[platformPersonaPolish] 全部通道失败：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
  throw new Error(PLATFORM_PERSONA_POLISH_CAPACITY_MESSAGE);
}
