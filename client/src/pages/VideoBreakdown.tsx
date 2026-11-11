/**
 * 拉片 /lapian：上传视频 → 服务端逐段拆解 → 展示全片创作拆解与逐段复刻提示词。
 * 结果以服务端为准；本机只记最近一次 jobId，地址栏带 ?job= 可刷新续看。
 */
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { ChevronLeft, Clock, FileVideo, Loader2, Plus, RefreshCw, ScanLine, UploadCloud } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Progress } from "@/components/ui/progress";
import { VideoBreakdownFailed, VideoBreakdownIntro, VideoBreakdownResultView, type SendToCanvasRequest } from "@/components/videoBreakdown/VideoBreakdownResult";
import { buildVideoBreakdownCanvasHandoff, saveVideoBreakdownCanvasHandoff, videoBreakdownCanvasHref } from "@/lib/videoBreakdownCanvasHandoff";
import { toast } from "sonner";
import { putVideoBreakdownFile, useVideoBreakdownCreateUpload, useVideoBreakdownJob, useVideoBreakdownStart } from "@/lib/videoBreakdownApi";
import {
  VIDEO_BREAKDOWN_LAST_JOB_KEY,
  VIDEO_BREAKDOWN_PRICING_RULE_COPY,
  VIDEO_BREAKDOWN_STAGES,
  formatDuration,
  friendlyVideoBreakdownError,
  isVideoBreakdownActive,
  readJobIdFromSearch,
  resolveVideoBreakdownContentType,
  validateVideoBreakdownDuration,
  validateVideoBreakdownFile,
  videoBreakdownPriceCopy,
  videoBreakdownStageIndex,
  videoBreakdownStageLabel,
} from "@/lib/videoBreakdownView";
import { VIDEO_BREAKDOWN_ACCEPT, VIDEO_BREAKDOWN_MAX_BYTES, VIDEO_BREAKDOWN_MAX_SECONDS, type VideoBreakdownJobView } from "@shared/videoBreakdown";

function readLastJobId(): string | null {
  try { return readJobIdFromSearch(`job=${localStorage.getItem(VIDEO_BREAKDOWN_LAST_JOB_KEY) || ""}`); } catch { return null; }
}

function rememberJobId(jobId: string | null) {
  try {
    if (jobId) localStorage.setItem(VIDEO_BREAKDOWN_LAST_JOB_KEY, jobId);
  } catch { /* 本机存储满或被禁用时不影响拉片，地址栏仍可续看。 */ }
  const url = new URL(window.location.href);
  if (jobId) url.searchParams.set("job", jobId); else url.searchParams.delete("job");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
}

/** 浏览器读不出时长（编码不支持）返回 null，不拦截，交给服务端核对。 */
function readVideoDuration(file: File): Promise<number | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let done = false;
    const finish = (value: number | null) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), 8000);
    video.preload = "metadata";
    video.onloadedmetadata = () => { window.clearTimeout(timer); finish(Number.isFinite(video.duration) ? video.duration : null); };
    video.onerror = () => { window.clearTimeout(timer); finish(null); };
    video.src = url;
  });
}

type Picked = { file: File; contentType: (typeof VIDEO_BREAKDOWN_ACCEPT)[number]; durationSec: number | null };
type UploadPhase = { kind: "idle" } | { kind: "uploading"; fraction: number } | { kind: "starting" };

