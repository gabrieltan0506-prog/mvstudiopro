/**
 * 小说正文「AI 腔」确定性检测（站长 2026-11-11：蒸馏出来的写作规则一律代码化，不放文档）。
 * 规则是数据（正则 + 标签 + 级别），检测是纯函数：同一段文字永远得到同一批命中，不调用模型。
 * 命中只表示「这里要复核」，不是「出现即错」；blocking 是成套话句式，advisory 是高频虚词。
 */
export type NovelProseLintSeverity = "blocking" | "advisory";
export type NovelProseLintRule = { id: string; label: string; severity: NovelProseLintSeverity; pattern: RegExp };
export type NovelProseLintHit = { ruleId: string; label: string; severity: NovelProseLintSeverity; index: number; match: string };

const rule = (id: string, label: string, severity: NovelProseLintSeverity, source: string): NovelProseLintRule =>
  ({ id, label, severity, pattern: new RegExp(source, "g") });

/** 套话句式：成句的 AI 腔，命中即应改写整句。 */
export const NOVEL_PROSE_BLOCKING_RULES: readonly NovelProseLintRule[] = [
  rule("not_but", "不是A，而是B", "blocking", "不是[^。！？\\n]{1,24}[，,]\\s*而是"),
  rule("not_nor_just", "不是A，也不是B，只是C", "blocking", "不是[^。！？\\n]{1,20}[，,]\\s*也不是[^。！？\\n]{1,20}[，,]\\s*(?:只是|而是)"),
  rule("finally_understood", "他终于明白 / 这才意识到", "blocking", "(?:终于明白|这才意识到|这才明白|忽然意识到)"),
  rule("author_foretell", "他不知道的是 / 殊不知", "blocking", "(?:不知道的是|殊不知|却不知[，,])"),
  rule("fate_cliche", "命运 / 棋局套话", "blocking", "(?:冥冥之中|命运的齿轮|早已布好的棋局|注定无人入眠|才刚刚开始)"),
  rule("explain_cause", "这意味着 / 之所以…是因为", "blocking", "(?:这意味着|之所以[^。！？\\n]{1,30}是因为)"),
  rule("voice_contrast", "声音不大，却…", "blocking", "声音不[大高][，,]\\s*却"),
  rule("replaced_by", "取而代之的是", "blocking", "取而代之的是"),
  rule("negation_parade", "没有A，没有B 排比", "blocking", "没有[^，。！？\\n]{1,10}[，,]\\s*没有[^，。！？\\n]{1,10}[，,。]"),
  rule("a_trace_of", "带着一丝… / 闪过一抹…", "blocking", "(?:带着|闪过|掠过|划过|泛起)一[丝抹缕]"),
];

/** 高频虚词与套语：单次出现只提示，密度高才需要处理。 */
export const NOVEL_PROSE_ADVISORY_WORDS: readonly string[] = [
  "仿佛", "宛若", "宛如", "一丝", "一抹", "微微", "淡淡", "缓缓", "深吸一口气", "不禁", "眼中闪过", "嘴角勾起",
  "瞳孔微缩", "瞳孔骤缩", "指节泛白", "心中一凛", "心下了然", "映入眼帘", "只见", "此时此刻", "不由自主", "目光如炬",
  "沉声道", "平静无波", "意义深远", "由此可见", "与此同时", "不知为何", "似乎",
];
export const NOVEL_PROSE_ADVISORY_RULES: readonly NovelProseLintRule[] = NOVEL_PROSE_ADVISORY_WORDS.map((word, i) =>
  rule(`word_${i}`, word, "advisory", word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

export const NOVEL_PROSE_LINT_RULES: readonly NovelProseLintRule[] = [...NOVEL_PROSE_BLOCKING_RULES, ...NOVEL_PROSE_ADVISORY_RULES];

/** 高频虚词每千字超过这个数才算超标（单次出现不算问题）。 */
export const NOVEL_PROSE_ADVISORY_PER_THOUSAND_LIMIT = 3;

export function lintNovelProse(text: string, rules: readonly NovelProseLintRule[] = NOVEL_PROSE_LINT_RULES): NovelProseLintHit[] {
  const hits: NovelProseLintHit[] = [];
  for (const r of rules) {
    const pattern = new RegExp(r.pattern.source, "g");
    for (const m of Array.from(text.matchAll(pattern))) {
      hits.push({ ruleId: r.id, label: r.label, severity: r.severity, index: m.index ?? 0, match: m[0].slice(0, 40) });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

export type NovelProseLintSummary = {
  chars: number;
  blocking: number;
  advisory: number;
  /** 高频虚词每千字命中数（保留一位小数）。 */
  advisoryPerThousand: number;
  advisoryOverLimit: boolean;
  /** 套话句式的前几处命中，供界面定位。 */
  samples: Array<{ label: string; match: string }>;
};

export function summarizeNovelProseLint(text: string): NovelProseLintSummary {
  const hits = lintNovelProse(text);
  const chars = text.replace(/\s/g, "").length;
  const blocking = hits.filter(h => h.severity === "blocking");
  const advisory = hits.length - blocking.length;
  const perThousand = chars ? Math.round((advisory / chars) * 10000) / 10 : 0;
  return {
    chars,
    blocking: blocking.length,
    advisory,
    advisoryPerThousand: perThousand,
    advisoryOverLimit: perThousand > NOVEL_PROSE_ADVISORY_PER_THOUSAND_LIMIT,
    samples: blocking.slice(0, 5).map(h => ({ label: h.label, match: h.match })),
  };
}
