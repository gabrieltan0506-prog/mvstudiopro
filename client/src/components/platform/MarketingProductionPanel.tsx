/**
 * 营销 / 知识口播「制作稿 → 段落 → 画面 + 配音 → 后期导出」工作区（/platform?mode=create，营销方案下方）。
 * - 画面：共用找素材抽屉（purpose=marketing, usage=insert，带入点/出点）或本人上传的产品视频，数据上区分 stock / upload；
 *   「整稿找素材」只为无画面段落预取关键词与候选数（最多 3 段并发），不自动采用；
 * - 时间线：段落下方「画面 / 旁白」双轨，按段落时长排布；
 * - 配音：复用 canvasAudio.generateDialogue / getDialogue（不改 TTS 与计费）；
 * - 导出：复用后期工坊 queuePostProd（bgm_mount 逐段贴配音 → concat 取段 + 同步字幕），getPostProdJob 查询；
 * - 恢复：草稿（编号、绑定、任务号）按登录用户存本机；任务与配音以服务端记录为准，刷新后续查不重复扣费。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { publicMarketingPlan } from "@shared/marketingPlanDisplay";
import { uploadOneCanvasAsset } from "@/lib/canvasUpload";
import { StockFootageDrawer, type StockFootagePick } from "@/components/stockFootage/StockFootageDrawer";
import { STOCK_DRAWER_PER_PAGE, defaultMinDurationSec, keywordSourceText } from "@/components/stockFootage/stockFootageModel";
import { canvasTtsCreditsForDuration } from "@shared/canvasGenerationPricing";
import { MarketingVoicePicker } from "./MarketingVoicePicker";
import { VideoGradeEntry, VideoToolToggles, gradeSourceFromPlayableUrl, type VideoTool } from "@/components/HomePhotoVideoUpscale";
import { VideoEditPanel } from "@/components/canvas/VideoEditPanel";
import { MarketingSegmentTimeline, MarketingThumb } from "./MarketingSegmentTimeline";
import {
  applyPostProdJobResult,
  auditMarketingExport,
  carryOverSegmentBindings,
  extractMarketingScriptSection,
  findRecoveredPostProdJob,
  mapWithConcurrency,
  marketingConcatInput,
  marketingCreditLines,
  marketingDialogueRequest,
  marketingMountInput,
  marketingMountKey,
  marketingProductionStorageKey,
  marketingSegmentTargetSec,
  marketingSegmentTitle,
  marketingStockSourceText,
  marketingTrimOverrunSec,
  marketingVisualRef,
  marketingVisualStartSec,
  marketingVoiceFromDialogue,
  marketingVoicePending,
  marketingVoiceReady,
  marketingVoiceTrackState,
  newMarketingProductionDraft,
  nextMarketingExportStep,
  parseMarketingProductionDraft,
  segmentMarketingScript,
  stockVisualFromAsset,
  uploadVisualFromFile,
  type MarketingPostJob,
  type MarketingProductionDraft,
  type MarketingSegment,
} from "@shared/marketingProduction";

const buttonStyle = "rounded-lg border border-white/20 px-3 py-2 text-sm disabled:opacity-40";
/** 成片调色单独归属，不与导出成片的 concat 恢复（scopeKey marketing:<稿号>）混淆。 */
export function marketingGradeScopeKey(draftId: string): string {
  return `marketing-grade:${draftId}`.slice(0, 128);
}
const ACTIVE_JOB = ["queued", "running"];
/** 整稿找素材的并发上限。 */
const PREFETCH_CONCURRENCY = 3;
/** 与抽屉首屏同参（第 1 页、每页 STOCK_DRAWER_PER_PAGE、默认最短时长），抽屉打开时直接命中同一份候选缓存；参数不同则缓存不命中、候选数也对不上。 */
const PREFETCH_PER_PAGE = STOCK_DRAWER_PER_PAGE;

/** 整稿找素材的预取结果（只在本次会话内，供抽屉直接带入关键词；不入稿、不自动采用）。 */
type Prefetch = { sourceText: string; status: "loading" | "done" | "failed"; query?: string; queryZh?: string; count?: number };

