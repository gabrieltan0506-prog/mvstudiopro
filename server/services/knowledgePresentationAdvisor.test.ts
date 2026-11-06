import {it,expect,vi} from 'vitest';
import {layoutFromSource} from '../../shared/editableLayout';
import {knowledgeManuscript} from '../../shared/knowledgePublication';
import {validateKnowledgePresentationPlan,knowledgePresentationRangeSchema} from '../../shared/knowledgePresentation';
import {knowledgePresentationInput,buildKnowledgePresentationRequest,reviewKnowledgePresentation,loadVerifiedKnowledgePresentation} from './knowledgePresentationAdvisor';
function make(){const doc=layoutFromSource({kind:'knowledge-publication',owner:'7',sourceId:'outline',title:'知识',body:'完整正文，含最后的依据。'});const pub=doc.publication!;pub.review={pages:doc.pages.map(p=>({...p,cautions:[]}))} as any;pub.manuscript=knowledgeManuscript({title:doc.title,pages:doc.pages});pub.confirmedManuscript=pub.manuscript;pub.presentationRequest={id:'00000000-0000-4000-8000-000000000003',minSlides:1,maxSlides:2,manuscript:pub.manuscript};const input=knowledgePresentationInput(doc);const plan={kind:'knowledge_presentation_v1',requestId:input.requestId,sourceDigest:input.sourceDigest,minSlides:1,maxSlides:2,title:'知识',fontStyle:'editorial',slides:[{type:'points',title:'主题',points:['有依据的重点'],sourcePageIds:[doc.pages[0].id],notes:''}]};return {doc,input,plan};}
it('范围、版本、章节与图片引用都需闭合',()=>{const f=make();expect(()=>knowledgePresentationRangeSchema.parse({minSlides:20,maxSlides:10})).toThrow();expect(validateKnowledgePresentationPlan(f.plan,f.input).slides).toHaveLength(1);expect(()=>validateKnowledgePresentationPlan({...f.plan,maxSlides:3},f.input)).toThrow('不一致');expect(()=>validateKnowledgePresentationPlan({...f.plan,slides:[{...f.plan.slides[0],sourcePageIds:['00000000-0000-4000-8000-000000000099']}]},f.input)).toThrow('未知章节');});
it('完整输入含尾部且把范围送到真实顾问请求，不在程序里删正文',()=>{const f=make(),r=buildKnowledgePresentationRequest(f.doc);expect(JSON.stringify(r)).toContain('含最后的依据');expect(JSON.parse(r.contents[0].parts.filter(p=>'text'in p)[0].text!).presentation.maxSlides).toBe(2);expect(r.systemInstruction.parts[0].text).toContain('找不到有依据答案就省略');f.doc.publication!.manuscript+='改动';expect(()=>buildKnowledgePresentationRequest(f.doc)).toThrow('稿件已变化');});
it('实际审校返回保存后重放零模型调用，导出拒绝伪造或未确认提纲',async()=>{const f=make(),store=new Map<string,any>();const post=vi.fn(async()=>({status:200,text:JSON.stringify({modelVersion:'test-model',candidates:[{content:{parts:[{text:JSON.stringify(f.plan)}]}}]})}));const deps={load:async()=>f.doc,read:async(k:string)=>store.get(k)||null,save:async(k:string,v:any)=>{store.set(k,v)},post};const ctx={documentId:f.doc.id,batchIndex:0,attempt:0,purpose:'presentation' as const};const a=await reviewKnowledgePresentation(7,ctx,deps);await reviewKnowledgePresentation(7,ctx,deps);expect(post).toHaveBeenCalledTimes(1);await expect(loadVerifiedKnowledgePresentation(7,f.doc,deps.read)).rejects.toThrow('尚未确认');f.doc.publication!.presentationPlan=a;expect(await loadVerifiedKnowledgePresentation(7,f.doc,deps.read)).toEqual(a);f.doc.publication!.presentationPlan={...a,title:'伪造标题'};await expect(loadVerifiedKnowledgePresentation(7,f.doc,deps.read)).rejects.toThrow('尚未确认');});

