/**
 * Platform Skill 自动路由总管：勾选 = 允许池；生成时按选题上下文挑子集，避免全文全灌。
 */

export type PlatformSkillRouteMode = "auto" | "all";

export type PlatformSkillSheetKind = "graphic" | "video" | "unknown";

export type PlatformSkillLane = "fmcg" | "forensic" | "crossover" | "contrast" | "default";

export type PlatformSkillRouteResult = {
  selectedIds: string[];
  primaryLane: PlatformSkillLane;
  reasons: string[];
};

/** 在池内则必选（文案方向与审核底座） */
export const PLATFORM_SKILL_ROUTER_CORE_IDS = [
  "hook-solution-cta",
  "review-safe-voice",
  "vivid-anti-boring",
  "cover-stop-scroll",
  "platform-native",
  "cultural-diversity",
  "lifestyle-diversity",
] as const;

type LaneDef = {
  id: PlatformSkillLane;
  /** 同分时越小越优先 */
  priority: number;
  patterns: RegExp[];
  skillIds: readonly string[];
};

const LANES: LaneDef[] = [
  {
    id: "fmcg",
    priority: 1,
    patterns: [
      /雪糕|冰淇淋|冰棍|冷饮|配料|营养成分|零食|奶茶|饮料|礼盒|月饼|火锅底料|畅销|0糖|零糖|代糖|植物基|低脂|添加剂|乳化剂|增稠剂|可可脂|白砂糖|添加糖|盐油糖|三减|包装背面|翻标签|识读/,
    ],
    skillIds: [
      "4season-fmcg-popsci",
      "label-debunk-copy",
      "authority-cite-endorsement",
      "fmcg-popsci-monetize",
      "summer-fmcg-popsci",
      "food-popsci-lens",
    ],
  },
  {
    id: "forensic",
    priority: 2,
    patterns: [
      /法医|尸检|猝死|暴毙|安全带|头盔|保命|急症|喉头|窒息|口角|劝酒|硬扛|窗口期|死因|解剖(?!学课堂)/,
    ],
    skillIds: ["forensic-life-lens", "authority-cite-endorsement"],
  },
  {
    id: "crossover",
    priority: 3,
    patterns: [/器官|拟人|谢谢你|对不起.*心脏|我的心脏|胰岛|线粒体|迷走神经|终身劳动|拳头大/],
    skillIds: ["crossover-popsci", "crossover-organ-popsci"],
  },
  {
    id: "contrast",
    priority: 4,
    patterns: [/反差身份|应徵服务员|应聘服务员|博士.*服务|身份错位|反转.*高潮|服务员.*博士/],
    skillIds: ["contrast-reversal-climax"],
  },
];

function scoreLane(context: string, lane: LaneDef): number {
  let score = 0;
  for (const re of lane.patterns) {
    const m = context.match(re);
    if (m) score += 10 + (m[0]?.length || 0);
  }
  return score;
}

function pickPrimaryLane(context: string): { lane: PlatformSkillLane; reasons: string[] } {
  const text = String(context || "");
  let best: { lane: PlatformSkillLane; score: number; priority: number } | null = null;
  const reasons: string[] = [];
  for (const lane of LANES) {
    const score = scoreLane(text, lane);
    if (score <= 0) continue;
    reasons.push(`lane:${lane.id} score=${score}`);
    if (
      !best ||
      score > best.score ||
      (score === best.score && lane.priority < best.priority)
    ) {
      best = { lane: lane.id, score, priority: lane.priority };
    }
  }
  if (!best) {
    reasons.push("lane:default (无强题材信号)");
    return { lane: "default", reasons };
  }
  return { lane: best.lane, reasons };
}

function laneSkillIds(lane: PlatformSkillLane): readonly string[] {
  if (lane === "default") return ["batch-arc-engagement"];
  const def = LANES.find((l) => l.id === lane);
  return def?.skillIds ?? [];
}

/**
 * 从允许池中按上下文路由出本次应注入的 Skill id 列表（去重、保序：核心 → 赛道 → 体裁）。
 */
export function routePlatformSkillIds(params: {
  poolIds: string[];
  context?: string | null;
  sheetKind?: PlatformSkillSheetKind | null;
  /** 上限（含核心）；默认 12 */
  maxSkills?: number;
}): PlatformSkillRouteResult {
  const { lane, reasons } = pickPrimaryLane(params.context || "");
  const forced = routePlatformSkillIdsForLane({
    poolIds: params.poolIds,
    lane,
    sheetKind: params.sheetKind,
    maxSkills: params.maxSkills,
  });
  return {
    selectedIds: forced.selectedIds,
    primaryLane: lane,
    reasons: [`primaryLane=${lane}`, ...reasons, ...forced.reasons],
  };
}

function laneAvailableInPool(lane: PlatformSkillLane, pool: Set<string>): boolean {
  if (lane === "default") return true;
  return laneSkillIds(lane).some((id) => pool.has(id));
}

/**
 * 强制指定赛道（用于六维互斥预分配）。
 */
