import type { ManhuaWriterEpisode } from "@shared/manhuaWriterRoom";
import { useEffect, useMemo, useRef, useState } from "react";
import { novelDraftChapters, NOVEL_SOURCE_MAX_CHARS, prepareNovelExcerpt, type ManhuaNovelDraft } from "@shared/manhuaNovelSource";

/** Source preparation only. Generation stays behind the existing writer confirmation and billing. */
export function ManhuaNovelSourcePanel({ value, onChange, disabled, episodes, saveError }: {
  value: ManhuaNovelDraft | null; onChange: (draft: ManhuaNovelDraft | null) => void; disabled?: boolean; episodes?: ManhuaWriterEpisode[]; saveError?: boolean;
}) {
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileReadEpoch = useRef(0);
  useEffect(() => { fileReadEpoch.current++; return () => { fileReadEpoch.current++; }; }, [value]);
  const draft = value ?? { name: "", text: "", from: 0, to: 0, enabled: false };
  const chapters = useMemo(() => novelDraftChapters(draft), [draft.text, draft.chapters]);
  const range = chapters[draft.from] && chapters[draft.to]
    ? draft.text.slice(chapters[draft.from].start, chapters[draft.to].end) : "";
  let selectionError = "";
  if (draft.enabled) { try { prepareNovelExcerpt(draft); } catch (e) { selectionError = e instanceof Error ? e.message : "选段无效"; } }
  const replaceText = (text: string, name = draft.name) => {
    if (text.length > NOVEL_SOURCE_MAX_CHARS) { setError("原文超过40万字，请按卷分批导入；当前原文保留。"); return; }
    setError(""); onChange({ name, text, from: 0, to: 0, enabled: draft.enabled });
  };
  return <details className="my-3 rounded-xl border border-white/15 bg-white/[0.03] p-3" data-manhua-novel-source>
    <summary className="cursor-pointer text-sm font-semibold text-white/80">小说改编 · 原文与章节 <span className="text-xs font-normal text-white/45">{value?.text ? `${chapters.length} 个选段` : "可选"}</span></summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs leading-5 text-white/55">导入原著、选定本次章节，再使用下方扩写。原文保留，选段不会扣点或自动生成。可搭配下方故事模板的节奏与表现手法；真人剧、漫剧模板均沿用原有目录。EPUB 按书内顺序分节；纯文本没有章节标题时按全文处理。</p>
      <label className="block text-xs text-white/65">原著 / 文件名
        <input aria-label="小说来源名称" value={draft.name} maxLength={120} disabled={disabled} onChange={e=>onChange({...draft,name:e.target.value})} className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-2 py-2" />
      </label>
      <textarea aria-label="小说原文" value={draft.text} disabled={disabled} onChange={e=>replaceText(e.target.value)} rows={5} placeholder={'第一章 标题\n原文…\n第二章 标题\n原文…'} className="w-full resize-y rounded-lg border border-white/15 bg-black/20 p-2 text-xs leading-5 text-white/80" />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" disabled={disabled || importing} onClick={()=>fileRef.current?.click()} className="rounded-lg border border-white/20 px-3 py-2">导入 EPUB / TXT / Markdown</button>
        <span className="text-white/45">{draft.text.length.toLocaleString()} / 400,000 字符</span>
        <input ref={fileRef} type="file" accept=".epub,.txt,.md,.markdown,application/epub+zip,text/plain,text/markdown" className="hidden" onChange={async e=>{
          const file=e.target.files?.[0]; e.target.value=""; if(!file)return;
          const epoch=++fileReadEpoch.current;
          if (/\.epub$/i.test(file.name)) {
            setImporting(true); setError("");
            try {
              const { importManhuaEpub } = await import("@/lib/manhuaEpubImport");
              const result = await importManhuaEpub(file);
              if (epoch !== fileReadEpoch.current) return;
              onChange(result.draft);
            } catch (error) { if (epoch === fileReadEpoch.current) setError(error instanceof Error ? error.message : "EPUB 导入失败，当前原文保留。"); }
            finally { setImporting(false); }
            return;
          }
          if(file.size>2_000_000){setError("文件超过2MB，请按卷分批导入；当前原文保留。");return;}
          try { const text=await file.text(); if(epoch!==fileReadEpoch.current)return; if(text.includes("\uFFFD")){setError("文件不是有效UTF-8文本，请转换编码后导入；当前原文保留。");return;} replaceText(text,file.name.slice(0,120)); }
          catch {if(epoch===fileReadEpoch.current)setError("文件读取失败，当前原文保留。");}
        }} />
      </div>
      {importing || draft.chapters ? <p role="status" className="text-xs text-white/60">{importing ? "正在读取书内章节…" : `已按书内阅读顺序导入 ${draft.chapters!.length} 节。${draft.epubImageCount ? `含 ${draft.epubImageCount} 处插图，本次仅导入文字与图注；插图内容未识别。` : ""}`}</p> : null}
      {chapters.length ? <>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label>起始章节<select aria-label="小说起始章节" disabled={disabled} value={draft.from} onChange={e=>{const from=Number(e.target.value);onChange({...draft,from,to:Math.max(from,draft.to)});}} className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 p-2">{chapters.map((c,i)=><option key={c.start} value={i}>{i+1}. {c.title}</option>)}</select></label>
          <label>结束章节<select aria-label="小说结束章节" disabled={disabled} value={draft.to} onChange={e=>onChange({...draft,to:Number(e.target.value)})} className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 p-2">{chapters.map((c,i)=>i>=draft.from?<option key={c.start} value={i}>{i+1}. {c.title}</option>:null)}</select></label>
        </div>
        <p role="status" className="text-xs text-white/60">已选 {draft.to-draft.from+1}/{chapters.length} 段 · {range.length.toLocaleString()} / 20,000 字符；未选章节不会发送给编剧。</p>
        <details className="text-xs text-white/65"><summary className="cursor-pointer">查看本次完整原文</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-black/15 p-2 leading-5">{range}</pre></details>
      </> : null}
      <label className="flex items-center gap-2 text-xs text-white/80"><input type="checkbox" checked={draft.enabled} disabled={disabled || !draft.text.trim()} onChange={e=>onChange({...draft,enabled:e.target.checked})}/>将所选原文用于本次扩写</label>
      {episodes?.some(ep=>ep.sourceExcerpt) ? <details className="border-t border-white/10 pt-3 text-xs text-white/70"><summary className="cursor-pointer">当前剧情包 · 原文对照与来源</summary>
        {episodes.filter(ep=>ep.sourceExcerpt).map(ep=><details key={ep.index} className="mt-2 rounded-lg border border-white/10 p-2"><summary className="cursor-pointer">第{ep.index}集 · {ep.sourceExcerpt!.label}</summary><p className="my-2 whitespace-pre-wrap leading-5">{ep.sourceNotes || "无改编对照记录"}</p><p className="break-all text-white/40">来源指纹：{ep.sourceSha256 || "未记录"}</p><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap leading-5">{ep.sourceExcerpt!.text}</pre></details>)}
      </details> : null}
      {saveError ? <p role="alert" className="text-xs text-amber-200">编剧快照未能保存到本机。请先使用「上传备份」保留原文与草稿，再离开页面。</p> : null}
      {error || selectionError ? <p role="alert" className="text-xs text-amber-200">{error || selectionError}</p> : null}
    </div>
  </details>;
}
