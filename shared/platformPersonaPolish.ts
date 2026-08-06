/**
 * 人物背景「智能优化」：帮文笔一般或还没想清定位的用户把这段话理顺。
 *
 * 用户 2026-08-06 的口径：
 * - 头 3 次免费，之后每天 1 次免费，超出扣 1 积分；
 * - 免费那几次走轻量引擎，付费那次走均衡引擎（成本账见 canvas persona-polish-unit-economics）；
 * - 不是一键替换：改写后的全文 + 2–3 条待确认问题让用户自己点，用户要有「它懂我」的感觉；
 * - 顺手问一句这轮想获客、转化还是涨粉，选完进选题提示词。
 */

/** 选题方向：影响选题与文案的落点，不是装饰性标签。 */
export const PLATFORM_TOPIC_GOALS = [
  { id: "acquire", label: "获客", hint: "让还不认识你的人刷到并留下联系方式" },
  { id: "convert", label: "转化", hint: "让已经看过你的人下单" },
  { id: "follow", label: "涨粉", hint: "先把人留在账号里，慢慢养" },
] as const;

export type PlatformTopicGoalId = (typeof PLATFORM_TOPIC_GOALS)[number]["id"];

export function isPlatformTopicGoalId(raw?: string | null): raw is PlatformTopicGoalId {
  const v = String(raw || "").trim();
  return PLATFORM_TOPIC_GOALS.some((g) => g.id === v);
}

export function platformTopicGoalLabel(raw?: string | null): string {
  const hit = PLATFORM_TOPIC_GOALS.find((g) => g.id === String(raw || "").trim());
  return hit ? hit.label : "";
}

/** 写进选题提示词的一句话：告诉模型这轮选题该往哪落。 */
export function platformTopicGoalPromptLine(raw?: string | null): string {
  const v = String(raw || "").trim();
  if (v === "acquire") {
    return "本轮目标=获客：选题要能被没关注过的人刷到，钩子放在痛点与身份共鸣，结尾留可留资的动作（评论关键词/领取清单），不要一上来就卖。";
  }
  if (v === "convert") {
    return "本轮目标=转化：选题要对准已经在犹豫的人，写清适用人群、对比与顾虑消除，结尾给明确下单或咨询动作。";
  }
  if (v === "follow") {
    return "本轮目标=涨粉：选题要有连续性与人格感，能让人想看下一条（系列感、进度感、立场感），结尾给关注理由而不是卖点。";
  }
  return "";
}

/** 免费额度：新用户头 3 次，之后每天 1 次。 */
export const PLATFORM_PERSONA_POLISH_FIRST_FREE = 3;
export const PLATFORM_PERSONA_POLISH_DAILY_FREE = 1;
/**
 * 超出免费额度后按档收：优秀 1 积分、卓越 2 积分。
 *
 * 卓越档贵一倍是成本决定的：润色这步要用力想（high 档推理），
 * 卓越档输出单价是优秀档的近 3 倍，收 1 积分会掉到 38% 毛利、破 65% 底线。
 */
export const PLATFORM_PERSONA_POLISH_CREDITS_BY_TIER = {
  excellent: 1,
  superb: 2,
} as const;

export type PlatformPersonaPolishTierId = keyof typeof PLATFORM_PERSONA_POLISH_CREDITS_BY_TIER;

export function isPlatformPersonaPolishTier(raw?: string | null): raw is PlatformPersonaPolishTierId {
  const v = String(raw || "").trim();
  return v === "excellent" || v === "superb";
}

export function resolvePlatformPersonaPolishTier(raw?: string | null): PlatformPersonaPolishTierId {
  return isPlatformPersonaPolishTier(raw) ? raw : "excellent";
}

/** @deprecated 用 {@link PLATFORM_PERSONA_POLISH_CREDITS_BY_TIER} */
export const PLATFORM_PERSONA_POLISH_CREDITS = PLATFORM_PERSONA_POLISH_CREDITS_BY_TIER.excellent;

export type PlatformPersonaPolishQuota = {
  /** 历史累计用过多少次（含免费）。 */
  usedEver: number;
  /** 今天用过多少次。 */
  usedToday: number;
  /** 这一次是否免费。 */
  nextFree: boolean;
  /** 头 3 次里还剩几次。 */
  firstFreeLeft: number;
  /** 这一次要扣多少积分（免费为 0）。 */
  nextCredits: number;
};

export function resolvePlatformPersonaPolishQuota(params: {
  usedEver: number;
  usedToday: number;
  /** 用户选的档；免费那次一律按优秀档跑，这里只影响付费价格。 */
  tier?: PlatformPersonaPolishTierId | null;
}): PlatformPersonaPolishQuota {
  const usedEver = Math.max(0, Math.floor(Number(params.usedEver) || 0));
  const usedToday = Math.max(0, Math.floor(Number(params.usedToday) || 0));
  const firstFreeLeft = Math.max(0, PLATFORM_PERSONA_POLISH_FIRST_FREE - usedEver);
  const nextFree = firstFreeLeft > 0 || usedToday < PLATFORM_PERSONA_POLISH_DAILY_FREE;
  const tier = resolvePlatformPersonaPolishTier(params.tier);
  return {
    usedEver,
    usedToday,
    nextFree,
    firstFreeLeft,
    nextCredits: nextFree ? 0 : PLATFORM_PERSONA_POLISH_CREDITS_BY_TIER[tier],
  };
}