function ProgressPanel({ job }: { job: VideoBreakdownJobView }) {
  const current = videoBreakdownStageIndex(job);
  return (
    <div data-lapian-progress className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 sm:p-8">
      <div className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-violet-300" />
        <p role="status" aria-live="polite" className="text-base font-semibold text-white">{videoBreakdownStageLabel(job)}</p>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-white/50"><Clock className="h-3.5 w-3.5" />通常 1–3 分钟，片子越长越久。可以离开本页，稍后用当前地址回来续看。</p>
      <ol className="mt-6 grid gap-2 sm:grid-cols-4">
        {VIDEO_BREAKDOWN_STAGES.map((stage, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li key={stage.key} data-stage-state={state} className={`rounded-xl border px-3 py-2.5 text-sm ${state === "active" ? "border-violet-400/50 bg-violet-500/10 text-white" : state === "done" ? "border-emerald-400/30 text-emerald-200" : "border-white/10 text-white/40"}`}>
              <span className="mr-1.5 font-mono text-xs">{i + 1}</span>{stage.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function VideoBreakdownPage() {
  const { user, loading } = useAuth();
  const [jobId, setJobIdState] = useState<string | null>(() => (typeof window === "undefined" ? null : readJobIdFromSearch(window.location.search)));
  const [lastJobId] = useState<string | null>(() => (typeof window === "undefined" ? null : readLastJobId()));
  const [picked, setPicked] = useState<Picked | null>(null);
  const [notice, setNotice] = useState("");
  const [phase, setPhase] = useState<UploadPhase>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  /** 已传完但启动失败时保留，重试只重发启动，不重复上传。 */
  const pendingStart = useRef<{ fileKey: string; gcsUri: string; requestId: string } | null>(null);
  const inFlight = useRef(false);
  const createUpload = useVideoBreakdownCreateUpload();
  const start = useVideoBreakdownStart();
  const job = useVideoBreakdownJob(user ? jobId : null);

  const setJobId = useCallback((next: string | null) => {
    setJobIdState(next);
    rememberJobId(next);
  }, []);

  useEffect(() => {
    const onPop = () => setJobIdState(readJobIdFromSearch(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const pick = async (file: File | undefined | null) => {
    setNotice("");
    if (!file) return;
    const invalid = validateVideoBreakdownFile(file);
    if (invalid) { setPicked(null); setNotice(invalid); return; }
    const durationSec = await readVideoDuration(file);
    const tooLong = validateVideoBreakdownDuration(durationSec);
    if (tooLong) { setPicked(null); setNotice(tooLong); return; }
    setPicked({ file, contentType: resolveVideoBreakdownContentType(file)!, durationSec });
  };

  const submit = async () => {
    if (!picked || inFlight.current) return;
    inFlight.current = true;
    setNotice("");
    const fileKey = `${picked.file.name}:${picked.file.size}:${picked.file.lastModified}`;
    try {
      if (pendingStart.current?.fileKey !== fileKey) {
        setPhase({ kind: "uploading", fraction: 0 });
        const receipt = await createUpload.mutateAsync({ fileName: picked.file.name, contentType: picked.contentType, bytes: picked.file.size });
        await putVideoBreakdownFile({ uploadUrl: receipt.uploadUrl, file: picked.file, contentType: receipt.contentType || picked.contentType, requiredHeaders: receipt.requiredHeaders, onProgress: fraction => setPhase({ kind: "uploading", fraction }) });
        pendingStart.current = { fileKey, gcsUri: receipt.gcsUri, requestId: crypto.randomUUID() };
      }
      setPhase({ kind: "starting" });
      const { gcsUri, requestId } = pendingStart.current!;
      const started = await start.mutateAsync({ gcsUri, requestId });
      pendingStart.current = null;
      setJobId(started.jobId);
    } catch (error) {
      setNotice(friendlyVideoBreakdownError(error, pendingStart.current ? "视频已上传，开始拉片时没有成功，请再点一次开始（不会重复上传）。" : "视频上传未完成，请检查网络后重试。"));
    } finally {
      inFlight.current = false;
      setPhase({ kind: "idle" });
    }
  };

  const restart = () => {
    setJobId(null);
    setNotice("");
    pendingStart.current = null;
  };

  const sendToCanvas = (request: SendToCanvasRequest) => {
    if (!user || !jobId || !job.data?.result) return;
    try {
      const handoff = buildVideoBreakdownCanvasHandoff({ jobId, result: job.data.result, clipUrls: job.data.clipUrls, ...request });
      saveVideoBreakdownCanvasHandoff(window.sessionStorage, user.id, handoff);
      window.location.assign(videoBreakdownCanvasHref());
    } catch (error) {
      toast.error(friendlyVideoBreakdownError(error, "送入画布未成功，可先复制提示词手动粘贴。"));
    }
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    if (phase.kind === "idle") void pick(event.dataTransfer.files?.[0]);
  };

  const view: VideoBreakdownJobView | undefined = job.data;
  const busy = phase.kind !== "idle";

  let body: ReactNode;
  if (loading) {
    body = <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-violet-300" /></div>;
  } else if (!user) {
    body = (
      <div className="space-y-6 rounded-2xl border border-white/10 bg-white/[0.04] p-6 sm:p-8">
        <VideoBreakdownIntro />
        <a href={getLoginUrl()} className="inline-flex items-center rounded-full bg-violet-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-500">登录后开始拉片</a>
      </div>
    );
  } else if (jobId) {
    if (job.isLoading && !view) body = <div className="flex flex-col items-center gap-3 py-24 text-sm text-white/50"><Loader2 className="h-8 w-8 animate-spin text-violet-300" />正在读取拉片进度…</div>;
    else if (!view) body = (
      <div role="alert" className="flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-10 text-center">
        <p className="text-sm text-white/70">{friendlyVideoBreakdownError(job.error, "暂时读取不到这次拉片，请稍后刷新；若链接来自他人账号则无法查看。")}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => void job.refetch()} className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-sm text-white/85 hover:border-white/40"><RefreshCw className="h-4 w-4" />重新读取</button>
          <button type="button" onClick={restart} className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-500"><Plus className="h-4 w-4" />新的拉片</button>
        </div>
      </div>
    );
    else if (isVideoBreakdownActive(view)) body = <ProgressPanel job={view} />;
    else if (view.status === "succeeded" && view.result) body = <VideoBreakdownResultView result={view.result} sourceUrl={view.sourceUrl} clipUrls={view.clipUrls} keyMomentFrameUrls={view.keyMomentFrameUrls} onSendToCanvas={sendToCanvas} />;
    else body = <VideoBreakdownFailed error={view.status === "failed" ? view.error : "拉片结果暂不可读，请重新拉片。"} onRetry={restart} />;
  } else {
    body = (
      <div className="space-y-6">
        <VideoBreakdownIntro />
        <label
          onDragOver={event => { event.preventDefault(); if (!busy) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`relative flex min-h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-5 py-8 text-center transition focus-within:outline focus-within:outline-2 focus-within:outline-violet-300 ${busy ? "cursor-wait opacity-60" : "hover:border-violet-300/60"} ${dragging || picked ? "border-violet-400/60 bg-violet-500/[0.07]" : "border-white/15 bg-white/[0.03]"}`}
        >
          {picked ? <FileVideo className="h-8 w-8 text-violet-300" /> : <UploadCloud className="h-8 w-8 text-violet-300" />}
          <span className="max-w-full break-all text-sm font-medium text-white">{picked ? picked.file.name : "拖入视频，或点击选择"}</span>
          <span className="text-xs text-white/50">
            {picked
              ? `${(picked.file.size / 1024 / 1024).toFixed(1)} MB${picked.durationSec ? ` · ${formatDuration(picked.durationSec)}` : ""} · 点击重新选择`
              : `MP4 / MOV / WebM · 不超过 ${Math.round(VIDEO_BREAKDOWN_MAX_BYTES / 1024 / 1024)} MB · 时长 ${Math.round(VIDEO_BREAKDOWN_MAX_SECONDS / 60)} 分钟以内`}
          </span>
          <input aria-label="选择要拉片的视频" type="file" accept={[...VIDEO_BREAKDOWN_ACCEPT, ".mp4", ".mov", ".webm"].join(",")} disabled={busy} onChange={event => { void pick(event.target.files?.[0]); event.target.value = ""; }} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-wait" />
        </label>
        <p data-lapian-pricing-rule className="-mt-3 text-xs text-white/45">{VIDEO_BREAKDOWN_PRICING_RULE_COPY}。</p>
        {phase.kind === "uploading" && (
          <div className="space-y-1.5" aria-live="polite">
            <Progress value={Math.round(phase.fraction * 100)} className="h-2" />
            <p className="text-xs text-white/50">正在上传 {Math.round(phase.fraction * 100)}%，请勿关闭页面</p>
          </div>
        )}
        {notice && <p role="alert" className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{notice}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={!picked || busy} onClick={() => void submit()} className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
            {phase.kind === "uploading" ? "上传中…" : phase.kind === "starting" ? "正在开始…" : "开始拉片"}
          </button>
          {picked && <span data-lapian-price className="text-xs text-white/60">{videoBreakdownPriceCopy(picked.durationSec)}</span>}
          {lastJobId && <button type="button" onClick={() => setJobId(lastJobId)} className="ml-auto text-xs text-white/50 underline-offset-4 hover:text-white hover:underline">查看上次拉片结果</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-transparent text-white">
      <div className="sticky top-0 z-20 border-b border-white/[0.08] bg-[rgba(6,4,15,0.85)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <a href="/" aria-label="返回首页" className="text-white/50 transition hover:text-white"><ChevronLeft className="h-5 w-5" /></a>
            <div className="min-w-0">
              <h1 className="text-lg font-black">拉片复刻爆款</h1>
              <p className="truncate text-xs text-white/40">拆开一支爆款的钩子、镜头与口播，拿到可直接复刻的提示词</p>
            </div>
          </div>
          {user && jobId && view && !isVideoBreakdownActive(view) && (
            <button type="button" onClick={restart} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:border-white/40"><Plus className="h-3.5 w-3.5" />新的拉片</button>
          )}
        </div>
      </div>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{body}</main>
    </div>
  );
}
