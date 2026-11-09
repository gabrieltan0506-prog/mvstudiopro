import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { flyDownloadUrl } from "@/lib/gcsTransfer";
import {
  VIDEO_EDIT_MAX_SEC,
  VIDEO_EDIT_MIN_SEC,
  VIDEO_EDIT_PROMPT_MAX,
  VIDEO_EDIT_REF_MAX,
  checkVideoEditRange,
  newVideoEditRequestId,
  readVideoEditJob,
  readVideoEditQuote,
  roundSec,
  submitVideoEdit,
  type VideoEditQuoteInput,
  type VideoEditSubmitInput,
} from "@/lib/videoEditSubmit";
import type { AdvisorVideoEditRegistration } from "@/lib/manhuaAdvisorWorkflowControl";
import { createAdvisorVideoEditControl } from "@/lib/advisorVideoEditControl";

/** 本作品可选参考图（素材库/镜头图等）。 */
export type VideoEditReferenceImage = { url: string; label?: string; thumbUrl?: string };

export type VideoEditResult = { url: string; gcsUri?: string; durationSec?: number; editedRange?: { startSec: number; endSec: number }; jobId: string };

export type VideoEditPanelProps = {
  /** 原片地址：https（系统桶/CloudFront）或本人 gs://；挂载方先做来源核对（同调色入口）。 */
  source: string;
  /** 原片秒数。 */
  durationSec: number;
  /** 可播放地址（缺省用 flyDownloadUrl(source)，gs:// 时不显示预览）。 */
  previewUrl?: string;
  /** 本作品素材，供选参考图（可选，≤4 张）。 */
  referenceImages?: VideoEditReferenceImage[];
  disabled?: boolean;
  debugMode?: boolean;
  /** 修改完成：新版本（原片保留）；挂载方可据此加一条新版本。 */
  onDone?: (result: VideoEditResult) => void;
  /** 外部（创作顾问）预填：nonce 变化即覆盖区间/描述/参考图；只预填，报价与提交仍须用户在本面板确认。 */
  prefill?: { startSec: number; endSec: number; promptZh: string; referenceImageUrls?: string[]; nonce: string | number };
  /** 顾问 videoEdit 登记口：本面板挂载期间登记（inspect 列本片与参考图，prefill 覆盖本面板内容），卸载即注销。 */
  onAdvisorVideoEditControl?: AdvisorVideoEditRegistration;
  /** 顾问清单里本片的 targetId 与名称（缺省 current / 当前成片）。 */
  advisorTarget?: { id: string; label: string };
};

const POLL_MS = 4000;

type QueryLike<T> = { data?: T; isLoading?: boolean; isFetching?: boolean; error?: unknown };
type VideoEditTrpc = {
  quoteVideoPartialEdit: { useQuery: (input: VideoEditQuoteInput, opts: { enabled: boolean; retry?: boolean | number }) => QueryLike<unknown> };
  queueVideoPartialEdit: { useMutation: () => { mutateAsync: (input: VideoEditSubmitInput) => Promise<{ jobId: string } | string | undefined> } };
  getPostProdJob: {
    useQuery: (input: { jobId: string }, opts: { enabled: boolean; refetchInterval: (q: { state: { data?: unknown } }) => number | false }) => QueryLike<unknown>;
  };
};

/** 服务端约定：trpc.mvAnalysis.quoteVideoPartialEdit / queueVideoPartialEdit / getPostProdJob。 */
function useVideoEditApi(): VideoEditTrpc {
  return trpc.mvAnalysis as unknown as VideoEditTrpc;
}

/** 防抖：拖动时不连发报价。 */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const fmt = (n: number) => roundSec(n).toFixed(1);

/**
 * 视频局部修改面板：选区间（一位小数，拖动或输入）→ 描述要改什么 → 可选参考图 → 报价 → 确认（不可取消、失败退款）
 * → 提交后轮询；完成显示新版本（原片保留），可前后对比。计价与区间扩展以服务端报价为准。
 */
