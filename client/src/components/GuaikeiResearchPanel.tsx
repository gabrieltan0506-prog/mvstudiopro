import { GuaikeiAutomationSettings } from "./GuaikeiAutomationSettings";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatGuaikeiEvidence, guaikeiDiscoveryKeywords, guaikeiLabels, guaikeiPlatforms, type GuaikeiRequest, type GuaikeiWindow } from "@shared/guaikei";

const statusLabels = { submitting: "提交中", pending: "等待结果", unknown: "结果待确认", failed: "需要检查", completed: "已保存", empty: "没有可用作品" };
const yuan = (cents: number | null | undefined) => cents === null || cents === undefined ? "待核实" : `¥${(cents / 100).toFixed(2)}`;

export function GuaikeiResearchPanel({ onAdopt, onAdoptReport }: {
  onAdopt: (text: string) => boolean;
  onAdoptReport?: (jobId: string, itemIds: string[]) => void;
}) {
  const [windowDays, setWindowDays] = useState<GuaikeiWindow>(15);
  const [platform, setPlatform] = useState<GuaikeiRequest["platform"]>("xiaohongshu");
  const [operation, setOperation] = useState<GuaikeiRequest["operation"]>("search");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(20);
  const [draft, setDraft] = useState<GuaikeiRequest | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [id, setId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(false);
  const utils = trpc.useUtils();
  const jobs = trpc.guaikei.list.useQuery();
  const quote = trpc.guaikei.quote.useQuery(draft!, { enabled: Boolean(draft), retry: false });
  const result = trpc.guaikei.get.useQuery({ id: id!, windowDays }, { enabled: Boolean(id), retry: false });
  const submit = trpc.guaikei.submit.useMutation({
    onSuccess: async job => { setId(job.id); setSelected([]); setMessage(job.message); await utils.guaikei.list.invalidate(); await utils.guaikei.quote.invalidate(); await utils.guaikei.get.invalidate({ id: job.id }); },
    onError: error => setMessage(error.message),
  });
  const poll = trpc.guaikei.poll.useMutation({
    onSuccess: async job => { setMessage(job.message); await utils.guaikei.get.invalidate({ id: job.id }); await utils.guaikei.list.invalidate(); },
    onError: error => setMessage(error.message),
  });
  const job = result.data;
  const busy = submit.isPending || poll.isPending;
  const rows = (job?.items || []).filter(item => `${item.title} ${item.author}`.toLowerCase().includes(filter.toLowerCase()));
  const change = () => { setDraft(null); setMessage(""); };
  const inputClass = "rounded-lg border border-white/20 bg-slate-950 px-3 py-2 text-sm text-white";
  return <section aria-label="外部资料采集" className="mt-5 rounded-xl border border-cyan-300/20 bg-slate-950/60 p-4 text-slate-100">
    <h3 className="font-semibold">外部资料采集 · GUAIKEI</h3>
    <p className="mt-1 text-xs text-slate-400">五平台按需采集，结果单独保存。手动请求确认后付费；自动采集按下方保存配置运行，费用来自管理员的供应商余额。</p>
    <GuaikeiAutomationSettings />
    <div className="mt-3 flex flex-wrap gap-2">
      <label className="text-xs">平台<select aria-label="采集平台" className={`${inputClass} ml-2`} value={platform} disabled={busy} onChange={e => { setPlatform(e.target.value as typeof platform); setOperation("search"); change(); }}>
        {guaikeiPlatforms.map(p => <option key={p} value={p}>{guaikeiLabels[p]}</option>)}
      </select></label>
      <label className="text-xs">任务<select aria-label="采集类型" className={`${inputClass} ml-2`} value={operation} disabled={busy} onChange={e => { setOperation(e.target.value as typeof operation); change(); }}>
        <option value="search">{platform === "wechat" ? "视频号搜索" : "关键词搜索"}</option>
        {platform !== "wechat" && <option value="posts">博主作品</option>}
      </select></label>
      <label className="text-xs">条数<input aria-label="最多采集条数" className={`${inputClass} ml-2 w-20`} type="number" min={1} max={100} value={limit} disabled={busy} onChange={e => { setLimit(Number(e.target.value)); change(); }} /></label>
    </div>
    <label className="mt-3 block text-xs">{operation === "posts" ? "博主主页链接或平台作者ID" : "关键词"}
      <input aria-label="采集关键词或作者" className={`${inputClass} mt-1 w-full`} value={query} maxLength={operation === "posts" ? 500 : 50} disabled={busy} onChange={e => { setQuery(e.target.value); change(); }} placeholder={operation === "posts" ? "从真实作品中确认作者后填写" : "输入具体事件、人物、生活问题或领域关键词"} />
    </label>
    {operation === "search" && <div className="mt-2 text-xs text-slate-300">
      <p>多领域发现入口（不是热点榜）：先浏览真实作品，再用具体事件、人物或问题深入检索。</p>
      <div className="mt-2 flex flex-wrap gap-2">{guaikeiDiscoveryKeywords[platform].map(keyword => <button key={keyword} type="button" disabled={busy} className="rounded border border-white/20 px-2 py-1" onClick={() => { setQuery(keyword); change(); }}>{keyword}</button>)}</div>
      <p className="mt-2 text-slate-400">关键词搜索只能代表检索范围；单一专题不能作为全平台趋势。</p>
    </div>}
    <label className="mt-2 flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={refresh} disabled={busy} onChange={e => { setRefresh(e.target.checked); change(); }} />重新购买同条件的新数据（默认复用24小时内已保存结果）</label>
    <button className="mt-3 rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40" disabled={busy || !query.trim() || !Number.isInteger(limit) || limit < 1 || limit > 100} onClick={() => { setDraft({ platform, operation, query: query.trim(), limit }); setRequestId(crypto.randomUUID()); }}>预览本次请求与费用</button>
    {quote.error && <p role="alert" className="mt-2 text-sm text-amber-300">{quote.error.message}</p>}
    {draft && quote.data && <div className="mt-3 rounded-lg bg-white/5 p-3 text-sm">
      <p>{guaikeiLabels[draft.platform]} · {draft.operation === "posts" ? "博主作品" : draft.operation === "articles" ? "公众号文章" : "搜索"} · {draft.query} · 最多{draft.limit}条</p>
      <p className="mt-1">参考费用 {yuan(quote.data.estimatedCents)}；预算预占 {yuan(quote.data.reservedCents)}；实际扣费待供应商账单核实。</p>
      <p className="text-xs text-slate-400">{quote.data.note}</p>
      <p className="text-xs text-slate-400">今日已预占 {yuan(quote.data.dailyReservedCents)} / {quote.data.dailyLimitCents ? yuan(quote.data.dailyLimitCents) : "未设上限"}；本月 {yuan(quote.data.monthlyReservedCents)} / {quote.data.monthlyLimitCents ? yuan(quote.data.monthlyLimitCents) : "未设上限"}。失败不自动释放预占。</p>
      {quote.data.blockedReason ? <p className="mt-2 text-amber-300">{quote.data.blockedReason}</p> : <button disabled={busy} className="mt-2 rounded-lg border border-cyan-300/60 px-3 py-2 disabled:opacity-40" onClick={() => submit.mutate({ request: draft, requestId, confirmedReservedCents: quote.data!.reservedCents, refresh })}>{submit.isPending ? "提交中…" : "确认付费采集"}</button>}
    </div>}
    {message && <p role="status" className="mt-2 text-sm text-amber-200">{message}</p>}
    {jobs.error && <p role="alert">{jobs.error.message}</p>}
    <div className="mt-4 flex flex-wrap gap-2">{jobs.data?.map(j => <button key={j.id} className={`rounded-lg border px-2 py-1 text-xs ${id === j.id ? "border-cyan-300" : "border-white/15"}`} onClick={() => { setId(j.id); setSelected([]); setMessage(""); }}>{guaikeiLabels[j.input.platform]} · {j.input.query.slice(0, 18)} · {statusLabels[j.status]}</button>)}</div>
    {result.error && <p role="alert" className="mt-2 text-amber-300">{result.error.message}</p>}
    <label className="mt-3 block text-xs">作品时间范围 <select aria-label="作品时间范围" className={inputClass} value={windowDays} onChange={e=>{setWindowDays(Number(e.target.value) as GuaikeiWindow);setSelected([]);}}>{([3,7,15] as const).map(days=><option key={days} value={days}>近{days}天</option>)}</select></label>
    {job && <div className="mt-3">
      <p className="text-sm">{statusLabels[job.status]} · 原始{job.rawCount}条 / 去重{job.duplicateCount}条 / 缺核心字段{job.rejectedCount}条 / 可用{job.items.length}条</p>
      <p className="text-xs text-slate-400">{job.message} · 实际费用：{yuan(job.actualCents)}</p>
      {["submitting", "pending", "unknown"].includes(job.status) && <button className="mt-2 rounded-lg border border-white/30 px-3 py-2 text-sm" disabled={busy} onClick={() => poll.mutate({ id: job.id })}>查询原任务结果（不重新创建）</button>}
      {job.items.length > 0 && <>
        <input aria-label="筛选采集结果" className={`${inputClass} mt-3 w-full`} value={filter} onChange={e => setFilter(e.target.value)} placeholder="按标题或作者筛选" />
        <div className="mt-2 max-h-80 overflow-auto">{rows.map(item => <label key={item.id} className="flex items-start gap-2 border-b border-white/10 py-2 text-sm">
          <input type="checkbox" className="mt-1" checked={selected.includes(item.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev, item.id] : prev.filter(value => value !== item.id))} />
          <span><span className="block">{item.title}</span><span className="text-xs text-slate-400">{item.author || "作者缺失"} · {item.publishedAt || "发布时间缺失"} · 赞 {item.likes ?? "未知"} · 评论 {item.comments ?? "未知"}</span>
            {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="ml-2 text-xs text-cyan-300">核对原作品</a> : <span className="ml-2 text-xs text-amber-300">无已核原链接</span>}</span>
        </label>)}</div>
        <button className="mt-3 rounded-lg bg-cyan-300 px-3 py-2 text-sm text-slate-950 disabled:opacity-40" disabled={!selected.length} onClick={() => {
          if (onAdopt(formatGuaikeiEvidence(job, selected))) setMessage(`已将${selected.length}条作为参考加入分析输入；尚未自动调用分析模型`);
          else setMessage("资料超出分析输入容量，请减少选择；本次没有截断或写入");
        }}>将选中{selected.length}条加入本次分析</button>
        {onAdoptReport && <button className="ml-2 mt-3 rounded-lg border border-cyan-300 px-3 py-2 text-sm disabled:opacity-40" disabled={!selected.length} onClick={() => {
          try { onAdoptReport(job.id, selected); setMessage("已加入趋势报告参考资料；生成时校验时间范围，跨平台作品仅作内容参考"); }
          catch (error) { setMessage(error instanceof Error ? error.message : "添加失败，请减少选择"); }
        }}>加入趋势报告</button>}
      </>}
    </div>}
  </section>;
}
