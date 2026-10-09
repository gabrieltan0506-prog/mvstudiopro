import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, Sparkles, Film, SlidersHorizontal, Layers, Maximize2, Minimize2, MessageSquare } from "lucide-react";
import { ManhuaVfxEffectParameters, type VfxSceneOption } from "./ManhuaVfxEffectParameters";
import { ManhuaVfxSurface } from "./ManhuaVfxSurface";
import { ManhuaVfxTimeline } from "./ManhuaVfxTimeline";
import { ManhuaVfxComparison } from "./ManhuaVfxComparison";
import { MANHUA_VFX_RAIN_DEFAULTS, MANHUA_VFX_PRESET_LABELS, manhuaVfxCompositionSchema, type ManhuaVfxComposition, type ManhuaVfxEffect, type ManhuaVfxState } from "@shared/manhuaVfx";
import { gcsTransferUrl } from "@/lib/gcsTransfer";
import { maskMediaProviderDetails } from "@/lib/maskMediaUrls";
import { canAdoptManhuaVfxRequest, manhuaVfxPositionAtTime, manhuaVfxContainedVideoRect, manhuaVfxPositionFromPointer, upsertManhuaVfxTrajectoryPoint, type ManhuaVfxVideoRect, makeManhuaVfxEffect, manhuaVfxSourceKey, manhuaVfxMediaIdentity, parseManhuaVfxTrajectory, validateManhuaVfxDuration } from "@/lib/manhuaVfxWorkflow";
import type { ClipOption, TrackedJob } from "@/lib/postProdWorkshop";
import type { AdvisorEffectsControl, AdvisorEffectsRegistration } from "@shared/manhuaAdvisorEffects";
import { advisorWorkflowRevision } from "@/lib/manhuaAdvisorWorkflowPlan";

type Draft = NonNullable<ManhuaVfxState["draft"]>;
type Request = ManhuaVfxState["requests"][string];
export type ManhuaVfxSubmitInput = {
  action: "manhua_vfx";
  requestId: string;
  params: { videoUri: string; sourceKey: string; composition: ManhuaVfxComposition };
};
const LABELS = MANHUA_VFX_PRESET_LABELS;
const controlClass = "w-full rounded border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-white";
const buttonClass = "rounded border border-cyan-300/35 px-3 py-2 text-xs text-cyan-100 disabled:opacity-40";

