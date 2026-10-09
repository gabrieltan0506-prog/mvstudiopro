import { useState } from "react";
import { ArrowRight, Check, Download, FileInput, FileText, Image, Library, Loader2, UploadCloud } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { flyDownloadUrl } from "@/lib/gcsTransfer";
import { FILE_CONVERSION_FREE_MAX_BYTES, FILE_CONVERSION_FREE_LIMIT, type FileConversionLane, FILE_CONVERSION_FORMATS, fileConversionFormat, validateConversionFile } from "@shared/fileConversion";

const stateLabels: Record<string, string> = { queued: "排队中", running: "处理中", succeeded: "处理结束", failed: "未完成", receipt_pending: "结果保存待恢复", refund_pending: "退款处理中" };
export default function HomeFileConversion() {
  const { user } = useAuth();
  const [lane, setLane] = useState<FileConversionLane>("free");
  const [formatId, setFormatId] = useState("pdf-docx");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const catalog = trpc.fileConversion.formats.useQuery(undefined, { enabled: !!user, retry: false });
  const history = trpc.fileConversion.history.useQuery(undefined, { enabled: !!user, retry: false,
    refetchInterval: query => query.state.data?.some(item => ["queued", "running", "receipt_pending", "refund_pending"].includes(item.status)) ? 3000 : false });
  const quota = trpc.fileConversion.quota.useQuery(undefined, { enabled: !!user, retry: false, refetchInterval: history.data?.some(item => ["queued", "running", "receipt_pending", "refund_pending"].includes(item.status)) ? 3000 : false });
  const upload = trpc.fileConversion.upload.useMutation();
  const inspect = trpc.fileConversion.inspect.useMutation();
  const convert = trpc.fileConversion.convert.useMutation();
  const cancel = trpc.fileConversion.cancel.useMutation();
  const download = trpc.fileConversion.download.useMutation();
  const format = fileConversionFormat(formatId);
  const [group, setGroup] = useState<string>("文档");
  const selectFormat = (id: string) => { setFormatId(id); setFile(null); setMessage(""); };
  const selectedFile = (next: File | null) => { setFile(next); setMessage(""); };
  const groupIcons = { 文档: FileText, 电子书: Library, 图片: Image };
  const activeCount = history.data?.filter(item => ["queued", "running", "receipt_pending", "refund_pending"].includes(item.status)).length || 0;
  const action = async (work: () => Promise<void>) => {
    if (!user) { window.location.href = "/login"; return; }
    setBusy(true); setMessage("");
    try { await work(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "处理回执暂不可确认，请先查看已有任务，不要重复提交。"); }
    finally { setBusy(false); await Promise.all([history.refetch(), quota.refetch()]); }
  };
  const inspectFile = async () => {
    if (!file) return;
    const selected = file;
    validateConversionFile(formatId, selected.name, selected.size);
    if (lane === "free" && selected.size > FILE_CONVERSION_FREE_MAX_BYTES) throw new Error("免费转换每个原文件最多 3 MB，请选择付费转换。");
    const receipt = await upload.mutateAsync({ fileName: selected.name, bytes: selected.size, formatId, lane });
    const response = await fetch(flyDownloadUrl(receipt.uploadUrl), { method: "PUT", credentials: "include", headers: { "Content-Type": "application/octet-stream", ...receipt.requiredHeaders }, body: selected });
    if (!response.ok) throw new Error("文件上传未完成，请重试上传；未扣积分。");
    await inspect.mutateAsync({ objectName: receipt.objectName, fileName: selected.name, bytes: selected.size, formatId, lane });
    setMessage("已提交文件检查。检查后会显示本次内容与费用，点击转换才开始生成文件。");
  };
  return <section id="file-conversion" aria-labelledby="conversion-title" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-16 text-[var(--hp-ink)]">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
      <div><div className="mb-3 flex items-center gap-2 text-xs font-medium tracking-[0.16em] text-[var(--hp-accent)]"><FileInput className="h-4 w-4" />文件工具</div><h2 id="conversion-title" className="text-3xl font-semibold tracking-tight">换个格式，继续创作</h2><p className="mt-3 max-w-xl text-sm leading-6 text-[var(--hp-muted)]">PDF 转 Word，网页转 PDF，电子书和图片转换。先检查内容与费用，再开始转换。</p></div>
      <a href="#conversion-records" className="inline-flex items-center gap-2 rounded-full border border-[var(--hp-line)] px-4 py-2 text-xs text-[var(--hp-muted)] hover:border-[var(--hp-accent-line)] hover:text-[var(--hp-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300">我的转换记录<ArrowRight className="h-3.5 w-3.5" /></a>
    </div>
    <div data-conversion-free-quota className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--hp-accent-line)] bg-[var(--hp-accent-soft)] px-5 py-5 sm:px-7">
      <div>
        <p className="text-sm font-semibold text-[var(--hp-accent)]">每天免费转换</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight"><strong className="text-4xl font-semibold text-[var(--hp-accent)]">{FILE_CONVERSION_FREE_LIMIT}</strong> 个文件<span className="ml-3 text-xs font-normal text-[var(--hp-muted)]">每个 ≤ 3 MB</span></p>
      </div>
      <p role="status" aria-live="polite" className="text-sm font-medium text-[var(--hp-accent)]">
        {!user ? <a href="/login" className="underline underline-offset-4">登录领取今日免费额度 →</a> : quota.error ? "免费额度暂时无法获取" : quota.data ? <>今日剩余 <strong className="text-2xl">{quota.data.remaining} / {FILE_CONVERSION_FREE_LIMIT}</strong> 个文件</> : "正在查询今日剩余额度…"}
      </p>
    </div>
    <div className="overflow-hidden rounded-2xl border border-[var(--hp-line)] bg-[var(--hp-card)] shadow-[0_20px_80px_-40px_rgba(0,0,0,0.7)]">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.85fr)]">
      <div className="min-w-0 space-y-6 p-5 sm:p-7">
        <fieldset disabled={busy}><legend className="mb-3 text-sm font-medium"><span className="mr-2 text-[var(--hp-accent)]">01</span>选择转换格式</legend>
          <div role="group" aria-label="转换类别" className="mb-3 flex gap-1 rounded-lg bg-[var(--hp-input)] p-1">{["文档", "电子书", "图片"].map(name => { const Icon = groupIcons[name as keyof typeof groupIcons]; return <button type="button" key={name} aria-pressed={group === name} onClick={() => { setGroup(name); const first = FILE_CONVERSION_FORMATS.find(item => item.group === name); if (first && format.group !== name) selectFormat(first.id); }} className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300 ${group === name ? "bg-[var(--hp-card)] text-[var(--hp-ink)]" : "text-[var(--hp-muted)] hover:text-[var(--hp-ink)]"}`}><Icon className="h-4 w-4" />{name}</button>; })}</div>
          <div role="group" aria-label="转换格式" className="grid grid-cols-2 gap-2">{FILE_CONVERSION_FORMATS.filter(item => item.group === group).map(item => <button key={item.id} type="button" aria-pressed={formatId === item.id} onClick={() => selectFormat(item.id)} className={`flex min-h-12 items-center justify-between gap-2 rounded-lg border px-3 py-3 text-left text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300 ${formatId === item.id ? "border-[var(--hp-accent-line)] bg-[var(--hp-accent-soft)] text-[var(--hp-accent)]" : "border-[var(--hp-line)] text-[var(--hp-muted)] hover:border-[var(--hp-line)] hover:text-[var(--hp-ink)]"}`}><span>{item.label}</span>{formatId === item.id && <Check className="h-4 w-4 shrink-0" />}</button>)}</div>
        </fieldset>
        <div><div className="mb-3 text-sm font-medium"><span className="mr-2 text-[var(--hp-accent)]">02</span>放入原文件</div>
          <label className={`relative flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-5 py-6 text-center focus-within:outline focus-within:outline-2 focus-within:outline-indigo-300 ${busy ? "cursor-wait opacity-50" : "hover:border-[var(--hp-accent-line)]"} ${file ? "border-[var(--hp-accent-line)] bg-[var(--hp-accent-soft)]" : "border-[var(--hp-line)] bg-[var(--hp-input)]"}`}>
            <UploadCloud className="h-7 w-7 text-[var(--hp-accent)]" /><span className="max-w-full break-all text-sm font-medium">{file ? file.name : "点击选择原文件"}</span><span className="text-xs text-[var(--hp-muted)]">{file ? `${(file.size / 1_000_000).toFixed(2)} MB · 点击重新选择` : `支持 ${format.from.map(ext => ext.toUpperCase()).join(" / ")} · 原文件保留`}</span>
            <input aria-label="选择原文件" key={formatId} type="file" accept={format.from.map(ext => `.${ext}`).join(",")} disabled={busy} onChange={e => selectedFile(e.target.files?.[0] || null)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-wait" />
          </label><p className="mt-3 text-xs leading-5 text-[var(--hp-muted)]">{format.note}</p>
        </div>
        <fieldset className="space-y-2" disabled={busy}><legend className="mb-3 text-sm font-medium"><span className="mr-2 text-[var(--hp-accent)]">03</span>选择处理方式</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={`cursor-pointer rounded-xl border p-3 ${lane === "free" ? "border-[var(--hp-accent-line)] bg-[var(--hp-accent-soft)]" : "border-[var(--hp-line)]"}`}><span className="flex items-center justify-between text-sm"><span>免费排队</span><input type="radio" name="conversion-lane" checked={lane === "free"} onChange={() => setLane("free")} className="accent-indigo-400" /></span><span className="mt-2 block text-xs leading-5 text-[var(--hp-muted)]">每天 3 个文件 · 每个 ≤ 3 MB</span></label>
            <label className={`cursor-pointer rounded-xl border p-3 ${lane === "paid" ? "border-[var(--hp-accent-line)] bg-[var(--hp-accent-soft)]" : "border-[var(--hp-line)]"}`}><span className="flex items-center justify-between text-sm"><span>积分转换</span><input type="radio" name="conversion-lane" checked={lane === "paid"} onChange={() => setLane("paid")} className="accent-indigo-400" /></span><span className="mt-2 block text-xs leading-5 text-[var(--hp-muted)]">独立处理通道 · 每日数量不限</span></label>
          </div>
        </fieldset>
        {user && quota.data?.remaining === 0 && lane === "free" && <p role="status" className="text-sm text-[var(--hp-warning)]">今日免费转换已达上限，如需继续使用，请充值。</p>}
        {quota.error && lane === "free" && <p className="text-sm text-[var(--hp-warning)]">免费额度暂时无法获取，请稍后重试。</p>}
        {lane === "paid" && !catalog.data?.paidAvailable && <p className="text-sm text-[var(--hp-warning)]">付费费率尚未开放，不会扣除积分。</p>}
        <div className="rounded-xl border border-[var(--hp-line)] bg-[var(--hp-input)] p-4">
          <div className="flex items-center justify-between gap-3 text-sm"><span className="text-[var(--hp-muted)]">本次文件检查</span><span className="font-medium text-[var(--hp-accent)]">免费</span></div>
          {file && <p className="mt-2 text-xs text-[var(--hp-muted)]">{file.name.split('.').pop()?.toUpperCase() || "原文件"} → {format.to.toUpperCase()} · {(file.size / 1_000_000).toFixed(2)} MB</p>}
          <p className="mt-2 text-xs leading-5 text-[var(--hp-muted)]">检查结束后显示可转换内容和准确报价。确认转换才扣积分，失败或取消原路退回。</p>
          {!user ? <a className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--hp-accent-soft)] px-5 py-3 text-sm font-medium hover:bg-[var(--hp-accent-soft)]" href="/login">登录后开始<ArrowRight className="h-4 w-4" /></a> : <button disabled={busy || !file || !catalog.data?.available || (lane === "paid" && !catalog.data?.paidAvailable)} onClick={() => void action(inspectFile)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--hp-accent-soft)] px-5 py-3 text-sm font-medium hover:bg-[var(--hp-accent-soft)] disabled:cursor-not-allowed disabled:opacity-40">{busy ? <><Loader2 className="h-4 w-4 animate-spin" />正在处理…</> : <>免费检查文件<ArrowRight className="h-4 w-4" /></>}</button>}
        </div>
        <details className="text-xs leading-5 text-[var(--hp-muted)]"><summary className="cursor-pointer text-[var(--hp-muted)]">费用与额度规则</summary><div className="mt-2 space-y-2">
          <p>免费额度每日按北京时间重置。单个原文件最大 3 MB。</p>
          <p>{catalog.data?.paidAvailable ? "普通付费转换 4 积分/次；扫描 PDF/EPUB 每 MB 0.2 积分，最低 4 积分，每 2 积分向上取整。" : "积分报价以文件检查结果为准；费率未开放时不能付费转换。"} 原文件不足 1 MB 按 1 MB；扫描件不走免费识别。</p>
          <p>付费不进入免费队列；处理资源忙时仍须等待可用资源。</p>
        </div></details>
        {user && catalog.data?.available === false && <p className="text-sm text-[var(--hp-warning)]">文件处理工作台暂未开放。</p>}
        {(message || catalog.error) && <p role="status" className="break-words text-sm leading-6 text-[var(--hp-warning)]">{message || catalog.error?.message}</p>}
      </div>
      <div id="conversion-records" className="min-w-0 scroll-mt-24 border-t border-[var(--hp-line)] bg-[var(--hp-input)] p-5 sm:p-7 lg:border-l lg:border-t-0"><div className="mb-4 flex items-center justify-between gap-3"><h3 className="font-medium">我的转换记录{activeCount > 0 && <span className="ml-2 rounded-full bg-[var(--hp-accent-soft)] px-2 py-0.5 text-xs text-[var(--hp-accent)]">{activeCount} 项处理中</span>}</h3>{user && <button className="text-sm text-[var(--hp-accent)]" onClick={() => void history.refetch()}>刷新记录</button>}</div>
        {!user && <div className="flex min-h-60 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--hp-line)] px-5 text-center"><FileText className="mb-4 h-8 w-8 text-[var(--hp-subtle)]" /><p className="text-sm text-[var(--hp-muted)]">转换文件在这里领取</p><p className="mt-2 text-xs leading-5 text-[var(--hp-muted)]">登录后可查看检查结果、排队进度和下载文件。</p></div>}
        {history.error && <p role="alert" className="text-sm text-[var(--hp-warning)]">记录暂不可读取，请稍后刷新；不要重复提交。</p>}
        {user && history.data?.length === 0 && <div className="flex min-h-60 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--hp-line)] px-5 text-center"><FileText className="mb-4 h-8 w-8 text-[var(--hp-subtle)]" /><p className="text-sm text-[var(--hp-muted)]">等待你的第一份文件</p><p className="mt-2 text-xs leading-5 text-[var(--hp-muted)]">选择格式并检查文件，再在这里确认转换。</p></div>}
        <div className="max-h-[580px] space-y-3 overflow-y-auto">{history.data?.map(item => {
          const result = item.result;
          const waiting = ["queued", "running"].includes(item.status);
          return <article key={item.id} className="rounded-xl border border-[var(--hp-line)] bg-[var(--hp-card)] p-4">
            <div className="flex items-start justify-between gap-3"><p className="break-all text-sm font-medium">{item.fileName}</p><span className={`shrink-0 rounded-full px-2 py-1 text-xs ${item.status === "succeeded" ? "bg-[var(--hp-accent-soft)] text-[var(--hp-success)]" : item.status === "failed" ? "bg-[var(--hp-accent-soft)] text-[var(--hp-warning)]" : "bg-[var(--hp-accent-soft)] text-[var(--hp-accent)]"}`}>{waiting && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}{item.status === "succeeded" && result?.type === "inspection" ? (result.billing.available ? "待确认转换" : "检查结束") : stateLabels[item.status] || item.status}</span></div>
            <p className="mt-1 text-xs text-[var(--hp-muted)]">{fileConversionFormat(item.formatId).label} · {item.lane === "free" ? "免费" : "付费"} · {item.phase === "inspect" ? "文件检查" : "文件转换"}</p>
            {waiting && <p className="mt-2 text-xs text-[var(--hp-accent)]">{item.lane === "free" ? `前方等待 ${item.ahead} 人` : "独立付费通道 · 等待可用处理资源"}</p>}
            {result?.type === "inspection" && <><p className="mt-3 text-sm leading-6 text-[var(--hp-muted)]">{result.notice}</p><p className="mt-2 text-xs text-[var(--hp-muted)]">原文件 {(result.source.bytes / 1_000_000).toFixed(2)} MB · {result.billing.credits === null ? "费率尚未开放" : `${result.billing.needsOcr ? `${result.billing.billableMb} MB 计费量 · ` : ""}本次转换 ${result.billing.credits} 积分`}</p>
              {result.billing.available && <button disabled={busy} className="mt-3 rounded-lg bg-[var(--hp-accent-soft)] px-4 py-2 text-sm disabled:opacity-50" onClick={() => void action(async () => { const receipt = await convert.mutateAsync({ id: item.id, confirmedCredits: result.billing.credits! }); setMessage(receipt.status === "queued" ? "已确认所示内容与费用，转换已入队。" : `已恢复原任务：${stateLabels[receipt.status] || receipt.status}；未重复提交转换。`); })}>确认内容与费用，开始转换</button>}</>}
            {result?.type === "converted" && <><p className="mt-3 break-all text-sm text-[var(--hp-success)]">{result.fileName} · {(result.bytes / 1_000_000).toFixed(2)} MB · {result.credits} 积分</p>{result.notice && <p className="mt-2 text-xs leading-5 text-[var(--hp-warning)]">{result.notice}</p>}<button disabled={busy} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--hp-line)] px-4 py-2 text-sm" onClick={() => void action(async () => { const out = await download.mutateAsync({ id: item.id }); const anchor = document.createElement("a"); anchor.href = flyDownloadUrl(out.url); anchor.download = out.fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove(); })}><Download className="h-4 w-4" />下载转换文件</button></>}
            {(item.error || result?.type === "rejected") && <p className="mt-3 text-sm text-[var(--hp-warning)]">{result?.type === "rejected" ? result.message : item.error}</p>}
            {(waiting || item.status === "receipt_pending" || result?.type === "inspection") && <button disabled={busy} className="mt-3 block text-left text-xs text-[var(--hp-muted)] underline" onClick={() => void action(async () => { await cancel.mutateAsync({ id: item.id }); })}>{waiting || item.status === "receipt_pending" ? "停止此任务" : "撤销检查并释放预留名额"}</button>}
            <details className="mt-3 text-xs text-[var(--hp-muted)]"><summary>任务编号</summary><code className="break-all">{item.id}</code></details>
          </article>;
        })}</div>
      </div>
      </div>
    </div>
  </section>;
}
