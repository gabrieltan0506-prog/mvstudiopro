/**
 * Stage2 选题初选（默认 6 条；超出另计费）与图文笔记页结构、评论钩子、去重、权威落句验收。
 */

import { z } from "zod";
import type { PlatformSkillLane } from "./platformSkillRouter.js";

/** 默认生成条数（含在基础积分内） */
export const PLATFORM_TOPIC_SHORTLIST_DEFAULT = 6;
/** 单次最多可生成（超出默认部分按条另计费） */
export const PLATFORM_TOPIC_SHORTLIST_MAX = 20;
/** @deprecated 使用 DEFAULT；保留别名避免旧引用断裂 */
export const PLATFORM_TOPIC_SHORTLIST_COUNT = PLATFORM_TOPIC_SHORTLIST_DEFAULT;

export const PLATFORM_TOPIC_EXPAND_MIN = 1;
export const PLATFORM_TOPIC_EXPAND_MAX = 20;

/** 小红书评论区生活化钩子：≤3 个汉字/字符，禁止整句预约话术 */
export const PLATFORM_COMMENT_HOOK_MAX_CHARS = 3;

export const PLATFORM_COMMENT_HOOK_EXAMPLES = [
  "想要",
  "求带",
  "慢生活",
  "优雅",
  "收藏",
  "清单",
  "同款",
  "求链",
  "学到了",
  "共鸣",
] as const;

export function clampTopicShortlistCount(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return PLATFORM_TOPIC_SHORTLIST_DEFAULT;
  return Math.max(1, Math.min(PLATFORM_TOPIC_SHORTLIST_MAX, n));
}

/** 基础价含默认 6 条；超出条数 × extraPerTopic */
export function platformTopicShortlistTotalCredits(params: {
  count: number;
  baseCredits: number;
  extraPerTopic: number;
}): { count: number; included: number; extraCount: number; total: number } {
  const count = clampTopicShortlistCount(params.count);
  const included = PLATFORM_TOPIC_SHORTLIST_DEFAULT;
  const extraCount = Math.max(0, count - included);
  const total = params.baseCredits + extraCount * params.extraPerTopic;
  return { count, included, extraCount, total };
}

export const platformGraphicNotePageSchema = z.object({
  pageIndex: z.number().int().min(1).max(16),
  role: z.enum([
    "cover",
    "audience_pain",
    "scene",
    "inventory_index",
    "detail_card",
    "share_tips",
    "evidence",
    "checklist",
    "save_reason",
    "cta",
  ]),
  headline: z.string().min(2).max(48),
  body: z.string().min(4).max(400),
});

export type PlatformGraphicNotePage = z.infer<typeof platformGraphicNotePageSchema>;

export const platformTopicShortlistItemSchema = z.object({
  id: z.string().min(4).max(64),
  title: z.string().min(4).max(120),
  hookSketch: z.string().min(4).max(200),
  conveyGoal: z.string().min(4).max(240),
  skillsUsed: z.array(z.string().min(1).max(80)).min(1).max(16),
  primaryLane: z.enum(["fmcg", "forensic", "crossover", "contrast", "default"]),
  formatHint: z.enum(["图文", "短视频"]).default("图文"),
  dedupeKey: z.string().min(1).max(80),
  commentHook: z.string().min(1).max(PLATFORM_COMMENT_HOOK_MAX_CHARS).optional(),
  /** 关联的官方活动 / 话题名（如 #城市漫步指南） */
  linkedCampaigns: z.array(z.string().min(1).max(80)).max(4).optional(),
});

export type PlatformTopicShortlistItem = z.infer<typeof platformTopicShortlistItemSchema>;

export const platformTopicShortlistResponseSchema = z.object({
  topics: z.array(platformTopicShortlistItemSchema).min(1).max(PLATFORM_TOPIC_SHORTLIST_MAX),
  diagnostics: z.record(z.string(), z.unknown()).optional(),
});