it('容量不合格的原提纲保留供修订，修订通过后导出且原权威报告不变',async()=>{
 const f=make(),original=validateKnowledgePresentationPlan({...f.plan,slides:[{...f.plan.slides[0],points:['字\n'.repeat(20)+'末']}]},f.input);
 f.doc.publication!.presentationPlan=original as any;
 const read=async()=>({plan:original});
 await expect(loadVerifiedKnowledgePresentation(7,f.doc,read)).rejects.toThrow('第 1 页');
 const revision=structuredClone(original);if(revision.slides[0].type!=='points')throw Error('测试需使用要点页');revision.slides[0].points=['修订后的实质知识'];
 f.doc.publication!.presentationRevision=revision as any;
 expect(await loadVerifiedKnowledgePresentation(7,f.doc,read)).toEqual(revision);
 expect(f.doc.publication!.presentationPlan).toEqual(original);
 f.doc.publication!.presentationRevision!.slides[0].sourcePageIds=['00000000-0000-4000-8000-000000000099'];
 await expect(loadVerifiedKnowledgePresentation(7,f.doc,read)).rejects.toThrow('只能修改页面文字');
});
it('修订不能替换权威原提纲或改变请求身份',async()=>{
 const f=make();f.doc.publication!.presentationPlan=validateKnowledgePresentationPlan(f.plan,f.input);
 f.doc.publication!.presentationRevision={...f.plan,requestId:'00000000-0000-4000-8000-000000000099'} as any;
 await expect(loadVerifiedKnowledgePresentation(7,f.doc,async()=>({plan:f.plan}))).rejects.toThrow('只能修改页面文字');
 f.doc.publication!.presentationPlan={...f.plan,title:'冒充顾问'} as any;
 await expect(loadVerifiedKnowledgePresentation(7,f.doc,async()=>({plan:f.plan}))).rejects.toThrow('尚未确认');
});

it('提前规划绑定完整原稿及稳定任务身份，图片就绪和审校说明不触发重买',async()=>{
 const f=make(),pub=f.doc.publication!;
 const {knowledgePresentationSourceManuscript}=await import('../../shared/knowledgePresentation');
 pub.source.pages[0].imageJobId='stable-image-task';pub.source.pages[0].imageUrl='';
 pub.review=undefined;pub.confirmedManuscript=undefined;
 pub.presentationRequest={...pub.presentationRequest!,basis:'source',manuscript:knowledgePresentationSourceManuscript(pub.source)};
 const before=knowledgePresentationInput(f.doc);
 expect(JSON.stringify(buildKnowledgePresentationRequest(f.doc))).toContain('尚未读取任何实际图片');
 expect(before.pages[0].body).toContain('完整正文');
 pub.source.pages[0].imageUrl='https://test.invalid/ready.png';pub.manuscript='最终解释文字';
 expect(knowledgePresentationInput(f.doc).sourceDigest).toBe(before.sourceDigest);
 pub.source.pages[0].imageJobId='different-task';
 expect(()=>knowledgePresentationInput(f.doc)).toThrow('稿件已变化');
});
it('提前图页必须等最终审校、真实图片及确认，疑点或替图不得绕过',async()=>{
 const f=make(),pub=f.doc.publication!;
 const {knowledgePresentationSourceManuscript}=await import('../../shared/knowledgePresentation');
 pub.source.pages[0].imageJobId='stable-image-task';pub.source.pages[0].imageUrl='';
 pub.presentationRequest={...pub.presentationRequest!,basis:'source',manuscript:knowledgePresentationSourceManuscript(pub.source)};
 const input=knowledgePresentationInput(f.doc);
 const plan=validateKnowledgePresentationPlan({...f.plan,sourceDigest:input.sourceDigest,slides:[{type:'image',title:'实质知识',points:['文字中的依据'],sourcePageIds:[f.doc.pages[0].id],imagePageId:f.doc.pages[0].id,notes:''}]},input);
 pub.presentationPlan=plan;
 const read=async()=>({plan});
 pub.confirmedManuscript=undefined;
 await expect(loadVerifiedKnowledgePresentation(7,f.doc,read)).rejects.toThrow('全稿审校结束');
 pub.confirmedManuscript=pub.manuscript;
 await expect(loadVerifiedKnowledgePresentation(7,f.doc,read)).rejects.toThrow('图片尚未就绪');
 f.doc.pages[0].imageUrl='https://test.invalid/final.png';
 pub.review!.pages[0].imageStatus='uncertain';
 await expect(loadVerifiedKnowledgePresentation(7,f.doc,read)).rejects.toThrow('实际图片尚未通过');
 pub.review!.pages[0].imageStatus='consistent';
 expect(await loadVerifiedKnowledgePresentation(7,f.doc,read)).toEqual(plan);
 pub.review!.pages[0].cautions=[{kind:'text',evidence:'该事实有冲突',message:'待核对'}];
 await expect(loadVerifiedKnowledgePresentation(7,f.doc,read)).rejects.toThrow('最终审校疑点');
});
