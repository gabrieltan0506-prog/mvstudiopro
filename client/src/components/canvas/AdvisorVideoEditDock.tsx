import { useRef, useState } from "react";
import {
  confirmAndQueueVideoPartialEdit,
  type AdvisorVideoEditPrefill,
  type VideoPartialEditQueueInput,
  type VideoPartialEditQuote,
} from "@shared/advisorVideoEdit";

/**
 * 顾问预填后的「视频局部修改」确认区：显示区间、描述与报价；只有用户点确认才提交。
 * 报价/提交由宿主注入（VE1 quoteVideoPartialEdit / queueVideoPartialEdit），VideoEditPanel 落地后改为向其传预填。
 */
export function AdvisorVideoEditDock(props: {
  prefill: AdvisorVideoEditPrefill;
  quote?: VideoPartialEditQuote;
  quoteLoading?: boolean;
  quoteError?: string;
  queue: (input: VideoPartialEditQueueInput) => Promise<unknown>;
  onSubmitted?: (result: unknown) => void;
  onClose: () => void;
  confirm?: (text: string) => boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    lock = useRef(false);
  const p = props.prefill;
  const submit = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await confirmAndQueueVideoPartialEdit(p, props.quote, {
        confirm: props.confirm ?? (text => window.confirm(text)),
        queue: props.queue,
        requestId: () => crypto.randomUUID(),
      });
      if (r.submitted) props.onSubmitted?.(r.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败，请稍后重试");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <div aria-label="视频局部修改预填" className="space-y-2 rounded-md border p-3 text-sm">
      <p>
        {p.label}：{p.startSec}–{p.endSec} 秒
      </p>
      <p aria-label="修改描述">{p.promptZh}</p>
      {p.referenceImageUrl && <img alt="参考图" src={p.referenceImageUrl} className="h-16 rounded" />}
      {p.noticeZh && <p className="text-amber-300">{p.noticeZh}</p>}
      <p aria-label="报价">
        {props.quoteLoading ? "正在计算积分…" : props.quote ? `本次 ${props.quote.credits} 积分${props.quote.notice ? `（${props.quote.notice}）` : ""}` : props.quoteError ?? "报价未就绪"}
      </p>
      {error && <p role="alert" className="text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="button" className="rounded-md border px-3 py-1.5" disabled={busy || !props.quote} onClick={() => void submit()}>
          确认提交（提交后不可取消）
        </button>
        <button type="button" className="rounded-md border px-3 py-1.5" disabled={busy} onClick={props.onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}