const KNOWN_FIGURE_PATTERNS: Array<{ key: string; re: RegExp }> = [
  { key: "苏轼", re: /苏轼|苏东坡|东坡/ },
  { key: "苏辙", re: /苏辙|子由/ },
  { key: "苏洵", re: /苏洵|老泉/ },
  { key: "王安石", re: /王安石|荆公/ },
  { key: "白居易", re: /白居易|香山/ },
  { key: "李白", re: /李白|太白/ },
  { key: "杜甫", re: /杜甫|子美/ },
  { key: "韩愈", re: /韩愈/ },
  { key: "柳宗元", re: /柳宗元/ },
  { key: "欧阳修", re: /欧阳修/ },
  { key: "曾巩", re: /曾巩/ },
  { key: "刘禹锡", re: /刘禹锡/ },
  { key: "李清照", re: /李清照/ },
  { key: "庄子", re: /庄子|南华/ },
  { key: "黄帝内经", re: /黄帝内经|内经/ },
];

const MOTIF_PATTERNS: Array<{ key: string; re: RegExp }> = [
  { key: "深夜高压", re: /深夜.?高压|高压.?深夜|凌晨一点|凌晨1点|工作群.*心脏|重金属摇滚/ },
  { key: "越休息越累", re: /越休息越累|休息越累|越躺越累/ },
  { key: "饭局应酬", re: /饭局|应酬|劝酒/ },
  { key: "头等舱时差", re: /头等舱|十二时区|时差|血液.*变粘/ },
  { key: "雪糕配料", re: /雪糕|冰淇淋|配料表|添加糖/ },
];

/** 从标题/钩子提炼去重键：优先人物，其次母题，否则标题归一化前 24 字 */
export function deriveTopicDedupeKey(title: string, extra = ""): string {
  const text = `${title}\n${extra}`;
  for (const p of KNOWN_FIGURE_PATTERNS) {
    if (p.re.test(text)) return `figure:${p.key}`;
  }
  for (const p of MOTIF_PATTERNS) {
    if (p.re.test(text)) return `motif:${p.key}`;
  }
  const norm = title.replace(/\s+/g, "").replace(/[，。！？、：；""''（）()【】\[\]·…]/g, "").slice(0, 24);
  return `title:${norm.toLowerCase() || "empty"}`;
}

export function normalizeCommentHook(raw: unknown): string {
  let s = String(raw ?? "")
    .replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "")
    .trim();
  if (!s) return "想要";
  // 整句预约话术 → 压成生活词
  if (/预约|诊断通话|私信我|领清单|咨询我|点主页/.test(String(raw ?? ""))) {
    return "想要";
  }
  if (s.length > PLATFORM_COMMENT_HOOK_MAX_CHARS) {
    s = s.slice(0, PLATFORM_COMMENT_HOOK_MAX_CHARS);
  }
  return s || "想要";
}

export function normalizeCommentHooksList(raw: unknown): string[] {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,，、/\s]+/)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const h = normalizeCommentHook(x);
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(h);
    if (out.length >= 4) break;
  }
  if (out.length === 0) out.push("想要");
  return out;
}

/** 权威一句：科普/fmcg 正文验收 */
const AUTHORITY_CITE_RE =
  /按[《「]?[^》」\n]{2,40}[》」]?|中国居民膳食指南|健康中国|世卫组织|WHO|GB\s?\d+|营养学会|身体活动指南|睡眠健康|默沙东|MSD\s*Manual|MedlinePlus|Cleveland Clinic|克利夫兰|CardioSmart|Radiopaedia|Innerbody|Zygote Body|msdmanuals\.cn|medlineplus\.gov|clevelandclinic\.org|cardiosmart\.org|radiopaedia\.org|innerbody\.com|zygotebody\.com/i;

export function textHasAuthorityCite(text: string): boolean {
  return AUTHORITY_CITE_RE.test(String(text || ""));
}

