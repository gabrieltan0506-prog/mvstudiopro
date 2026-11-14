import type { KnowledgeSource } from '../../shared/knowledgePublication';
import { readingFromMarkdown } from '../../shared/knowledgePublicationLayout';

const object = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const CAUTION_KINDS = new Set(['image_text', 'text', 'uncertain']);
const RELATIONS = new Set(['chronology', 'process', 'comparison']);
/** 关系写法近义归一：时间类→chronology，步骤类→process，其余（并列/层级/对照/不明）→comparison（与提炼指令「并列或世系不明用comparison」一致）。 */
function normalizeRelation(value: string): string {
  const raw = value.trim().toLowerCase();
  if (RELATIONS.has(raw)) return raw;
  if (/chrono|time|timeline|history|date|year|时间|时序|年代|编年|历史|先后/.test(raw)) return 'chronology';
  if (/process|step|flow|procedure|stage|phase|sequence|流程|步骤|阶段|过程|程序/.test(raw)) return 'process';
  return 'comparison';
}
/** 块类型别名：只映射到字段形状完全一致的合同类型。 */
const BLOCK_TYPE_ALIASES: Record<string, string> = {
  paragraph: 'prose', text: 'prose', 段落: 'prose', 正文: 'prose',
  list: 'cards', bullets: 'cards', card: 'cards', matrix: 'cards', grid: 'cards', 卡片: 'cards',
  steps: 'sequence', timeline: 'sequence', process: 'sequence', chronology: 'sequence', 时间线: 'sequence', 流程: 'sequence',
  grid_table: 'table', 表格: 'table',
};
/** 补充说明类的多余字段（note2、textNote、notes…）：字符串原文并入 note，不丢字；其它多余字段不动，交合同校验。 */
const EXTRA_NOTE_FIELD = /^(note\d+|notes|textnote|text_note|subnote|remark|remarks|说明|备注)$/i;
function normalizeReadingBlock(block: any, index: number, pageId: string, adjustments: unknown[]) {
  if (!object(block)) return;
  const field = (name: string) => `reading.blocks[${index}].${name}`;
  if (typeof block.type === 'string' && !['prose', 'table', 'sequence', 'cards'].includes(block.type)) {
    const alias = BLOCK_TYPE_ALIASES[block.type.trim().toLowerCase()] ?? BLOCK_TYPE_ALIASES[block.type.trim()];
    const shapeOk = alias === 'prose' ? typeof block.text === 'string' : alias === 'table' ? Array.isArray(block.columns) && Array.isArray(block.rows) : alias ? Array.isArray(block.items) : false;
    if (alias && shapeOk) {
      if (alias === 'sequence' && typeof block.relation !== 'string') {
        const relation = normalizeRelation(block.type);
        adjustments.push({ pageId, field: field('relation'), before: null, after: relation, reason: '由块类型别名推出关系，正文未改' });
        block.relation = relation;
      }
      adjustments.push({ pageId, field: field('type'), before: block.type, after: alias, reason: '块类型别名归入同形合同类型，正文未改' });
      block.type = alias;
    }
  }
  if (block.type === 'sequence' && typeof block.relation === 'string' && !RELATIONS.has(block.relation)) {
    const relation = normalizeRelation(block.relation);
    adjustments.push({ pageId, field: field('relation'), before: block.relation, after: relation, reason: '关系写法归一到合同三选一，条目原样保留' });
    block.relation = relation;
  }
  if (block.type !== 'sequence' && Object.prototype.hasOwnProperty.call(block, 'relation') && (block.type === 'cards' || block.type === 'prose' || block.type === 'table')) {
    adjustments.push({ pageId, field: field('relation'), before: block.relation, after: null, reason: '非顺序块不使用关系字段（只影响编号呈现），正文未改' });
    delete block.relation;
  }
  for (const key of Object.keys(block)) {
    if (!EXTRA_NOTE_FIELD.test(key) || typeof block[key] !== 'string') continue;
    const extra = block[key].trim();
    const note = typeof block.note === 'string' ? block.note.trim() : '';
    const merged = extra && !note.includes(extra) ? [note, extra].filter(Boolean).join('\n') : note;
    if (merged.length > 1500) continue;
    adjustments.push({ pageId, field: field(key), before: block[key], after: field('note'), reason: '补充说明字段并入 note，原文逐字保留' });
    block.note = merged;
    delete block[key];
  }
  if (block.note === null) { adjustments.push({ pageId, field: field('note'), before: null, after: '', reason: '空说明归一为空串' }); block.note = ''; }
}

