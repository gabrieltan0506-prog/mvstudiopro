/**
 * 导演法典（导演包接线 P1，0910）。
 *
 * 数据真源：`ManhuaProjectBible.directionCanon`，与 `assetCanon` 同级，缺省 undefined——旧草稿没有它时保持原行为，不静默注入默认风格。
 * 卡片来自 `2026Sep04/directors/<slug>/SKILL.md` 蒸馏（见 manhuaDirectionSkillParse），只有通过四门槛的正式规律进生产；
 * 【单片观察】【案例比较】【观察候选】【待深蒸】一律 research_only，不进任何提示词。
 *
 * 去名铁律：进入漫剧工厂生产成稿的只能是手法参数；导演名、作品名、「致敬」「某某风格」只存 internal 字段，
 * `resolveDirectorStyleBlocks` 的输出里出现任何 internal 名称即视为泄漏（测试硬判）。
 */
import type { ManhuaDirectorStrategyStage } from "./manhuaDirectorStrategy.js";

export type ManhuaDirectionRuleStatus = "verified" | "conditional" | "research_only";

export type ManhuaDirectionRule = {
  /** 卡内编号，如 CN-DM-02 / JWAR-001 / CN-PT-03 / CN-AI-04 */
  id: string;
  titleZh: string;
  /** 一句规律（生产用） */
  ruleZh: string;
  whyZh?: string;
  predictZh?: string;
  /** 失效条件（审查 advisory 用） */
  failZh?: string;
  status: ManhuaDirectionRuleStatus;
  /** 投影到哪些阶段 */
  stages: ManhuaDirectorStrategyStage[];
  /** 内部溯源（证据编号），编译时剥离 */
  sourceIds?: string[];
};

export type ManhuaDirectionCard = {
  /** 卡片 ID（去名，如 parallel_action_editing） */
  id: string;
  /** 前台与生产可见的中性名称 */
  labelZh: string;
  /** 蒸馏档位 */
  tier: "standard" | "deep";
  version: string;
  evidenceVersion?: string;
  /** 内部：人物/作品名，仅溯源，绝不进生产 */
  internal?: { personName?: string; workNames?: string[]; slug?: string };
  rules: ManhuaDirectionRule[];
  /** 明确反对的拍法（原文去名后） */
  avoidZh?: string[];
};

export type ManhuaDirectionSceneType = "action" | "dialogue" | "reveal" | "emotion" | "transition" | "default";

export type ManhuaDirectionCanon = {
  version: 1;
  /** 系列主卡 */
  mainCardId: string;
  /** 已购/已授权卡片；未授权的卡不进生产 */
  cards: ManhuaDirectionCard[];
  /** 场次副卡：某类场景改用另一张卡的某些阶段 */
  sceneOverrides?: Partial<Record<ManhuaDirectionSceneType, { cardId: string; stages?: ManhuaDirectorStrategyStage[] }>>;
  authorizedCardIds: string[];
};

/**
 * 按段文本（动作/对白/意图）判场景类型，给副卡用。规则只认动词与关键词，不猜情绪；判不出就是 default（走主卡）。
 */
export function classifyManhuaDirectionSceneType(text: string): ManhuaDirectionSceneType {
  const t = String(text || "");
  if (!t.trim()) return "default";
  const action = (t.match(/打|追|逃|爆|撞|冲|挥|刀|剑|拳|枪|砍|扑|摔|跃|搏|厮杀|交手|翻滚|拔|射|闪避/g) || []).length;
  const reveal = (t.match(/揭|真相|原来|发现|认出|露出|识破|竟是|身份/g) || []).length;
  const emotion = (t.match(/哭|泪|拥抱|告白|颤抖|沉默|哽咽|凝视|心碎|告别|跪/g) || []).length;
  const dialogue = (t.match(/说|问|答|道：|「|」|“|”|对白|回应|低声|喊/g) || []).length;
  const transition = (t.match(/转场|过场|赶路|奔赴|次日|清晨|夜幕|远景空镜|时间流逝/g) || []).length;
  const best = [
    ["action", action * 2],
    ["reveal", reveal * 2],
    ["emotion", emotion * 2],
    ["transition", transition * 2],
    ["dialogue", dialogue],
  ].sort((a, b) => (b[1] as number) - (a[1] as number))[0]!;
  return (best[1] as number) >= 2 ? (best[0] as ManhuaDirectionSceneType) : "default";
}

