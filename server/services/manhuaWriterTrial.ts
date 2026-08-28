/**
 * /canvas 编剧室 · 模板免费试写（单集大纲级，两版对比）。
 *
 * 为什么存在：学习链花真金白银产出的模板，用户在编剧室只能「盲选后直接付费扩写」，
 * 转化断在「不知道模板到底能带来什么」。试写让用户免费看到「套模板 vs 常规」的
 * 单集差异，满意再走现有 expandManhuaWriterPack 付费链路（本模块自身零扣费）。
 *
 * 限流机制照抄 platformSkillQa 的先例（countPlatformSkillQaToday）：
 * 不建新表，每次试写往 stripeUsageLogs 写一条 creditsCost=0 / isFreeQuota=1 的
 * 流水，按 action + createdAt >= 今日零点 计数——限流必须在服务端生效，
 * 前端只做展示。
 */
import { and, count, eq, gte } from "drizzle-orm";
import { getDb } from "../db.js";
import { stripeUsageLogs } from "../../drizzle/schema-stripe.js";

/** 试写专用流水桶；与付费扩写的 manhuaWriterExpand 分开，互不污染计数 */
export const MANHUA_WRITER_TRIAL_ACTION = "manhuaWriterTrial";
/** 每日每用户免费试写上限（拍板：3 次） */
export const MANHUA_WRITER_TRIAL_DAILY_LIMIT = 3;
/** 超限文案：拍板原话，前后端一致 */
export const MANHUA_WRITER_TRIAL_LIMIT_MESSAGE =
  "今日试写次数已用完，明天再来或直接套用全集";

function startOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 今日已试写次数（含所有模板；限流按人不按模板，防止换模板刷次数） */
export async function countManhuaWriterTrialToday(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ c: count() })
    .from(stripeUsageLogs)
    .where(
      and(
        eq(stripeUsageLogs.userId, userId),
        eq(stripeUsageLogs.action, MANHUA_WRITER_TRIAL_ACTION),
        gte(stripeUsageLogs.createdAt, startOfTodayLocal()),
      ),
    );
  return Number(row?.c || 0);
}

/**
 * requestId 幂等：chargeKey 走 stripeUsageLogs 的部分唯一索引（与扣费同一道 DB 级防线）。
 * 试写零扣费拿不到 deductCreditsAmount 的原子幂等，所以自己落一条 0 元流水占位：
 * 同 requestId 重放在「查到已有流水」时直接拒绝（拍板允许拒绝，不必回放结果）。
 */
export async function findManhuaWriterTrialByChargeKey(
  chargeKey: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [row] = await db
    .select({ c: count() })
    .from(stripeUsageLogs)
    .where(eq(stripeUsageLogs.chargeKey, chargeKey));
  return Number(row?.c || 0) > 0;
}

