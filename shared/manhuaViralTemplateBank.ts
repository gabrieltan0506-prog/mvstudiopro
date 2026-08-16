/**
 * 漫剧节奏模板库（产品只消费 status=approved）。
 * 出厂种子已于 2026-08-10 全部下架——那批是手写硬编码货，没经过真实爆款学习，
 * 用户判定质量不足。产品列表从此只来自 GCS approved（学节奏真学成 + 人审批准），
 * 本文件只留类型、解析与合并逻辑。
 * 成稿禁止竞品片名/台词抄袭；只借结构与中性手法标签。
 */

import {
  MANHUA_EPISODE_SEGMENT_DURATION_SEC,
  getManhuaEpisodeLengthTier,
  manhuaEpisodeDensityFloors,
  manhuaEpisodeSegmentsForTier,
} from "./manhuaEpisodeSegmentPlan.js";

export type ManhuaViralTemplateStatus = "proposed" | "approved" | "rejected";

/** 赛道分组（UI 分类排布用） */
export type ManhuaViralTemplateLane =
  | "爽文逆袭"
  | "古言种田"
  | "系统觉醒"
  | "甜宠"
  | "悬疑权谋"
  | "搞笑沙雕"
  | "游戏竞技";

export const MANHUA_VIRAL_TEMPLATE_LANE_ORDER: readonly ManhuaViralTemplateLane[] = [
  "爽文逆袭",
  "古言种田",
  "系统觉醒",
  "甜宠",
  "悬疑权谋",
  "搞笑沙雕",
  "游戏竞技",
] as const;

export type ManhuaViralTemplateBeat = {
  /** 约第几秒起（0-based 区间起点） */
  atSec: number;
  /** 冲突/信息增量类型（中性） */
  conflictZh: string;
  /** 可视觉化动作一句 */
  visualZh: string;
};

export type ManhuaViralTemplateDensityHints = {
  /** 建议正文最少字（卡片按长档 12 段填；注入时按目标档段数折算） */
  minBodyChars: number;
  /** 建议「」对白句数 */
  minDialogueLines: number;
  /** 建议不同场景名命中数 */
  minLocationHits: number;
};

export type ManhuaViralTemplateSourceRef = {
  url: string;
  fetchedAt: string;
  noteZh?: string;
};

export const MANHUA_VIRAL_TEMPLATE_OPTIMIZE_FIELDS = [
  "nameZh",
  "laneZh",
  "summaryZh",
  "hook3sZh",
  "beatGrid",
  "scenePoolHints",
  "castShape",
  "densityHints",
] as const;

export type ManhuaViralTemplateOptimizeField =
  (typeof MANHUA_VIRAL_TEMPLATE_OPTIMIZE_FIELDS)[number];

export type ManhuaViralTemplateOptimizeModel =
  | "terra_high"
  | "kimi_k3_max"
  | "claude_opus_5_high"
  | "deepseek_v4_0813_high";

export type ManhuaViralTemplateChangeReason = {
  field: ManhuaViralTemplateOptimizeField;
  reasonZh: string;
};

/** 待审优化修订；只存在于监管私有卡，公开 DTO 不读取这些字段。 */
export type ManhuaViralTemplateRevision = {
  parentTemplateId: string;
  requestId: string;
  model: ManhuaViralTemplateOptimizeModel;
  modelName: string;
  reasoningEffort: "medium" | "high" | "max";
  promptZh: string;
  changedFields: ManhuaViralTemplateOptimizeField[];
  reasons: ManhuaViralTemplateChangeReason[];
  createdByUserId: number;
  createdAt: string;
};

export type ManhuaViralTemplateCard = {
  id: string;
  /** UI 短名（中性，不写竞品剧名） */
  nameZh: string;
  laneZh: ManhuaViralTemplateLane;
  /** 一句话用途 */
  summaryZh: string;
  hook3sZh: string;
  beatGrid: ManhuaViralTemplateBeat[];
  scenePoolHints: string[];
  castShape: {
    leadDesireZh: string;
    pressureZh: string;
    foilZh?: string;
  };
  densityHints: ManhuaViralTemplateDensityHints;
  sourceRefs: ManhuaViralTemplateSourceRef[];
  status: ManhuaViralTemplateStatus;
  /** 公开码（批准入库时随机生成并持久化，如 "A7F2"）：普通用户唯一可见的模板句柄来源 */
  publicCode?: string;
  approvedAt?: string;
  updatedAt?: string;
  /** 学习链 provenance：证明读帧模型与系列聚合方式；兼容旧润色记录。 */
  provenance?: ManhuaViralTemplateProvenance;
  /** 已批准模板经 owner 优化后形成的待审修订；普通学习提案没有此字段。 */
  revision?: ManhuaViralTemplateRevision;
};

