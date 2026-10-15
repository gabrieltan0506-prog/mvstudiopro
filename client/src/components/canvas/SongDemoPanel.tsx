import {useEffect,useRef,useState} from 'react';
import {trpc} from '@/lib/trpc';
import {resolveCanvasMaterialUrl} from '@/lib/omniCanvasApi';
import type {SongDemoRun,SongDemoVariant,SunoSongSession} from '@shared/canvasMusicMv';
import {createSongDemoRuns,suggestedSongDemoLyrics,SONG_DEMO_SECONDS} from '@shared/songDemo';
import {CANVAS_BGM_CREDITS_PER_RUN} from '@shared/canvasGenerationPricing';
type Props={session?:SunoSongSession;history:SunoSongSession[];records:SongDemoRun[];disabled:boolean;canGenerate:boolean;selected?:{requestId:string;variantIndex:number};onChange:(records:SongDemoRun[])=>void;onSelect:(run:SongDemoRun,variant:SongDemoVariant,session:SunoSongSession)=>void};
const button='rounded border border-white/20 px-2 py-1 text-xs disabled:opacity-40';
/** 三个短试听方案独立留存原ID；关闭页面后查询/续交原确认批次，不创建新批次。 */
export function SongDemoPanel(p:Props){
 const music=trpc.mvAnalysis.queueManhuaBgm.useMutation({retry:false}),utils=trpc.useUtils();
 const [excerpt,setExcerpt]=useState(''),[error,setError]=useState('');
 const current=useRef({...p,music,utils});current.current={...p,music,utils};
 const confirmationLock=useRef(false);
 useEffect(()=>{setExcerpt(suggestedSongDemoLyrics(p.session?.proposal?.concepts[0]?.brief.prompt||''));},[p.session?.requestId,p.session?.proposal?.concepts[0]?.brief.prompt]);
 const change=(records:SongDemoRun[])=>{current.current={...current.current,records};current.current.onChange(records);};
 const update=(id:string,patch:Partial<SongDemoRun>)=>change(current.current.records.map(row=>row.requestId===id?{...row,...patch}:row));
 const updateVariant=(id:string,index:number,patch:Partial<SongDemoVariant>)=>{const row=current.current.records.find(r=>r.requestId===id);if(row)update(id,{variants:row.variants.map(v=>v.index===index?{...v,...patch}:v)});};
 useEffect(()=>{let alive=true,busy=false;
  const poll=async()=>{if(busy)return;busy=true;
   try{for(const original of current.current.records){
    if(!alive)return;let row=current.current.records.find(r=>r.requestId===original.requestId)!;
    if(row.status==='ready'||row.status==='failed')continue;
    try{
     if(row.status==='submitting'){
      await current.current.music.mutateAsync({billingRequestId:row.requestId,brief:row.demoBrief});
      if(!alive)return;update(row.requestId,{status:'queued',error:undefined});
     }
     const source=await current.current.utils.mvAnalysis.getManhuaBgmJob.fetch({jobId:row.musicJobId});if(!alive)return;
     if(source.status==='failed'||source.status==='cancelled'){update(row.requestId,{status:'failed',error:source.error||'Demo生成失败，未自动重买'});continue;}
     if(source.status!=='succeeded'){update(row.requestId,{status:source.status==='running'?'running':'queued',error:undefined});continue;}
     row=current.current.records.find(r=>r.requestId===row.requestId)!;
     if(source.variants.some(v=>!Number.isFinite(Number(v.durationSec))||Number(v.durationSec)<=0))throw Error('原Demo实测时长暂不可读取，保留原任务并等待恢复');
     const variants=[...row.variants];for(const v of source.variants){if(!variants.some(old=>old.index===v.index))variants.push({index:v.index,sourceGcsUri:v.gcsUri,durationSec:Number(v.durationSec),status:'pending'});}
     if(!variants.length)throw Error('原Demo任务已返回，音轨仍待恢复，未重新提交');
     update(row.requestId,{variants,status:'processing',error:undefined});
     for(const variant of variants){
      if(!alive)return;if(variant.status==='ready'||variant.status==='failed')continue;
      try{
       if(!Number.isFinite(variant.durationSec)||variant.durationSec<=0)throw Error('原Demo实测时长暂不可读取，保留原任务');
       const url=await resolveCanvasMaterialUrl(variant.sourceGcsUri);if(!alive)return;
       updateVariant(row.requestId,variant.index,{gcsUri:variant.sourceGcsUri,url,durationSec:variant.durationSec,status:'ready',error:undefined});
      }catch(e){if(!alive)return;const message=e instanceof Error?e.message:String(e);updateVariant(row.requestId,variant.index,{error:message,...(/无权/.test(message)?{status:'failed' as const}:{})});}
     }
     const latest=current.current.records.find(r=>r.requestId===row.requestId)!;
     if(latest.variants.every(v=>v.status==='ready'||v.status==='failed'))update(row.requestId,{status:latest.variants.some(v=>v.status==='ready')?'ready':'failed'});
    }catch(e){if(!alive)return;const code=(e as {data?:{code?:string}})?.data?.code;update(row.requestId,{error:e instanceof Error?e.message:String(e),...(['BAD_REQUEST','PRECONDITION_FAILED','UNAUTHORIZED','FORBIDDEN','PAYMENT_REQUIRED'].includes(code||'')&&row.status==='submitting'?{status:'failed' as const}:{})});}
   }}finally{busy=false;}
  };void poll();const timer=window.setInterval(()=>void poll(),10000);return()=>{alive=false;window.clearInterval(timer);};
 },[p.records.length]);
 const existing=p.records.some(row=>row.advisorRequestId===p.session?.requestId);
 const canCreate=p.canGenerate&&p.session?.status==='succeeded'&&p.session.proposal?.review?.verdict==='approved'&&p.session.proposal.concepts.length===3&&!existing;
 const confirm=()=>{if(confirmationLock.current||!canCreate||p.disabled||current.current.records.some(row=>row.advisorRequestId===current.current.session?.requestId))return;confirmationLock.current=true;try{const runs=createSongDemoRuns(p.session!,excerpt,()=>crypto.randomUUID());change([...current.current.records,...runs]);setError('');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{confirmationLock.current=false;}};
 return <section aria-label="短Demo试听与选曲" className="space-y-2 rounded border border-white/20 p-2 text-xs">
  <h4>先听3个短Demo，再选完整版</h4><p>每个目标{SONG_DEMO_SECONDS}秒，仅用下方歌词片段；以实际返回时长完整试听，不裁剪。每种编曲一发，通常返回两个变体，均保留试听。Demo不生成封面。</p>
  {canCreate&&<><label>本次三个Demo共用的歌词片段<textarea aria-label="Demo歌词片段" className="w-full bg-black/30 p-2" rows={5} maxLength={1500} value={excerpt} onChange={e=>setExcerpt(e.target.value)} disabled={p.disabled}/></label>
   {p.session!.proposal!.concepts.map((c,i)=><details key={c.id} open><summary>Demo {i+1} · {c.brief.title} · {SONG_DEMO_SECONDS}秒</summary><p>{c.brief.style}</p><p>排除：{c.brief.negative_tags||'无'}；风格强度：{c.brief.style_weight}；随机性：{c.brief.weirdness_constraint}</p></details>)}
   <p>本次共3发 × {CANVAS_BGM_CREDITS_PER_RUN}积分 = {3*CANVAS_BGM_CREDITS_PER_RUN}积分。不会提交三首完整版。</p><button className={button} disabled={p.disabled||!excerpt.trim()} onClick={confirm}>生成3个35秒Demo · {3*CANVAS_BGM_CREDITS_PER_RUN}积分</button></>}
  {error&&<p role="alert">{error}</p>}
  {p.records.map((row,i)=><div key={row.requestId} className="rounded border border-white/10 p-2"><p>Demo {i+1} · {row.fullBrief.title} · {({submitting:'提交中',queued:'排队中',running:'生成中',processing:'恢复试听音轨',ready:'可试听',failed:'未成功'})[row.status]}</p><p>{row.demoBrief.style}</p>{row.error&&<p>{row.error}</p>}
   {row.variants.map(v=><div key={v.index}><p>版本{v.index+1}{v.status==='ready'?` · ${v.durationSec.toFixed(1)}秒`:''}</p>{v.url&&<><audio controls src={v.url}/><button className={button} onClick={()=>{if(v.gcsUri)void resolveCanvasMaterialUrl(v.gcsUri).then(url=>updateVariant(row.requestId,v.index,{url})).catch(()=>setError("试听地址暂不可恢复"));}}>刷新试听地址</button></>} {v.error&&<p>{v.error}</p>}
    <button className={button} disabled={p.disabled||v.status!=='ready'} onClick={()=>{const session=[p.session,...p.history].find(s=>s?.requestId===row.advisorRequestId);if(session)p.onSelect(row,v,session);else setError('原创作方案暂不可恢复，未采用');}}>{p.selected?.requestId===row.requestId&&p.selected.variantIndex===v.index?'已选为完整版编曲':'选这个Demo，准备完整版'}</button>
   </div>)}<details><summary>本次提交内容与原任务</summary><p>{row.musicJobId}</p><pre className="whitespace-pre-wrap">{row.demoBrief.prompt}</pre></details></div>)}
  {p.selected&&<p>已把所选Demo的完整歌词与编曲参数填回歌曲表单；确认后再生成完整版。当前接口按同一编曲方案重新作曲，不保证沿用Demo旋律。</p>}
 </section>;
}
