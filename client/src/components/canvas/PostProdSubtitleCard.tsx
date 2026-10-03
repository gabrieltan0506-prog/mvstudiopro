import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { ManhuaCreativeAdvisorContext } from "@shared/manhuaCreativeAdvisor";
import { toast } from "sonner";
import { UrlMaskedTextarea } from "@/components/UrlMaskedTextarea";
import { maskMediaProviderDetails } from "@/lib/maskMediaUrls";
import { importWorkflowVideoSource } from "@/lib/videoUpscaleApi";
import { normalizeDialogueSubtitleSrt } from "@shared/dialogueSubtitleSrt";

/** 成片字幕使用创作者确认的对白及时间码，不调用语音识别或改写对白。 */
export function PostProdSubtitleCard({ clips, busy, onSubmit, context, storageKey }: {
  clips: Array<{ id: string; url: string; label: string }>;
  busy: boolean;
  context?: ManhuaCreativeAdvisorContext;
  storageKey: string;
  onSubmit: (params: { videoUri: string; subtitleSrt: string; styleOverride: { fontSize: number; outline: number; marginV: number; fontName: string } }) => Promise<void>;
}) {
  const [source, setSource] = useState("");
  const [srt, setSrt] = useState("");
  const [fontSize, setFontSize] = useState(16);
  const [submitting, setSubmitting] = useState(false);
  const gate = useRef(false);
  const advisor = trpc.mvAnalysis.askPlatformSkillQa.useMutation({ retry: false });
  const quota = trpc.mvAnalysis.getManhuaAdvisorQuota.useQuery(undefined, { enabled: Boolean(context), retry: false });
  const [dialogue, setDialogue] = useState(() => [context?.episodeBody, context?.shotSummary].filter(Boolean).join("\n\n"));
  const [report, setReport] = useState(() => { try { return localStorage.getItem(`${storageKey}:report`) || ""; } catch { return ""; } });
  const [advisorError, setAdvisorError] = useState("");
  const [paid, setPaid] = useState(false);
  const [asking, setAsking] = useState(false);
  const [hasPending, setHasPending] = useState(() => { try { return Boolean(localStorage.getItem(`${storageKey}:pending`)); } catch { return true; } });
  const ask = async (confirmPaid = false) => {
    if (!context || gate.current) return;
    gate.current = true; setAsking(true); setAdvisorError("");
    try {
      const pendingKey = `${storageKey}:pending`;
      const saved = localStorage.getItem(pendingKey);
      let request: Parameters<typeof advisor.mutateAsync>[0];
      if (saved) {
        request = JSON.parse(saved);
        const target = request.manhuaContext?.subtitleReview;
        if (!target || target.videoUri !== source || target.dialogue !== dialogue) throw new Error("有待恢复的咨询，请先点击恢复原咨询素材；不会把旧结果当成本次结果");
      }
      else {
        const videoUri = source.startsWith("https://d2h7xmz5gqybh9.cloudfront.net/") ? await importWorkflowVideoSource(source) : source;
        setSource(videoUri);
        request = { requestId: crypto.randomUUID(), question: "请实际听完本集成片，对照已确认对白核对字幕文字及时间码，标明无法确认之处，并给出SRT草稿。", rawQuestion: "对照对白和成片核对字幕", manhuaContext: { ...context, bgmMix: undefined, previsEdit: undefined, worldTarget: undefined, studio3d: undefined, subtitleReview: { videoUri, dialogue } } };
        localStorage.setItem(pendingKey, JSON.stringify(request));
        setHasPending(true);
      }
      const result = await advisor.mutateAsync({ ...request, ...(confirmPaid ? { confirmPaid: true, confirmedCredits: quota.data?.price } : {}) });
      localStorage.setItem(`${storageKey}:report`, result.answer);
      localStorage.removeItem(pendingKey);
      setHasPending(false);
      setReport(result.answer); setPaid(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "顾问核对失败";
      setAdvisorError(maskMediaProviderDetails(message));
      if (/PAYMENT_REQUIRED|免费.*用完|请确认后重试/.test(message)) setPaid(true);
    } finally { gate.current = false; setAsking(false); }
  };
  const locked = submitting || busy || asking;
  const submit = async () => {
    if (gate.current) return;
    gate.current = true;
    setSubmitting(true);
    try {
      const subtitleSrt = normalizeDialogueSubtitleSrt(srt);
      // 云端成品在服务端导入并登记归属，不经过用户电脑。
      const videoUri = source.startsWith("https://d2h7xmz5gqybh9.cloudfront.net/")
        ? await importWorkflowVideoSource(source) : source;
      setSource(videoUri);
      // 参考影片截图：白字、细黑边、无底框、底部居中；字号按竖屏适配。
      await onSubmit({ videoUri, subtitleSrt, styleOverride: { fontSize, outline: 0.35, marginV: 12, fontName: "Noto Sans CJK SC" } });
    } catch (error) {
      toast.error(maskMediaProviderDetails(error instanceof Error ? error.message : "字幕提交失败"));
    } finally {
      gate.current = false;
      setSubmitting(false);
    }
  };
  return <section id="manhua-post-subtitle" className="rounded-xl border border-white/10 p-3" aria-label="成片字幕">
    <h3 className="text-sm font-medium">成片字幕</h3>
    <p className="mt-1 text-xs text-white/60">使用已确认的对白与 SRT 时间码，不自动识别或改写对白。保留成片尺寸、帧率及音轨，另存带字幕版本。</p>
    <select aria-label="字幕成片" value={source} onChange={event => setSource(event.target.value)} disabled={locked} className="mt-2 w-full rounded border bg-transparent p-2 text-xs">
      <option value="">选择成片，或粘贴云端成片链接</option>
      {source && !clips.some(clip => clip.url === source) ? <option value={source}>已选云端成片</option> : null}
      {clips.map(clip => <option key={clip.id} value={clip.url}>{clip.label}</option>)}
    </select>
    <input aria-label="字幕云端成片链接" type="password" autoComplete="off" value={source} onChange={event => setSource(event.target.value.trim())} disabled={locked} placeholder="云端成片链接（内容隐藏）" className="mt-2 w-full rounded border bg-transparent p-2 text-xs" />
    <UrlMaskedTextarea aria-label="字幕对白原文" value={dialogue} onChange={event => setDialogue(event.target.value)} disabled={locked} rows={5} className="mt-2 w-full rounded border bg-transparent p-2 text-xs" />
    {hasPending && <button type="button" disabled={locked} onClick={() => {
      try {
        const target = JSON.parse(localStorage.getItem(`${storageKey}:pending`) || "null")?.manhuaContext?.subtitleReview;
        if (!target) throw new Error("原咨询素材记录无法读取");
        setSource(target.videoUri); setDialogue(target.dialogue); setAdvisorError("已恢复原咨询素材，再次核对将使用同一请求编号。");
      } catch (error) { setAdvisorError(error instanceof Error ? error.message : "恢复失败"); }
    }} className="mt-2 rounded border p-2 text-xs">恢复原咨询素材</button>}
    <button type="button" disabled={locked || !context || !source || !dialogue.trim() || paid} onClick={() => void ask()} className="mt-2 rounded border px-3 py-2 text-xs disabled:opacity-40">{asking ? "顾问正在核对音画…" : "让创作顾问核对对白与成片"}</button>
    {paid && <button type="button" disabled={locked || !quota.data} onClick={() => void ask(true)} className="mt-2 rounded border px-3 py-2 text-xs">确认本次咨询扣除 {quota.data?.price ?? "待核"} 积分</button>}
    {advisorError && <p role="alert" className="text-xs text-amber-200">{advisorError}（已有请求将沿原编号恢复，不重复创建）</p>}
    {report && <details className="mt-2 text-xs" open><summary>顾问核对报告（历史结果，以报告所选成片与对白为准）</summary><pre className="whitespace-pre-wrap">{maskMediaProviderDetails(report)}</pre></details>}
    <UrlMaskedTextarea aria-label="对白字幕 SRT" value={srt} onChange={event => setSrt(event.target.value)} disabled={submitting || busy} rows={8} placeholder={"1\n00:00:01,000 --> 00:00:03,000\n已确认的对白"} className="mt-2 w-full rounded border bg-transparent p-2 text-xs" />
    <label className="mt-3 flex items-center gap-2 text-xs">字幕字号
      <select aria-label="字幕字号" value={fontSize} disabled={locked} onChange={event => setFontSize(Number(event.target.value))} className="rounded border bg-transparent p-2">
        <option value={8}>小（原字号）</option><option value={12}>标准（放大50%）</option><option value={16}>大（原字号两倍）</option>
      </select>
    </label>
    <div aria-label="字幕字号示意" className="mt-2 rounded-lg bg-neutral-800 p-4 text-center text-white">
      <span style={{ fontSize: fontSize * 2, fontFamily: '"Noto Sans CJK SC", sans-serif', textShadow: "0 1px 2px black" }}>先送娘去治病</span>
      <p className="mt-2 text-[10px] text-white/60">字号示意，非成片截图；实际效果随画幅和播放器显示尺寸变化。</p>
    </div>
    <p className="mt-2 text-xs text-white/60">字幕样式：白字细黑边、无底框、底部居中；长句按对白停顿分条。</p>
    <button type="button" disabled={!source || !srt.trim() || locked} onClick={() => void submit()} className="mt-2 rounded-lg border border-cyan-300/30 px-3 py-2 text-xs disabled:opacity-40">{submitting ? "正在提交字幕…" : "添加字幕 · 0积分"}</button>
  </section>;
}
