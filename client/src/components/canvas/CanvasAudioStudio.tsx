import { UrlMaskedTextarea } from "@/components/UrlMaskedTextarea";
import { maskMediaUrls, maskMediaProviderDetails } from "@/lib/maskMediaUrls";
import { gcsTransferUrl, isGcsTransferUrl } from "@/lib/gcsTransfer";
import type { ComponentProps } from "react";
import { findCanvasDialogueReuse, restoreCanvasDialogueCandidate } from "@/lib/canvasDialogueReuse";
import { findCanvasSegmentAudioSources, restoreCanvasSegmentAudio } from "@/lib/canvasSegmentAudioRestore";
import { createManhuaAudioFromSavedPrompt, savedPromptAudioDiffers, syncUnproducedAudioToSavedPrompt } from "@shared/manhuaAudioSavedPrompt";
import { createManhuaAudioFromShots } from "@shared/manhuaAudioFromShots";
import { manhuaBgmArcFromShots } from "@shared/manhuaBgmArcFromShots";
import { canvasBgmVoicePrompt, type CanvasAudioVoiceControl, type CanvasAudioVoiceControlRegistration, type CanvasAudioVoiceResult } from "@/lib/canvasAudioVoiceControl";
import { planCanvasDialogueTiming, planCanvasDialoguePrecision } from "@shared/canvasDialogueTimingPlan";
import { CANVAS_DIALOGUE_SPEED_MAX, CANVAS_DIALOGUE_SPEED_MIN, CANVAS_DIALOGUE_SPEED_WARN, suggestCanvasDialogueSpeed } from "@shared/canvasDialogueSpeed";
import type { ManhuaWorkbenchShot } from "@shared/manhuaScriptWorkbench";
import { buildSeparateAudioClips, SEPARATE_AUDIO_PREFIX } from "@/lib/canvasSeparateAudioReference";
import { assertCanvasSeparateAudioCapacity, canvasAudioNeedsProcessing, canvasSeparateReferenceKey, usesSeparateCanvasAudio } from "@shared/canvasAudioStudio";
import { canvasAudioMixSource } from "@shared/canvasAudioStudio";
import { canvasBgmRangeIssue, canvasBgmSegmentMusicPrompt, fitCanvasBgmSegment, splitCanvasBgmSegment } from "@shared/canvasBgmSegments";
import { auditCanvasAudioDuration } from "@shared/canvasAudioDurationAudit";
import { CanvasAudioMixControls } from "./CanvasAudioMixControls";
import { applyCanvasAudioMixPlan, assertCanvasAudioMixCapacity } from "@shared/canvasAudioMixPlan";
import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { CanvasBlock } from "@/lib/canvasTypes";
import { canvasAudioCapabilityHint } from "@/lib/canvasAudioCapabilityHint";
import type { ManhuaSegmentReferenceEntry } from "@shared/manhuaSegmentReference";
import { BGM_BRIEF_MODELS, BGM_BRIEF_MODEL_LABEL_ZH, isBgmV6Model, type BgmBriefModel } from "@shared/manhuaBgmBrief";
import { buildPremixTimelineClips, isPremixPendingKey, PREMIX_PENDING_PREFIX } from "@/lib/manhuaPremixMaster";
import { withLongJobsFlyDirect } from "@/lib/longJobsFlyOrigin";
import { cacheLocalAudioMedia, getLocalMediaRecordBySource } from "@/lib/manhuaLocalMediaStore";
import { compileCanvasDialogueInput, resolveCanvasDialogueEmotion, suggestCanvasDialogueEmotion } from "@shared/canvasDialogueControls";
import { canvasAudioPreviewKey, loadCanvasMusicHistory } from "@/lib/canvasAudioStudioRecovery";
import { parseManhuaClipTargetDurationSec } from "@shared/manhuaScriptWorkbench";
import { manhuaClipMaxDurationSecForVideoModel } from "@shared/manhuaSeedanceLayout";
import {
  emptyCanvasAudioStudio,
  canvasAudioStudioSchema,
  createCanvasAudioCue,
  canvasAudioCueInputKey,
  getSelectedAudioTake,
  validateCanvasAudioCue,
  canvasDialogueWindowFit,
  ceilCanvasDialogueSecond,
  canvasAudioCueSchema,
  canvasMusicDraftSchema,
  type CanvasMusicDraft,
  type CanvasAudioStudio as CanvasAudioStudioState,
  type CanvasAudioCue,
  type CanvasAudioTake,
} from "@shared/canvasAudioStudio";
import { buildManhuaSoundPanelSummary, hasAdoptedManhuaAudio } from "@shared/manhuaSoundPanelSummary";
import { collectSpeakerVoiceLocks, speakerVoiceLockKey } from "@shared/canvasSpeakerVoiceLock";
import { resolveClipLocalSegmentIndex } from "@shared/manhuaScriptWorkbench";
import {
  CANVAS_BGM_CREDITS_PER_RUN,
} from "@shared/canvasGenerationPricing";
import {
  buildQwenTtsVoiceId,
  pickQwenTtsVoice,
  QWEN_TTS_VOICE_CATALOG,
} from "@shared/qwenTtsVoiceCatalog";

const VOICES = QWEN_TTS_VOICE_CATALOG.filter(row =>
  row.lang.includes("中文")
).map(row => ({
  id: buildQwenTtsVoiceId("plus", row.suffix),
  label: `${row.gender} · ${row.traitZh} · ${row.sceneZh}`,
}));
const SPEECH_MOODS = [
  ["自然", ""], ["虚弱", "[tired]"], ["安抚", "[empathetic]"],
  ["严肃", "[serious]"], ["悲伤", "[sad]"], ["愤怒", "[angry]"],
  ["惊慌", "[panicked]"], ["低声", "[whispers]"], ["好奇", "[curious]"],
] as const;
export type CanvasVoiceMatchCriteria = { gender?: "男" | "女" | "中性"; ageBand?: "child" | "adult" | "senior"; traitLike?: string };
/** 目录匹配只选择候选音色；最终声线由持久化角色 ID 约束。 */
export function matchCanvasDialogueVoice(criteria: CanvasVoiceMatchCriteria) {
  if (!criteria.gender && !criteria.ageBand && !criteria.traitLike?.trim()) return { reasonZh: "请填写至少一项目录筛选条件；不会按角色姓名借用其他对白音色。" };
  const ages = criteria.ageBand === "child" ? { maxAge: 12 } : criteria.ageBand === "senior" ? { minAge: 55 } : criteria.ageBand === "adult" ? { minAge: 18, maxAge: 54 } : {};
  const entry = pickQwenTtsVoice({ gender: criteria.gender, ...ages, traitLike: criteria.traitLike?.trim(), lang: "中文" });
  if (!entry) return { reasonZh: "目录中没有同时符合这些条件的声线；原音色保持不变。" };
  return { voice: buildQwenTtsVoiceId("plus", entry.suffix), reasonZh: `目录候选：${entry.gender} · ${entry.age ?? "年龄未标"}岁 · ${entry.traitZh}。按所填条件筛选，尚未试听验证。` };
}

const fieldClass =
  "min-w-0 w-full rounded border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-white";
/** 播放复用已鉴权传输，原候选和投料地址保持不变。 */
function CanvasAudioPlayer({ src, previewVolume = 1, localSource, onPlay, onTimeUpdate, playbackRange, ...props }: ComponentProps<"audio"> & { previewVolume?: number; localSource?: string; playbackRange?: { startSec: number; endSec: number } }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [localUrl, setLocalUrl] = useState("");
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, previewVolume));
  }, [previewVolume]);
  useEffect(() => { if (playbackRange) audioRef.current?.pause(); }, [playbackRange?.startSec, playbackRange?.endSec]);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setLocalUrl("");
    if (localSource) void getLocalMediaRecordBySource(localSource).then(record => {
      if (!active || !record?.blob?.size) return;
      objectUrl = URL.createObjectURL(record.blob);
      setLocalUrl(objectUrl);
    }).catch(() => {});
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [localSource]);
  const remoteUrl = src ? gcsTransferUrl(src) : src;
  return <audio {...props} ref={audioRef} src={localUrl || remoteUrl}
    onPlay={event => {
      if (playbackRange && (event.currentTarget.currentTime < playbackRange.startSec || event.currentTarget.currentTime >= playbackRange.endSec)) event.currentTarget.currentTime = playbackRange.startSec;
      onPlay?.(event);
      if (localSource && !localUrl && remoteUrl) {
        void fetch(remoteUrl, { credentials: "include" }).then(async response => {
          if (response.ok) await cacheLocalAudioMedia(localSource, await response.blob());
        }).catch(() => {});
      }
    }}
    onTimeUpdate={event => {
      if (playbackRange && event.currentTarget.currentTime >= playbackRange.endSec) {
        event.currentTarget.pause();
        event.currentTarget.currentTime = playbackRange.endSec;
      }
      onTimeUpdate?.(event);
    }}
    onSeeking={event => {
      if (playbackRange && (event.currentTarget.currentTime < playbackRange.startSec || event.currentTarget.currentTime > playbackRange.endSec)) event.currentTarget.currentTime = playbackRange.startSec;
      props.onSeeking?.(event);
    }}
    crossOrigin={src && isGcsTransferUrl(src) ? "use-credentials" : props.crossOrigin} />;
}

const buttonClass =
  "rounded border border-white/20 px-2 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-40";

function CanvasBgmSegmentEditor({ cue, index, durationSec, locked, sourceUrl, proxyAudio, onRestore, onPatch, onSplit, onTrim, onError }: {
  cue: CanvasAudioCue; index: number; durationSec: number; locked: boolean; sourceUrl: string; proxyAudio?: boolean;
  onRestore: (element: HTMLAudioElement) => void; onPatch: (patch: Partial<CanvasAudioCue>) => void;
  onSplit: (atSec: number) => void; onError: (issue: string) => void;
  onTrim: () => void;
}) {
  const [cursor, setCursor] = useState<number | null>(null);
  const [splitAt, setSplitAt] = useState<number>();
  const issue = canvasBgmRangeIssue(cue);
  const length = cue.sourceEndSec - cue.sourceStartSec;
  const midpoint = Math.round((cue.startSec + Math.min(cue.endSec, cue.startSec + length)) * 500) / 1000;
  const field = (label: string, key: "sourceStartSec" | "sourceEndSec") => <label className="text-xs text-white/70">{label}
    <input aria-label={`${index + 1} ${label}`} type="number" min="0" max={cue.source?.durationSec} step="0.01" className={fieldClass} disabled={locked} value={cue[key]} onChange={e => onPatch({ [key]: Number(e.target.value) })}/>
  </label>;
  return <section aria-label={`${index + 1} 配乐选段与剧情分段`} data-bgm-segment-editor className="space-y-3 rounded-lg border border-cyan-300/20 bg-cyan-500/5 p-3">
    <p className="text-xs text-cyan-100">先试听原曲，标记喜欢的起止秒；原曲生成多长与本段用多少可以不同。例如 25 秒原曲只选 5–20 秒，就是 15 秒配乐。</p>
    <p className="text-xs text-white/70">当前原曲：{cue.source?.labelZh} · {cue.source?.durationSec.toFixed(2)} 秒</p>
    <CanvasAudioPlayer aria-label={`${index + 1} 配乐原曲试听`} controls preload="none" className="h-8 w-full" src={sourceUrl} localSource={proxyAudio ? cue.source?.gcsUri : undefined} previewVolume={cue.volume}
      onTimeUpdate={e => setCursor(Math.round(e.currentTarget.currentTime * 1000) / 1000)} onError={e => onRestore(e.currentTarget)}/>
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span>播放位置：{cursor === null ? "尚未播放" : `${cursor.toFixed(2)} 秒`}</span>
      <button type="button" className={buttonClass} disabled={locked || cursor === null} onClick={() => cursor !== null && onPatch({ sourceStartSec: cursor })}>用播放位置设起点</button>
      <button type="button" className={buttonClass} disabled={locked || cursor === null} onClick={() => cursor !== null && onPatch({ sourceEndSec: cursor })}>用播放位置设终点</button>
    </div>
    <div className="grid grid-cols-2 gap-2">{field("源音频裁切起点", "sourceStartSec")}{field("源音频裁切终点", "sourceEndSec")}</div>
    {issue ? <p role="status" className="text-xs text-amber-200">{issue}</p> : <>
      <p className="text-xs text-white/70">取原曲 {cue.sourceStartSec.toFixed(2)}–{cue.sourceEndSec.toFixed(2)} 秒，共 {length.toFixed(2)} 秒；放在片内 {cue.startSec.toFixed(2)} 秒开始。</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs">试听所选区间</span>
        <CanvasAudioPlayer aria-label={`${index + 1} 配乐选段试听`} controls preload="none" className="h-8 min-w-0 flex-1" src={sourceUrl} localSource={proxyAudio ? cue.source?.gcsUri : undefined} previewVolume={cue.volume} playbackRange={{ startSec: cue.sourceStartSec, endSec: cue.sourceEndSec }} onError={e => onRestore(e.currentTarget)}/>
        <button type="button" className={buttonClass} disabled={locked} onClick={() => { try { onPatch({ endSec: fitCanvasBgmSegment(cue, durationSec) }); } catch (e) { onError(e instanceof Error ? maskMediaProviderDetails(e.message) : "选段放不进当前片内位置。"); } }}>按选段长度设置片内结束</button>
        <button type="button" className={`${buttonClass} border-cyan-300/40 text-cyan-100`} disabled={locked || cue.takes.length >= 100} onClick={onTrim}>裁切此选段 · 免费</button>
      </div>
    </>}
    <div className="flex flex-wrap items-end gap-2 border-t border-white/10 pt-2">
      <label className="text-xs">在剧情第几秒切段<input aria-label={`${index + 1} 配乐剧情切段秒位`} className={fieldClass} type="number" min={cue.startSec} max={cue.endSec} step="0.01" disabled={locked} value={splitAt ?? midpoint} onChange={e => setSplitAt(Number(e.target.value))}/></label>
      <button type="button" className={buttonClass} disabled={locked || Boolean(issue)} onClick={() => onSplit(splitAt ?? midpoint)}>在此处分成两段</button>
    </div>
    <p className="text-xs text-white/60">拆开后可分别选择柔情、悲伤、紧张等不同原曲，也可继续用同一曲的不同区间。每段单独裁切、试听、采用；原曲与旧候选保留。</p>
  </section>;
}

type MusicBrief = {
  model: BgmBriefModel;
  custom_mode: true;
  instrumental: true;
  style: string;
  prompt: string;
  title: string;
  duration: number;
  negative_tags: string;
  style_weight: number;
  weirdness_constraint: number;
};
type JobResult = {
  jobId: string;
  status: string;
  error?: string | null;
  output?: unknown;
  result?: unknown;
  message?: string;
  canResumeSettlement?: boolean;
  billingRequestId?: string;
  input?: string;
  voice?: string;
  speakerZh?: string;
  speakerId?: string;
  voiceStateZh?: string;
  creditsCost?: number;
};
type MusicJob = {
  jobId: string;
  titleZh: string;
  status: string;
  durationSec: number;
  /** 旧任务没有此字段；只提示未交付数量，不触发重新生成。 */
  missingVariants?: number;
  variants: Array<{
    index: number;
    gcsUri: string;
    previewUrl: string;
    bytes?: number;
  }>;
};
type AudioTrimInput = {
  action: "audio_trim";
  params: {
    audioUri: string;
    sourceStartSec: number;
    sourceEndSec: number;
    volume: number;
    fadeInSec: number;
    fadeOutSec: number;
  };
};
type AudioTimelineInput = {
  action: "audio_timeline";
  params: {
    durationSec: number;
    clips: Array<AudioTrimInput["params"] & { startSec: number }>;
  };
};

export type CanvasAudioStudioServices = {
  resolveAudio?: (gcsUri: string) => Promise<string>;
  generateDialogue(input: {
    billingRequestId: string;
    input: string;
    voice: string;
    speakerZh: string;
    speakerId?: string;
    voiceStateZh: string;
  }): Promise<JobResult>;
  getDialogue(input: { jobId: string }): Promise<JobResult | null>;
  /** 0929：对白候选按 0.5–2 倍变速派生新候选（免费、不调 TTS）。 */
  speedDialogueTake?(input: { gcsUri: string; speed: number }): Promise<{ gcsUri: string; durationSec: number; bytes: number; speed: number }>;
  createReferenceVoice?(input: { requestId: string; gcsUri: string; labelZh: string; consent: true }): Promise<{ requestId: string; status: string; labelZh: string; voiceId?: string; message?: string }>;
  listReferenceVoices?(): Promise<Array<{ requestId: string; status: string; labelZh: string; voiceId?: string; message?: string }>>;
  draftMusic(input: {
    model?: BgmBriefModel;
    laneZh: string;
    durationSec: number;
    moods: Array<"蓄力" | "冲突" | "反转" | "收束">;
    moodArcZh: string;
    titleZh: string;
  }): Promise<{ brief: MusicBrief }>;
  generateMusic(input: {
    billingRequestId: string;
    brief: MusicBrief;
  }): Promise<JobResult>;
  getMusic(input: { jobId: string }): Promise<MusicJob>;
  listMusic(): Promise<MusicJob[]>;
  queuePost(input: AudioTrimInput | AudioTimelineInput): Promise<JobResult>;
  getPost(input: { jobId: string }): Promise<JobResult | null>;
  /** 已有原曲只走浏览器直传 GCS，返回长期身份和可播放 URL；不调用配乐生成。 */
  uploadAudioFile?(file: File): Promise<{
    gcsUri: string;
    previewUrl: string;
    durationSec: number;
    fileName: string;
  }>;
};

