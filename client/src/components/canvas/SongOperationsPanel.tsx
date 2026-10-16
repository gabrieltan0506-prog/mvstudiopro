import { songOperationDraftKey, songOperationMusicOptions } from "@/lib/songOperationConsumers";
import React, { useEffect, useRef, useState } from 'react';
import { SONG_OPERATION_LABELS, songOperationDraftSchema, songOperationIsActive, type SongOperationDraft, type SongOperationKind, type SongOperationReceipt, type SongOperationSession } from '@shared/songOperations';
import type { CanvasMusicCandidate } from '@shared/canvasMusicMedia';

const field = 'w-full rounded-md border border-white/15 bg-black/25 px-2 py-1.5 text-xs';
const button = 'rounded-md border border-white/20 px-2 py-1.5 text-xs hover:bg-white/10 disabled:opacity-40';
const labels: Record<SongOperationReceipt['status'], string> = { prepared: '待确认', submitting: '提交中', pending: '排队中', processing: '处理中', succeeded: '已返回结果', failed: '失败', reconcile_required: '需查询原任务核对', payment_pending: '扣费待核对' };
export type SongOperationsServices = {
  prepare(input: { requestId: string; draft: SongOperationDraft }): Promise<SongOperationReceipt>;
  submit(input: { requestId: string; inputDigest: string; confirmed: true }): Promise<SongOperationReceipt>;
  get(input: { requestId: string }): Promise<SongOperationReceipt>;
  resume(input: { requestId: string }): Promise<SongOperationReceipt>;
};
type Props = {
  source: CanvasMusicCandidate; lyrics: string; sessions: SongOperationSession[]; disabled?: boolean;
  services: SongOperationsServices;
  onSession(session: SongOperationSession): void;
  onCandidates(receipt: SongOperationReceipt): void;
  onAlignment(receipt: SongOperationReceipt): void;
  onStems(receipt: SongOperationReceipt): void;
};
export function SongOperationsPanel({source, lyrics, sessions, disabled, services, onSession, onCandidates, onAlignment, onStems}: Props) {
  const [operation, setOperation] = useState<SongOperationKind>('cover');
  const [title, setTitle] = useState(source.title || '');
  const [prompt, setPrompt] = useState(lyrics);
  const [style, setStyle] = useState('');
  const [instrumental, setInstrumental] = useState(false);
  const [audioWeight, setAudioWeight] = useState(0.5);
  const [duration, setDuration] = useState(Math.min(360, Math.max(10, Math.round(source.durationSec))));
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(source.durationSec);
  const [continueAt, setContinueAt] = useState(Math.max(0, source.durationSec - 1));
  const [personaName, setPersonaName] = useState('');
  const [personaDescription, setPersonaDescription] = useState('');
  const [personaRequestId, setPersonaRequestId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const latest = useRef({services, onSession}); latest.current = {services, onSession};
  const own = sessions.filter(s => s.sourceId === source.id);
  const personas = sessions.filter(s => s.receipt?.status === 'succeeded' && s.receipt.persona);
  const save = (r: SongOperationReceipt) => latest.current.onSession({requestId:r.requestId, operation:r.operation, sourceId:r.sourceId, receipt:r});
  useEffect(() => {
    let active = true;
    own.forEach(s => {
      void latest.current.services.get({requestId:s.requestId}).then(r => {if(active) save(r);}).catch(e => {if(active) setError(e instanceof Error ? e.message : '原任务暂无法查询');});
    });
    return () => {active = false;};
  }, [source.id]);
  const activeIds = own.filter(s => s.receipt && songOperationIsActive(s.receipt.status)).map(s=>s.requestId).join(',');
  useEffect(() => {
    if (!activeIds) return;
    let active = true;
    let timer: number;
    const poll = async () => {
      await Promise.all(activeIds.split(',').map(async requestId => {
        try { const r = await latest.current.services.get({requestId}); if(active) save(r); }
        catch(e) {if(active) setError(e instanceof Error ? e.message : '查询失败，请稍后查询原任务');}
      }));
      if(active) timer=window.setTimeout(poll,10000);
    };
    timer=window.setTimeout(poll,10000);
    return () => {active=false; window.clearTimeout(timer);};
  }, [activeIds]);
  const run = async (action:()=>Promise<void>) => {
    if(lock.current || disabled) return;
    lock.current=true; setBusy(true); setError('');
    try {await action();} catch(e) {setError(e instanceof Error?e.message:'操作失败，原记录已保留');}
    finally {lock.current=false;setBusy(false);}
  };
  const buildDraft = () => {
    const music = ['cover','extend','replace'].includes(operation);
    return songOperationDraftSchema.parse({operation, source, sourceOperationId:source.sourceOperationId, sourceVariantIndex:source.sourceVariantIndex,
      ...(music ? {title,prompt,style} : {}),
      ...songOperationMusicOptions(operation, {instrumental,audioWeight,duration}),
      ...(operation==='extend'?{continueAt}:{}),
      ...(operation==='replace'||operation==='persona'?{startSec:start,endSec:end}:{}),
      ...(operation==='persona'?{personaName,personaDescription}:{}),
      ...(['cover','extend'].includes(operation)&&personaRequestId?{personaRequestId}:{}),
    });
  };
  const matchesDraft = (receipt: SongOperationReceipt) => {
    try {return songOperationDraftKey(buildDraft()) === songOperationDraftKey(receipt.draft);} catch {return false;}
  };
  const prepare = () => run(async () => {
    const draft=buildDraft();
    const requestId=crypto.randomUUID();
    onSession({requestId,operation,sourceId:source.id});
    save(await services.prepare({requestId,draft}));
  });
  const locked=busy||disabled;
  const downloadSrt=(r:SongOperationReceipt)=>{
    if(!r.alignment)return;
    const url=URL.createObjectURL(new Blob([r.alignment.srt],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a'); a.href=url;a.download=`${source.title||'歌词'}-${r.requestId}.srt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <section aria-label="歌曲编辑工具" className="space-y-3 rounded-xl border border-violet-300/20 bg-violet-500/5 p-3">
    <div className="flex flex-wrap gap-1" role="tablist" aria-label="歌曲操作">{Object.entries(SONG_OPERATION_LABELS).map(([key,label])=><button key={key} role="tab" aria-selected={operation===key} className={`${button} ${operation===key?'bg-violet-500/25 text-violet-100':''}`} disabled={locked} onClick={()=>setOperation(key as SongOperationKind)}>{label}</button>)}</div>
    <p className="text-xs text-white/70">编辑：{source.title||'当前歌曲'} · {source.durationSec.toFixed(2)} 秒</p>
    {['cover','extend','replace'].includes(operation)&&<div className="space-y-2">
      <label className="block text-xs">新版本标题<input className={field} value={title} disabled={locked} onChange={e=>setTitle(e.target.value)}/></label>
      <label className="block text-xs">歌词 / 器乐结构<textarea className={field} rows={5} value={prompt} disabled={locked} onChange={e=>setPrompt(e.target.value)}/></label>
      <label className="block text-xs">音乐与演唱风格<textarea className={field} rows={2} value={style} disabled={locked} onChange={e=>setStyle(e.target.value)}/></label>
      {['cover','extend'].includes(operation)&&<label className="block text-xs">目标生成音频时长（秒，10–360）<input type="number" min={10} max={360} step={1} className={field} value={duration} disabled={locked} onChange={e=>setDuration(Number(e.target.value))}/></label>}
      {operation === 'cover' && <label className="block text-xs">参考音频强度（0–1）<input aria-label="参考音频强度" type="range" min={0} max={1} step={0.01} value={audioWeight} disabled={locked} className="w-full" onChange={e=>setAudioWeight(Number(e.target.value))}/><input aria-label="参考音频强度数值" type="number" min={0} max={1} step={0.01} className={field} value={audioWeight} disabled={locked} onChange={e=>setAudioWeight(Number(e.target.value))}/></label>}
      {operation === 'cover' && <label className="text-xs"><input type="checkbox" checked={instrumental} disabled={locked} onChange={e=>setInstrumental(e.target.checked)}/> 纯器乐</label>}
      {['cover','extend'].includes(operation)&&<label className="block text-xs">演唱风格<select className={field} value={personaRequestId} disabled={locked} onChange={e=>setPersonaRequestId(e.target.value)}><option value="">不指定已保存风格</option>{personas.map(s=><option key={s.requestId} value={s.requestId}>{s.receipt!.persona!.name}</option>)}</select></label>}
    </div>}
    {operation==='extend'&&<label className="block text-xs">从原曲第几秒续写<input type="number" className={field} min={0} max={source.durationSec} step="0.01" value={continueAt} disabled={locked} onChange={e=>setContinueAt(Number(e.target.value))}/></label>}
    {['replace','persona'].includes(operation)&&<div className="grid grid-cols-2 gap-2">{[['起点',start,setStart],['终点',end,setEnd]].map(([label,value,setter])=><label key={String(label)} className="text-xs">{String(label)}（秒）<input className={field} type="number" min={0} max={source.durationSec} step="0.01" value={value as number} disabled={locked} onChange={e=>(setter as (n:number)=>void)(Number(e.target.value))}/></label>)}</div>}
    {operation==='persona'&&<><label className="block text-xs">风格名称<input className={field} value={personaName} disabled={locked} onChange={e=>setPersonaName(e.target.value)}/></label><label className="block text-xs">风格描述<textarea className={field} value={personaDescription} disabled={locked} onChange={e=>setPersonaDescription(e.target.value)}/></label></>}
    {operation==='align'&&<p className="text-xs text-white/60">读取当前歌曲的实际歌词时间，返回后可核对、导出字幕并应用到 MV。</p>}
    {operation==='stems'&&<p className="text-xs text-white/60">拆出当前歌曲音轨，返回后逐轨试听并加入混音。</p>}
    <button className={button} disabled={locked} onClick={prepare}>查看本次发送内容与费用</button>
    {error&&<p role="alert" className="text-xs text-amber-200">{error}</p>}
    {own.slice().reverse().map(s=><details key={s.requestId} open={!s.receipt||s.receipt.status==='prepared'} className="rounded-md border border-white/10 p-2 text-xs"><summary>{SONG_OPERATION_LABELS[s.operation]} · {s.receipt?labels[s.receipt.status]:'准备回执待查询'}</summary>
      <p className="mt-2 break-all text-white/40">任务：{s.requestId}</p>
      {s.receipt&&<>
        <audio aria-label="本次来源试听" controls preload="none" className="mt-2 h-8 w-full" src={s.receipt.draft.source.url}/>
        <p className="my-2">费用：{s.receipt.creditsCost===null?'价格待确认，暂不可提交':`${s.receipt.creditsCost} 积分${s.receipt.creditsCost===0?'（免费）':''}`}</p>
        <dl className="space-y-1 whitespace-pre-wrap break-words">{Object.entries(s.receipt.draft).filter(([k,v])=>!['source','sourceOperationId','sourceVariantIndex','operation'].includes(k)&&v!==undefined&&(!['instrumental','audioWeight'].includes(k)||s.operation==='cover')&&(k!=='duration'||['cover','extend'].includes(s.operation))).map(([k,v])=><div key={k}><dt className="text-white/50">{({title:'标题',prompt:'歌词 / 结构',style:'风格',instrumental:'纯器乐',continueAt:'续写秒位',startSec:'起点秒位',endSec:'终点秒位',personaName:'演唱风格名称',personaDescription:'风格描述',personaRequestId:'所选演唱风格',duration:'目标时长',negativeTags:'排除风格',audioWeight:'参考音频强度',styleWeight:'风格权重',weirdnessConstraint:'变化度'} as Record<string,string>)[k]||k}</dt><dd>{k==='personaRequestId'?personas.find(p=>p.requestId===v)?.receipt?.persona?.name||'已保存风格':typeof v==='boolean'?(v?'是':'否'):String(v)}</dd></div>)}</dl>
        {s.receipt.error&&<p role="alert" className="my-2 text-amber-200">{s.receipt.error}</p>}
        {["extend","replace"].includes(s.operation)&&<p className="my-2 text-white/70">{s.operation === "extend" ? `保留原曲 0–${s.receipt.draft.continueAt} 秒，衔接续写音频，返回完整歌曲。` : `保留原曲 0–${s.receipt.draft.startSec} 秒与 ${s.receipt.draft.endSec}–${s.receipt.draft.source.durationSec} 秒，中间接入修订音频，返回完整歌曲。`}衔接处理免费；本次产品总价以以上确认价格为准，未定价时不可提交。</p>}
        {s.receipt.status==='prepared'&&!matchesDraft(s.receipt)&&<p className="my-2 text-amber-200">编辑内容已变化或当前工具不同，请重新查看发送内容与费用；此旧版本不可提交。</p>}
        {s.receipt.status==='prepared'&&<button className={`${button} mt-2`} disabled={locked||s.receipt.creditsCost===null||!matchesDraft(s.receipt)} onClick={()=>run(async()=>{if(!matchesDraft(s.receipt!)) throw new Error("内容已变化，请重新审阅"); save(await services.submit({requestId:s.requestId,inputDigest:s.receipt!.inputDigest,confirmed:true}));})}>确认以上内容并提交</button>}
        {["reconcile_required","payment_pending"].includes(s.receipt.status)&&<button className={`${button} mt-2`} disabled={locked} onClick={()=>run(async()=>save(await services.resume({requestId:s.requestId})))}>恢复原任务处理（不重新生成）</button>}
        {s.receipt.status==='succeeded'&&<div className="mt-2 space-y-2">
          {s.receipt.variants.map(v=><div key={v.index}><p>{v.stem||v.title||`版本 ${v.index+1}`} · {v.durationSec.toFixed(2)} 秒</p>{v.url?<audio controls preload="none" className="h-8 w-full" src={v.url}/>:<p>播放地址待恢复，请查询原任务</p>}</div>)}
          {['cover','extend','replace'].includes(s.operation)&&<button className={button} disabled={locked} onClick={()=>run(async()=>onCandidates(s.receipt!))}>保留为歌曲候选</button>}
          {s.operation==='stems'&&<button className={button} disabled={locked} onClick={()=>run(async()=>onStems(s.receipt!))}>加入逐轨混音</button>}
          {s.receipt.persona&&<p>已保存演唱风格：{s.receipt.persona.name}。改编或续写时可选择。</p>}
          {s.receipt.alignment&&<><div className="max-h-40 overflow-auto">{s.receipt.alignment.words.map((w,i)=><p key={i}>{w.startSec.toFixed(2)}–{w.endSec.toFixed(2)} 秒　{w.text}</p>)}</div><button className={button} onClick={()=>downloadSrt(s.receipt!)}>导出 SRT</button><button className={button} disabled={locked} onClick={()=>run(async()=>onAlignment(s.receipt!))}>应用到 MV 字幕</button></>}
        </div>}
      </>}
      <button className={`${button} mt-2`} disabled={locked} onClick={()=>run(async()=>save(await services.get({requestId:s.requestId})))}>查询原任务</button>
    </details>)}
  </section>;
}