function newId(): string {
  return crypto.randomUUID();
}

function loadDraft(userKey: string): MarketingProductionDraft {
  try {
    const raw = window.localStorage.getItem(marketingProductionStorageKey(userKey));
    const parsed = raw ? parseMarketingProductionDraft(JSON.parse(raw)) : null;
    if (parsed) return parsed;
  } catch { /* 读不到就开新稿 */ }
  return newMarketingProductionDraft(newId());
}

function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(video.duration); };
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error("无法读取视频时长，请换一个文件")); };
    video.src = url;
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "操作未完成，请稍后重试";
}

export function MarketingProductionPanel({ userKey }: { userKey: string }) {
  // 直接读与营销方案面板同一份查询（共用缓存，不多发请求），不再经父页状态回写：
  // 线上验收发现子组件挂载时回写父页状态会导致方案卡片 DOM 残留重复。
  const latestPlan = trpc.mvAnalysis.getPlatformMarketingPlan.useQuery({ jobId: undefined, scope: userKey }, { retry: false });
  const seedMarkdown = latestPlan.data ? publicMarketingPlan(latestPlan.data.result).steps.integrated.text || "" : "";
  const [draft, setDraft] = useState<MarketingProductionDraft>(() => loadDraft(userKey));
  const ref = useRef(draft);
  const [message, setMessage] = useState("");
  const [drawerSegmentId, setDrawerSegmentId] = useState<string | null>(null);
  const [prefetch, setPrefetch] = useState<Record<string, Prefetch>>({});
  const [prefetching, setPrefetching] = useState(false);
  /** 本次会话上传素材的本机预览（刷新后不保留，只显示文件名占位）。 */
  const [localPreview, setLocalPreview] = useState<Record<string, string>>({});
  const [finalUrl, setFinalUrl] = useState<string>();
  const [finalSec, setFinalSec] = useState(0);
  const [tool, setTool] = useState<VideoTool | null>(null);
  const [busy, setBusy] = useState(false);
  const utils = trpc.useUtils();
  const dialogue = trpc.canvasAudio.generateDialogue.useMutation();
  const queue = trpc.mvAnalysis.queuePostProd.useMutation();
  const upload = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  // 已采用图库素材的缩略：按本稿编号列出本人采用记录（服务端现签读地址，只在本次会话使用，不入稿）
  const hasStockVisual = draft.segments.some(s => s.visual?.source === "stock");
  const adoptions = trpc.stockFootage.listAdoptions.useQuery({ purpose: "marketing", projectId: draft.draftId, limit: 100 }, { retry: false, enabled: hasStockVisual });
  const adoptedUrl = useMemo(() => new Map((adoptions.data || []).map(a => [a.assetId, a.url] as const)), [adoptions.data]);

  /** 所有修改都经此落本机，刷新后从同一草稿续做。 */
  const save = useCallback((update: (d: MarketingProductionDraft) => MarketingProductionDraft) => {
    const next = { ...update(ref.current), updatedAt: new Date().toISOString() };
    ref.current = next;
    setDraft(next);
    try { window.localStorage.setItem(marketingProductionStorageKey(userKey), JSON.stringify(next)); }
    catch { setMessage("本机存储不可用：刷新后需要按任务记录重新核对。"); }
  }, [userKey]);

  const patchSegment = (segmentId: string, patch: (s: MarketingSegment) => MarketingSegment) =>
    save(d => ({ ...d, segments: d.segments.map(s => (s.segmentId === segmentId ? patch(s) : s)) }));
  const setJob = (target: "final" | string, job: MarketingPostJob) =>
    save(d => (target === "final" ? { ...d, final: job } : { ...d, mounts: { ...d.mounts, [target]: job } }));

  const act = async (label: string, run: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await run(); }
    catch (error) { setMessage(`${label}未完成：${errorText(error)}`); }
    finally { setBusy(false); }
  };

  // ------------------------------------------------------------ 制作稿 → 段落
  const convert = () => {
    const result = segmentMarketingScript(ref.current.scriptText);
    if (!result.ok) { setMessage(result.error); return; }
    save(d => ({ ...d, segments: carryOverSegmentBindings(d.segments, result.segments), mounts: {}, final: undefined }));
    setFinalUrl(undefined);
    setMessage(`已转换为 ${result.segments.length} 段${result.droppedVisualOnly ? `，${result.droppedVisualOnly} 段只有画面没有口播，未进入时间线` : ""}。口播未变的段落沿用原画面与配音。`);
  };

  // ------------------------------------------------------------ 画面
  const adoptUpload = (segment: MarketingSegment, file: File) => act("上传产品素材", async () => {
    if (!file.type.startsWith("video/")) throw new Error("段落画面请上传视频（MP4/MOV/WebM）");
    if (file.size > 500 * 1024 * 1024) throw new Error("单个视频最大 500MB");
    const durationSec = await readVideoDuration(file);
    const asset = await uploadOneCanvasAsset({ file, index: 0, getSignedUploadUrl: input => upload.mutateAsync(input) });
    if (!asset.gcsUri) throw new Error("上传未返回持久素材地址，未采用");
    const visual = uploadVisualFromFile({ gcsUri: asset.gcsUri, fileName: file.name, mimeType: asset.mimeType || file.type, durationSec });
    patchSegment(segment.segmentId, s => ({ ...s, visual }));
    setLocalPreview(prev => {
      if (prev[segment.segmentId]) URL.revokeObjectURL(prev[segment.segmentId]);
      return { ...prev, [segment.segmentId]: URL.createObjectURL(file) };
    });
    setMessage("已采用本人上传的产品素材。");
  });

  /**
   * 抽屉「采用并绑定」→ 段落画面（含入点/出点）。校验不过抛错：抽屉提示并保持打开，
   * 重试只重新绑定已采用的同一素材，不重复保存。成功后由这里关闭抽屉。
   */
  const adoptPick = async (segmentId: string, pick: StockFootagePick) => {
    const index = ref.current.segments.findIndex(s => s.segmentId === segmentId);
    if (index < 0) throw new Error("这一段已不在当前制作稿里，未绑定");
    const visual = stockVisualFromAsset(pick.asset, { inSec: pick.inSec, outSec: pick.outSec });
    patchSegment(segmentId, s => ({ ...s, visual }));
    setDrawerSegmentId(null);
    setMessage(`第 ${index + 1} 段已采用素材（取 ${visual.trim ? `${visual.trim.inSec.toFixed(1)}–${visual.trim.outSec.toFixed(1)} 秒` : "整段"}）。`);
    void adoptions.refetch();
  };

  /** 整稿找素材：只为没有画面的段落预取关键词 + 候选数（最多 3 段并发），不自动采用。 */
  const prefetchAll = async () => {
    if (prefetching) return;
    const d = ref.current;
    const targets = d.segments.filter(s => !s.visual && s.narration.trim());
    if (!targets.length) { setMessage("所有段落都已有画面。"); return; }
    setPrefetching(true); setMessage("");
    setPrefetch(prev => ({ ...prev, ...Object.fromEntries(targets.map(s => [s.segmentId, { sourceText: marketingStockSourceText(s), status: "loading" as const }])) }));
    const results = await mapWithConcurrency(targets, PREFETCH_CONCURRENCY, async segment => {
      const sourceText = marketingStockSourceText(segment);
      const keywords = await utils.stockFootage.suggestKeywords.fetch({ text: keywordSourceText(sourceText), purpose: "marketing", orientation: d.orientation });
      const query = keywords.query.trim().slice(0, 100);
      if (!query) throw new Error("没有生成关键词");
      const minDurationSec = defaultMinDurationSec(marketingSegmentTargetSec(segment));
      const found = await utils.stockFootage.search.fetch({ query, kind: "video", orientation: d.orientation, page: 1, perPage: PREFETCH_PER_PAGE, purpose: "marketing", ...(minDurationSec ? { minDurationSec } : {}) });
      const value: Prefetch = { sourceText, status: "done", query, queryZh: keywords.queryZh, count: found.candidates.length };
      setPrefetch(prev => ({ ...prev, [segment.segmentId]: value }));
      return value;
    });
    const failed = targets.filter((_, i) => !results[i].ok);
    if (failed.length) setPrefetch(prev => ({ ...prev, ...Object.fromEntries(failed.map(s => [s.segmentId, { sourceText: marketingStockSourceText(s), status: "failed" as const }])) }));
    const found = results.filter(r => r.ok && (r.value.count || 0) > 0).length;
    setMessage(`已为 ${targets.length} 段找候选：${found} 段有候选${failed.length ? `，${failed.length} 段暂未找到，可点「找素材」重试` : ""}。点开各段挑选并采用。`);
    setPrefetching(false);
  };

  /** 预取结果只在口播/画面提示未变时有效。 */
  const prefetchFor = (segment: MarketingSegment): Prefetch | undefined => {
    const p = prefetch[segment.segmentId];
    return p && p.sourceText === marketingStockSourceText(segment) ? p : undefined;
  };

  const thumbFor = (segment: MarketingSegment) => {
    const visual = segment.visual;
    if (!visual) return { label: "待配画面" };
    if (visual.source === "stock") return { url: adoptedUrl.get(visual.assetId), startSec: marketingVisualStartSec(visual), label: "素材已采用" };
    return { url: localPreview[segment.segmentId], label: "我的素材" };
  };

  // 卸载时释放本机预览地址
  const previewRef = useRef(localPreview);
  previewRef.current = localPreview;
  useEffect(() => () => { for (const url of Object.values(previewRef.current)) URL.revokeObjectURL(url); }, []);

  // ------------------------------------------------------------ 配音
  const generateVoice = (segment: MarketingSegment) => act("生成配音", async () => {
    const voice = ref.current.voiceId || "";
    const request = marketingDialogueRequest(ref.current, segment, voice, newId());
    const estimate = canvasTtsCreditsForDuration(segment.estimatedSec);
    if (!window.confirm(`将为本段生成配音，按实际时长扣费（预估约 ${estimate} 积分）。\n\n${request.input}`)) return;
    // 先落请求编号再提交：断线/刷新后用同一编号查询，不重复扣费
    patchSegment(segment.segmentId, s => ({ ...s, voice: { billingRequestId: request.billingRequestId, voice: request.voice, narration: s.narration, status: "submitted" } }));
    try {
      const response = await dialogue.mutateAsync(request);
      patchSegment(segment.segmentId, s => (s.voice?.billingRequestId === request.billingRequestId ? { ...s, voice: marketingVoiceFromDialogue(s.voice, response) } : s));
    } catch (error) {
      patchSegment(segment.segmentId, s => (s.voice?.billingRequestId === request.billingRequestId ? { ...s, voice: { ...s.voice, status: "unknown", message: errorText(error).slice(0, 500) } } : s));
      throw error;
    }
  });

  const refreshVoice = useCallback(async (segment: MarketingSegment) => {
    const voice = segment.voice;
    if (!voice) return;
    const response = await utils.canvasAudio.getDialogue.fetch({ billingRequestId: voice.billingRequestId });
    if (!response) {
      patchSegment(segment.segmentId, s => (s.voice?.billingRequestId === voice.billingRequestId ? { ...s, voice: { ...s.voice, status: "failed", message: "没有找到这次配音记录，可重新生成" } } : s));
      return;
    }
    patchSegment(segment.segmentId, s => (s.voice?.billingRequestId === voice.billingRequestId ? { ...s, voice: marketingVoiceFromDialogue(s.voice, response) } : s));
  }, [utils]);

  // ------------------------------------------------------------ 后期导出
  const submitJob = async (target: "final" | string, input: Parameters<typeof queue.mutateAsync>[0], key: string) => {
    setJob(target, { key, status: "submitting" });
    try {
      const response = await queue.mutateAsync(input);
      setJob(target, { key, status: "queued", jobId: String(response.jobId) });
    } catch (error) {
      setJob(target, { key, status: "failed", error: errorText(error).slice(0, 500) });
      throw error;
    }
  };

  const advanceExport = useCallback(async (manual: boolean) => {
    const current = ref.current;
    const step = nextMarketingExportStep(current);
    if (step.kind === "blocked") { if (manual) setMessage(step.issues.join("\n")); return; }
    if (step.kind === "wait") { if (manual) setMessage(`${step.reason}，完成后自动继续。`); return; }
    if (step.kind === "done") { if (manual) setMessage("成片已导出。"); return; }
    if (step.kind === "mount") {
      for (const segmentId of step.segmentIds) {
        const segment = ref.current.segments.find(s => s.segmentId === segmentId)!;
        const prior = ref.current.mounts[segmentId];
        const key = marketingMountKey(ref.current, segment);
        if (!manual && prior?.key === key && prior.status === "failed") continue; // 同参数失败只在手动时重提
        await submitJob(segmentId, marketingMountInput(ref.current, segment), key);
      }
      return;
    }
    const input = marketingConcatInput(current);
    const key = JSON.stringify(input);
    if (!manual && current.final?.key === key) return; // 同参数失败不自动重提
    await submitJob("final", input, key);
  }, []);

  /** 刷新恢复：提交中却没拿到任务号的，按 scopeKey + 动作 + 画面引用找回原任务。 */
  const recoverSubmitting = useCallback(async () => {
    const d = ref.current;
    const orphan = [...Object.entries(d.mounts), ...(d.final ? [["final", d.final] as const] : [])].filter(([, job]) => job.status === "submitting" && !job.jobId);
    if (!orphan.length) return;
    const rows = await utils.mvAnalysis.listPostProdJobs.fetch({ limit: 100 });
    for (const [target, job] of orphan) {
      let expected: Parameters<typeof findRecoveredPostProdJob>[1] | null = null;
      if (target === "final") {
        try { expected = { scopeKey: `marketing:${d.draftId}`, action: "concat", sourceVideoUris: (JSON.parse(job.key) as { params: { clips: string[] } }).params.clips }; } catch { expected = null; }
      } else {
        const segment = d.segments.find(s => s.segmentId === target);
        if (segment?.visual) expected = { scopeKey: `marketing:${d.draftId}`, action: "bgm_mount", sourceVideoUris: [marketingVisualRef(segment.visual)] };
      }
      const jobId = expected ? findRecoveredPostProdJob(rows as never, expected) : null;
      setJob(target, jobId ? { ...job, status: "queued", jobId } : { ...job, status: "failed", error: "提交未确认且没有找到原任务，可重新导出" });
    }
  }, [utils]);

  // 轮询：配音待核对、后期任务排队/处理中；完成后自动推进下一步
  useEffect(() => {
    let stopped = false;
    void recoverSubmitting().catch(() => undefined);
    const tick = async () => {
      const d = ref.current;
      for (const segment of d.segments) if (marketingVoicePending(segment) && segment.voice?.status !== "submitted") await refreshVoice(segment).catch(() => undefined);
      const jobs = [...Object.entries(d.mounts), ...(d.final ? [["final", d.final] as const] : [])].filter(([, job]) => job.jobId && ACTIVE_JOB.includes(job.status));
      for (const [target, job] of jobs) {
        try {
          const response = await utils.mvAnalysis.getPostProdJob.fetch({ jobId: job.jobId! });
          const latest = target === "final" ? ref.current.final : ref.current.mounts[target];
          if (latest && latest.jobId === job.jobId) setJob(target, applyPostProdJobResult(latest, response));
        } catch { /* 下一轮重试 */ }
      }
      if (!stopped && Object.keys(ref.current.mounts).length) await advanceExport(false).catch(error => setMessage(errorText(error)));
    };
    const timer = window.setInterval(() => { if (!stopped) void tick(); }, 4000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [advanceExport, recoverSubmitting, refreshVoice, utils]);

  // 成片读链：只按任务现签，不入稿
  useEffect(() => {
    const jobId = draft.final?.status === "succeeded" ? draft.final.jobId : undefined;
    if (!jobId) { setFinalUrl(undefined); return; }
    let alive = true;
    void utils.mvAnalysis.getPostProdJob.fetch({ jobId }).then(r => {
      const url = r?.output && typeof r.output === "object" ? (r.output as { url?: unknown }).url : undefined;
      if (alive && typeof url === "string") setFinalUrl(url);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [draft.final?.status, draft.final?.jobId, utils]);

  const issues = useMemo(() => auditMarketingExport(draft), [draft]);
  const step = useMemo(() => nextMarketingExportStep(draft), [draft]);
  const credits = useMemo(() => marketingCreditLines(draft), [draft]);
  const seedScript = seedMarkdown ? extractMarketingScriptSection(seedMarkdown) : "";
  const drawerIndex = drawerSegmentId ? draft.segments.findIndex(s => s.segmentId === drawerSegmentId) : -1;
  const drawerSegment = drawerIndex >= 0 ? draft.segments[drawerIndex] : undefined;
  const trialSegment = draft.segments.find(s => s.narration.trim());

  return <section className="mt-4 rounded-2xl border border-emerald-300/25 bg-[#0f1a1a] p-4 text-slate-100" aria-label="口播制作稿与成片导出">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-base font-bold">制作稿 → 剪辑 → 导出成片</h3>
        <p className="mt-1 text-xs text-slate-400">口播/分镜稿切成段落；每段配图库补充画面或你的产品视频，再配音、拼接并烧录同步字幕。</p></div>
      <button type="button" className={buttonStyle} disabled={busy} onClick={() => {
        if (draft.segments.length && !window.confirm("新建会清空当前段落绑定（已生成的配音与任务记录仍保留在服务端）。继续？")) return;
        save(() => newMarketingProductionDraft(newId())); setFinalUrl(undefined); setMessage("已新建制作稿。");
      }}>新建制作稿</button>
    </div>

    <label className="mt-3 block text-sm font-semibold" htmlFor="marketing-production-script">口播 / 分镜制作稿</label>
    <textarea id="marketing-production-script" value={draft.scriptText} rows={8} maxLength={40_000}
      onChange={event => { const scriptText = event.target.value; save(d => ({ ...d, scriptText })); }}
      placeholder={"第1段\n画面：产品特写\n口播：……\n\n第2段\n画面：使用场景\n口播：……"}
      className="mt-2 w-full rounded-lg border border-white/20 bg-black/20 p-3 text-sm leading-6" />
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" className={buttonStyle} disabled={busy || !seedScript} title={seedMarkdown && !seedScript ? "整合方案里没有口播/脚本/分镜小节" : undefined}
        onClick={() => { save(d => ({ ...d, scriptText: seedScript })); setMessage("已从整合方案带入口播/分镜小节，可修改后转换。"); }}>从整合方案带入口播稿</button>
      <button type="button" className={`${buttonStyle} bg-emerald-400/15`} disabled={busy || !draft.scriptText.trim()} onClick={convert}>转换为段落时间线</button>
      <select aria-label="成片画幅" className={buttonStyle} value={draft.orientation}
        onChange={event => { const orientation = event.target.value as MarketingProductionDraft["orientation"]; save(d => ({ ...d, orientation })); }}>
        <option value="portrait">竖屏 1080×1920</option><option value="landscape">横屏 1920×1080</option>
      </select>
    </div>

    <MarketingVoicePicker key={userKey} userKey={userKey} draftId={draft.draftId} voiceId={draft.voiceId} disabled={busy}
      onSelect={voiceId => save(d => ({ ...d, voiceId }))} onMessage={setMessage}
      trialSegment={trialSegment ? { index: draft.segments.indexOf(trialSegment), narration: trialSegment.narration } : undefined} />

    {draft.segments.length > 0 && <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm font-semibold">段落（{draft.segments.length}）· 已配画面 {draft.segments.filter(s => s.visual).length} 段</span>
      <button type="button" className={`${buttonStyle} bg-emerald-400/15`} disabled={busy || prefetching || draft.segments.every(s => s.visual)}
        title="为所有还没有画面的段落找候选素材，不会自动采用"
        onClick={() => void prefetchAll()}>{prefetching ? "正在整稿找素材…" : "整稿找素材"}</button>
    </div>}

    {draft.segments.length > 0 && <ol className="mt-2 space-y-3">
      {draft.segments.map((segment, index) => {
        const voice = segment.voice;
        const voiceStale = Boolean(voice && voice.narration !== segment.narration);
        const mount = draft.mounts[segment.segmentId];
        const thumb = thumbFor(segment);
        const found = prefetchFor(segment);
        const overrun = marketingTrimOverrunSec(segment);
        const voiceState = marketingVoiceTrackState(segment);
        const isPortrait = draft.orientation === "portrait";
        return <li key={segment.segmentId} className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="flex gap-3">
            <button type="button" aria-label={`第 ${index + 1} 段画面，点击找素材`} disabled={busy}
              className={`shrink-0 overflow-hidden rounded-lg ${isPortrait ? "h-28 w-16" : "h-16 w-28"}`}
              onClick={() => setDrawerSegmentId(segment.segmentId)}>
              <MarketingThumb url={thumb.url} startSec={thumb.startSec} label={thumb.label} className="h-full w-full rounded-lg" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold text-slate-100">
                  <span className="mr-2 text-emerald-200">{String(index + 1).padStart(2, "0")}</span>{marketingSegmentTitle(segment)}
                  <span className="ml-2 text-xs font-normal text-slate-400">约 {marketingSegmentTargetSec(segment).toFixed(1)} 秒</span>
                </span>
                <div className="flex flex-wrap gap-2">
                  <label className={`${buttonStyle} cursor-pointer py-1 text-xs`}>上传素材
                    <input type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" disabled={busy}
                      onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void adoptUpload(segment, file); }} /></label>
                  <button type="button" className={`${buttonStyle} py-1 text-xs`} disabled={busy} onClick={() => setDrawerSegmentId(segment.segmentId)}>找素材</button>
                  {segment.visual && <button type="button" className={`${buttonStyle} py-1 text-xs`} disabled={busy} onClick={() => patchSegment(segment.segmentId, s => ({ ...s, visual: undefined }))}>移除画面</button>}
                </div>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
                {segment.visual?.source === "stock" && <span>画面：已采用素材{segment.visual.trim ? ` · 取 ${segment.visual.trim.inSec.toFixed(1)}–${segment.visual.trim.outSec.toFixed(1)} 秒` : ""} · 素材 {segment.visual.durationSec.toFixed(1)} 秒</span>}
                {segment.visual?.source === "upload" && <span>画面：我的素材 · {segment.visual.fileName} · {segment.visual.durationSec.toFixed(1)} 秒</span>}
                {!segment.visual && <span className="text-amber-200">待配画面</span>}
                {!segment.visual && found?.status === "loading" && <span>正在找候选…</span>}
                {!segment.visual && found?.status === "done" && <span className="text-emerald-200">{found.count ? `已找到 ${found.count} 个候选` : "没有找到候选，可改关键词再找"}{found.queryZh ? ` · ${found.queryZh}` : ""}</span>}
                {!segment.visual && found?.status === "failed" && <span>候选暂未找到，可点「找素材」重试</span>}
                {overrun > 0 && <span className="text-amber-200">配音比选段长，成片将从出点顺延 {overrun.toFixed(1)} 秒</span>}
                {mount && <span>贴装：{mount.status}{mount.error ? `（${mount.error}）` : ""}</span>}
              </div>
              {segment.visualHint && <p className="mt-1 text-xs text-slate-400">画面提示：{segment.visualHint}</p>}
            </div>
          </div>
          <textarea aria-label={`第 ${index + 1} 段口播`} value={segment.narration} rows={2} maxLength={4000}
            onChange={event => { const narration = event.target.value; patchSegment(segment.segmentId, s => ({ ...s, narration })); }}
            className="mt-2 w-full rounded-lg border border-white/15 bg-black/20 p-2 text-sm" />

          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-slate-300">配音：{voiceState.label}{voice?.message && !marketingVoiceReady(segment) ? ` · ${voice.message}` : ""}</span>
            <button type="button" className={buttonStyle} disabled={busy || !draft.voiceId || !segment.narration.trim() || (marketingVoicePending(segment) && !voiceStale)}
              onClick={() => void generateVoice(segment)}>{voice && !voiceStale ? "重新生成配音" : "生成本段配音"}</button>
            {voice && (marketingVoicePending(segment) || (voice.status === "succeeded" && !marketingVoiceReady(segment) && !voiceStale)) &&
              <button type="button" className={buttonStyle} disabled={busy} onClick={() => void act("查询配音", () => refreshVoice(segment))}>查询原配音任务</button>}
          </div>
        </li>;
      })}
    </ol>}

    <MarketingSegmentTimeline segments={draft.segments} thumbFor={thumbFor} disabled={busy} onOpenSegment={setDrawerSegmentId} />

    {drawerSegment && <StockFootageDrawer key={drawerSegment.segmentId} open onClose={() => setDrawerSegmentId(null)}
      title={`为第 ${drawerIndex + 1} 段找素材`} purpose="marketing" usage="insert" kind="video" orientation={draft.orientation}
      targetDurationSec={marketingSegmentTargetSec(drawerSegment)} sourceText={marketingStockSourceText(drawerSegment)}
      initialQuery={prefetchFor(drawerSegment)?.query}
      context={{ projectId: draft.draftId, segmentId: drawerSegment.segmentId, note: "营销口播段落画面" }}
      onPick={pick => adoptPick(drawerSegment.segmentId, pick)} />}

    {draft.segments.length > 0 && <div className="mt-4 rounded-xl border border-emerald-300/25 p-3">
      {issues.length > 0 && <ul className="mb-2 list-disc pl-5 text-xs text-amber-200">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`${buttonStyle} bg-emerald-400/15`} disabled={busy || step.kind === "blocked" || step.kind === "wait" || step.kind === "done"}
          onClick={() => void act("导出成片", () => advanceExport(true))}>
          {step.kind === "concat" && draft.final?.status === "failed" ? "重新拼接成片" : "导出成片（逐段贴配音 → 拼接 + 字幕）"}</button>
        <span className="text-xs text-slate-400">{step.kind === "wait" ? step.reason : step.kind === "done" ? "成片已导出" : step.kind === "mount" ? `待贴装 ${step.segmentIds.length} 段` : step.kind === "concat" ? "贴装完成，待拼接" : ""}</span>
      </div>
      {draft.final?.status === "failed" && <p role="alert" className="mt-2 text-xs text-amber-200">拼接未成功：{draft.final.error}</p>}
      {finalUrl && <video className="mt-3 max-h-[28rem] w-full rounded-lg" src={finalUrl} controls
        onLoadedMetadata={event => { const sec = event.currentTarget.duration; if (Number.isFinite(sec) && sec > 0) setFinalSec(sec); }} />}
      {finalUrl && <a className={`${buttonStyle} mt-2 inline-block`} href={finalUrl} download>下载成片</a>}
      {finalUrl && <VideoToolToggles source={finalUrl} open={tool} disabled={busy || !finalSec} onToggle={setTool} className={`${buttonStyle} ml-2 mt-2`} />}
      {tool === "edit" && finalUrl && finalSec > 0 && gradeSourceFromPlayableUrl(finalUrl) && <div className="mt-3">
        <VideoEditPanel key={`edit:${finalUrl.split("?")[0]}`} source={gradeSourceFromPlayableUrl(finalUrl)} durationSec={finalSec} previewUrl={finalUrl} />
      </div>}
      {tool === "grade" && finalUrl && finalSec > 0 && gradeSourceFromPlayableUrl(finalUrl) && <div className="mt-3">
        <VideoGradeEntry key={finalUrl.split("?")[0]} source={gradeSourceFromPlayableUrl(finalUrl)} outputSec={finalSec} scopeKey={marketingGradeScopeKey(draft.draftId)} />
      </div>}
      {credits.uploads.length > 0 && <div className="mt-3 text-xs text-slate-400">
        {credits.uploads.length > 0 && <p>自有素材：{credits.uploads.join("、")}</p>}
      </div>}
    </div>}
    {message && <p role="status" className="mt-3 whitespace-pre-wrap text-sm text-emerald-200">{message}</p>}
  </section>;
}
