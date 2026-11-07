import {describe,it,expect} from 'vitest';
import {compileKnowledgeEditions,knowledgeEditionParts,knowledgeModulesFromMarkdown} from './knowledgeCardEdition';
import {planKnowledgeCardPages} from './knowledgeCardPagination';
import {synchronizedKnowledgeCardSource,illustratedKnowledgeCardSource} from './knowledgeCardEditableLayout';

const modules=[{headline:'核心行动',body:'主要知识与必要风险提示。',priority:'primary' as const},
  ...Array.from({length:8},(_,i)=>({headline:`分类细项${i}`,body:`次要知识${i}，具体方法与条件。`.repeat(20),priority:'secondary' as const}))];
const editions=compileKnowledgeEditions('知识手册',modules);
describe('两档共享浓缩知识，采用不同媒介',()=>{
  it('精华次要文字不进入图片数量/价格；完整主要次要都成图',()=>{
    const full=knowledgeEditionParts(editions.full)!,concise=knowledgeEditionParts(editions.concise)!;
    expect(full.knowledge).toBe(concise.knowledge);
    expect(full.reading).toBe('');
    expect(concise.reading).toContain('分类细项7');
    expect(concise.images).not.toContain('分类细项');
    expect(planKnowledgeCardPages(editions.full).pageCount).toBeGreaterThan(planKnowledgeCardPages(editions.concise).pageCount);
    expect(planKnowledgeCardPages(editions.concise)).toEqual(planKnowledgeCardPages(concise.images));
  });
  it('真实同步入口保留次要文字，图片任务绑定图片页且不再附整份旧长稿',()=>{
    for(const level of ['full','concise'] as const){
      const markdown=editions[level],plan=planKnowledgeCardPages(markdown);
      const source=synchronizedKnowledgeCardSource({owner:'7',sourceId:'same',fullMarkdown:editions.full,illustrationMarkdown:markdown,
        detailLevel:level,infographicTemplateId:'fusion_glasshouse_garden',imageJobIds:plan.pages.map((_,i)=>`job-${i}`)});
      expect(source.infographicTemplateId).toBe('fusion_glasshouse_garden');
      expect(source.pages!.filter(p=>p.knowledgeRole==='illustration').map(p=>p.body)).toEqual(plan.pages);
      const reading=source.pages!.filter(p=>p.knowledgeRole==='reading');
      if(level==='full')expect(reading).toHaveLength(0);
      else {expect(reading.map(p=>p.body).join('')).toContain('次要知识7');expect(reading.map(p=>p.body).join('')).not.toContain('主要知识与必要风险提示');}
      expect(source.body).toContain('次要知识7');
    }
  });
  it('手动导入保留图片空位；未出图时保留全部知识作为文字',()=>{
    const plan=planKnowledgeCardPages(editions.full),images=plan.pages.map((_,i)=>i===1?'':`https://example.test/${i}.png`);
    const doc=illustratedKnowledgeCardSource({owner:'7',sourceId:'same',fullMarkdown:editions.full,illustrationMarkdown:editions.full,detailLevel:'full',images});
    expect(doc.images![2]).toBeUndefined();expect(doc.images![3]).toBe(images[2]);
    expect(doc.pages!.some(p=>p.imageJobId)).toBe(false);
    const text=illustratedKnowledgeCardSource({owner:'7',sourceId:'same',fullMarkdown:editions.full,illustrationMarkdown:editions.concise,images:[]});
    expect(text.body).toContain('主要知识');expect(text.body).toContain('次要知识7');
  });
  it('缺少优先级格式仍保留正文，不因格式拒收；旧稿不猜新版',()=>{
    const parsed=knowledgeModulesFromMarkdown('# 标题\n\n## 未带标签\n实际知识。');
    expect(parsed.modules).toEqual([{headline:'未带标签',body:'实际知识。',priority:'secondary'}]);
    expect(knowledgeEditionParts('## 旧稿\n不能静默删掉')).toBeNull();
  });
});