/** 试写完成后落流水：既是限流计数来源，也是幂等占位（chargeKey 唯一索引兜底并发） */
export async function logManhuaWriterTrialUse(params: {
  userId: number;
  chargeKey: string;
  publicTemplateId: string;
  topic: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(stripeUsageLogs).values({
    userId: params.userId,
    action: MANHUA_WRITER_TRIAL_ACTION,
    creditsCost: 0,
    isFreeQuota: 1,
    chargeKey: params.chargeKey,
    description: `模板免费试写 · ${params.publicTemplateId} · ${String(params.topic || "").slice(0, 60)}`,
    balanceAfter: null,
  });
}

// ───────────────────────── 以下为纯函数（vitest node 环境直接测） ─────────────────────────

export type ManhuaWriterTrialGate = {
  allowed: boolean;
  usedToday: number;
  dailyLimit: number;
  trialsLeft: number;
};

/** 限流判定抽成纯函数：路由只拿结论，判定口径可单测 */
export function resolveManhuaWriterTrialGate(params: {
  usedToday: number;
  dailyLimit?: number;
  isAdmin?: boolean;
}): ManhuaWriterTrialGate {
  const dailyLimit = Math.max(
    1,
    Math.floor(Number(params.dailyLimit ?? MANHUA_WRITER_TRIAL_DAILY_LIMIT)),
  );
  const usedToday = Math.max(0, Math.floor(Number(params.usedToday) || 0));
  // 管理员/监管不占额度（对齐 askPlatformSkillQa 的 isAdminUser 口径）
  if (params.isAdmin) {
    return { allowed: true, usedToday: 0, dailyLimit, trialsLeft: dailyLimit };
  }
  const trialsLeft = Math.max(0, dailyLimit - usedToday);
  return { allowed: trialsLeft > 0, usedToday, dailyLimit, trialsLeft };
}

export type ManhuaWriterTrialInput = {
  ok: true;
  topic: string;
  brief: string;
} | {
  ok: false;
  message: string;
};

/**
 * 试写输入裁剪：与 expand 的 topic/brief 同构（上限同为 500/2000），
 * 集数、引擎档、局部改写等字段试写一概不收——试写恒 1 集、恒最低档。
 */
export function sanitizeManhuaWriterTrialInput(params: {
  topic?: string | null;
  brief?: string | null;
}): ManhuaWriterTrialInput {
  const topic = String(params.topic || "").trim().slice(0, 500);
  const brief = String(params.brief || "").trim().slice(0, 2000);
  if (!topic && !brief) {
    return { ok: false, message: "请先填写题材，或至少写几句补充条件" };
  }
  return { ok: true, topic, brief };
}

/**
 * 试写提示词：产物是「精简版」——单集 logline + 3–5 节拍点 + 开场钩子，
 * 约 300–600 字。刻意不用 buildManhuaWriterExpandPrompt（那是全量剧情包），
 * 输出短才能走最低档还快得起来，也才不会被用户当成免费的完整扩写薅。
 */
export function buildManhuaWriterTrialPrompt(params: {
  topic: string;
  brief: string;
  /** 服务端由 approved 卡编译的创作 Skill 软策略；对照版传空串 */
  templateAddon: string;
}): string {
  const addon = String(params.templateAddon || "").trim();
  return [
    "你是竖屏漫剧连载编剧。根据用户题材，只写第 1 集的「大纲级试写」，不写正文分段。",
    "硬规则：",
    "1. 全文约 300–600 字，超出视为失败。",
    "2. 成稿禁止导演名、真实剧集/电影片名、「仿写某某」「致敬某某」，禁止出现任何模型名或供应商名。",
    "3. 严格按下面三段式输出，段落标记一字不差，不要代码围栏、不要多余寒暄：",
    "【单集梗概】一句话 logline（40 字内，讲清目标→阻力→代价）",
    "【节拍点】3–5 条，每条一行，编号 1. 2. 3.，每条 20–50 字，须有信息增量",
    "【开场钩子】前三秒开场画面+台词文案（60–120 字，问题/异常/冲突三选一）",
    "",
    ...(addon
      ? [
          "【可调用的创作 Skill】",
          addon,
          "使用方式：把它当增强策略，不是固定公式；只采用能增强开场、冲突递进或追更欲的建议。",
          "",
        ]
      : []),
    `【用户题材】${params.topic || "（未填，请基于补充条件合理拟定）"}`,
    ...(params.brief ? [`【补充条件】${params.brief}`] : []),
  ].join("\n");
}

export type ManhuaWriterTrialDraft = {
  logline: string;
  beats: string[];
  openingHook: string;
};

/**
 * 三段式解析（纯函数）：宽容裁剪、严格兜底——
 * 三段任一缺失即判失败（返回 null），由调用层报「请再试一次」，绝不下发半截结果。
 */
export function parseManhuaWriterTrialDraft(raw: string): ManhuaWriterTrialDraft | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const grab = (label: string): string => {
    const re = new RegExp(`【${label}】([\\s\\S]*?)(?=【单集梗概】|【节拍点】|【开场钩子】|$)`);
    const m = text.match(re);
    return (m?.[1] || "").trim();
  };
  const logline = grab("单集梗概").replace(/\s+/g, " ").slice(0, 200);
  const beatsBlock = grab("节拍点");
  const openingHook = grab("开场钩子").slice(0, 600);
  const beats = beatsBlock
    .split(/\n+/)
    .map((line) => line.replace(/^\s*\d+[.、)]\s*/, "").trim())
    .filter(Boolean)
    .map((line) => line.slice(0, 160))
    .slice(0, 5);
  if (!logline || !openingHook || beats.length < 3) return null;
  return { logline, beats, openingHook };
}