/** 只归位可唯一绑定的已有正文；原回包与每项调整由路由分别保存。 */
export function restoreKnowledgeReviewStructure(value: any, source: KnowledgeSource, finalTextRevision = false) {
  const result = structuredClone(value), adjustments: unknown[] = [], bodyReadingIds = new Set<string>();
  // 仅恢复真实回包中见到的判别字段写法；后续仍完整校验正文、原页和摘要。
  if (object(result) && !Object.prototype.hasOwnProperty.call(result, 'kind') && result.type === 'knowledge_publication_v1') {
    result.kind = result.type;
    delete result.type;
    adjustments.push({field:'kind',before:'type=knowledge_publication_v1',after:'knowledge_publication_v1',reason:'原回包判别字段归位，正文未改'});
  } else if (object(result) && result.kind === '知识发布_v1' && !Object.prototype.hasOwnProperty.call(result, 'type')) {
    result.kind = 'knowledge_publication_v1';
    adjustments.push({field:'kind',before:'知识发布_v1',after:'knowledge_publication_v1',reason:'原回包判别值归一，正文未改'});
  }
  if (!object(result) || result.kind !== 'knowledge_publication_v1' || !Array.isArray(result.pages))
    return { value: result, adjustments, bodyReadingIds };
  const attach = (id: string, reading: any, field: string) => {
    const pages = result.pages.filter((p: any) => p.id === id);
    if (pages.length !== 1 || !source.pages.some(p => p.id === id) || !object(reading)) throw Error('正文结构不能唯一绑定原页');
    if (pages[0].reading && JSON.stringify(pages[0].reading) !== JSON.stringify(reading)) throw Error('同一原页存在冲突正文结构，保留回包');
    pages[0].reading = reading;
    adjustments.push({ pageId: id, field, after: 'pages[].reading', reason: '现有正文按唯一原页身份归位，未改正文' });
  };
  for (const field of ['reading', 'readings', 'readingVersions']) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) continue;
    const current = result[field];
    if (Array.isArray(current)) {
      for (const item of current) {
        if (!object(item)) throw Error('正文结构不是对象');
        const { pageId, ...reading } = item;
        const id = pageId || (current.length === 1 && result.pages.length === 1 ? result.pages[0].id : '');
        attach(id, pageId ? reading : item, field);
      }
    } else if (object(current) && current.version === 1) {
      if (result.pages.length !== 1) throw Error('多页根正文缺少页号，不能猜测归属');
      attach(result.pages[0].id, current, field);
    } else if (object(current)) {
      for (const [id, reading] of Object.entries(current)) attach(id, reading, field);
    } else throw Error('正文结构层级无效');
    delete result[field];
  }
  // 实际回包（敦煌 1109 DeepSeek@EvoLink）把本页 cautions 写进了 reading 内；cautions 是页级字段，原样上移不改内容。
  for (const page of result.pages) {
    if (!object(page) || !object(page.reading) || !Object.prototype.hasOwnProperty.call(page.reading, 'cautions')) continue;
    const misplaced = page.reading.cautions;
    delete page.reading.cautions;
    if (!Array.isArray(misplaced)) throw Error('reading 内 cautions 不是数组，保留回包');
    const existing = Array.isArray(page.cautions) ? page.cautions : [];
    const seen = new Set(existing.map((c: unknown) => JSON.stringify(c)));
    page.cautions = [...existing, ...misplaced.filter((c: unknown) => !seen.has(JSON.stringify(c)))];
    adjustments.push({ pageId: page.id, field: 'reading.cautions', after: 'pages[].cautions', reason: '疑点数组由 reading 上移到页级字段，逐条保留未改' });
  }
  // 2026-11-14 史记读档实测（EvoLink GLM 大量「输出合同不符」）：只做可无损归一的写法差异，内容一字不丢；
  // 任何含不明正文的多余字段（如 blocks2_placeholder）、缺页、错页仍原样交给合同校验拒收。
  for (const page of result.pages) {
    if (!object(page)) continue;
    if (Array.isArray(page.cautions)) page.cautions.forEach((caution: any, index: number) => {
      if (object(caution) && typeof caution.kind === 'string' && !CAUTION_KINDS.has(caution.kind)) {
        adjustments.push({ pageId: page.id, field: `cautions[${index}].kind`, before: caution.kind, after: 'uncertain', reason: '疑点类别写法不在合同内，按待核实归类；证据与说明原样保留' });
        caution.kind = 'uncertain';
      }
    });
    if (!object(page.reading) || !Array.isArray(page.reading.blocks)) continue;
    page.reading.blocks.forEach((block: any, index: number) => normalizeReadingBlock(block, index, page.id, adjustments));
  }
  // 仅无图末稿：复用旧稿/手改稿已有的Markdown识别器，不给图片审校补造reading。
  if (finalTextRevision && source.pages.every(p => !p.imageUrl)) for (const page of result.pages) {
    if (!page.reading && typeof page.body === 'string' && page.body.trim() && source.pages.some(p => p.id === page.id)) {
      page.reading = readingFromMarkdown(page.body);
      bodyReadingIds.add(page.id);
      adjustments.push({pageId:page.id,field:'reading',reason:'无图最终文字修订复用完整body识别结构；正文逐字保留，非模型排版'});
    }
  }
  return { value: result, adjustments, bodyReadingIds };
}