export function ensureAuthorityCiteInCopy(params: {
  copywriting: string;
  lane: PlatformSkillLane | string;
  force?: boolean;
}): { copywriting: string; patched: boolean } {
  const need =
    params.force === true ||
    params.lane === "fmcg" ||
    /科普|配料|膳食|标签|畅销/.test(params.copywriting);
  if (!need) return { copywriting: params.copywriting, patched: false };
  if (textHasAuthorityCite(params.copywriting)) {
    return { copywriting: params.copywriting, patched: false };
  }
  const cite =
    "按《中国居民膳食指南（2022）》建议：成人添加糖最好控制在每天 25 克以内——先把这一条当成生活账本，而不是恐吓。";
  const base = String(params.copywriting || "").trim();
  const merged = base ? `${base}\n\n${cite}` : cite;
  return { copywriting: merged, patched: true };
}

/**
 * 同批初选硬去重：同一 dedupeKey 只留第一条；可选排除已展示标题。
 */
export function dedupeTopicShortlist<T extends { title: string; dedupeKey?: string; hookSketch?: string }>(
  items: T[],
  opts?: { existingTitles?: string[]; max?: number },
): T[] {
  const max = opts?.max ?? PLATFORM_TOPIC_SHORTLIST_DEFAULT;
  const existing = new Set(
    (opts?.existingTitles || []).map((t) =>
      t.replace(/\s+/g, "").trim().toLowerCase().slice(0, 40),
    ),
  );
  const usedKeys = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (out.length >= max) break;
    const titleNorm = String(item.title || "")
      .replace(/\s+/g, "")
      .trim()
      .toLowerCase()
      .slice(0, 40);
    if (titleNorm && existing.has(titleNorm)) continue;
    const key =
      String(item.dedupeKey || "").trim() ||
      deriveTopicDedupeKey(item.title, item.hookSketch || "");
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    out.push({ ...item, dedupeKey: key } as T);
  }
  return out;
}

/** Skill Master 只读说明（UI 展示，不可改算法） */
export const PLATFORM_SKILL_MASTER_READONLY = {
  title: "Skill 自动路由总管（只读）",
  summary:
    "勾选 = 允许池，不是全灌。生成时默认 auto：先挂核心 Skill，再按选题互斥分配 specialty 赛道（fmcg / forensic / crossover / contrast）；同批 specialty 不重复。",
  coreIds: [
    "hook-solution-cta",
    "review-safe-voice",
    "vivid-anti-boring",
    "cover-stop-scroll",
    "platform-native",
    "cultural-diversity",
    "lifestyle-diversity",
  ],
  lanes: [
    { id: "fmcg", label: "畅销品痛点科普", skills: "4season-fmcg-popsci · label-debunk · authority · monetize" },
    { id: "forensic", label: "法医视角·还怎么活", skills: "forensic-life-lens · authority · medical-resource-library" },
    {
      id: "crossover",
      label: "跨界机制拟人/医学资源",
      skills: "crossover-popsci · medical-resource-library · authority",
    },
    { id: "contrast", label: "身份反差高潮", skills: "contrast-reversal-climax" },
    { id: "default", label: "默认生活向", skills: "batch-arc-engagement + 核心" },
  ],
  shortlistHint:
    "选题生成默认 6 条（每条标明 skillsUsed 与 conveyGoal）；超出 6 条按条另计费。勾选后扩写正式文案+可发图文页，避免开盲盒。",
} as const;

/** 标题像合集/清单/N场 → 走 m1 式总览墙+细卡 */
export function prefersInventoryGraphicNote(title: string, hook?: string): boolean {
  const t = `${title} ${hook || ""}`;
  return /合集|清单|不可错过|N场|\d+\s*场|免费|看展|市集|周末去哪|好去处/.test(t);
}

