/**
 * Visual report「赛道爆款增长率」：用 trend store 的 industryLabels 做近窗 vs 前一窗样本量环比；
 * 修补 LLM 输出，并避免「前窗为 0 时」多条行业同时顶到同一假峰值（旧版常见全为 +125%）。
 */

export type TrackGrowthRow = { name: string; growth: string; isHot?: boolean };

function itemTimeMs(item: any): number | null {
  const ts = item?.collectedAt || item?.publishedAt || item?.date || null;
  if (!ts) return null;
  const ms = new Date(String(ts)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** 与 generateVisualReport 一致：无时间戳的样本归在近窗（避免全部被丢弃） */
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

/**
 * 由样本条数推算行业「增长率」展示值：
 * - 前窗 p>0：真实样本环比 (c-p)/p*100
 * - 前窗 p=0 且当窗 c>0（多条）：按 **当窗样本条数 c** 降序（tie 按 label），映射为 **递减** 的 +12%～+98% 刻度，避免旧版「45+min(80,c*4)」在 c≥20 时全员 +125%
 * - 仅一条且 p=0：用 c/maxC 映射到 ~10%～98%（maxC 为全表最大当窗条数）
 */
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

  const labels = new Set<string>([
    ...Array.from(mergedCurrent.keys()),
    ...Array.from(mergedPrior.keys()),
  ]);

  type Row = { label: string; c: number; p: number };
  const rows: Row[] = [];
  for (const label of Array.from(labels)) {
    const c = mergedCurrent.get(label) || 0;
    const p = mergedPrior.get(label) || 0;
    if (c <= 0 && p <= 0) continue;
    rows.push({ label, c, p });
  }

  const maxC = Math.max(...rows.map((r) => r.c), 0);

  const hintMap = new Map<string, string>();

  for (const { label, c, p } of rows) {
    if (p <= 0) continue;
    let pct = Math.round(((c - p) / p) * 100);
    pct = Math.max(-99, Math.min(400, pct));
    hintMap.set(label, formatGrowthPct(pct));
  }

  const zeroPrior = rows.filter((r) => r.p <= 0 && r.c > 0);
  zeroPrior.sort((a, b) => b.c - a.c || a.label.localeCompare(b.label, "zh-Hans-CN"));

  if (zeroPrior.length === 1) {
    const { label, c } = zeroPrior[0];
    let pct =
      maxC > 0 ? Math.round(10 + 88 * (c / maxC)) : 88;
    pct = Math.max(-99, Math.min(400, pct));
    hintMap.set(label, formatGrowthPct(pct));
  } else if (zeroPrior.length > 1) {
    const m = zeroPrior.length;
    for (let i = 0; i < m; i++) {
      const pct = Math.round(12 + 86 * ((m - 1 - i) / Math.max(m - 1, 1)));
      const clamped = Math.max(-99, Math.min(400, pct));
      hintMap.set(zeroPrior[i].label, formatGrowthPct(clamped));
    }
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
  const firstPass = rows.map((row, i) => {
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

  if (n <= 1) return firstPass;

  const growths = firstPass.map((r) => r.growth);
  const allSame = growths.every((g) => g === growths[0]);

  if (!allSame) return firstPass;

  let second = firstPass.map((row, i) => {
    const fromHint = bestHintForTrackName(String(row.name || ""), hintMap);
    if (fromHint) {
      return { ...row, growth: fromHint };
    }
    return { ...row, growth: rankFallbackGrowth(i, n) };
  });

  const g2 = second.map((r) => r.growth);
  if (new Set(g2).size === g2.length) return second;

  return second.map((row, i) => ({ ...row, growth: rankFallbackGrowth(i, n) }));
}
