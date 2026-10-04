import type { AdvisorMediaProposal, AdvisorMediaSource } from "@shared/manhuaAdvisorMediaEdit";
import { parseVoiceReviewNotes, resolveVoiceTarget, validateReviewSeek, type VoiceReviewNote } from "@/lib/creativeVoiceReview";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";
import { captureVoiceFrame, pcm16At16k, pcmFloat } from "@/lib/creativeVoiceMedia";
import { CREATIVE_VOICE_PURPOSES, type CreativeVoiceEvent, type CreativeVoiceStart, type CreativeVoiceAction, type CreativeVoiceTarget } from "@shared/creativeVoice";

type CaptureVideo = HTMLVideoElement & { captureStream?: () => MediaStream };
export function CreativeVoicePanel(props: {
  scopeKey: string; context: string; disabled?: boolean; onUse: (text: string) => void;
  onAskAdvisor: (question: string, signal: AbortSignal) => Promise<string | undefined>;
  onReviewFilm?: (blockId: string, question: string, signal: AbortSignal) => Promise<string | undefined>;
  mediaSources?: AdvisorMediaSource[]; onProposeMediaEdit?: (proposal: AdvisorMediaProposal) => string;
  targets?: CreativeVoiceTarget[]; onNavigate?: (target: CreativeVoiceTarget) => string;
}) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false), [active, setActive] = useState(false), [ready, setReady] = useState(false);
  const [purpose, setPurpose] = useState<CreativeVoiceStart["purpose"]>("discussion");
  const [status, setStatus] = useState("尚未连接"), [route, setRoute] = useState(""), [usage, setUsage] = useState(0);
  const [notes, setNotes] = useState(""), [adopt, setAdopt] = useState(""), [question, setQuestion] = useState("");
  const [mic, setMic] = useState(false), [sharing, setSharing] = useState(false), [videoAudio, setVideoAudio] = useState(false);
  const [videos, setVideos] = useState<HTMLVideoElement[]>([]), [selected, setSelected] = useState(0);
  const [file, setFile] = useState<{ url: string; name: string; identity: string } | null>(null);
  const [reviews, setReviews] = useState<VoiceReviewNote[]>([]), [reviewError, setReviewError] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const reviewsRef = useRef<VoiceReviewNote[]>([]), reviewBlocked = useRef(false);
  const voiceAbort = useRef(new AbortController()), inputPending = useRef(false);
  const localVideo = useRef<HTMLVideoElement>(null), ws = useRef<WebSocket | undefined>(undefined);
  const generation = useRef(0), audio = useRef<AudioContext | undefined>(undefined), nodes = useRef<AudioBufferSourceNode[]>([]), nextPlay = useRef(0);
  const recorder = useRef<{ ctx: AudioContext; processor: ScriptProcessorNode; mute: GainNode; input: GainNode } | undefined>(undefined);
  const inputs = useRef<Record<string, { stream: MediaStream; source: MediaStreamAudioSourceNode }>>({});
  const frameTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined), sharedVideo = useRef<HTMLVideoElement | undefined>(undefined);
  const workflowCallback = useRef<(action: CreativeVoiceAction) => string>(() => "尚未就绪");
  const toolCalls = useRef(new Set<string>()), callbacks = useRef(props); callbacks.current = props;
  const notesKey = `creative-voice-notes:${props.scopeKey}`;
  const notesRef = useRef("");
  const append = (text: string) => {
    notesRef.current += text; setNotes(notesRef.current);
    try { window.localStorage.setItem(notesKey, notesRef.current); } catch { setStatus("记录无法自动保存，请立即下载记录"); }
  };
  const send = (message: object) => { if (ws.current?.readyState === WebSocket.OPEN && ws.current.bufferedAmount < 512000) ws.current.send(JSON.stringify(message)); };
  const silence = () => { for (const n of nodes.current) { try { n.stop(); } catch {} } nodes.current = []; nextPlay.current = 0; };
  function stopInput(key: string) {
    const item = inputs.current[key]; if (item) { item.source.disconnect(); item.stream.getTracks().forEach(t => t.stop()); delete inputs.current[key]; }
    if (key === "mic") setMic(false); else setVideoAudio(false);
    if (!Object.keys(inputs.current).length) send({ type: "audioEnd" });
  }
  function stopSharing() {
    clearInterval(frameTimer.current); frameTimer.current = undefined; sharedVideo.current = undefined;
    stopInput("video"); setSharing(false);
  }
  function stop() {
    generation.current++; voiceAbort.current.abort(); stopSharing(); stopInput("mic");
    const current = ws.current; ws.current = undefined; if (current) { current.onmessage = null; current.onclose = null; current.onerror = null; current.close(); }
    silence(); void audio.current?.close(); audio.current = undefined;
    recorder.current?.processor.disconnect(); recorder.current?.input.disconnect(); recorder.current?.mute.disconnect();
    void recorder.current?.ctx.close(); recorder.current = undefined;
    setActive(false); setReady(false);
  }
  useEffect(() => {
    try { notesRef.current = window.localStorage.getItem(notesKey) || ""; setNotes(notesRef.current); } catch { notesRef.current = ""; setNotes(""); }
    try { reviewsRef.current = parseVoiceReviewNotes(window.localStorage.getItem(`${notesKey}:review`)); setReviews(reviewsRef.current); reviewBlocked.current = false; setReviewError(""); }
    catch { reviewsRef.current = []; setReviews([]); reviewBlocked.current = true; setReviewError("旧修改清单无法解析，禁止覆盖；请下载原始备份。"); }
    const onLeave = () => stop(); window.addEventListener("pagehide", onLeave);
    return () => { stop(); window.removeEventListener("pagehide", onLeave); };
    // 切换作品必须结束旧会话，旧会话绝不能把答案写进新作品。
  }, [props.scopeKey]);
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);
  async function start() {
    if (active || props.disabled) return;
    if (!window.confirm("开始语音／看片管理者测试：会调用Google并产生实际成本；普通通道失败会自动改走Gemini API。你明确要求模板推荐或改写时，允许调用当前GLM／DeepSeek顾问，沿用现有扣点确认。开始？")) return;
    stop(); const seq = generation.current;
    voiceAbort.current = new AbortController(); toolCalls.current.clear(); setActive(true); setStatus("正在连接…"); setUsage(0);
    audio.current = new AudioContext(); await audio.current.resume();
    if (seq !== generation.current) return;
    const url = new URL(withLongJobsFlyDirect("/api/creative-voice/socket"), window.location.origin); url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url); ws.current = socket;
    socket.onopen = () => { if (seq !== generation.current) { socket.close(); return; } send({ type: "start", purpose, projectKey: props.scopeKey, confirmedCost: true, context: props.context.slice(0, 12000) }); };
    socket.onmessage = event => {
      if (seq !== generation.current) return;
      try {
        const data = JSON.parse(event.data) as CreativeVoiceEvent;
        if (data.type === "route") { setRoute(`${data.route === "vertex" ? "Vertex" : "Gemini API"} · ${data.model}${data.fallback ? "（备用）" : ""}`); }
        if (data.type === "status") { setStatus(data.text); if (data.ready) setReady(true); }
        if (data.type === "error") { stop(); setStatus(data.text); }
        if (data.type === "usage") setUsage(data.totalTokens);
        if (data.type === "text") append(`${data.role === "user" ? "你" : "语音顾问"}：${data.text}\n`);
        if (data.type === "interrupted") silence();
        if (data.type === "tool") {
          if (toolCalls.current.has(data.id)) return; toolCalls.current.add(data.id);
          append(`调用创作顾问：${data.question}\n`); setStatus("创作顾问正在处理；如需扣点请完成原有确认");
          void callbacks.current.onAskAdvisor(data.question, voiceAbort.current.signal).then(answer => {
            if (seq !== generation.current) return;
            const text = answer || "本次未得到结果：可能需要确认、输入不完整、任务忙或服务失败。请查看原创作顾问提示；不要自动重试。";
            append(`创作顾问结果：${text}\n`); send({ type: "toolResult", id: data.id, text: text.slice(0, 16000) });
          }).catch(() => { if (seq === generation.current) send({ type: "toolResult", id: data.id, text: "调用未完成，请查看原顾问的错误和恢复入口，不要重试或声称已完成。" }); });
        }
        if (data.type === "filmReview") {
          if (toolCalls.current.has(data.id)) return; toolCalls.current.add(data.id);
          const task = callbacks.current.disabled ? Promise.resolve("工作区忙，请等待原任务") : callbacks.current.onReviewFilm?.(data.blockId, data.question, voiceAbort.current.signal) || Promise.resolve("请到漫剧工厂选择影片审阅");
          void task.then(result => { if (seq === generation.current) { const text = result || "本次未完成审阅，不要自动重试"; append(`影片审阅：${text}\n`); send({ type: "toolResult", id: data.id, text: text.slice(0,16000) }); } }).catch(() => { if (seq === generation.current) send({type:"toolResult",id:data.id,text:"影片审阅未完成，请查看原任务，不要重试"}); });
        }
        if (data.type === "mediaEdit") {
          if (toolCalls.current.has(data.id)) return; toolCalls.current.add(data.id);
          let result: string;
          try {
            if (callbacks.current.disabled || !callbacks.current.onProposeMediaEdit) throw new Error("当前工作区不能准备素材修改，请打开漫剧工厂。");
            result = callbacks.current.onProposeMediaEdit(data.proposal);
          } catch (e) { result = e instanceof Error ? e.message : "方案未准备好"; }
          append(`素材修改：${result}\n`); send({ type: "toolResult", id: data.id, text: result.slice(0,16000) });
        }
        if (data.type === "workflow") {
          if (toolCalls.current.has(data.id)) return; toolCalls.current.add(data.id);
          let result: string;
          try { result = workflowCallback.current(data.action); } catch (error) { result = error instanceof Error ? error.message : "操作没有完成"; }
          append(`工作流：${result}\n`); send({ type: "toolResult", id: data.id, text: result.slice(0, 16000) });
        }
        if (data.type === "audio" && audio.current) {
          const ctx = audio.current, samples = pcmFloat(data.data); const rate = Number(/rate=(\d+)/.exec(data.mimeType)?.[1] || 24000);
          if (rate !== 24000 || nextPlay.current - ctx.currentTime > 30) { stop(); setStatus("音讯播放积压，已停止以避免继续消耗"); return; }
          const buffer = ctx.createBuffer(1, samples.length, rate); buffer.copyToChannel(new Float32Array(samples), 0);
          const node = ctx.createBufferSource(); node.buffer = buffer; node.connect(ctx.destination);
          nodes.current.push(node); node.onended = () => { nodes.current = nodes.current.filter(n => n !== node); node.disconnect(); };
          const at = Math.max(ctx.currentTime, nextPlay.current); node.start(at); nextPlay.current = at + buffer.duration;
        }
      } catch { stop(); setStatus("响应格式异常，已停止；记录保留"); }
    };
    socket.onerror = () => { if (seq === generation.current) { stop(); setStatus("连接失败，请检查登录状态、服务部署或余额"); } };
    socket.onclose = () => { if (seq === generation.current) { stop(); setStatus("连接已结束，记录保留；不会自动重连计费"); } };
  }
  async function attachAudio(key: string, stream: MediaStream, seq: number) {
    if (seq !== generation.current || !ws.current) { stream.getTracks().forEach(t => t.stop()); return; }
    if (!recorder.current) {
      const ctx = new AudioContext(); await ctx.resume();
      if (seq !== generation.current) { stream.getTracks().forEach(t => t.stop()); await ctx.close(); return; }
      const input = ctx.createGain(), mute = ctx.createGain(), processor = ctx.createScriptProcessor(4096, 1, 1);
      mute.gain.value = 0; input.connect(processor); processor.connect(mute); mute.connect(ctx.destination);
      let talking = false, quiet = 0;
      processor.onaudioprocess = event => {
        const samples = event.inputBuffer.getChannelData(0);
        const loud = samples.some(n => Math.abs(n) > 0.008);
        if (loud) { quiet = 0; talking = true; }
        else quiet += samples.length / ctx.sampleRate;
        if (talking && quiet < 0.8) send({ type: "audio", data: pcm16At16k(samples, ctx.sampleRate) });
        else if (talking) { talking = false; send({ type: "audioEnd" }); }
      };
      recorder.current = { ctx, processor, input, mute };
    }
    const source = recorder.current.ctx.createMediaStreamSource(stream); source.connect(recorder.current.input);
    inputs.current[key] = { stream, source };
    for (const track of stream.getAudioTracks()) track.onended = () => stopInput(key);
  }
  async function toggleMic() {
    if (mic) { stopInput("mic"); return; }
    if (inputPending.current) return; inputPending.current = true;
    const seq = generation.current;
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }); await attachAudio("mic", stream, seq); if (seq === generation.current) setMic(true); }
    catch { setStatus("无法开启麦克风，请检查权限；仍可打字提问"); } finally { inputPending.current = false; }
  }
  const selectedVideo = () => file ? localVideo.current : videos[selected];
  function shareFrame() {
    const video = sharedVideo.current; if (!video || !video.isConnected) { stopSharing(); return; }
    try { const data = captureVoiceFrame(video); if (data) send({ type: "frame", data, atSec: video.currentTime, source: file?.name.slice(0, 160) || `页面播放器${selected + 1}` }); }
    catch { stopSharing(); setStatus("此播放器不允许读取跨域画面，请选择本机影片；没有传送空白画面"); }
  }
  function toggleSharing() {
    if (sharing) { stopSharing(); return; }
    const video = selectedVideo(); if (!video) { setStatus("请先选择本机影片或页面播放器"); return; }
    sharedVideo.current = video; setSharing(true); shareFrame();
    if (sharedVideo.current) frameTimer.current = setInterval(() => { if (!video.paused && !video.ended) shareFrame(); }, 1100);
  }
  async function shareStill(file: File) {
    if (!ready) return;
    if (file.size > 20 * 1024 * 1024) { setStatus("图片超过20MB，请先缩小后分享。"); return; }
    const seq = generation.current, url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      if (seq !== generation.current) return;
      const scale = Math.min(1, 640 / img.width, 640 / img.height), canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d"); if (!ctx) throw new Error(); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", 0.65).split(",")[1];
      if (!data || data.length > 200000) throw new Error();
      send({ type: "frame", data, atSec: 0, source: file.name.slice(0, 160), still: true });
      append(`已提交静态参考图：${file.name}（不是成片）\n`); setStatus("已提交静态参考图，可讨论构图、灯光和空间安排");
    } catch { setStatus("图片未能读取，没有发送；请选JPEG或PNG图片。"); } finally { URL.revokeObjectURL(url); }
  }
  async function toggleVideoAudio() {
    if (videoAudio) { stopInput("video"); return; }
    const video = selectedVideo() as CaptureVideo | null; const seq = generation.current;
    try {
      if (!video?.captureStream) throw new Error();
      const captured = video.captureStream(); captured.getVideoTracks().forEach(t => t.stop());
      if (!captured.getAudioTracks().length) { captured.getTracks().forEach(t => t.stop()); throw new Error(); }
      await attachAudio("video", captured, seq); if (seq === generation.current) setVideoAudio(true);
    } catch { setStatus("未能取得影片音轨，请先播放影片并检查浏览器支持；顾问目前不能听到影片声音"); }
  }
  const videoSource = () => file?.identity || selectedVideo()?.currentSrc || undefined;
  function persistReviews(next: VoiceReviewNote[]) {
    if (reviewBlocked.current) throw new Error("旧修改清单无法读取，未覆盖。请先下载原始备份。");
    window.localStorage.setItem(`${notesKey}:review`, JSON.stringify(next)); reviewsRef.current = next; setReviews(next);
  }
  function runWorkflow(action: CreativeVoiceAction): string {
    const current = callbacks.current;
    if (action.action === "inspect") return JSON.stringify({ mediaSources: current.mediaSources?.map(({blockId,kind,label})=>({blockId,kind,label})) || [], targets: current.targets || [], context: current.context.slice(0, 10000), notes: reviewsRef.current.slice(-10), playerTime: selectedVideo()?.currentTime, frameShared: !!sharedVideo.current, audioShared: !!inputs.current.video });
    if (current.disabled) throw new Error("当前顾问或工作区正在处理任务，请等待后再操作。");
    const target = action.episode ? resolveVoiceTarget(current.targets || [], action.episode, action.shot) : undefined;
    if (action.action === "navigate") {
      if (!target || !current.onNavigate) throw new Error("当前页面尚无此定位入口。");
      return current.onNavigate(target);
    }
    if (action.action === "seek") {
      const video = selectedVideo(); if (!video) throw new Error("请先选择影片。");
      video.currentTime = validateReviewSeek({ source: videoSource(), atSec: action.atSec }, videoSource(), video.duration);
      video.pause(); return `已定位到${action.atSec}秒并暂停。`;
    }
    const video = selectedVideo(); const atSec = action.atSec ?? (video && Number.isFinite(video.currentTime) ? video.currentTime : undefined);
    if (atSec !== undefined && (!video || !Number.isFinite(video.duration) || atSec > video.duration)) throw new Error("影片时间无法核对，未保存；可不附时间点重新记录。");
    const note: VoiceReviewNote = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), text: action.text!, episode: target?.episode, shot: target?.shot, atSec, source: atSec === undefined ? undefined : videoSource(), done: false };
    persistReviews([...reviewsRef.current, note]); return "已保存至本作品的本机修改清单，可定位和导出；未改正文，未云端备份。";
  }
  function locateReview(note: VoiceReviewNote) {
    try {
      if (note.atSec !== undefined) { const video = selectedVideo(); if (!video) throw new Error("请先选择原影片。"); video.currentTime = validateReviewSeek(note, videoSource(), video.duration); video.pause(); }
      if (note.episode) { const target = resolveVoiceTarget(callbacks.current.targets || [], note.episode, note.shot); if (!callbacks.current.onNavigate) throw new Error("当前页面没有剧集定位入口。"); callbacks.current.onNavigate(target); }
      setStatus("已定位这条修改意见");
    } catch (error) { setStatus(error instanceof Error ? error.message : "定位未完成"); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([notesRef.current, "\n\n修改清单（本机）\n", JSON.stringify(reviewsRef.current, null, 2)], { type: "text/plain;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = "语音看片讨论记录.txt"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  workflowCallback.current = runWorkflow;
  if (!user || !["admin", "supervisor"].includes(user.role)) return null;
  const button = "rounded-lg border border-current/25 px-3 py-2 text-sm disabled:opacity-40";
  return <section className="my-3 rounded-xl border border-cyan-400/25 p-3 text-sm" aria-label="语音与一起看片">
    <button type="button" className={button} onClick={() => { if (expanded) stop(); setExpanded(!expanded); }}>语音讨论／一起看片 · 管理者测试 {expanded ? "收起" : "打开"}</button>
    {expanded && <div className="mt-3 max-h-[60vh] space-y-3 overflow-y-auto">
      <p>按用途自动选通道。语音建议不自动覆盖正文；需要时可调用当前创作顾问，沿用原有计费确认。结束语音会停止传送音画；已提交的顾问任务仍在原入口查询，不会重复提交。</p>
      <select aria-label="语音用途" value={purpose} disabled={active} onChange={e => setPurpose(e.target.value as CreativeVoiceStart["purpose"])} className="w-full rounded bg-slate-900 p-2 text-white">{Object.entries(CREATIVE_VOICE_PURPOSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <details><summary>本次分享的作品上下文（{Math.min(props.context.length, 12000)}字）</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap">{props.context.slice(0, 12000)}</pre>{props.context.length > 12000 && <p>仅分享前12000字，顾问未读全文。</p>}</details>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={active || props.disabled} onClick={() => void start().catch(() => { stop(); setStatus("无法启动音讯，请重试浏览器权限"); })}>开始讨论</button><button type="button" className={button} disabled={!active} onClick={() => { stop(); setStatus("已结束，停止传送音讯与画面"); }}>结束语音</button><button type="button" className={button} disabled={!ready} onClick={() => void toggleMic()}>{mic ? "关闭麦克风" : "开启麦克风"}</button><button type="button" className={button} onClick={silence}>停止播放回复</button></div>
      <p role="status">{status}</p><p className="text-xs opacity-70">{route}{usage > 0 ? ` · 最近用量回执 ${usage} tokens（非累计账单）` : ""}</p>
      <label className="block">分享分镜／资产参考图 <input aria-label="分享分镜参考图" type="file" accept="image/jpeg,image/png,image/webp" disabled={!ready || sharing} onChange={e => { const file = e.target.files?.[0]; if (file) void shareStill(file); e.target.value = ""; }} /></label>
      <fieldset className="space-y-2 rounded-lg border border-current/20 p-2"><legend>影片输入 · 最高每秒1张画面</legend>
        <label>本机影片 <input type="file" accept="video/*" disabled={sharing || videoAudio} onChange={e => { const picked = e.target.files?.[0]; if (picked) setFile({ url: URL.createObjectURL(picked), name: picked.name, identity: `file:${picked.name}:${picked.size}:${picked.lastModified}` }); }} /></label>
        {file && <><video ref={localVideo} src={file.url} controls playsInline className="max-h-64 w-full bg-black" /><button type="button" className={button} disabled={sharing || videoAudio} onClick={() => setFile(null)}>改用页面播放器</button></>}
        {!file && <><button type="button" className={button} disabled={sharing || videoAudio} onClick={() => setVideos(Array.from(document.querySelectorAll("video")).filter(v => v !== localVideo.current))}>读取本页播放器</button><select aria-label="分享的播放器" value={selected} disabled={sharing || videoAudio} className="max-w-full bg-slate-900 p-2 text-white" onChange={e => setSelected(Number(e.target.value))}>{videos.map((v, i) => <option value={i} key={i}>播放器{i + 1} · {Number.isFinite(v.duration) ? Math.round(v.duration) : "?"}秒</option>)}</select></>}
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={!ready} onClick={toggleSharing}>{sharing ? "停止分享画面" : "分享画面"}</button><button type="button" className={button} disabled={!ready || !sharing} onClick={shareFrame}>分享当前暂停画面</button><button type="button" className={button} disabled={!ready} onClick={() => void toggleVideoAudio()}>{videoAudio ? "停止影片声音" : "分享影片声音"}</button></div>
        <p>画面：{sharing ? "分享中，暂停播放后不连续发送" : "未分享"} · 影片声音：{videoAudio ? "分享中" : "未分享"}。快速动作和口型仍需精细审片。</p>
      </fieldset>
      <div className="flex gap-2"><input aria-label="向语音顾问打字提问" value={question} maxLength={4000} onChange={e => setQuestion(e.target.value)} className="min-w-0 flex-1 rounded border bg-transparent p-2" /><button type="button" className={button} disabled={!ready || !question.trim()} onClick={() => { send({ type: "text", text: question }); append(`你：${question}\n`); setQuestion(""); }}>发送</button></div>
      <details open><summary>讨论记录 · 保存在本机</summary><pre className="max-h-52 overflow-auto whitespace-pre-wrap">{notes || "尚无记录"}</pre><button type="button" className={button} disabled={!notes} onClick={download}>下载记录</button></details>
      <section aria-label="看片修改清单" className="space-y-2 rounded border border-current/20 p-2">
        <h3>修改清单 · 本作品本机保存</h3><p>可用语音说“记录这条意见到第2集第3镜”，也可在这里记录。云端备份尚未接入。</p>
        {reviewError && <p role="alert">{reviewError}</p>}
        <textarea aria-label="新增看片意见" value={noteDraft} maxLength={2000} onChange={e => setNoteDraft(e.target.value)} className="w-full rounded border bg-transparent p-2" />
        <button type="button" className={button} disabled={!noteDraft.trim() || props.disabled || !!reviewError} onClick={() => { try { setStatus(runWorkflow({ action: "note", text: noteDraft })); setNoteDraft(""); } catch (error) { setStatus(error instanceof Error ? error.message : "未保存"); } }}>记录意见与播放器时间</button>
        {reviews.map(note => <article key={note.id} className="rounded border border-current/20 p-2">
          <p>{note.episode ? `第${note.episode}集 ` : ""}{note.shot ? `第${note.shot}镜 ` : ""}{note.atSec !== undefined ? `${note.atSec.toFixed(1)}秒` : ""} · {note.done ? "已处理" : "待处理"}</p><p className="whitespace-pre-wrap">{note.text}</p>
          <button type="button" className={button} disabled={props.disabled || (!note.episode && note.atSec === undefined)} onClick={() => locateReview(note)}>定位</button>
          <button type="button" className={button} onClick={() => { try { persistReviews(reviewsRef.current.map(n => n.id === note.id ? { ...n, done: !n.done } : n)); } catch { setStatus("处理状态未保存，请下载记录"); } }}>{note.done ? "标为待处理" : "标为已处理"}</button>
          <button type="button" className={button} disabled={props.disabled} onClick={() => props.onUse(note.text.slice(0, 1200))}>交给创作顾问讨论</button>
        </article>)}
        <button type="button" className={button} onClick={() => { const raw = window.localStorage.getItem(`${notesKey}:review`) || "[]"; const url = URL.createObjectURL(new Blob([raw], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = "语音修改清单原始备份.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>下载清单原始备份</button>
      </section>
      <label className="block">整理后交给创作顾问<textarea aria-label="采用语音讨论内容" value={adopt} maxLength={1200} onChange={e => setAdopt(e.target.value)} className="block w-full rounded border bg-transparent p-2" rows={3} placeholder="把要采用的讨论内容整理在这里，可继续修改。" /></label>
      <button type="button" className={button} disabled={!adopt.trim() || props.disabled} onClick={() => props.onUse(adopt)}>放入创作顾问输入框</button>
    </div>}
  </section>;
}
