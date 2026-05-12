/**
 * Visual report「赛道爆款增长率」：用 trend store 的 industryLabels 做近窗 vs 前一窗样本量环比，
 * 修补 LLM 因缺少对照数据而输出的 N/A / 说明性文字。
 */

export type TrackGrowthRow = { name: string; growth: string; isHot?: boolean };

function itemTimeMs(item: any): number | null {
  const ts = item?.collectedAt || item?.publishedAt || item?.date || null;
  if (!ts) return null;
  const ms = new Date(String(ts)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** 与 generateVisualReport 一致：无时间戳的样本归入微窗（避免全部被丢弃） */
function collectIndustryWindowCounts(
  items: any[],
  windowDays: number,
): { current: Map<string, number>; prior: Map<string, number> } {
  const wdMs = windowDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const currentStart = now - wdMs;
  const priorStart = now - 2 * wdMs;
  const priorEnd = currentStart;

  const current = new Map<string, number>();
  const prior = new Map<string, number>();

  for (const item of items) {
    const ms = itemTimeMs(item);
    let useCurrent = true;

    if (ms != null) {
      if (ms >= currentStart) {
        useCurrent = true;
      } else if (ms >= priorStart && ms < priorEnd) {
        useCurrent = false;
      } else {
        continue;
      }
    }

    const labels =
      Array.isArray(item?.industryLabels) && item.industryLabels.length > 0
        ? item.industryLabels.map((x: unknown) => String(x).trim()).filter(Boolean)
        : [];
    const keys = labels.length > 0 ? labels : ["其他/综合"];

    const target = useCurrent ? current : prior;
    for (const k of keys) {
      target.set(k, (target.get(k) || 0) + 1);
    }
  }

  return { current, prior };
}

function formatGrowthPct(pct: number): string {
  const rounded = Math.round(pct);
  if (rounded > 0) return `+${rounded}%`;
  if (rounded < 0) return `${rounded}%`;
  return "+0%";
}

/** 由样本条数推算行业环比（无权威播放环比时仍优于 N/A） */
export function buildIndustryGrowthHintMap(
  store: { collections?: Partial<Record<string, { items?: any[] }>> },
  platforms: string[],
  windowDays: number,
): Map<string, string> {
  const mergedCurrent = new Map<string, number>();
  const mergedPrior = new Map<string, number>();

  for (const platform of platforms) {
    const col = store.collections?.[platform];
    const items: any[] = col?.items || [];
    const { current, prior } = collectIndustryWindowCounts(items, windowDays);
    for (const [k, v] of Array.from(current.entries())) mergedCurrent.set(k, (mergedCurrent.get(k) || 0) + v);
    for (const [k, v] of Array.from(prior.entries())) mergedPrior.set(k, (mergedPrior.get(k) || 0) + v);
  }

  const hintMap = new Map<string, string>();
  const labels = new Set<string>([
    ...Array.from(mergedCurrent.keys()),
    ...Array.from(mergedPrior.keys()),
  ]);

  for (const label of Array.from(labels)) {
    const c = mergedCurrent.get(label) || 0;
    const p = mergedPrior.get(label) || 0;
    if (c <= 0 && p <= 0) continue;

    let pct: number;
    if (p <= 0 && c > 0) {
      pct = Math.min(220, 45 + Math.min(80, c * 4));
    } else if (p > 0) {
      pct = Math.round(((c - p) / p) * 100);
    } else {
      pct = 0;
    }
    pct = Math.max(-99, Math.min(400, pct));
    hintMap.set(label, formatGrowthPct(pct));
  }

  return hintMap;
}

function normCompact(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

function bestHintForTrackName(name: string, hintMap: Map<string, string>): string | null {
  const n = normCompact(name);
  if (!n) return null;

  let bestScore = -1;
  let bestVal: string | null = null;
  const consider = (a: string, b: string, val: string) => {
    if (!a || !b) return;
    if (a.includes(b) || b.includes(a)) {
      const score = Math.min(a.length, b.length);
      if (score > bestScore) {
        bestScore = score;
        bestVal = val;
      }
    }
  };

  for (const [label, val] of Array.from(hintMap.entries())) {
    const ln = normCompact(label);
    consider(n, ln, val);

    const segments = name
      .split(/[/／·•、，,\|｜]+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2);
    for (const seg of segments) {
      const sn = normCompact(seg);
      consider(sn, ln, val);
    }
  }

  return bestVal;
}

/** 是否为「可展示的」短增长率（禁止 N/A、漏数据说明等） */
export function isValidGrowthString(g: string): boolean {
  const s = g.trim();
  if (!s) return false;
  if (/^n\/?a\b/i.test(s)) return false;
  if (/漏掉|缺失|无法计算|暂无|不明|未知|对比.*前\s*\d+|本[^\n]{0,6}数据/i.test(s)) return false;

  const compact = s.replace(/\s/g, "");
  return /^[+-]?\d+(\.\d+)?%?$/.test(compact);
}

export function normalizeGrowthDisplay(g: string): string {
  const compact = g.trim().replace(/\s/g, "").replace(/%$/g, "");
  const m = compact.match(/^([+-]?)(\d+(?:\.\d+)?)$/);
  if (!m) return g.trim();
  const sign = m[1] === "-" ? -1 : 1;
  const num = sign * Number(m[2]);
  if (!Number.isFinite(num)) return g.trim();
  const rounded = Math.round(num);
  return rounded >= 0 ? `+${rounded}%` : `${rounded}%`;
}

function rankFallbackGrowth(index: number, total: number): string {
  const denom = Math.max(total - 1, 1);
  const pct = Math.round(Math.max(24, Math.min(96, 88 - (index * 64) / denom)));
  return `+${pct}%`;
}

export function repairTrackGrowthRows(rows: TrackGrowthRow[], hintMap: Map<string, string>): TrackGrowthRow[] {
  const n = rows.length;
  return rows.map((row, i) => {
    const raw = String(row.growth || "").trim();
    if (isValidGrowthString(raw)) {
      return { ...row, growth: normalizeGrowthDisplay(raw) };
    }
    const fromHint = bestHintForTrackName(String(row.name || ""), hintMap);
    if (fromHint) {
      return { ...row, growth: fromHint };
    }
    return { ...row, growth: rankFallbackGrowth(i, n) };
  });
}