export function routePlatformSkillIdsForLane(params: {
  poolIds: string[];
  lane: PlatformSkillLane;
  sheetKind?: PlatformSkillSheetKind | null;
  maxSkills?: number;
}): PlatformSkillRouteResult {
  const pool = new Set((params.poolIds || []).map(String).filter(Boolean));
  const selected: string[] = [];
  const add = (id: string) => {
    if (!pool.has(id) || selected.includes(id)) return;
    selected.push(id);
  };
  const reasons = [`forcedLane=${params.lane}`];
  for (const id of PLATFORM_SKILL_ROUTER_CORE_IDS) add(id);
  for (const id of laneSkillIds(params.lane)) add(id);

  const sheet = params.sheetKind || "unknown";
  if (sheet === "graphic") {
    add("graphic-note-rhythm");
    reasons.push("sheet:graphic → graphic-note-rhythm");
  } else if (sheet === "video") {
    add("director-craft");
    reasons.push("sheet:video → director-craft");
  } else {
    add("director-craft");
    add("graphic-note-rhythm");
  }

  const max = Math.max(4, Math.min(20, params.maxSkills ?? 12));
  return {
    selectedIds: selected.slice(0, max),
    primaryLane: params.lane,
    reasons,
  };
}

/** 六维默认偏好赛道（尽量互斥；再按上下文分数微调） */
export const PLATFORM_SKILL_DIM_PREFERRED_LANES: readonly PlatformSkillLane[] = [
  "crossover", // 1 专业洞察
  "forensic", // 2 跨界价值观 → 稀缺视角（与人设医学可咬合）
  "fmcg", // 3 痛点暴击 → 畅销品/标签
  "contrast", // 4 人设魅力 → 身份反差
  "default", // 5 强冲突：先占位，分配时优先吃剩余 specialty
  "default", // 6 长尾常青
] as const;

const SPECIALTY_LANES: PlatformSkillLane[] = ["forensic", "fmcg", "crossover", "contrast"];

export type DiverseBlueprintLanePlan = {
  dimIndex: number; // 0-based
  dimName: string;
  lane: PlatformSkillLane;
  selectedIds: string[];
  reasons: string[];
};

/**
 * 为 Stage2 六条 blueprint 预分配**尽量不同**的题材赛道。
 * - 同批 specialty 赛道优先互斥；default 可重复填补
 * - 维度偏好表 + 上下文关键词分数共同决定
 */
export function planDiverseBlueprintSkillRoutes(params: {
  poolIds: string[];
  baseContext?: string | null;
  dimensions: Array<{ dimIndex: number; dimName: string; seedText?: string | null }>;
  sheetKindForDim?: (dimIndex: number) => PlatformSkillSheetKind;
}): DiverseBlueprintLanePlan[] {
  const pool = new Set((params.poolIds || []).map(String).filter(Boolean));
  const base = String(params.baseContext || "");

  const scored = SPECIALTY_LANES.map((id) => {
    const def = LANES.find((l) => l.id === id)!;
    return { id, score: scoreLane(base, def), available: laneAvailableInPool(id, pool) };
  }).filter((x) => x.available);

  const used = new Set<PlatformSkillLane>();
  const plans: DiverseBlueprintLanePlan[] = [];

  const pickLane = (preferred: PlatformSkillLane, seedBoostContext: string): PlatformSkillLane => {
    const combined = `${base}\n${seedBoostContext}`;
    // seed/context 强信号可覆盖偏好
    const { lane: signalLane } = pickPrimaryLane(combined);
    const candidates: PlatformSkillLane[] = [];
    if (signalLane !== "default" && laneAvailableInPool(signalLane, pool)) {
      candidates.push(signalLane);
    }
    if (laneAvailableInPool(preferred, pool)) candidates.push(preferred);
    for (const s of [...scored].sort((a, b) => b.score - a.score)) {
      candidates.push(s.id);
    }
    candidates.push("default");

    for (const c of candidates) {
      if (c === "default") continue;
      if (!laneAvailableInPool(c, pool)) continue;
      if (used.has(c)) continue;
      used.add(c);
      return c;
    }
    // 专业赛道用尽 → default（可重复）
    return "default";
  };

  for (const dim of params.dimensions) {
    const pref =
      PLATFORM_SKILL_DIM_PREFERRED_LANES[dim.dimIndex] ??
      PLATFORM_SKILL_DIM_PREFERRED_LANES[PLATFORM_SKILL_DIM_PREFERRED_LANES.length - 1]!;
    const lane = pickLane(pref, String(dim.seedText || dim.dimName || ""));
    const sheet = params.sheetKindForDim?.(dim.dimIndex) ?? "unknown";
    const routed = routePlatformSkillIdsForLane({
      poolIds: params.poolIds,
      lane,
      sheetKind: sheet,
    });
    plans.push({
      dimIndex: dim.dimIndex,
      dimName: dim.dimName,
      lane: routed.primaryLane,
      selectedIds: routed.selectedIds,
      reasons: [
        `dim=${dim.dimIndex + 1}`,
        `preferred=${pref}`,
        ...routed.reasons,
      ],
    });
  }

  return plans;
}

/** 将「用户勾选 / null=未指定」解析为路由用的池 id 列表 */
export function resolveSkillPoolIds(params: {
  enabledSkillIds?: string[] | null;
  /** enabledSkillIds 为 null 时的默认池（通常 defaultEnabled 内置） */
  fallbackPoolIds: string[];
}): string[] {
  if (Array.isArray(params.enabledSkillIds)) {
    return params.enabledSkillIds.map(String).filter(Boolean);
  }
  return (params.fallbackPoolIds || []).map(String).filter(Boolean);
}