/** 读帧与聚合分开记；proposalPolish 只为读取迁移前旧卡保留。 */
export type ManhuaViralTemplateProvenance = {
  frameVision?: {
    provider: string;
    model: string;
    attemptedChunks: number;
    successChunks: number;
  };
  proposalPolish?: {
    provider: string;
    model: string;
    attempted: boolean;
    success: boolean;
    /** true = 润色失败、卡面是启发式草稿 */
    degraded?: boolean;
  };
  /** 关键帧 API 已同时产出底稿字段；这里证明系列卡由程序聚合且没有第二次模型调用。 */
  seriesAggregation?: {
    mode: "frame_vision_deterministic";
    sourceChunks: number;
    success: boolean;
  };
};

const DEFAULT_DENSITY: ManhuaViralTemplateDensityHints = {
  minBodyChars: 280,
  minDialogueLines: 8,
  minLocationHits: 2,
};

/** 出厂种子已清空（见文件头）；保留常量名给合并逻辑与测试注入用 */
export const MANHUA_VIRAL_TEMPLATE_BANK: readonly ManhuaViralTemplateCard[] = [];

export function parseManhuaViralTemplateCard(raw: unknown): ManhuaViralTemplateCard | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<ManhuaViralTemplateCard>;
  const id = String(o.id || "").trim();
  const nameZh = String(o.nameZh || "").trim();
  const laneZh = String(o.laneZh || "").trim() as ManhuaViralTemplateLane;
  if (!id || !nameZh) return null;
  if (!MANHUA_VIRAL_TEMPLATE_LANE_ORDER.includes(laneZh)) return null;
  const status = o.status;
  if (status !== "proposed" && status !== "approved" && status !== "rejected") return null;
  const beatGrid = Array.isArray(o.beatGrid)
    ? o.beatGrid
        .map((b) => ({
          atSec: Math.max(0, Math.floor(Number((b as ManhuaViralTemplateBeat).atSec) || 0)),
          conflictZh: String((b as ManhuaViralTemplateBeat).conflictZh || "").trim().slice(0, 40),
          visualZh: String((b as ManhuaViralTemplateBeat).visualZh || "").trim().slice(0, 80),
        }))
        .filter((b) => b.conflictZh && b.visualZh)
        .slice(0, 24)
    : [];
  const cast = o.castShape || { leadDesireZh: "", pressureZh: "" };
  const revision = parseManhuaViralTemplateRevision(o.revision);
  // 只要声明了 revision 或使用修订 id，就必须完整通过修订契约，禁止降级成普通提案。
  if ((o.revision != null || /^tpl_revision_/i.test(id)) && !revision) return null;
  return {
    id: id.slice(0, 64),
    nameZh: nameZh.slice(0, 32),
    laneZh,
    summaryZh: String(o.summaryZh || "").trim().slice(0, 120),
    hook3sZh: String(o.hook3sZh || "").trim().slice(0, 200),
    beatGrid,
    scenePoolHints: (Array.isArray(o.scenePoolHints) ? o.scenePoolHints : [])
      .map((s) => String(s || "").trim())
      .filter(Boolean)
      .slice(0, 16),
    castShape: {
      leadDesireZh: String(cast.leadDesireZh || "").trim().slice(0, 80),
      pressureZh: String(cast.pressureZh || "").trim().slice(0, 80),
      foilZh: String(cast.foilZh || "").trim().slice(0, 80) || undefined,
    },
    densityHints: {
      minBodyChars: Math.max(
        80,
        Math.floor(Number(o.densityHints?.minBodyChars) || DEFAULT_DENSITY.minBodyChars),
      ),
      minDialogueLines: Math.max(
        2,
        Math.floor(Number(o.densityHints?.minDialogueLines) || DEFAULT_DENSITY.minDialogueLines),
      ),
      minLocationHits: Math.max(
        1,
        Math.floor(Number(o.densityHints?.minLocationHits) || DEFAULT_DENSITY.minLocationHits),
      ),
    },
    sourceRefs: (Array.isArray(o.sourceRefs) ? o.sourceRefs : [])
      .map((r) => ({
        url: String((r as ManhuaViralTemplateSourceRef).url || "").trim().slice(0, 500),
        fetchedAt: String((r as ManhuaViralTemplateSourceRef).fetchedAt || "").trim().slice(0, 32),
        noteZh: String((r as ManhuaViralTemplateSourceRef).noteZh || "").trim().slice(0, 120) || undefined,
      }))
      .filter((r) => r.url)
      .slice(0, 8),
    status,
    publicCode: /^[A-Z0-9]{4,16}$/.test(String(o.publicCode || "")) ? String(o.publicCode) : undefined,
    approvedAt: o.approvedAt ? String(o.approvedAt) : undefined,
    updatedAt: o.updatedAt ? String(o.updatedAt) : undefined,
    provenance: parseManhuaViralTemplateProvenance(o.provenance),
    revision,
  };
}

