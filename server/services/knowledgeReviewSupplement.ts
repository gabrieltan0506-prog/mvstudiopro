import { knowledgeReviewPageSchema, type KnowledgeReview } from '../../shared/knowledgePublication';
import { knowledgeReadingMarkdown } from '../../shared/knowledgePublicationLayout';
import type { validateKnowledgeResearchResult } from './knowledgePublicationResearch';

/** 真实搜索结果补入原正文结构，不重新购买整批正文，也不输出页号标签。 */
export function supplementKnowledgeReview(review: KnowledgeReview, research: ReturnType<typeof validateKnowledgeResearchResult>) {
  const result = structuredClone(review);
  const pending: {pageId:string; finding:unknown; reason:string}[] = [];
  for (const page of result.pages) {
    const findings = research.pages.find(p => p.pageId === page.id)?.findings || [];
    for (const finding of findings) {
      const source = research.sources.find(s => s.url === finding.url && s.pageIds?.includes(page.id));
      if (!source) continue;
      const before = structuredClone(page);
      const label = source.title.replace(/[\[\]\r\n]/g,' ').trim();
      const link = `[${label}](${source.url})`;
      // 给读者直接呈现知识，不插入“核对报告”等内部处理话术。
      const text = `${finding.summary} ${link}`;
      if (page.body.includes(text)) continue;
      const title = '补充提示';
      if (page.reading) {
        const anchor = page.reading.blocks.findIndex(b => finding.sourceQuote && JSON.stringify(b).includes(finding.sourceQuote));
        page.reading.blocks.splice(anchor < 0 ? page.reading.blocks.length : anchor + 1,0,{type:'prose',title,text,note:''});
        page.body = knowledgeReadingMarkdown(page.reading);
      } else {
        // Markdown新正文没有reading结构，仍须让真实资料进入最终消费者。
        // 按段插入可避免把完整表格拆开；原稿重组后找不到锚点则放本章末尾。
        const paragraphs=page.body.split(/\n\s*\n/);
        const anchor=paragraphs.findIndex(p=>finding.sourceQuote && p.includes(finding.sourceQuote));
        if(anchor<0)page.body=`${page.body.trimEnd()}\n\n${text}`;
        else {
          const position=page.body.indexOf(paragraphs[anchor])+paragraphs[anchor].length;
          page.body=page.body.slice(0,position)+`\n\n${text}`+page.body.slice(position);
        }
      }
      page.sources = [...(page.sources || []).filter(s => s.url !== source.url),{url:source.url,title:source.title}];
      for (let start=0;start<finding.summary.length;start+=1500) page.facts.push({term:title,statement:finding.summary.slice(start,start+1500)});
      if (!knowledgeReviewPageSchema.safeParse(page).success) {
        Object.assign(page,before);
        if(before.sources===undefined)delete page.sources;
        pending.push({pageId:page.id,finding,reason:'补充超出本章结构容量，原正文与完整资料均保留'});
      }
    }
  }
  for (const page of result.pages) if (pending.some(p => p.pageId === page.id))
    page.cautions.push({kind:'uncertain',evidence:'已取得的检索资料超过当前正文容量。',message:'原正文已保留，尚有核实资料待编入；不能视为补充完整。'});
  return {review:result,pending};
}
