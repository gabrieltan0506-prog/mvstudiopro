import { expect,it,vi } from "vitest";
import { codeMotionProjectSchema,compileCodeMotion } from "../../shared/codeMotion";
import { saveCodeMotion,loadCodeMotion,type CodeMotionStoreDeps } from "./codeMotionStore";
import { ensureCodeMotionProductionGrant,reserveCodeMotionProductionSlot,prepareCodeMotionProductionGrant,getCodeMotionProductionGrant,codeMotionProductionDigest,type CodeMotionProductionGrantDeps } from "./codeMotionProductionGrant";
import { submitCodeMotionSound,adoptCodeMotionSound,getCodeMotionSound,type CodeMotionSoundDeps } from "./codeMotionSound";
import { adoptAndSaveCodeMotionSound,type CodeMotionSoundAdoptionDeps } from "./codeMotionSoundAdoption";
const projectId="11111111-1111-4111-8111-111111111111",requestId="22222222-2222-4222-8222-222222222222";
async function fixture(role:"narration"|"dialogue"="narration"){
 const files=new Map<string,{body:Buffer;generation:string}>();
 const state={failProject:false,failComplete:false,raceVideo:false};
 const storage:CodeMotionStoreDeps={read:async k=>files.get(k)??null,list:async p=>Array.from(files.keys()).filter(k=>k.startsWith(p)),write:async(k,b,g)=>{
   const value=JSON.parse(b.toString());
   if(state.failProject && k.includes('/projects/'))throw Error('lost project save');
   if(state.failComplete && k.endsWith('/grant.json') && !value.speechRebase && value.duration>20)throw Error('lost grant completion');
   if(state.raceVideo && k.endsWith('/grant.json') && value.speechRebase){state.raceVideo=false;const old=files.get(k)!;const grant=JSON.parse(old.body.toString());grant.slots['video:0']={requestId:'original-video',digest:'d'.repeat(64)};files.set(k,{body:Buffer.from(JSON.stringify(grant)),generation:String(Number(old.generation)+1)});}
   if((files.get(k)?.generation??'0')!==g)throw Error('CAS conflict');
   const generation=String(Number(g)+1);files.set(k,{body:b,generation});return generation;
 }};
 const project=codeMotionProjectSchema.parse({id:projectId,brief:{title:'原配音延长',request:'旁白代码画面',style:'scenes',duration:20,durationMode:'natural',orientation:'landscape',images:[{id:'33333333-3333-4333-8333-333333333333',name:'原图',gcsUri:'gs://fixture/old-image.png'}],audios:[{id:'44444444-4444-4444-8444-444444444444',name:'后镜原音',gcsUri:'gs://fixture/later.wav',duration:2,sha256:'b'.repeat(64),bytes:20,mimeType:'audio/wav'}]},plan:{version:1,summary:'四镜',scenes:Array.from({length:4},(_,i)=>({heading:`场景${i}`,body:'',duration:5,...(i===0?{speech:{text:'这是一段比原镜头长的旁白',voice:'female',role}}:{}),production:{imagePrompt:'保持原图',motion:'code',videoPrompt:''},composition:{id:`s${i}`,duration:5,elements:[{id:'old-image',type:'image',imageId:'33333333-3333-4333-8333-333333333333'}]}})),audioTimeline:[{sourceId:'44444444-4444-4444-8444-444444444444',role:'narration',at:10,duration:2}]}});
 await saveCodeMotion('7',project,'0',storage);
 const grantDeps:CodeMotionProductionGrantDeps={storage,plan:vi.fn(async()=>"free" as const),claim:vi.fn(async()=>{})};
 const grant=await ensureCodeMotionProductionGrant('7',{projectId,expectedGeneration:'1',source:{day:'2026-10-10',ipHash:'fixture'}},grantDeps);
 const imageSlot={projectId,grantId:grant.id,kind:'image' as const,index:0,requestId:'original-image',digest:codeMotionProductionDigest('original-image')};
 await reserveCodeMotionProductionSlot('7',imageSlot,grantDeps);
 const request={kind:'speech' as const,requestId,sceneIndex:0,text:project.plan!.scenes[0].speech!.text,voice:'female' as const,role};
 const speech=vi.fn(async()=>({} as any));
 const soundDeps:CodeMotionSoundDeps={storage,speech,speechStatus:vi.fn(async()=>({status:'succeeded',canResumeSettlement:false,result:{gcsUri:'gs://fixture/qwen.wav',audioUrl:'https://fixture/audio.wav',durationSec:6.1}} as any)),bgm:vi.fn(),job:vi.fn(),reserveSlot:((u,r)=>reserveCodeMotionProductionSlot(u,r,grantDeps)) as typeof reserveCodeMotionProductionSlot,importAudio:vi.fn(async i=>({id:i.sourceId,name:i.name,gcsUri:`gs://fixture/owned/${i.sourceId}.wav`,duration:6.1,mimeType:'audio/wav' as const,sha256:'a'.repeat(64),bytes:100,generated:i.generated}))};
 await submitCodeMotionSound('7',projectId,'1',request,soundDeps,{grantId:grant.id});
 const deps:CodeMotionSoundAdoptionDeps={storage,grant:grantDeps,adopt:((u,p,r,i)=>adoptCodeMotionSound(u,p,r,i,soundDeps)) as typeof adoptCodeMotionSound,sound:((u,p,r)=>getCodeMotionSound(u,p,r,soundDeps)) as typeof getCodeMotionSound};
 const input={projectId,requestId,variantIndex:0,expectedGeneration:'1'};
 return {state,files,storage,grantDeps,grant,imageSlot,speech,soundDeps,deps,input,project};
}
it('formal measured adoption saves and restores the same speech/image grant without another purchase',async()=>{
 const f=await fixture();const before=await getCodeMotionProductionGrant('7',projectId,undefined,f.grantDeps);
 const result=await adoptAndSaveCodeMotionSound('7',f.input,f.deps);
 expect(result.saved.project.plan!.scenes[0].duration).toBeCloseTo(6.1);
 expect(result.saved.project.plan!.scenes[0].composition!.duration).toBeCloseTo(6.1);
 expect(result.saved.project.plan!.audioTimeline!.find(c=>c.sourceId==='44444444-4444-4444-8444-444444444444')!.at).toBeCloseTo(11.1);
 expect(result.saved.project.brief.images).toEqual(f.project.brief.images);
 const grant=await prepareCodeMotionProductionGrant('7',{projectId,expectedGeneration:result.saved.generation},f.grantDeps);
 expect(grant.id).toBe(f.grant.id);expect(grant.slots).toEqual(before!.slots);expect(grant.speechRebase).toBeUndefined();
 const restored=await adoptAndSaveCodeMotionSound('7',f.input,f.deps);
 expect(restored.saved).toEqual(result.saved);expect(f.speech).toHaveBeenCalledTimes(1);expect(f.soundDeps.importAudio).toHaveBeenCalledTimes(1);expect(f.grantDeps.claim).toHaveBeenCalledTimes(1);
 expect(compileCodeMotion(restored.saved.project.brief,restored.saved.project.plan).codeAudio!.sources.some(s=>s.sha256===result.source.sha256)).toBe(true);
 await reserveCodeMotionProductionSlot('7',{...f.imageSlot,index:1,requestId:'second-original-image',digest:codeMotionProductionDigest('second')},f.grantDeps);
});
it.each(['failProject','failComplete'] as const)('recovers %s CAS interruption and blocks new cost slots until the original adoption finishes',async failure=>{
 const f=await fixture();f.state[failure]=true;
 await expect(adoptAndSaveCodeMotionSound('7',f.input,f.deps)).rejects.toThrow('lost');
 expect((await getCodeMotionProductionGrant('7',projectId,undefined,f.grantDeps))!.speechRebase).toBeDefined();
 await expect(reserveCodeMotionProductionSlot('7',{...f.imageSlot,index:1,requestId:'new-image'},f.grantDeps)).rejects.toThrow('先恢复');
 f.state[failure]=false;const resumed=await adoptAndSaveCodeMotionSound('7',f.input,f.deps);
 expect(resumed.saved.project.brief.duration).toBeCloseTo(21.1);expect(f.speech).toHaveBeenCalledTimes(1);expect(f.soundDeps.importAudio).toHaveBeenCalledTimes(1);
 expect((await getCodeMotionProductionGrant('7',projectId,undefined,f.grantDeps))!.speechRebase).toBeUndefined();
});
it.each(['video','export'] as const)('refuses an extension after the %s identity was reserved',async kind=>{
 const f=await fixture();await reserveCodeMotionProductionSlot('7',{...f.imageSlot,kind,requestId:'locked'},f.grantDeps);
 await expect(adoptAndSaveCodeMotionSound('7',f.input,f.deps)).rejects.toThrow('已有视频或导出');
 expect((await loadCodeMotion('7',projectId,f.storage))!.generation).toBe('1');
 expect((await getCodeMotionProductionGrant('7',projectId,undefined,f.grantDeps))!.fingerprint).toBe(f.grant.fingerprint);
 expect(f.speech).toHaveBeenCalledTimes(1);
});
it('CAS conflict rechecks a concurrently reserved video and never shifts its window',async()=>{
 const f=await fixture();f.state.raceVideo=true;
 await expect(adoptAndSaveCodeMotionSound('7',f.input,f.deps)).rejects.toThrow('已有视频或导出');
 expect((await loadCodeMotion('7',projectId,f.storage))!.project).toEqual(f.project);
 expect((await getCodeMotionProductionGrant('7',projectId,undefined,f.grantDeps))!.slots['video:0'].requestId).toBe('original-video');
});
it('refuses unrelated storyboard edits and another owner without altering the grant',async()=>{
 const f=await fixture();const changed=structuredClone(f.project);changed.plan!.scenes[1].body='new content';await saveCodeMotion('7',changed,'1',f.storage);
 await expect(adoptAndSaveCodeMotionSound('7',{...f.input,expectedGeneration:'2'},f.deps)).rejects.toThrow('偏离原制作');
 await expect(adoptAndSaveCodeMotionSound('8',f.input,f.deps)).rejects.toThrow('不存在');
 expect((await getCodeMotionProductionGrant('7',projectId,undefined,f.grantDeps))!.fingerprint).toBe(f.grant.fingerprint);
});
it('a too-long free dialogue is an explicit pre-submission rejection and keeps the original receipt reusable',async()=>{
 const f=await fixture('dialogue');
 await expect(adoptAndSaveCodeMotionSound('7',f.input,f.deps)).rejects.toThrow('SOUND_ADOPTION_NOT_COMMITTED:配音长于免费5秒');
 expect((await loadCodeMotion('7',projectId,f.storage))!.generation).toBe('1');
 expect(Array.from(f.files.keys()).some(k=>k.includes('/sound-adoptions/'))).toBe(false);
 expect(f.speech).toHaveBeenCalledTimes(1);
 expect((await f.deps.sound('7',projectId,requestId)).status).toBe('succeeded');
});
it('adopting the same speech after a later image save preserves the later version rather than replaying the old snapshot',async()=>{
 const f=await fixture();const first=await adoptAndSaveCodeMotionSound('7',f.input,f.deps);
 const later=structuredClone(first.saved.project);later.brief.images[0].name='后来保存的图片名称';
 const saved=await saveCodeMotion('7',later,first.saved.generation,f.storage);
 const restored=await adoptAndSaveCodeMotionSound('7',f.input,f.deps);
 expect(restored.saved).toEqual(saved);expect(restored.extendedBy).toBe(0);expect(f.speech).toHaveBeenCalledTimes(1);
});
it('source-relative word timing follows a shifted later audio window without retaining old absolute positions',async()=>{
 const f=await fixture();const timed=structuredClone(f.project);
 timed.plan!.timing={version:1,sourceId:'44444444-4444-4444-8444-444444444444',sourceSha256:'b'.repeat(64),method:'manual',review:'confirmed',words:[{id:'word',text:'后来',startSec:0.2,endSec:1,confidence:1,action:'pop'}],beats:[]};
 await saveCodeMotion('7',timed,'1',f.storage);
 const result=await adoptAndSaveCodeMotionSound('7',{...f.input,expectedGeneration:'2'},f.deps);
 expect(result.saved.project.plan!.timing).toEqual(timed.plan!.timing);
 const spec=compileCodeMotion(result.saved.project.brief,result.saved.project.plan);
 const element=spec.composition!.scenes[2].elements.find(e=>e.type==='text'&&e.text==='后来')!;
 expect(element.start).toBeCloseTo(0.2);
 expect(spec.composition!.scenes.slice(0,2).reduce((n,s)=>n+s.duration,0)+element.start).toBeCloseTo(11.3);
});