function parseManhuaViralTemplateRevision(
  raw: unknown,
): ManhuaViralTemplateRevision | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Partial<ManhuaViralTemplateRevision>;
  const parentTemplateId = String(o.parentTemplateId || "").trim();
  const requestId = String(o.requestId || "").trim();
  const promptZh = String(o.promptZh || "").trim();
  const modelName = String(o.modelName || "").trim();
  const createdAt = String(o.createdAt || "").trim();
  const model = o.model;
  const modelValues: readonly ManhuaViralTemplateOptimizeModel[] = [
    "terra_high",
    "kimi_k3_max",
    "claude_opus_5_high",
    "deepseek_v4_0813_high",
  ];
  const effort = o.reasoningEffort;
  if (
    !/^tpl_[a-z0-9_-]{1,60}$/i.test(parentTemplateId)
    || !/^[a-zA-Z0-9_-]{8,80}$/.test(requestId)
    || !modelValues.includes(model as ManhuaViralTemplateOptimizeModel)
    || (effort !== "medium" && effort !== "high" && effort !== "max")
    || !promptZh
    || !modelName
    || modelName.length > 80
    || !createdAt
    || createdAt.length > 40
    || !Number.isFinite(Date.parse(createdAt))
    || !Number.isInteger(o.createdByUserId)
    || Number(o.createdByUserId) <= 0
  ) {
    return undefined;
  }
  const changedFields = (Array.isArray(o.changedFields) ? o.changedFields : [])
    .filter((field): field is ManhuaViralTemplateOptimizeField =>
      MANHUA_VIRAL_TEMPLATE_OPTIMIZE_FIELDS.includes(field as ManhuaViralTemplateOptimizeField),
    );
  const reasons = (Array.isArray(o.reasons) ? o.reasons : [])
    .map((reason) => ({
      field: String((reason as ManhuaViralTemplateChangeReason).field || "") as ManhuaViralTemplateOptimizeField,
      reasonZh: String((reason as ManhuaViralTemplateChangeReason).reasonZh || "").trim().slice(0, 240),
    }))
    .filter((reason) =>
      MANHUA_VIRAL_TEMPLATE_OPTIMIZE_FIELDS.includes(reason.field) && Boolean(reason.reasonZh),
    );
  if (!changedFields.length || changedFields.some((field) => !reasons.some((r) => r.field === field))) {
    return undefined;
  }
  return {
    parentTemplateId: parentTemplateId.slice(0, 64),
    requestId: requestId.slice(0, 80),
    model: model as ManhuaViralTemplateOptimizeModel,
    modelName,
    reasoningEffort: effort,
    promptZh: promptZh.slice(0, 2_000),
    changedFields: Array.from(new Set(changedFields)),
    reasons,
    createdByUserId: Number(o.createdByUserId),
    createdAt,
  };
}

/**
 * 公开功能卡（普通用户唯一可见形态）。商业机密边界：内部 id / 真名 / 来源 / 学习出处 /
 * 节拍与场景自由文本一概不出现——字段显式逐个构造，禁止从内部卡展开（fail-closed）。
 */
