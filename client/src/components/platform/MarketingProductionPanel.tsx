/**
 * 营销 / 知识口播「制作稿 → 段落 → 画面 + 配音 → 后期导出」工作区（/platform?mode=create，营销方案下方）。
 * - 画面：共用素材面板（purpose=marketing, usage=insert）或本人上传的产品视频，数据上区分 stock / upload；
 * - 配音：复用 canvasAudio.generateDialogue / getDialogue（不改 TTS 与计费）；
 * - 导出：复用后期工坊 queuePostProd（bgm_mount 逐段贴配音 → concat 取段 + 同步字幕），getPostProdJob 查询；
 * - 恢复：草稿（编号、绑定、任务号）按登录用户存本机；任务与配音以服务端记录为准，刷新后续查不重复扣费。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { uploadOneCanvasAsset } from "@/lib/canvasUpload";
import { StockFootagePanel } from "@/components/stockFootage/StockFootagePanel";
import { canvasTtsCreditsForDuration } from "@shared/canvasGenerationPricing";
import { QWEN_TTS_VOICE_CATALOG, buildQwenTtsVoiceId } from "@shared/qwenTtsVoiceCatalog";
import {
  applyPostProdJobResult,
  auditMarketingExport,
  carryOverSegmentBindings,
  extractMarketingScriptSection,
  findRecoveredPostProdJob,
  marketingConcatInput,
  marketingCreditLines,
  marketingDialogueRequest,
  marketingMountInput,
  marketingMountKey,
  marketingProductionStorageKey,
  marketingStockQuery,
  marketingVisualRef,
  marketingVoiceFromDialogue,
  marketingVoicePending,
  marketingVoiceReady,
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
const VOICES = QWEN_TTS_VOICE_CATALOG.filter(row => row.lang.includes("中文")).map(row => ({
  id: buildQwenTtsVoiceId("plus", row.suffix),
  label: `${row.nameZh} · ${row.gender} · ${row.traitZh}`,
}));
const ACTIVE_JOB = ["queued", "running"];

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

export function MarketingProductionPanel({ userKey, seedMarkdown }: { userKey: string; seedMarkdown?: string }) {
  const [draft, setDraft] = useState<MarketingProductionDraft>(() => loadDraft(userKey));
  const ref = useRef(draft);
  const [message, setMessage] = useState("");
  const [openStock, setOpenStock] = useState<string | null>(null);
  const [finalUrl, setFinalUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const utils = trpc.useUtils();
  const dialogue = trpc.canvasAudio.generateDialogue.useMutation();
  const queue = trpc.mvAnalysis.queuePostProd.useMutation();
  const upload = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();

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
    setMessage("已采用本人上传的产品素材。");
  });

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
      <select aria-label="配音声线" className={buttonStyle} value={draft.voiceId || ""}
        onChange={event => { const voiceId = event.target.value; save(d => ({ ...d, voiceId: voiceId || undefined })); }}>
        <option value="">选择配音声线</option>
        {VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
      </select>
    </div>

    {draft.segments.length > 0 && <ol className="mt-4 space-y-3">
      {draft.segments.map((segment, index) => {
        const voice = segment.voice;
        const voiceStale = Boolean(voice && voice.narration !== segment.narration);
        const mount = draft.mounts[segment.segmentId];
        return <li key={segment.segmentId} className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span className="font-semibold text-slate-200">第 {index + 1} 段 · 预估 {segment.estimatedSec} 秒</span>
            {mount && <span>贴装：{mount.status}{mount.error ? `（${mount.error}）` : ""}</span>}
          </div>
          <textarea aria-label={`第 ${index + 1} 段口播`} value={segment.narration} rows={2} maxLength={4000}
            onChange={event => { const narration = event.target.value; patchSegment(segment.segmentId, s => ({ ...s, narration })); }}
            className="mt-2 w-full rounded-lg border border-white/15 bg-black/20 p-2 text-sm" />
          {segment.visualHint && <p className="mt-1 text-xs text-slate-400">画面提示：{segment.visualHint}</p>}

          <div className="mt-2 text-sm">
            {segment.visual?.source === "stock" && <p>画面：图库素材 · {segment.visual.durationSec.toFixed(1)} 秒 · 署名 {segment.visual.attribution}
              <a className="ml-2 underline" href={segment.visual.evidence.pageUrl} target="_blank" rel="noreferrer">来源</a></p>}
            {segment.visual?.source === "upload" && <p>画面：我上传的产品素材 · {segment.visual.fileName} · {segment.visual.durationSec.toFixed(1)} 秒</p>}
            {!segment.visual && <p className="text-amber-200">还没有画面</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={buttonStyle} disabled={busy} onClick={() => setOpenStock(openStock === segment.segmentId ? null : segment.segmentId)}>
                {openStock === segment.segmentId ? "收起图库" : "从图库选补充画面"}</button>
              <label className={`${buttonStyle} cursor-pointer`}>上传产品视频
                <input type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" disabled={busy}
                  onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void adoptUpload(segment, file); }} /></label>
              {segment.visual && <button type="button" className={buttonStyle} disabled={busy} onClick={() => patchSegment(segment.segmentId, s => ({ ...s, visual: undefined }))}>移除画面</button>}
            </div>
            {openStock === segment.segmentId && <StockFootagePanel compact purpose="marketing" usage="insert" defaultKind="video"
              defaultOrientation={draft.orientation} minDurationSec={Math.max(1, Math.ceil(voice?.durationSec || segment.estimatedSec))}
              initialQuery={marketingStockQuery(segment)} context={{ projectId: draft.draftId, segmentId: segment.segmentId, note: "营销口播段落补充画面" }}
              onAdopted={asset => {
                try {
                  const visual = stockVisualFromAsset(asset);
                  patchSegment(segment.segmentId, s => ({ ...s, visual }));
                  setOpenStock(null); setMessage(`第 ${index + 1} 段已采用图库素材（${visual.attribution}）。`);
                } catch (error) { setMessage(errorText(error)); }
              }} />}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            {voice && <span className="text-xs text-slate-300">配音：{voiceStale ? "口播已修改，需重新配音" : marketingVoiceReady(segment) ? `已完成 ${voice.durationSec?.toFixed(1)} 秒` : voice.status}{voice.message ? ` · ${voice.message}` : ""}</span>}
            <button type="button" className={buttonStyle} disabled={busy || !draft.voiceId || !segment.narration.trim() || (marketingVoicePending(segment) && !voiceStale)}
              onClick={() => void generateVoice(segment)}>{voice && !voiceStale ? "重新生成配音" : "生成本段配音"}</button>
            {voice && (marketingVoicePending(segment) || (voice.status === "succeeded" && !marketingVoiceReady(segment) && !voiceStale)) &&
              <button type="button" className={buttonStyle} disabled={busy} onClick={() => void act("查询配音", () => refreshVoice(segment))}>查询原配音任务</button>}
          </div>
        </li>;
      })}
    </ol>}

    {draft.segments.length > 0 && <div className="mt-4 rounded-xl border border-emerald-300/25 p-3">
      {issues.length > 0 && <ul className="mb-2 list-disc pl-5 text-xs text-amber-200">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`${buttonStyle} bg-emerald-400/15`} disabled={busy || step.kind === "blocked" || step.kind === "wait" || step.kind === "done"}
          onClick={() => void act("导出成片", () => advanceExport(true))}>
          {step.kind === "concat" && draft.final?.status === "failed" ? "重新拼接成片" : "导出成片（逐段贴配音 → 拼接 + 字幕）"}</button>
        <span className="text-xs text-slate-400">{step.kind === "wait" ? step.reason : step.kind === "done" ? "成片已导出" : step.kind === "mount" ? `待贴装 ${step.segmentIds.length} 段` : step.kind === "concat" ? "贴装完成，待拼接" : ""}</span>
      </div>
      {draft.final?.status === "failed" && <p role="alert" className="mt-2 text-xs text-amber-200">拼接未成功：{draft.final.error}</p>}
      {finalUrl && <video className="mt-3 max-h-[28rem] w-full rounded-lg" src={finalUrl} controls />}
      {finalUrl && <a className={`${buttonStyle} mt-2 inline-block`} href={finalUrl} download>下载成片</a>}
      {(credits.stock.length > 0 || credits.uploads.length > 0) && <div className="mt-3 text-xs text-slate-400">
        {credits.stock.length > 0 && <p>图库素材署名：{credits.stock.join("；")}</p>}
        {credits.uploads.length > 0 && <p>自有素材：{credits.uploads.join("、")}</p>}
      </div>}
    </div>}
    {message && <p role="status" className="mt-3 whitespace-pre-wrap text-sm text-emerald-200">{message}</p>}
  </section>;
}
