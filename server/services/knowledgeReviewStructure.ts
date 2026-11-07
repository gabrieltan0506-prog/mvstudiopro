import type { KnowledgeSource } from '../../shared/knowledgePublication';
import { readingFromMarkdown } from '../../shared/knowledgePublicationLayout';

const object = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** 只归位可唯一绑定的已有正文；原回包与每项调整由路由分别保存。 */
export function restoreKnowledgeReviewStructure(value: any, source: KnowledgeSource, finalTextRevision = false) {
  const result = structuredClone(value), adjustments: unknown[] = [], bodyReadingIds = new Set<string>();
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
