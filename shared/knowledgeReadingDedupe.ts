import { knowledgeReadingMarkdown, type KnowledgeReading, type KnowledgeReadingBlock } from "./knowledgePublicationLayout";

/**
 * 篇幅压缩第一段：确定性去重（零模型调用，2026-11-09 用户令）。
 * 只删整句/整行/整项/整条图注，不截断句子、不删本页图中没有的事实：
 * - 与本页图中文字重复的句子、表格行、清单项、图注（图就在同页上方，读者仍能看到）；
 * - 本页内重复出现的句子、重复的图注、与页标题重复的副标题、相邻同名小节合并（去掉重复小标题）；
 * - 与前页内文完全相同的段落（跨页重复）；
 * - 连续重复标点与多余空白。
 * 受内文合同最小数量约束（表格≥1行、时序≥2项、卡片≥1项、至少1节），会违反约束的删除不做。
 */
export type KnowledgeDedupeRemoval = { kind: "image_sentence" | "page_duplicate_sentence" | "cross_page_paragraph" | "image_table_row" | "image_item" | "duplicate_note" | "duplicate_subtitle" | "merged_heading" | "punctuation"; text: string };

// 去掉空白、中英文标点与 Markdown 符号后比较（目标为 es5，不用 \p{} 属性类）。
const norm = (value: string) => value.replace(/[\s，。、；：？！“”‘’（）《》〈〉【】「」『』—…·～,.;:?!"'()[\]{}<>\-_*#|`~+=\/\\%&@^$]/g, "");
const MIN_SENTENCE = 8;
const MIN_PARAGRAPH = 20;

function splitSentences(paragraph: string) {
  return paragraph.match(/[^。！？!?；;]+(?:[。！？!?；;]+[”’」』）)]*)?|[。！？!?；;]+/g) || [];
}
const tidy = (value: string, removed: KnowledgeDedupeRemoval[]) => {
  const next = value.replace(/([。！？!?；;，,、：:])\1+/g, "$1").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (norm(next) !== norm(value) || next.length < value.length - 2) removed.push({ kind: "punctuation", text: `${value.length - next.length}` });
  return next;
};

type Context = { image: string; seenSentences: Set<string>; priorParagraphs: Set<string>; removed: KnowledgeDedupeRemoval[] };

function cleanProse(text: string, ctx: Context) {
  const paragraphs = text.split(/\n{2,}/);
  const kept: string[] = [];
  for (const paragraph of paragraphs) {
    const key = norm(paragraph);
    if (key.length >= MIN_PARAGRAPH && ctx.priorParagraphs.has(key)) { ctx.removed.push({ kind: "cross_page_paragraph", text: paragraph }); continue; }
    // 表格/标题/引用行原样保留，只处理正文句子。
    if (/^\s*(\||#|>)/.test(paragraph)) { kept.push(paragraph); continue; }
    const lines = paragraph.split("\n").map(line => {
      const out: string[] = [];
      for (const sentence of splitSentences(line)) {
        const k = norm(sentence);
        if (k.length >= MIN_SENTENCE && ctx.image.includes(k)) { ctx.removed.push({ kind: "image_sentence", text: sentence }); continue; }
        if (k.length >= MIN_SENTENCE && ctx.seenSentences.has(k)) { ctx.removed.push({ kind: "page_duplicate_sentence", text: sentence }); continue; }
        if (k.length >= MIN_SENTENCE) ctx.seenSentences.add(k);
        out.push(sentence);
      }
      return out.join("");
    }).filter(line => line.trim());
    if (lines.length) kept.push(lines.join("\n"));
  }
  return tidy(kept.join("\n\n"), ctx.removed);
}

const inImage = (ctx: Context, ...parts: string[]) => { const k = norm(parts.join("")); return k.length >= MIN_SENTENCE && ctx.image.includes(k); };

function cleanBlock(block: KnowledgeReadingBlock, ctx: Context, notes: Set<string>): KnowledgeReadingBlock | null {
  let note = block.note || "";
  const noteKey = norm(note);
  if (noteKey && (notes.has(noteKey) || inImage(ctx, note))) { ctx.removed.push({ kind: "duplicate_note", text: note }); note = ""; }
  else if (noteKey) notes.add(noteKey);
  if (block.type === "prose") {
    const text = cleanProse(block.text, ctx);
    return text ? { ...block, note, text } : null;
  }
  if (block.type === "table") {
    const rows = block.rows.filter(row => !inImage(ctx, ...row) || (ctx.removed.push({ kind: "image_table_row", text: row.join(" | ") }), false));
    if (!rows.length) { ctx.removed.splice(ctx.removed.length - block.rows.length, block.rows.length); return { ...block, note }; }
    return { ...block, note, rows };
  }
  const min = block.type === "sequence" ? 2 : 1;
  const items = block.items.filter(item => !inImage(ctx, item.title, item.body) || (ctx.removed.push({ kind: "image_item", text: `${item.title}：${item.body}` }), false));
  if (items.length < min) { ctx.removed.splice(ctx.removed.length - (block.items.length - items.length), block.items.length - items.length); return { ...block, note }; }
  return { ...block, note, items } as KnowledgeReadingBlock;
}

export function dedupeKnowledgeReading(params: { headline: string; reading: KnowledgeReading; imageText: string; priorParagraphs?: Set<string> }) {
  const removed: KnowledgeDedupeRemoval[] = [];
  const ctx: Context = { image: norm(params.imageText || ""), seenSentences: new Set(), priorParagraphs: params.priorParagraphs || new Set(), removed };
  const notes = new Set<string>();
  let subtitle = params.reading.subtitle;
  if (subtitle && (norm(subtitle) === norm(params.headline) || inImage(ctx, subtitle) || params.reading.blocks.some(b => norm(b.title) === norm(subtitle)))) { removed.push({ kind: "duplicate_subtitle", text: subtitle }); subtitle = ""; }
  const blocks: KnowledgeReadingBlock[] = [];
  for (const block of params.reading.blocks) {
    const cleaned = cleanBlock(block, ctx, notes);
    if (!cleaned) continue;
    const last = blocks.at(-1);
    // 相邻同名正文小节合并：去掉重复小标题，正文原样拼接。
    if (last && last.type === "prose" && cleaned.type === "prose" && norm(last.title) === norm(cleaned.title)) {
      removed.push({ kind: "merged_heading", text: cleaned.title });
      blocks[blocks.length - 1] = { ...last, text: `${last.text}\n\n${cleaned.text}`, note: [last.note, cleaned.note].filter(Boolean).join(" ") };
      continue;
    }
    blocks.push(cleaned);
  }
  const reading: KnowledgeReading = blocks.length ? { ...params.reading, subtitle, blocks } : params.reading;
  return { reading, removed: blocks.length ? removed : [] };
}

/** 正文 body 同步做句级去重（与 reading 一致的规则），不改结构。 */
export function dedupeKnowledgeBody(body: string, imageText: string, priorParagraphs?: Set<string>) {
  const removed: KnowledgeDedupeRemoval[] = [];
  const text = cleanProse(body, { image: norm(imageText || ""), seenSentences: new Set(), priorParagraphs: priorParagraphs || new Set(), removed });
  return { body: text || body, removed: text ? removed : [] };
}

/** 页内段落指纹（供后页做跨页重复判断）。 */
export function knowledgeReadingParagraphKeys(reading: KnowledgeReading | undefined, body: string) {
  const text = reading ? knowledgeReadingMarkdown(reading) : body;
  return text.split(/\n{2,}/).map(norm).filter(k => k.length >= MIN_PARAGRAPH);
}
