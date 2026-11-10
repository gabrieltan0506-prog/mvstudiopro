import { useEffect, useRef, useState } from "react";
import { flyDownloadUrl } from "@/lib/gcsTransfer";
import { cn } from "@/lib/utils";
import { useVideoEditJobQuery, useVideoEditQueueMutation, useVideoEditQuoteQuery } from "@/lib/videoEditApi";
import {
  VIDEO_EDIT_MAX_SEC,
  VIDEO_EDIT_MIN_SEC,
  VIDEO_EDIT_PROMPT_MAX,
  VIDEO_EDIT_REF_MAX,
  checkVideoEditRange,
  estimateVideoEditQuote,
  newVideoEditRequestId,
  readVideoEditJob,
  readVideoEditQuote,
  roundSec,
  submitVideoEdit,
  videoEditDurationSec,
} from "@/lib/videoEditSubmit";
import { useVideoEditPrefillGate, useVideoEditPrefillGuard, type VideoEditPrefillPayload } from "@/lib/videoEditPrefillGate";
import type { AdvisorVideoEditRegistration } from "@/lib/manhuaAdvisorWorkflowControl";
import { createAdvisorVideoEditControl } from "@/lib/advisorVideoEditControl";
import { VideoEditCompare } from "./VideoEditCompare";
import { VideoEditRangeBar } from "./VideoEditRangeBar";

/** 宿主自建顾问控件时的预填闸门（与面板内同一套，见 lib/videoEditPrefillGate）。 */
export { useVideoEditPrefillGuard };

/** 本作品可选参考图（素材库/镜头图等）。 */
export type VideoEditReferenceImage = { url: string; label?: string; thumbUrl?: string };

export type VideoEditResult = { url: string; gcsUri?: string; durationSec?: number; editedRange?: { startSec: number; endSec: number }; jobId: string };

export type VideoEditPanelProps = {
  /** 原片地址：https（系统桶/CloudFront）或本人 gs://；挂载方先做来源核对（同调色入口）。 */
  source: string;
  /** 原片实测秒数（不要传超分计费用的向上取整秒数）；面板按一位小数向下取作选区上限。 */
  durationSec: number;
  /** 可播放地址（缺省用 flyDownloadUrl(source)，gs:// 时不显示预览）。 */
  previewUrl?: string;
  /** 本作品素材，供选参考图（可选，≤4 张）。 */
  referenceImages?: VideoEditReferenceImage[];
  disabled?: boolean;
  debugMode?: boolean;
  /** 修改完成：新版本（原片保留）；挂载方可据此加一条新版本。 */
  onDone?: (result: VideoEditResult) => void;
  /** 入队成功（每次确认提交一次）：startSec/endSec 为实际提交的区间（不足 4 秒已扩展后的值）；挂载方可据此记账、刷新后续看进度。 */
  onSubmitted?: (job: { jobId: string; requestId: string; startSec: number; endSec: number }) => void;
  /**
   * 外部（创作顾问）预填：nonce 变化即覆盖区间/描述/参考图；只预填，报价与提交仍须用户在本面板确认。
   * 面板挂载后，确认框打开、正在确认报价、提交或任务进行中、面板停用时不覆盖（内容与确认框原样保留）；宿主须配 onAdvisorPrefillGuard 才能把拒绝原因回给顾问。
   */
  prefill?: { startSec: number; endSec: number; promptZh: string; referenceImageUrls?: string[]; nonce: string | number };
  /** 顾问 videoEdit 登记口：本面板挂载期间登记（inspect 列本片与参考图，prefill 覆盖本面板内容；确认/报价/提交/任务进行中拒绝），卸载即注销。 */
  onAdvisorVideoEditControl?: AdvisorVideoEditRegistration;
  /** 宿主自建顾问控件时的预填闸门登记口（用 useVideoEditPrefillGuard().register）：挂载期间登记，卸载即注销。 */
  onAdvisorPrefillGuard?: (guard: (() => string) | null) => void;
  /** 顾问清单里本片的 targetId 与名称（缺省 current / 当前成片）。 */
  advisorTarget?: { id: string; label: string };
};