export const MANHUA_DIRECTION_STAGES: ManhuaDirectorStrategyStage[] = ["story", "assets", "storyboard", "keyframe", "clip", "review"];

const STAGE_SET = new Set<string>(MANHUA_DIRECTION_STAGES);
const text = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);

export function normalizeManhuaDirectionRule(raw: unknown): ManhuaDirectionRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.id, 40);
  const ruleZh = text(r.ruleZh);
  if (!id || !ruleZh) return null;
  const status: ManhuaDirectionRuleStatus =
    r.status === "verified" || r.status === "conditional" ? r.status : "research_only";
  const stages = Array.isArray(r.stages)
    ? (r.stages.map((s) => text(s, 20)).filter((s) => STAGE_SET.has(s)) as ManhuaDirectorStrategyStage[])
    : [];
  return {
    id,
    titleZh: text(r.titleZh, 200),
    ruleZh,
    whyZh: text(r.whyZh) || undefined,
    predictZh: text(r.predictZh) || undefined,
    failZh: text(r.failZh) || undefined,
    status,
    stages: Array.from(new Set(stages)),
    sourceIds: Array.isArray(r.sourceIds) ? r.sourceIds.map((s) => text(s, 40)).filter(Boolean).slice(0, 60) : undefined,
  };
}

export function normalizeManhuaDirectionCard(raw: unknown): ManhuaDirectionCard | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.id, 80).replace(/[^a-z0-9_]/gi, "");
  if (!id) return null;
  const rules = Array.isArray(r.rules) ? r.rules.map(normalizeManhuaDirectionRule).filter((x): x is ManhuaDirectionRule => Boolean(x)) : [];
  const internalRaw = r.internal && typeof r.internal === "object" ? (r.internal as Record<string, unknown>) : null;
  return {
    id,
    labelZh: text(r.labelZh, 120) || id,
    tier: r.tier === "deep" ? "deep" : "standard",
    version: text(r.version, 40) || "standard-1",
    evidenceVersion: text(r.evidenceVersion, 40) || undefined,
    internal: internalRaw
      ? {
          personName: text(internalRaw.personName, 80) || undefined,
          workNames: Array.isArray(internalRaw.workNames) ? internalRaw.workNames.map((w) => text(w, 120)).filter(Boolean) : undefined,
          slug: text(internalRaw.slug, 80) || undefined,
        }
      : undefined,
    rules,
    avoidZh: Array.isArray(r.avoidZh) ? r.avoidZh.map((a) => text(a, 400)).filter(Boolean).slice(0, 20) : undefined,
  };
}

/** 云草稿/会话回读入口：非法即 undefined（等于「没有导演法典」，不猜） */
export function normalizeManhuaDirectionCanon(raw: unknown): ManhuaDirectionCanon | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const cards = Array.isArray(r.cards) ? r.cards.map(normalizeManhuaDirectionCard).filter((c): c is ManhuaDirectionCard => Boolean(c)) : [];
  const mainCardId = text(r.mainCardId, 80);
  if (!cards.length || !mainCardId || !cards.some((c) => c.id === mainCardId)) return undefined;
  const authorizedCardIds = Array.isArray(r.authorizedCardIds) ? r.authorizedCardIds.map((s) => text(s, 80)).filter(Boolean) : [];
  const overridesRaw = r.sceneOverrides && typeof r.sceneOverrides === "object" ? (r.sceneOverrides as Record<string, unknown>) : {};
  const sceneOverrides: NonNullable<ManhuaDirectionCanon["sceneOverrides"]> = {};
  for (const key of ["action", "dialogue", "reveal", "emotion", "transition", "default"] as ManhuaDirectionSceneType[]) {
    const o = overridesRaw[key];
    if (!o || typeof o !== "object") continue;
    const cardId = text((o as Record<string, unknown>).cardId, 80);
    if (!cardId || !cards.some((c) => c.id === cardId)) continue;
    const stagesRaw = (o as Record<string, unknown>).stages;
    const stages = Array.isArray(stagesRaw) ? (stagesRaw.map((s) => text(s, 20)).filter((s) => STAGE_SET.has(s)) as ManhuaDirectorStrategyStage[]) : undefined;
    sceneOverrides[key] = { cardId, ...(stages?.length ? { stages } : {}) };
  }
  return {
    version: 1,
    mainCardId,
    cards,
    ...(Object.keys(sceneOverrides).length ? { sceneOverrides } : {}),
    authorizedCardIds,
  };
}

