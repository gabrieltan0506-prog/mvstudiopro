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
      // 2026-11-08：无图文字模块并入最相关的图章（supplement），不再单独成页。
      expect(source.pages!.filter(p=>p.knowledgeRole==='reading')).toHaveLength(0);
      const supplements=source.pages!.map(p=>p.supplement||'').join('');
      if(level==='concise'){expect(supplements).toContain('次要知识7');expect(supplements).not.toContain('主要知识与必要风险提示');}
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

it('完整版的原有条件说明真实进入阅读页，不靠改计数补文字',()=>{
 const editions=compileKnowledgeEditions('完整稿',[{headline:'方法',body:'步骤为每天12次。\n\n注意：原有适用条件。',priority:'primary'},
 {headline:'注意事项',body:'原有禁忌应完整保留。',priority:'secondary'}]);
 for(const level of ['full','concise'] as const){
  const md=editions[level],parts=knowledgeEditionParts(md)!;
  const plan=planKnowledgeCardPages(md);
  const source=synchronizedKnowledgeCardSource({owner:'7',sourceId:'notes',fullMarkdown:editions.full,illustrationMarkdown:md,detailLevel:level,imageJobIds:plan.pages.map((_,i)=>`job-${i}`)});
  expect(parts.images).toContain('每天12次');expect(parts.images).not.toContain('原有适用条件');
  const reading=source.pages!.map(p=>p.supplement||'').join('');
  expect(source.pages!.every(p=>p.knowledgeRole==='illustration')).toBe(true);
  expect(reading).toContain('原有适用条件');expect(reading).toContain('原有禁忌');
 }
});

it('旧图示格式的无标签解说与真实注段进入文字，图表原样保留且不重复正文',()=>{
 const diagram='图：七种有氧运动量与强度对照图\n- 按体力选择运动\n- 例：慢跑先从短程开始';
 const table='| 运动 | 强度 |\n|---|---|\n| 慢跑 | 依个人耐受 |\n| 快走 | 能正常交谈 |';
 const explanation='一夜休息后仍四肢乏力说明运动量太大，应减量休息。';
 // 来自本轮真实读档的独立段落结构；正文只用于验证搬运完整性，不代表医学验收。
 const note='注：慢跑后略有疲劳正常，若一夜休息后仍四肢乏力，说明量太大，要减量休息。';
 const reference='〔参考原页 abcdef0123456789:p20〕';
 const body=[diagram,table,explanation,note,reference].join('\n\n');
 const input=[{headline:'七种有氧运动量与强度',body,priority:'primary' as const}];
 const result=compileKnowledgeEditions('原稿',input);
 for(const level of ['full','concise'] as const){
  const parts=knowledgeEditionParts(result[level])!;
  expect(parts.images).toContain(diagram);expect(parts.images).toContain(table);
  expect(parts.reading).toContain(explanation);expect(parts.reading).toContain(note);
  expect(parts.reading).not.toContain(reference);expect(parts.reading).not.toContain(table);
  expect(parts.images).not.toContain(explanation);expect(parts.images).not.toContain(note);
  const bodies=parts.modules.map(m=>m.body).join('\n\n');
  for(const block of [diagram,table,explanation,note,reference])expect(bodies.split(block)).toHaveLength(2);
  const plan=planKnowledgeCardPages(result[level]);
  expect(plan.pages.every(p=>p.length<=1200)).toBe(true);
  const layout=synchronizedKnowledgeCardSource({owner:'7',sourceId:'original-format',fullMarkdown:result.full,illustrationMarkdown:result[level],detailLevel:level,imageJobIds:plan.pages.map((_,i)=>`job-${i}`)});
  const reading=layout.pages!.map(p=>p.supplement||'').join('\n');
  expect(reading).toContain(explanation);expect(reading).toContain(note);
 }
 expect(input[0]!.body).toBe(body);
});

it('无外框整表和图示留图，精华次要章整体进文字，全部原段只分配一次',()=>{
 const diagram='图：指标对照\n- 对照相同单位';
 const table='指标 | 参考值\n--- | ---\n甲 | 1～2\n乙 | 3～4';
 const explanation='不同单位不能直接比较，解释须结合原始测量条件。';
 const body=[diagram,table,explanation].join('\n\n');
 const result=compileKnowledgeEditions('原稿',[{headline:'指标说明',body,priority:'secondary'}]);
 const full=knowledgeEditionParts(result.full)!,concise=knowledgeEditionParts(result.concise)!;
 expect(full.images).toContain(table);expect(full.reading).toContain(explanation);
 expect(concise.images).toBe('');expect(concise.modules[0]!.body).toBe(body);
 expect(full.modules.flatMap(m=>m.body.split(/\n\s*\n/)).sort()).toEqual(body.split(/\n\s*\n/).sort());
});

it('纯HTML注释与孤立尾部小标题不制造说明文字',()=>{
 const body='图：真实结构示意\n- 真实要点\n\n<!-- 核实回执元数据 -->\n\n### 原稿尾部标题';
 const full=knowledgeEditionParts(compileKnowledgeEditions('原稿',[{headline:'章节',body,priority:'primary'}]).full)!;
 expect(full.reading).toBe('');
 expect(full.images).toContain('<!-- 核实回执元数据 -->');
 expect(full.images).toContain('### 原稿尾部标题');
 expect(full.modules.map(m=>m.body).join('\n\n')).toBe(body);
});
