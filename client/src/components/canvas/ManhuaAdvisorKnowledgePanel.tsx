import { useState } from "react";
import { MANHUA_CRAFT_CATEGORIES, MANHUA_CRAFT_LESSONS, MANHUA_CRAFT_VERSION } from "../../../../shared/manhuaCraftKnowledge";
import { MANHUA_CRAFT_SOURCES } from "../../../../shared/manhuaCraftSources";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/** 显式刷新模板创作索引；查看资料和准备问题都不提交模型。 */
export function ManhuaAdvisorKnowledgePanel({ enabled, onPrepareQuestion }: { enabled: boolean; onPrepareQuestion?: (question: string) => void }) {
  const [category, setCategory] = useState<string>("全部");
  const [search, setSearch] = useState("");
  const lessons = MANHUA_CRAFT_LESSONS.filter(card => (category === "全部" || card.category === category) && `${card.title}${card.method}${card.boundary}${card.keywords.join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  const utils = trpc.useUtils();
  const query = trpc.mvAnalysis.inspectAdvisorKnowledge.useQuery(undefined, { enabled, retry: false, staleTime: 30_000 });
  const refresh = trpc.mvAnalysis.refreshAdvisorKnowledge.useMutation({ onSuccess: state => {
    utils.mvAnalysis.inspectAdvisorKnowledge.setData(undefined, state);
    if (state.status !== "ready") toast.error(state.error || "目录尚未更新，旧记录保留");
  }, onError: () => toast.error("更新暂未完成，请查看目录状态；未修改作品") });
  const state = query.data;
  return <section aria-label="顾问知识目录" className="rounded-lg border border-white/15 p-3 text-xs leading-5">
    <div className="flex items-center justify-between gap-2"><strong>模板库、导演包与工作流</strong>
      <button type="button" disabled={!enabled || refresh.isPending || state?.refreshing} onClick={() => refresh.mutate()} className="rounded border border-cyan-300/30 px-2 py-1 text-cyan-100 disabled:opacity-40">{refresh.isPending ? "正在更新…" : "更新知识目录"}</button></div>
    <p role="status">{query.isError ? "暂时无法读取目录状态。" : state?.snapshot
      ? `${state.status === "stale" ? "旧快照 · " : ""}${state.snapshot.templates.length} 个模板 · ${state.snapshot.directors.length} 个导演包 · 扫描于 ${new Date(state.snapshot.scannedAt).toLocaleString()}`
      : "首次咨询会自动读取已批准模板；也可在这里主动更新。"}</p>
    {state?.error && <p className="text-amber-100">{state.error}</p>}
    {state?.changes && <p>本次新增 {state.changes.added.length}、更新 {state.changes.updated.length}、移除 {state.changes.deleted.length}；其余 {state.changes.unchangedCount} 个沿用原版本。</p>}
    <p className="text-white/55">更新已批准模板的完整创作字段索引，不调用生成模型。新导演包不会自动替换本作品已确认版本；画面质量仍需看实际成片。</p>
    {state?.snapshot && <p>已索引 {state.snapshot.templates.filter(t => (t.evidenceChunks || 0) > 0).length}/{state.snapshot.templates.length} 份模板创作内容；咨询时选读相关原文并核对版本。服务重启后会在首次咨询时重新准备。</p>}
    <details className="mt-3 border-t border-white/10 pt-2">
      <summary className="cursor-pointer font-medium">创作学习资料 · {MANHUA_CRAFT_SOURCES.length} 张来源 · {MANHUA_CRAFT_LESSONS.length} 条审订知识</summary>
      <p className="my-2 text-white/60">版本 {MANHUA_CRAFT_VERSION}。可使用表示方法可参考；需补强表示应用条件已注明，仍须结合当前作品核对。资料未作为生成素材采用。</p>
      <label>分类<select aria-label="学习资料分类" value={category} onChange={event => setCategory(event.target.value)} className="ml-2 rounded bg-slate-900 p-1"><option>全部</option>{MANHUA_CRAFT_CATEGORIES.map(item => <option key={item}>{item}</option>)}</select></label>
      <input aria-label="搜索学习资料" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索光影、动作、焦距或道具" className="my-2 w-full rounded border border-white/20 bg-transparent p-2" />
      <p role="status">找到 {lessons.length} 条</p>
      <div className="max-h-96 space-y-2 overflow-y-auto">{lessons.map(card => <article key={card.id} className="rounded border border-white/10 p-2">
        <strong>{card.title}</strong><span className="ml-2 text-amber-100">{card.status}</span><p>{card.method}</p><p className="text-white/60">应用边界：{card.boundary}</p>
        <p className="text-white/40">学习来源 {card.sourceIds.map(id => id.replace("ref-", "")).join("、")}</p>
        {onPrepareQuestion && <button type="button" disabled={!enabled} onClick={() => onPrepareQuestion(`请结合当前剧情与镜头，应用学习条目 ${card.id}（${card.title}）提出具体建议，说明适用位置、修改方法和限制；不要生成或自动采用。`)} className="mt-1 rounded border border-cyan-300/30 px-2 py-1 text-cyan-100 disabled:opacity-40">准备顾问问题</button>}
      </article>)}</div>
    </details>
  </section>;
}