export type PublicManhuaViralTemplateCard = {
  /** 稳定公开句柄：`mt_${publicCode 小写}`；扩写入参可直接用它选模板 */
  publicId: string;
  /** 匿名展示名：`${laneZh}·爆款节奏 ${publicCode}` */
  nameZh: string;
  laneZh: ManhuaViralTemplateLane;
  beatCount: number;
  densityLevel: "standard" | "dense";
  /** 前台文案（人工润色的零具名稿，服务端文案表供给） */
  featureZh: string;
  introZh: string;
};

export function makePublicTemplateId(publicCode: string): string {
  return `mt_${String(publicCode || "").trim().toLowerCase()}`;
}

export function makeAnonymousTemplateNameZh(
  laneZh: ManhuaViralTemplateLane,
  publicCode: string,
): string {
  return `${laneZh}·爆款节奏 ${String(publicCode || "").trim().toUpperCase()}`;
}

/** 无 publicCode 的卡返回 null（调用方跳过并告警）——逼着回填先行，绝不回退成可反查的内部 id */
export function toPublicManhuaViralTemplateCard(
  card: ManhuaViralTemplateCard,
  copy?: { featureZh?: string; introZh?: string } | null,
): PublicManhuaViralTemplateCard | null {
  const code = String(card.publicCode || "").trim();
  if (!/^[A-Z0-9]{4,16}$/.test(code)) return null;
  return {
    publicId: makePublicTemplateId(code),
    nameZh: makeAnonymousTemplateNameZh(card.laneZh, code),
    laneZh: card.laneZh,
    beatCount: Array.isArray(card.beatGrid) ? card.beatGrid.length : 0,
    densityLevel: (card.densityHints?.minDialogueLines ?? 0) >= 10 ? "dense" : "standard",
    featureZh: String(copy?.featureZh || `${card.beatGrid.length} 拍连载节奏骨架`).slice(0, 120),
    introZh: String(
      copy?.introZh ||
        `按 ${card.beatGrid.length} 个节拍位组织开场与连载钩子，适合${card.laneZh}题材的快节奏叙事。`,
    ).slice(0, 200),
  };
}

function parseManhuaViralTemplateProvenance(
  raw: unknown,
): ManhuaViralTemplateProvenance | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as ManhuaViralTemplateProvenance;
  const out: ManhuaViralTemplateProvenance = {};
  if (o.frameVision && typeof o.frameVision === "object") {
    out.frameVision = {
      provider: String(o.frameVision.provider || "").slice(0, 20),
      model: String(o.frameVision.model || "").slice(0, 60),
      attemptedChunks: Math.max(0, Math.floor(Number(o.frameVision.attemptedChunks) || 0)),
      successChunks: Math.max(0, Math.floor(Number(o.frameVision.successChunks) || 0)),
    };
  }
  if (o.proposalPolish && typeof o.proposalPolish === "object") {
    out.proposalPolish = {
      provider: String(o.proposalPolish.provider || "").slice(0, 20),
      model: String(o.proposalPolish.model || "").slice(0, 60),
      attempted: o.proposalPolish.attempted === true,
      success: o.proposalPolish.success === true,
      degraded: o.proposalPolish.degraded === true || undefined,
    };
  }
  if (o.seriesAggregation && typeof o.seriesAggregation === "object") {
    out.seriesAggregation = {
      mode: "frame_vision_deterministic",
      sourceChunks: Math.max(0, Math.floor(Number(o.seriesAggregation.sourceChunks) || 0)),
      success: o.seriesAggregation.success === true,
    };
  }
  return out.frameVision || out.proposalPolish || out.seriesAggregation ? out : undefined;
}

/**
 * 种子库 ∪ 动态 extras；同 id 以 extras 为准（后写覆盖）。
 * 用于 GCS approved 与出厂种子合并，避免改 TypeScript 数组。
 */
export function mergeManhuaViralTemplateBanks(
  seed: readonly ManhuaViralTemplateCard[],
  extras?: readonly ManhuaViralTemplateCard[] | null,
): ManhuaViralTemplateCard[] {
  const map = new Map<string, ManhuaViralTemplateCard>();
  for (const t of seed) {
    if (t?.id) map.set(t.id, t);
  }
  for (const t of extras || []) {
    if (t?.id) map.set(t.id, t);
  }
  return Array.from(map.values());
}

export function getManhuaViralTemplate(
  id?: string | null,
  extras?: readonly ManhuaViralTemplateCard[] | null,
): ManhuaViralTemplateCard | null {
  const key = String(id || "").trim();
  if (!key) return null;
  const bank = mergeManhuaViralTemplateBanks(MANHUA_VIRAL_TEMPLATE_BANK, extras);
  return bank.find((t) => t.id === key) || null;
}