type Props = {
  block: CanvasBlock;
  /** 漫剧工厂简洁模式只保留声音摘要，详细逐轨编辑由用户展开。 */
  compact?: boolean;
  /** 漫剧工厂当前分段的真实时长；音轨必须覆盖整段，不能按模型上限静默截短。 */
  timelineDurationSec?: number;
  sourceShots?: ManhuaWorkbenchShot[];
  dialogueSources?: readonly CanvasBlock[];
  characters?: readonly { id: string; nameZh: string; aliasZh?: string; referenceAssetIds?: readonly string[] }[];
  disabled?: boolean;
  onChange: (next: CanvasAudioStudioState) => boolean | void;
  onVoiceControl?: CanvasAudioVoiceControlRegistration;
  /**
   * 一键预混母轨出好后回调：对白原音量 + BGM 压 12 dB 带淡入淡出，合成一条 ≤30 s 单轨，
   * 由上层挂到本段 manhuaSegmentRefs.master（出片时作唯一 @音频1）。不传则不显示按钮。
   */
  onMasterTrackReady?: (entry: ManhuaSegmentReferenceEntry) => boolean | void;
  /** 保留后台配乐配置及默认值；前台不展示模型或供应商名称。 */
  bgmModels?: Array<{ model: BgmBriefModel; labelZh: string }>;
  /** 正式适配器经 Fly 播放；离线视图保留测试传入的素材地址。 */
  proxyAudio?: boolean;
};


/** 生产适配器与视图分开；离线测试运行真实视图，不能触发真实付费。 */
export function CanvasAudioStudio(props: Props) {
  const utils = trpc.useUtils();
  const dialogue = trpc.canvasAudio.generateDialogue.useMutation();
  const speedTake = trpc.canvasAudio.speedDialogueTake.useMutation();
  const referenceVoice = trpc.canvasAudio.createReferenceVoice.useMutation();
  const draft = trpc.mvAnalysis.draftManhuaBgmBrief.useMutation();
  const music = trpc.mvAnalysis.queueManhuaBgm.useMutation();
  const post = trpc.mvAnalysis.queuePostProd.useMutation();
  const signedUpload = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  const services: CanvasAudioStudioServices = {
    resolveAudio: async gcsUri => withLongJobsFlyDirect(`/api/manhua-audio-media?gcsUri=${encodeURIComponent(gcsUri)}`),
    generateDialogue: input => dialogue.mutateAsync(input),
    speedDialogueTake: input => speedTake.mutateAsync(input),
    getDialogue: input =>
      utils.canvasAudio.getDialogue.fetch({ billingRequestId: input.jobId }),
    createReferenceVoice: input => referenceVoice.mutateAsync(input),
    listReferenceVoices: () => utils.canvasAudio.listReferenceVoices.fetch(),
    draftMusic: input => draft.mutateAsync(input),
    generateMusic: input => music.mutateAsync(input),
    getMusic: input => utils.mvAnalysis.getManhuaBgmJob.fetch(input),
    listMusic: () => utils.mvAnalysis.listManhuaBgmJobs.fetch({ limit: 30 }),
    queuePost: input => post.mutateAsync(input),
    getPost: input => utils.mvAnalysis.getPostProdJob.fetch(input),
    uploadAudioFile: async file => {
      if (file.size <= 0 || file.size > 50 * 1024 * 1024)
        throw new Error("原曲文件须大于 0 且不超过 50MB。");
      const durationSec = await new Promise<number>((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const audio = document.createElement("audio");
        const done = () => URL.revokeObjectURL(url);
        audio.preload = "metadata";
        audio.onloadedmetadata = () => {
          const value = Number(audio.duration);
          done();
          if (!Number.isFinite(value) || value <= 0 || value > 3600)
            reject(new Error("无法读取原曲时长，请换用 60 分钟以内的 MP3、WAV、M4A 或 AAC。"));
          else resolve(value);
        };
        audio.onerror = () => {
          done();
          reject(new Error("无法读取原曲，请换用 MP3、WAV、M4A 或 AAC。"));
        };
        audio.src = url;
      });
      const { uploadOneCanvasAsset } = await import("@/lib/canvasUpload");
      const asset = await uploadOneCanvasAsset({
        file,
        index: Date.now() % 1000,
        getSignedUploadUrl: input => signedUpload.mutateAsync(input),
      });
      if (asset.kind !== "audio" || !asset.gcsUri)
        throw new Error("只支持导入 MP3、WAV、M4A 或 AAC 原曲。");
      return {
        gcsUri: asset.gcsUri,
        previewUrl: asset.previewUrl || asset.url,
        durationSec,
        fileName: asset.fileName,
      };
    },
  };
  return <CanvasAudioStudioView {...props} proxyAudio services={services} />;
}

