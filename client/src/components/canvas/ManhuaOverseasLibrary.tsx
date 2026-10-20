import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MANHUA_CAMERA_MOVE_BANK } from "../../../../shared/manhuaCameraMoveBank";
import { MANHUA_OVERSEAS_CATEGORIES, MANHUA_OVERSEAS_FILMS, MANHUA_OVERSEAS_METHODS, prepareOverseasAdvisorQuestion, type OverseasCategory } from "../../../../shared/manhuaOverseasKnowledge";

export function ManhuaOverseasLibrary({ onPrepareQuestion, enabled = true }: { onPrepareQuestion?: (question: string) => void; enabled?: boolean }) {
  const [category, setCategory] = useState<OverseasCategory>("故事素材");
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const films = MANHUA_OVERSEAS_FILMS.filter(row => [row.titleZh, row.sourceTitle, row.themeZh, row.storyZh, row.adaptationZh, row.id].join(" ").toLowerCase().includes(query));
  const methods = MANHUA_OVERSEAS_METHODS.filter(row => row.category === category && [row.titleZh, row.methodZh, row.boundaryZh, row.id].join(" ").toLowerCase().includes(query));
  const prepare = (id: string) => onPrepareQuestion?.(prepareOverseasAdvisorQuestion(id));
  return <section aria-label="漫剧出海素材库" className="space-y-3 text-sm leading-6">
    <p>32 部短片的故事结构与跨片技法。用来发展自己的角色、剧情和镜头，不作为原片素材直接生成。</p>
    <div role="group" aria-label="漫剧出海分类" className="flex flex-wrap gap-2">{MANHUA_OVERSEAS_CATEGORIES.map(name => <button key={name} type="button" aria-pressed={category === name} onClick={() => { setCategory(name); setSearch(""); }} className={`rounded-lg border px-3 py-1 ${category === name ? "border-cyan-300 bg-cyan-400/15 text-cyan-100" : "border-white/20 text-white/70"}`}>{name}</button>)}</div>
    <input aria-label="搜索漫剧出海素材" placeholder="搜索故事主题或技法" value={search} onChange={event => setSearch(event.target.value)} className="w-full rounded-lg border border-white/20 bg-transparent px-3 py-2" />
    <p role="status" className="text-white/60">{category === "故事素材" ? `${films.length} 部故事 · ${methods.length} 条跨片方法` : `${methods.length} 条方法`} · 选择后可准备顾问问题，由你确认发送</p>
    <div className="space-y-3">
      {category === "故事素材" && films.map(film => <article key={film.id} className="rounded-xl border border-white/15 bg-white/[0.03] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold text-white">{film.titleZh}</h3><span className="text-xs text-cyan-100">{film.themeZh}</span></div>
        <p className="mt-2">{film.storyZh}</p><p className="mt-2 text-white/75">可迁移结构：{film.adaptationZh}</p>
        <p className="mt-2 text-xs text-amber-100/85">核对提示：{film.cautionZh}</p>
        <div className="mt-2 flex flex-wrap gap-2">{film.methodIds.map(id => { const item = MANHUA_OVERSEAS_METHODS.find(row => row.id === id); return item ? <button type="button" key={id} className="rounded border border-white/15 px-2 text-xs text-white/65" onClick={() => { setCategory(item.category); setSearch(item.titleZh); }}>{item.category} · {item.titleZh}</button> : null; })}</div>
        <details className="mt-2 text-xs text-white/55"><summary className="cursor-pointer">来源与核对范围</summary><p>{film.sourceTitle} · 参考 {film.evidence.fromSec}—{film.evidence.toSec} 秒 / 全长 {film.evidence.durationSec} 秒</p><p>{film.evidence.verificationZh}</p><p className="break-all">源文件 SHA256：{film.evidence.sourceSha256}</p><a href={film.evidence.sourceUrl} target="_blank" rel="noreferrer" className="underline">查看公开原片</a></details>
        {onPrepareQuestion && <button type="button" disabled={!enabled} onClick={() => prepare(film.id)} className="mt-3 rounded border border-cyan-300/30 px-3 py-1 text-cyan-100 disabled:opacity-40">围绕这个故事准备顾问问题</button>}
      </article>)}
      {methods.map(item => <article key={item.id} className="rounded-xl border border-white/15 bg-white/[0.03] p-4">
        <h3 className="font-semibold">{item.titleZh}</h3><p className="mt-2">{item.methodZh}</p><p className="mt-2 text-xs text-amber-100/85">应用边界：{item.boundaryZh}</p>
        {item.cameraMoveIds && <p className="mt-2 text-xs text-white/65">组合现有运镜：{item.cameraMoveIds.map(id => MANHUA_CAMERA_MOVE_BANK.find(row => row.id === id)?.nameZh || id).join(" → ")}</p>}
        <details className="mt-2 text-xs text-white/55"><summary className="cursor-pointer">{item.filmIds.length} 部来源与参考段</summary>{item.filmIds.map(id => { const film = MANHUA_OVERSEAS_FILMS.find(row => row.id === id)!; return <p key={id}><button type="button" className="underline" onClick={() => { setCategory("故事素材"); setSearch(film.titleZh); }}>{film.titleZh}</button> · {film.evidence.fromSec}—{film.evidence.toSec} 秒</p>; })}</details>
        {onPrepareQuestion && <button type="button" disabled={!enabled} onClick={() => prepare(item.id)} className="mt-3 rounded border border-cyan-300/30 px-3 py-1 text-cyan-100 disabled:opacity-40">准备这项技法的顾问问题</button>}
      </article>)}
      {(category === "故事素材" ? films.length + methods.length : methods.length) === 0 && <p className="py-6 text-white/60">没有匹配的条目，请清空搜索或切换分类。</p>}
    </div>
  </section>;
}