export function buildGraphicNotePagesFromBlueprint(bp: {
  title?: string;
  hook?: string;
  copywriting?: string;
  commentHook?: string;
}): PlatformGraphicNotePage[] {
  const title = String(bp.title || "今日笔记").slice(0, 40);
  const hook = String(bp.hook || title).slice(0, 48);
  const body = String(bp.copywriting || "").trim();
  const chunks = body
    ? body
        .split(/\n+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 8)
        .slice(0, 8)
    : [];
  const tip1 = chunks[0] || "在这里我先分享一些可立刻用的对照动作，不求一次讲完。";
  const tip2 = chunks[1] || "把场景钉死：什么人、什么时刻、差在哪一口体感。";
  const tip3 = chunks[2] || "收束前给一句可追溯依据，再落到本周能做的小动作。";
  const hookWord = normalizeCommentHook(bp.commentHook || "想要");

  if (prefersInventoryGraphicNote(title, hook)) {
    return [
      {
        pageIndex: 1,
        role: "cover",
        headline: hook.slice(0, 28),
        body: `${title}｜大数字场次或结果钉 + 价值钉（免费/低成本/可对照）`.slice(0, 220),
      },
      {
        pageIndex: 2,
        role: "audience_pain",
        headline: "为什么现在值得存",
        body: tip1.slice(0, 220),
      },
      {
        pageIndex: 3,
        role: "inventory_index",
        headline: "编号总览墙",
        body: (chunks[1] || "① 名称 📍地点 📅窗口 ② … ③ …（可截图）").slice(0, 220),
      },
      {
        pageIndex: 4,
        role: "detail_card",
        headline: "细卡① 看点钉子",
        body: (chunks[2] || "档期｜门槛（免费免约/票价）｜一句量感或稀缺钉子").slice(0, 220),
      },
      {
        pageIndex: 5,
        role: "detail_card",
        headline: "细卡② 看点钉子",
        body: (chunks[3] || "同馆可打包双展/三连展；每卡只钉一个结果").slice(0, 220),
      },
      {
        pageIndex: 6,
        role: "detail_card",
        headline: "细卡③ 看点钉子",
        body: (chunks[4] || "件数/国宝/沉浸空间——数字可截").slice(0, 220),
      },
      {
        pageIndex: 7,
        role: "share_tips",
        headline: "在这里我先分享一些",
        body: tip3.slice(0, 220),
      },
      {
        pageIndex: 8,
        role: "checklist",
        headline: "本周可执行清单",
        body: (chunks[5] || "① 锁定一场/一个动作 ② 记下窗口 ③ 周末对照打卡").slice(0, 220),
      },
      {
        pageIndex: 9,
        role: "save_reason",
        headline: "为什么值得收藏",
        body: "下周还能照着约；收藏>点赞才是工具帖。页数够、栏位齐才有存档价值。",
      },
      {
        pageIndex: 10,
        role: "cta",
        headline: `评论区扣「${hookWord}」`,
        body: `评论「${hookWord}」领取更细对照；主页可约深度交流（不问病史、不做诊疗承诺）。`,
      },
    ];
  }

  return [
    { pageIndex: 1, role: "cover", headline: hook.slice(0, 28), body: `适合谁 + 解决什么：${title}` },
    {
      pageIndex: 2,
      role: "audience_pain",
      headline: "先对上号的痛点",
      body: tip1.slice(0, 220),
    },
    {
      pageIndex: 3,
      role: "scene",
      headline: "真实场景对照",
      body: tip2.slice(0, 220),
    },
    {
      pageIndex: 4,
      role: "share_tips",
      headline: "在这里我先分享一些",
      body: tip3.slice(0, 220),
    },
    {
      pageIndex: 5,
      role: "evidence",
      headline: "依据与算账",
      body: (chunks[3] || "用公开指南的一句原则对照你的日常账本，不搞论文墙。").slice(0, 220),
    },
    {
      pageIndex: 6,
      role: "checklist",
      headline: "本周可执行清单",
      body: (chunks[4] || "① 固定一个对照动作 ② 记一次体感 ③ 下周只改一件事。").slice(0, 220),
    },
    {
      pageIndex: 7,
      role: "save_reason",
      headline: "为什么值得收藏",
      body: "页数够用才能当周对照；太短一眼看完就没存档价值。建议截图留作本周自评。",
    },
    {
      pageIndex: 8,
      role: "cta",
      headline: `评论区扣「${hookWord}」`,
      body: `想继续聊专属节律，评论「${hookWord}」；主页可约深度交流（不问病史、不做诊疗承诺）。`,
    },
  ];
}
