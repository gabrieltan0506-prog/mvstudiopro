import { describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { knowledgeReadingSchema,knowledgeReadingMarkdown,readingFromMarkdown } from './knowledgePublicationLayout';
import { planKnowledgeConsistency } from './knowledgePublicationConsistency';
import { knowledgePublicationPublicError } from './knowledgePublicationPublic';
import { layoutFromSource } from './editableLayout';
import { buildKnowledgePublicationHtml } from './knowledgePublicationHtml';

describe('自动结构化阅读与千页完整性',()=>{
 it('千页事实完整覆盖，有界分组并保留同术语跨组核对',()=>{
  const pages=Array.from({length:1000},(_,i)=>({id:randomUUID(),headline:'知识'+i,facts:[{term:'共同概念',statement:'限定条件'+i+'甲'.repeat(600)},{term:'独立概念'+i,statement:'重要事实'+i}]}));
  const plan=planKnowledgeConsistency([{pages:pages as any}]);expect(plan.factCount).toBe(2000);expect(plan.tasks.length).toBeGreaterThan(1);
  expect(new Set(plan.tasks.flat().map(f=>f.pageId+'|'+f.term)).size).toBe(2000);
  expect(plan.tasks.every(t=>Buffer.byteLength(JSON.stringify(t))<=180000)).toBe(true);
  for(const [a,b] of [[0,999],[10,650],[500,700]])expect(plan.tasks.some(t=>t.some(f=>f.pageId===pages[a].id&&f.term==='共同概念')&&t.some(f=>f.pageId===pages[b].id&&f.term==='共同概念'))).toBe(true);
 });
 it('自动长表分页不漏行，手改后不读旧结构，疑点只留作者面板',()=>{
  const reading=knowledgeReadingSchema.parse({version:1,subtitle:'分类对照',accent:'jade',blocks:[{type:'table',title:'分类',note:'完整120项',columns:['编号','内容'],rows:Array.from({length:120},(_,i)=>['编号'+i,'知识内容'+i])},{type:'cards',title:'概念',note:'',items:[{title:'概念甲',body:'详细解释甲'},{title:'概念乙',body:'详细解释乙'}]}]});
  const doc=layoutFromSource({kind:'knowledge-publication',owner:'7',sourceId:'test',title:'主题',body:knowledgeReadingMarkdown(reading)});
  const p=doc.pages[0];const review={kind:'knowledge_publication_v1' as const,sourceDigest:'a'.repeat(64),title:doc.title,pages:[{...p,imageUrl:undefined,imagePlacement:undefined,reading,imageDescription:'',imageStatus:'absent' as const,facts:[{term:'主题',statement:'事实'}],cautions:[{kind:'text' as const,message:'重要疑点',evidence:'源文条件'}]}]};
  const html=buildKnowledgePublicationHtml(doc,review,{});expect(html.match(/<thead>/g)!.length).toBeGreaterThan(1);
  for(let i=0;i<120;i++)expect(html.match(new RegExp('>编号'+i+'<','g'))).toHaveLength(1);
  // 1108（#1751）起审查疑点只保留在作者面板，读者正文不附加
  expect(html).not.toContain('重要疑点');expect(html).not.toContain('源文条件');expect(html).toContain('data-booklet-root');
  doc.pages[0].body='### 新说明\n\n用户改后的唯一正文';const edited=buildKnowledgePublicationHtml(doc,review,{});expect(edited).toContain('用户改后的唯一正文');expect(edited).not.toContain('知识内容119');
 });
 it('表格列数不一致明确拒收；Markdown里的表格仍识别，脚本不执行',()=>{
  expect(()=>knowledgeReadingSchema.parse({version:1,subtitle:'',accent:'rose',blocks:[{type:'table',title:'错表',columns:['甲','乙'],rows:[['只有一列']]}]})).toThrow();
  const reading=readingFromMarkdown('### 表格\n\n| 甲 | 乙 |\n|---|---|\n|一|二|');expect(reading.blocks[0].type).toBe('table');
 });
 it('任意上游技术详情不回显为用户错误；计费与恢复提示仍可操作',()=>{
  const error=knowledgePublicationPublicError(new Error('OpenRouter DeepSeek request_id=private model failure HTTP503 sk-secret'));
  expect(error.message).not.toMatch(/OpenRouter|DeepSeek|request_id|503|sk-/);expect(error.message).toContain('原稿');
  expect(knowledgePublicationPublicError('ADVISOR_OPERATION_FAILED:upstream').retryable).toBe(true);
  expect(knowledgePublicationPublicError('ADVISOR_OPERATION_REFUND_PENDING').message).toContain('积分');
 });
});

it('已有知识卡模板贯穿保存恢复与导出，未知模板安全回退且正文不混入模板提示',async()=>{
 const {knowledgeCardLayoutSource}=await import('./knowledgeCardEditableLayout');
 const {editableLayoutSchema}=await import('./editableLayout');
 const source=knowledgeCardLayoutSource({owner:'7',sourceId:'template',markdown:'# 知识主题\n\n|概念|解释|\n|---|---|\n|甲|原始说明|',images:[],infographicTemplateId:'fusion_ink_mountains'});
 const doc=editableLayoutSchema.parse(JSON.parse(JSON.stringify(layoutFromSource(source))));
 expect(doc.publication?.infographicTemplateId).toBe('fusion_ink_mountains');
 const review:any={title:doc.title,pages:doc.pages.map(p=>({...p,imageDescription:'',cautions:[]}))};
 const html=buildKnowledgePublicationHtml(doc,review,{});
 expect(html).toContain('class="theme-fusion_ink_mountains"');
 expect(html).toContain('原始说明');
 expect(html).not.toContain('LAYOUT ONLY');expect(html).not.toContain('SECTION 1');expect(html).toContain('原始说明');
 doc.publication!.infographicTemplateId='<script>alert(1)</script>';
 const fallback=buildKnowledgePublicationHtml(doc,review,{});expect(fallback).not.toContain('<script>alert(1)</script>');expect(fallback).toContain('原始说明');
});

it('模型选版保留于回执，手动指定优先且恢复自动不需要改正文',()=>{
 const reading=knowledgeReadingSchema.parse({version:1,templateId:'fusion_maple_bridge',templateReason:'历史人文内容与暖色原图相合',subtitle:'',accent:'rose',blocks:[{type:'prose',title:'知识',text:'原有知识内容',note:''}]});
 const doc=layoutFromSource({kind:'knowledge-publication',owner:'7',sourceId:'selection',title:'主题',body:knowledgeReadingMarkdown(reading)});
 const review:any={title:doc.title,pages:[{...doc.pages[0],reading,imageDescription:'',cautions:[]}]};
 expect(buildKnowledgePublicationHtml(doc,review,{})).toContain('theme-fusion_maple_bridge');
 doc.publication!.infographicTemplateId='fusion_chinese_garden';
 const manual=buildKnowledgePublicationHtml(doc,review,{});expect(manual).toContain('class="theme-fusion_chinese_garden"');expect(manual).toContain('原有知识内容');
 delete doc.publication!.infographicTemplateId;expect(buildKnowledgePublicationHtml(doc,review,{})).toContain('class="theme-fusion_maple_bridge"');
 expect(()=>knowledgeReadingSchema.parse({...reading,templateId:'unknown-template'})).toThrow('已有知识卡模板');
});


it('新选版严格限定选择器第一组，旧稿非第一组模板不再冒充已应用',async()=>{
 const {knowledgePublicationTemplates,resolveKnowledgePublicationTemplate,KNOWLEDGE_TEMPLATE_SELECTION_INSTRUCTIONS}=await import('./knowledgePublicationTemplates');
 const {listInfographicTemplatesByMode}=await import('./infographicNoteTemplates');
 expect(knowledgePublicationTemplates.map(t=>t.id)).toEqual(listInfographicTemplatesByMode()[0].items.map(t=>t.id));
 expect(knowledgePublicationTemplates).toHaveLength(6);
 expect(knowledgePublicationTemplates.every(t=>t.mode==='fusion')).toBe(true);
 expect(resolveKnowledgePublicationTemplate(undefined,'infographic_structure_deconstruct')).toBeNull();
 expect(resolveKnowledgePublicationTemplate('infographic_structure_deconstruct','fusion_ink_mountains')).toBeNull();
 expect(resolveKnowledgePublicationTemplate('fusion_maple_bridge','fusion_ink_mountains')?.id).toBe('fusion_maple_bridge');
 expect(KNOWLEDGE_TEMPLATE_SELECTION_INSTRUCTIONS).toContain('不能选择结构层解构');
});

it('固定失败原因经过多次脱敏保持类别，退款未闭合优先于可重试原因',()=>{
 const source='本次整理缺少可核实的来源，未采用这份补充内容；原稿和已完成部分已保留。';
 expect(knowledgePublicationPublicError(source)).toEqual({message:source,retryable:true});
 expect(knowledgePublicationPublicError('ADVISOR_OPERATION_REFUND_PENDING '+source).retryable).toBe(false);
 expect(knowledgePublicationPublicError('原请求的结果尚未确认，已保留原稿与任务；请恢复原任务，不要重新付费。').retryable).toBe(false);
});
