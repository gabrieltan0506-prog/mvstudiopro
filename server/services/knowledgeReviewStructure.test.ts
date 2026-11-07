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