/** 只打开资料和预填问题；不发起模型请求或覆盖作品。 */
export function ManhuaOverseasLibraryButton({ onPrepareQuestion, enabled }: { onPrepareQuestion: (question: string) => void; enabled: boolean }) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><button type="button" className="shrink-0 rounded-lg border border-amber-200/30 bg-amber-200/5 px-3 py-2 text-sm text-amber-100">漫剧出海</button></DialogTrigger>
    <DialogContent className="max-h-[85dvh] max-w-4xl overflow-y-auto border-white/20 bg-slate-950 text-white" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>漫剧出海 · 内容与技法</DialogTitle></DialogHeader>
      <ManhuaOverseasLibrary enabled={enabled} onPrepareQuestion={question => { setOpen(false); onPrepareQuestion(question); }} />
    </DialogContent>
  </Dialog>;
}

/** 各工作区共用同一审订目录；只准备建议，不把文字当成骨骼能力。 */
export function ManhuaOverseasMethodReference({ category, onPrepareQuestion, onAppendDirection, disabled = false }: {
  category: OverseasCategory; onPrepareQuestion?: (question: string) => void; onAppendDirection?: (text: string) => void; disabled?: boolean;
}) {
  return <details className="mt-2 rounded-lg border border-white/10 p-2 text-xs">
    <summary className="cursor-pointer text-amber-100/80">出海短片 · {category}手法参考</summary>
    <div className="mt-2 max-h-72 space-y-3 overflow-auto">{MANHUA_OVERSEAS_METHODS.filter(row => row.category === category).map(item => <article key={item.id}>
      <strong>{item.titleZh}</strong><p className="mt-1 text-white/65">{item.methodZh}</p><p className="text-white/45">{item.boundaryZh}</p>
      <p className="text-white/40">来源：{item.filmIds.map(id => MANHUA_OVERSEAS_FILMS.find(film => film.id === id)!.titleZh).join("、")}</p>
      {onPrepareQuestion && <button type="button" disabled={disabled} className="mt-1 rounded border border-white/20 px-2 py-1 disabled:opacity-40" onClick={() => onPrepareQuestion(prepareOverseasAdvisorQuestion(item.id))}>准备顾问问题</button>}
      {onAppendDirection && <button type="button" disabled={disabled} className="mt-1 rounded border border-white/20 px-2 py-1 disabled:opacity-40" onClick={() => onAppendDirection(`【${item.titleZh}】${item.methodZh}\n应用边界：${item.boundaryZh}`)}>补入本镜待编辑描述</button>}
    </article>)}</div>
  </details>;
}
