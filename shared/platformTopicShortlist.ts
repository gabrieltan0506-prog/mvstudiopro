/**
 * Stage2 选题初选（20→勾选5–6→扩写）与图文笔记页结构、评论钩子、去重、权威落句验收。
 */

import { z } from "zod";
import type { PlatformSkillLane } from "./platformSkillRouter.js";

export const PLATFORM_TOPIC_SHORTLIST_COUNT = 20;
export const PLATFORM_TOPIC_EXPAND_MIN = 5;
export const PLATFORM_TOPIC_EXPAND_MAX = 6;

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

export const platformGraphicNotePageSchema = z.object({
  pageIndex: z.number().int().min(1).max(16),
  role: z.enum([
    "cover",
    "audience_pain",
    "scene",
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
});

export type PlatformTopicShortlistItem = z.infer<typeof platformTopicShortlistItemSchema>;

export const platformTopicShortlistResponseSchema = z.object({
  topics: z.array(platformTopicShortlistItemSchema).min(8).max(24),
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
  /按[《「]?[^》」\n]{2,40}[》」]?|中国居民膳食指南|健康中国|世卫组织|WHO|GB\s?\d+|营养学会|身体活动指南|睡眠健康/;

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
  const max = opts?.max ?? PLATFORM_TOPIC_SHORTLIST_COUNT;
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
    { id: "forensic", label: "法医视角·还怎么活", skills: "forensic-life-lens · authority" },
    { id: "crossover", label: "跨界机制拟人", skills: "crossover-popsci" },
    { id: "contrast", label: "身份反差高潮", skills: "contrast-reversal-climax" },
    { id: "default", label: "默认生活向", skills: "batch-arc-engagement + 核心" },
  ],
  shortlistHint:
    "正式文案前先出 20 条初选：每条标明 skillsUsed 与 conveyGoal；你勾选 5–6 条再扩写，避免开盲盒。",
} as const;

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
        .slice(0, 6)
    : [];
  const tip1 = chunks[0] || "在这里我先分享一些可立刻用的对照动作，不求一次讲完。";
  const tip2 = chunks[1] || "把场景钉死：什么人、什么时刻、差在哪一口体感。";
  const tip3 = chunks[2] || "收束前给一句可追溯依据，再落到本周能做的小动作。";
  const hookWord = normalizeCommentHook(bp.commentHook || "想要");
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
