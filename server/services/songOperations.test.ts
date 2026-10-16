import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
vi.mock('./manhuaScoringRoom',()=>({assertBgmAudioPlayable:vi.fn(),readBgmAudioWithLimit:vi.fn()}));
vi.mock('./songOperationSource',()=>({resolveSongOperationSource:vi.fn()}));
vi.mock('./postProdMediaSource',()=>({resolveRegisteredPostProdMediaSource:vi.fn()}));
vi.mock('./manhuaLearn0996Source',()=>({assertPublicManhuaSourceHost:vi.fn()}));
vi.mock('./gcs',()=>({downloadGcsObjectVersioned:vi.fn(),getGcsBucketName:()=> 'b',uploadBufferToGcsIfAbsent:vi.fn(),signGsUriV4ReadUrl:vi.fn()}));
import {downloadGcsObjectVersioned,uploadBufferToGcsIfAbsent} from './gcs';
import {assertBgmAudioPlayable,readBgmAudioWithLimit} from './manhuaScoringRoom';
import {mirrorSongOperationMedia,prepareSongOperation, submitSongOperation, runSongOperationJob, getSavedSongOperation, resumeSongOperation, configuredSongOperationPrice, type SongOperationDeps} from './songOperations';
import {TtapiSunoRequestError} from './ttapiSunoMusic';
import type {SongOperationDraft} from '../../shared/songOperations';
const id='00000000-0000-4000-8000-000000000001';
const id2='00000000-0000-4000-8000-000000000002';
const draft:SongOperationDraft={operation:'cover',source:{id:'bgm_source:0',url:'https://storage.googleapis.com/b/audio.mp3?old',gcsUri:'gs://b/audio.mp3',durationSec:120},title:'原曲',prompt:'原歌词',style:'温暖钢琴',duration:180};
function harness(){
 const objects=new Map<string,any>();const jobs=new Map<string,any>();let price:number|null=20;
 const d:SongOperationDeps={
  read:vi.fn(async path=>objects.get(path)??null),
  create:vi.fn(async(path,value)=>{if(objects.has(path))return false;objects.set(path,structuredClone(value));return true;}),
  rawEvidence:vi.fn(async(path,body)=>{objects.set(path,body);}),
  source:vi.fn(async()=>({gcsUri:'gs://b/audio.mp3',musicId:'actual-source-id',durationSec:120})),
  duration:vi.fn(async()=>120),price:()=>price,ready:()=>true,sign:uri=>`https://storage.googleapis.com/${uri.slice(5)}?signed`,
  submit:vi.fn(async()=>({kind:'task' as const,taskId:'ttapi:task001',jobId:'task001',rawData:{}})),
  poll:vi.fn(async()=>({status:'completed' as const,progress:100,musics:[0,1,2].map(i=>({musicId:'music'+i,audioUrl:`https://cdn.example/${i}.mp3`,duration:180,rawData:{}})),rawData:{}})),
  mirror:vi.fn(async(uid,id,stage,index,music)=>({index,musicId:music.musicId,gcsUri:`gs://b/post-prod/${uid}/${id}/${stage}/${index}.mp3`,durationSec:180})),
  balance:vi.fn(async()=>({totalAvailable:999})),charge:vi.fn(async()=>({success:true})),
  job:vi.fn(async id=>jobs.get(id)??null),createJob:vi.fn(async value=>{if(jobs.has(value.id))throw Error('duplicate');jobs.set(value.id,{...value,status:'queued'});return value.id;}) as any,
  requeue:vi.fn(async id=>{jobs.get(id).status='queued';}) as any,
  wait:vi.fn(async()=>{}),
 };
 async function queue(input:SongOperationDraft=draft,requestId=id){const p=await prepareSongOperation(7,{requestId,draft:input},d);await submitSongOperation(7,{requestId,inputDigest:p.inputDigest,confirmed:true},d);return p;}
 return {d,objects,jobs,queue,setPrice:(p:number|null)=>{price=p;}};
}
describe('歌曲操作持久业务链',()=>{
 it('价格未确认可准备但不可排队或提交',async()=>{const h=harness();h.setPrice(null);const p=await prepareSongOperation(7,{requestId:id,draft},h.d);expect(p.creditsCost).toBeNull();await expect(submitSongOperation(7,{requestId:id,inputDigest:p.inputDigest,confirmed:true},h.d)).rejects.toThrow('价格');expect(h.d.submit).not.toHaveBeenCalled();expect(h.d.createJob).not.toHaveBeenCalled();});
 it('确认后改价不沿用旧确认',async()=>{const h=harness();const p=await prepareSongOperation(7,{requestId:id,draft},h.d);h.setPrice(30);await expect(submitSongOperation(7,{requestId:id,inputDigest:p.inputDigest,confirmed:true},h.d)).rejects.toThrow('价格');});
 it('同编号更改歌词拒绝，签名URL刷新不构成新内容',async()=>{const h=harness();const p=await prepareSongOperation(7,{requestId:id,draft},h.d);await expect(prepareSongOperation(7,{requestId:id,draft:{...draft,prompt:'另一首'}},h.d)).rejects.toThrow('另一份');const refreshed=await prepareSongOperation(7,{requestId:id,draft:{...draft,source:{...draft.source,url:'https://storage.googleapis.com/b/audio.mp3?new'}}},h.d);expect(refreshed.inputDigest).toBe(p.inputDigest);});
 it('并发确认只创建同一队列任务，读取不生成',async()=>{const h=harness();const p=await prepareSongOperation(7,{requestId:id,draft},h.d);await Promise.all([0,1].map(()=>submitSongOperation(7,{requestId:id,inputDigest:p.inputDigest,confirmed:true},h.d)));expect(h.jobs.size).toBe(1);expect((await getSavedSongOperation(7,id,h.d))?.status).toBe('pending');expect(h.d.submit).not.toHaveBeenCalled();});
 it('三变体全部保存，恢复已完成不重新生成或扣费',async()=>{const h=harness();await h.queue();const beat=vi.fn();const done=await runSongOperationJob(7,id,{onHeartbeat:beat},h.d);expect(done.status).toBe('succeeded');expect(done.variants).toHaveLength(3);expect(h.d.charge).toHaveBeenCalledTimes(1);await runSongOperationJob(7,id,{},h.d);expect(h.d.submit).toHaveBeenCalledTimes(1);expect(h.d.charge).toHaveBeenCalledTimes(1);expect(beat).toHaveBeenCalled();});
 it('未知提交保存待核，恢复不重发',async()=>{const h=harness();await h.queue();vi.mocked(h.d.submit).mockRejectedValue(new TtapiSunoRequestError('unconfirmed',true));expect((await runSongOperationJob(7,id,{},h.d)).status).toBe('reconcile_required');await runSongOperationJob(7,id,{},h.d);expect(h.d.submit).toHaveBeenCalledTimes(1);expect(h.d.charge).not.toHaveBeenCalled();await expect(resumeSongOperation(7,id,h.d)).rejects.toThrow('核对');});
 it('明确拒绝失败且不扣费',async()=>{const h=harness();await h.queue();vi.mocked(h.d.submit).mockRejectedValue(new TtapiSunoRequestError('rejected',false,429));expect((await runSongOperationJob(7,id,{},h.d)).status).toBe('failed');expect(h.d.charge).not.toHaveBeenCalled();});
 it('查询失败后从原句柄恢复，不重新提交',async()=>{const h=harness();await h.queue();vi.mocked(h.d.poll).mockRejectedValueOnce(Error('temporary'));await expect(runSongOperationJob(7,id,{},h.d)).rejects.toThrow('temporary');expect((await runSongOperationJob(7,id,{},h.d)).status).toBe('succeeded');expect(h.d.submit).toHaveBeenCalledTimes(1);});
 it('媒体保存部分失败后只补失败及未保存变体',async()=>{const h=harness();await h.queue();const base=h.d.mirror;let failed=false;h.d.mirror=vi.fn(async(...args)=>{if(args[3]===1&&!failed){failed=true;throw Error('upload');}return base(args[0],args[1],args[2],args[3],args[4],args[5]);});await expect(runSongOperationJob(7,id,{},h.d)).rejects.toThrow('upload');await runSongOperationJob(7,id,{},h.d);expect(h.d.submit).toHaveBeenCalledTimes(1);expect(h.d.poll).toHaveBeenCalledTimes(1);expect(h.d.mirror).toHaveBeenCalledTimes(4);});
 it('续写每个变体衔接完整歌曲并保留原片段',async()=>{const h=harness();await h.queue({...draft,operation:'extend',continueAt:90});const r=await runSongOperationJob(7,id,{},h.d);expect(h.d.submit).toHaveBeenCalledTimes(4);expect(vi.mocked(h.d.submit).mock.calls.slice(1).map(x=>x[0].operation)).toEqual(['concat','concat','concat']);expect(r.variants).toHaveLength(9);expect(r.variants.map(x=>x.index)).toEqual([0,1,2,3,4,5,6,7,8]);expect(Array.from(h.objects.keys()).some(k=>k.includes('primary/variant-0'))).toBe(true);});
 it('局部修歌发送区间与替换歌词，另存完整曲',async()=>{const h=harness();await h.queue({...draft,operation:'replace',startSec:10,endSec:20});await runSongOperationJob(7,id,{},h.d);expect(vi.mocked(h.d.submit).mock.calls[0][0]).toMatchObject({operation:'replace_section',musicId:'actual-source-id',infillStartSec:10,infillEndSec:20,infillLyrics:'原歌词'});});
 it('旧无供应商ID只允许上传续写，伪造客户端ID不生效',async()=>{const h=harness();vi.mocked(h.d.source).mockResolvedValue({gcsUri:'gs://b/audio.mp3',durationSec:120});await expect(prepareSongOperation(7,{requestId:id,draft:{...draft,operation:'stems',source:{...draft.source,musicId:'fake'}}},h.d)).rejects.toThrow('原歌曲身份');await h.queue({...draft,operation:'extend',continueAt:30});await runSongOperationJob(7,id,{},h.d);expect(vi.mocked(h.d.submit).mock.calls[0][0].operation).toBe('upload_extend');});
 it('词级真实时间生成SRT，不重分配时间',async()=>{const h=harness();await h.queue({...draft,operation:'align'});vi.mocked(h.d.submit).mockResolvedValue({kind:'alignment',status:'completed',words:[{text:'你好',startSec:3,endSec:4},{text:'Love',startSec:8,endSec:9}],rawData:{}});const r=await runSongOperationJob(7,id,{},h.d);expect(r.alignment?.srt).toContain('00:00:08,000 --> 00:00:09,000');expect(r.alignment?.words).toHaveLength(2);});
 it.each(['failed_word','out_of_range','overlap','pending'])('不采用不可靠对齐:%s',async kind=>{const h=harness();await h.queue({...draft,operation:'align'});vi.mocked(h.d.submit).mockResolvedValue({kind:'alignment',status:kind==='pending'?'pending':'completed',words:kind==='overlap'?[{text:'A',startSec:1,endSec:4},{text:'B',startSec:3,endSec:5}]:[{text:'A',startSec:1,endSec:kind==='out_of_range'?121:4,success:kind!=='failed_word'}],rawData:{}});const r=await runSongOperationJob(7,id,{},h.d);expect(r.status).not.toBe('succeeded');expect(h.d.charge).not.toHaveBeenCalled();});
 it('Persona仅保存本人结果，再按requestId选用',async()=>{const h=harness();await h.queue({...draft,operation:'persona',personaName:'柔和',startSec:10,endSec:30});vi.mocked(h.d.submit).mockResolvedValueOnce({kind:'persona',personaId:'owned-persona',rawData:{}});await runSongOperationJob(7,id,{},h.d);await h.queue({...draft,personaRequestId:id},id2);await runSongOperationJob(7,id2,{},h.d);expect(vi.mocked(h.d.submit).mock.calls[1][0]).toMatchObject({personaId:'owned-persona'});await expect(prepareSongOperation(8,{requestId:id2,draft:{...draft,personaRequestId:id}},h.d)).rejects.toThrow('演唱风格');});
 it('结算失败保留全部结果，再恢复只结算',async()=>{const h=harness();await h.queue();vi.mocked(h.d.charge).mockResolvedValueOnce({success:false});expect((await runSongOperationJob(7,id,{},h.d)).status).toBe('payment_pending');expect((await runSongOperationJob(7,id,{},h.d)).status).toBe('succeeded');expect(h.d.submit).toHaveBeenCalledTimes(1);});
 it('中止不提交、心跳未持久化不续期',async()=>{const h=harness();await h.queue();const controller=new AbortController();controller.abort();await expect(runSongOperationJob(7,id,{signal:controller.signal},h.d)).rejects.toBeTruthy();expect(h.d.submit).not.toHaveBeenCalled();});
 it('分轨保留全部轨道及其类型',async()=>{const h=harness();await h.queue({...draft,operation:'stems'});vi.mocked(h.d.poll).mockResolvedValue({status:'completed',progress:100,musics:Array.from({length:12},(_,i)=>({musicId:`stem${i}`,audioUrl:`https://example.org/${i}`,stemType:`track${i}`,rawData:{}})),rawData:{}});const r=await runSongOperationJob(7,id,{},h.d);expect(r.variants).toHaveLength(12);expect(h.d.submit).toHaveBeenCalledTimes(1);});

 it('SONG-R1-001 未结算结果无音频或Persona或字幕可消费字段',async()=>{const h=harness();await h.queue();vi.mocked(h.d.charge).mockResolvedValue({success:false});const r=await runSongOperationJob(7,id,{},h.d);expect(r.status).toBe('payment_pending');expect(r.variants).toEqual([]);expect(r.persona).toBeUndefined();expect(r.alignment).toBeUndefined();expect(Array.from(h.objects.keys()).some(k=>k.endsWith('/result'))).toBe(true);});
 it('SONG-R1-003 试听使用核验来源并在恢复时重新签发',async()=>{const h=harness();const p=await prepareSongOperation(7,{requestId:id,draft:{...draft,source:{...draft.source,url:'https://wrong.example/wrong.mp3'}}},h.d);expect(p.draft.source.url).toBe('https://storage.googleapis.com/b/audio.mp3?signed');h.d.sign=uri=>'https://fresh.example/'+uri.slice(5);const r=await getSavedSongOperation(7,id,h.d);expect(r?.draft.source.url).toBe('https://fresh.example/b/audio.mp3');});
 it('SONG-R1-002 不支持的纯器乐选项必须拒绝而非静默忽略',async()=>{const h=harness();await expect(prepareSongOperation(7,{requestId:id,draft:{...draft,operation:'extend',continueAt:30,instrumental:true}},h.d)).rejects.toThrow('只有参考改编');expect(h.d.submit).not.toHaveBeenCalled();});
 it('SONG-R1-004 已保存对象证据来自原对象而非重新下载内容',async()=>{
  const fresh=Buffer.from('new-audio'),saved=Buffer.from('original-audio');
  vi.mocked(readBgmAudioWithLimit).mockResolvedValue(fresh);
  vi.mocked(assertBgmAudioPlayable).mockResolvedValueOnce(180).mockResolvedValueOnce(120);
  vi.mocked(uploadBufferToGcsIfAbsent).mockResolvedValue({created:false} as any);
  vi.mocked(downloadGcsObjectVersioned).mockResolvedValue({buffer:saved} as any);
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true})));
  try {
   const result=await mirrorSongOperationMedia(7,id,'primary',0,{musicId:'m',audioUrl:'https://example.org/audio.mp3',rawData:{}},new AbortController().signal);
   expect(result.durationSec).toBe(120);
   const evidence=vi.mocked(uploadBufferToGcsIfAbsent).mock.calls.find(([x])=>x.objectName.endsWith('media-0-evidence.json'))?.[0];
   expect(JSON.parse(evidence!.buffer.toString())).toMatchObject({bytes:saved.length,sha256:createHash('sha256').update(saved).digest('hex'),durationSec:120});
  } finally {vi.unstubAllGlobals();}
 });
 it('确认落盘后队列写入失败可恢复原编号且不直接提交供应商',async()=>{
  const h=harness();const p=await prepareSongOperation(7,{requestId:id,draft},h.d);
  vi.mocked(h.d.createJob).mockRejectedValueOnce(Error('database unavailable'));
  await expect(submitSongOperation(7,{requestId:id,inputDigest:p.inputDigest,confirmed:true},h.d)).rejects.toThrow('database unavailable');
  expect((await getSavedSongOperation(7,id,h.d))?.status).toBe('reconcile_required');
  expect((await resumeSongOperation(7,id,h.d)).status).toBe('pending');
  expect(h.jobs.size).toBe(1);expect(h.d.submit).not.toHaveBeenCalled();
 });
 it('配置缺失/字符串/负数不冒充免费',()=>{const old=process.env.SONG_OPERATION_CREDITS_JSON;try{for(const v of ['{}','{"cover":"0"}','{"cover":-1}','bad']){process.env.SONG_OPERATION_CREDITS_JSON=v;expect(configuredSongOperationPrice('cover')).toBeNull();}process.env.SONG_OPERATION_CREDITS_JSON='{"cover":0}';expect(configuredSongOperationPrice('cover')).toBe(0);}finally{if(old===undefined)delete process.env.SONG_OPERATION_CREDITS_JSON;else process.env.SONG_OPERATION_CREDITS_JSON=old;}});
});
