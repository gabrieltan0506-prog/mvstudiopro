/**
 * 营销口播配音声线挑选：
 * - 「我的声音」（本人克隆）置顶卡片 + 「克隆一个新声音」（沿用 canvasAudio.createReferenceVoice，同一请求编号续做）；
 *   试听：现有声音列表不返回原声样本地址，因此不显示试听按钮（不伪造）；
 * - 系统声线按用途（直播带货/知识讲解/新闻播报/温暖陪伴/深夜电台/有声书）+ 男/女筛选，卡片显示特质、性别·年龄、场景；
 * - 系统声线不做预生成试听，提供「用本段文案试读」：走现有 generateDialogue，按现有配音计价，点击前确认。
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { uploadOneCanvasAsset } from "@/lib/canvasUpload";
import { inspectDigitalHumanRecording } from "@/lib/digitalHumanRecording";
import { canvasTtsCreditsForDuration } from "@shared/canvasGenerationPricing";
import { estimateNarrationSec, marketingCloneVoiceStorageKey } from "@shared/marketingProduction";
import {
  MARKETING_SYSTEM_VOICES,
  MARKETING_VOICE_PURPOSES,
  MARKETING_VOICE_PURPOSE_LABEL,
  filterMarketingSystemVoices,
  marketingVoiceMeta,
  marketingVoiceTrialText,
  type MarketingVoicePurpose,
} from "@shared/marketingVoiceFilter";

const chip = "rounded-full border px-3 py-1 text-xs";
const btn = "rounded-lg border border-white/20 px-2 py-1 text-xs disabled:opacity-40";
const PAGE = 12;

type PendingClone = { requestId: string; gcsUri: string; labelZh: string };
type Trial = { voiceId: string; billingRequestId: string; text: string; status: "running" | "succeeded" | "failed" | "unknown"; audioUrl?: string; message?: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "操作未完成，请稍后重试";
}

export function MarketingVoicePicker(props: {
  /** 登录用户键：克隆续做编号按用户分键，不让同一浏览器的下一位用户续做上一位的录音。 */
  userKey: string;
  draftId: string;
  voiceId?: string;
  onSelect: (voiceId: string) => void;
  onMessage: (message: string) => void;
  /** 试读用的段落（第几段 + 口播）；没有段落时不提供试读。 */
  trialSegment?: { index: number; narration: string };
  disabled?: boolean;
}) {
  const { voiceId, onSelect, onMessage } = props;
  const cloneKey = marketingCloneVoiceStorageKey(props.userKey);
  const upload = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  const referenceVoices = trpc.canvasAudio.listReferenceVoices.useQuery(undefined, { retry: false });
  const designedVoices = trpc.canvasAudio.listDesignedVoices.useQuery(undefined, { retry: false });
  const cloneVoice = trpc.canvasAudio.createReferenceVoice.useMutation();
  const dialogue = trpc.canvasAudio.generateDialogue.useMutation();
  const utils = trpc.useUtils();

  const [purpose, setPurpose] = useState<MarketingVoicePurpose | "all">("all");
  const [gender, setGender] = useState<"男" | "女" | "all">("all");
  const [shown, setShown] = useState(PAGE);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneLabel, setCloneLabel] = useState("我的声音");
  const [cloneConsent, setCloneConsent] = useState(false);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [pendingClone, setPendingClone] = useState<PendingClone | null>(() => {
    try { const raw = window.localStorage.getItem(cloneKey); return raw ? JSON.parse(raw) : null; } catch { return null; }
  });
  const rememberClone = (value: PendingClone | null) => {
    try { if (value) window.localStorage.setItem(cloneKey, JSON.stringify(value)); else window.localStorage.removeItem(cloneKey); } catch { /* 仅失去本机续做提示 */ }
    setPendingClone(value);
  };

  const myVoices = referenceVoices.data || [];
  const myDesigned = (designedVoices.data || []).filter(v => v.status === "ready" && v.voiceId);
  const systemVoices = useMemo(() => filterMarketingSystemVoices({ purpose, gender }), [purpose, gender]);
  const selectedLabel = useMemo(() => {
    if (!voiceId) return "";
    const mine = myVoices.find(v => v.voiceId === voiceId);
    if (mine) return `我的声音 · ${mine.labelZh}`;
    const designed = myDesigned.find(v => v.voiceId === voiceId);
    if (designed) return `我设计的声线 · ${designed.labelZh}`;
    const sys = MARKETING_SYSTEM_VOICES.find(v => v.id === voiceId);
    return sys ? `${sys.nameZh} · ${sys.traitZh}` : "已选声线";
  }, [voiceId, myVoices, myDesigned]);

  /** 本人录音 → 现有本人声线服务；同一请求编号可查询续做，不重复建立。 */
  async function createMyVoice(file?: File) {
    if (cloneBusy) return;
    setCloneBusy(true);
    try {
      let request = pendingClone;
      if (!request) {
        if (!file) return;
        await inspectDigitalHumanRecording(file);
        const asset = await uploadOneCanvasAsset({ file, index: 0, getSignedUploadUrl: input => upload.mutateAsync(input) });
        if (!asset.gcsUri) throw new Error("录音上传未完成，请重试");
        request = { requestId: crypto.randomUUID(), gcsUri: asset.gcsUri, labelZh: cloneLabel.trim() || "我的声音" };
        rememberClone(request);
      }
      const result = await cloneVoice.mutateAsync({ ...request, consent: true });
      await referenceVoices.refetch();
      if (result.status === "ready" && result.voiceId) {
        onSelect(result.voiceId);
        rememberClone(null);
        setCloneOpen(false);
        onMessage(`已建立并选用「${request.labelZh}」。`);
      } else {
        onMessage(result.message || "声音正在建立，稍后点「查询进度」");
      }
    } catch (error) {
      onMessage(errorText(error));
    } finally {
      setCloneBusy(false);
    }
  }

  const trialText = marketingVoiceTrialText(props.trialSegment?.narration || "");
  const trialCredits = trialText ? canvasTtsCreditsForDuration(estimateNarrationSec(trialText)) : 0;

  async function runTrial(id: string, name: string) {
    if (!trialText || !props.trialSegment) return;
    if (!window.confirm(`用第 ${props.trialSegment.index + 1} 段文案试读「${name}」：\n${trialText}\n\n试读按现有配音计价，按实际时长扣费（预估约 ${trialCredits} 积分）。继续？`)) return;
    const billingRequestId = crypto.randomUUID();
    setTrial({ voiceId: id, billingRequestId, text: trialText, status: "running" });
    try {
      const response = await dialogue.mutateAsync({ billingRequestId, input: trialText, voice: id, speakerZh: "口播讲述者", speakerId: `mk-${props.draftId}-trial`.slice(0, 120), voiceStateZh: "" });
      setTrial(applyTrial({ voiceId: id, billingRequestId, text: trialText, status: "running" }, response));
    } catch (error) {
      setTrial({ voiceId: id, billingRequestId, text: trialText, status: "unknown", message: errorText(error) });
    }
  }

  async function refreshTrial() {
    if (!trial) return;
    try {
      const response = await utils.canvasAudio.getDialogue.fetch({ billingRequestId: trial.billingRequestId });
      setTrial(response ? applyTrial(trial, response) : { ...trial, status: "failed", message: "没有找到这次试读记录" });
    } catch (error) { setTrial({ ...trial, message: errorText(error) }); }
  }

  const trialFor = (id: string) => (trial && trial.voiceId === id ? trial : null);
  const trialBlock = (id: string) => {
    const t = trialFor(id);
    if (!t) return null;
    if (t.status === "succeeded" && t.audioUrl) return <audio className="mt-2 h-8 w-full" src={t.audioUrl} controls autoPlay />;
    return <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
      <span>{t.status === "running" ? "试读生成中…" : t.status === "failed" ? "试读未成功" : "试读结果待核对"}{t.message ? ` · ${t.message}` : ""}</span>
      {t.status !== "failed" && <button type="button" className={btn} onClick={() => void refreshTrial()}>查询试读</button>}
    </div>;
  };

  return <div className="mt-3 rounded-xl border border-white/10 p-3 text-sm" aria-label="配音声线">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="font-semibold">配音声线</span>
      <span className="text-xs text-slate-400">{selectedLabel ? `当前：${selectedLabel}` : "还没有选择声线"}</span>
    </div>

    <p className="mt-3 text-xs font-semibold text-slate-300">我的声音</p>
    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {myVoices.map(v => {
        const ready = v.status === "ready" && Boolean(v.voiceId);
        const selected = ready && v.voiceId === voiceId;
        return <div key={v.requestId} className={`rounded-lg border p-2 ${selected ? "border-emerald-300 bg-emerald-400/10" : "border-white/15 bg-black/20"}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{v.labelZh}</span>
            <span className="text-[11px] text-slate-400">本人克隆</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">{ready ? (v.durationSec ? `录音样本 ${v.durationSec.toFixed(0)} 秒` : "可用") : v.status === "processing" ? "正在建立" : (v.message || "待核对")}</p>
          <button type="button" className={`${btn} mt-2`} disabled={props.disabled || !ready || selected} onClick={() => ready && onSelect(v.voiceId!)}>{selected ? "已选用" : "选用"}</button>
        </div>;
      })}
      <div className="rounded-lg border border-dashed border-white/25 p-2">
        <button type="button" className="text-left font-semibold text-emerald-200" onClick={() => setCloneOpen(o => !o)}>＋ 克隆一个新声音</button>
        <p className="mt-1 text-[11px] text-slate-400">上传 3–30 秒本人清晰录音，建好后自动选用。</p>
        {pendingClone && <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <span>「{pendingClone.labelZh}」正在建立，请勿重复上传。</span>
          <button type="button" className={btn} disabled={cloneBusy} onClick={() => void createMyVoice()}>查询进度</button>
        </div>}
      </div>
    </div>
    {cloneOpen && <div className="mt-2 rounded-lg border border-white/10 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2">声音名称
          <input className="rounded-lg border border-white/20 bg-black/20 px-2 py-1 text-sm" value={cloneLabel} maxLength={80} onChange={e => setCloneLabel(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={cloneConsent} onChange={e => setCloneConsent(e.target.checked)} />
          我拥有这段录音及声音的使用权
        </label>
      </div>
      <p className="mt-1 text-xs text-slate-400">支持 MP3 / WAV / M4A / AAC，最大 20 MB。</p>
      <input aria-label="上传声音参考" type="file" accept=".mp3,.wav,.m4a,.aac" className="mt-2"
        disabled={!cloneConsent || cloneBusy || Boolean(pendingClone)}
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void createMyVoice(file); }} />
    </div>}

    {myDesigned.length > 0 && <>
      <p className="mt-3 text-xs font-semibold text-slate-300">我设计的声线</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {myDesigned.map(v => <button key={v.requestId} type="button" disabled={props.disabled}
          className={`${chip} ${v.voiceId === voiceId ? "border-emerald-300 bg-emerald-400/10" : "border-white/20"}`}
          onClick={() => onSelect(v.voiceId!)}>{v.labelZh}</button>)}
      </div>
    </>}

    <p className="mt-3 text-xs font-semibold text-slate-300">系统声线</p>
    <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="按用途筛选">
      {(["all", ...MARKETING_VOICE_PURPOSES] as const).map(p => <button key={p} type="button" aria-pressed={purpose === p}
        className={`${chip} ${purpose === p ? "border-emerald-300 bg-emerald-400/15" : "border-white/20"}`}
        onClick={() => { setPurpose(p); setShown(PAGE); }}>{p === "all" ? "全部用途" : MARKETING_VOICE_PURPOSE_LABEL[p]}</button>)}
      <span className="mx-1 h-4 w-px bg-white/20" />
      {(["all", "男", "女"] as const).map(g => <button key={g} type="button" aria-pressed={gender === g}
        className={`${chip} ${gender === g ? "border-emerald-300 bg-emerald-400/15" : "border-white/20"}`}
        onClick={() => { setGender(g); setShown(PAGE); }}>{g === "all" ? "男女不限" : g}</button>)}
    </div>
    {!trialText && <p className="mt-2 text-[11px] text-slate-400">转换出段落后可用本段文案试读系统声线。</p>}
    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {systemVoices.slice(0, shown).map(v => {
        const selected = v.id === voiceId;
        return <div key={v.id} className={`rounded-lg border p-2 ${selected ? "border-emerald-300 bg-emerald-400/10" : "border-white/15 bg-black/20"}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{v.nameZh}</span>
            <span className="text-[11px] text-emerald-200">{v.traitZh}</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">{marketingVoiceMeta(v)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={props.disabled || selected} onClick={() => onSelect(v.id)}>{selected ? "已选用" : "选用"}</button>
            {trialText && <button type="button" className={btn} disabled={props.disabled || dialogue.isPending}
              title="试读按现有配音计价扣费"
              onClick={() => void runTrial(v.id, v.nameZh)}>用本段文案试读 · 约 {trialCredits} 积分</button>}
          </div>
          {trialBlock(v.id)}
        </div>;
      })}
    </div>
    {systemVoices.length === 0 && <p className="mt-2 text-xs text-slate-400">没有符合条件的声线，换个用途或性别试试。</p>}
    {systemVoices.length > shown && <button type="button" className={`${btn} mt-2`} onClick={() => setShown(n => n + PAGE)}>
      再显示 {Math.min(PAGE, systemVoices.length - shown)} 个（共 {systemVoices.length} 个）</button>}
  </div>;
}

function applyTrial(previous: Trial, response: { status?: unknown; message?: unknown; result?: { audioUrl?: unknown } | null } | null | undefined): Trial {
  if (!response) return previous;
  const status = String(response.status || "");
  const audioUrl = typeof response.result?.audioUrl === "string" ? response.result.audioUrl : undefined;
  return {
    ...previous,
    status: status === "succeeded" && audioUrl ? "succeeded" : status === "failed" ? "failed" : status === "running" ? "running" : "unknown",
    ...(audioUrl ? { audioUrl } : {}),
    ...(typeof response.message === "string" ? { message: response.message.slice(0, 200) } : {}),
  };
}
