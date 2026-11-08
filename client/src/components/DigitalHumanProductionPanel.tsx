import { DIGITAL_HUMAN_FILM_MODELS } from "@shared/digitalHumanFilmDirector";
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { currentDigitalHumanAudio, digitalHumanPending, digitalHumanVideoIsCurrent, prepareDigitalHumanVideo, type DigitalHumanDraft, type DigitalHumanMedia as Media, type DigitalHumanVideo } from "@shared/digitalHumanStudio";
import { digitalHumanProductionInputSchema, digitalHumanSplitManifestSchema, type DigitalHumanProductionInput, type DigitalHumanProductionReceipt as Receipt } from "@shared/digitalHumanProduction";
import { DigitalHumanMedia } from "./DigitalHumanStudio";
import { StockFootagePanel } from "@/components/stockFootage/StockFootagePanel";
import { isStockAssetInsertable, stockAttributionText, type StockFootageAssetView } from "@shared/stockFootage";
import { DIGITAL_HUMAN_OVERLAY_MODE_LABEL, DIGITAL_HUMAN_OVERLAY_MAX_COUNT, DIGITAL_HUMAN_PHOTO_OVERLAY_MAX_SEC, DIGITAL_HUMAN_PHOTO_OVERLAY_MIN_SEC, assertDigitalHumanOverlays, digitalHumanOverlayIssues, digitalHumanOverlayRequest, placeDigitalHumanOverlay, type DigitalHumanOverlayDraft } from "@shared/digitalHumanOverlay";