/** 区间停稳多久后才向服务端确认报价（拖动中不发；松手后再等这么久）。 */
const QUOTE_SETTLE_MS = 500;

// 与后期工坊等站内面板同一套输入/按钮样式
const fieldCls = "w-full rounded-lg border border-white/12 bg-black/40 px-2 py-1.5 text-[12px] text-white placeholder:text-white/35 disabled:opacity-50";
const numCls = "w-full min-w-0 rounded-lg border border-white/12 bg-black/40 px-2 py-1 text-[12px] tabular-nums text-white disabled:opacity-50";
const goCls =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-cyan-300/45 bg-cyan-500/15 px-3 py-1.5 text-[12px] font-semibold text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-45";
const ghostCls =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/12 px-3 py-1.5 text-[12px] text-white/85 hover:bg-white/10 disabled:opacity-45 aria-pressed:border-cyan-300/45 aria-pressed:bg-cyan-500/15";
const linkCls = "text-[11px] text-cyan-100/80 underline underline-offset-2 hover:text-cyan-50 disabled:opacity-45";
const hintCls = "text-[11px] text-white/55";

const fmt = (n: number) => roundSec(n).toFixed(1);
const fmtWait = (sec: number) => (sec < 60 ? `${sec} 秒` : `${Math.floor(sec / 60)} 分 ${String(sec % 60).padStart(2, "0")} 秒`);

/** 区间停稳后的值：拖动中不更新；停止变化 ms 毫秒后才跟上（服务端报价只对它发）。 */
function useSettled<T>(value: T, holding: boolean, ms: number, same: (a: T, b: T) => boolean): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (holding || same(settled, value)) return;
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  });
  return settled;
}
const sameRange = (a: { startSec: number; endSec: number }, b: { startSec: number; endSec: number }) => a.startSec === b.startSec && a.endSec === b.endSec;

/**
 * 视频局部修改面板：预览下方一条双滑块区间条选片段（可拖、可键盘、可输入数字）→ 描述要改什么 → 可选参考图
 * → 价格即时显示（与服务端同一组计价函数），区间停稳后服务端确认一次 → 确认（不可取消、失败退款）→ 提交后轮询；
 * 完成显示新版本（原片保留），可前后对比。提交用的积分数始终取服务端报价。
 */
