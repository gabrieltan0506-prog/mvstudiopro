import { expect, it } from 'vitest';
import { layoutFromSource } from '../../shared/editableLayout';
import { knowledgeVisualDesignSchema, KNOWLEDGE_DESIGN_INSTRUCTIONS } from '../../shared/knowledgeDecorations';
import { buildKnowledgeReviewRequest } from './knowledgePublicationAdvisor';
import { buildKnowledgeConversationRequest } from './knowledgeConversationAdvisor';

it('审校和整册排版的真实请求都说明单选字符串，并给出通过同一schema的结构示例', () => {
  const doc = layoutFromSource({kind:'knowledge-publication',owner:'7',sourceId:'design-prompt',title:'制度沿革',body:'完整正文。'});
  const digest = 'a'.repeat(64);
  doc.publication!.conversation = [{request:{id:'00000000-0000-4000-8000-000000000003',action:'layout',layoutSourceDigest:digest,imagePageIds:[],question:'按内容重新排版',manuscript:doc.publication!.manuscript}}];
  const book = {sourceDigest:digest,title:doc.title,pages:doc.pages.map(p=>({id:p.id,headline:p.headline,body:p.body,hasImage:false,imageDescription:'',cautions:[]}))};
  const review = buildKnowledgeReviewRequest(doc.publication!.source,digest,new Map());
  const layout = buildKnowledgeConversationRequest(doc,{documentId:doc.id,purpose:'conversation',batchIndex:0,attempt:0},[],book);
  for (const request of [review,layout]) {
    const instructions = request.systemInstruction.parts.map(p=>p.text).join('\n');
    expect(instructions).toContain(KNOWLEDGE_DESIGN_INSTRUCTIONS);
    expect(instructions).toContain('每个字段的值都是单个字符串，不是数组或对象');
    const match = /^合法结构示例[^\n]*：({[^\n]+})。$/m.exec(instructions);
    expect(match).not.toBeNull();
    const example = JSON.parse(match![1]);
    expect(knowledgeVisualDesignSchema.parse(example)).toEqual(example);
    expect(Object.values(example).every(value=>typeof value==='string')).toBe(true);
  }
});

it('线上出现的单元素和多元素数组仍被严格拒收，不由程序替顾问选值', () => {
  const valid = {palette:'bronze-sand',layout:'narrative',table:'rules',frame:'rule',motif:'route-array',reason:'根据分路出塞和古地名辨析安排正文与路线纹样。'};
  const bad = [
    {...valid,palette:['plum-ink','jade-paper']},
    {...valid,palette:['ink-cinnabar'],layout:['narrative'],table:['bands'],frame:['rule'],motif:['route-array']},
  ];
  for (const value of bad) {
    const before = JSON.stringify(value);
    const result = knowledgeVisualDesignSchema.safeParse(value);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(['palette']);
    expect(JSON.stringify(value)).toBe(before);
  }
  expect(knowledgeVisualDesignSchema.parse(valid)).toEqual(valid);
});
