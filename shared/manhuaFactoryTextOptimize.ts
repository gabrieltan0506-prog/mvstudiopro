/**
 * 漫剧工厂 bible / beats 文案优化：
 * - 自动侦测长度：超过单次软上限则拆成 2、3、4…N 次请求，再拼接成稿
 * - 不截断丢弃原文；用户无需手动拆剧本
 * - 单次请求仍受 API sourceText 上限约束（见 CHUNK_HARD / routers）
 */

/** 单次 optimizeCustomCopy 请求的安全上限（与 routers max 对齐，分片后每段须低于此） */
export const MANHUA_FACTORY_OPTIMIZE_SOURCE_MAX = 32_000;
/** 单次请求目标软上限：超过则继续拆下一段 */
export const MANHUA_FACTORY_OPTIMIZE_CHUNK_SOFT = 16_000;
/** 拆分时允许的单段硬上限（给段落边界一点余量） */
export const MANHUA_FACTORY_OPTIMIZE_CHUNK_HARD = 18_000;
/** 自动分段次数上限（防极端超长拖垮额度；约 16k×本值） */
export const MANHUA_FACTORY_OPTIMIZE_MAX_PARTS = 12;

export function isManhuaBibleOrBeatsBlockId(blockId: string): boolean {
  const id = String(blockId || "");
  return id.startsWith("bible-") || id.startsWith("beats-");
}

/** 在软上限附近按段落/换行切开，避免硬切半句；绝不丢字；可产出任意多段 */
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
  /** 极端过长（超过自动分段上限）时的说明；调用方应报错，勿静默截断 */
  overLimitZh: string | null;
};

export function planManhuaFactoryOptimizeSource(sourceText: string): ManhuaFactoryOptimizePlan {
  const text = String(sourceText || "");
  const chunks = splitManhuaFactoryOptimizeSource(text);
  if (chunks.length > MANHUA_FACTORY_OPTIMIZE_MAX_PARTS) {
    const approx = MANHUA_FACTORY_OPTIMIZE_CHUNK_SOFT * MANHUA_FACTORY_OPTIMIZE_MAX_PARTS;
    return {
      split: true,
      chunks,
      overLimitZh: `设定圣经/节拍文案过长（约 ${text.length} 字），已超出自动分段上限（最多 ${MANHUA_FACTORY_OPTIMIZE_MAX_PARTS} 次、约 ${approx} 字）。请分集后再生成，系统不会截断内容。`,
    };
  }
  return {
    split: chunks.length > 1,
    chunks: chunks.length ? chunks : [text],
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
      `【分段生成 1/${n}】本段只处理原文第 1 段；输出完整可用的 Markdown 第 1 段成稿，勿写「未完待续」以外的省略说明。`,
    ].join("\n");
  }
  const isLast = i >= n;
  return [
    base,
    isLast
      ? `【分段生成 ${i}/${n}】承接上一段成稿，处理原文最后一段；输出应能与上一段无缝衔接的 Markdown，不要重复上一段已写完的大段内容。`
      : `【分段生成 ${i}/${n}】承接上一段成稿，只处理原文第 ${i} 段；输出应能与上一段无缝衔接的 Markdown，不要重复上一段已写完的大段内容。`,
    prev
      ? `【上一段成稿尾部（供衔接，勿整段照抄）】\n${prev.slice(-3500)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