export function ManhuaVfxEditor({ scopeKey, state, clips, imageOptions = [], scenes = [], jobs, busy, onStateChange, onSubmit, onSourceChange, onPreview, onAdvisorEffectsControl, onOpenAdvisor, advisorOpen, onAdvisorDockChange, active = true }: {
  scopeKey: string;
  state?: ManhuaVfxState;
  clips: ClipOption[];
  imageOptions?: ClipOption[];
  scenes?: VfxSceneOption[];
  onAdvisorEffectsControl?: AdvisorEffectsRegistration;
  onOpenAdvisor?: () => void;
  advisorOpen?: boolean;
  onAdvisorDockChange?: (host: HTMLDivElement | null) => void;
  active?: boolean;
  jobs: TrackedJob[];
  busy: boolean;
  onStateChange?: (state: ManhuaVfxState) => Promise<ManhuaVfxState | void>;
  onSubmit: (input: ManhuaVfxSubmitInput) => Promise<string | undefined>;
  onSourceChange: (uri: string) => void;
  onPreview: (url: string, label: string) => void;
}) {
  const empty = (): ManhuaVfxState => ({ version: 1, scopeKey, requests: {} });
  const [local, setLocal] = useState<ManhuaVfxState>(() => state?.scopeKey === scopeKey ? state : empty());
  const latest = useRef(local);
  latest.current = local;
  const [draft, setDraft] = useState<Draft | undefined>(local.draft);
  const draftRef = useRef(draft); draftRef.current = draft;
  const videoRef = useRef<HTMLVideoElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [candidatePreview, setCandidatePreview] = useState<string>();
  const [durationSec, setDurationSec] = useState(0);
  const [playbackSec, setPlaybackSec] = useState(0);
  const [positioning, setPositioning] = useState(false);
  const [videoRect, setVideoRect] = useState<ManhuaVfxVideoRect>();
  const [sourceError, setSourceError] = useState("");
  const [comparisonId, setComparisonId] = useState("");
  const [selectedEffectId, setSelectedEffectId] = useState(draft?.composition.effects[0]?.id || "");
  const [trajectoryText, setTrajectoryText] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const gate = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!state || state.scopeKey !== scopeKey || gate.current || state === latest.current) return;
    const draftIsUnedited = JSON.stringify(draftRef.current) === JSON.stringify(latest.current.draft);
    latest.current = state; setLocal(state);
    if (draftIsUnedited) { setDraft(state.draft); setTrajectoryText({}); }
  }, [state, scopeKey]);
  const source = draft && clips.find(clip => clip.id === draft.sourceId);
  const currentSource = Boolean(source && draft && manhuaVfxSourceKey(source) === draft.sourceKey);
  const sourceUrl = currentSource ? source!.url : "";
  const selectedEffect = draft?.composition.effects.find(effect => effect.id === selectedEffectId) || draft?.composition.effects[0];
  const canPosition = selectedEffect?.kind !== "bullet_time";
  useEffect(() => { if (!canPosition) setPositioning(false); }, [canPosition]);
  let selectedTrajectory = selectedEffect?.anchor.trajectory || [];
  try { if (selectedEffect && Object.prototype.hasOwnProperty.call(trajectoryText, selectedEffect.id)) selectedTrajectory = parseManhuaVfxTrajectory(trajectoryText[selectedEffect.id]) || []; }
  catch { selectedTrajectory = []; }
  const trajectoryValid = selectedTrajectory.every((point, index) => [point.timeSec, point.x, point.y].every(Number.isFinite) && point.timeSec >= 0 && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1 && (!index || point.timeSec > selectedTrajectory[index - 1].timeSec));
  if (!trajectoryValid) selectedTrajectory = [];
  const markerPosition = selectedEffect ? positioning ? selectedEffect.anchor.position : manhuaVfxPositionAtTime({ ...selectedEffect, anchor: { ...selectedEffect.anchor, trajectory: selectedTrajectory } }, playbackSec) : undefined;
  useEffect(() => { if (!active) { setExpanded(false); setCandidatePreview(undefined); videoRef.current?.pause(); } }, [active]);
  const measureVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    const box = video.getBoundingClientRect();
    setVideoRect(manhuaVfxContainedVideoRect(box, { width: video.videoWidth, height: video.videoHeight }));
  };
  useEffect(() => { setDurationSec(0); setPlaybackSec(0); setPositioning(false); setVideoRect(undefined); setSourceError(""); }, [sourceUrl]);
  useEffect(() => { onSourceChange(sourceUrl); }, [sourceUrl, onSourceChange]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const observer = new ResizeObserver(measureVideo);
    observer.observe(video);
    return () => observer.disconnect();
  }, [sourceUrl]);

  const persist = async (next: ManhuaVfxState) => {
    if (!mounted.current) throw new Error("特效面板已切换，原请求已保留；请回到原作品继续查询");
    if (!onStateChange) throw new Error("当前项目尚未接通特效保存，请稍后再试");
    const saved = await onStateChange(next);
    if (!mounted.current) return;
    latest.current = saved || next;
    setLocal(saved || next);
  };
  const showError = (caught: unknown) => {
    const text = maskMediaProviderDetails(caught instanceof Error ? caught.message : "保存或提交暂未完成，请保留原请求继续查询");
    if (mounted.current) setError(text);
  };
  const updateEffect = (id: string, update: Partial<ManhuaVfxEffect>) => setDraft(previous => previous && ({
    ...previous, composition: { ...previous.composition, effects: previous.composition.effects.map(effect => effect.id === id ? { ...effect, ...update } : effect) },
  }));
  const resolveDraft = (): Draft => {
    if (!draft || !source || !currentSource) throw new Error("原片已变化或不在当前项目，请重新选择素材");
    const effects = draft.composition.effects.map(effect => Object.prototype.hasOwnProperty.call(trajectoryText, effect.id)
      ? { ...effect, anchor: { ...effect.anchor, trajectory: parseManhuaVfxTrajectory(trajectoryText[effect.id]) } } : effect);
    if (effects.some(effect => effect.kind === "image_overlay" && (!effect.imageUri || !imageOptions.some(image => manhuaVfxMediaIdentity(image.url) === effect.imageUri)))) throw new Error("叠加图片已变化或不在当前作品，请重新选择已保存的图片");
    const parsed = manhuaVfxCompositionSchema.safeParse({ ...draft.composition, effects });
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "请核对特效参数");
    const durationError = validateManhuaVfxDuration(parsed.data, durationSec);
    if (sourceError || durationError) throw new Error(sourceError || durationError);
    return { ...draft, videoUri: source.url, composition: parsed.data };
  };
  const saveDraft = async () => {
    if (gate.current) return;
    gate.current = true; setSaving(true); setError("");
    try {
      const nextDraft = resolveDraft();
      await persist({ ...latest.current, draft: nextDraft });
      setDraft(nextDraft); setTrajectoryText({});
      if (mounted.current) setNotice("方案已保存到当前作品；修改参数后请再次保存。");
      toast.success("特效方案已保存到当前作品");
    } catch (caught) { showError(caught); }
    finally { gate.current = false; if (mounted.current) setSaving(false); }
  };
  const submit = async (existing?: Request, advisor?: { signal: AbortSignal }) => {
    if (gate.current || busy) return;
    advisor?.signal.throwIfAborted();
    gate.current = true; setSaving(true); setError("");
    let request: Request | undefined;
    try {
      if (existing) {
        request = existing;
        await persist({ ...latest.current, requests: { ...latest.current.requests, [existing.requestId]: existing } });
      } else {
        const nextDraft = resolveDraft();
        const unresolved = Object.values(latest.current.requests).find(item => ["submitting", "unknown", "queued", "running"].includes(item.status));
        if (unresolved) throw new Error("当前仍有未收口的特效任务，请先查询原任务");
        request = { ...nextDraft, requestId: crypto.randomUUID(), createdAt: Date.now(), status: "submitting" };
        // Retain the immutable intent in this view even when persistence has an unknown outcome.
        const intent = { ...latest.current, draft: nextDraft, requests: { ...latest.current.requests, [request.requestId]: request } };
        latest.current = intent; setLocal(intent);
        // A confirmed cloud save is the precondition for creating a render task.
        await persist(intent);
        setDraft(nextDraft); setTrajectoryText({});
      }
      if (!mounted.current) return;
      advisor?.signal.throwIfAborted();
      const jobId = await onSubmit({ action: "manhua_vfx", requestId: request.requestId,
        params: { videoUri: request.videoUri, sourceKey: request.sourceKey, composition: request.composition } });
      if (!jobId) throw new Error("任务回执暂未取得，请继续查询原请求");
      request = { ...request, jobId, status: "queued", error: undefined };
      await persist({ ...latest.current, requests: { ...latest.current.requests, [request.requestId]: request } });
      return { requestId: request.requestId, jobId, status: latest.current.requests[request.requestId]?.status || request.status };
    } catch (caught) {
      // Keep the original immutable request in the saved draft even when enqueue or the receipt save is unknown.
      if (request && latest.current.requests[request.requestId]) {
        const code = (caught as { data?: { code?: string } })?.data?.code;
        const rejected = ["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "PRECONDITION_FAILED"].includes(code || "");
        const next = { ...latest.current, requests: { ...latest.current.requests, [request.requestId]: { ...request, status: rejected ? "failed" as const : "unknown" as const,
          error: rejected ? "提交未获接受，请核对素材与参数" : undefined } } };
        latest.current = next; if (mounted.current) setLocal(next);
        try { await persist(next); } catch { /* Previously saved submitting intent remains recoverable. */ }
      }
      showError(caught);
      if (advisor) throw caught;
    } finally { gate.current = false; if (mounted.current) setSaving(false); }
  };

  // Common workshop polling owns server receipts. Persist complete candidates into the project for refresh/backup restore.
  useEffect(() => {
    if (gate.current || !onStateChange) return;
    const next = { ...latest.current, requests: { ...latest.current.requests } };
    let changed = false;
    for (const request of Object.values(latest.current.requests)) {
      const job = jobs.find(item => item.jobId === request.jobId && item.scopeKey === scopeKey && item.action === "manhua_vfx");
      if (!job || (job.status === request.status && (job.status !== "succeeded" || request.output))) continue;
      const output = job.output as Request["output"];
      if (job.status === "succeeded" && (!output || output.requestId !== request.requestId || output.sourceKey !== request.sourceKey)) continue;
      next.requests[request.requestId] = { ...request, status: job.status, error: job.error || undefined, ...(job.status === "succeeded" ? { output } : {}) };
      changed = true;
    }
    if (!changed) return;
    gate.current = true;
    void persist(next).catch(showError).finally(() => { gate.current = false; });
  }, [jobs, scopeKey, saving, onStateChange]);

  const adopt = async (requestId: string, advisor?: { signal: AbortSignal }) => {
    if (gate.current) return;
    advisor?.signal.throwIfAborted();
    gate.current = true; setSaving(true); setError("");
    try {
      const nextDraft = resolveDraft();
      const next = { ...latest.current, draft: nextDraft };
      if (!canAdoptManhuaVfxRequest(next, requestId, clips)) throw new Error("此候选与当前来源或方案不一致，请先恢复对应方案并核对原片");
      await persist({ ...next, adoptedRequestId: requestId });
      setDraft(nextDraft); setTrajectoryText({});
      if (mounted.current) setNotice("候选已采用并保存，可在后续工序中选择；原片保留。");
      toast.success("已采用特效候选并保存，可在后续工序中选择");
      return { requestId, status: "adopted" };
    } catch (caught) { showError(caught); if (advisor) throw caught; }
    finally { gate.current = false; if (mounted.current) setSaving(false); }
  };
  const addTrajectoryPoint = () => {
    const video = videoRef.current;
    if (!video || !selectedEffect || !draft || gate.current || !canPosition) return;
    try {
      const points = Object.prototype.hasOwnProperty.call(trajectoryText, selectedEffect.id)
        ? parseManhuaVfxTrajectory(trajectoryText[selectedEffect.id]) || [] : selectedEffect.anchor.trajectory || [];
      if (video.currentTime > durationSec) throw new Error("播放时刻超出原片，请重新定位");
      const [x, y] = positioning ? selectedEffect.anchor.position : manhuaVfxPositionAtTime({ ...selectedEffect, anchor: { ...selectedEffect.anchor, trajectory: points } }, video.currentTime);
      const trajectory = upsertManhuaVfxTrajectoryPoint(points, { timeSec: video.currentTime, x, y });
      updateEffect(selectedEffect.id, { anchor: { ...selectedEffect.anchor, trajectory } });
      setTrajectoryText(previous => { const next = { ...previous }; delete next[selectedEffect.id]; return next; });
      setError("");
    } catch (caught) { showError(caught); }
  };
  const seek = (time: number) => {
    const video = videoRef.current;
    if (!video || !(durationSec > 0)) return;
    video.pause(); video.currentTime = Math.max(0, Math.min(durationSec, time)); setPlaybackSec(video.currentTime);
  };
  const comparable = Object.values(local.requests).filter(request => request.status === "succeeded" && request.sourceKey === draft?.sourceKey && currentSource && request.output?.requestId === request.requestId && request.output.sourceKey === request.sourceKey && request.output.gcsUri);
  const comparison = comparable.find(request => request.requestId === comparisonId);
  const locked = busy || saving;
  const pending = Object.values(local.requests).some(request => ["submitting", "unknown", "queued", "running"].includes(request.status));
  const advisorSourceKey = advisorWorkflowRevision([scopeKey, clips.map(clip => [clip.id, manhuaVfxMediaIdentity(clip.url)]), imageOptions.map(image => [image.id, manhuaVfxMediaIdentity(image.url)]), draft, trajectoryText, local.requests, local.adoptedRequestId]);
  const advisorSourceRef = useRef(advisorSourceKey); advisorSourceRef.current = advisorSourceKey;
  const advisorRecipe = (composition: ManhuaVfxComposition) => ({ ...composition, effects: composition.effects.map(({ imageUri, ...effect }) => ({ ...effect, ...(imageUri ? { imageId: imageOptions.find(image => manhuaVfxMediaIdentity(image.url) === imageUri)?.id || "图片已失效" } : {}) })) });
  const advisorControl = useRef<AdvisorEffectsControl>(async () => "");
  advisorControl.current = async (action, signal) => {
    signal.throwIfAborted();
    if (action.tool !== "vfx") throw new Error("此控制器只处理屏幕特效");
    if (action.operation === "inspect") return JSON.stringify({ sourceKey: advisorSourceKey, scopeKey, tool: "vfx", kinds: LABELS,
      clips: clips.map(({ id, label }) => ({ id, label })), images: imageOptions.map(({ id, label }) => ({ id, label })), selectedSourceId: draft?.sourceId,
      vfxRecipe: draft ? advisorRecipe(draft.composition) : undefined,
      requests: Object.values(local.requests).map(request => ({ requestId: request.requestId, sourceId: request.sourceId, vfxRecipe: advisorRecipe(request.composition), status: request.status, canAdopt: canAdoptManhuaVfxRequest({ ...local, draft }, request.requestId, clips), adopted: local.adoptedRequestId === request.requestId })), busy: locked });
    const assertCurrent = () => { signal.throwIfAborted(); if (!mounted.current || !action.sourceKey || action.sourceKey !== advisorSourceRef.current) throw new Error("特效来源或方案已变化，请重新inspect；未执行旧方案"); };
    assertCurrent();
    if (locked || gate.current) throw new Error("特效正在保存或提交，请先查询原任务");
    if (action.operation === "configure") {
      const clip = clips.find(item => item.id === action.sourceIds?.[0]);
      if (!clip || action.sourceIds?.length !== 1 || !action.vfxRecipe) throw new Error("请使用当前清单的一段原片和完整特效方案");
      const composition = manhuaVfxCompositionSchema.parse({ ...action.vfxRecipe, effects: action.vfxRecipe.effects.map(({ imageId, ...effect }) => {
        if (effect.kind !== "image_overlay") { if (imageId) throw new Error("此特效不接收图片编号"); return effect; }
        const image = imageOptions.find(item => item.id === imageId);
        if (!image) throw new Error("叠加图片不在当前作品清单");
        return { ...effect, imageUri: manhuaVfxMediaIdentity(image.url) };
      }) });
      if (!window.confirm("将顾问特效方案保存到当前作品？此步只保存草案，不渲染；原片和旧候选保留。")) return "用户取消保存特效草案。";
      assertCurrent(); gate.current = true; setSaving(true);
      try {
        const nextDraft = { sourceId: clip.id, sourceKey: manhuaVfxSourceKey(clip), videoUri: clip.url, composition };
        await persist({ ...latest.current, draft: nextDraft });
        if (mounted.current) { setDraft(nextDraft); setTrajectoryText({}); setError(""); }
        return "特效草案已保存；未渲染。请重新inspect并核对原片时长后提交。";
      } finally { gate.current = false; if (mounted.current) setSaving(false); }
    }
    const request = action.requestId ? latest.current.requests[action.requestId] : undefined;
    if (action.operation === "resume") {
      if (!request) throw new Error("当前作品没有这个原请求");
      if (!["submitting", "unknown"].includes(request.status)) return JSON.stringify({ requestId: request.requestId, status: request.status, jobId: request.jobId, note: "沿原任务自动查询，不创建新任务" });
      const receipt = await submit(request, { signal }); if (!receipt) throw new Error("原请求尚未取得回执"); return JSON.stringify(receipt);
    }
    if (action.operation === "adopt") {
      if (!request) throw new Error("当前作品没有这个候选");
      if (!window.confirm("采用此特效候选并保存到当前作品？原片与旧候选保留。")) return "用户取消采用特效候选。";
      assertCurrent(); const receipt = await adopt(request.requestId, { signal }); if (!receipt) throw new Error("候选未采用"); return JSON.stringify(receipt);
    }
    if (action.operation !== "submit") throw new Error("不支持此特效操作");
    if (!window.confirm("按当前已保存特效方案提交渲染候选？原片保留，不自动重试。")) return "用户取消特效渲染。";
    assertCurrent(); const receipt = await submit(undefined, { signal }); if (!receipt) throw new Error("尚未取得特效任务回执"); return JSON.stringify(receipt);
  };
  useEffect(() => { onAdvisorEffectsControl?.(scopeKey, "vfx", (...args) => advisorControl.current(...args)); return () => onAdvisorEffectsControl?.(scopeKey, "vfx", null); }, [scopeKey, onAdvisorEffectsControl]);
  return <ManhuaVfxSurface expanded={expanded} onClose={() => candidatePreview ? setCandidatePreview(undefined) : setExpanded(false)} advisorOpen={advisorOpen} onAdvisorDockChange={onAdvisorDockChange}>
    <section ref={sectionRef} className={`@container/vfx relative flex min-w-0 flex-col gap-3 border border-cyan-300/20 p-4 ${expanded ? "h-full min-h-0 overflow-hidden bg-[#080f19]" : "rounded-2xl bg-slate-950/70"}`} aria-label="漫剧特效工作台">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-cyan-200" /><div><h4 className="text-sm font-semibold text-white">漫剧特效工作台</h4><p className="text-[11px] text-white/45">原片保留 · 参数入稿 · 真实渲染候选</p></div></div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full border border-white/15 px-3 py-1 text-[11px] text-white/60">{draft?.composition.effects.length || 0} / 12 层效果</span>
      {onOpenAdvisor ? <button type="button" className={buttonClass} onClick={() => { setExpanded(true); onOpenAdvisor(); }}><MessageSquare className="mr-1 inline h-3.5 w-3.5" />创作顾问</button> : null}
      <button type="button" className={buttonClass} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 className="mr-1 inline h-3.5 w-3.5" /> : <Maximize2 className="mr-1 inline h-3.5 w-3.5" />}{expanded ? "收起工作台" : "展开工作台"}</button></div></div>
    <details className="text-[11px] leading-relaxed text-white/50"><summary className="cursor-pointer">原声保留 · 最长30秒 · 1080p以内 · 使用范围</summary><p className="pt-2">最长边1920像素。高帧率大画幅素材提交时还会核对处理上限。按画面位置与手动轨迹放置，目前不自动跟踪人物或计算前后遮挡。尚未线上验收。</p></details>
    <label className="block text-xs text-white/70">原片<select className={`${controlClass} mt-1`} value={draft?.sourceId || ""} disabled={locked} onChange={event => {
      const clip = clips.find(item => item.id === event.target.value);
      if (!clip) return;
      setDraft({ sourceId: clip.id, sourceKey: manhuaVfxSourceKey(clip), videoUri: clip.url,
        composition: draft?.composition || { version: 1, seed: 1, effects: [makeManhuaVfxEffect("sword_trail", crypto.randomUUID())] } });
      setTrajectoryText({}); setError("");
    }}><option value="">选择当前作品原片</option>{clips.map(clip => <option key={clip.id} value={clip.id}>{clip.label}</option>)}</select></label>
    {draft && !currentSource ? <p className="text-xs text-amber-200">此方案的来源已变化，请重新选择原片。旧任务与候选仍保留。</p> : null}
    <div data-vfx-editor-columns className={`grid min-w-0 gap-4 @min-[720px]/vfx:grid-cols-[minmax(0,1fr)_340px] ${expanded ? "min-h-0 flex-1 overflow-y-auto @min-[720px]/vfx:overflow-hidden" : "items-start"}`}>
    <div data-vfx-preview-column className={`min-w-0 ${expanded ? "flex min-h-0 flex-col gap-3 overflow-y-auto pr-1" : "space-y-3"}`}>
    <h5 className="flex shrink-0 items-center gap-2 text-xs text-white/70"><Film className="h-4 w-4" />原片预览与定位</h5>
    {sourceUrl ? <div className={`overflow-hidden rounded-xl border border-white/10 bg-black ${expanded ? "flex min-h-[240px] flex-1 flex-col" : ""}`}>
      <div className={`relative ${expanded ? "min-h-0 flex-1" : ""}`} data-vfx-position-frame>
        <video ref={videoRef} key={sourceUrl} controls={!positioning} playsInline preload="metadata" src={gcsTransferUrl(sourceUrl)} className={`w-full object-contain ${expanded ? "absolute inset-0 h-full" : "min-h-48 max-h-[540px] aspect-video"}`} onLoadedMetadata={event => {
          const video = event.currentTarget;
          setDurationSec(video.duration); setPlaybackSec(video.currentTime); measureVideo();
          setSourceError(video.duration > 30 || Math.max(video.videoWidth, video.videoHeight) > 1920 || video.videoWidth * video.videoHeight > 1920 * 1080 ? "原片超出本次支持的时长或画幅，请先在现有工作流裁切或选择合适版本" : "");
        }} onTimeUpdate={event => setPlaybackSec(event.currentTarget.currentTime)} onSeeked={event => setPlaybackSec(event.currentTarget.currentTime)} onError={() => setSourceError("原片暂不可播放，请重新核对素材")} />
        {videoRect && selectedTrajectory.length > 1 ? <svg aria-label="手动轨迹位置参考" className="pointer-events-none absolute z-10 overflow-visible" style={{ left: videoRect.left, top: videoRect.top, width: videoRect.width, height: videoRect.height }} viewBox="0 0 1 1" preserveAspectRatio="none"><polyline data-vfx-trajectory-path points={selectedTrajectory.map(point => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#67e8f9" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg> : null}
        {markerPosition && videoRect ? <span data-vfx-anchor-marker aria-hidden className="pointer-events-none absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-200 bg-cyan-500/35 shadow" style={{ left: videoRect.left + markerPosition[0] * videoRect.width, top: videoRect.top + markerPosition[1] * videoRect.height }} /> : null}
        {markerPosition && videoRect && selectedEffect?.roi ? <span aria-label="手动区域位置参考" className={`pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 border border-dashed border-cyan-200/80 ${selectedEffect.roi.shape === "ellipse" ? "rounded-full" : ""}`} style={{ left: videoRect.left + markerPosition[0] * videoRect.width, top: videoRect.top + markerPosition[1] * videoRect.height, width: selectedEffect.roi.width * selectedEffect.scale * videoRect.width, height: selectedEffect.roi.height * selectedEffect.scale * videoRect.height }} /> : null}
        {positioning ? <button type="button" aria-label="在原片上定位特效" disabled={locked || !selectedEffect} className="absolute inset-0 z-20 cursor-crosshair" onClick={event => {
          const video = videoRef.current;
          if (!video || !selectedEffect) return;
          const box = video.getBoundingClientRect();
          const position = manhuaVfxPositionFromPointer(manhuaVfxContainedVideoRect(box, { width: video.videoWidth, height: video.videoHeight }), { x: event.clientX - box.left, y: event.clientY - box.top });
          if (!position) { setError("留黑区域不属于原片，请在画面内定位"); return; }
          updateEffect(selectedEffect.id, { anchor: { ...selectedEffect.anchor, position } }); setError("");
        }} /> : null}
      </div>
      <div className="shrink-0 space-y-2 p-2">
        <p className="text-[11px] text-white/50">原片定位参考 · 圆点仅标记挂点，特效以渲染候选为准{durationSec > 0 ? ` · ${durationSec.toFixed(2)} 秒` : ""}</p>
        <details open={!expanded} className="text-xs text-cyan-100"><summary className="cursor-pointer">位置与轨迹 · {playbackSec.toFixed(2)} 秒</summary><div className="mt-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="画面定位的特效" className={`${controlClass} w-auto`} value={selectedEffect?.id || ""} disabled={locked} onChange={event => setSelectedEffectId(event.target.value)}>{draft?.composition.effects.map((effect, index) => <option key={effect.id} value={effect.id}>{index + 1}. {LABELS[effect.kind]}</option>)}</select>
          <button type="button" className={buttonClass} aria-pressed={positioning} disabled={locked || !selectedEffect || !durationSec || !canPosition} onClick={() => { videoRef.current?.pause(); setPositioning(value => !value); }}>{positioning ? "结束画面定位" : "点击画面定位"}</button>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-white/65">播放时刻 <input aria-label="特效原片播放秒位" type="range" min={0} max={durationSec || 0} step={0.01} value={playbackSec} disabled={locked || !durationSec} className="min-w-0 flex-1" onChange={event => { const time = Number(event.target.value); if (videoRef.current) { videoRef.current.pause(); videoRef.current.currentTime = time; } setPlaybackSec(time); }} /><span className="w-14 text-right">{playbackSec.toFixed(2)} 秒</span></label>
        <button type="button" className={buttonClass} disabled={locked || !selectedEffect || !durationSec || !canPosition} onClick={addTrajectoryPoint}>用当前秒位添加轨迹点</button>
        {selectedEffect && selectedTrajectory.length ? <div className="flex flex-wrap gap-1.5" aria-label="轨迹关键时刻">{selectedTrajectory.map((point, index) => <button type="button" key={point.timeSec} className="rounded border border-cyan-300/20 px-2 py-1 text-[11px] text-cyan-100 disabled:opacity-40" disabled={locked || !durationSec} onClick={() => { seek(point.timeSec); updateEffect(selectedEffect.id, { anchor: { ...selectedEffect.anchor, position: [point.x, point.y] } }); }}>{index + 1} · {point.timeSec.toFixed(2)} 秒</button>)}</div> : null}
        <p className="text-[11px] text-white/45">暂停并定位挂点，再按当前秒位记录；移动播放时刻后可继续加点。同一时刻再次记录会更新位置。轨迹至少需要两个时刻，仍可在下方精确修改。</p></div></details>
      </div>
    </div> : null}
    {sourceError ? <p className="text-xs text-amber-200">{sourceError}</p> : null}
    {!sourceUrl ? <div className="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-white/20 bg-black/20 px-6 text-center text-sm text-white/45">选择当前作品的真实原片，开始设置特效</div> : null}
    {draft ? <ManhuaVfxTimeline compact={expanded} effects={draft.composition.effects} selectedId={selectedEffect?.id} duration={durationSec} time={playbackSec} disabled={locked} onSelect={setSelectedEffectId} onSeek={seek} onChange={updateEffect} /> : null}
    {comparable.length ? <div className="space-y-2"><label className="block text-xs text-white/65">选择真实候选比较<select aria-label="选择真实候选比较" className={`${controlClass} mt-1`} value={comparison?.requestId || ""} onChange={event => { videoRef.current?.pause(); setComparisonId(event.target.value); }}><option value="">选择已完成候选</option>{comparable.map((request, index) => <option key={request.requestId} value={request.requestId}>候选 {index + 1} · {new Date(request.createdAt).toLocaleTimeString()}{local.adoptedRequestId === request.requestId ? " · 已采用" : ""}</option>)}</select></label>{comparison ? <ManhuaVfxComparison key={comparison.requestId} sourceUrl={sourceUrl} candidateUrl={comparison.output!.gcsUri} /> : null}</div> : null}
    </div>
    <div data-vfx-parameters className={`min-w-0 space-y-3 rounded-xl border border-white/10 bg-white/[.025] p-3 ${expanded ? "min-h-0 overflow-y-auto" : ""}`}>
    <h5 className="flex items-center gap-2 text-xs text-white/70"><SlidersHorizontal className="h-4 w-4" />特效设置</h5>
    {draft ? <>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-white/60">图案编号 <input type="number" min={0} max={2147483647} className={`${controlClass} inline-block w-28`} value={draft.composition.seed} disabled={locked} onChange={event => setDraft({ ...draft, composition: { ...draft.composition, seed: Number(event.target.value) } })} /></label>
        <select aria-label="添加特效" className={`${controlClass} w-auto`} disabled={locked || draft.composition.effects.length >= 12} value="" onChange={event => {
          const effect = makeManhuaVfxEffect(event.target.value as ManhuaVfxEffect["kind"], crypto.randomUUID());
          if (effect.kind === "bullet_time") effect.startSec = Math.max(0, ...draft.composition.effects.map(item => item.startSec + item.durationSec));
          const effects = ["liquid_mirror", "motion_ghost"].includes(effect.kind) ? [effect, ...draft.composition.effects] : [...draft.composition.effects, effect];
          setDraft({ ...draft, composition: { ...draft.composition, effects } }); setSelectedEffectId(effect.id);
        }}><option value="">＋ 添加特效</option>{Object.entries(LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select>
      </div>
      <div aria-label="特效图层" className="flex flex-wrap gap-1.5">{draft.composition.effects.map((effect, index) => <button key={effect.id} type="button" aria-pressed={effect.id === selectedEffect?.id} className={`rounded border px-2 py-1.5 text-xs ${effect.id === selectedEffect?.id ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-100" : "border-white/15 text-white/55"}`} onClick={() => setSelectedEffectId(effect.id)}>{index + 1}. {LABELS[effect.kind]}</button>)}</div>
      <div className="space-y-2">{draft.composition.effects.map((effect, index) => <fieldset key={effect.id} hidden={effect.id !== selectedEffect?.id} disabled={locked} className={`space-y-2 rounded border p-3 ${selectedEffect?.id === effect.id ? "border-cyan-300/40" : "border-white/15"}`} onFocus={() => setSelectedEffectId(effect.id)}>
        <div className="flex items-center justify-between"><span className="text-xs font-semibold text-white">{index + 1}. {LABELS[effect.kind]}</span><button type="button" aria-label={`删除第${index + 1}个特效`} className="text-white/40" onClick={() => setDraft({ ...draft, composition: { ...draft.composition, effects: draft.composition.effects.filter(item => item.id !== effect.id) } })}><Trash2 className="h-3.5 w-3.5" /></button></div>
        {effect.kind === "digital_rain" ? <div className="space-y-2 rounded border border-emerald-300/15 bg-emerald-400/5 p-2">
          <p className="text-[11px] text-emerald-100/75">数字雨与咒语符号墙可直接切换，字符内容、排列和方向进入实际渲染。大小控制整层范围，图案编号固定排列。</p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-white/60">字符样式<select aria-label="流动字符样式" className={controlClass} value={effect.rain?.glyphSet || "hex"} onChange={event => updateEffect(effect.id, { rain: { ...(effect.rain || MANHUA_VFX_RAIN_DEFAULTS), glyphSet: event.target.value as "hex" | "ritual" | "custom", ...(event.target.value === "ritual" ? { layout: "wall" as const } : {}), ...(event.target.value === "custom" && !effect.rain?.characters ? { characters: "天地玄黄" } : {}) } })}><option value="hex">数字与字母</option><option value="ritual">咒语符号</option><option value="custom">自定义字符</option></select></label>
            <label className="text-[11px] text-white/60">排列<select aria-label="流动字符排列" className={controlClass} value={effect.rain?.layout || "rain"} onChange={event => updateEffect(effect.id, { rain: { ...(effect.rain || MANHUA_VFX_RAIN_DEFAULTS), layout: event.target.value as "rain" | "wall" } })}><option value="rain">头部与拖尾</option><option value="wall">流动符号墙</option></select></label>
            <label className="text-[11px] text-white/60">流动方向<select aria-label="流动字符方向" className={controlClass} value={effect.rain?.direction || "down"} onChange={event => updateEffect(effect.id, { rain: { ...(effect.rain || MANHUA_VFX_RAIN_DEFAULTS), direction: event.target.value as "down" | "up" | "left" | "right" } })}><option value="down">向下</option><option value="up">向上</option><option value="left">向左</option><option value="right">向右</option></select></label>
            <label className="text-[11px] text-white/60">字符切换/秒<input aria-label="流动字符切换速度" className={controlClass} type="number" min={0} max={20} step={.5} value={effect.rain?.glyphRate ?? 5} onChange={event => updateEffect(effect.id, { rain: { ...(effect.rain || MANHUA_VFX_RAIN_DEFAULTS), glyphRate: Number(event.target.value) } })} /></label>
          </div>
          {effect.rain?.glyphSet === "custom" ? <label className="block text-[11px] text-white/60">参与流动的字符<input aria-label="流动自定义字符" className={controlClass} maxLength={64} value={effect.rain.characters || ""} onChange={event => updateEffect(effect.id, { rain: { ...effect.rain!, characters: event.target.value } })} /><span>最多64个字符，不填空格；字体不支持的字形会明确报错。</span></label> : null}
          <div className="grid grid-cols-3 gap-2">{([{key:"columns",label:"列数",min:8,max:36,step:1},{key:"speed",label:"下落速度",min:0.05,max:1,step:0.01},{key:"trail",label:"拖尾字符",min:4,max:16,step:1}] as const).map(field=><label key={field.key} className="text-[11px] text-white/60">{field.label}<input aria-label={`数字雨${field.label}`} className={`${controlClass} mt-1`} type="number" min={field.min} max={field.max} step={field.step} value={(effect.rain || MANHUA_VFX_RAIN_DEFAULTS)[field.key]} onChange={event=>updateEffect(effect.id,{rain:{...(effect.rain || MANHUA_VFX_RAIN_DEFAULTS),[field.key]:Number(event.target.value)}})} /></label>)}</div>
          <p className="text-[10px] text-white/45">速度单位：每秒画面高度；最多576个字符，原片与原声保留。</p>
        </div> : null}
        <ManhuaVfxEffectParameters effect={effect} scenes={scenes} onChange={patch => updateEffect(effect.id, patch)} />
        {effect.kind === "image_overlay" ? <div>
          <label className="block text-xs text-white/65">叠加图片<select aria-label={`第${index + 1}个特效叠加图片`} className={`${controlClass} mt-1`} value={effect.imageUri || ""} onChange={event => updateEffect(effect.id, { imageUri: event.target.value || undefined })}><option value="">选择当前作品已保存的图片</option>{effect.imageUri && !imageOptions.some(image => manhuaVfxMediaIdentity(image.url) === effect.imageUri) ? <option value={effect.imageUri}>原图片已不在当前素材列表</option> : null}{imageOptions.map(image => <option key={image.id} value={manhuaVfxMediaIdentity(image.url)}>{image.label}</option>)}</select></label>
          {imageOptions.length === 0 ? <p className="mt-1 text-xs text-amber-200">当前没有可用图片，请先在本集素材中上传或生成图片并保存。外部链接须先保存到素材库。</p> : null}
          {effect.imageUri ? <img alt="所选叠加图片" src={gcsTransferUrl(effect.imageUri)} className="mt-2 h-20 max-w-40 object-contain" /> : null}
          <p className="mt-1 text-[11px] text-white/50">使用图片原色与透明区域；挂点是图片中心，大小按画面高度，强度控制透明度（1为原图，最高按不透明处理）。支持手动轨迹，不自动跟踪。</p>
        </div> : null}
        <div className="grid grid-cols-2 gap-2">
          {([{ key: "startSec", label: "开始秒", min: 0, max: 30, step: 0.05 }, { key: "durationSec", label: "持续秒", min: 0.05, max: 30, step: 0.05 }, { key: "scale", label: "大小（画面高比例）", min: 0.02, max: 2, step: 0.01 }, { key: "intensity", label: "强度", min: 0, max: 2, step: 0.05 }] as const).map(field => <label key={field.key} className="text-[11px] text-white/60">{field.label}<input className={`${controlClass} mt-1`} type="number" disabled={effect.kind === "bullet_time" && (field.key === "scale" || field.key === "intensity")} {...{ min: field.min, max: field.max, step: field.step }} value={effect[field.key]} onChange={event => updateEffect(effect.id, { [field.key]: Number(event.target.value) })} /></label>)}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {!["image_overlay", "liquid_mirror", "motion_ghost", "bullet_time"].includes(effect.kind) ? <label className="text-[11px] text-white/60">颜色<input className={`${controlClass} mt-1 h-8`} type="color" value={effect.color} onChange={event => updateEffect(effect.id, { color: event.target.value })} /></label> : null}
          {([0, 1] as const).map(axis => <label key={axis} className="text-[11px] text-white/60">{axis === 0 ? "横向位置（左0 → 右1）" : "纵向位置（上0 → 下1）"}<input disabled={effect.kind === "bullet_time"} type="number" min={0} max={1} step={0.01} className={`${controlClass} mt-1`} value={effect.anchor.position[axis]} onChange={event => { const position: [number, number] = [...effect.anchor.position]; position[axis] = Number(event.target.value); updateEffect(effect.id, { anchor: { ...effect.anchor, position } }); }} /></label>)}
        </div>
        {effect.kind !== "bullet_time" ? <details><summary className="cursor-pointer text-[11px] text-cyan-200">手动运动轨迹（可选）</summary><p className="my-1 text-[11px] text-white/50">每行填写「整片秒数 横向位置 纵向位置」，至少两行且时间递增；位置取0至1。不填写时固定在上方位置。</p><textarea aria-label={`第${index + 1}个特效轨迹`} rows={3} className={controlClass} placeholder="0 0.2 0.5&#10;1 0.8 0.5" value={trajectoryText[effect.id] ?? effect.anchor.trajectory?.map(point => `${point.timeSec} ${point.x} ${point.y}`).join("\n") ?? ""} onChange={event => setTrajectoryText({ ...trajectoryText, [effect.id]: event.target.value })} /></details> : null}
      </fieldset>)}</div>
      <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} disabled={locked || !onStateChange} onClick={() => void saveDraft()}>保存方案</button><button type="button" className={buttonClass} disabled={locked || pending || !onStateChange || !currentSource || Boolean(sourceError) || !durationSec} onClick={() => void submit()}>{saving ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : null}渲染特效候选</button></div>
    </> : <p className="text-xs leading-relaxed text-white/45">选定原片后可添加效果、设置时间与位置，再生成候选。</p>}
    </div></div>
    {error ? <p role="alert" className="text-xs text-amber-200">{error}</p> : notice ? <p role="status" className="text-xs text-emerald-200">{notice}</p> : null}
    <details className="shrink-0 rounded-xl border border-white/10 bg-black/20 p-3" open={!expanded || Boolean(pending)}><summary className="cursor-pointer list-none"><h5 className="inline-flex items-center gap-2 text-xs font-semibold text-white/80"><Layers className="h-4 w-4" />任务与候选 · {Object.keys(local.requests).length} 项</h5></summary>
    {!Object.keys(local.requests).length ? <p className="rounded-lg border border-dashed border-white/15 p-4 text-xs text-white/45">还没有特效候选。保存当前方案并渲染后，任务进度与真实结果会出现在这里。</p> : null}
    <div className="mt-2 max-h-44 space-y-2 overflow-y-auto" aria-label="特效任务与候选">{Object.values(local.requests).sort((a, b) => b.createdAt - a.createdAt).map(request => {
      const outputUrl = request.output?.gcsUri || request.output?.url;
      const eligible = draft && canAdoptManhuaVfxRequest({ ...local, draft }, request.requestId, clips);
      const status = { submitting: "提交回执待确认", unknown: "回执待确认", queued: "排队中", running: "渲染中", succeeded: "候选已完成", failed: "任务失败" }[request.status];
      return <div key={request.requestId} className="rounded border border-white/15 bg-black/15 p-2 text-xs text-white/70"><div className="flex flex-wrap items-center gap-2"><span>{status} · {new Date(request.createdAt).toLocaleString()}</span>{local.adoptedRequestId === request.requestId ? <span className="text-emerald-200">已采用</span> : null}</div><div className="mt-2 flex flex-wrap gap-2">
        {outputUrl ? <button type="button" className={buttonClass} onClick={() => { videoRef.current?.pause(); setExpanded(true); setCandidatePreview(outputUrl); onPreview(outputUrl, "特效候选"); }}>预览候选</button> : null}
        {comparable.some(item => item.requestId === request.requestId) ? <button type="button" className={buttonClass} aria-pressed={comparisonId === request.requestId} onClick={() => { videoRef.current?.pause(); setComparisonId(request.requestId); }}>与原片比较</button> : null}
        {request.status === "succeeded" ? <><button type="button" className={buttonClass} disabled={locked} onClick={() => { setDraft({ sourceId: request.sourceId, sourceKey: request.sourceKey, videoUri: request.videoUri, composition: request.composition }); setTrajectoryText({}); setError(""); }}>恢复此方案</button><button type="button" className={buttonClass} disabled={locked || !eligible || Object.keys(trajectoryText).length > 0} onClick={() => void adopt(request.requestId)}>采用此候选</button></> : null}
        {request.status === "submitting" || request.status === "unknown" ? <button type="button" className={buttonClass} disabled={locked} onClick={() => void submit(request)}>查询原请求</button> : null}
      </div>{request.error ? <p className="mt-1 text-amber-200">{maskMediaProviderDetails(request.error)}</p> : null}<p className="mt-1 select-all text-[10px] text-white/35">任务：{request.jobId || request.requestId}</p>{request.status === "succeeded" && !eligible ? <p className="mt-1 text-[11px] text-white/45">采用前需恢复对应方案，且原片仍是相同版本。</p> : null}</div>;
    })}</div></details>
    {candidatePreview ? <div role="dialog" aria-modal="true" aria-label="特效候选预览" className="absolute inset-0 z-30 flex min-h-0 flex-col gap-3 bg-slate-950 p-4">
      <div className="flex items-center justify-between gap-3"><h5 className="text-sm text-white">特效候选 · 尚未替换原片</h5><button autoFocus type="button" className={buttonClass} onClick={() => setCandidatePreview(undefined)}>关闭候选预览</button></div>
      <video controls playsInline preload="metadata" src={gcsTransferUrl(candidatePreview)} className="min-h-0 flex-1 bg-black object-contain" />
    </div> : null}
  </section></ManhuaVfxSurface>;
}
