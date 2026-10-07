import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/** Explicit metadata refresh; mounting and ordinary chat only inspect the server cache. */
export function ManhuaAdvisorKnowledgePanel({ enabled }: { enabled: boolean }) {
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
      : "尚未扫描；顾问不会把旧资料声称为最新全库。"}</p>
    {state?.error && <p className="text-amber-100">{state.error}</p>}
    {state?.changes && <p>本次新增 {state.changes.added.length}、更新 {state.changes.updated.length}、移除 {state.changes.deleted.length}；其余 {state.changes.unchangedCount} 个沿用原版本。</p>}
    <p className="text-white/55">只更新目录，不调用生成模型。新导演包不会自动替换本作品已确认版本；画面质量仍需看实际成片。</p>
  </section>;
}