/** 产品可选列表：仅 approved（可注入 GCS 动态库） */
export function listApprovedManhuaViralTemplates(
  extras?: readonly ManhuaViralTemplateCard[] | null,
): ManhuaViralTemplateCard[] {
  return mergeManhuaViralTemplateBanks(MANHUA_VIRAL_TEMPLATE_BANK, extras).filter(
    (t) => t.status === "approved",
  );
}

export function listApprovedManhuaViralTemplatesGrouped(
  extras?: readonly ManhuaViralTemplateCard[] | null,
): Array<{
  laneZh: ManhuaViralTemplateLane;
  items: ManhuaViralTemplateCard[];
}> {
  const approved = listApprovedManhuaViralTemplates(extras);
  return MANHUA_VIRAL_TEMPLATE_LANE_ORDER.map((laneZh) => ({
    laneZh,
    items: approved.filter((t) => t.laneZh === laneZh),
  })).filter((g) => g.items.length > 0);
}

const MANHUA_VIRAL_TEMPLATE_LANE_TOPIC_RE: Record<ManhuaViralTemplateLane, RegExp> = {
  爽文逆袭: /逆袭|复仇|重生|打脸|赘婿|归来|翻盘|爽文/,
  古言种田: /古言|古代|种田|农家|宅斗|边关|王妃|侯府|将军/,
  系统觉醒: /系统|觉醒|异能|金手指|穿越|修仙|玄幻/,
  甜宠: /甜宠|恋爱|爱情|总裁|先婚|闪婚|夫人|追妻/,
  悬疑权谋: /悬疑|权谋|宫斗|探案|谜案|朝堂|阴谋|推理/,
  搞笑沙雕: /搞笑|沙雕|喜剧|无厘头|轻松|欢乐/,
  游戏竞技: /游戏|电竞|竞技|玩家|副本|战队|赛事/,
};

/** 编剧室“推荐 Skill”：只在题材明确命中时推荐，不为凑数强塞模板。 */
export function recommendApprovedManhuaViralTemplate(
  cards: readonly ManhuaViralTemplateCard[],
  topic: string | null | undefined,
): ManhuaViralTemplateCard | null {
  const text = String(topic || "").trim();
  if (!text) return null;
  const approved = cards.filter((card) => card.status === "approved");
  for (const lane of MANHUA_VIRAL_TEMPLATE_LANE_ORDER) {
    if (!MANHUA_VIRAL_TEMPLATE_LANE_TOPIC_RE[lane].test(text)) continue;
    const hit = approved.find((card) => card.laneZh === lane);
    if (hit) return hit;
  }
  return null;
}

/** 公开卡版推荐器：服务端只下发 approved，故无需 status 过滤；按赛道正则匹配题材 */
export function recommendPublicManhuaViralTemplate(
  cards: readonly PublicManhuaViralTemplateCard[],
  topic: string | null | undefined,
): PublicManhuaViralTemplateCard | null {
  const text = String(topic || "").trim();
  if (!text) return null;
  for (const lane of MANHUA_VIRAL_TEMPLATE_LANE_ORDER) {
    if (!MANHUA_VIRAL_TEMPLATE_LANE_TOPIC_RE[lane].test(text)) continue;
    const hit = cards.find((card) => card.laneZh === lane);
    if (hit) return hit;
  }
  return null;
}

/** 卡片里的骨架与密度都按长档 12 段填写，折算短档时以它为分母 */
const LONG_TIER_SEGMENTS = manhuaEpisodeSegmentsForTier("long");

/**
 * 把模板节拍格套到目标段数上。
 *
 * 卡片里存的是长档骨架（12 拍 × 15s = 180s）。短档一集只有 6 段，若原样注入，
 * 编剧会照着 165s 的弧线写，后半永远拍不出来。段长恒定 15s，所以这里只做两件事：
 * 按目标段数等距抽稀（必留开场与片尾钩子），再按 15s 重打时间戳。
 */
