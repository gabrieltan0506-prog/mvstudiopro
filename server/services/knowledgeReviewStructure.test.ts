import { expect, it } from 'vitest';
import {restoreKnowledgeReviewStructure} from './knowledgeReviewStructure';
import {knowledgeReviewSchema} from '../../shared/knowledgePublication';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const source={title:'原稿',pages:[{id,headline:'原章',body:'完整正文',imageUrl:''}]};
const reading={version:1,subtitle:'',accent:'jade',blocks:[{type:'prose',title:'原章',note:'',text:'保留 12.5 克与限制条件。'}]};
const report=()=>({kind:'knowledge_publication_v1',sourceDigest:'a'.repeat(64),title:'原稿',pages:[{id,headline:'原章',body:'完整正文',imageDescription:'',imageStatus:'absent',facts:[{term:'事实',statement:'完整正文'}],cautions:[]}]});
it.each([reading,[reading],{[id]:reading}])('根reading按唯一原页归位且不改变原回包',value=>{
 const input={...report(),reading:value},before=JSON.stringify(input);
 const got=restoreKnowledgeReviewStructure(input,source);
 expect(knowledgeReviewSchema.parse(got.value).pages[0].reading).toEqual(reading);
 expect(JSON.stringify(input)).toBe(before);expect(got.value.reading).toBeUndefined();
});
it('readingVersions只按实际pageId匹配，不按数组位置猜测',()=>{
 const got=restoreKnowledgeReviewStructure({...report(),readingVersions:[{pageId:id,...reading}]},source);
 expect(got.value.pages[0].reading).toEqual(reading);
 expect(()=>restoreKnowledgeReviewStructure({...report(),readingVersions:[{pageId:other,...reading}]},source)).toThrow('唯一绑定');
 const input:any=report();input.pages.push({...input.pages[0],id:other});input.reading=[reading];
 expect(()=>restoreKnowledgeReviewStructure(input,{...source,pages:[...source.pages,{...source.pages[0],id:other}]})).toThrow('唯一绑定');
});
it('存在冲突结构必须拒绝，不能覆盖已返回正文',()=>{
 const input:any={...report(),reading};input.pages[0].reading={...reading,subtitle:'另一版'};
 expect(()=>restoreKnowledgeReviewStructure(input,source)).toThrow('冲突正文');
});
it('无图末稿可把完整Markdown识别为结构，原body逐字保留',()=>{
 const input:any={...report(),readings:[]};input.pages[0].body='## 原章\n\n保留 **12.5克** 限定。\n\n|名称|数值|\n|---|---|\n|甲|12.5|';
 const got=restoreKnowledgeReviewStructure(input,source,true);
 expect(knowledgeReviewSchema.safeParse(got.value).success).toBe(true);
 expect(got.value.pages[0].body).toBe(input.pages[0].body);
 expect(got.value.pages[0].reading.blocks.some((b:any)=>b.type==='table'&&b.rows[0][1]==='12.5')).toBe(true);
 expect(got.bodyReadingIds.has(id)).toBe(true);
 expect(restoreKnowledgeReviewStructure(input,source,false).value.pages[0].reading).toBeUndefined();
 expect(restoreKnowledgeReviewStructure(input,{...source,pages:[{...source.pages[0],imageUrl:'gs://test/image'}]},true).value.pages[0].reading).toBeUndefined();
});

it.each([{kind:'other'},{kind:'other',type:'knowledge_publication_v1'},{kind:'知识发布_v1',type:'other'},{kind:null,type:'knowledge_publication_v1'}])('错误或冲突判别字段不猜测恢复 %j',fields=>{
 const input={...report(),...fields};const got=restoreKnowledgeReviewStructure(input,source);
 expect(knowledgeReviewSchema.safeParse(got.value).success).toBe(false);expect(got.adjustments).toEqual([]);
});
it('史记读档实测写法差异可无损归一：关系近义词、块类型别名、note2/textNote 并入 note、疑点类别；不明多余字段与缺页仍拒收', () => {
 const input:any = report();
 input.pages[0].cautions = [{ kind: 'fact_check', evidence: '原句「太初元年」与他处不一致。', message: '已标注疑点。' }];
 input.pages[0].reading = { version: 1, subtitle: '', accent: 'jade', blocks: [
  { type: 'sequence', title: '世家次第', note: '', relation: 'hierarchy', items: [{ title: '甲', body: '一' }, { title: '乙', body: '二' }] },
  { type: 'sequence', title: '编年', note: '', relation: '编年', items: [{ title: '元年', body: '事一' }, { title: '二年', body: '事二' }] },
  { type: 'timeline', title: '征伐', note: '', items: [{ title: '始', body: '出兵' }, { title: '终', body: '班师' }] },
  { type: 'list', title: '要点', note: '主说明', note2: '补充：原文另注 12.5 尺。', items: [{ title: '礼', body: '敬' }] },
  { type: 'prose', title: '太史公曰', note: '', textNote: '此段为评论。', text: '原文评论。' },
  { type: 'cards', title: '人物', note: '', relation: 'comparison', items: [{ title: '项羽', body: '楚' }] },
 ] };
 const got = restoreKnowledgeReviewStructure(input, source);
 const page = knowledgeReviewSchema.parse(got.value).pages[0];
 const blocks:any[] = page.reading!.blocks;
 expect(blocks.map(b => b.type)).toEqual(['sequence', 'sequence', 'sequence', 'cards', 'prose', 'cards']);
 expect(blocks.slice(0, 3).map(b => b.relation)).toEqual(['comparison', 'chronology', 'chronology']);
 expect(blocks[3].note).toBe('主说明\n补充：原文另注 12.5 尺。');
 expect(blocks[4].note).toBe('此段为评论。');
 expect(page.cautions[0]).toEqual({ kind: 'uncertain', evidence: '原句「太初元年」与他处不一致。', message: '已标注疑点。' });
 expect(got.adjustments.length).toBeGreaterThanOrEqual(7);
 // 含不明正文的多余字段不猜：仍由合同拒收
 const bad:any = report(); bad.pages[0].reading = { ...reading, blocks: [{ ...reading.blocks[0], blocks2_placeholder: '……' }], reading_blocks_rest: [] };
 expect(knowledgeReviewSchema.safeParse(restoreKnowledgeReviewStructure(bad, source).value).success).toBe(false);
 // 块类型别名但字段形状不符（list 没有 items）不改
 const shape:any = report(); shape.pages[0].reading = { ...reading, blocks: [{ type: 'list', title: 'x', note: '', rows: [['a', 'b']] }] };
 expect(restoreKnowledgeReviewStructure(shape, source).value.pages[0].reading.blocks[0].type).toBe('list');
});