export function VideoEditPanel(props: VideoEditPanelProps) {
  const api = useVideoEditApi();
  const duration = Math.max(0, roundSec(props.durationSec || 0));
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(() => roundSec(Math.min(duration, VIDEO_EDIT_MIN_SEC)));
  const [promptZh, setPromptZh] = useState("");
  const [refs, setRefs] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState("");
  const [compare, setCompare] = useState<"after" | "before">("after");
  const requestIdRef = useRef("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const doneRef = useRef("");

  const applyPrefill = (p: { startSec: number; endSec: number; promptZh: string; referenceImageUrls?: string[] }) => {
    const allowed = new Set((props.referenceImages ?? []).map(r => r.url));
    setStartSec(roundSec(Math.min(Math.max(0, p.startSec), duration)));
    setEndSec(roundSec(Math.min(Math.max(0, p.endSec), duration)));
    setPromptZh(p.promptZh.slice(0, VIDEO_EDIT_PROMPT_MAX));
    setRefs((p.referenceImageUrls ?? []).filter(u => allowed.has(u)).slice(0, VIDEO_EDIT_REF_MAX));
    setConfirming(false);
    setError("");
  };
  const prefillNonce = props.prefill?.nonce;
  useEffect(() => {
    if (props.prefill && !jobId) applyPrefill(props.prefill);
  }, [prefillNonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const advisorLive = useRef({ props, duration, locked: false, apply: applyPrefill });
  useEffect(() => {
    const register = props.onAdvisorVideoEditControl;
    if (!register) return;
    const cur = () => advisorLive.current;
    register(
      createAdvisorVideoEditControl({
        targets: () => [{ id: cur().props.advisorTarget?.id ?? "current", label: cur().props.advisorTarget?.label ?? "当前成片", url: cur().props.source, durationSec: cur().duration }],
        refs: () => (cur().props.referenceImages ?? []).map((r, i) => ({ id: `ref${i + 1}`, label: r.label ?? `参考图${i + 1}`, url: r.url })),
        range: () => ({ minSec: VIDEO_EDIT_MIN_SEC, maxSec: VIDEO_EDIT_MAX_SEC }),
        busy: () => cur().locked,
        open: p => cur().apply({ ...p, referenceImageUrls: p.referenceImageUrl ? [p.referenceImageUrl] : [] }),
      })
    );
    return () => register(null);
  }, [props.onAdvisorVideoEditControl]); // eslint-disable-line react-hooks/exhaustive-deps

  const range = checkVideoEditRange(startSec, endSec, duration);
  const debounced = useDebounced({ startSec: range.startSec, endSec: range.endSec }, 400);
  const quoteEnabled = Boolean(props.source) && !range.problem && !checkVideoEditRange(debounced.startSec, debounced.endSec, duration).problem;
  const quoteQuery = api.quoteVideoPartialEdit.useQuery(
    { sourceUrl: props.source, startSec: debounced.startSec, endSec: debounced.endSec },
    { enabled: quoteEnabled, retry: false }
  );
  const quote = readVideoEditQuote(quoteQuery.data);
  const quoteFresh = Boolean(quote) && debounced.startSec === range.startSec && debounced.endSec === range.endSec;
  const queue = api.queueVideoPartialEdit.useMutation();
  const jobQuery = api.getPostProdJob.useQuery(
    { jobId },
    { enabled: Boolean(jobId), refetchInterval: q => (readVideoEditJob(q.state.data)?.status ?? "active") === "active" ? POLL_MS : false }
  );
  const job = jobId ? readVideoEditJob(jobQuery.data) ?? { status: "active" as const } : null;

  useEffect(() => {
    if (job?.status === "succeeded" && job.url && doneRef.current !== jobId) {
      doneRef.current = jobId;
      props.onDone?.({ url: job.url, gcsUri: job.gcsUri, durationSec: job.durationSec, editedRange: job.editedRange, jobId });
    }
  }, [job?.status, job?.url, jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = Boolean(jobId) && job?.status === "active";
  const locked = Boolean(props.disabled) || busy || running;
  advisorLive.current = { props, duration, locked: locked || confirming, apply: applyPrefill };
  const promptOk = promptZh.trim().length > 0 && promptZh.trim().length <= VIDEO_EDIT_PROMPT_MAX;
  const canAsk = !locked && !range.problem && promptOk && quoteFresh;

  const setStart = (v: number) => {
    if (!Number.isFinite(v)) return;
    setStartSec(roundSec(Math.min(Math.max(0, v), duration)));
  };
  const setEnd = (v: number) => {
    if (!Number.isFinite(v)) return;
    setEndSec(roundSec(Math.min(Math.max(0, v), duration)));
  };
  const toggleRef = (url: string) =>
    setRefs(cur => (cur.includes(url) ? cur.filter(x => x !== url) : cur.length >= VIDEO_EDIT_REF_MAX ? cur : [...cur, url]));

  function openConfirm() {
    if (!canAsk) return;
    setError("");
    // 每次点击提交 = 一次新请求；同一次的重试（确认框内「重试」）复用
    requestIdRef.current = newVideoEditRequestId();
    setConfirming(true);
  }

  async function confirmSubmit() {
    if (busy || !quote) return;
    setBusy(true);
    setError("");
    try {
      const res = await submitVideoEdit(
        {
          videoUrl: props.source,
          startSec: range.startSec,
          endSec: range.endSec,
          promptZh,
          referenceImageUrls: refs,
          expectedCredits: quote.credits,
          durationSec: duration,
          requestId: requestIdRef.current,
        },
        { submit: input => queue.mutateAsync(input) }
      );
      setJobId(res.jobId);
      setCompare("after");
      setConfirming(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const preview = props.previewUrl || (props.source.startsWith("gs://") ? "" : flyDownloadUrl(props.source));
  const resultSrc = job?.status === "succeeded" && job.url ? flyDownloadUrl(job.url) : "";

  return (
    <div className="space-y-2 rounded-xl border p-3 text-sm" aria-label="局部修改" data-testid="video-edit-panel">
      {preview && (
        <video ref={videoRef} src={preview} controls preload="metadata" className="max-h-64 w-full" aria-label="原片预览" />
      )}
      <fieldset className="space-y-1" disabled={locked}>
        <legend>选择要修改的片段（原片 {fmt(duration)} 秒）</legend>
        <label className="block">
          起点
          <input
            aria-label="起点滑杆"
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={startSec}
            onChange={e => setStart(Number(e.target.value))}
            className="ml-2 align-middle"
          />
          <input
            aria-label="起点秒"
            type="number"
            min={0}
            max={duration}
            step={0.1}
            value={startSec}
            onChange={e => setStart(Number(e.target.value))}
            className="ml-2 w-20 rounded bg-slate-900 p-1"
          />
          秒
          {preview && (
            <button type="button" className="ml-2 text-xs underline" onClick={() => setStart(videoRef.current?.currentTime ?? 0)}>
              取当前播放位置
            </button>
          )}
        </label>
        <label className="block">
          终点
          <input
            aria-label="终点滑杆"
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={endSec}
            onChange={e => setEnd(Number(e.target.value))}
            className="ml-2 align-middle"
          />
          <input
            aria-label="终点秒"
            type="number"
            min={0}
            max={duration}
            step={0.1}
            value={endSec}
            onChange={e => setEnd(Number(e.target.value))}
            className="ml-2 w-20 rounded bg-slate-900 p-1"
          />
          秒
          {preview && (
            <button type="button" className="ml-2 text-xs underline" onClick={() => setEnd(videoRef.current?.currentTime ?? 0)}>
              取当前播放位置
            </button>
          )}
        </label>
        <p aria-label="所选区间">
          已选 {fmt(range.startSec)}–{fmt(range.endSec)} 秒，共 {fmt(Math.max(0, range.lengthSec))} 秒（单次 {VIDEO_EDIT_MIN_SEC}–{VIDEO_EDIT_MAX_SEC} 秒）
        </p>
        {range.problem && (
          <p role="alert" aria-label="区间问题" className="text-amber-200">
            {range.problem}
          </p>
        )}
        {!range.problem && range.expandedTo && (
          <p aria-label="区间扩展提示" className="text-amber-200">
            所选不足 {VIDEO_EDIT_MIN_SEC} 秒，提交时会自动扩到 {VIDEO_EDIT_MIN_SEC} 秒（约 {fmt(range.expandedTo.startSec)}–{fmt(range.expandedTo.endSec)} 秒）
          </p>
        )}
      </fieldset>
      <label className="block">
        要改什么
        <textarea
          aria-label="修改描述"
          disabled={locked}
          maxLength={VIDEO_EDIT_PROMPT_MAX}
          value={promptZh}
          onChange={e => setPromptZh(e.target.value)}
          placeholder="例如：把背景换成商店门口，人物动作不变"
          rows={3}
          className="mt-1 block w-full rounded bg-slate-900 p-2"
        />
      </label>
      {(props.referenceImages?.length ?? 0) > 0 && (
        <div aria-label="参考图" className="space-y-1">
          <p>
            参考图（可选，最多 {VIDEO_EDIT_REF_MAX} 张；建议优先选不含人物的场景底图，更容易一次通过）
          </p>
          <div className="flex flex-wrap gap-2">
            {props.referenceImages!.map((img, i) => {
              const on = refs.includes(img.url);
              return (
                <button
                  key={img.url}
                  type="button"
                  aria-pressed={on}
                  aria-label={`参考图${i + 1}${img.label ? `：${img.label}` : ""}`}
                  disabled={locked || (!on && refs.length >= VIDEO_EDIT_REF_MAX)}
                  onClick={() => toggleRef(img.url)}
                  className={`rounded border p-1 ${on ? "border-amber-300" : "border-white/20"} disabled:opacity-40`}
                >
                  <img src={img.thumbUrl || flyDownloadUrl(img.url)} alt={img.label || `参考图${i + 1}`} className="h-14 w-14 object-cover" />
                </button>
              );
            })}
          </div>
        </div>
      )}
      <p aria-label="报价">
        {range.problem
          ? "调整区间后显示所需积分"
          : quoteFresh && quote
            ? quote.waived
              ? `本次修改 ${fmt(quote.segmentSec)} 秒 · 0 积分`
              : `本次修改 ${fmt(quote.segmentSec)} 秒 · 需 ${quote.credits} 积分`
            : quoteQuery.error
              ? "暂时无法获取报价，请稍后重试"
              : "正在计算所需积分…"}
      </p>
      {quoteFresh && quote?.notice && <p className="text-white/70">{quote.notice}</p>}
      <button type="button" className="rounded-lg border px-4 py-2 disabled:opacity-40" disabled={!canAsk} onClick={openConfirm}>
        提交局部修改
      </button>
      {confirming && quote && (
        <div role="dialog" aria-modal="true" aria-label="确认局部修改" className="space-y-2 rounded-lg border border-amber-300/60 p-3">
          <p>
            修改 {fmt(quote.startSec)}–{fmt(quote.endSec)} 秒（{fmt(quote.segmentSec)} 秒），{quote.waived ? "本次 0 积分" : `将扣 ${quote.credits} 积分`}。
          </p>
          <p>{quote.confirmNotice || "提交后不可取消；失败或未通过审核将全额退回积分。"}</p>
          <p className="text-white/70">修改结果另存为新版本，原片保留。</p>
          <div className="flex gap-2">
            <button type="button" className="rounded-lg border px-4 py-2" disabled={busy} onClick={() => void confirmSubmit()}>
              {busy ? "正在提交…" : error ? "重试提交" : "确认提交"}
            </button>
            <button type="button" className="rounded-lg border px-4 py-2" disabled={busy} onClick={() => setConfirming(false)}>
              再想想
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {jobId && (
        <p className="break-all text-xs" aria-label="修改任务">
          修改任务编号：{jobId} · {job?.status === "succeeded" ? "已完成" : job?.status === "failed" ? "未成功" : "处理中，请稍候"}
        </p>
      )}
      {job?.status === "failed" && (
        <p role="alert">
          {job.error}
          {job.refundedCredits != null ? `（已退回 ${job.refundedCredits} 积分）` : ""}
        </p>
      )}
      {resultSrc && (
        <div className="space-y-1" aria-label="修改结果">
          <div className="flex gap-2">
            <button type="button" aria-pressed={compare === "before"} className="text-xs underline" onClick={() => setCompare("before")}>
              修改前
            </button>
            <button type="button" aria-pressed={compare === "after"} className="text-xs underline" onClick={() => setCompare("after")}>
              修改后
            </button>
          </div>
          {compare === "before" && preview ? (
            <video src={preview} controls preload="metadata" className="max-h-64 w-full" aria-label="修改前" />
          ) : (
            <video src={resultSrc} controls preload="metadata" className="max-h-64 w-full" aria-label="修改后" />
          )}
          <p className="text-white/70">
            新版本已生成{job?.editedRange ? `（改动 ${fmt(job.editedRange.startSec)}–${fmt(job.editedRange.endSec)} 秒）` : ""}，原片保留。
          </p>
          <a href={resultSrc} target="_blank" rel="noreferrer" download="局部修改版.mp4">
            下载修改版
          </a>
        </div>
      )}
      {props.debugMode && job?.debug && (
        <pre aria-label="调试信息" className="whitespace-pre-wrap text-xs text-white/50">
          {JSON.stringify(job.debug)}
        </pre>
      )}
    </div>
  );
}