export function fitManhuaViralBeatGridToSegments(
  beatGrid: readonly ManhuaViralTemplateBeat[],
  segments: number,
): ManhuaViralTemplateBeat[] {
  const src = beatGrid.slice(0, 16);
  const want = Math.max(1, Math.floor(segments));
  if (!src.length) return [];
  const picked =
    src.length <= want
      ? src.slice()
      : Array.from({ length: want }, (_, i) =>
          src[
            want === 1 ? 0 : Math.round((i * (src.length - 1)) / (want - 1))
          ],
        );
  return picked.map((b, i) => ({
    ...b,
    atSec: i * MANHUA_EPISODE_SEGMENT_DURATION_SEC,
  }));
}

/**
 * 把卡片的密度建议套到目标段数上，并抬到门禁线。
 *
 * 卡片里的 8 句对白是长档口径的手写估值，而门禁按每段 3 句算，长档要 30 句。
 * 直接把 8 句发给编剧，他写完就卡门禁，退回来重写——写多少都在门禁线下。
 */
export function fitManhuaViralDensityHintsToSegments(
  hints: ManhuaViralTemplateDensityHints,
  segments: number,
): ManhuaViralTemplateDensityHints {
  const want = Math.max(1, Math.floor(segments));
  const floors = manhuaEpisodeDensityFloors(want * MANHUA_EPISODE_SEGMENT_DURATION_SEC);
  const scale = want / LONG_TIER_SEGMENTS;
  return {
    minBodyChars: Math.max(floors.minBody, Math.round(hints.minBodyChars * scale)),
    minDialogueLines: Math.max(floors.minDlg, Math.round(hints.minDialogueLines * scale)),
    minLocationHits: Math.max(floors.minLoc, hints.minLocationHits),
  };
}

/** 由完整卡片生成编剧扩写注入块 */
export function formatManhuaViralTemplateWriterAddonFromCard(
  tpl: ManhuaViralTemplateCard | null | undefined,
  lengthTierId?: string | null,
): string {
  if (!tpl || tpl.status !== "approved") return "";
  const tier = getManhuaEpisodeLengthTier(lengthTierId);
  const segments = manhuaEpisodeSegmentsForTier(tier.id);
  const beats = fitManhuaViralBeatGridToSegments(tpl.beatGrid, segments)
    .map((b) => `- ${b.atSec}s｜${b.conflictZh}｜${b.visualZh}`)
    .join("\n");
  const d = fitManhuaViralDensityHintsToSegments(tpl.densityHints, segments);
  return [
    "【节奏模板·骨架建议】",
    `模板：${tpl.nameZh}（${tpl.laneZh}）`,
    tpl.summaryZh ? `用途：${tpl.summaryZh}` : "",
    `前3秒钩子：${tpl.hook3sZh}`,
    `人设槽：欲望=${tpl.castShape.leadDesireZh}；压迫=${tpl.castShape.pressureZh}${
      tpl.castShape.foilZh ? `；对照=${tpl.castShape.foilZh}` : ""
    }`,
    tpl.scenePoolHints.length
      ? `场景池关键词（写入场景表，勿写外部剧名）：${tpl.scenePoolHints.join("、")}`
      : "",
    `密度建议（约${tier.targetSec}秒/集·${segments}段）：正文≥${d.minBodyChars}字；「」对白≥${d.minDialogueLines}句；场景表命中≥${d.minLocationHits}`,
    beats ? `节拍格：\n${beats}` : "",
    "硬规则：只借结构与节奏；禁止抄外部剧名/台词/商标；成稿只写可拍动作与关系。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** 编剧室消费版 Skill：只给分类与能力简介，把具体情节和节拍留给当前大模型发挥。 */
export function formatManhuaViralTemplateWriterSkillFromCard(
  tpl: ManhuaViralTemplateCard | null | undefined,
): string {
  if (!tpl || tpl.status !== "approved") return "";
  return [
    `分类：${tpl.laneZh}`,
    `能力简介：${tpl.summaryZh}`,
    "请结合当前题材自由发挥，不照搬来源剧情，不强制复刻固定节拍。",
  ].join("\n");
}

/** 注入编剧扩写：节拍格 + 密度 + 场景池关键词（不泄漏出处剧名） */
export function formatManhuaViralTemplateWriterAddon(
  id?: string | null,
  extras?: readonly ManhuaViralTemplateCard[] | null,
  lengthTierId?: string | null,
): string {
  return formatManhuaViralTemplateWriterAddonFromCard(
    getManhuaViralTemplate(id, extras),
    lengthTierId,
  );
}
