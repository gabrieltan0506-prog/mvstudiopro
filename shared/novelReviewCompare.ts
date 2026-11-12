/**
 * 多线路审稿对比（1112，站长：审稿不只用单一线路，多条线路结果并排比较）。
 * 本文件全部是确定性的纯函数与常量：不调模型、不读时间、不依赖随机数；同样的输入永远得到同样的输出。
 */
import { NOVEL_REVIEW_DIMENSIONS, type NovelReviewDimension } from "./novelCraftReview";
import {
  NOVEL_ADVISOR_TIER_OPTIONS,
  NOVEL_REVIEW_LANES,
  locateNovelQuote,
  resolveNovelAdvisorTierPrice,
  type NovelReview,
  type NovelReviewLane,
  type NovelReviewOverride,
} from "./novelWorkspace";

/** 线路顺序固定（线路一、二、三），聚类与展示都按这个顺序，保证结果确定。 */
export const NOVEL_REVIEW_COMPARE_LANES: ReadonlyArray<{
  value: NovelReviewLane;
  label: string;
  note?: string;
}> = [
  { value: "glm", label: "线路一" },
  { value: "deepseek", label: "线路二" },
  { value: "carbon", label: "线路三", note: "更深、更慢，约需数分钟" },
];
export const NOVEL_REVIEW_COMPARE_DEFAULT_LANES: readonly NovelReviewLane[] = ["glm", "deepseek"];
export const NOVEL_REVIEW_COMPARE_MIN_LANES = 2;
export const novelReviewLaneLabel = (lane: NovelReviewLane) =>
  NOVEL_REVIEW_COMPARE_LANES.find(l => l.value === lane)!.label;
const laneOrder = (lane: NovelReviewLane) => NOVEL_REVIEW_LANES.indexOf(lane);

/**
 * 对比审稿价格（积分 / 每条线路一次审稿）：沿用站长 2026-11-11 定的三档价，与创作顾问档位同一真源
 * （NOVEL_ADVISOR_TIER_OPTIONS，经 resolveNovelAdvisorTierPrice 读取）：
 * 线路一 10、线路二 5、线路三限时特价 20（2026-12-01 起 40）。管理者测试流程暂不扣费。
 */
export function novelReviewLaneCredits(lane: NovelReviewLane, now: Date | number = Date.now()) {
  const tier = NOVEL_ADVISOR_TIER_OPTIONS.find(option => option.value === lane);
  if (!tier) throw new Error(`未知线路：${lane}`);
  return resolveNovelAdvisorTierPrice(tier, now).credits;
}
export function novelReviewCompareCredits(lanes: readonly NovelReviewLane[], now: Date | number = Date.now()) {
  return Array.from(new Set(lanes)).reduce((sum, lane) => sum + novelReviewLaneCredits(lane, now), 0);
}

/** 同一处问题：两条意见在原文的区间重叠，或相距不超过这么多字。 */
export const NOVEL_REVIEW_CLUSTER_GAP = 40;
/** 同一维度各线路最高 / 最低分差达到这个值，标「分歧大」。 */
export const NOVEL_REVIEW_SCORE_SPREAD_ALERT = 2;
/**
 * 易混的相邻维度（保守表，先只放三对）：同一处原文、维度属于其中一对的两条意见视为同一处问题。
 * 不在表里的不同维度一律不合并。
 */
