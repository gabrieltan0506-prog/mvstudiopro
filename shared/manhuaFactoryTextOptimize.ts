/**
 * 漫剧工厂 bible / beats 文案优化：
 * - 总输入上限 32000（不截断丢弃）
 * - 超过约 16000 时拆成两次请求（每段约 16–18k），再拼接成稿
 */

/** optimizeCustomCopy 对漫剧 bible/beats 放宽后的上限 */
export const MANHUA_FACTORY_OPTIMIZE_SOURCE_MAX = 32_000;
/** 单次请求目标上限：超过则拆两次 */
export const MANHUA_FACTORY_OPTIMIZE_CHUNK_SOFT = 16_000;
/** 拆分时允许的单段上限（给段落边界一点余量） */
export const MANHUA_FACTORY_OPTIMIZE_CHUNK_HARD = 18_000;

export function isManhuaBibleOrBeatsBlockId(blockId: string): boolean {
  const id = String(blockId || "");
  return id.startsWith("bible-") || id.startsWith("beats-");
}

/** 在软上限附近按段落/换行切开，避免硬切半句；绝不丢字 */
export function splitManhuaFactoryOptimizeSource(
  sourceText: string,
  opts?: { softMax?: number; hardMax?: number },
): string[] {
  const text = String(sourceText || "");
  if (!text) return [];
  const soft = Math.max(1000, opts?.softMax ?? MANHUA_FACTORY_OPTIMIZE_CHUNK_SOFT);
  const hard = Math.max(soft, opts?.hardMax ?? MANHUA_FACTORY_OPTIMIZE_CHUNK_HARD);
  if (text.length <= soft) return [text];

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > soft) {
    const window = rest.slice(0, hard);
    let cut = -1;
    const para = window.lastIndexOf("\n\n");
    if (para >= soft * 0.55) cut = para + 2;
    if (cut < 0) {
      const line = window.lastIndexOf("\n");
      if (line >= soft * 0.55) cut = line + 1;
    }
    if (cut < 0) {
      const sentence = Math.max(
        window.lastIndexOf("。"),
        window.lastIndexOf("！"),
        window.lastIndexOf("？"),
        window.lastIndexOf("."),
      );
      if (sentence >= soft * 0.55) cut = sentence + 1;
    }
    if (cut < soft * 0.4) cut = soft;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export type ManhuaFactoryOptimizePlan = {
  /** 是否拆成多次 */
  split: boolean;
  chunks: string[];
  /** 超过产品总上限时的说明（调用方应报错，勿静默截断） */
  overLimitZh: string | null;
};

export function planManhuaFactoryOptimizeSource(sourceText: string): ManhuaFactoryOptimizePlan {
  const text = String(sourceText || "");
  if (text.length > MANHUA_FACTORY_OPTIMIZE_SOURCE_MAX) {
    return {
      split: false,
      chunks: [text],
      overLimitZh: `设定圣经/节拍文案过长（${text.length} 字，上限 ${MANHUA_FACTORY_OPTIMIZE_SOURCE_MAX}）。请缩短剧本或分集后再生成，系统不会截断内容。`,
    };
  }
  const chunks = splitManhuaFactoryOptimizeSource(text);
  return {
    split: chunks.length > 1,
    chunks,
    overLimitZh: null,
  };
}

export function buildManhuaFactoryOptimizeBrief(input: {
  baseBrief: string;
  partIndex: number;
  partTotal: number;
  previousMarkdown?: string;
}): string {
  const base = String(input.baseBrief || "").trim();
  const i = Math.max(1, Math.floor(input.partIndex));
  const n = Math.max(1, Math.floor(input.partTotal));
  if (n <= 1) return base;
  const prev = String(input.previousMarkdown || "").trim();
  if (i === 1) {
    return [
      base,
      `【分段生成 1/${n}】本段只处理原文前半；输出完整可用的 Markdown 前半稿，勿写「未完待续」以外的省略说明。`,
    ].join("\n");
  }
  return [
    base,
    `【分段生成 ${i}/${n}】承接上一段成稿，只处理原文剩余部分；输出应能与上一段无缝衔接的后半 Markdown，不要重复上一段已写完的大段内容。`,
    prev
      ? `【上一段成稿尾部（供衔接，勿整段照抄）】\n${prev.slice(-3500)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