const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const labels = { digital_human_audio_split: "配音分段", digital_human_continuity_frame: "衔接尾帧", digital_human_final: "最终混音成片" };
/** 同一制作稿的分段、尾帧和最终混音，任务意图与回执随云稿保存。 */
export function DigitalHumanProductionPanel(props: {
  draft: DigitalHumanDraft; disabled: boolean;
  save: (update: (current: DigitalHumanDraft) => DigitalHumanDraft) => void;
  beforeSubmit: () => Promise<void>;
  previewVideo: (row: DigitalHumanVideo) => Promise<void>;
  uploadFile: (file: File) => Promise<Media>;
  acquireWork: (label: string) => () => void;
}) {
  const latest = useRef(props); latest.current = props;
  const alive = useRef(true), lock = useRef(false);
  const [segmentPrevis, setSegmentPrevis] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [stockOpen, setStockOpen] = useState(false), [placeAt, setPlaceAt] = useState(0), [overlayUrls, setOverlayUrls] = useState<Record<string, string>>({});
  const api = trpc.useUtils();
  const queue = trpc.digitalHuman.queueProduction.useMutation({ retry: false });
  const audio = currentDigitalHumanAudio(props.draft);
  const plan = [...props.draft.productions].reverse().find(p => p.status === "succeeded" && p.manifest?.audioRequestId === audio?.request.billingRequestId && p.manifest?.script === props.draft.script.trim());
  const segmentVideo = (index: number) => [...props.draft.videos].reverse().find(v => v.status === "succeeded" && v.source && v.segment?.planRequestId === plan?.request.requestId && v.segment?.index === index && digitalHumanVideoIsCurrent(props.draft, v));
  const frameFor = (index: number) => {
    const previous = segmentVideo(index - 1), segment = plan?.manifest?.segments[index - 1];
    return previous && segment ? [...props.draft.productions].reverse().find(p => p.status === "succeeded" && p.source && p.request.input.action === "digital_human_continuity_frame" && p.request.input.params.videoUri === previous.source && p.request.input.params.atSec === segment.endSec - segment.startSec) : undefined;
  };
  function update(id: string, patch: Partial<Receipt>) {
    if (!alive.current) return;
    latest.current.save(d => ({ ...d, productions: d.productions.map(p => p.request.requestId === id ? { ...p, ...patch } : p) }));
  }
  async function work(fn: () => Promise<void>) {
    if (lock.current || latest.current.disabled) return;
    lock.current = true; setBusy(true); setError("");
    let release: (() => void) | undefined;
    try { release = latest.current.acquireWork("数字人分段与后期处理中"); await latest.current.beforeSubmit(); await fn(); await latest.current.beforeSubmit(); }
    catch (e) { if (alive.current) setError(message(e)); }
    finally { release?.(); lock.current = false; if (alive.current) setBusy(false); }
  }
  async function submit(input: DigitalHumanProductionInput) {
    input = digitalHumanProductionInputSchema.parse(input);
    const fingerprint = JSON.stringify(input);
    if (latest.current.draft.productions.some(p => p.fingerprint === fingerprint && p.status !== "failed")) throw new Error("相同输入已有任务，请查询原编号");
    if (!window.confirm(`确认提交${labels[input.action]}？仅处理本页已展示的素材和参数，保留所有原片及原声。`)) return;
    const request = { requestId: crypto.randomUUID(), input };
    latest.current.save(d => ({ ...d, productions: [...d.productions, { request, fingerprint, status: "submitted" }] }));
    await latest.current.beforeSubmit();
    try {
      const receipt = await queue.mutateAsync(request);
      update(request.requestId, { jobId: receipt.jobId, status: "running" });
    } catch (e) { update(request.requestId, { status: "unknown", message: message(e) }); throw e; }
  }
  async function recover() {
    const pending = latest.current.draft.productions.filter(p => digitalHumanPending(p.status));
    const errors: string[] = [];
    for (const row of pending) {
      try {
        const found = await api.digitalHuman.getProduction.fetch({ requestId: row.request.requestId });
        if (!found) { update(row.request.requestId, { status: "unknown", message: "服务端未找到原编号，可使用下方按钮按原编号恢复提交" }); continue; }
        if (found.status === "succeeded") {
          const output = (typeof found.output === "string" ? JSON.parse(found.output) : found.output) as Record<string, unknown>;
          if (!output || typeof output.gcsUri !== "string" || !output.gcsUri.startsWith("gs://")) throw new Error("任务已返回但缺少持久产物，请核对原任务");
          const manifest = row.request.input.action === "digital_human_audio_split" ? digitalHumanSplitManifestSchema.parse(output.manifest) : undefined;
          update(row.request.requestId, { jobId: found.jobId, status: "succeeded", source: output.gcsUri, manifest, message: undefined });
        } else update(row.request.requestId, { jobId: found.jobId, status: ["failed", "cancelled"].includes(found.status) ? "failed" : "running", message: found.error || (found.status === "cancelled" ? "原任务已取消，未自动重建" : undefined) });
      } catch (e) { errors.push(message(e)); }
    }
    if (errors.length) throw new Error(errors.join("；"));
  }
  useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => { if (!lock.current && !latest.current.disabled && latest.current.draft.productions.some(p => digitalHumanPending(p.status))) void work(recover); }, 10_000);
    return () => { alive.current = false; clearInterval(timer); };
  }, []);
  const mix = props.draft.mix;
  // 补充画面覆盖/回切轨：独立于人物分段，只认已批准配音的总时长；保存进同一制作稿 mix.overlays。
  const overlays: DigitalHumanOverlayDraft[] = mix.overlays ?? [];
  const approvedSec = audio?.source && props.draft.approvedAudioRequestId === audio.request.billingRequestId ? audio.durationSec : undefined;
  const overlayFacts = (rows: DigitalHumanOverlayDraft[]) => (id: string) => { const r = rows.find(o => o.assetId === id); return r && { kind: r.kind, durationSec: r.sourceDurationSec }; };
  const overlayIssues = digitalHumanOverlayIssues(overlays, approvedSec ?? 0, overlayFacts(overlays));
  const overlayProjectId = props.draft.project?.id ?? props.draft.id;
  const adoptedViews = trpc.stockFootage.listAdoptions.useQuery({ purpose: "digital_human", projectId: overlayProjectId, limit: 60 }, { enabled: overlays.length > 0, retry: false });
  const overlayUrl = (assetId: string) => overlayUrls[assetId] ?? adoptedViews.data?.find(a => a.assetId === assetId)?.url;
  function saveOverlays(fn: (rows: DigitalHumanOverlayDraft[]) => DigitalHumanOverlayDraft[]) {
    try { latest.current.save(d => ({ ...d, mix: { ...d.mix, overlays: fn(d.mix.overlays ?? []) } })); } catch (e) { setError(message(e)); }
  }
  function adoptOverlay(asset: StockFootageAssetView) {
    try {
      if (asset.purpose !== "digital_human" || !isStockAssetInsertable(asset)) throw new Error("该素材不是为数字人补充画面采用的可入片素材");
      if (!approvedSec) throw new Error("请先试听并批准当前完整配音，再放置补充画面");
      const rows = latest.current.draft.mix.overlays ?? [];
      const placed = placeDigitalHumanOverlay(rows, { kind: asset.kind, durationSec: asset.durationSec }, approvedSec, placeAt);
      const row: DigitalHumanOverlayDraft = { assetId: asset.assetId, ...placed, mode: "overlay", kind: asset.kind, ...(asset.durationSec ? { sourceDurationSec: asset.durationSec } : {}), width: asset.width, height: asset.height, attribution: stockAttributionText(asset.source), pageUrl: asset.source.pageUrl };
      setOverlayUrls(v => ({ ...v, [asset.assetId]: asset.url }));
      saveOverlays(list => [...list, row].sort((a, b) => a.startSec - b.startSec));
      setPlaceAt(Math.round((placed.startSec + placed.durationSec) * 1000) / 1000);
      setError("");
    } catch (e) { setError(message(e)); }
  }
  function changeMix(next: DigitalHumanDraft["mix"]) { try { props.save(d => ({ ...d, mix: next })); } catch (e) { setError(message(e)); } }
  function finalInput(): DigitalHumanProductionInput {
    const current = currentDigitalHumanAudio(latest.current.draft);
    if (!current?.source || !current.durationSec || current.request.billingRequestId !== latest.current.draft.approvedAudioRequestId) throw new Error("请先试听并批准当前完整配音");
    const fullOmni = [...latest.current.draft.videos].reverse().find(v => v.engine === "omnihuman2-wavespeed" && v.status === "succeeded" && v.source && digitalHumanVideoIsCurrent(latest.current.draft, v));
    const clips = fullOmni ? [{ videoUri: fullOmni.source!, startSec: 0, endSec: current.durationSec!, sourceEngine: "omnihuman2-wavespeed" as const }] : plan?.manifest ? plan.manifest.segments.map(s => {
      const video = segmentVideo(s.index);
      if (!video?.source) throw new Error(`第${s.index + 1}段尚无匹配当前输入的原片`);
      return { videoUri: video.source, startSec: s.startSec, endSec: s.endSec };
    }) : (() => {
      const video = [...props.draft.videos].reverse().find(v => !v.segment && v.status === "succeeded" && v.source && digitalHumanVideoIsCurrent(props.draft, v));
      if (!video?.source) throw new Error("尚无匹配当前输入的原片");
      return [{ videoUri: video.source, startSec: 0, endSec: current.durationSec! }];
    })();
    const overlayRows = latest.current.draft.mix.overlays ?? [];
    assertDigitalHumanOverlays(overlayRows, current.durationSec!, overlayFacts(overlayRows));
    const overlayInput = overlayRows.length ? { overlays: [...overlayRows].sort((a, b) => a.startSec - b.startSec).map(digitalHumanOverlayRequest) } : {};
    return digitalHumanProductionInputSchema.parse({ action: "digital_human_final", scopeKey: `digital-human:${props.draft.id}`, params: { audioUri: current.source, audioRequestId: current.request.billingRequestId, clips, voice: mix.voice, tracks: mix.tracks, aspectRatio: props.draft.aspectRatio, ...overlayInput } });
  }
  return <section className="dh-card dh-wide">
    <h3>完整口播 · 分段与混音</h3>
    <p>沿真实配音停顿分段，逐段核对输入与费用。最终拼接使用完整原始配音，替换模型视频的声音。</p>
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={props.disabled || busy}>
      <details><summary>本次完整文案与原声</summary><p style={{ whiteSpace: "pre-wrap" }}>{props.draft.script}</p>{audio?.source && <DigitalHumanMedia kind="audio" source={audio.source} name="完整配音" />}</details>
      <button type="button" disabled={!audio?.source || props.draft.approvedAudioRequestId !== audio.request.billingRequestId} onClick={() => void work(async () => {
        if (!audio?.source) throw new Error("请先生成并批准配音");
        await submit({ action: "digital_human_audio_split", scopeKey: `digital-human:${props.draft.id}`, params: { audioUri: audio.source, audioRequestId: audio.request.billingRequestId, script: props.draft.script.trim(), maxSegmentSec: DIGITAL_HUMAN_FILM_MODELS[props.draft.filmModel||"seedance-2.5"].maxAudioSec } });
      })}>分析停顿并准备音频分段</button>
      {plan?.manifest?.segments.map(s => {
        const video = segmentVideo(s.index), previous = segmentVideo(s.index - 1), frame = frameFor(s.index);
        return <article key={s.index}>
          <h4>第{s.index + 1}段 · {s.startSec.toFixed(2)}–{s.endSec.toFixed(2)}秒</h4>
          <DigitalHumanMedia kind="audio" source={s.audioUri} name={`第${s.index + 1}段原声`} />
          {s.index > 0 && !frame && <button type="button" disabled={!previous?.source} onClick={() => void work(async () => {
            const prior = plan.manifest!.segments[s.index - 1];
            if (!previous?.source) throw new Error("请先生成前段");
            await submit({ action: "digital_human_continuity_frame", params: { videoUri: previous.source, atSec: prior.endSec - prior.startSec }, scopeKey: `digital-human:${props.draft.id}` });
          })}>提取前段衔接尾帧</button>}
          {frame?.source && <DigitalHumanMedia kind="image" source={frame.source} name="前段衔接尾帧" />}
          {props.draft.previs && <label><input type="checkbox" checked={segmentPrevis[s.index] ?? true} onChange={e => setSegmentPrevis(v => ({ ...v, [s.index]: e.target.checked }))} />本段沿用当前已审预演的动作与机位（时长须覆盖本段）；取消后仅使用人物、场景和衔接尾帧。</label>}
          <button type="button" disabled={Boolean(video) || (s.index > 0 && !frame?.source)} onClick={() => void work(async () => {
            const row = prepareDigitalHumanVideo(latest.current.draft, crypto.randomUUID(), { manifest: plan.manifest!, planRequestId: plan.request.requestId, index: s.index, useReviewedPrevis: segmentPrevis[s.index] ?? Boolean(props.draft.previs), continuityFrame: frame?.source ? { source: frame.source, name: "前段衔接尾帧" } : undefined });
            await props.previewVideo(row);
          })}>预览本段视频输入与费用</button>
          {video?.source && <DigitalHumanMedia kind="video" source={video.source} name={`第${s.index + 1}段原片`} />}
        </article>;
      })}
      <h4>人声空间与背景音轨</h4>
      <label>声场<select value={mix.voice.room} onChange={e => changeMix({ ...mix, voice: { ...mix.voice, room: e.target.value as typeof mix.voice.room } })}><option value="dry">干声</option><option value="small">小房间</option><option value="cafe">咖啡店</option></select></label>
      <label>左右声像<input type="range" min={-1} max={1} step={0.05} value={mix.voice.pan} onChange={e => changeMix({ ...mix, voice: { ...mix.voice, pan: Number(e.target.value) } })} />{mix.voice.pan}</label>
      <label>人声音量<input type="number" min={0} max={2} step={0.05} value={mix.voice.volume} onChange={e => changeMix({ ...mix, voice: { ...mix.voice, volume: Number(e.target.value) } })} /></label>
      <label>上传背景音乐或音效<input type="file" accept="audio/*" disabled={mix.tracks.length >= 12} onChange={e => {
        const file = e.target.files?.[0]; e.target.value = "";
        if (file) void work(async () => {
          const media = await props.uploadFile(file);
          latest.current.save(d => ({ ...d, mix: { ...d.mix, tracks: [...d.mix.tracks, { ...media, startSec: 0, sourceStartSec: 0, durationSec: Math.min(5, audio?.durationSec || 5), volume: 0.15, fadeInSec: 0, fadeOutSec: 0, duck: true }] } }));
        });
      }} /></label>
      <p>填写素材的取段与入点；服务器会核对真实长度。没有选取的音乐和音效不会自动添加。</p>
      {mix.tracks.map((track, i) => <article key={`${track.source}:${i}`}>
        <strong>{track.name}</strong><DigitalHumanMedia kind="audio" source={track.source} name={track.name} />
        {([ ["startSec", "片内入点"], ["sourceStartSec", "素材起点"], ["durationSec", "取段时长"], ["volume", "音量"], ["fadeInSec", "淡入秒"], ["fadeOutSec", "淡出秒"] ] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min={0} step={0.1} value={track[key]} onChange={e => changeMix({ ...mix, tracks: mix.tracks.map((t, n) => n === i ? { ...t, [key]: Number(e.target.value) } : t) })} /></label>)}
        <label><input type="checkbox" checked={track.duck} onChange={e => changeMix({ ...mix, tracks: mix.tracks.map((t, n) => n === i ? { ...t, duck: e.target.checked } : t) })} />说话时降低音量</label>
        <button type="button" onClick={() => changeMix({ ...mix, tracks: mix.tracks.filter((_, n) => n !== i) })}>移除此音轨</button>
      </article>)}
      <h4>补充画面覆盖 / 回切</h4>
      <p>在口播时间轴上叠加图库画面：覆盖期间只替换画面，口播声、字幕与混音保持不变；素材自带声音不会进入成片。照片按固定展示时长（{DIGITAL_HUMAN_PHOTO_OVERLAY_MIN_SEC}–{DIGITAL_HUMAN_PHOTO_OVERLAY_MAX_SEC}秒）显示。</p>
      {!approvedSec ? <p>请先批准当前完整配音，再放置补充画面。</p> : <>
        <p>口播总时长 {approvedSec.toFixed(2)} 秒 · 已放置 {overlays.length}/{DIGITAL_HUMAN_OVERLAY_MAX_COUNT} 条</p>
        <label>下一条放置起点（秒）<input type="number" min={0} max={approvedSec} step={0.1} value={placeAt} onChange={e => setPlaceAt(Math.max(0, Number(e.target.value) || 0))} /></label>
        <button type="button" disabled={overlays.length >= DIGITAL_HUMAN_OVERLAY_MAX_COUNT} onClick={() => setStockOpen(v => !v)}>{stockOpen ? "收起素材面板" : "打开素材面板选补充画面"}</button>
        {stockOpen && <StockFootagePanel purpose="digital_human" usage="insert" compact defaultOrientation={props.draft.aspectRatio === "9:16" ? "portrait" : "landscape"}
          initialQuery={props.draft.sceneDescription.trim().slice(0, 100) || undefined}
          context={{ projectId: overlayProjectId, segmentId: props.draft.id, note: "数字人补充画面覆盖/回切" }} onAdopted={adoptOverlay} />}
      </>}
      {overlayIssues.map((issue, i) => <p key={i} role="alert">{issue.message}</p>)}
      {overlays.map((o, i) => { const url = overlayUrl(o.assetId); return <article key={`${o.assetId}:${i}`}>
        <strong>{o.kind === "photo" ? "照片" : "视频"} · {o.startSec.toFixed(2)}–{(o.startSec + o.durationSec).toFixed(2)}秒</strong>
        <p>图库素材{o.sourceDurationSec ? ` · 素材长 ${o.sourceDurationSec.toFixed(1)} 秒` : ""}</p>
        {url && (o.kind === "video" ? <video src={url} muted playsInline controls preload="metadata" style={{ maxWidth: 240 }} /> : <img src={url} alt="补充画面" style={{ maxWidth: 240 }} />)}
        {([ ["startSec", "片内起点"], ["durationSec", o.kind === "photo" ? "展示时长" : "覆盖时长"], ["sourceInSec", "素材入点"] ] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min={0} step={0.1} disabled={key === "sourceInSec" && o.kind === "photo"} value={o[key]} onChange={e => saveOverlays(rows => rows.map((r, n) => n === i ? { ...r, [key]: Math.max(0, Number(e.target.value) || 0) } : r))} /></label>)}
        <label>方式<select value={o.mode} onChange={e => saveOverlays(rows => rows.map((r, n) => n === i ? { ...r, mode: e.target.value as typeof r.mode } : r))}>{(["overlay", "cutaway"] as const).map(m => <option key={m} value={m}>{DIGITAL_HUMAN_OVERLAY_MODE_LABEL[m]}</option>)}</select></label>
        {o.mode === "cutaway" && <label>回切点备注<input type="text" maxLength={200} value={o.returnNote ?? ""} placeholder={`${(o.startSec + o.durationSec).toFixed(2)}秒回到人物`} onChange={e => saveOverlays(rows => rows.map((r, n) => n === i ? { ...r, returnNote: e.target.value } : r))} /></label>}
        <button type="button" onClick={() => saveOverlays(rows => rows.filter((_, n) => n !== i))}>移除此补充画面</button>
      </article>; })}
      <button type="button" onClick={() => void work(async () => { await submit(finalInput()); })}>确认音轨并合成完整视频</button>
      <button type="button" onClick={() => void work(recover)}>查询原后期任务</button>
      {props.draft.productions.map(row => <article key={row.request.requestId}>
        <p>{labels[row.request.input.action]} · {{ submitted: "已保存意图", running: "处理中", unknown: "待核对", succeeded: "已返回产物", failed: "失败" }[row.status]}</p>
        {row.message && <p>{row.message}</p>}
        {row.status === "unknown" && !row.jobId && <button type="button" onClick={() => void work(async () => {
          const found = await api.digitalHuman.getProduction.fetch({ requestId: row.request.requestId });
          if (found) { await recover(); return; }
          const result = await queue.mutateAsync(row.request); update(row.request.requestId, { jobId: result.jobId, status: "running", message: undefined });
        })}>按原编号恢复提交</button>}
        {row.source && row.request.input.action === "digital_human_final" && <DigitalHumanMedia kind="video" source={row.source} name="完整混音成片" />}
      </article>)}
    </fieldset>
  </section>;
}
