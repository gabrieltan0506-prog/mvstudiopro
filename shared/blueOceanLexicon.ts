/**
 * 将 Stage1 platformMenu / 趋势报表 / trendStore 标签扁平化为 Stage2「推演文案」可用的蓝海词词表。
 */

export type BlueOceanGroupedEntry = {
  platform?: string;
  primary: string;
  secondary: string[];
};

export type BlueOceanLexicon = {
  /** 去重后的扁平词（一级 + 二级 + 标签种子），供文案自然嵌入 */
  flat: string[];
  /** 分级结构，便于模型按平台选用 */
  grouped: BlueOceanGroupedEntry[];
  /** 来自 trendStore 高互动样本 tags 的候选（作二级词种子，非强行凑数） */
  tagCandidates: string[];
};

function clipWord(raw: unknown, max = 24): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function pushUnique(list: string[], word: string, max: number): void {
  const w = clipWord(word);
  if (!w || list.includes(w) || list.length >= max) return;
  list.push(w);
}

/**
 * 将模型乱七八糟的蓝海字段收成数组：
 * - 已是数组 → 原样
 * - 字符串 → 按顿号/逗号拆
 * - `{ words|items|list|蓝海词: [...] }` 或「平台 → 数组」对象 → flatten
 */
export function coerceBlueOceanRaw(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    return raw
      .split(/[,，、;；\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  for (const key of ["words", "items", "list", "entries", "blueOceanWords", "蓝海词", "data"]) {
    if (Array.isArray(o[key])) return o[key] as unknown[];
  }
  const nested = Object.values(o).filter(Array.isArray) as unknown[][];
  if (nested.length > 0) return nested.flat();
  return [];
}

/** 长句热词压成可检索短标签（取冒号/破折号前段） */
export function shortBlueOceanLabel(raw: unknown, max = 18): string {
  const s = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  const head = s.split(/[：:|｜·•—–\-]|(?:\s+——\s+)/)[0]?.trim() || s;
  return clipWord(head, max);
}

/** 兼容 string[] 与 { primary, secondary[] }[]（含一级/二级中文键） */
export function normalizeBlueOceanEntries(
  raw: unknown,
  platform?: string,
): BlueOceanGroupedEntry[] {
  const list = coerceBlueOceanRaw(raw);
  const out: BlueOceanGroupedEntry[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      const primary = shortBlueOceanLabel(item) || clipWord(item);
      if (primary && !/尚未检索|尚未檢索|找不到|无可用|暂无/.test(primary)) {
        out.push({ platform, primary, secondary: [] });
      }
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const primary = clipWord(
      o.primary ?? o.word ?? o.label ?? o.name ?? o["一级"] ?? o["一级词"] ?? o["一级蓝海词"] ?? o.parent,
    );
    if (!primary || /尚未检索|尚未檢索|找不到|无可用|暂无/.test(primary)) continue;
    const secondaryRaw = o.secondary ?? o.children ?? o.subs ?? o.tags ?? o["二级"] ?? o["二级词"];
    const secondary = Array.isArray(secondaryRaw)
      ? secondaryRaw.map((s) => shortBlueOceanLabel(s) || clipWord(s)).filter(Boolean).slice(0, 8)
      : [];
    out.push({ platform, primary, secondary });
  }
  return out;
}

/**
 * 趋势 PNG / 报表：LLM 漏出或空数组时，用赛道 / 热词 / 样本标题 / 行业 key 兜底，
 * 避免「蓝海词」整栏空白。
 */
export function buildEvidenceBlueOceanFallback(opts: {
  trackGrowth?: Array<{ name?: string } | null> | null;
  platformDetails?: Array<{
    hotTopics?: string[] | null;
    blueOceanWords?: unknown;
  } | null> | null;
  industryKeys?: string[] | null;
  evidenceTitles?: string[] | null;
  topicHints?: string[] | null;
  maxGroups?: number;
}): BlueOceanGroupedEntry[] {
  const maxGroups = opts.maxGroups ?? 6;
  const out: BlueOceanGroupedEntry[] = [];
  const seen = new Set<string>();
  const push = (primaryRaw: unknown, secondary: string[] = []) => {
    const primary = shortBlueOceanLabel(primaryRaw) || clipWord(primaryRaw);
    if (!primary || primary.length < 2 || seen.has(primary) || out.length >= maxGroups) return;
    if (/尚未检索|尚未檢索|找不到|无可用|暂无|N\/A/i.test(primary)) return;
    seen.add(primary);
    out.push({
      primary,
      secondary: secondary
        .map((s) => shortBlueOceanLabel(s) || clipWord(s))
        .filter((s) => s && s !== primary)
        .slice(0, 6),
    });
  };

  for (const row of opts.platformDetails || []) {
    for (const bow of normalizeBlueOceanEntries(row?.blueOceanWords)) {
      push(bow.primary, bow.secondary);
    }
  }
  for (const t of opts.trackGrowth || []) {
    if (t?.name) push(t.name);
  }
  for (const key of opts.industryKeys || []) push(key);
  for (const row of opts.platformDetails || []) {
    for (const topic of row?.hotTopics || []) push(topic);
  }
  for (const title of opts.evidenceTitles || []) push(title);
  for (const hint of opts.topicHints || []) push(hint);
  return out;
}

/**
 * 从 trendStore 样本 tags / 标题碎片提取蓝海候选种子（数据驱动，不强行凑满）。
 */
export function deriveTagCandidatesFromTrendSamples(
  samples: Array<{ tags?: unknown[]; title?: unknown } | null | undefined>,
  max = 16,
): string[] {
  const out: string[] = [];
  for (const s of samples) {
    if (!s) continue;
    if (Array.isArray(s.tags)) {
      for (const t of s.tags) pushUnique(out, String(t), max);
    }
    const title = clipWord(s.title, 40);
    // 标题里常见「｜」「·」分隔的短标签
    if (title) {
      for (const part of title.split(/[｜|·•、/／]+/)) {
        const p = clipWord(part, 12);
        if (p.length >= 2 && p.length <= 10) pushUnique(out, p, max);
      }
    }
    if (out.length >= max) break;
  }
  return out;
}

export function buildBlueOceanLexicon(input: {
  platformMenu?: unknown;
  globalBlueOceanWords?: unknown;
  tagCandidates?: string[];
  maxFlat?: number;
}): BlueOceanLexicon {
  const maxFlat = input.maxFlat ?? 28;
  const grouped: BlueOceanGroupedEntry[] = [];

  if (Array.isArray(input.platformMenu)) {
    for (const row of input.platformMenu) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const platform = clipWord(o.platform ?? o.displayName ?? o.label, 40) || undefined;
      const words = o.blueOceanWords ?? o.blue_ocean_words ?? o["蓝海词"];
      grouped.push(...normalizeBlueOceanEntries(words, platform));
    }
  }

  grouped.push(...normalizeBlueOceanEntries(input.globalBlueOceanWords));

  const tagCandidates = (input.tagCandidates || [])
    .map((t) => clipWord(t))
    .filter(Boolean)
    .slice(0, 16);

  const flat: string[] = [];
  for (const g of grouped) {
    pushUnique(flat, g.primary, maxFlat);
    for (const s of g.secondary) pushUnique(flat, s, maxFlat);
  }
  for (const t of tagCandidates) pushUnique(flat, t, maxFlat);

  return { flat, grouped: grouped.slice(0, 24), tagCandidates };
}

/** 写入 Stage2 / 决策智库 prompt 的简短策略说明 */
export const BLUE_OCEAN_USAGE_POLICY = [
  "须读取 blueOceanLexicon（flat / grouped）与 platformMenu[].blueOceanWords。",
  "每条 contentBlueprint 须在 copywriting、detailedScript、publishingAdvice 中自然嵌入 1–3 个蓝海词（优先一级词；维度 6 长尾常青优先覆盖 secondary / tagCandidates）。",
  "highlightKeywords 须列出本条实际使用的蓝海/高亮词（2–6 个），禁止堆砌无关 hashtag。",
  "词表来自看板与 trendStore 标签推演；无法确认的词不强行凑数。",
].join("");