export function CanvasAudioStudioView({
  block,
  compact = false,
  timelineDurationSec,
  sourceShots,
  dialogueSources = [],
  characters = [],
  disabled = false,
  onChange,
  onVoiceControl,
  onMasterTrackReady,
  bgmModels,
  proxyAudio = false,
  services,
}: Props & { services: CanvasAudioStudioServices }) {
  const audioPreviewUrl = (gcsUri: string, fallback: string) =>
    proxyAudio && gcsUri.startsWith("gs://")
      ? withLongJobsFlyDirect(`/api/manhua-audio-media?gcsUri=${encodeURIComponent(gcsUri)}`)
      : fallback;
  const downloadAudio = async (gcsUri: string, fallback: string, name: string) => {
    try {
      const local = proxyAudio ? await getLocalMediaRecordBySource(gcsUri) : null;
      const blob = local?.blob || await (async () => {
        const response = await fetch(audioPreviewUrl(gcsUri, fallback), { credentials: "include" });
        if (!response.ok) throw new Error("下载失败");
        return response.blob();
      })();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError("音频原件与暂存均无法读取；请核对原件是否仍在，丢失后需重新生成。");
    }
  };
  const requestedDurationSec = Number(
    parseManhuaClipTargetDurationSec(block.prompt) ??
      timelineDurationSec ??
      block.manhuaAutoSegment?.durationSec ??
      15,
  );
  const durationSec = Number.isFinite(requestedDurationSec) && requestedDurationSec > 0
    ? Math.min(3600, Math.max(1, Math.round(requestedDurationSec * 1000) / 1000))
    : 15;
  const modelMaxDurationSec = manhuaClipMaxDurationSecForVideoModel(block.videoModel);
  const modelDurationIssue = durationSec > modelMaxDurationSec
    ? `当前视频生成方式单次最多 ${modelMaxDurationSec} 秒，本段声音仍按完整 ${durationSec} 秒保留。请调整生成方式或重新分段；系统不会静默截断。`
    : "";
  const suggestedMusicPrompt = useMemo(() => manhuaBgmArcFromShots(sourceShots || [], durationSec), [sourceShots, durationSec]);
  const savedPromptAudio = useMemo(() => {
    if (!block.manhuaPromptEdit) return { studio: undefined, issue: "" };
    try { return { studio: createManhuaAudioFromSavedPrompt(block.prompt, durationSec, characters), issue: "" }; }
    catch (error) { return { studio: undefined, issue: error instanceof Error ? maskMediaProviderDetails(error.message) : "保存全文对白读取失败" }; }
  }, [block.manhuaPromptEdit, block.prompt, durationSec, characters]);
  const { initialAudio, sourceIssue } = useMemo(() => {
    if (block.audioStudio) return { initialAudio: emptyCanvasAudioStudio(), sourceIssue: "" };
    if (savedPromptAudio.issue) return { initialAudio: emptyCanvasAudioStudio(), sourceIssue: savedPromptAudio.issue };
    if (!sourceShots?.length && !savedPromptAudio.studio) return { initialAudio: emptyCanvasAudioStudio(), sourceIssue: "" };
    try { return { initialAudio: { ...(savedPromptAudio.studio ?? createManhuaAudioFromShots(sourceShots || [], durationSec)), musicDraft: {
      prompt: suggestedMusicPrompt, durationSec: Math.max(10, Math.ceil(durationSec)),
      brief: null, model: bgmModels?.[0]?.model ?? "suno-v6" as const,
    } }, sourceIssue: "" }; }
    catch { return { initialAudio: emptyCanvasAudioStudio(), sourceIssue: "本段对白超出音轨容量或字段限制，未截断原文；请先拆分本段或检查原稿。" }; }
  }, [block.audioStudio, sourceShots, durationSec, suggestedMusicPrompt, bgmModels, savedPromptAudio]);
  const state = block.audioStudio ?? initialAudio;
  useEffect(() => {
    if (!disabled && !block.audioStudio && (initialAudio.cues.length || initialAudio.musicDraft) && !sourceIssue) onChange(initialAudio);
  }, [block.id, block.audioStudio, disabled, initialAudio, sourceIssue, onChange]);
  useEffect(() => {
    if (disabled || !block.audioStudio || block.audioStudio.musicDraft || !suggestedMusicPrompt) return;
    onChange({ ...block.audioStudio, musicDraft: {
      prompt: suggestedMusicPrompt, durationSec: Math.max(10, Math.ceil(durationSec)),
      brief: null, model: bgmModels?.[0]?.model ?? "suno-v6",
    } });
  }, [block.audioStudio, bgmModels, disabled, durationSec, onChange, suggestedMusicPrompt]);
  /** 对照图 02 第三格的三块摘要；混合轨不伪装多轨（对照图 04 的 mvs-sound-edit 硬要求） */
  const soundSummary = buildManhuaSoundPanelSummary({
    segmentIndex: resolveClipLocalSegmentIndex(block.id, block.prompt, Number(block.episodeIndex) || 1),
    durationSec,
    cues: state.cues,
    musicJobCount: state.musicJobIds.length,
    hasPremixMaster: Boolean(block.manhuaSegmentRefs?.master?.gcsUri || block.manhuaSegmentRefs?.master?.url),
  });
  const durationAudit = auditCanvasAudioDuration(state.cues, durationSec);
  const dialogueTiming = planCanvasDialoguePrecision(state.cues, durationSec);
  const current = useRef({ state, onChange, services, block, onMasterTrackReady, durationSec, dialogueSources, sourceShots, disabled });
  current.current = { state, onChange, services, block, onMasterTrackReady, durationSec, dialogueSources, sourceShots, disabled };
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(!compact);
  const audioGroups = useRef<Partial<Record<"dialogue" | "bgm" | "sfx", HTMLElement | null>>>({});
  const musicComposerRef = useRef<HTMLDetailsElement | null>(null);
  const dialogueInputs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [jumpToGroup, setJumpToGroup] = useState<"dialogue" | "bgm" | "sfx" | null>(null);
  useEffect(() => {
    if (!editorOpen || !jumpToGroup) return;
    audioGroups.current[jumpToGroup]?.scrollIntoView({ block: "start" });
    setJumpToGroup(null);
  }, [editorOpen, jumpToGroup]);
  const [activeCueId, setActiveCueId] = useState<string | null>(null);
  const [voiceCriteria, setVoiceCriteria] = useState<CanvasVoiceMatchCriteria>({});
  const [voiceTab, setVoiceTab] = useState<"男" | "女" | "自定义音色">("女");
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [voicePage, setVoicePage] = useState(0);
  const activeCue = activeCueId === null ? state.cues[0] : state.cues.find(cue => cue.id === activeCueId);
  const voiceMatch = activeCue?.kind === "dialogue" ? matchCanvasDialogueVoice(voiceCriteria) : undefined;
  const voiceCatalogMatches = useMemo(() => QWEN_TTS_VOICE_CATALOG.filter(entry => {
    if (!entry.lang.includes("中文")) return false;
    if (voiceTab === "自定义音色" || entry.gender !== voiceTab) return false;
    if (voiceCriteria.ageBand === "child" && (entry.age === null || entry.age > 12)) return false;
    if (voiceCriteria.ageBand === "adult" && (entry.age === null || entry.age < 18 || entry.age > 54)) return false;
    if (voiceCriteria.ageBand === "senior" && (entry.age === null || entry.age < 55)) return false;
    const keyword = voiceCriteria.traitLike?.trim();
    return !keyword || `${entry.nameZh} ${entry.traitZh} ${entry.sceneZh}`.includes(keyword);
  }), [voiceCriteria, voiceTab]);
  const voiceSamples = useMemo(() => {
    const samples = new Map<string, { take: CanvasAudioTake; textZh: string }>();
    for (const source of [block, ...dialogueSources]) {
      for (const cue of source.audioStudio?.cues || []) {
        if (cue.kind !== "dialogue" || !cue.voice || !cue.textZh) continue;
        const take = cue.takes.find(candidate => candidate.inputKey === canvasAudioCueInputKey(cue));
        if (take && !samples.has(cue.voice)) samples.set(cue.voice, { take, textZh: cue.textZh });
      }
    }
    return samples;
  }, [block, dialogueSources]);
  const resolveCharacterId = (speakerZh: string): string | undefined => {
    const name = speakerZh.trim();
    const matches = characters.filter(character => character.nameZh.trim() === name || character.aliasZh?.trim() === name);
    if (matches.length === 1) return matches[0]!.id;
    if (characters.length) return undefined;
    const savedIds = new Set([block, ...dialogueSources].flatMap(source => source.audioStudio?.cues || [])
      .filter(cue => cue.kind === "dialogue" && cue.speakerZh.trim() === name)
      .map(cue => cue.speakerId || cue.voiceLock?.speakerId).filter((id): id is string => Boolean(id)));
    return savedIds.size === 1 ? Array.from(savedIds)[0] : undefined;
  };
  const lockKey = (cue: Pick<CanvasAudioCue, "speakerId" | "speakerZh">) =>
    speakerVoiceLockKey({ ...cue, speakerId: cue.speakerId || resolveCharacterId(cue.speakerZh) });
  const speakerVoiceLocks = useMemo(() => collectSpeakerVoiceLocks([block, ...(dialogueSources || []).filter(source => source.id !== block.id)], resolveCharacterId), [block, dialogueSources, characters]);
  const [referenceVoices, setReferenceVoices] = useState<Array<{ requestId: string; status: string; labelZh: string; voiceId?: string; message?: string }>>([]);
  const [referenceConsent, setReferenceConsent] = useState(false);
  useEffect(() => {
    if (!editorOpen || !services.listReferenceVoices) return;
    let alive = true;
    void services.listReferenceVoices().then(rows => { if (alive) setReferenceVoices(rows); }).catch(() => {});
    return () => { alive = false; };
  }, [block.id, editorOpen]);
  useEffect(() => { setActiveCueId(null); setVoiceCriteria({}); setVoicePage(0); setVoicePickerOpen(false); }, [block.id]);
  useEffect(() => { setEditorOpen(!compact); }, [block.id, compact]);
  const [error, setError] = useState("");
  const [restoreSourceId, setRestoreSourceId] = useState("");
  const restoreSources = findCanvasSegmentAudioSources(block, dialogueSources);
  /** 0929：每条原始对白候选的变速选择与在途标记 */
  const [speedDraft, setSpeedDraft] = useState<Record<string, number>>({});
  const [speedBusyTakeId, setSpeedBusyTakeId] = useState<string | null>(null);
  const [musicJobs, setMusicJobs] = useState<MusicJob[]>([]);
  const musicDraft = state.musicDraft || { prompt: "", durationSec: 30, brief: null, model: bgmModels?.[0]?.model ?? "suno-v6" };
  const musicPrompt = musicDraft.prompt;
  const musicDuration = musicDraft.durationSec;
  // 旧草稿只供恢复历史记录，不能从已下架版本直接再次发起付费生成。
  const brief = isBgmV6Model(musicDraft.brief?.model) ? musicDraft.brief : null;
  const bgmModel = isBgmV6Model(musicDraft.model) ? musicDraft.model : "suno-v6";
  const [resumable, setResumable] = useState<Record<string, JobResult>>({});
  const [confirmation, setConfirmation] = useState<
    | { kind: "dialogue"; cueId: string; inputKey: string }
    | { kind: "bgm"; brief: MusicBrief }
    | { kind: "resume"; id: string; response: JobResult }
    | null
  >(null);
  const [loadedSources, setLoadedSources] = useState<Record<string, number>>(
    {}
  );
  const refreshedAudio = useRef(new Set<string>());
  const restoreAudio = async (element: HTMLAudioElement, gcsUri: string) => {
    if (!services.resolveAudio || refreshedAudio.current.has(gcsUri)) return;
    refreshedAudio.current.add(gcsUri);
    try {
      const url = await services.resolveAudio(gcsUri);
      if (mounted.current && element.isConnected && (/^https:\/\//.test(url) || url.startsWith("/api/"))) {
        if (isGcsTransferUrl(url)) element.crossOrigin = "use-credentials";
        else element.removeAttribute("crossorigin");
        element.src = gcsTransferUrl(url);
        element.load();
      }
    } catch {
      if (mounted.current)
        setError("这条音频暂时无法读取。原音频仍保留，请稍后重新打开试听。");
    }
  };
  const update = (
    fn: (previous: CanvasAudioStudioState) => CanvasAudioStudioState
  ) => {
    if (!mounted.current || current.current.block.id !== block.id) {
      setError("当前声音编辑器已失效，修改未保存。请收起并重新打开本段音轨台，原音频仍保留。");
      return false;
    }
    const next = fn(current.current.state);
    if (current.current.onChange(next) === false) {
      setError("当前片段忙碌或声音状态未能保存，已阻止本次新提交。请保留页面，待任务结束或备份并释放浏览器空间后重试。");
      return false;
    }
    current.current.state = next;
    return true;
  };
  const patchMusicDraft = (patch: Partial<CanvasMusicDraft>) => {
    if (!mounted.current || current.current.block.id !== block.id) return false;
    setConfirmation(null);
    const parsed = canvasMusicDraftSchema.safeParse({ ...musicDraft, ...current.current.state.musicDraft, ...patch });
    if (!parsed.success) { setError("配乐草稿超出字段范围，已保留原稿。"); return false; }
    return update(previous => ({ ...previous, musicDraft: parsed.data }));
  };
  const setBrief = (next: MusicBrief | null) => patchMusicDraft({ brief: next });
  /** 0929：原始对白候选按倍速派生新候选；台词与音色不变沿用原 inputKey，仍须试听后确认。 */
  const deriveSpeedTake = async (cueId: string, take: CanvasAudioCue["takes"][number], speed: number) => {
    if (!services.speedDialogueTake || speedBusyTakeId || take.speed) return;
    setError("");
    setSpeedBusyTakeId(take.id);
    try {
      const result = await services.speedDialogueTake({ gcsUri: take.gcsUri, speed });
      const id = `${take.id}-x${result.speed.toFixed(2)}`;
      update(previous => ({
        ...previous,
        cues: previous.cues.map(row => {
          if (row.id !== cueId || row.takes.some(existing => existing.id === id)) return row;
          if (row.takes.length >= 100) { setError("本句候选已满 100 条，请先清理旧候选。"); return row; }
          return { ...row, takes: [...row.takes, {
            id, gcsUri: result.gcsUri, previewUrl: "", durationSec: result.durationSec, bytes: result.bytes,
            createdAt: new Date().toISOString(), inputKey: take.inputKey, speed: result.speed, derivedFromTakeId: take.id,
          }] };
        }),
      }));
    } catch (speedError) {
      setError(speedError instanceof Error ? maskMediaProviderDetails(speedError.message) : "变速未完成，原候选保留。");
    } finally {
      if (mounted.current) setSpeedBusyTakeId(null);
    }
  };
  const patchCue = (id: string, patch: Partial<CanvasAudioCue>) => {
    setConfirmation(null);
    const previousCue = current.current.state.cues.find(cue => cue.id === id);
    if (!previousCue) return false;
    const nextSpeaker = (patch.speakerZh ?? previousCue.speakerZh).trim();
    const nextId = patch.speakerId ?? (nextSpeaker === previousCue.speakerZh.trim() ? previousCue.speakerId : resolveCharacterId(nextSpeaker));
    if (previousCue.voiceLock && (nextSpeaker !== previousCue.voiceLock.speakerZh || (previousCue.voiceLock.speakerId && nextId !== previousCue.voiceLock.speakerId))) {
      setError("此句已锁定角色声线；更改角色须先核对该角色已采用的全部对白。");
      return false;
    }
    const lock = speakerVoiceLocks.get(lockKey({ speakerId: nextId, speakerZh: nextSpeaker })) || speakerVoiceLocks.get(nextSpeaker);
    if (previousCue.kind === "dialogue" && lock && (lock.conflict || (patch.voice !== undefined && patch.voice !== lock.voice))) {
      setError(lock.conflict ? `${nextSpeaker}已有不同的已采用音色，请先核对冲突音轨。` : `${nextSpeaker}的声音已锁定，同集对白须沿用该音色。`);
      return false;
    }
    const volumeOnly = Object.keys(patch).length === 1 && patch.volume !== undefined;
    const selectedTake = getSelectedAudioTake(previousCue);
    const parsed = canvasAudioCueSchema.safeParse({
      ...previousCue,
      ...patch,
      speakerId: nextId,
      approved: volumeOnly && selectedTake?.inputKey === canvasAudioCueInputKey(previousCue) ? previousCue.approved : false,
    });
    if (!parsed.success || (patch.speakerZh?.length ?? 0) > 100) {
      setError(
        "修改超出允许范围，已保留原值。音量须为 0–1，秒数不可为负，文字不可超过字段上限。"
      );
      return false;
    }
    return update(previous => ({
      ...previous,
      cues: previous.cues.map(cue => (cue.id === id ? parsed.data : cue)),
    }));
  };
  const insertDialogueSound = (cue: CanvasAudioCue, tag: "[cough]" | "[gasp]") => {
    const latest = current.current.state.cues.find(row => row.id === cue.id) || cue;
    const input = dialogueInputs.current[cue.id];
    const start = input?.selectionStart ?? latest.textZh.length;
    const end = input?.selectionEnd ?? start;
    const next = latest.textZh.slice(0, start) + tag + latest.textZh.slice(end);
    if (next.length > 4000) return;
    patchCue(cue.id, { textZh: next });
    input?.setSelectionRange(start + tag.length, start + tag.length);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + tag.length, start + tag.length);
    });
  };
  const settle = (id: string, take?: CanvasAudioTake) =>
    update(previous => {
      const pending = previous.pendingOperations.find(row => row.id === id);
      const target = previous.cues.find(cue => cue.id === pending?.cueId);
      if (take && target && target.takes.length >= 100 && !target.takes.some(row => row.id === take.id)) {
        setError("本段候选已达 100 条，原候选和原任务均保留，未丢弃新音频回执。");
        return previous;
      }
      return {
        ...previous,
        pendingOperations: previous.pendingOperations.filter(
          row => row.id !== id
        ),
        cues: previous.cues.map(cue =>
          pending?.cueId === cue.id &&
          take &&
          !cue.takes.some(row => row.id === take.id)
            ? { ...cue, takes: [...cue.takes, take] }
            : cue
        ),
      };
    });
  const takeFromResult = (
    job: JobResult,
    inputKey: string
  ): CanvasAudioTake | undefined => {
    const rawOutput = job.result || job.output;
    const output =
      rawOutput && typeof rawOutput === "object"
        ? (rawOutput as Record<string, unknown>)
        : {};
    const gcsUri = String(output.gcsUri || output.audioGcsUri || "");
    const previewUrl = String(
      output.previewUrl || output.audioUrl || output.url || ""
    );
    const gate =
      output.voiceGate && typeof output.voiceGate === "object"
        ? (output.voiceGate as Record<string, unknown>)
        : {};
    const durationSec = Number(
      output.durationSec || output.durationSeconds || gate.durationSeconds || 0
    );
    if (
      !gcsUri.startsWith("gs://") ||
      !previewUrl.startsWith("https://") ||
      !(durationSec > 0)
    )
      return undefined;
    return {
      id: job.jobId,
      gcsUri,
      previewUrl,
      durationSec,
      ...(Number.isFinite(job.creditsCost) ? { creditsCost: job.creditsCost } : {}),
      inputKey,
      createdAt: new Date().toISOString(),
      requestId: job.jobId,
      bytes: Number(output.bytes) || undefined,
    };
  };
  const refreshMusic = async () => {
    const result = await loadCanvasMusicHistory({
      ids: current.current.state.musicJobIds,
      recent: () => current.current.services.listMusic(),
      get: id => current.current.services.getMusic({ jobId: id }),
    });
    if (!mounted.current || current.current.block.id !== block.id) return result;
    setMusicJobs(previous => Array.from(new Map([...previous, ...result.rows].map(row => [row.jobId, row])).values()));
    if (result.failed) setError("部分配乐暂时无法读取，原任务仍保留，请稍后刷新素材。");
    return result;
  };
  useEffect(() => {
    mounted.current = true;
    setConfirmation(null);
    setError("");
    setMusicJobs([]);
    setResumable({});
    refreshedAudio.current.clear();
    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        for (const pending of [...current.current.state.pendingOperations]) {
          let result: JobResult | null;
          try {
            result =
              pending.kind === "dialogue"
                ? await current.current.services.getDialogue({
                    jobId: pending.id,
                  })
                : pending.kind === "bgm"
                  ? await current.current.services.getMusic({
                      jobId: pending.id,
                    })
                  : await current.current.services.getPost({
                      jobId: pending.id,
                    });
          } catch {
            // 网络错误不等于未提交；保留原任务编号，下轮只查询，不重复购买。
            continue;
          }
          if (stopped) continue;
          if (!result) {
            setError(
              "原任务暂未查到，仍保留确认编号；不要重复生成，请稍后核对。"
            );
            continue;
          }
          if (
            pending.kind === "dialogue" &&
            result.canResumeSettlement === true
          ) {
            setResumable(previous => ({ ...previous, [pending.id]: result! }));
          }
          if (result.status === "reconcile_manual") {
            setError(
              result.message ||
                "这条任务的生成结果待核对，保留原单号，不重复生成。"
            );
          }
          if (result.status === "failed") {
            setError(result.error || "这次音频处理未完成，原素材仍保留。");
            settle(pending.id);
          } else if (
            result.status === "succeeded" ||
            result.status === "completed"
          ) {
            if (pending.kind === "bgm") {
              await refreshMusic();
              if (!stopped) {
                settle(pending.id);
              }
            } else {
              const take = takeFromResult(result, pending.inputKey);
              if (!take) {
                setError(
                  "任务已返回，但音频信息不完整。请保留单号等待核对，不要重复生成。"
                );
                continue;
              }
              if (pending.cueId && pending.inputKey.startsWith(SEPARATE_AUDIO_PREFIX)) {
                const cue = current.current.state.cues.find(row => row.id === pending.cueId);
                if (!cue) { setError("独立音轨原记录已改变，保留任务编号待核对。"); continue; }
                const sourceKey = canvasSeparateReferenceKey(cue, current.current.state.cues);
                const expectedKey = `${SEPARATE_AUDIO_PREFIX}${await canvasAudioPreviewKey(sourceKey)}`;
                if (stopped) continue;
                if (expectedKey !== pending.inputKey) {
                  setError("音轨参数已改变，旧独立音轨保留，不替换当前绑定。");
                  settle(pending.id, take);
                  continue;
                }
                if (!update(previous => ({ ...previous, cues: previous.cues.map(row =>
                  row.id === cue.id && canvasSeparateReferenceKey(row, previous.cues) === sourceKey
                    ? { ...row, separateReference: { take, sourceKey } } : row),
                  pendingOperations: previous.pendingOperations.filter(row => row.id !== pending.id),
                }))) continue;
                continue;
              }
              if (!pending.cueId && isPremixPendingKey(pending.inputKey)) {
                // 预混母轨只能由工厂配音间（带 onMasterTrackReady）收：自由画布同一节点也挂了本面板，
                // 没有回调就保留 pending，回到工厂再挂，不能 settle 掉让 master 永远挂不上
                // 轮询 effect 只依赖 block.id：回调与 master 都必须从 current ref 读最新值，闭包里的是挂载时的旧 props
                const masterReady = current.current.onMasterTrackReady;
                if (!masterReady) continue;
                const sourceSnapshot = canvasAudioMixSource(current.current.state.cues, current.current.durationSec);
                const expectedKey = `${PREMIX_PENDING_PREFIX}${await canvasAudioPreviewKey(sourceSnapshot)}`;
                if (stopped || current.current.block.id !== block.id) continue;
                if (pending.inputKey !== expectedKey || sourceSnapshot !== canvasAudioMixSource(current.current.state.cues, current.current.durationSec)) {
                  update(previous => ({ ...previous, previewTake: take }));
                  setError("旧版预混已生成，但声音配置已改变；保留为旧合听，不替换当前母轨。请先核对声音再预混。");
                  settle(pending.id, take);
                  continue;
                }
                // 出片排队中 audioStudio 不落盘（onUpdateClipAudioStudio 对 running/queued 直接返回），
                // pending 会在下一轮再次命中同一 job：母轨已挂上就不再重复挂、重复弹提示
                const liveMaster = current.current.block.manhuaSegmentRefs?.master?.gcsUri;
                if (liveMaster && liveMaster === take.gcsUri) {
                  settle(pending.id, take);
                  continue;
                }
                const masterSaved = masterReady({
                  url: take.previewUrl,
                  gcsUri: take.gcsUri,
                  fileName: `预混母轨-${block.id}.wav`,
                  audioStudioSource: sourceSnapshot,
                  durationSec: take.durationSec,
                  updatedAt: new Date().toISOString(),
                });
                if (masterSaved === false) {
                  setError("预混母轨暂未保存，已保留原任务编号；请保留页面，待片段空闲或释放浏览器空间后重试。");
                  continue;
                }
              } else if (!pending.cueId) {
                update(previous => ({ ...previous, previewTake: take }));
              }
              settle(pending.id, take);
            }
          }
        }
      } finally {
        polling = false;
      }
    };
    void refreshMusic();
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      stopped = true;
      mounted.current = false;
      clearInterval(timer);
    };
  }, [block.id]);

  const action = async (run: () => Promise<void>, rethrow = false) => {
    if (busyRef.current || current.current.disabled) {
      if (rethrow) throw new Error("当前片段忙碌，配乐操作未执行。请先查询原任务。");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (caught) {
      if (mounted.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "处理暂未完成，请核对任务状态。"
        );
      if (rethrow) throw caught;
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const importReferenceVoice = (file: File) => action(async () => {
    if (!referenceConsent) throw new Error("请先确认你有权使用这段录音建立角色音色。");
    if (!services.uploadAudioFile || !services.createReferenceVoice || !services.listReferenceVoices) throw new Error("参考音色入口暂不可用");
    if (file.size <= 0 || file.size > 20 * 1024 * 1024) throw new Error("参考录音须大于0且不超过20MB");
    const uploaded = await services.uploadAudioFile(file);
    if (uploaded.durationSec < 3 || uploaded.durationSec > 30) throw new Error("参考录音须为3–30秒清晰人声；已上传素材未作为音色使用");
    const result = await services.createReferenceVoice({ requestId: crypto.randomUUID(), gcsUri: uploaded.gcsUri,
      labelZh: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "参考音色", consent: true });
    setReferenceVoices(await services.listReferenceVoices());
    if (result.status !== "ready") setError(result.message || "参考音色建立待核对，未提交任何TTS对白");
  });
  const addCue = (kind: CanvasAudioCue["kind"], patch: Partial<CanvasAudioCue> = {}, rethrow=false) => {
    try {
      if (current.current.state.cues.length >= 100)throw new Error("本段已达100条音轨草稿上限，原片段保留");
      const cue=createCanvasAudioCue(kind,crypto.randomUUID());
      const configured=canvasAudioCueSchema.parse({...cue,...(kind==="bgm"?{startSec:0,endSec:durationSec,sourceEndSec:durationSec}:{}),voice:VOICES[0]?.id||"",...patch});
      if(configured.endSec<=configured.startSec || configured.endSec>durationSec)throw new Error("音轨秒窗超出本段，未添加");
      if(configured.mix?.silenceWindows.some(w=>w.endSec<=w.startSec || w.startSec<configured.startSec || w.endSec>configured.endSec))throw new Error("留白须位于本条音轨秒窗内");
      if(patch.voice!==undefined && !VOICES.some(v=>v.id===configured.voice) && !referenceVoices.some(v=>v.voiceId===configured.voice))throw new Error("音色不在当前真实清单，未添加");
      if(!update(previous=>({...previous,cues:[...previous.cues,configured]})))throw new Error("音轨草稿未保存");
      setActiveCueId(configured.id);setVoiceCriteria({});setConfirmation(null);
      return configured.id;
    } catch(caught) {
      setError(caught instanceof Error?caught.message:"音轨草稿未保存");
      if(rethrow)throw caught;
    }
  };

  const splitBgm = (id: string, atSec: number) => {
    if (disabled || busyRef.current) return;
    const previous = current.current.state;
    if (previous.cues.length >= 100) { setError("音轨草稿已达100条，原段保留，未拆分。"); return; }
    if (previous.pendingOperations.some(row => row.cueId === id)) { setError("本段裁切任务仍在处理中，请先等待原任务结果。"); return; }
    const cue = previous.cues.find(row => row.id === id);
    if (!cue) return;
    try {
      const parts = splitCanvasBgmSegment(cue, atSec, crypto.randomUUID());
      if (update(state => ({ ...state, cues: state.cues.flatMap(row => row.id === id ? parts : [row]) }))) {
        setConfirmation(null);
        setActiveCueId(parts[1].id);
        setError("");
      }
    } catch (e) { setError(e instanceof Error ? maskMediaProviderDetails(e.message) : "切段失败，原配乐保留。"); }
  };
  const importExistingMusic = (file: File) =>
    action(async () => {
      if (!services.uploadAudioFile)
        throw new Error("当前入口暂不支持导入原曲，请重新打开正式漫剧工厂后再试。");
      if (current.current.state.cues.length >= 100)
        throw new Error("本段已达 100 条音轨草稿上限，原片段全部保留，未上传新原曲。");
      const uploaded = await services.uploadAudioFile(file);
      const cue = createCanvasAudioCue("bgm", crypto.randomUUID());
      const clipEnd = Math.min(durationSec, uploaded.durationSec);
      const configured = canvasAudioCueSchema.parse({
        ...cue,
        labelZh: uploaded.fileName.replace(/\.[^.]+$/, "") || "导入原曲",
        shotZh: "本段背景音乐",
        startSec: 0,
        endSec: durationSec,
        source: {
          gcsUri: uploaded.gcsUri,
          previewUrl: uploaded.previewUrl,
          durationSec: uploaded.durationSec,
          labelZh: `导入原曲 · ${uploaded.fileName}`,
        },
        sourceStartSec: 0,
        sourceEndSec: clipEnd,
        volume: 0.25,
        fadeInSec: Math.min(0.5, clipEnd / 2),
        fadeOutSec: Math.min(0.5, clipEnd / 2),
        mix: { duckUnderDialogue: true, duckVolume: 0.25, silenceWindows: [] },
      });
      update(previous => ({ ...previous, cues: [...previous.cues, configured] }));
      setActiveCueId(configured.id);
      setConfirmation(null);
    });
  const prepareDialogue = (cue: CanvasAudioCue) => {
    const suggestedEmotion = resolveCanvasDialogueEmotion({ ...cue, hasCandidates: cue.takes.length > 0 });
    let roleId = cue.speakerId || resolveCharacterId(cue.speakerZh);
    if (!roleId && characters.length) {
      setError(`角色「${cue.speakerZh || "未填"}」未绑定人物资产 ID，请先在本句选择对应角色。`);
      return false;
    }
    if (!roleId) {
      roleId = [block, ...dialogueSources].flatMap(source => source.audioStudio?.cues || [])
        .find(other => other.kind === "dialogue" && other.speakerZh.trim() === cue.speakerZh.trim() && other.speakerId)?.speakerId || crypto.randomUUID();
    }
    const lock = speakerVoiceLocks.get(lockKey({ ...cue, speakerId: roleId })) || speakerVoiceLocks.get(cue.speakerZh.trim());
    if (lock?.conflict || (lock && cue.voice !== lock.voice)) {
      setError(lock?.conflict ? `${cue.speakerZh}已有冲突的角色音色，先核对已采用音轨。` : `${cue.speakerZh}已锁定其他音色；先应用锁定音色再生成。`);
      return false;
    }
    try {
      checkWindow(cue);
      if (
        cue.takes.length >= 100 ||
        current.current.state.pendingOperations.length >= 100
      )
        throw new Error(
          "候选或待处理任务已达 100 条上限，本次不提交。"
        );
      compileCanvasDialogueInput(cue.textZh, cue.emotion);
      if (
        !cue.speakerZh.trim() ||
        !cue.textZh.trim() ||
        !cue.voice
      )
        throw new Error("先填写说话角色、台词并选择音色。");
      if (cue.speakerId !== roleId || cue.emotion !== suggestedEmotion) {
        if (!update(previous => ({ ...previous, cues: previous.cues.map(row => row.id === cue.id ? { ...row, speakerId: roleId, emotion: suggestedEmotion } : row) }))) return false;
        cue = { ...cue, speakerId: roleId, emotion: suggestedEmotion };
      }
      setError("");
      setConfirmation({
        kind: "dialogue",
        cueId: cue.id,
        inputKey: canvasAudioCueInputKey(cue),
      });
      return true;
    } catch (caught) {
      setError((caught as Error).message);
      return false;
    }
  };
  const sourceFor = (cue: CanvasAudioCue) => cue.source;
  const checkWindow = (cue: CanvasAudioCue) => {
    if (
      !(
        cue.startSec >= 0 &&
        cue.endSec > cue.startSec &&
        cue.endSec <= durationSec
      )
    )
      throw new Error(
        `先填写有效的片内开始秒和结束秒，不能超出本段 ${durationSec} 秒。`
      );
    if (!cue.shotZh.trim()) throw new Error("先填写这一段对应的镜头或动作。");
  };
  const confirmPaid = () =>
    action(async () => {
      const saved = confirmation;
      if (!saved) return;
      setConfirmation(null);
      if (saved.kind === "resume") {
        const original = saved.response;
        const pending = current.current.state.pendingOperations.find(
          row => row.id === saved.id
        );
        if (
          !pending ||
          !original.canResumeSettlement ||
          !original.billingRequestId ||
          !original.input ||
          !original.voice ||
          !original.speakerZh
        )
          throw new Error("原配音回执信息不足，请保留原单等待核对。");
        if (!update(previous => previous)) return;
        const result = await services.generateDialogue({
          billingRequestId: original.billingRequestId,
          input: original.input,
          voice: original.voice,
          speakerZh: original.speakerZh,
          speakerId: original.speakerId,
          voiceStateZh: original.voiceStateZh || "",
        });
        const take =
          result.status === "succeeded"
            ? takeFromResult(result, pending.inputKey)
            : undefined;
        if (take) {
          settle(saved.id, take);
          setResumable(previous => {
            const next = { ...previous };
            delete next[saved.id];
            return next;
          });
        }
        return;
      }
      if (current.current.state.pendingOperations.length >= 100)
        throw new Error("待处理任务已达 100 条，先处理原任务，不再建立新单。");
      if (saved.kind === "dialogue") {
        const cue = current.current.state.cues.find(
          row => row.id === saved.cueId
        );
        if (!cue || canvasAudioCueInputKey(cue) !== saved.inputKey)
          throw new Error("对白已修改，请重新确认本句费用。");
        if (cue.takes.length >= 100)
          throw new Error(
            "本句已达 100 条候选上限，旧音频全部保留，本次未提交。"
          );
        const requestId = crypto.randomUUID();
        const jobId = requestId;
        if (!update(previous => ({
          ...previous,
          pendingOperations: [
            ...previous.pendingOperations,
            {
              id: jobId,
              kind: "dialogue",
              cueId: cue.id,
              inputKey: saved.inputKey,
            },
          ],
        }))) return;
        const result = await services
          .generateDialogue({
            billingRequestId: requestId,
            input: compileCanvasDialogueInput(cue.textZh, cue.emotion),
            voice: cue.voice,
            speakerZh: cue.speakerZh,
            speakerId: cue.speakerId,
            voiceStateZh: cue.voiceStateZh,
          })
          .catch(caught => {
            const code = (caught as { data?: { code?: string } })?.data?.code;
            // 明确在任务创建前拒绝才能解除本句等待；断网/超时绝不当作未生成。
            if (code === "PAYMENT_REQUIRED" || code === "BAD_REQUEST")
              settle(jobId);
            throw caught;
          });
        const take =
          result.status === "succeeded"
            ? takeFromResult(result, saved.inputKey)
            : undefined;
        if (take && mounted.current) settle(jobId, take);
      } else {
        if (current.current.state.musicJobIds.length >= 100)
          throw new Error(
            "配乐任务记录已达 100 条，旧任务全部保留，本次未提交。"
          );
        const requestId = crypto.randomUUID();
        const jobId = `bgm_${requestId.replace(/-/g, "")}`;
        if (!update(previous => ({
          ...previous,
          musicJobIds: [...previous.musicJobIds, jobId],
          pendingOperations: [
            ...previous.pendingOperations,
            { id: jobId, kind: "bgm", inputKey: JSON.stringify(saved.brief) },
          ],
        }))) return;
        await services.generateMusic({
          billingRequestId: requestId,
          brief: saved.brief,
        });
      }
    });
  const trim = (cue: CanvasAudioCue, rethrow = false) =>
    action(async () => {
      if (
        cue.takes.length >= 100 ||
        current.current.state.pendingOperations.length >= 100
      )
        throw new Error(
          "候选或待处理任务已达 100 条上限，原素材保留，本次未提交。"
        );
      checkWindow(cue);
      const source = sourceFor(cue);
      if (!source) throw new Error("先选择这一段使用的来源音频。");
      if (
        !(
          cue.sourceStartSec >= 0 &&
          cue.sourceEndSec > cue.sourceStartSec &&
          cue.sourceEndSec <= source.durationSec + 0.02
        )
      )
        throw new Error("裁切区间必须在来源音频真实时长内。");
      const inputKey = canvasAudioCueInputKey(cue);
      if (!update(previous => previous)) return;
      const result = await services.queuePost({
        action: "audio_trim",
        params: {
          audioUri: source.gcsUri,
          sourceStartSec: cue.sourceStartSec,
          sourceEndSec: cue.sourceEndSec,
          volume: 1,
          fadeInSec: 0,
          fadeOutSec: 0,
        },
      });
      update(previous => ({
        ...previous,
        pendingOperations: [
          ...previous.pendingOperations,
          { id: result.jobId, kind: "post_prod", cueId: cue.id, inputKey },
        ],
      }));
    }, rethrow);
  const selectedSource = canvasAudioMixSource(state.cues, durationSec);
  const [selectedKey, setSelectedKey] = useState("");
  useEffect(() => {
    let stopped = false;
    setSelectedKey("");
    void canvasAudioPreviewKey(selectedSource).then(key => { if (!stopped) setSelectedKey(key); })
      .catch(() => { if (!stopped) setError("音轨签名暂时不可用，未提交合听，请稍后重试。"); });
    return () => { stopped = true; };
  }, [selectedSource]);
  const createPreview = (rethrow = false) =>
    action(async () => {
      if (current.current.state.pendingOperations.length >= 100)
        throw new Error("待处理任务已达 100 条，请先处理原任务。");
      const cues = current.current.state.cues.filter(
        cue => cue.approved && cue.enabled !== false
      );
      if (!cues.length) throw new Error("先试听并确认至少一段音频。");
      const clips = cues.flatMap(cue => {
        checkWindow(cue);
        const take = getSelectedAudioTake(cue);
        if (!take || take.inputKey !== canvasAudioCueInputKey(cue))
          throw new Error("音频内容已修改，请重新试听确认。");
        if (take.durationSec > cue.endSec - cue.startSec + 0.02)
          throw new Error("对白或音乐长于秒窗，请调整结束秒；不会截断对白。");
        return applyCanvasAudioMixPlan(cue, {
          audioUri: take.gcsUri,
          sourceStartSec: 0,
          sourceEndSec: take.durationSec,
          startSec: cue.startSec,
          volume: cue.volume,
          fadeInSec: cue.fadeInSec,
          fadeOutSec: cue.fadeOutSec,
        }, cues);
      });
      assertCanvasAudioMixCapacity(clips);
      const previewKey = await canvasAudioPreviewKey(selectedSource);
      canvasAudioStudioSchema.parse({ ...current.current.state, pendingOperations: [
        ...current.current.state.pendingOperations, { id: "preflight-preview", kind: "post_prod", inputKey: previewKey },
      ] });
      if (!update(previous => previous)) return;
      const result = await services.queuePost({
        action: "audio_timeline",
        params: {
          durationSec,
          clips,
        },
      });
      update(previous => ({
        ...previous,
        pendingOperations: [
          ...previous.pendingOperations,
          { id: result.jobId, kind: "post_prod", inputKey: previewKey },
        ],
      }));
    }, rethrow);
  const prepareSeparateReferences = (referenceMode: "separate" | "dialogue" = "separate") => action(async () => {
    const snapshot = current.current.state;
    const cues = snapshot.cues.filter(cue => cue.enabled && (referenceMode !== "dialogue" || cue.kind !== "bgm"));
    for (const cue of cues) {
      const issues = validateCanvasAudioCue(cue, durationSec);
      if (!cue.approved || issues.length) throw new Error(issues.join("；") || "音轨尚未采用");
    }
    if (!cues.length) throw new Error("本段没有启用的对白或音效");
    assertCanvasSeparateAudioCapacity(cues);
    // 全部预检后才建免费处理任务，部分成功或网络错误只沿原任务编号恢复。
    const plans = cues.filter(canvasAudioNeedsProcessing).map(cue => ({
      cue, sourceKey: canvasSeparateReferenceKey(cue, snapshot.cues),
      params: buildSeparateAudioClips(cue, snapshot.cues, durationSec),
    })).filter(plan => plan.cue.separateReference?.sourceKey !== plan.sourceKey);
    if (snapshot.pendingOperations.length + plans.length > 100) throw new Error("待处理任务已达上限");
    if (!update(previous => ({ ...previous, referenceMode }))) return;
    for (const plan of plans) {
      const inputKey = `${SEPARATE_AUDIO_PREFIX}${await canvasAudioPreviewKey(plan.sourceKey)}`;
      if (current.current.state.pendingOperations.some(row => row.cueId === plan.cue.id && row.inputKey === inputKey)) continue;
      const result = await services.queuePost({ action: "audio_timeline", params: plan.params });
      if (!update(previous => ({ ...previous, pendingOperations: [...previous.pendingOperations,
        { id: result.jobId, kind: "post_prod", cueId: plan.cue.id, inputKey }],
      }))) throw new Error(`独立音轨任务 ${result.jobId} 已提交但未保存，请保留编号，不重复处理`);
    }
  });
  /**
   * 一键预混母轨：已确认的对白与配乐按各自保存的音量和淡入淡出落位，
   * 合成一条本段时长的单轨。走同一个 audio_timeline 后期任务（免费），结果不进合听预览，直接挂 master。
   */
  const createPremix = (rethrow = false) =>
    action(async () => {
      if (current.current.state.pendingOperations.length >= 100)
        throw new Error("待处理任务已达 100 条，请先处理原任务。");
      const clips = buildPremixTimelineClips({
        cues: current.current.state.cues,
        durationSec,
        getSelectedTake: getSelectedAudioTake,
        inputKeyOf: canvasAudioCueInputKey,
        videoModel: block.videoModel,
      });
      const premixKey = `${PREMIX_PENDING_PREFIX}${await canvasAudioPreviewKey(selectedSource)}`;
      canvasAudioStudioSchema.parse({ ...current.current.state, pendingOperations: [
        ...current.current.state.pendingOperations, { id: "preflight-premix", kind: "post_prod", inputKey: premixKey },
      ] });
      if (!update(previous => previous)) return;
      const result = await services.queuePost({
        action: "audio_timeline",
        params: { durationSec, clips },
      });
      update(previous => ({
        ...previous,
        pendingOperations: [
          ...previous.pendingOperations,
          { id: result.jobId, kind: "post_prod", inputKey: premixKey },
        ],
      }));
    }, rethrow);
  const selectSource = (cue: CanvasAudioCue, take: CanvasAudioTake, labelZh?: string) => {
    return patchCue(cue.id, {
      source: {
        gcsUri: take.gcsUri,
        previewUrl: take.previewUrl,
        durationSec: take.durationSec,
        labelZh: (labelZh || (cue.kind === "sfx" ? "已选音效来源" : "已选配乐原曲")).slice(0, 200),
      },
      sourceStartSec: 0,
      sourceEndSec: Math.min(
        take.durationSec,
        Math.max(1, cue.endSec - cue.startSec)
      ),
    });
  };
  const prepareMusic = async (options: { fromVoice?: boolean; question?: string; signal?: AbortSignal } = {}) => {
    options.signal?.throwIfAborted();
    const started = current.current;
    const draft = started.state.musicDraft ?? musicDraft;
    const sourceKey = JSON.stringify([started.state.musicDraft, started.sourceShots, started.durationSec]);
    const prompt = options.fromVoice
      ? canvasBgmVoicePrompt(manhuaBgmArcFromShots(started.sourceShots || [], started.durationSec), draft.prompt, options.question)
      : draft.prompt;
    if (!prompt.trim()) throw new Error("先填写剧情与情绪推进。");
    if (!Number.isInteger(draft.durationSec) || draft.durationSec < 10 || draft.durationSec > 360)
      throw new Error("原曲目标时长须为10–360整数秒。");
    const result = await started.services.draftMusic({
      laneZh: "本段剧情配乐",
      durationSec: draft.durationSec,
      moods: ["蓄力", "冲突", "反转", "收束"],
      moodArcZh: prompt,
      titleZh: "剧情配乐",
      model: isBgmV6Model(draft.model) ? draft.model : "suno-v6",
    });
    options.signal?.throwIfAborted();
    if (!mounted.current || current.current.block.id !== started.block.id || current.current.disabled ||
      JSON.stringify([current.current.state.musicDraft, current.current.sourceShots, current.current.durationSec]) !== sourceKey)
      throw new Error("片段、剧情或配乐草稿已变化，本次起草未覆盖当前内容，请核对后重新整理。");
    if (!patchMusicDraft({ prompt, brief: { ...result.brief, duration: draft.durationSec } }))
      throw new Error("配乐要求未能保存，未提交生成。原草稿和候选保留。");
  };
  const openMusicConfirmation = () => {
    const latest = current.current.state;
    const draft = latest.musicDraft;
    if (!draft?.brief || !isBgmV6Model(draft.brief.model)) throw new Error("请先整理当前片段的配乐要求。");
    if (latest.pendingOperations.some(row => row.kind === "bgm")) throw new Error("原配乐任务尚未结束，请查询原任务，不重复生成。");
    if (latest.musicJobIds.length >= 100 || latest.pendingOperations.length >= 100)
      throw new Error("配乐记录或待处理任务已达 100 条上限，原数据保留，本次不提交。");
    if (!Number.isInteger(draft.durationSec) || draft.durationSec < 10 || draft.durationSec > 360)
      throw new Error("原曲目标时长须为10–360整数秒。");
    setConfirmation({ kind: "bgm", brief: { ...draft.brief, duration: draft.durationSec } });
  };
  const audioInventory = (): CanvasAudioVoiceResult => {
    const latest=current.current.state;
    return {status:"inspected",clipId:current.current.block.id,draft:latest.musicDraft||null,musicJobIds:[...latest.musicJobIds],pendingOperations:latest.pendingOperations.map(({id,kind})=>({id,kind})),historyReadFailed:false,
      jobs:musicJobs.filter(row=>latest.musicJobIds.includes(row.jobId)).map(row=>({jobId:row.jobId,status:row.status,titleZh:row.titleZh,variants:row.variants.map(v=>({index:v.index,available:["succeeded","completed"].includes(row.status),durationSec:loadedSources[`${row.jobId}:${v.index}`]}))})),
      cues:latest.cues.map(c=>({id:c.id,kind:c.kind,labelZh:c.labelZh,shotZh:c.shotZh,textZh:c.textZh,speakerId:c.speakerId,speakerZh:c.speakerZh,voice:c.voice,emotion:c.emotion,startSec:c.startSec,endSec:c.endSec,sourceStartSec:c.sourceStartSec,sourceEndSec:c.sourceEndSec,volume:c.volume,fadeInSec:c.fadeInSec,fadeOutSec:c.fadeOutSec,approved:c.approved,selectedTakeId:c.selectedTakeId,takes:c.takes.map(t=>({id:t.id,durationSec:t.durationSec,matches:t.inputKey===canvasAudioCueInputKey(c)}))})),
      sources:(block.uploadedAssets||[]).filter(a=>a.kind==="audio"&&a.gcsUri).map(a=>({id:a.id,label:a.fileName,durationSec:loadedSources[a.id]})),resumableIds:Object.keys(resumable),voices:[...VOICES.map(v=>({id:v.id,label:v.label})),...referenceVoices.filter(v=>v.voiceId).map(v=>({id:v.voiceId!,label:v.labelZh}))],characters:characters.map(c=>({id:c.id,nameZh:c.nameZh})),
    };
  };
  const audioVoiceControl = useRef<CanvasAudioVoiceControl | null>(null);
  audioVoiceControl.current = async (request, signal) => {
    signal?.throwIfAborted();
    if (!mounted.current || request.clipId !== current.current.block.id) throw new Error("目标片段已变化，配乐操作未执行。");
    if (request.action === "audio") {
      if (request.operation!=="inspect" && (busyRef.current || current.current.disabled)) throw new Error("音轨仍在处理，未执行新操作。");
      const latest = current.current.state;
      const cue = latest.cues.find(row=>row.id===request.cueId);
      let status: CanvasAudioVoiceResult["status"] = "updated";
      if(request.operation === "inspect") status="inspected";
      else if(request.operation === "addCue") {
        if(!request.kind)throw new Error("须明确音轨种类");
        addCue(request.kind,request.patch||{},true);
      } else if(request.operation === "premix" || request.operation === "previewMix") {
        if(latest.pendingOperations.some(row=>row.kind==="post_prod"))throw new Error("原音轨处理任务仍在途，请查原编号，不重复混音。");
        if(!window.confirm(request.operation==="premix"?"用已试听采用的音轨制作本段预混母轨？不会生成新配音或配乐。":"用已采用音轨制作本段合听？不会生成新配音或配乐。"))return {...audioInventory(),status:"handled"};
        if(request.operation==="premix")await createPremix(true);else await createPreview(true);
        if(!current.current.state.pendingOperations.some(row=>!latest.pendingOperations.some(old=>old.id===row.id)))throw new Error("未取得新的音轨混合任务编号，原入口可能未保存，不自动重试");
        status="handled";
      } else if(request.operation === "resume") {
        const response=request.jobId?resumable[request.jobId]:undefined;
        if(!request.jobId || !response || !latest.pendingOperations.some(row=>row.id===request.jobId))throw new Error("原任务暂无可恢复结算回执，请继续查询原任务，不重下单。");
        setConfirmation({kind:"resume",id:request.jobId,response});status="awaiting_user_confirmation";
      } else {
        if(!cue)throw new Error("请先读取本段真实cueId，音轨未改。");
        if(latest.pendingOperations.some(row=>row.cueId===cue.id))throw new Error("这条音轨仍在处理，请查原任务。");
        if(request.operation === "configureCue") {
          if(!request.patch || !Object.keys(request.patch).length)throw new Error("没有明确的音轨修改字段。");
          const configured=canvasAudioCueSchema.parse({...cue,...request.patch,approved:false,...(request.patch.emotion!==undefined?{autoEmotion:false}:{})});
          if(configured.endSec<=configured.startSec || configured.endSec>durationSec)throw new Error("音轨秒窗超出本段，未修改。");
          if(configured.mix?.silenceWindows.some(w=>w.endSec<=w.startSec || w.startSec<configured.startSec || w.endSec>configured.endSec))throw new Error("留白须位于本条音轨秒窗内。");
          if(request.patch.voice!==undefined && !VOICES.some(v=>v.id===configured.voice) && !referenceVoices.some(v=>v.voiceId===configured.voice))throw new Error("所选音色不在当前真实清单，未修改。");
          if(!patchCue(cue.id,{...request.patch,approved:false,...(request.patch.emotion!==undefined?{autoEmotion:false}:{})}))throw new Error("音轨修改未保存或角色声线门禁阻断，请查看原提示。");
          setConfirmation(null);
        } else if(request.operation === "generateDialogue") {
          if(cue.kind!=="dialogue")throw new Error("只有对白音轨可生成配音。");
          if(!prepareDialogue(cue))throw new Error("配音前置检查未通过，请查看本句提示；尚未生成。");
          status="awaiting_user_confirmation";
        } else if(request.operation === "adoptTake") {
          const take=cue.takes.find(row=>row.id===request.takeId);
          if(!take || take.inputKey!==canvasAudioCueInputKey(cue))throw new Error("候选不属于当前音轨版本，未采用。");
          const voiceLock=speakerVoiceLocks.get(lockKey(cue))||speakerVoiceLocks.get(cue.speakerZh.trim());
          if(cue.kind==="dialogue" && voiceLock && (voiceLock.conflict || voiceLock.voice!==cue.voice))throw new Error("角色声线与现有采用版本冲突，未覆盖。");
          if(!window.confirm("已试听这条候选并确认采用到本段？其他候选保留。"))return {...audioInventory(),status:"handled"};
          if(!update(previous=>({...previous,cues:previous.cues.map(row=>row.id===cue.id?{...row,selectedTakeId:take.id,approved:true,voiceLock:row.kind==="dialogue"?{speakerZh:row.speakerZh.trim(),speakerId:row.speakerId,voice:row.voice}:row.voiceLock}:row)})))throw new Error("候选采用未保存。");
        } else if(request.operation === "trim") {
          await trim(cue,true);if(!current.current.state.pendingOperations.some(row=>row.cueId===cue.id && !latest.pendingOperations.some(old=>old.id===row.id)))throw new Error("未取得裁切任务编号，请查原回执");status="handled";
        } else if(request.operation === "selectSource") {
          const asset=block.uploadedAssets?.find(row=>row.id===request.sourceId && row.kind==="audio" && row.gcsUri);
          const length=asset?loadedSources[asset.id]:undefined;
          if(!asset?.gcsUri || !length)throw new Error("来源音频须为本段已上传且已加载真实时长的素材，先试听后选择。");
          if(!selectSource(cue,{id:asset.id,gcsUri:asset.gcsUri,previewUrl:asset.previewUrl||asset.url,durationSec:length,inputKey:"source",createdAt:new Date().toISOString()},asset.fileName))throw new Error("来源音频选择未保存");
        } else if(request.operation === "selectMusic") {
          const history=await refreshMusic();signal?.throwIfAborted();
          const job=history.rows.find(row=>row.jobId===request.jobId && latest.musicJobIds.includes(row.jobId) && ["succeeded","completed"].includes(row.status));
          const variant=job?.variants.find(row=>row.index===request.variantIndex);
          const sourceId=job && variant ? `${job.jobId}:${variant.index}` : "";
          const length=loadedSources[sourceId];
          if(!job || !variant || !length)throw new Error("须从原配乐任务选择已试听且加载真实时长的版本，未选原曲。");
          if(current.current.block.id!==request.clipId)throw new Error("片段已变化，未选择原曲。");
          if(!selectSource(cue,{id:sourceId,gcsUri:variant.gcsUri,previewUrl:variant.previewUrl,durationSec:length,bytes:variant.bytes,inputKey:"source",createdAt:new Date().toISOString()},`${job.titleZh} · 版本${variant.index+1}`))throw new Error("配乐原曲选择未保存");
        }
      }
      setEditorOpen(true);
      return {...audioInventory(),status};
    }
    if (request.operation !== "prepare" && request.question?.trim()) throw new Error("新增配乐要求须先整理，再确认生成。");
    let rows = musicJobs;
    let historyReadFailed = false;
    if (request.operation === "inspect") {
      const history = await refreshMusic();
      signal?.throwIfAborted();
      if (!mounted.current || request.clipId !== current.current.block.id) throw new Error("目标片段已变化，请重新查看配乐。");
      rows = history.rows;
      historyReadFailed = Boolean(history.failed);
    } else {
      await action(async () => {
        signal?.throwIfAborted();
        if (request.operation === "prepare") await prepareMusic({ fromVoice: true, question: request.question, signal });
        else openMusicConfirmation();
        setEditorOpen(true);
        setJumpToGroup("bgm");
      }, true);
    }
    const latest = current.current.state;
    return {
      status: request.operation === "inspect" ? "inspected" : request.operation === "prepare" ? "prepared" : "awaiting_user_confirmation",
      clipId: request.clipId,
      draft: latest.musicDraft ?? null,
      musicJobIds: [...latest.musicJobIds],
      pendingOperations: latest.pendingOperations.map(({ id, kind }) => ({ id, kind })),
      jobs: rows.filter(row => latest.musicJobIds.includes(row.jobId)).map(row => ({
        jobId: row.jobId, status: row.status, titleZh: row.titleZh,
        variants: row.variants.map(variant => ({ index: variant.index, available: ["succeeded", "completed"].includes(row.status) && variant.gcsUri.startsWith("gs://") && variant.previewUrl.startsWith("https://") })),
      })),
      historyReadFailed,
    } satisfies CanvasAudioVoiceResult;
  };
  useEffect(() => {
    onVoiceControl?.(block.id, (request, signal) => {
      if (!audioVoiceControl.current) return Promise.reject(new Error("本段音轨入口尚未就绪。"));
      return audioVoiceControl.current(request, signal);
    });
    return () => onVoiceControl?.(block.id, null);
  }, [block.id, onVoiceControl]);
  useEffect(() => {
    if (jumpToGroup === "bgm" && editorOpen && musicComposerRef.current) musicComposerRef.current.open = true;
  }, [editorOpen, jumpToGroup]);
  const musicLibraryPanel = <>
      {musicJobs.filter(job => Number.isSafeInteger(job.missingVariants) && Number(job.missingVariants) > 0).map(job => (
        <p key={job.jobId} role="status" className="text-xs text-amber-200">
          {job.titleZh}：已保留 {job.variants.length} 个版本，另有 {job.missingVariants} 个版本未交付。请保留原任务等待核对，不要重复生成。
        </p>
      ))}
      <details ref={musicComposerRef} className="border-t border-white/15 pt-2">
        <summary className="text-xs font-semibold">
          生成配乐原曲 · 保留所有版本
        </summary>
        <div className="mt-2 space-y-2">
          <label className="block text-xs">
            配乐方式
            <select
              className={fieldClass}
              aria-label="配乐方式"
              value={bgmModel}
              disabled={disabled || busy}
              onChange={event => {
                if (isBgmV6Model(event.target.value)) patchMusicDraft({ model: event.target.value, brief: null });
              }}
            >
              {BGM_BRIEF_MODELS.filter(model => !bgmModels || bgmModels.some(option => option.model === model)).map(model => (
                <option key={model} value={model}>{BGM_BRIEF_MODEL_LABEL_ZH[model]}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            剧情与情绪推进
            <UrlMaskedTextarea
              className={fieldClass}
              aria-label="配乐剧情与情绪推进"
              rows={3}
              value={musicPrompt}
              disabled={disabled || busy}
              onChange={event => {
                patchMusicDraft({ prompt: event.target.value, brief: null });
                setConfirmation(null);
              }}
            />
          </label>
          <label className="block text-xs">
            原曲目标时长
            <input
              className={fieldClass}
              type="number"
              min="10"
              max="360"
              step="1"
              value={musicDuration}
              aria-label="配乐原曲目标时长"
              disabled={disabled || busy}
              onChange={event => {
                patchMusicDraft({ durationSec: Number(event.target.value), brief: null });
                setConfirmation(null);
              }}
            />
          </label>
          <p className="text-xs text-white/60">
            按剧情、情绪和目标时长生成背景音乐；原曲支持 10–360 整数秒，生成前确认费用，生成后试听并选择使用片段。
          </p>
          <button
            className={buttonClass}
            disabled={disabled || busy || !musicPrompt.trim() || !Number.isInteger(musicDuration) || musicDuration < 10 || musicDuration > 360}
            onClick={() => void action(() => prepareMusic())}
          >
            整理配乐要求 · 免费
          </button>
          {brief && (
            <>
              {brief.model !== "suno-v5.5-beta" ? (
                <p className="text-[10px] text-amber-200/80">
                  背景音乐生成方案已选定
                </p>
              ) : null}
              <label className="block text-xs">
                配乐要求
                <UrlMaskedTextarea
                  className={fieldClass}
                  value={brief.prompt}
                  aria-label="配乐生成提示词"
                  rows={3}
                  disabled={disabled || busy}
                  onChange={event => {
                    setBrief({ ...brief, prompt: event.target.value });
                    setConfirmation(null);
                  }}
                />
              </label>
              <label className="block text-xs">
                音乐风格
                <input
                  className={fieldClass}
                  value={brief.style}
                  aria-label="配乐音乐风格"
                  disabled={disabled || busy}
                  onChange={event => {
                    setBrief({ ...brief, style: event.target.value });
                    setConfirmation(null);
                  }}
                />
              </label>
              <button
                className={buttonClass}
                disabled={
                  disabled ||
                  busy ||
                  state.pendingOperations.some(row => row.kind === "bgm")
                }
                onClick={() => void action(async () => openMusicConfirmation())}
              >
                生成这版配乐 · {CANVAS_BGM_CREDITS_PER_RUN} 积分
              </button>
            </>
          )}
        </div>
      </details>
  </>;
  return (
    <section
      aria-label="逐句配音、配乐与事件音效"
      className="space-y-3 rounded-lg border border-sky-200/20 bg-slate-900/70 p-3 text-white"
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">配音与背景音乐</h3>
        <span className="text-[11px] text-white/50">逐句试听 · 分段采用 · 保留原版本</span>
      </div>
      {state.referenceMode === "dialogue" && <p className="text-xs text-sky-100">本次只送对白及已选音效，BGM保留采用记录和原参数，待成片后叠加；旧母轨不参与本次生成。</p>}
      {state.referenceMode !== "dialogue" && block.videoModel === "seedance-2.5" && usesSeparateCanvasAudio(state) && <p className="text-xs text-sky-100">对白按角色和秒窗独立绑定，BGM用整曲独立参考；各自按保存参数处理，不合并为母轨。原音频、采用记录及旧合听保留。</p>}
      {proxyAudio && <p className="text-xs text-amber-100">音频先从本机浏览器缓存读取，缺失时经 Fly 暂存回源；Fly 暂存仅保留 24 小时。请及时下载所选音轨。若原件也已丢失，需重新生成。</p>}
      {restoreSources.length > 0 && <details className="rounded border border-sky-200/20 p-2">
        <summary className="cursor-pointer text-xs">找回本段整套原声与配乐</summary>
        <p className="my-2 text-xs text-white/70">恢复所选旧节点的台词、角色、秒窗、音色、配乐和原采用记录。当前音轨保留为停用版本；剧本、图片及成片保持原样。恢复后请检查声音时长与保存全文，母轨须匹配恢复后的音轨版本。</p>
        <select aria-label="本段原音轨来源" className={fieldClass} value={restoreSourceId} disabled={disabled || busy} onChange={event => setRestoreSourceId(event.target.value)}>
          <option value="">请选择旧节点</option>
          {restoreSources.map(source => <option key={source.id} value={source.id}>{source.archivedFromPreviousScript ? "已归档" : "已有版本"} · {source.id} · 已采用 {source.audioStudio!.cues.filter(cue => cue.enabled && cue.approved).length} 条</option>)}
        </select>
        <button type="button" className={`${buttonClass} mt-2`} disabled={disabled || busy || !restoreSources.some(source => source.id === restoreSourceId)} onClick={() => {
          try {
            const latest = current.current;
            const restored = restoreCanvasSegmentAudio(latest.block, latest.dialogueSources, restoreSourceId, latest.state);
            if (update(() => restored)) { setConfirmation(null); setError(""); setRestoreSourceId(""); }
          } catch (issue) { setError(issue instanceof Error ? issue.message : "原音轨未能恢复，当前版本仍保留。"); }
        }}>恢复本段整套音轨 · 不重新生成</button>
      </details>}
      <nav aria-label="声音制作快捷入口" className="flex flex-wrap gap-2">
        {([["dialogue", "配音"], ["bgm", "背景音乐"], ["sfx", "音效"]] as const).map(([kind, label]) =>
          <button key={kind} type="button" className={buttonClass}
            onClick={() => { setEditorOpen(true); setJumpToGroup(kind); }}>{label}</button>)}
      </nav>
      <div data-manhua-sound-summary data-manhua-sound-multitrack={soundSummary.hasRealMultitrack ? "1" : "0"} className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <section aria-label="当前片段声音预览" className="flex min-w-0 items-start gap-3 rounded-xl border border-sky-200/20 bg-sky-500/[0.06] p-3">
          {block.outputUrl ? <video aria-label="当前片段画面" src={block.outputUrl} controls playsInline preload="metadata" className="aspect-[4/3] w-28 shrink-0 rounded-lg bg-black object-contain"/> : <div className="flex min-h-20 w-28 shrink-0 items-center justify-center rounded-lg border border-dashed border-white/15 bg-black/20 p-3 text-center text-xs text-white/45">本段尚无成片画面，可先制作并试听声音。</div>}
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="text-sm font-semibold text-sky-50">第{soundSummary.segmentIndex}段</h4><span className="text-xs text-white/60">{durationSec} 秒</span></div>
          <p className="mt-1 text-[11px] text-white/50">声音时间从本段 0 秒开始</p>
          {state.pendingOperations.length > 0 && <p role="status" className="mt-2 text-xs text-sky-100">{state.pendingOperations.length} 项原任务处理中</p>}
          {soundSummary.trackNoteZh && <p className="mt-2 text-[11px] leading-4 text-amber-100/80">{soundSummary.trackNoteZh}</p>}
          {soundSummary.emptyZh && <p className="mt-2 text-[11px] leading-4 text-white/45">{soundSummary.emptyZh}</p>}
          {!soundSummary.hasRealMultitrack && !soundSummary.trackNoteZh && Boolean(block.seedance25RefAudioUrls?.length) && <p className="mt-2 text-[11px] leading-4 text-amber-100/80">本段已挂参考音频，尚未确认对白与配乐各自采用；这不是多轨证明。</p>}
          </div>
        </section>
        <section aria-label="角色配音摘要" className="min-w-0 rounded-xl border border-white/15 bg-white/[0.03] p-3">
          <h4 className="text-sm font-semibold">角色配音 <span className="text-white/45">{soundSummary.speakerCount}</span></h4>
          <div className="mt-3 flex flex-wrap gap-2">{soundSummary.speakersZh.map(speaker => <span key={speaker} className="max-w-full break-words rounded-lg border border-sky-200/20 bg-sky-500/10 px-2 py-1.5 text-xs">{speaker}</span>)}</div>
          <p className="mt-3 text-xs text-white/60">{soundSummary.dialogueCount} 句对白 · 已采用 {soundSummary.adoptedCount} 句</p>
          <p className="mt-1 text-[11px] leading-4 text-white/45">{soundSummary.dialogueCount ? "按角色保留音色，每句独立试听与确认。" : "在下方添加对白，填写角色与台词。"}</p>
        </section>
        <section aria-label="背景音乐与音效摘要" className="min-w-0 rounded-xl border border-fuchsia-200/20 bg-fuchsia-500/[0.04] p-3">
          <h4 className="text-sm font-semibold">背景音乐 <span className="text-white/45">{state.cues.filter(cue => cue.kind === "bgm").length}</span></h4>
          <p className="mt-3 text-xs text-white/60">已采用 {state.cues.filter(cue => cue.kind === "bgm" && hasAdoptedManhuaAudio(cue)).length} 段 · 原曲任务 {state.musicJobIds.length} 个</p>
          <div className="mt-3 border-t border-white/10 pt-3"><h4 className="text-xs font-semibold">事件音效 · {soundSummary.sfxCount} 条</h4><p className="mt-1 text-[11px] text-white/50">已采用 {state.cues.filter(cue => cue.kind === "sfx" && hasAdoptedManhuaAudio(cue)).length} 条</p></div>
          <p className="mt-3 text-[11px] leading-4 text-white/45">配乐与音效各自裁切，保留对白窗与留白。</p>
        </section>
      </div>
      <section aria-label="声音时长体检" data-audio-duration-audit className="rounded-lg border border-cyan-300/25 bg-cyan-500/[0.06] p-3 text-xs">
        <h4 className="font-semibold text-cyan-50">声音时长体检 · 本段 {durationSec.toFixed(2)} 秒</h4>
        <p className="mt-1 text-white/75">对白 {durationAudit.dialogueReadyCount}/{durationAudit.dialogueCount} 句已采用且放得进秒窗；背景音乐已覆盖 {durationAudit.bgmCoveredSec.toFixed(2)} 秒，未覆盖 {durationAudit.bgmUncoveredSec.toFixed(2)} 秒（可按剧情留白）。</p>
        {durationAudit.issuesZh.length ? <ul className="mt-2 list-disc space-y-1 pl-4 text-amber-100">{durationAudit.issuesZh.slice(0, 4).map((issue, i) => <li key={`${i}:${issue}`}>{issue}</li>)}{durationAudit.issuesZh.length > 4 ? <li>另有 {durationAudit.issuesZh.length - 4} 项，请逐条检查音轨</li> : null}</ul> : <p className="mt-1 text-emerald-100">已采用音频的时长与秒窗相符；仍须试听内容与口型。</p>}
      </section>
      {dialogueTiming.changes.length > 0 && <details aria-label="整段对白秒窗预览" className="rounded border border-cyan-300/25 p-3 text-xs">
        <summary>整理对白秒窗为一位小数</summary>
        <p className="my-2">向后安排完整原声，保留已有留白；不裁尾、不变速、不重新配音。应用后须核对镜头并重新确认原候选。</p>
        <table className="my-2 w-full text-left"><thead><tr><th>角色</th><th>原时间</th><th>调整后</th></tr></thead><tbody>{dialogueTiming.changes.map(row => <tr key={row.id}><td>{row.labelZh}</td><td>{row.fromStart}–{row.fromEnd}</td><td>{row.startSec.toFixed(1)}–{row.endSec.toFixed(1)}</td></tr>)}</tbody></table>
        {dialogueTiming.issue ? <p>{dialogueTiming.issue}</p> : <button type="button" className={buttonClass} disabled={disabled || busy || state.pendingOperations.length > 0} onClick={() => {
          const latest = current.current;
          if (disabled || busy || latest.state.pendingOperations.length > 0) return;
          const plan = planCanvasDialoguePrecision(latest.state.cues, latest.durationSec);
          if (plan.issue) { setError(plan.issue); return; }
          if (update(previous => ({ ...previous, previewTake: undefined, cues: previous.cues.map(row => {
            const change = plan.changes.find(item => item.id === row.id);
            return change ? { ...row, startSec: change.startSec, endSec: change.endSec, approved: false } : row;
          }) }))) setError("");
        }}>应用整段一位小数秒窗</button>}
      </details>}
      {savedPromptAudio.issue ? <p role="alert" className="text-xs text-amber-200">{savedPromptAudio.issue}</p> : null}
      {savedPromptAudio.studio && savedPromptAudioDiffers(state, savedPromptAudio.studio) ? <section aria-label="保存全文与音轨对白核对" className="rounded border border-amber-400/30 p-3 text-xs text-amber-100">
        <p>当前音轨台词、人物绑定或秒窗与保存全文不一致。旧候选及采用记录保留；请核对原声绑定，不要重复生成。</p>
        <button type="button" className={buttonClass} disabled={disabled || busy}
          onClick={() => {
            try {
              const latest = current.current;
              const saved = createManhuaAudioFromSavedPrompt(latest.block.prompt, latest.durationSec, characters);
              latest.onChange(syncUnproducedAudioToSavedPrompt(latest.state, saved));
              setError("");
            } catch (error) { setError(error instanceof Error ? maskMediaProviderDetails(error.message) : "同步失败，旧音轨保留"); }
          }}>按保存全文更新未生成对白草稿</button>
      </section> : null}
      {modelDurationIssue ? <p role="alert" className="text-xs text-amber-200">{modelDurationIssue}</p> : null}
      <details data-manhua-audio-editor open={editorOpen} onToggle={event => setEditorOpen(event.currentTarget.open)} className="rounded-xl border border-white/10 bg-black/10 p-2">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-sky-100">编辑对白、配乐与音效</summary>
      <div className="mt-2 space-y-3">
      <p className="text-xs text-amber-100">
        {usesSeparateCanvasAudio(state) && block.videoModel === "seedance-2.5"
          ? (state.referenceMode === "dialogue"
              ? "只送已采用对白及音效，BGM待成片后叠加。原配乐采用记录、参数和旧母轨保留，旧母轨不参与本次生成。"
              : "对白与BGM独立投料，保留各自参数。按原参数准备独立音轨后即可核对出片；旧母轨保留但不参与本次生成。")
          : `${canvasAudioCapabilityHint(block)}母轨仅用于本段正常出片，局部编辑、视频延长和试片不注入母轨；出片前仍会校验音轨采用状态、母轨版本及容量。`}
      </p>
      <details className="rounded-lg border border-white/10 bg-black/15 p-2">
        <summary className="cursor-pointer text-xs text-sky-100">本段剧本与对白</summary>
        <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap text-xs leading-5 text-white/70">
          {maskMediaUrls(block.prompt) ||
            "先在视频节点填写剧本，再逐句添加对白或逐段添加音乐。"}
        </pre>
      </details>
      <p className="text-xs text-white/60">
        本段 {durationSec} 秒，时间从本段 0
        秒开始。每次只处理一段。生成后先试听，再确认秒窗；对白独立投料，合听预览不代替口型绑定。
      </p>
      <section className="space-y-2 rounded-xl border border-cyan-300/25 p-3" aria-label="当前音轨操作">
        <label className="block text-xs">当前音轨
          <select aria-label="当前音轨" className={fieldClass} disabled={disabled || busy} value={activeCue?.id || ""} onChange={event => { setActiveCueId(event.target.value); setVoiceCriteria({}); setConfirmation(null); }}>
            {!activeCue && <option value="">请选择音轨</option>}
            {state.cues.map((cue, index) => <option key={cue.id} value={cue.id}>{index + 1} · {cue.kind === "dialogue" ? `对白 · ${cue.speakerZh || "未填角色"}` : cue.kind === "bgm" ? "配乐" : "音效"}</option>)}
          </select>
        </label>
        {activeCue?.kind === "dialogue" && <div id="canvas-voice-picker" className="rounded border border-white/10 p-2">
          <div className="flex flex-wrap gap-2" aria-label="音色分类">
            {(["男", "女", "自定义音色"] as const).map(category => <button key={category} type="button" className={buttonClass} aria-pressed={voiceTab === category}
              onClick={() => { setVoiceTab(category); setVoicePage(0); setVoiceCriteria(previous => ({ ...previous, gender: category === "自定义音色" ? undefined : category })); setVoicePickerOpen(true); }}>{category}</button>)}
          </div>
          {voiceTab !== "自定义音色" && voicePickerOpen && <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-xs">目录年龄<select aria-label="匹配年龄" className={fieldClass} value={voiceCriteria.ageBand || ""} onChange={event => { setVoicePage(0); setVoiceCriteria(prev => ({ ...prev, ageBand: event.target.value as CanvasVoiceMatchCriteria["ageBand"] || undefined })); }}><option value="">不限</option><option value="child">儿童（12岁及以下）</option><option value="adult">成年（18–54岁）</option><option value="senior">年长（55岁及以上）</option></select></label>
            <label className="col-span-2 text-xs">特质或场景关键词<input aria-label="匹配特质" className={fieldClass} maxLength={80} value={voiceCriteria.traitLike || ""} onChange={event => { setVoicePage(0); setVoiceCriteria(prev => ({ ...prev, traitLike: event.target.value })); }}/></label>
          </div>
          <p role="status" className="mt-2 text-xs text-white/65">{voiceMatch?.reasonZh}</p>
          <button type="button" className={buttonClass} disabled={disabled || busy || !voiceMatch?.voice || state.pendingOperations.some(row => row.cueId === activeCue.id)} onClick={() => { if (voiceMatch?.voice) patchCue(activeCue.id, { voice: voiceMatch.voice }); }}>应用建议音色</button>
          <div className="mt-3 space-y-2" aria-label="音色分类预览">
            <p className="text-xs text-white/70">分类结果 {voiceCatalogMatches.length} 条 · 第 {voicePage + 1}/{Math.max(1, Math.ceil(voiceCatalogMatches.length / 30))} 页。官方目录样本与已生成原声均可免费重播；选择音色不会生成或扣费。</p>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {voiceCatalogMatches.slice(voicePage * 30, (voicePage + 1) * 30).map(entry => {
                const voiceId = buildQwenTtsVoiceId("plus", entry.suffix);
                const sample = voiceSamples.get(voiceId);
                return <div key={voiceId} className="rounded border border-white/10 p-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>{entry.gender} · {entry.age ?? "年龄未标"}岁 · {entry.traitZh} · {entry.sceneZh}</span>
                    <button type="button" className={buttonClass} disabled={disabled || busy || state.pendingOperations.some(row => row.cueId === activeCue.id)} onClick={() => patchCue(activeCue.id, { voice: voiceId })}>{activeCue.voice === voiceId ? "当前音色" : "选择音色"}</button>
                  </div>
                  <div className="mt-2"><p className="mb-1 text-white/50">官方目录试音</p><CanvasAudioPlayer aria-label={`${entry.gender} ${entry.traitZh} 免费音色预览`} controls preload="none" src={`/audio/qwen-base-voice-preview/${entry.suffix}.opus`} previewVolume={activeCue.volume} className="h-8 w-full" /></div>
                  {sample ? <div className="mt-2"><p className="mb-1 text-white/50">已有原声示例：{sample.textZh.slice(0, 50)}</p><CanvasAudioPlayer aria-label={`${entry.gender} ${entry.traitZh} 已生成原声试听`} controls preload="none" src={audioPreviewUrl(sample.take.gcsUri, sample.take.previewUrl)} localSource={proxyAudio ? sample.take.gcsUri : undefined} previewVolume={activeCue.volume} className="h-8 w-full" onError={event => void restoreAudio(event.currentTarget, sample.take.gcsUri)} /></div> : null}
                </div>;
              })}
            </div>
            <div className="flex gap-2"><button type="button" className={buttonClass} disabled={voicePage === 0} onClick={() => setVoicePage(page => page - 1)}>上一页</button><button type="button" className={buttonClass} disabled={(voicePage + 1) * 30 >= voiceCatalogMatches.length} onClick={() => setVoicePage(page => page + 1)}>下一页</button></div>
            <p className="text-[11px] text-white/45">目录试音来自阿里云百炼官方基础音色样本包；正式对白仍须按句生成、试听并结算。</p>
          </div></>}
        </div>}
        {activeCue?.kind === "dialogue" && voiceTab === "自定义音色" && <div className="rounded border border-cyan-300/20 p-2">
          <p className="text-xs">自定义音色 · 上传参考音色</p>
          <p className="mt-2 text-xs text-white/65">上传本人有权使用的 3–30 秒清晰人声，建立可复用音色。上传不生成对白；之后逐句 TTS 按实际时长统一计费。</p>
          <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={referenceConsent} onChange={event => setReferenceConsent(event.target.checked)} />我确认有权使用此声音</label>
          <label className={`${buttonClass} mt-2 inline-block cursor-pointer`}>选择参考录音
            <input className="sr-only" type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,.mp3,.wav,.m4a,.aac" disabled={disabled || busy || !referenceConsent}
              onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void importReferenceVoice(file); }} />
          </label>
          <div className="mt-2 space-y-2">{referenceVoices.map(asset => <div key={asset.requestId} className="rounded border border-white/10 p-2 text-xs">
            <span>{asset.labelZh} · {asset.status === "ready" ? "可用于TTS" : "待核对"}</span>
            {asset.voiceId && <button type="button" className={`${buttonClass} ml-2`} disabled={disabled || busy || Boolean(speakerVoiceLocks.get(lockKey(activeCue)))}
              onClick={() => patchCue(activeCue.id, { voice: asset.voiceId })}>选为本句音色</button>}
            {asset.message && <p className="mt-1 text-amber-100">{asset.message}</p>}
          </div>)}</div>
          <button type="button" className={`${buttonClass} mt-2`} disabled={disabled || busy || !services.listReferenceVoices}
            onClick={() => void action(async () => { if (services.listReferenceVoices) setReferenceVoices(await services.listReferenceVoices()); })}>刷新参考音色状态</button>
        </div>}
        <button type="button" className={buttonClass} disabled={disabled || busy || !activeCue || state.pendingOperations.some(row => row.cueId === activeCue.id)} onClick={() => { if (!activeCue) return; if (activeCue.kind === "dialogue") prepareDialogue(activeCue); else void trim(activeCue); }}>
          {activeCue?.kind === "dialogue" ? "生成本句 · 按原声时长计费" : "只裁这一段 · 免费"}
        </button>
        <p className="text-[11px] text-white/50">仅处理上方当前音轨；对白仍须确认费用，配乐与音效仅裁切已选来源。原曲制作在下方单独确认。</p>
      </section>
      {(["dialogue", "bgm", "sfx"] as const).map(kind => <section key={kind} ref={element => { audioGroups.current[kind] = element; }} data-audio-group={kind} aria-label={{ dialogue: "角色配音编辑", bgm: "背景音乐编辑", sfx: "事件音效编辑" }[kind]} className="min-w-0 scroll-mt-4 space-y-3 rounded-xl border border-white/15 bg-black/15 p-3">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="text-sm font-semibold">{{ dialogue: "角色配音", bgm: "背景音乐", sfx: "事件音效" }[kind]} <span className="text-xs font-normal text-white/45">{state.cues.filter(cue => cue.kind === kind).length} {kind === "dialogue" ? "句" : kind === "bgm" ? "段" : "条"}</span></h3><p className="mt-1 text-[11px] text-white/45">{{ dialogue: "写台词、选音色，试听后逐句采用。", bgm: "按剧情分段，每段选原曲和满意区间；音乐主题可以不同。无对白段结合眼神、站位、表演安排音乐与留白。", sfx: "为片中实际发生的动作选音效，按秒点采用。" }[kind]}</p></div>
          <div className="flex flex-wrap gap-2">
            {kind === "bgm" && services.uploadAudioFile ? (
              <label className={`${buttonClass} cursor-pointer`}>
                导入已有原曲
                <input
                  className="sr-only"
                  type="file"
                  accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,.mp3,.wav,.m4a,.aac"
                  disabled={disabled || busy}
                  onChange={event => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void importExistingMusic(file);
                  }}
                />
              </label>
            ) : null}
            <button type="button" className={buttonClass} disabled={disabled || busy} onClick={() => addCue(kind)}>{{ dialogue: "添加一句对白", bgm: "添加一段配乐", sfx: "添加事件音效" }[kind]}</button>
          </div>
        </header>
        {!state.cues.some(cue => cue.kind === kind) && <p className="rounded-lg border border-dashed border-white/10 p-3 text-xs text-white/40">{{ dialogue: "还没有对白。每句生成前单独确认费用，生成后保留候选。", bgm: "还没有分段配乐。可直接导入已有原曲，或展开下方原曲制作；导入只上传并保存 URL，不重新生成配乐。", sfx: "还没有事件音效。仅为本段需要的动作添加，不自动补声音。" }[kind]}</p>}
        {kind === "bgm" && state.cues.some(cue => cue.kind === "bgm") ? <ol aria-label="剧情配乐分段表" className="space-y-1 rounded-lg bg-black/20 p-3 text-xs">
          {state.cues.filter(cue => cue.kind === "bgm").sort((a,b) => a.startSec - b.startSec).map(cue => <li key={cue.id}>
            <button type="button" className="w-full text-left text-cyan-100" onClick={() => { setActiveCueId(cue.id); document.querySelector(`[data-cue-id="${CSS.escape(cue.id)}"]`)?.scrollIntoView({ block: "nearest" }); }}>
              {cue.startSec.toFixed(2)}–{cue.endSec.toFixed(2)} 秒 · {cue.labelZh || cue.shotZh || "待填写剧情位置与音乐主题"} · {hasAdoptedManhuaAudio(cue) ? "已采用" : "待试听采用"}{cue.enabled === false ? " · 本次不用" : ""}
            </button>
          </li>)}
        </ol> : null}
      {state.cues.map((cue, index) => {
        if (cue.kind !== kind) return null;
        const pending = state.pendingOperations.some(
          row => row.cueId === cue.id
        );
        const speakerLock = cue.kind === "dialogue" ? speakerVoiceLocks.get(lockKey(cue)) || speakerVoiceLocks.get(cue.speakerZh.trim()) : undefined;
        const locked = disabled || busy || pending;
        const source = sourceFor(cue);
        const reuseCandidates = findCanvasDialogueReuse(block, cue, dialogueSources);
        const actingSuggestion = cue.kind === "dialogue" ? suggestCanvasDialogueEmotion(cue) : undefined;
        const numberField = (
          label: string,
          key:
            | "startSec"
            | "endSec"
            | "sourceStartSec"
            | "sourceEndSec"
            | "volume"
            | "fadeInSec"
            | "fadeOutSec"
        ) => (
          <label className="min-w-0 text-[11px] text-white/60">
            {label}
            <input
              aria-label={`${index + 1} ${label}`}
              type="number"
              min="0"
              step={key === "startSec" || key === "endSec" ? "0.1" : "0.01"}
              className={fieldClass}
              disabled={locked}
              value={cue[key]}
              onChange={event =>
                patchCue(cue.id, { [key]: Number(event.target.value) })
              }
              onBlur={event => {
                if (key !== "startSec" && key !== "endSec") return;
                const value = Number(event.target.value);
                const rounded = ceilCanvasDialogueSecond(value);
                if (Number.isFinite(value) && value !== rounded) patchCue(cue.id, { [key]: rounded });
              }}
            />
          </label>
        );
        return (
          <article
            key={cue.id}
            data-cue-id={cue.id}
            className="min-w-0 space-y-2 rounded-lg border border-white/10 bg-white/[0.02] p-3"
          >
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={cue.enabled !== false}
                disabled={disabled || busy}
                onChange={event =>
                  patchCue(cue.id, { enabled: event.target.checked })
                }
              />
              用于本次出片
              {cue.enabled === false ? "（本次不用，音频仍保留）" : ""}
            </label>
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-xs font-semibold">
                {index + 1} · {cue.kind === "dialogue" ? "对白" : cue.kind === "sfx" ? "音效" : "配乐"}{" "}
                {cue.approved ? "· 已确认" : "· 待试听确认"}
              </h4>
              {pending && (
                <span className="text-xs text-sky-200">原任务处理中</span>
              )}
            </div>
            <label className="block text-xs">
              镜头与动作
              <input
                aria-label={`${index + 1} 镜头与动作`}
                maxLength={2000}
                className={fieldClass}
                disabled={disabled}
                value={cue.shotZh}
                onChange={event =>
                  patchCue(cue.id, { shotZh: event.target.value })
                }
              />
            </label>
            {cue.kind === "bgm" ? <><label className="block text-xs">剧情位置与音乐主题<input aria-label={`${index + 1} 剧情位置与音乐主题`} maxLength={200} className={fieldClass} disabled={locked} value={cue.labelZh} placeholder="例如：重逢 · 柔情；发现背叛 · 紧张" onChange={e => patchCue(cue.id, { labelZh: e.target.value })}/></label>
              <button type="button" className={buttonClass} disabled={locked} onClick={() => { try { patchMusicDraft({ prompt: canvasBgmSegmentMusicPrompt(cue), brief: null }); setActiveCueId(cue.id); if (musicComposerRef.current) { musicComposerRef.current.open = true; musicComposerRef.current.scrollIntoView({ block: "nearest" }); } } catch (e) { setError(e instanceof Error ? maskMediaProviderDetails(e.message) : "请先填写这段的音乐主题。"); } }}>为这一段准备原曲要求</button>
              <p className="text-[11px] text-white/50">只填写下方原曲制作草稿，保留你选的生成时长。确认后才制作原曲；也可以直接选择已有音乐。</p>
            </> : null}
            <div className="grid grid-cols-2 gap-2">
              {numberField("片内开始秒", "startSec")}
              {numberField("片内结束秒", "endSec")}
            </div>
            <label className="block text-xs text-white/70">
              {cue.kind === "dialogue" ? "本句对白音量" : cue.kind === "bgm" ? "本段配乐音量" : "本条音效音量"} · {Math.round(cue.volume * 100)}%
              <input type="range" min="0" max="1" step="0.01" value={cue.volume}
                aria-label={`${index + 1} ${cue.kind === "dialogue" ? "对白" : cue.kind === "bgm" ? "配乐" : "音效"}试听音量`}
                className="w-full" disabled={locked}
                onChange={event => patchCue(cue.id, { volume: Number(event.target.value) })} />
            </label>
            {cue.kind === "dialogue" ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs">
                    说话角色
                    <input
                      aria-label={`${index + 1} 说话角色`}
                      maxLength={100}
                      className={fieldClass}
                      disabled={disabled}
                      value={cue.speakerZh}
                      onChange={event =>
                        patchCue(cue.id, { speakerZh: event.target.value })
                      }
                    />
                  </label>
                  {characters.length > 0 && <label className="text-xs">绑定角色 ID
                    <select aria-label={`${index + 1} 绑定角色 ID`} className={fieldClass} disabled={disabled || Boolean(cue.voiceLock)}
                      value={cue.speakerId || resolveCharacterId(cue.speakerZh) || ""}
                      onChange={event => { const character = characters.find(row => row.id === event.target.value); if (character) patchCue(cue.id, { speakerId: character.id, speakerZh: character.nameZh }); }}>
                      <option value="">请选择人物资产</option>
                      {characters.map(character => <option key={character.id} value={character.id}>{character.nameZh}</option>)}
                    </select>
                  </label>}
                  <label className="text-xs">
                    声音状态
                    <input
                      aria-label={`${index + 1} 声音状态`}
                      maxLength={120}
                      className={fieldClass}
                      disabled={disabled}
                      placeholder="如：受伤阶段 / 变身后"
                      value={cue.voiceStateZh}
                      onChange={event =>
                        patchCue(cue.id, { voiceStateZh: event.target.value })
                      }
                    />
                  </label>
                </div>
                <p className="text-[11px] text-white/60">
                  阶段标签用于区分候选；实际声音由音色和语气决定。
                </p>
                {speakerLock && <div className="rounded border border-emerald-300/25 p-2 text-xs text-emerald-100">
                  {speakerLock.conflict ? `${cue.speakerZh}已有不同的已采用音色，生成前请核对。` : `${cue.speakerZh}已锁定音色 ${speakerLock.voice}，同项目后续对白沿用。`}
                  {!speakerLock.conflict && cue.voice !== speakerLock.voice && <button type="button" className={`${buttonClass} ml-2`} disabled={locked} onClick={() => patchCue(cue.id, { voice: speakerLock.voice })}>应用角色锁定音色</button>}
                </div>}
                <label className="block text-xs">
                  本句台词
                  <UrlMaskedTextarea
                    ref={element => { dialogueInputs.current[cue.id] = element; }}
                    aria-label={`${index + 1} 本句台词`}
                    maxLength={4000}
                    className={fieldClass}
                    rows={2}
                    disabled={disabled}
                    value={cue.textZh}
                    onChange={event =>
                      patchCue(cue.id, { textZh: event.target.value })
                    }
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-white/55">光标处加入声音：</span>
                  <button type="button" className={buttonClass} disabled={disabled || busy || Boolean(pending)}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => insertDialogueSound(cue, "[cough]")}>咳嗽</button>
                  <button type="button" className={buttonClass} disabled={disabled || busy || Boolean(pending)}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => insertDialogueSound(cue, "[gasp]")}>喘气（吸气）</button>
                  <span className="text-white/55">生成后试听，确认不是把说明念出来。</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span>音色：{VOICES.find(voice => voice.id === cue.voice)?.label || referenceVoices.find(asset => asset.voiceId === cue.voice)?.labelZh || (cue.voice ? "已保存的角色音色" : "未选择")}</span>
                  <button type="button" className={buttonClass} aria-label={`${index + 1} 选择音色`} disabled={disabled || Boolean(speakerLock)}
                    onClick={() => { setActiveCueId(cue.id); setVoicePickerOpen(true); const entry = QWEN_TTS_VOICE_CATALOG.find(row => buildQwenTtsVoiceId("plus", row.suffix) === cue.voice); setVoiceTab(entry?.gender === "男" ? "男" : entry?.gender === "女" ? "女" : "自定义音色"); requestAnimationFrame(() => document.getElementById("canvas-voice-picker")?.scrollIntoView({ block: "start" })); }}>
                    选择音色并免费试听
                  </button>
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-xs">说话语气</legend>
                  {actingSuggestion && <div className="text-[11px] text-cyan-100">
                    情境演技建议：{actingSuggestion.reasonZh}。新句未手动选语气时，生成前自动使用；已有候选只在你点「应用建议」后改变。
                    {cue.emotion !== actingSuggestion.tag && <button type="button" className={buttonClass}
                      disabled={disabled || busy || Boolean(pending)} onClick={() => patchCue(cue.id, { emotion: actingSuggestion.tag, autoEmotion: true })}>应用演技建议</button>}
                  </div>}
                  <div className="flex flex-wrap gap-2">
                    {SPEECH_MOODS.map(([label, value]) => <button key={label} type="button"
                      className={buttonClass} aria-label={`${index + 1} 语气：${label}`}
                      aria-pressed={cue.emotion === value} disabled={disabled || busy || Boolean(pending)}
                      onClick={() => patchCue(cue.id, { emotion: value, autoEmotion: false })}>{label}</button>)}
                  </div>
                  <p className="text-[11px] text-white/50">只影响说话方式，不会把语气名称念出来；咳嗽、喘气需单独核对实际声音。</p>
                </fieldset>
                <details>
                  <summary className="text-xs">高级语气组合</summary>
                <label className="block text-xs">
                  语气标签（可选）
                  <input
                    aria-label={`${index + 1} 语气标签`}
                    maxLength={80}
                    className={fieldClass}
                    disabled={disabled}
                    placeholder="可选，如 [serious][empathetic]"
                    value={cue.emotion}
                    onChange={event =>
                      patchCue(cue.id, { emotion: event.target.value, autoEmotion: false })
                    }
                  />
                </label>
                </details>
                <button type="button" className={buttonClass}
                  aria-label={`生成第${index + 1}句配音`}
                  disabled={disabled || busy || Boolean(pending)}
                  onClick={() => { setActiveCueId(cue.id); prepareDialogue(cue); }}>
                  生成这句配音 · 按原声时长计费
                </button>
                <p className="text-[11px] text-white/50">先确认费用，再生成；新配音保留为候选，试听采用后才用于出片。</p>
              </>
            ) : (
              <>
                <details>
                  <summary className="text-xs text-sky-100">
                    选择原曲 · {source ? "已选原曲" : "尚未选择"}
                  </summary>
                  <div className="space-y-2 py-2">
                    {musicJobs.slice().sort((left, right) =>
                      Number(state.musicJobIds.includes(right.jobId)) - Number(state.musicJobIds.includes(left.jobId))
                    ).flatMap(job =>
                      job.variants.map(variant => {
                        const id = `${job.jobId}:${variant.index}`;
                        const duration = loadedSources[id];
                        const sourceLabel = `${state.musicJobIds.includes(job.jobId) ? "本段原曲" : "其他段原曲"} · ${job.titleZh} · 任务 ${job.jobId.slice(0, 8)} · 版本 ${variant.index + 1}`;
                        return (
                          <div key={id} className="space-y-1">
                            <div className="text-xs">{sourceLabel}</div>
                            <CanvasAudioPlayer
                              aria-label={sourceLabel}
                              className="w-full h-8"
                              controls
                              preload="metadata"
                              src={audioPreviewUrl(variant.gcsUri, variant.previewUrl)}
                              localSource={proxyAudio ? variant.gcsUri : undefined}
                              onError={event =>
                                void restoreAudio(
                                  event.currentTarget,
                                  variant.gcsUri
                                )
                              }
                              onLoadedMetadata={event => {
                                const length = event.currentTarget.duration;
                                if (Number.isFinite(length) && length > 0)
                                  setLoadedSources(previous => ({
                                    ...previous,
                                    [id]: length,
                                  }));
                              }}
                            />
                            <button
                              className={buttonClass}
                              aria-label={`选择${sourceLabel}`}
                              disabled={locked || !duration}
                              onClick={() =>
                                selectSource(cue, {
                                  id,
                                  gcsUri: variant.gcsUri,
                                  previewUrl: variant.previewUrl,
                                  durationSec: duration,
                                  bytes: variant.bytes,
                                  inputKey: "source",
                                  createdAt: new Date().toISOString(),
                                }, `${job.titleZh || "配乐原曲"} · 版本${variant.index + 1}`)
                              }
                            >
                              {duration
                                ? `选这条原曲 · ${duration.toFixed(2)} 秒`
                                : "读取原曲时长…"}
                            </button>
                          </div>
                        );
                      })
                    )}
                    {(block.uploadedAssets || [])
                      .filter(asset => asset.kind === "audio" && asset.gcsUri)
                      .map(asset => (
                        <div key={asset.id}>
                          <div className="text-xs">{asset.fileName}</div>
                          <CanvasAudioPlayer
                            className="w-full h-8"
                            controls
                            preload="metadata"
                            src={audioPreviewUrl(asset.gcsUri!, asset.previewUrl || asset.url)}
                            localSource={proxyAudio ? asset.gcsUri! : undefined}
                            onError={event =>
                              void restoreAudio(
                                event.currentTarget,
                                asset.gcsUri!
                              )
                            }
                            onLoadedMetadata={event => {
                              const length = event.currentTarget.duration;
                              if (Number.isFinite(length) && length > 0)
                                setLoadedSources(previous => ({
                                  ...previous,
                                  [asset.id]: length,
                                }));
                            }}
                          />
                          <button
                            className={buttonClass}
                            disabled={locked || !loadedSources[asset.id]}
                            onClick={() =>
                              selectSource(cue, {
                                id: asset.id,
                                gcsUri: asset.gcsUri!,
                                previewUrl: asset.previewUrl || asset.url,
                                durationSec: loadedSources[asset.id],
                                inputKey: "source",
                                createdAt: new Date().toISOString(),
                              }, asset.fileName)
                            }
                          >
                            选这条上传音频
                          </button>
                        </div>
                      ))}
                    {!musicJobs.some(job => job.variants.length) && (
                      <p className="text-xs text-white/60">
                        可在下方生成配乐，或使用节点上传区添加音频。
                      </p>
                    )}
                  </div>
                </details>
                {source && cue.kind === "bgm" ? <CanvasBgmSegmentEditor cue={cue} index={index} durationSec={durationSec} locked={locked} proxyAudio={proxyAudio} sourceUrl={audioPreviewUrl(source.gcsUri, source.previewUrl)} onRestore={element => void restoreAudio(element, source.gcsUri)} onPatch={patch => patchCue(cue.id, patch)} onSplit={at => splitBgm(cue.id, at)} onTrim={() => { setActiveCueId(cue.id); void trim(cue); }} onError={setError}/> : null}
                {source && cue.kind !== "bgm" && (
                  <div className="space-y-1 text-xs">
                    原曲 {source.durationSec.toFixed(2)} 秒
                    <CanvasAudioPlayer
                      className="w-full h-8"
                      controls
                      src={audioPreviewUrl(source.gcsUri, source.previewUrl)}
                      localSource={proxyAudio ? source.gcsUri : undefined}
                      previewVolume={cue.volume}
                      onError={event =>
                        void restoreAudio(event.currentTarget, source.gcsUri)
                      }
                      preload="none"
                    />
                    <button type="button" className={buttonClass} onClick={() => void downloadAudio(source.gcsUri, source.previewUrl, `bgm-${cue.id}.mp3`)}>下载这段原曲</button>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {cue.kind !== "bgm" ? numberField("源音频裁切起点", "sourceStartSec") : null}
                  {cue.kind !== "bgm" ? numberField("源音频裁切终点", "sourceEndSec") : null}
                  {numberField("淡入秒", "fadeInSec")}
                  {numberField("淡出秒", "fadeOutSec")}
                </div>
                {cue.takes.some(take => take.inputKey !== "source" && take.inputKey !== canvasAudioCueInputKey(cue)) && (
                  <p className="text-xs text-amber-200">旧裁切音频已保留。要让新音量准确进入合听，请用上方「只裁这一段 · 免费」从原曲重新裁切并试听确认；不会重做原曲。</p>
                )}

              </>
            )}
            {cue.kind === "dialogue" && reuseCandidates.length > 0 ? (
              <details className="rounded-lg border border-cyan-300/25 p-3" data-dialogue-reuse>
                <summary className="cursor-pointer text-sm text-cyan-100">找回已有对白 · 无需重新生成</summary>
                <p className="mt-2 text-xs text-white/60">同角色、同状态、同台词的原声。加入时使用所列情绪和音色，保留当前时间安排；试听后再采用。</p>
                {reuseCandidates.map(candidate => (
                  <div key={candidate.take.id} className="mt-3 space-y-2 rounded bg-white/5 p-2">
                    <p className="text-xs">{candidate.take.durationSec.toFixed(3)} 秒 · {candidate.emotion || "自然情绪"} · {VOICES.find(voice => voice.id === candidate.voice)?.label || candidate.voice || "未标音色"}</p>
                    <CanvasAudioPlayer controls preload="none" src={audioPreviewUrl(candidate.take.gcsUri, candidate.take.previewUrl)} localSource={proxyAudio ? candidate.take.gcsUri : undefined} previewVolume={cue.volume} className="h-8 w-full" onError={event => void restoreAudio(event.currentTarget, candidate.take.gcsUri)} />
                    <button type="button" className={buttonClass} disabled={locked || cue.takes.length >= 100} onClick={() => {
                      if (locked || busyRef.current) return;
                      setConfirmation(null);
                      update(previous => {
                        const latest = previous.cues.find(item => item.id === cue.id);
                        if (!latest) return previous;
                        try {
                          const restored = restoreCanvasDialogueCandidate(current.current.block, latest, current.current.dialogueSources, candidate);
                          return { ...previous, previewTake: undefined, cues: previous.cues.map(item => item.id === cue.id ? restored : item) };
                        } catch (error) { setError(error instanceof Error ? maskMediaProviderDetails(error.message) : "找回失败，原声仍保留。"); return previous; }
                      });
                    }}>加入候选并使用此情绪与音色</button>
                  </div>
                ))}
              </details>
            ) : null}
            {cue.kind !== "dialogue" && <CanvasAudioMixControls cue={cue} disabled={locked} onChange={patch => patchCue(cue.id, patch)}/>}
            {cue.takes
              .filter(take => take.inputKey !== "source")
              .map((take, takeIndex) => (
                <div key={take.id} className="space-y-1 rounded bg-white/5 p-2">
                  <div className="text-xs">
                    候选 {takeIndex + 1} · {take.durationSec.toFixed(2)} 秒{take.speed ? ` · ${take.speed.toFixed(2)} 倍速` : ""}{" "}
                    {take.creditsCost !== undefined ? `· 结算 ${take.creditsCost.toFixed(1)} 积分 ` : ""}
                    {cue.selectedTakeId === take.id && hasAdoptedManhuaAudio(cue) ? <span className="ml-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-100">已采用</span> : null}
                    {take.inputKey !== canvasAudioCueInputKey(cue)
                      ? "· 修改前版本，保留试听"
                      : ""}
                  </div>
                  <CanvasAudioPlayer
                    className="w-full h-8"
                    aria-label={`${index + 1} 候选 ${takeIndex + 1}`}
                    controls
                    src={audioPreviewUrl(take.gcsUri, take.previewUrl)}
                    localSource={proxyAudio ? take.gcsUri : undefined}
                    previewVolume={cue.volume}
                    onError={event =>
                      void restoreAudio(event.currentTarget, take.gcsUri)
                    }
                    preload="none"
                  />
                  <button type="button" className={buttonClass} onClick={() => void downloadAudio(take.gcsUri, take.previewUrl, `${cue.kind}-${cue.id}-${takeIndex + 1}.${take.gcsUri.match(/\.(mp3|wav|m4a|aac|ogg|opus)$/i)?.[1]?.toLowerCase() || "wav"}`)}>下载这条音轨</button>
                  <button
                    className={buttonClass}
                    disabled={
                      locked ||
                      take.inputKey !== canvasAudioCueInputKey(cue)
                    }
                    onClick={() =>
                      speakerLock && (speakerLock.conflict || speakerLock.voice !== cue.voice) ? setError(`${cue.speakerZh}已锁定其他音色，本候选不能覆盖角色锁。`) : update(previous => ({
                        ...previous,
                        cues: previous.cues.map(row =>
                          row.id === cue.id
                            ? {
                                ...row,
                                selectedTakeId: take.id,
                                approved: true,
                                voiceLock: row.kind === "dialogue" ? { speakerZh: row.speakerZh.trim(), speakerId: row.speakerId, voice: row.voice } : row.voiceLock,
                              }
                            : row
                        ),
                      }))
                    }
                  >
                    试听后确认本段
                  </button>
                  {cue.kind === "dialogue" && !take.speed && services.speedDialogueTake && (() => {
                    const suggestion = suggestCanvasDialogueSpeed(take.durationSec, cue.endSec - cue.startSec);
                    const chosen = speedDraft[take.id] ?? (suggestion?.fits ? suggestion.speed : 1);
                    const options = Array.from(new Set([
                      ...Array.from({ length: Math.round((CANVAS_DIALOGUE_SPEED_MAX - CANVAS_DIALOGUE_SPEED_MIN) / 0.05) + 1 }, (_, i) => Math.round((CANVAS_DIALOGUE_SPEED_MIN + i * 0.05) * 100) / 100),
                      ...(suggestion?.fits ? [suggestion.speed] : []),
                    ])).sort((a, b) => a - b);
                    return (
                      <div className="flex flex-wrap items-center gap-2 text-xs" data-dialogue-speed>
                        <label className="flex items-center gap-1">语速
                          <select aria-label={`${index + 1} 候选 ${takeIndex + 1} 语速`} className="rounded bg-black/30 px-1 py-0.5" disabled={locked || Boolean(speedBusyTakeId)}
                            value={chosen} onChange={event => setSpeedDraft(previous => ({ ...previous, [take.id]: Number(event.target.value) }))}>
                            {options.map(value => <option key={value} value={value}>{value.toFixed(2)} 倍{suggestion?.fits && value === suggestion.speed ? "（刚好放进窗口）" : ""}</option>)}
                          </select>
                        </label>
                        <button type="button" className={buttonClass} disabled={locked || Boolean(speedBusyTakeId) || chosen === 1 || cue.takes.length >= 100}
                          onClick={() => void deriveSpeedTake(cue.id, take, chosen)}>
                          {speedBusyTakeId === take.id ? "变速中…" : `按 ${chosen.toFixed(2)} 倍生成新候选`}
                        </button>
                        <span className="text-white/60">约 {(take.durationSec / chosen).toFixed(2)} 秒 · 保持音高、免费；原候选保留，新候选需试听确认</span>
                        {chosen > CANVAS_DIALOGUE_SPEED_WARN && <span className="text-amber-200">超过 {CANVAS_DIALOGUE_SPEED_WARN} 倍听感会明显偏快</span>}
                        {suggestion && !suggestion.fits && <span className="text-amber-200">2 倍仍放不下当前窗口，请延长窗口或顺延后续对白</span>}
                      </div>
                    );
                  })()}
                  {take.durationSec > cue.endSec - cue.startSec + 0.02 && (
                    <div className="text-xs text-amber-200">
                      <p>可先按听审结果采用完整原声。原声 {take.durationSec.toFixed(3)} 秒，当前窗口 {(cue.endSec - cue.startSec).toFixed(3)} 秒，还差 {(take.durationSec - (cue.endSec - cue.startSec)).toFixed(3)} 秒；合听和出片前仍需安排足够时长，不会截断对白。</p>
                      {cue.kind === "dialogue" && (() => {
                        const fit = canvasDialogueWindowFit(cue, take, state.cues, durationSec);
                        if (!fit.issue) return <button className={buttonClass} disabled={locked} onClick={() => patchCue(cue.id, { endSec: fit.endSec })}>将本句窗口延长至 {fit.endSec.toFixed(1)} 秒</button>;
                        const plan = planCanvasDialogueTiming(state.cues, cue.id, take, durationSec);
                        return <><p>{fit.issue}</p>{plan.changes.length > 0 && <details className="mt-2">
                          <summary>预览后续对白顺延</summary>
                          <table className="my-2 w-full text-left"><thead><tr><th>角色</th><th>原时间</th><th>调整后</th></tr></thead><tbody>{plan.changes.map(row => <tr key={row.id}><td>{row.labelZh}</td><td>{row.fromStart}–{row.fromEnd}</td><td>{row.startSec.toFixed(1)}–{row.endSec.toFixed(1)}</td></tr>)}</tbody></table>
                          <p>保留完整原声；对白调整后需核对镜头、动作及配乐节奏，并重新试听确认。</p>
                          {plan.issue ? <p>{plan.issue}</p> : <button type="button" className={buttonClass} disabled={locked || state.pendingOperations.length > 0} onClick={() => {
                            if (disabled || busy || current.current.state.pendingOperations.length > 0) return;
                            setConfirmation(null);
                            update(previous => {
                              const actualCue = previous.cues.find(row => row.id === cue.id);
                              const actualTake = actualCue?.takes.find(row => row.id === take.id);
                              if (!actualTake) return previous;
                              const latest = planCanvasDialogueTiming(previous.cues, cue.id, actualTake, current.current.durationSec);
                              if (latest.issue) { setError(latest.issue); return previous; }
                              return { ...previous, previewTake: undefined, cues: previous.cues.map(row => {
                                const change = latest.changes.find(item => item.id === row.id);
                                return change ? { ...row, startSec: change.startSec, endSec: change.endSec, approved: false } : row;
                              }) };
                            });
                          }}>应用对白时间，待核对镜头</button>}
                        </details>}</>;
                      })()}
                    </div>
                  )}
                </div>
              ))}
          </article>
        );
      })}
      {kind === "bgm" ? musicLibraryPanel : null}
      </section>)}
      {confirmation && (
        <div
          role="dialog"
          aria-label="确认音频费用"
          ref={element => { element?.scrollIntoView({ block: "nearest" }); }}
          className="space-y-2 rounded border border-amber-300/40 bg-amber-900/20 p-3"
        >
          {confirmation.kind === "dialogue" && <p className="text-sm font-semibold">
            {state.cues.find(cue => cue.id === confirmation.cueId)?.speakerZh}：
            {state.cues.find(cue => cue.id === confirmation.cueId)?.textZh}
          </p>}
          {confirmation.kind === "dialogue" && <p className="text-xs text-cyan-100">实际合成输入：{
            (() => { const cue = state.cues.find(row => row.id === confirmation.cueId); return cue ? compileCanvasDialogueInput(cue.textZh, cue.emotion) : ""; })()
          }</p>}
          <p className="text-xs">
            {confirmation.kind === "resume"
              ? "恢复原单音频保存与结算，不重新配音，不重复扣费。"
              : confirmation.kind === "dialogue"
                ? "只生成当前这一句；按归一化原声实测时长计费，每开始 0.2 秒收 2 积分，不足 0.2 秒也收 2 积分。生成成功后按实长结算；余额不足时保留原单等待补足，不重新合成。"
                : `生成这一版配乐，${CANVAS_BGM_CREDITS_PER_RUN} 积分。`}
            生成后保留候选，不自动采用；失败按任务规则退款。
          </p>
          <div className="flex gap-2">
            <button
              className={buttonClass}
              disabled={disabled || busy}
              onClick={() => void confirmPaid()}
            >
              {confirmation.kind === "resume" ? "确认恢复原单" : "确认生成"}
            </button>
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {Object.entries(resumable)
        .filter(([id]) => state.pendingOperations.some(row => row.id === id))
        .map(([id, response]) => (
          <button
            key={id}
            className={buttonClass}
            disabled={disabled || busy}
            onClick={() => setConfirmation({ kind: "resume", id, response })}
          >
            恢复保存与结算（不重新配音）
          </button>
        ))}
      <div className="flex flex-wrap gap-2">
        <button
          className={buttonClass}
          disabled={
            disabled ||
            busy ||
            // 预混母轨的 pending 不占合听的位：自由画布里没有回调、预混 pending 会留着等回工厂
            state.pendingOperations.some(
              row => !row.cueId && row.kind === "post_prod" && !isPremixPendingKey(row.inputKey)
            )
          }
          onClick={() => void createPreview()}
        >
          合听已确认秒窗 · 免费
        </button>
        {!onMasterTrackReady && state.pendingOperations.some(row => !row.cueId && isPremixPendingKey(row.inputKey)) ? (
          <span className="self-center text-xs text-amber-100">预混母轨已在排队：回漫剧工厂的配音间即可自动挂到本段。</span>
        ) : null}
        {block.videoModel === "seedance-2.5" && state.cues.some(cue => cue.enabled && cue.kind === "dialogue") ? (
          <><button className={buttonClass} disabled={disabled || busy || state.pendingOperations.length > 0}
            onClick={() => void prepareSeparateReferences("dialogue")}>仅送对白，BGM后期叠加 · 免费准备</button>
          <button className={buttonClass} disabled={disabled || busy || state.pendingOperations.length > 0}
            onClick={() => void prepareSeparateReferences()}>按原参数准备独立音轨 · 免费</button></>
        ) : null}
        {onMasterTrackReady && !(block.videoModel === "seedance-2.5" && usesSeparateCanvasAudio(state)) ? (
          <button
            className={buttonClass}
            disabled={
              disabled ||
              busy ||
              state.pendingOperations.some(
                row => !row.cueId && row.kind === "post_prod"
              )
            }
            title="按每句对白和每段配乐已保存的音量混成一条本段母轨，出片时作唯一 @音频1。免费。"
            onClick={() => void createPremix()}
          >
            {block.manhuaSegmentRefs?.master ? "重新预混母轨 · 免费" : "一键预混母轨 · 免费"}
          </button>
        ) : null}
        <button
          className={buttonClass}
          disabled={disabled || busy}
          onClick={() =>
            void action(async () => { await refreshMusic(); })
          }
        >
          刷新配乐素材
        </button>
      </div>
      {!(block.videoModel === "seedance-2.5" && usesSeparateCanvasAudio(state)) && block.manhuaSegmentRefs?.master?.audioStudioSource && block.manhuaSegmentRefs.master.audioStudioSource !== selectedSource && <p role="alert" className="text-xs text-amber-200">当前母轨与声音配置不一致，旧版保留；请重新合听后预混。</p>}
      {state.previewTake && (
        <div className="text-xs">
          {state.previewTake.inputKey === selectedKey
            ? "秒锁合听预览（不会作为整条对白投料）"
            : "旧合听预览，当前配置已改变"}
          <CanvasAudioPlayer
            className="w-full h-8"
            controls
            src={audioPreviewUrl(state.previewTake.gcsUri, state.previewTake.previewUrl)}
            localSource={proxyAudio ? state.previewTake.gcsUri : undefined}
            onError={event =>
              void restoreAudio(event.currentTarget, state.previewTake!.gcsUri)
            }
            preload="none"
          />
        </div>
      )}
      {state.pendingOperations.length > 0 && (
        <p className="break-all text-[11px] text-white/60">
          保留原单自动查询：
          {state.pendingOperations.map(row => row.id).join("、")}
          。状态未明时不要重复生成。
        </p>
      )}
      {sourceIssue && <p role="alert" className="text-amber-200">{sourceIssue}</p>}
      {error && (
        <p role="alert" className="text-xs text-amber-200">
          {maskMediaProviderDetails(error)}
        </p>
      )}
      </div>
      </details>
    </section>
  );
}