/** 免费那次固定走优秀档：白送的成本压在最便宜的通道上。 */
export function platformPersonaPolishRunTier(params: {
  isFree: boolean;
  requested?: PlatformPersonaPolishTierId | null;
}): PlatformPersonaPolishTierId {
  return params.isFree ? "excellent" : resolvePlatformPersonaPolishTier(params.requested);
}

/**
 * 待确认问题的类型。命名对齐用户列的五件事：
 * 笼统、跑题、缺项、赘字、变现路径不清。
 */
export type PlatformPersonaPolishIssueKind =
  | "vague"
  | "offtrack"
  | "missing"
  | "wordy"
  | "monetize";

/**
 * 一个可点的选项。两种改法，都由前端确定性套用，不再回服务端二次生成：
 * - `replace`：把原句里某段换成更具体的说法；
 * - `append`：往末尾补一句（受众、商业目标这类缺项）。
 */
export type PlatformPersonaPolishOption = {
  id: string;
  label: string;
  append?: string;
  replace?: { from: string; to: string };
};

export type PlatformPersonaPolishQuestion = {
  id: string;
  kind: PlatformPersonaPolishIssueKind;
  /** 问用户的那句话，口语、短。 */
  question: string;
  options: PlatformPersonaPolishOption[];
  /** 「保持原样」那个选项的说法；空则用默认。 */
  keepLabel?: string;
};

export type PlatformPersonaPolishResult = {
  /** 改写后的完整背景，用户可一键采用。 */
  polished: string;
  /** 改了什么，一条一句，给用户看得见的交代。 */
  changes: string[];
  questions: PlatformPersonaPolishQuestion[];
  /** 猜的选题方向；用户没选过时用它做默认。 */
  suggestedGoal: PlatformTopicGoalId | null;
  /** 为什么猜这个方向，一句话。 */
  goalReason: string;
  /**
   * 收尾那句关怀。用户 2026-08-06 要的情绪价值：
   * 跑完别只丢一堆字段给人，说句人话。由模型按他写的背景现写，
   * 不许油腻、不许喊口号、不许提供应商与模型。
   */
  careLine: string;
};

const SEP = "；";

/** 收拾分隔符：避免套用选项后出现「；；」或结尾悬着一个分号。 */
export function normalizePersonaText(raw: string): string {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/[;；]\s*[;；]+/g, SEP)
    .replace(/^[;；\s]+/, "")
    .replace(/[;；\s]+$/, "")
    .trim();
}

/** 把一个选项套到当前文本上。找不到 `replace.from` 时退回追加，别让用户白点一下。 */
export function applyPersonaPolishOption(
  text: string,
  option: PlatformPersonaPolishOption,
): string {
  const base = String(text || "");
  if (option.replace?.from && base.includes(option.replace.from)) {
    return normalizePersonaText(base.replace(option.replace.from, option.replace.to || ""));
  }
  const addition = String(option.append || option.replace?.to || "").trim();
  if (!addition) return normalizePersonaText(base);
  if (base.includes(addition)) return normalizePersonaText(base);
  const joined = base.trim() ? `${normalizePersonaText(base)}${SEP}${addition}` : addition;
  return normalizePersonaText(joined);
}

/** 背景太短就别烧上游：让用户先写一句人话。 */
export const PLATFORM_PERSONA_POLISH_MIN_CHARS = 8;
export const PLATFORM_PERSONA_POLISH_MAX_CHARS = 2000;

/** 只写这类词等于什么都没说，出来的选题必然泛。 */
const VAGUE_ONLY_PATTERNS = [
  /^分享(生活|日常|心得|经验)?$/,
  /^记录(生活|日常)?$/,
  /^做(自媒体|博主|账号)$/,
  /^想(涨粉|变现|做起来|赚钱)$/,
  /^热爱生活$/,
  /^随便(写写|拍拍)$/,
];

/** 背景里有没有可落地的信息：赛道词、身份词、受众词、目标词。 */
const CONCRETE_HINT_RE =
  /身份|职业|专业|资质|从业|年经验|赛道|领域|品类|受众|人群|客户|粉丝|商业|变现|带货|接单|课程|资料|门店|品牌|服务|咨询|科普|测评|教程|穿搭|健身|育儿|考研|留学|摄影|美食|旅行|理财|职场|医|法|教师|设计|程序|运营/;

export type PlatformPersonaSpecificity = {
  /** 够不够具体到可以生成选题。 */
  ok: boolean;
  /** 不够时告诉用户缺什么（直接可显示，无技术词）。 */
  reason: string;
};

/**
 * 判断背景够不够撑起一轮选题。
 *
 * 用户 2026-08-06 要求：太笼统就**硬拦**，先跑一次优化再生成。
 * 但拦的前提是他还有免费额度——额度用完还拦就等于收保护费，
 * 那种情况调用方要降级成软提示（见 `/platform` 生成选题入口）。
 */
export function assessPlatformPersonaSpecificity(raw?: string | null): PlatformPersonaSpecificity {
  const text = String(raw || "").trim();
  if (text.length < PLATFORM_PERSONA_POLISH_MIN_CHARS) {
    return { ok: false, reason: "背景太短了，至少写清你是谁、做什么赛道，选题才有落点。" };
  }
  const compact = text.replace(/[\s。，,、；;：:!！?？]/g, "");
  if (VAGUE_ONLY_PATTERNS.some((re) => re.test(compact))) {
    return { ok: false, reason: "这段只写了个大方向，没有赛道和受众，出来的选题会很泛。" };
  }
  if (!CONCRETE_HINT_RE.test(text) && text.length < 24) {
    return { ok: false, reason: "还差点具体信息：你的身份、赛道或想写给谁看，补一样就够开工。" };
  }
  return { ok: true, reason: "" };
}
