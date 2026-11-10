import { it, expect, vi } from 'vitest';
import { layoutFromSource } from '../../shared/editableLayout';
const state=vi.hoisted(()=>({doc:null as any}));
vi.mock('../services/knowledgePublicationAdvisor',()=>({loadKnowledgePublication:async()=>state.doc,knowledgePublicationWorkPlan:async()=>({reviewBatches:4,totalBatches:5,consistencyKnown:false})}));
vi.mock('../config/platformSwitches',()=>({resolvePlatformSkillQaPaidCredits:()=>12}));
vi.mock('../services/platformSkillQa',()=>({countPlatformSkillQaToday:async()=>100}));
import { editableLayoutRouter } from './editableLayout';
it('并发乱序完成批次不再进入后续报价；顾问费已并入内文计费，批次报价不另收',async()=>{
 state.doc=layoutFromSource({owner:'7',sourceId:'quote',kind:'knowledge-publication',title:'原稿',body:'说明'});
 state.doc.publication.parallel={channels:{1:'evolink',2:'evolink'},completed:[1,2]};
 const caller=editableLayoutRouter.createCaller({user:{id:7,role:'user'}} as any);
 const result=await caller.publicationQuote({documentId:state.doc.id});
 // 1107（#1748）起顾问整理费并入内文实页计费：报价只回剩余批次，不再按批另收（maxCredits 恒为 0）
 expect(result).toMatchObject({remaining:3,paidUnit:12,maxCredits:0,estimatedCredits:0,freeBatches:3});
 state.doc.publication.completedBatches=4;state.doc.publication.parallel.completed=[0,1,2,3];
 expect(await caller.publicationQuote({documentId:state.doc.id})).toMatchObject({remaining:1,maxCredits:0,freeBatches:1});
});
