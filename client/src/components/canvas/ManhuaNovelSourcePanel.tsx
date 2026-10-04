import { buildNovelSourceGuide, composeNovelSourceSelection } from "@shared/novelSourceGuide";
import type { ManhuaWriterEpisode } from "@shared/manhuaWriterRoom";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { novelDraftChapters, NOVEL_SOURCE_MAX_CHARS, prepareNovelExcerpt, type ManhuaNovelDraft } from "@shared/manhuaNovelSource";

/** Source preparation only. Generation stays behind the existing writer confirmation and billing. */
export function ManhuaNovelSourcePanel({ value, onChange, disabled, episodes, saveError, inline = false, fileInputRef }: {
  value: ManhuaNovelDraft | null; onChange: (draft: ManhuaNovelDraft | null) => void; disabled?: boolean; episodes?: ManhuaWriterEpisode[]; saveError?: boolean; inline?: boolean; fileInputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [guideQuery, setGuideQuery] = useState("");
  const [guidePage, setGuidePage] = useState(0);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState("");
  const [forceOcr, setForceOcr] = useState(false);
  const importAbort = useRef<AbortController | null>(null);
  const internalFileRef = useRef<HTMLInputElement>(null);
  const fileRef = fileInputRef ?? internalFileRef;
  const Container = inline ? "section" : "details";
  const fileReadEpoch = useRef(0);
  useEffect(() => { fileReadEpoch.current++; return () => { fileReadEpoch.current++; importAbort.current?.abort(); }; }, [value]);
  const draft = value ?? { name: "", text: "", from: 0, to: 0, enabled: false };
  const chapters = useMemo(() => novelDraftChapters(draft), [draft.text, draft.chapters]);
  const guide = useMemo(() => buildNovelSourceGuide(draft), [draft.text, draft.chapters]);
  const matches = guide.filter(b => (b.title + draft.text.slice(chapters[b.from].start, chapters[b.to].end)).includes(guideQuery.trim()));
  const page = Math.min(guidePage, Math.max(0, Math.ceil(matches.length / 4) - 1));
  const range = draft.selections?.length ? composeNovelSourceSelection(draft) : chapters[draft.from] && chapters[draft.to]
    ? draft.text.slice(chapters[draft.from].start, chapters[draft.to].end) : "";
  let selectionError = "";
  if (draft.enabled) { try { prepareNovelExcerpt(draft); } catch (e) { selectionError = e instanceof Error ? e.message : "选段无效"; } }
  const replaceText = (text: string, name = draft.name) => {
    if (text.length > NOVEL_SOURCE_MAX_CHARS) { setError("原文超过40万字，请按卷分批导入；当前原文保留。"); return; }
    setError(""); onChange({ name, text, from: 0, to: 0, enabled: draft.enabled });
  };
  return <Container className="my-3 rounded-xl border border-white/15 bg-white/[0.03] p-3" data-manhua-novel-source>
    {!inline && <summary className="cursor-pointer text-sm font-semibold text-white/80">底本改编 · 原文与章节 <span className="text-xs font-normal text-white/45">{value?.text ? `${chapters.length} 个选段` : "可选"}</span></summary>}
    <div className="mt-3 space-y-3">
      <p className="text-xs leading-5 text-white/55">doc、docx、pdf、md、txt、epub。上传后选择正文范围，再填写创作方向。</p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" disabled={disabled || importing} onClick={()=>fileRef.current?.click()} className="rounded-lg border border-white/20 px-3 py-2">导入文件</button>
        <span className="text-white/45">{draft.text.length.toLocaleString()} / 400,000 字符</span>
        <input ref={fileRef} type="file" accept=".epub,.pdf,.docx,.doc,.txt,.md,.markdown,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown" disabled={disabled || importing} className="hidden" onChange={async e=>{
          const file=e.target.files?.[0]; e.target.value=""; if(!file)return;
          importAbort.current?.abort();
          const controller=new AbortController(); importAbort.current=controller;
          const epoch=++fileReadEpoch.current;
          setImporting(true); setError(""); setProgress("正在读取文件…");
          try {
            const { importManhuaDocument } = await import("@/lib/manhuaDocumentImport");
            const result = await importManhuaDocument(file,{signal:controller.signal,forceOcr,onProgress:message=>{if(epoch===fileReadEpoch.current)setProgress(message);}});
            if(epoch===fileReadEpoch.current)onChange(result);
          } catch(error) {
            if(epoch===fileReadEpoch.current)setError(controller.signal.aborted ? "导入已取消，当前原文保留。" : error instanceof Error ? error.message : "文件导入失败，当前原文保留。");
          } finally { if(importAbort.current===controller) { setImporting(false); importAbort.current=null; } }

        }} />
      </div>
      <label className="flex items-center gap-2 text-xs text-white/65"><input type="checkbox" aria-label="PDF全部页面OCR" checked={forceOcr} disabled={disabled || importing} onChange={e=>setForceOcr(e.target.checked)}/>PDF 全页 OCR（扫描页自动识别）</label>
      {importing ? <div className="flex items-center gap-2 text-xs"><span role="status">{progress}</span><button type="button" onClick={()=>importAbort.current?.abort()} className="rounded border px-2 py-1">取消导入</button></div> : null}
      {draft.importInfo?.warnings.map((warning,index)=><p key={index} className="text-xs text-amber-200">{warning}</p>)}
      {draft.epubImageCount !== undefined && draft.chapters ? <p role="status" className="text-xs text-white/60">{`已按书内阅读顺序导入 ${draft.chapters!.length} 节。${draft.epubImageCount ? `含 ${draft.epubImageCount} 处插图，本次仅导入文字与图注；插图内容未识别。` : ""}`}</p> : null}
      {guide.length > 0 && <section aria-label="底本内容导览" className="max-h-96 overflow-y-auto space-y-2 rounded-lg border border-amber-200/20 p-3">
        <h3 className="font-semibold text-sm">从哪些内容开始改编？</h3>
        <p className="text-xs text-white/60">按正文标题分组，长章拆成小段。下方为原文摘句，供你了解内容；选好后由创作顾问组织故事。</p>
        <input aria-label="搜索底本内容" placeholder="搜索人物、事件或章节…" value={guideQuery} onChange={e=>{setGuideQuery(e.target.value);setGuidePage(0);}} className="w-full rounded border border-white/20 bg-black/20 p-2 text-xs" />
        {matches.slice(page*4,page*4+4).map(b => {
          const checked = !!draft.selections?.some(r=>r.from===b.from && r.to===b.to);
          return <label key={b.id} className="block rounded border border-white/15 p-2 text-xs">
            <span className="flex gap-2"><input type="checkbox" aria-label={`组合板块 ${b.id}`} checked={checked} disabled={disabled || importing} onChange={()=>onChange({...draft, enabled:true, selections: checked ? draft.selections!.filter(r=>r.from!==b.from || r.to!==b.to) : [...(draft.selections || []), {from:b.from,to:b.to}]})}/><strong>{b.title}</strong></span>
            <p className="mt-1 text-white/50">{chapters[b.from].title} → {chapters[b.to].title} · {b.chars.toLocaleString()} 字符</p>
            <p className="mt-2 leading-5 text-white/75">{b.preview}</p>
          </label>;
        })}
        {!matches.length && <p className="text-xs">没有匹配内容，请换一个关键词。</p>}
        <div className="flex items-center gap-3 text-xs"><button type="button" disabled={!page} onClick={()=>setGuidePage(page-1)}>上一组</button><span>{page+1}/{Math.max(1,Math.ceil(matches.length/4))} · {matches.length}个板块</span><button type="button" disabled={(page+1)*4>=matches.length} onClick={()=>setGuidePage(page+1)}>下一组</button></div>
        {!!draft.selections?.length && <div className="space-y-2 border-t border-white/15 pt-2">
          <p className="text-xs">组合顺序 · {draft.selections.length} 个板块；顾问需核对年代、关系与衔接</p>
          {draft.selections.map((r,i)=><div key={`${r.from}-${r.to}`} className="flex items-center gap-2 text-xs"><span>{i+1}. {guide.find(b=>b.from===r.from&&b.to===r.to)?.title || chapters[r.from].title}</span><button type="button" disabled={disabled || i===0} onClick={()=>{const selections=[...draft.selections!];[selections[i-1],selections[i]]=[selections[i],selections[i-1]];onChange({...draft,selections});}}>上移</button><button type="button" disabled={disabled} onClick={()=>onChange({...draft,selections:draft.selections!.filter((_,n)=>n!==i)})}>移除</button></div>)}
        </div>}
      </section>}
      {chapters.length ? <>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label>起始章节<select aria-label="小说起始章节" disabled={disabled} value={draft.from} onChange={e=>{const from=Number(e.target.value);onChange({...draft,selections:undefined,from,to:Math.max(from,draft.to)});}} className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 p-2">{chapters.map((c,i)=><option key={c.start} value={i}>{i+1}. {c.title}</option>)}</select></label>
          <label>结束章节<select aria-label="小说结束章节" disabled={disabled} value={draft.to} onChange={e=>onChange({...draft,selections:undefined,to:Number(e.target.value)})} className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 p-2">{chapters.map((c,i)=>i>=draft.from?<option key={c.start} value={i}>{i+1}. {c.title}</option>:null)}</select></label>
        </div>
        <p role="status" className="text-xs text-white/60">已选 {draft.selections?.length ? `${draft.selections.length} 个组合板块` : `${draft.to-draft.from+1}/${chapters.length} 段`} · {range.length.toLocaleString()} / 20,000 字符；未选章节不会发送给编剧。</p>
        <details className="text-xs text-white/65"><summary className="cursor-pointer">查看本次完整原文</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-black/15 p-2 leading-5">{range}</pre></details>
      </> : null}
      <label className="flex items-center gap-2 text-xs text-white/80"><input type="checkbox" aria-label="采用小说原文" checked={draft.enabled} disabled={disabled || !draft.text.trim()} onChange={e=>onChange({...draft,enabled:e.target.checked})}/>将所选底本用于本次改编</label>
      <details className="text-xs"><summary className="cursor-pointer">查看或编辑完整底本</summary>
      <label className="block text-xs text-white/65">原著 / 文件名
        <input aria-label="小说来源名称" value={draft.name} maxLength={120} disabled={disabled} onChange={e=>onChange({...draft,name:e.target.value})} className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-2 py-2" />
      </label>
      <textarea aria-label="小说原文" value={draft.text} disabled={disabled} onChange={e=>replaceText(e.target.value)} rows={5} placeholder={'第一章 标题\n原文…\n第二章 标题\n原文…'} className="w-full resize-y rounded-lg border border-white/15 bg-black/20 p-2 text-xs leading-5 text-white/80" />
      </details>
      {episodes?.some(ep=>ep.sourceExcerpt) ? <details className="border-t border-white/10 pt-3 text-xs text-white/70"><summary className="cursor-pointer">当前剧情包 · 原文对照与来源</summary>
        {episodes.filter(ep=>ep.sourceExcerpt).map(ep=><details key={ep.index} className="mt-2 rounded-lg border border-white/10 p-2"><summary className="cursor-pointer">第{ep.index}集 · {ep.sourceExcerpt!.label}</summary>{ep.novelAdaptation ? <details className="my-2"><summary>查看改编小说</summary><h4>{ep.novelAdaptation.title}</h4><pre className="max-h-64 overflow-auto whitespace-pre-wrap leading-5">{ep.novelAdaptation.text}</pre><p className="whitespace-pre-wrap">{ep.novelAdaptation.adaptationNotes}</p></details> : null}<p className="my-2 whitespace-pre-wrap leading-5">{ep.sourceNotes || "无改编对照记录"}</p><p className="break-all text-white/40">来源指纹：{ep.sourceSha256 || "未记录"}</p><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap leading-5">{ep.sourceExcerpt!.text}</pre></details>)}
      </details> : null}
      {saveError ? <p role="alert" className="text-xs text-amber-200">编剧快照未能保存到本机。请先使用「上传备份」保留原文与草稿，再离开页面。</p> : null}
      {error || selectionError ? <p role="alert" className="text-xs text-amber-200">{error || selectionError}</p> : null}
    </div>
  </Container>;
}