export function VideoEditPanel(props: VideoEditPanelProps) {
  /** 首次报价带回的服务端实测片长与是否免扣（按原片记）：之后选区上限与即时价格都以它为准。 */
  const [anchor, setAnchor] = useState<{ source: string; sec: number; waived: boolean } | null>(null);
  const anchored = anchor?.source === props.source ? anchor : null;
  // 片长上限按实测秒数一位小数向下取（同服务端），10.08 秒不会放到 10.1 秒去报价
  const duration = anchored?.sec ?? videoEditDurationSec(props.durationSec);
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(() => roundSec(Math.min(duration, VIDEO_EDIT_MIN_SEC)));
  const [promptZh, setPromptZh] = useState("");
  const [refs, setRefs] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState("");
  const [dragging, setDragging] = useState(false);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const [looping, setLooping] = useState(false);
  const [submittedAt, setSubmittedAt] = useState(0);
  const [now, setNow] = useState(0);
  const requestIdRef = useRef("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const doneRef = useRef("");

  const range = checkVideoEditRange(startSec, endSec, duration);
  const settled = useSettled({ startSec: range.startSec, endSec: range.endSec }, dragging, QUOTE_SETTLE_MS, sameRange);
  const isSettled = sameRange(settled, { startSec: range.startSec, endSec: range.endSec });
  const quoteQuery = useVideoEditQuoteQuery(
    { sourceUrl: props.source, startSec: settled.startSec, endSec: settled.endSec },
    Boolean(props.source) && !range.problem && isSettled
  );
  /** 服务端对当前区间的确认报价（确认框、提交都只认它）。 */
  const quote = isSettled && !range.problem ? readVideoEditQuote(quoteQuery.data) : null;
  const quoteError = isSettled && !range.problem && !quote && quoteQuery.error ? quoteQuery.error.message || "暂时无法获取报价" : "";
  const quotedSec = videoEditDurationSec(quote?.sourceDurationSec);
  const quotedWaived = Boolean(quote?.waived);
  useEffect(() => {
    if (quotedSec > 0)
      setAnchor(cur => (cur?.source === props.source && cur.sec === quotedSec && cur.waived === quotedWaived ? cur : { source: props.source, sec: quotedSec, waived: quotedWaived }));
  }, [quotedSec, quotedWaived, props.source]);
  useEffect(() => {
    // 服务端片长比浏览器读到的短时，把越界的终点收回来
    setEndSec(cur => (cur > duration ? duration : cur));
  }, [duration]);
  /** 即时价格：片长锚定后在前端用与服务端同一组函数算，拖动时不发请求。 */
  const estimate = anchored && !range.problem ? estimateVideoEditQuote(anchored.sec, range.startSec, range.endSec, anchored.waived) : null;
  const shown = quote ?? estimate;

  const queue = useVideoEditQueueMutation();
  const jobQuery = useVideoEditJobQuery(jobId);
  const job = jobId ? readVideoEditJob(jobQuery.data) ?? { status: "active" as const } : null;

  useEffect(() => {
    if (job?.status === "succeeded" && job.url && doneRef.current !== jobId) {
      doneRef.current = jobId;
      props.onDone?.({ url: job.url, gcsUri: job.gcsUri, durationSec: job.durationSec, editedRange: job.editedRange, jobId });
    }
  }, [job?.status, job?.url, jobId]); // eslint-disable-line react-hooks/exhaustive-deps

  const running = Boolean(jobId) && job?.status === "active";
  const locked = Boolean(props.disabled) || busy || running;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const waitedSec = running && submittedAt && now ? Math.max(0, Math.floor((now - submittedAt) / 1000)) : 0;

  // 只改区间/描述/参考图；确认框与任务状态不在这里动（被闸门拦下时根本不会调用）
  const applyPrefill = (p: VideoEditPrefillPayload) => {
    const allowed = new Set((props.referenceImages ?? []).map(r => r.url));
    setStartSec(roundSec(Math.min(Math.max(0, p.startSec), duration)));
    setEndSec(roundSec(Math.min(Math.max(0, p.endSec), duration)));
    setPromptZh(p.promptZh.slice(0, VIDEO_EDIT_PROMPT_MAX));
    setRefs((p.referenceImageUrls ?? []).filter(u => allowed.has(u)).slice(0, VIDEO_EDIT_REF_MAX));
    setError("");
  };
  useVideoEditPrefillGate({
    // 正在报价 = 当前区间有效但服务端尚未确认（含拖动中、停稳等待中），用户刚改的区间不让顾问冲掉
    state: { running, submitting: busy, confirming, disabled: Boolean(props.disabled), quoting: Boolean(props.source) && !range.problem && !quote && !quoteError },
    apply: applyPrefill,
    prefill: props.prefill,
    buildControl: () =>
      createAdvisorVideoEditControl({
        targets: () => [{ id: props.advisorTarget?.id ?? "current", label: props.advisorTarget?.label ?? "当前成片", url: props.source, durationSec: duration }],
        refs: () => (props.referenceImages ?? []).map((r, i) => ({ id: `ref${i + 1}`, label: r.label ?? `参考图${i + 1}`, url: r.url })),
        range: () => ({ minSec: VIDEO_EDIT_MIN_SEC, maxSec: VIDEO_EDIT_MAX_SEC }),
        open: p => applyPrefill({ ...p, referenceImageUrls: p.referenceImageUrl ? [p.referenceImageUrl] : [] }),
      }),
    onAdvisorVideoEditControl: props.onAdvisorVideoEditControl,
    onAdvisorPrefillGuard: props.onAdvisorPrefillGuard,
  });

  const promptOk = promptZh.trim().length > 0 && promptZh.trim().length <= VIDEO_EDIT_PROMPT_MAX;
  const canAsk = !locked && !range.problem && promptOk && Boolean(quote);

  /** 预览跳到某一秒（拖滑块、改数字时跟手）。 */
  const seekPreview = (sec: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(sec)) return;
    try {
      v.currentTime = sec;
    } catch {
      // 元数据未就绪时个别浏览器会抛，忽略
    }
    setPlayhead(sec);
  };
  const setStart = (v: number, follow = true) => {
    if (!Number.isFinite(v)) return;
    const next = roundSec(Math.min(Math.max(0, v), duration));
    setStartSec(next);
    if (follow) seekPreview(next);
  };
  const setEnd = (v: number, follow = true) => {
    if (!Number.isFinite(v)) return;
    const next = roundSec(Math.min(Math.max(0, v), duration));
    setEndSec(next);
    if (follow) seekPreview(next);
  };
  const toggleRef = (url: string) =>
    setRefs(cur => (cur.includes(url) ? cur.filter(x => x !== url) : cur.length >= VIDEO_EDIT_REF_MAX ? cur : [...cur, url]));

  /** 试看：循环播放将被修改的片段（不足 4 秒时即扩展后的区间）。 */
  const loopFrom = range.expandedTo?.startSec ?? range.startSec;
  const loopTo = range.expandedTo?.endSec ?? range.endSec;
  const loopable = !range.problem && loopTo > loopFrom;
  const toggleLoop = () => {
    const v = videoRef.current;
    if (!v) return;
    if (looping) {
      v.pause();
      setLooping(false);
      return;
    }
    if (!loopable) return;
    setLooping(true);
    seekPreview(loopFrom);
    void v.play().catch(() => undefined);
  };
  const onPreviewTime = () => {
    const v = videoRef.current;
    if (!v) return;
    if (looping && loopable && (v.currentTime >= loopTo || v.currentTime < loopFrom - 0.25 || v.ended)) {
      v.currentTime = loopFrom;
      if (v.paused) void v.play().catch(() => undefined);
    }
    setPlayhead(v.currentTime);
  };
  useEffect(() => {
    if (looping && !loopable) setLooping(false);
  }, [looping, loopable]);

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
      setSubmittedAt(Date.now());
      setConfirming(false);
      if (looping) {
        videoRef.current?.pause();
        setLooping(false);
      }
      // 实际提交区间以服务端回执为准（不足 4 秒已扩展）；回执未带时取用户确认过的报价区间（同一规则算出）
      const edited = res.editedRange ?? { startSec: quote.startSec, endSec: quote.endSec };
      try {
        props.onSubmitted?.({ jobId: res.jobId, requestId: res.requestId, startSec: edited.startSec, endSec: edited.endSec });
      } catch (e) {
        // 挂载方回调出错不能当成提交失败（任务已入队、已扣积分），只进控制台
        console.error("[VideoEditPanel] onSubmitted", e);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const preview = props.previewUrl || (props.source.startsWith("gs://") ? "" : flyDownloadUrl(props.source));
  const resultSrc = job?.status === "succeeded" && job.url ? flyDownloadUrl(job.url) : "";

  return (
    <div className="space-y-3 rounded-xl border border-white/12 bg-black/20 p-3 text-[12px] text-white/90" aria-label="局部修改" data-testid="video-edit-panel">
      {preview && (
        <video
          ref={videoRef}
          src={preview}
          controls
          playsInline
          preload="metadata"
          className="max-h-64 w-full rounded-lg bg-black"
          aria-label="原片预览"
          onTimeUpdate={onPreviewTime}
          onSeeked={onPreviewTime}
          onPause={() => {
            // 用户自己按了暂停就退出试看（循环回跳时不会触发暂停）
            if (looping && videoRef.current && !videoRef.current.ended) setLooping(false);
          }}
        />
      )}
      <fieldset className="min-w-0 space-y-2" disabled={locked}>
        <legend className="mb-1 font-semibold text-white">选择要修改的片段（原片 {fmt(duration)} 秒）</legend>
        <VideoEditRangeBar
          durationSec={duration}
          startSec={startSec}
          endSec={endSec}
          expandedTo={range.problem ? null : range.expandedTo}
          playheadSec={preview ? playhead : null}
          disabled={locked}
          onStartChange={setStart}
          onEndChange={setEnd}
          onDraggingChange={setDragging}
        />
        <div className="grid max-w-md grid-cols-2 gap-2">
          {(
            [
              ["起点", startSec, setStart],
              ["终点", endSec, setEnd],
            ] as const
          ).map(([name, value, set]) => (
            <div key={name} className="min-w-0 space-y-1">
              <label className="block space-y-1">
                <span className="block text-white/70">{name}（秒）</span>
                <input
                  aria-label={`${name}秒`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={value}
                  onChange={e => set(Number(e.target.value))}
                  className={numCls}
                />
              </label>
              {preview && (
                <button type="button" aria-label={`${name}取当前播放位置`} className={linkCls} onClick={() => set(videoRef.current?.currentTime ?? 0, false)}>
                  取当前播放位置
                </button>
              )}
            </div>
          ))}
        </div>
        <p aria-label="所选区间" className="text-white/80">
          已选 {fmt(range.startSec)}–{fmt(range.endSec)} 秒，共 {fmt(Math.max(0, range.lengthSec))} 秒（单次 {VIDEO_EDIT_MIN_SEC}–{VIDEO_EDIT_MAX_SEC} 秒）
        </p>
        {range.problem && (
          <p role="alert" aria-label="区间问题" className="text-amber-200">
            {range.problem}
          </p>
        )}
        {!range.problem && range.expandedTo && (
          <p aria-label="区间扩展提示" className="text-amber-200">
            所选不足 {VIDEO_EDIT_MIN_SEC} 秒，提交时会自动扩到 {VIDEO_EDIT_MIN_SEC} 秒（约 {fmt(range.expandedTo.startSec)}–{fmt(range.expandedTo.endSec)} 秒），即区间条上的虚线范围
          </p>
        )}
        {preview && (
          <button type="button" aria-pressed={looping} className={ghostCls} disabled={!looping && !loopable} onClick={toggleLoop}>
            {looping ? "停止试看" : "试看所选片段"}
          </button>
        )}
      </fieldset>
      <label className="block space-y-1">
        <span className="block font-semibold text-white">要改什么</span>
        <textarea
          aria-label="修改描述"
          disabled={locked}
          maxLength={VIDEO_EDIT_PROMPT_MAX}
          value={promptZh}
          onChange={e => setPromptZh(e.target.value)}
          placeholder="例如：把背景换成商店门口，人物动作不变"
          rows={3}
          className={fieldCls}
        />
      </label>
      {(props.referenceImages?.length ?? 0) > 0 && (
        <div aria-label="参考图" className="space-y-1">
          <p className={hintCls}>参考图（可选，最多 {VIDEO_EDIT_REF_MAX} 张；建议优先选不含人物的场景底图，更容易一次通过）</p>
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
                  className={cn("overflow-hidden rounded-lg border-2 disabled:opacity-40", on ? "border-cyan-300" : "border-white/12")}
                >
                  <img src={img.thumbUrl || flyDownloadUrl(img.url)} alt={img.label || `参考图${i + 1}`} className="h-14 w-14 object-cover" />
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" className={goCls} disabled={!canAsk} onClick={openConfirm}>
          提交局部修改
        </button>
        <p aria-label="报价" aria-live="polite" className="min-w-0 tabular-nums text-white/85">
          {range.problem
            ? "调整区间后显示所需积分"
            : shown
              ? `本次修改 ${fmt(shown.segmentSec)} 秒，${shown.waived ? "0 积分" : `需 ${shown.credits} 积分`}${quote ? "" : quoteError ? "（预估）" : "（正在确认…）"}`
              : quoteError
                ? "暂时无法获取报价"
                : "正在计算所需积分…"}
        </p>
      </div>
      {quoteError && (
        <p role="alert" aria-label="报价问题" className="text-amber-200">
          {/^[一-鿿]/.test(quoteError) ? quoteError : "暂时无法获取报价，请稍后重试"}{" "}
          <button type="button" className={linkCls} onClick={() => void quoteQuery.refetch?.()}>
            重试
          </button>
        </p>
      )}
      {confirming && quote && (
        <div role="dialog" aria-modal="true" aria-label="确认局部修改" className="space-y-2 rounded-lg border border-amber-300/50 bg-amber-300/5 p-3">
          <p className="font-semibold text-white">
            修改 {fmt(quote.startSec)}–{fmt(quote.endSec)} 秒（{fmt(quote.segmentSec)} 秒），{quote.waived ? "本次 0 积分" : `将扣 ${quote.credits} 积分`}。
          </p>
          <p>{quote.confirmNotice || "提交后不可取消；失败或未通过审核将全额退回积分。"}</p>
          <p className={hintCls}>修改结果另存为新版本，原片保留。</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={goCls} disabled={busy} onClick={() => void confirmSubmit()}>
              {busy ? "正在提交…" : error ? "重试提交" : "确认提交"}
            </button>
            <button type="button" className={ghostCls} disabled={busy} onClick={() => setConfirming(false)}>
              再想想
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {jobId && job?.status === "active" && (
        <div role="status" aria-label="修改任务" className="space-y-0.5 rounded-lg border border-white/12 bg-black/40 p-2">
          <p className="font-semibold text-white">
            处理中<span className="tabular-nums font-normal text-white/70">，已等待 {fmtWait(waitedSec)}</span>
          </p>
          <p className={hintCls}>通常约 3–5 分钟，可以离开本页，回来结果还在。</p>
        </div>
      )}
      {jobId && job?.status === "failed" && (
        <p role="alert" aria-label="修改任务" className="text-red-300">
          修改未成功：{job.error}
          {job.refundedCredits != null ? `（已退回 ${job.refundedCredits} 积分）` : ""}
        </p>
      )}
      {resultSrc && (
        <div className="space-y-1.5 border-t border-white/10 pt-3" aria-label="修改结果">
          <p className="font-semibold text-white">
            新版本已生成{job?.editedRange ? `（改动 ${fmt(job.editedRange.startSec)}–${fmt(job.editedRange.endSec)} 秒）` : ""}，原片保留。
          </p>
          <VideoEditCompare beforeSrc={preview || undefined} afterSrc={resultSrc} editedRange={job?.editedRange} />
          <a href={resultSrc} target="_blank" rel="noreferrer" download="局部修改版.mp4" className={cn(ghostCls, "no-underline")}>
            下载修改版
          </a>
        </div>
      )}
      {props.debugMode && jobId && (
        <p aria-label="任务编号" className="break-all text-[11px] text-white/45">
          任务编号：{jobId}
        </p>
      )}
      {props.debugMode && job?.debug && (
        <pre aria-label="调试信息" className="whitespace-pre-wrap text-[11px] text-white/45">
          {JSON.stringify(job.debug)}
        </pre>
      )}
    </div>
  );
}
