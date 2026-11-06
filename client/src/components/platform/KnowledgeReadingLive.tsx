import type { ReadingDraft } from "@/lib/knowledgeReadingPreparation";

/** 只显示服务器已保存的真实整理稿，保持全文可读，不覆盖用户正文或手动会话。 */
export function KnowledgeReadingLive({status,drafts}:{status:string;drafts:ReadingDraft[]}) {
  if(!status && !drafts.length)return null;
  return <section aria-label="读档同步整理" className="w-full rounded-lg border border-cyan-400/20 bg-slate-950/40 p-3">
    <p role="status" className="text-xs text-cyan-100">{status}</p>
    {drafts.length>0 && <><p className="mt-2 text-xs text-slate-400">已整理内容持续更新，可立即查看；最终统稿仍在继续。</p>
      <div className="mt-2 max-h-[28rem] space-y-3 overflow-auto">
        {[...drafts].sort((a,b)=>a.index-b.index).map(draft=><details key={draft.index} open className="rounded border border-white/10 p-3">
          <summary className="cursor-pointer text-sm text-cyan-100">{draft.pages[0]?.headline || "已整理内容"}</summary>
          {draft.pages.map((page,index)=><article key={index} className="mt-3"><h4 className="font-medium text-slate-100">{page.headline}</h4><div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{page.body}</div></article>)}
        </details>)}
      </div></>}
  </section>;
}
