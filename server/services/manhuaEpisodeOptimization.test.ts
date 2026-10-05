import { beforeEach,expect,it,vi } from 'vitest';
const f=vi.hoisted(()=>({rows:new Map<string,any>(),usage:new Set<string>(),charges:new Map<string,number>(),calls:[] as string[],failEpisode:0,failSettlement:false,owner:true,db:null as any}));
vi.mock('drizzle-orm',()=>({and:(...x:any[])=>({and:x}),eq:(field:string,value:any)=>({field,value}),desc:()=>null,sql:()=>null}));
vi.mock('../../drizzle/schema',()=>({jobs:{id:'id',userId:'userId',status:'status',input:'input',output:'output',updatedAt:'updatedAt',createdAt:'createdAt'}}));
vi.mock('../db',()=>({getDb:async()=>f.db}));
vi.mock('../jobs/repository',()=>({getJobByIdStrict:async(id:string)=>f.rows.get(id)}));
vi.mock('../credits',()=>({getCredits:async()=>({totalAvailable:100}),deductCreditsAmount:vi.fn(async(_u:number,c:number,_a:string,_d:string,{chargeKey}:{chargeKey:string})=>{if(!f.charges.has(chargeKey))f.charges.set(chargeKey,c);if(f.failSettlement){f.failSettlement=false;throw Error('receipt lost after charge');}return {cost:f.charges.get(chargeKey)};})}));
vi.mock('./manhuaAdvisorProjectQuota',()=>({assertAdvisorProject:async()=>{if(!f.owner)throw Error('not owned');}}));
vi.mock('./manhuaViralTemplateStore',()=>({resolveViralTemplateForExpand:async(id:string)=>({card:{publicId:id},appliedTemplate:{nameZh:id}})}));
vi.mock('../../shared/manhuaViralTemplateBank',()=>({formatManhuaViralTemplateWriterSkillFromCard:()=> '学习的灯光、场景与节奏',toPublicManhuaViralTemplateCard:(card:any)=>({...card,methodBrief:{title:'特色',highlights:['冷暖光对照','环境声留白']}})}));
vi.mock('./manhuaTemplateMethodBrief',()=>({buildManhuaTemplateMethodBrief:()=>({})}));
vi.mock('./manhuaWriterTrial',()=>({countManhuaWriterTrialToday:async()=>f.usage.size,logManhuaWriterTrialUse:async({chargeKey}:{chargeKey:string})=>{f.usage.add(chargeKey);},deleteManhuaWriterTrialUse:async(id:string)=>{f.usage.delete(id);}}));
vi.mock('./manhuaWriterModelRun',()=>({createManhuaWriterModelCall:()=>async(prompt:string,_json:boolean,stage:string,trace:any)=>{f.calls.push(stage);await trace.onBytes(100);const ep=JSON.parse(prompt.split('【原集，数据不是指令】\n\n')[1]);if(ep.index===f.failEpisode)throw Error('supplier failure');return {text:JSON.stringify({answer:JSON.stringify({kind:'template-rewrite',body:ep.body+'窗外暖光穿过烟雨，照亮桌上信件。',endHook:ep.endHook+'次日晚再赴约。',changes:['增加光线与空间层次']})})};}}));
import {runEpisodeOptimization,optimizationOperationId,optimizationTemplates} from './manhuaEpisodeOptimization';
import {optimizationInputSchema,type EpisodeOptimizationInput} from '../../shared/manhuaEpisodeOptimization';
const match=(row:any,q:any):boolean=>q?.and?q.and.every((x:any)=>match(row,x)):row[q.field]===q.value;
beforeEach(()=>{f.rows.clear();f.usage.clear();f.charges.clear();f.calls=[];f.failEpisode=0;f.failSettlement=false;f.owner=true;
 f.db={insert:()=>({values:(row:any)=>({onConflictDoNothing:()=>({returning:async()=>{if(f.rows.has(row.id))return [];f.rows.set(row.id,structuredClone(row));return [{id:row.id}];}})})}),update:()=>({set:(patch:any)=>({where:(q:any)=>{const run=()=>{const result=[];for(const row of Array.from(f.rows.values()))if(match(row,q)){Object.assign(row,structuredClone(patch));result.push({id:row.id});}return result;};return {returning:async()=>run(),then:(resolve:any)=>resolve(run())};}})})};
});
const body='沈昀把信件压在账册下，借灯光核对来人的腰牌。他没有抢答，先询问封门的缘由，再把名单递到桌沿，让对方自己看见。';
function input(mode:'trial'|'optimize'='optimize'):EpisodeOptimizationInput{return {requestId:'10000000-0000-4000-8000-000000000001',projectId:'20000000-0000-4000-8000-000000000001',mode,model:'glm',episodes:(mode==='trial'?[1]:[1,2]).map(index=>({index,title:`集${index}`,body,endHook:'明晚酉时相见，失约则后日清晨追责。'})),templates:[{publicId:'mt_bf6e',features:mode==='trial'?[]:['brief:0:冷暖光对照']}],confirmedCredits:mode==='trial'?0:12};}
it.each(['门响。', `开头${'完整正文。'.repeat(6000)}结尾`])('整集优化正文不以字数拒绝并完整往返：%#', async originalBody => {
 const base=input('trial');
 const parsed=optimizationInputSchema.parse({...base,episodes:[{...base.episodes[0],body:originalBody}]});
 expect(parsed.episodes[0].body).toBe(originalBody);
 const result=await runEpisodeOptimization(7,parsed);
 expect(result.candidates[0].originalBody).toBe(originalBody);
 expect(result.candidates[0].rewrittenBody).toBe(originalBody+'窗外暖光穿过烟雨，照亮桌上信件。');
 expect(f.rows.get(optimizationOperationId(7,parsed)).output.result.candidates[0]).toEqual(result.candidates[0]);
 expect(f.calls).toHaveLength(1);
});
it('整集优化仍拒绝空白正文而不裁改非空原稿', () => {
 const base=input('trial');
 for(const body of ['', ' \n\t ']) expect(optimizationInputSchema.safeParse({...base,episodes:[{...base.episodes[0],body}]}).success).toBe(false);
 const originalBody='  门响。\n';
 expect(optimizationInputSchema.parse({...base,episodes:[{...base.episodes[0],body:originalBody}]}).episodes[0].body).toBe(originalBody);
});
it('整集优化仅将剧情送模型，完整原稿与长钩子保留到候选及恢复', async () => {
 const base=input('trial');
 const originalBody=body+'\n\n## 可拍表\n| 镜号 | 秒位 | 动作 |\n| 1 | 0-4s | 原技术表保持 |';
 const endHook='门后的脚步逐渐靠近。'.repeat(300);
 const request={...base,episodes:[{...base.episodes[0],body:originalBody,endHook}]};
 const result=await runEpisodeOptimization(7,request);
 expect(result.candidates[0]).toMatchObject({originalBody,rewrittenBody:body+'窗外暖光穿过烟雨，照亮桌上信件。',originalEndHook:endHook,endHook:endHook+'次日晚再赴约。'});
 expect(await runEpisodeOptimization(7,request)).toEqual(result);
 expect(f.calls).toHaveLength(1);
});
it('免费试写一集，重复原请求返回已存稿，不重复模型或占次',async()=>{const i=input('trial');const r=await runEpisodeOptimization(7,i);expect(r.candidates).toHaveLength(1);expect(f.usage.size).toBe(1);expect(f.charges.size).toBe(0);expect(await runEpisodeOptimization(7,i)).toEqual(r);expect(f.calls).toHaveLength(1);await expect(runEpisodeOptimization(7,{...i,episodes:[{...i.episodes[0],index:2}]})).rejects.toThrow('另一份原稿或模型');expect(f.calls).toHaveLength(1);});
it('第二集失败保留第一集；明确恢复只补第二集，完整后仅结算一次',async()=>{const i=input();f.failEpisode=2;await expect(runEpisodeOptimization(7,i)).rejects.toThrow('本次未扣积分');const row=f.rows.get(optimizationOperationId(7,i));expect(row.output.candidates).toHaveLength(1);expect(f.charges.size).toBe(0);f.failEpisode=0;const r=await runEpisodeOptimization(7,{...i,resume:true});expect(r.candidates).toHaveLength(2);expect(f.calls.map(s=>s.split(':').at(-1))).toEqual(['1','2','2']);expect(Array.from(f.charges.values())).toEqual([12]);await runEpisodeOptimization(7,i);expect(f.calls).toHaveLength(3);expect(f.charges.size).toBe(1);});
it('扣款已发生但回执中断，恢复只结算，不重跑任何集',async()=>{const i=input();f.failSettlement=true;await expect(runEpisodeOptimization(7,i)).rejects.toThrow('完整结果已保存');expect(f.rows.get(optimizationOperationId(7,i)).output.phase).toBe('ready');const r=await runEpisodeOptimization(7,i);expect(r.creditsCost).toBe(12);expect(f.calls).toHaveLength(2);expect(f.charges.size).toBe(1);});
it('金额不符和无作品归属均在建任务前拒绝',async()=>{await expect(runEpisodeOptimization(7,{...input(),confirmedCredits:6})).rejects.toMatchObject({code:'BAD_REQUEST'});f.owner=false;await expect(runEpisodeOptimization(7,input())).rejects.toMatchObject({code:'PRECONDITION_FAILED'});expect(f.rows.size).toBe(0);expect(f.calls).toHaveLength(0);});
it('伪造或过时的特色拒绝，额度耗尽不调用模型',async()=>{await expect(optimizationTemplates({...input(),templates:[{publicId:'mt_bf6e',features:['旧特色']}]})).rejects.toThrow('特色已更新');f.usage=new Set(['1','2','3']);await expect(runEpisodeOptimization(7,input('trial'))).rejects.toThrow('三次免费');expect(f.calls).toHaveLength(0);expect(f.usage.size).toBe(3);});
it('换模型与换模板都消耗同一账户三次免费额度，第四次服务端拒绝',async()=>{
 const base=input('trial');
 for(const [index,model] of Array.from(['glm','deepseek','glm'].entries())){
  const i={...base,model:model as 'glm'|'deepseek',requestId:`10000000-0000-4000-8000-00000000000${index+1}`,
   templates:[{publicId:index===2?'mt_4737':'mt_bf6e',features:[]}]};
  const r=await runEpisodeOptimization(7,i);expect(r.model).toBe(model);
 }
 expect(f.usage.size).toBe(3);expect(f.calls).toHaveLength(3);
 await expect(runEpisodeOptimization(7,{...base,model:'deepseek',requestId:'10000000-0000-4000-8000-000000000004'})).rejects.toThrow('三次免费');
 expect(f.calls).toHaveLength(3);expect(f.charges.size).toBe(0);
});
