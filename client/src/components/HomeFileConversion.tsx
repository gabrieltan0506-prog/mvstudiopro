import { useState } from "react";
import { Download, FileInput, Loader2 } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { gcsTransferUrl } from "@/lib/gcsTransfer";
import { FILE_CONVERSION_FREE_MAX_BYTES, type FileConversionLane, FILE_CONVERSION_FORMATS, fileConversionFormat, validateConversionFile } from "@shared/fileConversion";

const stateLabels: Record<string, string> = { queued: "排队中", running: "处理中", succeeded: "处理结束", failed: "未完成", refund_pending: "退款处理中" };
export default function HomeFileConversion() {
  const { user } = useAuth();
  const [lane, setLane] = useState<FileConversionLane>("free");
  const [formatId, setFormatId] = useState("pdf-docx");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const catalog = trpc.fileConversion.formats.useQuery(undefined, { enabled: !!user, retry: false });
  const history = trpc.fileConversion.history.useQuery(undefined, { enabled: !!user, retry: false,
    refetchInterval: query => query.state.data?.some(item => ["queued", "running", "refund_pending"].includes(item.status)) ? 3000 : false });
  const quota = trpc.fileConversion.quota.useQuery(undefined, { enabled: !!user, retry: false, refetchInterval: history.data?.some(item => ["queued", "running", "refund_pending"].includes(item.status)) ? 3000 : false });
  const upload = trpc.fileConversion.upload.useMutation();
  const inspect = trpc.fileConversion.inspect.useMutation();
  const convert = trpc.fileConversion.convert.useMutation();
  const cancel = trpc.fileConversion.cancel.useMutation();
  const download = trpc.fileConversion.download.useMutation();
  const format = fileConversionFormat(formatId);
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
    const response = await fetch(gcsTransferUrl(receipt.uploadUrl), { method: "PUT", credentials: "include", headers: { "Content-Type": "application/octet-stream", ...receipt.requiredHeaders }, body: selected });
    if (!response.ok) throw new Error("文件上传未完成，请重试上传；未扣积分。");
    await inspect.mutateAsync({ objectName: receipt.objectName, fileName: selected.name, bytes: selected.size, formatId, lane });
    setMessage("已提交文件检查。检查后会显示本次内容与费用，点击转换才开始生成文件。");
  };
  return <section id="file-conversion" className="mx-auto max-w-6xl px-5 py-16 text-white">
    <div className="mb-7 flex items-center gap-3"><FileInput className="h-7 w-7 text-indigo-300" /><div><h2 className="text-2xl font-semibold">文件转换</h2><p className="mt-1 text-sm text-white/60">免费每天 3 个文件 · 付费独立处理 · 检查文件后确认本次费用</p></div></div>
    <div className="grid gap-6 rounded-2xl border border-white/10 bg-white/[0.03] p-5 md:grid-cols-[1fr_1.25fr]">
      <div className="space-y-4">
        <fieldset className="space-y-2"><legend className="mb-2 text-sm">处理通道</legend>
          <label className="flex items-start gap-2 text-sm"><input type="radio" name="conversion-lane" checked={lane === "free"} onChange={() => setLane("free")} disabled={busy} /><span>免费排队 · 单文件 ≤ 3 MB（3,000,000 字节）<small className="block text-white/55">每天每账号及同来源 IP 各 3 个文件，以上海时间计日。</small></span></label>
          <label className="flex items-start gap-2 text-sm"><input type="radio" name="conversion-lane" checked={lane === "paid"} onChange={() => setLane("paid")} disabled={busy} /><span>积分付费 · 不进入免费队列<small className="block text-white/55">每日数量不限，按每次报价扣积分；处理资源忙时等待资源。</small></span></label>
        </fieldset>
        {user && quota.data && <p className="text-sm text-indigo-200">今日免费剩余 {quota.data.remaining} / 3 个文件（同时核对账号与来源 IP）</p>}
        {user && quota.data?.remaining === 0 && lane === "free" && <p role="status" className="text-sm text-amber-200">今日免费转换已达上限，如需继续使用，请充值。</p>}
        {quota.error && lane === "free" && <p className="text-sm text-amber-200">来源额度暂不可确认，请稍后重试。</p>}
        {lane === "paid" && !catalog.data?.paidAvailable && <p className="text-sm text-amber-200">付费费率尚未开放，不会扣除积分。</p>}
        <label className="block text-sm">转换格式<select aria-label="转换格式" value={formatId} onChange={e => { setFormatId(e.target.value); setFile(null); setMessage(""); }} disabled={busy} className="mt-2 w-full rounded-lg border border-white/20 bg-[#151322] p-3">
          {["文档", "电子书", "图片"].map(group => <optgroup key={group} label={group}>{FILE_CONVERSION_FORMATS.filter(item => item.group === group).map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</optgroup>)}
        </select></label>
        <p className="text-sm leading-6 text-white/60">{format.note}</p>
        <label className="block rounded-xl border border-dashed border-white/25 p-5 text-sm">选择原文件<input key={formatId} type="file" accept={format.from.map(ext => `.${ext}`).join(",")} disabled={busy} onChange={e => { setFile(e.target.files?.[0] || null); setMessage(""); }} className="mt-3 block w-full text-white/70" /></label>
        {file && <p className="break-all text-sm text-indigo-200">本次检查：{file.name} · {(file.size / 1_000_000).toFixed(2)} MB → {format.to.toUpperCase()}，检查免费。</p>}
        <p className="text-xs leading-5 text-white/55">扫描 PDF/EPUB 按原文件大小计量，不足 1 MB 按 1 MB。普通付费与扫描识别会先显示报价，确认后才扣费；失败或取消原路退回积分。扫描件不走免费识别。</p>
        {!user ? <a className="inline-block rounded-lg bg-indigo-500 px-5 py-3 text-sm font-medium" href="/login">登录 / 注册后使用</a> : <button disabled={busy || !file || !catalog.data?.available || (lane === "paid" && !catalog.data?.paidAvailable)} onClick={() => void action(inspectFile)} className="rounded-lg bg-indigo-500 px-5 py-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50">{busy ? "正在处理…" : "检查文件并排队"}</button>}
        {user && catalog.data?.available === false && <p className="text-sm text-amber-200">文件处理工作台暂未开放。</p>}
        {(message || catalog.error) && <p role="status" className="break-words text-sm leading-6 text-amber-200">{message || catalog.error?.message}</p>}
      </div>
      <div><div className="mb-4 flex items-center justify-between"><h3 className="font-medium">我的转换记录</h3>{user && <button className="text-sm text-indigo-200" onClick={() => void history.refetch()}>刷新记录</button>}</div>
        {!user && <p className="text-sm text-white/50">登录后查看本人文件和转换记录。</p>}
        {history.error && <p role="alert" className="text-sm text-amber-200">记录暂不可读取，请稍后刷新；不要重复提交。</p>}
        {user && history.data?.length === 0 && <p className="text-sm text-white/50">还没有转换记录。上传文件后先检查内容，再确认转换。</p>}
        <div className="max-h-[580px] space-y-3 overflow-y-auto">{history.data?.map(item => {
          const result = item.result;
          const waiting = ["queued", "running"].includes(item.status);
          return <article key={item.id} className="rounded-xl border border-white/10 p-4">
            <div className="flex items-start justify-between gap-3"><p className="break-all text-sm font-medium">{item.fileName}</p><span className="shrink-0 text-xs text-white/60">{waiting && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}{stateLabels[item.status] || item.status}</span></div>
            <p className="mt-1 text-xs text-white/50">{fileConversionFormat(item.formatId).label} · {item.lane === "free" ? "免费" : "付费"} · {item.phase === "inspect" ? "文件检查" : "文件转换"}</p>
            {waiting && <p className="mt-2 text-xs text-indigo-200">{item.lane === "free" ? `前方等待 ${item.ahead} 人` : "独立付费通道 · 等待可用处理资源"}</p>}
            {result?.type === "inspection" && <><p className="mt-3 text-sm leading-6 text-white/70">{result.notice}</p><p className="mt-2 text-xs text-white/50">原文件 {(result.source.bytes / 1_000_000).toFixed(2)} MB · {result.billing.credits === null ? "费率尚未开放" : `${result.billing.needsOcr ? `${result.billing.billableMb} MB 计费量 · ` : ""}本次转换 ${result.billing.credits} 积分`}</p>
              {result.billing.available && <button disabled={busy} className="mt-3 rounded-lg bg-indigo-500 px-4 py-2 text-sm disabled:opacity-50" onClick={() => void action(async () => { await convert.mutateAsync({ id: item.id, confirmedCredits: result.billing.credits! }); setMessage("已确认所示原文件、格式与费用，转换已入队。重复点击恢复同一任务。"); })}>确认内容与费用，开始转换</button>}</>}
            {result?.type === "converted" && <><p className="mt-3 break-all text-sm text-emerald-200">{result.fileName} · {(result.bytes / 1_000_000).toFixed(2)} MB · {result.credits} 积分</p>{result.notice && <p className="mt-2 text-xs leading-5 text-amber-200">{result.notice}</p>}<button disabled={busy} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-white/20 px-4 py-2 text-sm" onClick={() => void action(async () => { const out = await download.mutateAsync({ id: item.id }); const anchor = document.createElement("a"); anchor.href = gcsTransferUrl(out.url); anchor.download = out.fileName; document.body.appendChild(anchor); anchor.click(); anchor.remove(); })}><Download className="h-4 w-4" />下载转换文件</button></>}
            {(item.error || result?.type === "rejected") && <p className="mt-3 text-sm text-amber-200">{result?.type === "rejected" ? result.message : item.error}</p>}
            {(waiting || result?.type === "inspection") && <button disabled={busy} className="mt-3 text-xs text-white/65 underline" onClick={() => void action(async () => { await cancel.mutateAsync({ id: item.id }); })}>{waiting ? "停止此任务" : "撤销检查并释放预留名额"}</button>}
            <details className="mt-3 text-xs text-white/40"><summary>任务编号</summary><code className="break-all">{item.id}</code></details>
          </article>;
        })}</div>
      </div>
    </div>
  </section>;
}