/** 卡级准入：≥2 条彼此独立的正式规律才可售/可进生产；否则 research_only */
export function manhuaDirectionCardIsProductionReady(card: ManhuaDirectionCard): boolean {
  // 同一编号的变体（AAD-001#2）只算一条；复合编号（AAD-001＋AAD-002）不算新规律
  const base = new Set<string>();
  for (const r of card.rules) {
    if (r.status === "research_only") continue;
    const id = r.id.replace(/#\d+$/, "");
    if (/[＋+]/.test(id)) continue;
    base.add(id);
  }
  return base.size >= 2;
}

export type ManhuaDirectionStyleBlocks = {
  /** 剧本：戏核、信息揭示、冲突取舍 */
  story: string;
  /** 分镜：构图、调度、景别、剪辑节奏 */
  storyboard: string;
  /** 关键帧：只写静态构图终态/光影/色调/材质；禁写运镜 */
  keyframe: string;
  /** 视频提示词：单镜主运镜、动作、表演、声音、剪辑交接（单行） */
  clip: string;
  /** 审查：失效条件与风格一致性，仅 advisory */
  review: string;
  /** 用了哪张卡（去名标签），供 UI 徽标 */
  usedCardLabelZh: string;
  /** 内部：本次编译用到的规律 id 与卡版本（溯源，不进提示词） */
  audit: { cardId: string; version: string; ruleIds: string[] };
};

const EMPTY_BLOCKS = (label = ""): ManhuaDirectionStyleBlocks => ({ story: "", storyboard: "", keyframe: "", clip: "", review: "", usedCardLabelZh: label, audit: { cardId: "", version: "", ruleIds: [] } });

/** 关键帧禁写运镜：含这些词的规律不投影到 keyframe */
const KEYFRAME_MOTION_RE = /运镜|推进|横移|升降|摇移|甩镜|环绕|变焦|长镜|剪辑|切换|硬切|节奏/;

function denameGuard(lines: string[], card: ManhuaDirectionCard): string[] {
  const names = [card.internal?.personName, ...(card.internal?.workNames || [])].map((n) => String(n || "").trim()).filter((n) => n.length >= 2);
  if (!names.length) return lines;
  return lines.filter((line) => !names.some((n) => line.includes(n)));
}

function marker(card: ManhuaDirectionCard): string {
  return `【导演法典·v1·${card.id}·${card.version}】${card.labelZh}`;
}

/**
 * 唯一编译入口：按场景类型选卡（副卡只覆盖其声明的阶段），只取正式规律，五块互相隔离。
 * 未授权、未达卡级准入、或 canon 为空 → 全空块（调用方按「没有导演法典」处理，不注入默认风格）。
 */
export function resolveDirectorStyleBlocks(
  canon: ManhuaDirectionCanon | null | undefined,
  sceneType: ManhuaDirectionSceneType = "default",
): ManhuaDirectionStyleBlocks {
  if (!canon) return EMPTY_BLOCKS();
  const byId = new Map(canon.cards.map((c) => [c.id, c] as const));
  const main = byId.get(canon.mainCardId);
  if (!main || !canon.authorizedCardIds.includes(main.id) || !manhuaDirectionCardIsProductionReady(main)) return EMPTY_BLOCKS(main?.labelZh || "");
  const override = canon.sceneOverrides?.[sceneType];
  const sub = override ? byId.get(override.cardId) : undefined;
  const subReady = Boolean(sub && canon.authorizedCardIds.includes(sub.id) && manhuaDirectionCardIsProductionReady(sub));
  const subStages = new Set<ManhuaDirectorStrategyStage>(override?.stages?.length ? override.stages : MANHUA_DIRECTION_STAGES);

  const cardFor = (stage: ManhuaDirectorStrategyStage): ManhuaDirectionCard => (subReady && sub && subStages.has(stage) ? sub : main);
  const rulesFor = (stage: ManhuaDirectorStrategyStage) =>
    cardFor(stage).rules.filter((r) => r.status !== "research_only" && r.stages.includes(stage));

  const usedRuleIds = new Set<string>();
  const take = (stage: ManhuaDirectorStrategyStage, pick: (r: ManhuaDirectionRule) => string | undefined) => {
    const card = cardFor(stage);
    const lines = rulesFor(stage)
      .filter((r) => (stage === "keyframe" ? !KEYFRAME_MOTION_RE.test(r.ruleZh) : true))
      .map((r) => {
        const v = pick(r);
        if (v) usedRuleIds.add(r.id);
        return v || "";
      })
      .filter(Boolean);
    return { card, lines: denameGuard(lines, card) };
  };

  const story = take("story", (r) => r.ruleZh);
  const storyboard = take("storyboard", (r) => r.ruleZh);
  const keyframe = take("keyframe", (r) => r.ruleZh);
  const clip = take("clip", (r) => r.ruleZh);
  const reviewRules = MANHUA_DIRECTION_STAGES.flatMap((stage) => rulesFor(stage)).filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i);
  const reviewLines = denameGuard(
    reviewRules.filter((r) => r.failZh).map((r) => `- ${r.titleZh || r.id}：失效条件——${r.failZh}`),
    main,
  );
  const avoid = denameGuard(main.avoidZh || [], main);

  const block = (t: { card: ManhuaDirectionCard; lines: string[] }, headZh: string) =>
    t.lines.length ? [marker(t.card), headZh, ...t.lines.map((l) => `- ${l}`)].join("\n") : "";
  return {
    story: block(story, "剧本层：戏核、信息揭示与冲突取舍按下列规律处理，只借方法不借外观。"),
    storyboard: block(storyboard, "分镜层：构图、调度、景别与剪辑节奏按下列规律处理。"),
    keyframe: block(keyframe, "关键帧层：只写静态构图终态、光影与材质；运镜一律不写。"),
    clip: clip.lines.length ? `${marker(clip.card)}｜${clip.lines.join("；")}` : "",
    review: reviewLines.length || avoid.length
      ? [marker(main), "审查提示（仅供参考，不作硬门禁）：", ...reviewLines, ...avoid.map((a) => `- 明确不用：${a}`)].join("\n")
      : "",
    usedCardLabelZh: main.labelZh,
    audit: { cardId: main.id, version: main.version, ruleIds: Array.from(usedRuleIds) },
  };
}

/** 生产成稿去名硬判：任何 internal 名称出现在五块里即泄漏 */
export function manhuaDirectionBlocksLeakInternalNames(blocks: ManhuaDirectionStyleBlocks, canon: ManhuaDirectionCanon): string[] {
  const names = canon.cards.flatMap((c) => [c.internal?.personName, ...(c.internal?.workNames || []), c.internal?.slug]).map((n) => String(n || "").trim()).filter((n) => n.length >= 2);
  const haystack = [blocks.story, blocks.storyboard, blocks.keyframe, blocks.clip, blocks.review].join("\n");
  return names.filter((n) => haystack.includes(n));
}