export const NOVEL_REVIEW_DIMENSION_NEIGHBORS: ReadonlyArray<readonly [NovelReviewDimension, NovelReviewDimension]> = [
  ["逻辑", "伏笔"],
  ["情绪高潮", "精彩度"],
  ["紧凑度", "精彩度"],
];
export function novelReviewDimensionsMergeable(a: NovelReviewDimension, b: NovelReviewDimension) {
  return a === b || NOVEL_REVIEW_DIMENSION_NEIGHBORS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

export type NovelReviewLaneResult = {
  lane: NovelReviewLane;
  requestId: string;
  review: NovelReview;
};
export type NovelReviewIssue = NovelReview["issues"][number];
/** 一条意见：key = `${lane}:${在该线路 issues 里的下标}`，全局唯一且稳定。 */
export type NovelReviewCompareItem = {
  key: string;
  lane: NovelReviewLane;
  index: number;
  issue: NovelReviewIssue;
  /** 在原文中的字符区间；未能定位为 null。 */
  range: { start: number; end: number } | null;
};
export type NovelReviewCluster = {
  id: string;
  /** 合并后覆盖的原文区间与片段。 */
  start: number;
  end: number;
  quote: string;
  lanes: NovelReviewLane[];
  items: NovelReviewCompareItem[];
};
export type NovelReviewComparison = {
  /** 被 ≥2 条线路指出的同一处问题（按原文位置排序）。 */
  shared: NovelReviewCluster[];
  /** 只有一条线路指出的意见（含未能定位原文的），按线路分列。 */
  unique: Record<NovelReviewLane, NovelReviewCompareItem[]>;
};

const gapBetween = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.max(0, Math.max(a.start, b.start) - Math.min(a.end, b.end));

function sortLanes(lanes: readonly NovelReviewLaneResult[]) {
  return [...lanes].sort((a, b) => laneOrder(a.lane) - laneOrder(b.lane));
}

/** 每条意见定位到原文：located:false 的、或用 locateNovelQuote 找不到的，range 为 null。 */
export function locateNovelReviewItems(original: string, lanes: readonly NovelReviewLaneResult[]) {
  const items: NovelReviewCompareItem[] = [];
  for (const { lane, review } of sortLanes(lanes))
    review.issues.forEach((issue, index) => {
      const hit = issue.located === false ? null : locateNovelQuote(original, issue.quote);
      items.push({ key: `${lane}:${index}`, lane, index, issue, range: hit ? { start: hit.start, end: hit.end } : null });
    });
  return items;
}

/**
 * 聚类（确定性纯函数）：不同线路的两条意见，原文区间重叠或相距 ≤ NOVEL_REVIEW_CLUSTER_GAP 字，
 * 且维度相同或属于相邻维度表，即视为同一处（传递合并）。同一线路的两条意见不直接相连。
 * 无法定位的意见不参与合并，留在各自线路的独有区。
 */
export function compareNovelReviews(original: string, lanes: readonly NovelReviewLaneResult[]): NovelReviewComparison {
  const items = locateNovelReviewItems(original, lanes);
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (!a.range || !b.range || a.lane === b.lane) continue;
      if (gapBetween(a.range, b.range) > NOVEL_REVIEW_CLUSTER_GAP) continue;
      if (!novelReviewDimensionsMergeable(a.issue.dimension, b.issue.dimension)) continue;
      const ra = find(i), rb = find(j);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  const groups = new Map<number, NovelReviewCompareItem[]>();
  items.forEach((item, i) => {
    if (!item.range) return;
    const root = find(i);
    groups.set(root, [...(groups.get(root) || []), item]);
  });
  const shared: NovelReviewCluster[] = [];
  const unique = Object.fromEntries(NOVEL_REVIEW_LANES.map(l => [l, [] as NovelReviewCompareItem[]])) as Record<
    NovelReviewLane,
    NovelReviewCompareItem[]
  >;
  for (const group of Array.from(groups.values())) {
    const lanesInGroup = Array.from(new Set(group.map(i => i.lane))).sort((a, b) => laneOrder(a) - laneOrder(b));
    if (lanesInGroup.length < 2) {
      for (const item of group) unique[item.lane].push(item);
      continue;
    }
    const start = Math.min(...group.map(i => i.range!.start));
    const end = Math.max(...group.map(i => i.range!.end));
    shared.push({ id: `at-${start}-${group[0].key}`, start, end, quote: original.slice(start, end), lanes: lanesInGroup, items: group });
  }
  shared.sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  for (const item of items) if (!item.range) unique[item.lane].push(item);
  for (const lane of NOVEL_REVIEW_LANES) unique[lane].sort((a, b) => a.index - b.index);
  return { shared, unique };
}

/** 默认勾选：共同指出的全勾（能定位的），独有的不勾。 */
export function defaultNovelReviewSelection(comparison: NovelReviewComparison) {
  return comparison.shared.flatMap(c => c.items.map(i => i.key));
}

export type NovelReviewScoreRow = {
  dimension: NovelReviewDimension;
  scores: Partial<Record<NovelReviewLane, number>>;
  spread: number;
  divergent: boolean;
};
/** 打分表：行 = 七个维度，列 = 各线路；分差 ≥ NOVEL_REVIEW_SCORE_SPREAD_ALERT 标「分歧大」。 */
export function novelReviewScoreTable(lanes: readonly NovelReviewLaneResult[]): NovelReviewScoreRow[] {
  const ordered = sortLanes(lanes);
  return NOVEL_REVIEW_DIMENSIONS.map(dimension => {
    const scores: Partial<Record<NovelReviewLane, number>> = {};
    for (const { lane, review } of ordered) scores[lane] = review.scores[dimension];
    const values = Object.values(scores) as number[];
    const spread = values.length ? Math.max(...values) - Math.min(...values) : 0;
    return { dimension, scores, spread, divergent: values.length >= 2 && spread >= NOVEL_REVIEW_SCORE_SPREAD_ALERT };
  });
}

/** 改稿清单条数限制与审稿结果一致（3–10 条）。 */
/** 站长 2026-11-12：下限 1 条，不硬凑意见。 */
export const NOVEL_REVIEW_OVERRIDE_MIN_ISSUES = 1;
export const NOVEL_REVIEW_OVERRIDE_MAX_ISSUES = 10;
const clip = (value: string, max: number) => {
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max - 1).join("") + "…";
};

/**
 * 勾选的意见 → 综合审稿结果（按所选意见改稿用）。
 * - 同一处（共同指出）合并成一条：问题与改法按线路逐条带上；
 * - scores 取「有意见被勾选的线路」逐维度最低分；
 * - verdict 由代码拼成固定文字 + 各线路结论；keep 取这些线路的保留亮点（去重）。
 * 结果不足 3 条或超过 10 条、或勾选了未能定位的意见时返回 { error }。
 */
export function buildNovelReviewOverride(
  original: string,
  lanes: readonly NovelReviewLaneResult[],
  selectedKeys: Iterable<string>
): { override: NovelReviewOverride; issueCount: number } | { error: string; issueCount: number } {
  const selected = new Set(selectedKeys);
  const comparison = compareNovelReviews(original, lanes);
  const groups: NovelReviewCompareItem[][] = [];
  for (const cluster of comparison.shared) {
    const picked = cluster.items.filter(i => selected.has(i.key));
    if (picked.length) groups.push(picked);
  }
  const uniques = NOVEL_REVIEW_LANES.flatMap(l => comparison.unique[l]).filter(i => selected.has(i.key));
  if (uniques.some(i => !i.range)) return { error: "未能定位原文的意见不能用于改稿", issueCount: 0 };
  for (const item of uniques) groups.push([item]);
  groups.sort((a, b) => Math.min(...a.map(i => i.range!.start)) - Math.min(...b.map(i => i.range!.start)));
  const issueCount = groups.length;
  if (issueCount < NOVEL_REVIEW_OVERRIDE_MIN_ISSUES)
    return { error: `至少选 ${NOVEL_REVIEW_OVERRIDE_MIN_ISSUES} 处意见（同一处合并计一条）`, issueCount };
  if (issueCount > NOVEL_REVIEW_OVERRIDE_MAX_ISSUES)
    return { error: `最多选 ${NOVEL_REVIEW_OVERRIDE_MAX_ISSUES} 处意见（同一处合并计一条）`, issueCount };
  const issues = groups.map(group => {
    const first = group[0];
    const label = (i: NovelReviewCompareItem) => novelReviewLaneLabel(i.lane);
    if (group.length === 1) return { dimension: first.issue.dimension, quote: first.issue.quote, problem: first.issue.problem, fix: first.issue.fix };
    return {
      dimension: first.issue.dimension,
      quote: first.issue.quote,
      problem: clip(group.map(i => `${label(i)}：${i.issue.problem}`).join("；"), 600),
      fix: clip(group.map(i => `${label(i)}：${i.issue.fix}`).join("；"), 800),
    };
  });
  const used = sortLanes(lanes).filter(l => [...groups.flat()].some(i => i.lane === l.lane));
  const scores = Object.fromEntries(
    NOVEL_REVIEW_DIMENSIONS.map(d => [d, Math.min(...used.map(l => l.review.scores[d]))])
  ) as NovelReview["scores"];
  const keep = Array.from(new Set(used.flatMap(l => l.review.keep))).slice(0, 10);
  const verdict = clip(
    `${used.length > 1 ? "综合多条线路的意见" : `只用${novelReviewLaneLabel(used[0].lane)}的意见`}。${used
      .map(l => `${novelReviewLaneLabel(l.lane)}：${l.review.verdict}`)
      .join("；")}`,
    300
  );
  return {
    override: { scores, issues, keep, verdict, sources: used.map(l => ({ requestId: l.requestId, lane: l.lane })) },
    issueCount,
  };
}

/** 「只用这条线路的意见改稿」：等价于只勾该线路全部能定位的意见。 */
export function novelReviewLaneSelection(original: string, lanes: readonly NovelReviewLaneResult[], lane: NovelReviewLane) {
  return locateNovelReviewItems(original, lanes)
    .filter(i => i.lane === lane && i.range)
    .map(i => i.key);
}
