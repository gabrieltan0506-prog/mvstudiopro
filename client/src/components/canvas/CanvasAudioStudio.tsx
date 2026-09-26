import { gcsTransferUrl, isGcsTransferUrl } from "@/lib/gcsTransfer";
import type { ComponentProps } from "react";
import { findCanvasDialogueReuse, restoreCanvasDialogueCandidate } from "@/lib/canvasDialogueReuse";
import { createManhuaAudioFromShots } from "@shared/manhuaAudioFromShots";
import { manhuaBgmArcFromShots } from "@shared/manhuaBgmArcFromShots";
import { manhuaScriptCueSourceIssue } from "@/lib/manhuaAudioScriptSource";
import { planCanvasDialogueTiming } from "@shared/canvasDialogueTimingPlan";
import type { ManhuaWorkbenchShot } from "@shared/manhuaScriptWorkbench";
import { canvasAudioMixSource } from "@shared/canvasAudioStudio";
import { CanvasAudioMixControls } from "./CanvasAudioMixControls";
import { applyCanvasAudioMixPlan, assertCanvasAudioMixCapacity } from "@shared/canvasAudioMixPlan";
import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { CanvasBlock } from "@/lib/canvasTypes";
import { canvasAudioCapabilityHint } from "@/lib/canvasAudioCapabilityHint";
import type { ManhuaSegmentReferenceEntry } from "@shared/manhuaSegmentReference";
import { BGM_BRIEF_MODELS, BGM_BRIEF_MODEL_LABEL_ZH, isBgmV6Model, type BgmBriefModel } from "@shared/manhuaBgmBrief";
import { buildPremixTimelineClips, isPremixPendingKey, PREMIX_PENDING_PREFIX } from "@/lib/manhuaPremixMaster";
import { resolveCanvasMaterialUrl } from "@/lib/omniCanvasApi";
import { compileCanvasDialogueInput } from "@shared/canvasDialogueControls";
import { canvasAudioPreviewKey, loadCanvasMusicHistory } from "@/lib/canvasAudioStudioRecovery";
import { parseManhuaClipTargetDurationSec } from "@shared/manhuaScriptWorkbench";
import { manhuaClipMaxDurationSecForVideoModel } from "@shared/manhuaSeedanceLayout";
import {
  emptyCanvasAudioStudio,
  canvasAudioStudioSchema,
  createCanvasAudioCue,
  canvasAudioCueInputKey,
  getSelectedAudioTake,
  canvasDialogueWindowFit,
  canvasAudioCueSchema,
  canvasMusicDraftSchema,
  type CanvasMusicDraft,
  type CanvasAudioStudio as CanvasAudioStudioState,
  type CanvasAudioCue,
  type CanvasAudioTake,
} from "@shared/canvasAudioStudio";
import { buildManhuaSoundPanelSummary, hasAdoptedManhuaAudio } from "@shared/manhuaSoundPanelSummary";
import { resolveClipLocalSegmentIndex } from "@shared/manhuaScriptWorkbench";
import {
  CANVAS_TTS_CREDITS_PER_LINE,
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
  label: `${row.nameZh} · ${row.gender} · ${row.traitZh}`,
}));
const SPEECH_MOODS = [
  ["自然", ""], ["虚弱", "[tired]"], ["安抚", "[empathetic]"],
  ["严肃", "[serious]"], ["悲伤", "[sad]"], ["愤怒", "[angry]"],
  ["惊慌", "[panicked]"], ["低声", "[whispers]"], ["好奇", "[curious]"],
] as const;
export type CanvasVoiceMatchCriteria = { gender?: "男" | "女" | "中性"; ageBand?: "child" | "adult" | "senior"; traitLike?: string };
/** 现有音轨没有稳定角色 ID，只消费显式目录条件，禁止按姓名跨句借声。 */
export function matchCanvasDialogueVoice(criteria: CanvasVoiceMatchCriteria) {
  if (!criteria.gender && !criteria.ageBand && !criteria.traitLike?.trim()) return { reasonZh: "请填写至少一项目录筛选条件；不会按角色姓名借用其他对白音色。" };
  const ages = criteria.ageBand === "child" ? { maxAge: 12 } : criteria.ageBand === "senior" ? { minAge: 55 } : criteria.ageBand === "adult" ? { minAge: 18, maxAge: 54 } : {};
  const entry = pickQwenTtsVoice({ gender: criteria.gender, ...ages, traitLike: criteria.traitLike?.trim(), lang: "中文" });
  if (!entry) return { reasonZh: "目录中没有同时符合这些条件的声线；原音色保持不变。" };
  return { voice: buildQwenTtsVoiceId("plus", entry.suffix), reasonZh: `目录候选：${entry.nameZh} · ${entry.gender} · ${entry.age ?? "年龄未标"}岁 · ${entry.traitZh}。按所填条件筛选，尚未试听验证。` };
}

const fieldClass =
  "min-w-0 w-full rounded border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-white";
/** 播放复用已鉴权传输，原候选和投料地址保持不变。 */
function CanvasAudioPlayer({ src, previewVolume = 1, ...props }: ComponentProps<"audio"> & { previewVolume?: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, previewVolume));
  }, [previewVolume]);
  return <audio {...props} ref={audioRef} src={src ? gcsTransferUrl(src) : src}
    crossOrigin={src && isGcsTransferUrl(src) ? "use-credentials" : props.crossOrigin} />;
}

const buttonClass =
  "rounded border border-white/20 px-2 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-40";

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
  voiceStateZh?: string;
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
    voiceStateZh: string;
  }): Promise<JobResult>;
  getDialogue(input: { jobId: string }): Promise<JobResult | null>;
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
  disabled?: boolean;
  onChange: (next: CanvasAudioStudioState) => boolean | void;
  /**
   * 一键预混母轨出好后回调：对白原音量 + BGM 压 12 dB 带淡入淡出，合成一条 ≤30 s 单轨，
   * 由上层挂到本段 manhuaSegmentRefs.master（出片时作唯一 @音频1）。不传则不显示按钮。
   */
  onMasterTrackReady?: (entry: ManhuaSegmentReferenceEntry) => boolean | void;
  /** 保留后台配乐配置及默认值；前台不展示模型或供应商名称。 */
  bgmModels?: Array<{ model: BgmBriefModel; labelZh: string }>;
};


/** 生产适配器与视图分开；离线测试运行真实视图，不能触发真实付费。 */
export function CanvasAudioStudio(props: Props) {
  const utils = trpc.useUtils();
  const dialogue = trpc.canvasAudio.generateDialogue.useMutation();
  const draft = trpc.mvAnalysis.draftManhuaBgmBrief.useMutation();
  const music = trpc.mvAnalysis.queueManhuaBgm.useMutation();
  const post = trpc.mvAnalysis.queuePostProd.useMutation();
  const signedUpload = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  const services: CanvasAudioStudioServices = {
    resolveAudio: resolveCanvasMaterialUrl,
    generateDialogue: input => dialogue.mutateAsync(input),
    getDialogue: input =>
      utils.canvasAudio.getDialogue.fetch({ billingRequestId: input.jobId }),
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
  return <CanvasAudioStudioView {...props} services={services} />;
}

export function CanvasAudioStudioView({
  block,
  compact = false,
  timelineDurationSec,
  sourceShots,
  dialogueSources = [],
  disabled = false,
  onChange,
  onMasterTrackReady,
  bgmModels,
  services,
}: Props & { services: CanvasAudioStudioServices }) {
  const requestedDurationSec = Number(
    timelineDurationSec ??
      parseManhuaClipTargetDurationSec(block.prompt) ??
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
  const { initialAudio, sourceIssue } = useMemo(() => {
    if (block.audioStudio || !sourceShots?.length) return { initialAudio: emptyCanvasAudioStudio(), sourceIssue: "" };
    try { return { initialAudio: { ...createManhuaAudioFromShots(sourceShots, durationSec), musicDraft: {
      prompt: suggestedMusicPrompt, durationSec: Math.max(10, Math.ceil(durationSec)),
      brief: null, model: bgmModels?.[0]?.model ?? "suno-v6" as const,
    } }, sourceIssue: "" }; }
    catch { return { initialAudio: emptyCanvasAudioStudio(), sourceIssue: "本段对白超出音轨容量或字段限制，未截断原文；请先拆分本段或检查原稿。" }; }
  }, [block.audioStudio, sourceShots, durationSec, suggestedMusicPrompt, bgmModels]);
  const state = block.audioStudio ?? initialAudio;
  const expectedScriptAudio = useMemo(() => {
    if (!sourceShots?.length) return undefined;
    try { return createManhuaAudioFromShots(sourceShots, durationSec); }
    catch { return undefined; }
  }, [sourceShots, durationSec]);
  const currentScriptCues = state.cues.filter(cue => /^script-shot-\d+-line-\d+$/.test(cue.id));
  const expectedScriptCues = expectedScriptAudio?.cues || [];
  const scriptTimelineOutdated = Boolean(block.audioStudio && sourceShots?.length) && (
    currentScriptCues.length !== expectedScriptCues.length ||
    expectedScriptCues.some(expected => {
      const currentCue = currentScriptCues.find(cue => cue.id === expected.id);
      return !currentCue ||
        Math.abs(currentCue.startSec - expected.startSec) > 0.001 ||
        Math.abs(currentCue.endSec - expected.endSec) > 0.001 ||
        currentCue.speakerZh !== expected.speakerZh ||
        currentCue.textZh !== expected.textZh;
    })
  );
  const canRefreshScriptTimeline = scriptTimelineOutdated && currentScriptCues.every(cue =>
    cue.takes.length === 0 && !cue.selectedTakeId && !cue.approved && !cue.voice && !cue.voiceStateZh,
  ) && !state.pendingOperations.some(row => row.cueId && currentScriptCues.some(cue => cue.id === row.cueId));
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
  const current = useRef({ state, onChange, services, block, onMasterTrackReady, durationSec, dialogueSources, sourceShots, expectedScriptAudio });
  current.current = { state, onChange, services, block, onMasterTrackReady, durationSec, dialogueSources, sourceShots, expectedScriptAudio };
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [editorOpen, setEditorOpen] = useState(!compact);
  const audioGroups = useRef<Partial<Record<"dialogue" | "bgm" | "sfx", HTMLElement | null>>>({});
  const dialogueInputs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [jumpToGroup, setJumpToGroup] = useState<"dialogue" | "bgm" | "sfx" | null>(null);
  useEffect(() => {
    if (!editorOpen || !jumpToGroup) return;
    audioGroups.current[jumpToGroup]?.scrollIntoView({ block: "start" });
    setJumpToGroup(null);
  }, [editorOpen, jumpToGroup]);
  const [activeCueId, setActiveCueId] = useState<string | null>(null);
  const [voiceCriteria, setVoiceCriteria] = useState<CanvasVoiceMatchCriteria>({});
  const activeCue = activeCueId === null ? state.cues[0] : state.cues.find(cue => cue.id === activeCueId);
  const voiceMatch = activeCue?.kind === "dialogue" ? matchCanvasDialogueVoice(voiceCriteria) : undefined;
  useEffect(() => { setActiveCueId(null); setVoiceCriteria({}); }, [block.id]);
  useEffect(() => { setEditorOpen(!compact); }, [block.id, compact]);
  const [error, setError] = useState("");
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
      if (mounted.current && element.isConnected && /^https:\/\//.test(url)) {
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
    if (!mounted.current || current.current.block.id !== block.id) return false;
    const next = fn(current.current.state);
    if (current.current.onChange(next) === false) {
      setError("当前片段忙碌或声音状态未能保存，已阻止本次新提交。请保留页面，待任务结束或备份并释放浏览器空间后重试。");
      return false;
    }
    current.current.state = next;
    return true;
  };
  const patchMusicDraft = (patch: Partial<CanvasMusicDraft>) => {
    if (!mounted.current || current.current.block.id !== block.id) return;
    setConfirmation(null);
    update(previous => {
      const parsed = canvasMusicDraftSchema.safeParse({ ...musicDraft, ...previous.musicDraft, ...patch });
      if (!parsed.success) { setError("配乐草稿超出字段范围，已保留原稿。"); return previous; }
      return { ...previous, musicDraft: parsed.data };
    });
  };
  const setBrief = (next: MusicBrief | null) => patchMusicDraft({ brief: next });
  const patchCue = (id: string, patch: Partial<CanvasAudioCue>) => {
    setConfirmation(null);
    const previousCue = current.current.state.cues.find(cue => cue.id === id);
    if (!previousCue) return;
    const volumeOnly = Object.keys(patch).length === 1 && patch.volume !== undefined;
    const selectedTake = getSelectedAudioTake(previousCue);
    const parsed = canvasAudioCueSchema.safeParse({
      ...previousCue,
      ...patch,
      approved: volumeOnly && selectedTake?.inputKey === canvasAudioCueInputKey(previousCue) ? previousCue.approved : false,
    });
    if (!parsed.success || (patch.speakerZh?.length ?? 0) > 100) {
      setError(
        "修改超出允许范围，已保留原值。音量须为 0–1，秒数不可为负，文字不可超过字段上限。"
      );
      return;
    }
    update(previous => ({
      ...previous,
      cues: previous.cues.map(cue => (cue.id === id ? parsed.data : cue)),
    }));
  };
  const insertDialogueSound = (cue: CanvasAudioCue, tag: "[cough]" | "[gasp]") => {
    const input = dialogueInputs.current[cue.id];
    const start = input?.selectionStart ?? cue.textZh.length;
    const end = input?.selectionEnd ?? start;
    const next = cue.textZh.slice(0, start) + tag + cue.textZh.slice(end);
    if (next.length > 4000) return;
    patchCue(cue.id, { textZh: next });
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
    if (!mounted.current || current.current.block.id !== block.id) return;
    setMusicJobs(previous => Array.from(new Map([...previous, ...result.rows].map(row => [row.jobId, row])).values()));
    if (result.failed) setError("部分配乐暂时无法读取，原任务仍保留，请稍后刷新素材。");
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

  const action = async (run: () => Promise<void>) => {
    if (busyRef.current || disabled) return;
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
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const addCue = (kind: CanvasAudioCue["kind"]) => {
    if (current.current.state.cues.length >= 100) {
      setError("本段已达 100 条音轨草稿上限，原片段全部保留，未添加新片段。");
      return;
    }
    const cue = createCanvasAudioCue(kind, crypto.randomUUID());
    update(previous => ({
      ...previous,
      cues: [...previous.cues, { ...cue, voice: VOICES[0]?.id || "" }],
    }));
    setActiveCueId(cue.id);
    setVoiceCriteria({});
    setConfirmation(null);
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
    try {
      const sourceIssue = manhuaScriptCueSourceIssue(cue, expectedScriptAudio?.cues, Boolean(sourceShots?.length));
      if (sourceIssue) throw new Error(sourceIssue);
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
      setError("");
      setConfirmation({
        kind: "dialogue",
        cueId: cue.id,
        inputKey: canvasAudioCueInputKey(cue),
      });
    } catch (caught) {
      setError((caught as Error).message);
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
        const sourceIssue = manhuaScriptCueSourceIssue(
          cue,
          current.current.expectedScriptAudio?.cues,
          Boolean(current.current.sourceShots?.length),
        );
        if (sourceIssue) throw new Error(sourceIssue);
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
  const trim = (cue: CanvasAudioCue) =>
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
    });
  const selectedSource = canvasAudioMixSource(state.cues, durationSec);
  const [selectedKey, setSelectedKey] = useState("");
  useEffect(() => {
    let stopped = false;
    setSelectedKey("");
    void canvasAudioPreviewKey(selectedSource).then(key => { if (!stopped) setSelectedKey(key); })
      .catch(() => { if (!stopped) setError("音轨签名暂时不可用，未提交合听，请稍后重试。"); });
    return () => { stopped = true; };
  }, [selectedSource]);
  const createPreview = () =>
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
    });
  /**
   * 一键预混母轨：已确认的对白按秒窗原音量落位；已确认的配乐压到 PREMIX_BGM_VOLUME 并带淡入淡出，
   * 合成一条本段时长的单轨。走同一个 audio_timeline 后期任务（免费），结果不进合听预览，直接挂 master。
   */
  const createPremix = () =>
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
    });
  const selectSource = (cue: CanvasAudioCue, take: CanvasAudioTake) => {
    patchCue(cue.id, {
      source: {
        gcsUri: take.gcsUri,
        previewUrl: take.previewUrl,
        durationSec: take.durationSec,
        labelZh: cue.kind === "sfx" ? "已选音效来源" : "已选配乐原曲",
      },
      sourceStartSec: 0,
      sourceEndSec: Math.min(
        take.durationSec,
        Math.max(1, cue.endSec - cue.startSec)
      ),
    });
  };
  const musicLibraryPanel = <>
      {musicJobs.filter(job => Number.isSafeInteger(job.missingVariants) && Number(job.missingVariants) > 0).map(job => (
        <p key={job.jobId} role="status" className="text-xs text-amber-200">
          {job.titleZh}：已保留 {job.variants.length} 个版本，另有 {job.missingVariants} 个版本未交付。请保留原任务等待核对，不要重复生成。
        </p>
      ))}
      <details className="border-t border-white/15 pt-2">
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
            <textarea
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
            onClick={() =>
              void action(async () => {
                if (!Number.isInteger(musicDuration) || musicDuration < 10 || musicDuration > 360) throw new Error("原曲目标时长须为10–360整数秒。");
                const result = await services.draftMusic({
                  laneZh: "本段剧情配乐",
                  durationSec: musicDuration,
                  moods: ["蓄力", "冲突", "反转", "收束"],
                  moodArcZh: musicPrompt,
                  titleZh: "剧情配乐",
                  model: bgmModel,
                });
                setBrief({ ...result.brief, duration: musicDuration });
              })
            }
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
                <textarea
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
                onClick={() => {
                  if (
                    current.current.state.musicJobIds.length >= 100 ||
                    current.current.state.pendingOperations.length >= 100
                  ) {
                    setError(
                      "配乐记录或待处理任务已达 100 条上限，原数据保留，本次不提交。"
                    );
                    return;
                  }
                  if (!Number.isInteger(musicDuration) || musicDuration < 10 || musicDuration > 360) {
                    setError("原曲目标时长须为10–360整数秒。");
                    return;
                  }
                  setConfirmation({ kind: "bgm", brief: { ...brief, duration: musicDuration } });
                }}
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
      {modelDurationIssue ? <p role="alert" className="text-xs text-amber-200">{modelDurationIssue}</p> : null}
      {scriptTimelineOutdated ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          <span>{canRefreshScriptTimeline
            ? `当前已保存对白与原稿的台词、角色或秒轴不一致；可按 ${durationSec} 秒原稿刷新，不生成音频、不扣费。`
            : `当前已保存对白与原稿的台词、角色或秒轴不一致，但已有音色、候选、采用或在途任务；请逐句核对，系统不会覆盖已有成果。`}</span>
          {canRefreshScriptTimeline && expectedScriptAudio ? (
            <button type="button" className={buttonClass} disabled={disabled || busy} onClick={() => {
              const retained = state.cues.filter(cue => !/^script-shot-\d+-line-\d+$/.test(cue.id));
              onChange({ ...state, cues: [...expectedScriptAudio.cues, ...retained] });
            }}>按当前原稿刷新对白</button>
          ) : null}
        </div>
      ) : null}
      <details data-manhua-audio-editor open={editorOpen} onToggle={event => setEditorOpen(event.currentTarget.open)} className="rounded-xl border border-white/10 bg-black/10 p-2">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-sky-100">编辑对白、配乐与音效</summary>
      <div className="mt-2 space-y-3">
      <p className="text-xs text-amber-100">
        {canvasAudioCapabilityHint(block)}
        母轨仅用于本段正常出片，局部编辑、视频延长和试片不注入母轨；出片前仍会校验音轨采用状态、母轨版本及容量。
      </p>
      <details className="rounded-lg border border-white/10 bg-black/15 p-2">
        <summary className="cursor-pointer text-xs text-sky-100">本段剧本与对白</summary>
        <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap text-xs leading-5 text-white/70">
          {block.prompt ||
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
        {activeCue?.kind === "dialogue" && <details>
          <summary className="text-xs">声线匹配建议 · 免费规则筛选</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-xs">目录性别<select aria-label="匹配性别" className={fieldClass} value={voiceCriteria.gender || ""} onChange={event => setVoiceCriteria(prev => ({ ...prev, gender: event.target.value as CanvasVoiceMatchCriteria["gender"] || undefined }))}><option value="">不限</option><option>男</option><option>女</option><option>中性</option></select></label>
            <label className="text-xs">目录年龄<select aria-label="匹配年龄" className={fieldClass} value={voiceCriteria.ageBand || ""} onChange={event => setVoiceCriteria(prev => ({ ...prev, ageBand: event.target.value as CanvasVoiceMatchCriteria["ageBand"] || undefined }))}><option value="">不限</option><option value="child">儿童（12岁及以下）</option><option value="adult">成年（18–54岁）</option><option value="senior">年长（55岁及以上）</option></select></label>
            <label className="col-span-2 text-xs">特质或场景关键词<input aria-label="匹配特质" className={fieldClass} maxLength={80} value={voiceCriteria.traitLike || ""} onChange={event => setVoiceCriteria(prev => ({ ...prev, traitLike: event.target.value }))}/></label>
          </div>
          <p role="status" className="mt-2 text-xs text-white/65">{voiceMatch?.reasonZh}</p>
          <button type="button" className={buttonClass} disabled={disabled || busy || !voiceMatch?.voice || state.pendingOperations.some(row => row.cueId === activeCue.id)} onClick={() => { if (voiceMatch?.voice) patchCue(activeCue.id, { voice: voiceMatch.voice }); }}>应用建议音色</button>
        </details>}
        <button type="button" className={buttonClass} disabled={disabled || busy || !activeCue || state.pendingOperations.some(row => row.cueId === activeCue.id)} onClick={() => { if (!activeCue) return; if (activeCue.kind === "dialogue") prepareDialogue(activeCue); else void trim(activeCue); }}>
          {activeCue?.kind === "dialogue" ? `生成本句 · ${CANVAS_TTS_CREDITS_PER_LINE} 积分` : "只裁这一段 · 免费"}
        </button>
        <p className="text-[11px] text-white/50">仅处理上方当前音轨；对白仍须确认费用，配乐与音效仅裁切已选来源。原曲制作在下方单独确认。</p>
      </section>
      {(["dialogue", "bgm", "sfx"] as const).map(kind => <section key={kind} ref={element => { audioGroups.current[kind] = element; }} data-audio-group={kind} aria-label={{ dialogue: "角色配音编辑", bgm: "背景音乐编辑", sfx: "事件音效编辑" }[kind]} className="min-w-0 scroll-mt-4 space-y-3 rounded-xl border border-white/15 bg-black/15 p-3">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div><h3 className="text-sm font-semibold">{{ dialogue: "角色配音", bgm: "背景音乐", sfx: "事件音效" }[kind]} <span className="text-xs font-normal text-white/45">{state.cues.filter(cue => cue.kind === kind).length} {kind === "dialogue" ? "句" : kind === "bgm" ? "段" : "条"}</span></h3><p className="mt-1 text-[11px] text-white/45">{{ dialogue: "写台词、选音色，试听后逐句采用。", bgm: "选原曲、裁秒窗，控制留白与对白避让。", sfx: "为片中实际发生的动作选音效，按秒点采用。" }[kind]}</p></div>
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
      {state.cues.map((cue, index) => {
        if (cue.kind !== kind) return null;
        const pending = state.pendingOperations.some(
          row => row.cueId === cue.id
        );
        const locked = disabled || busy || pending;
        const source = sourceFor(cue);
        const reuseCandidates = findCanvasDialogueReuse(block, cue, dialogueSources);
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
              step="0.01"
              className={fieldClass}
              disabled={disabled}
              value={cue[key]}
              onChange={event =>
                patchCue(cue.id, { [key]: Number(event.target.value) })
              }
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
                <label className="block text-xs">
                  本句台词
                  <textarea
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
                <label className="block text-xs">
                  音色
                  <select
                    aria-label={`${index + 1} 音色`}
                    className={fieldClass}
                    disabled={disabled}
                    value={cue.voice}
                    onChange={event =>
                      patchCue(cue.id, { voice: event.target.value })
                    }
                  >
                    <option value="">请选择音色</option>
                    {cue.voice && !VOICES.some(voice => voice.id === cue.voice) && <option value={cue.voice}>已保存的角色音色</option>}
                    {VOICES.map(voice => (
                      <option key={voice.id} value={voice.id}>
                        {voice.label}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset className="space-y-2">
                  <legend className="text-xs">说话语气</legend>
                  <div className="flex flex-wrap gap-2">
                    {SPEECH_MOODS.map(([label, value]) => <button key={label} type="button"
                      className={buttonClass} aria-label={`${index + 1} 语气：${label}`}
                      aria-pressed={cue.emotion === value} disabled={disabled || busy || Boolean(pending)}
                      onClick={() => patchCue(cue.id, { emotion: value })}>{label}</button>)}
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
                      patchCue(cue.id, { emotion: event.target.value })
                    }
                  />
                </label>
                </details>
                <button type="button" className={buttonClass}
                  aria-label={`生成第${index + 1}句配音`}
                  disabled={disabled || busy || Boolean(pending)}
                  onClick={() => { setActiveCueId(cue.id); prepareDialogue(cue); }}>
                  生成这句配音 · {CANVAS_TTS_CREDITS_PER_LINE} 积分
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
                    {musicJobs.flatMap(job =>
                      job.variants.map(variant => {
                        const id = `${job.jobId}:${variant.index}`;
                        const duration = loadedSources[id];
                        return (
                          <div key={id} className="space-y-1">
                            <div className="text-xs">
                              {job.titleZh} · 版本 {variant.index + 1}
                            </div>
                            <CanvasAudioPlayer
                              aria-label={`${job.titleZh} 版本 ${variant.index + 1}`}
                              className="w-full h-8"
                              controls
                              preload="metadata"
                              src={variant.previewUrl}
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
                                })
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
                            src={asset.previewUrl || asset.url}
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
                              })
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
                {source && (
                  <div className="space-y-1 text-xs">
                    原曲 {source.durationSec.toFixed(2)} 秒
                    <CanvasAudioPlayer
                      className="w-full h-8"
                      controls
                      src={source.previewUrl}
                      previewVolume={cue.volume}
                      onError={event =>
                        void restoreAudio(event.currentTarget, source.gcsUri)
                      }
                      preload="none"
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {numberField("源音频裁切起点", "sourceStartSec")}
                  {numberField("源音频裁切终点", "sourceEndSec")}
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
                    <CanvasAudioPlayer controls preload="none" src={candidate.take.previewUrl} previewVolume={cue.volume} className="h-8 w-full" onError={event => void restoreAudio(event.currentTarget, candidate.take.gcsUri)} />
                    <button type="button" className={buttonClass} disabled={locked || cue.takes.length >= 100} onClick={() => {
                      if (locked || busyRef.current) return;
                      setConfirmation(null);
                      update(previous => {
                        const latest = previous.cues.find(item => item.id === cue.id);
                        if (!latest) return previous;
                        try {
                          const restored = restoreCanvasDialogueCandidate(current.current.block, latest, current.current.dialogueSources, candidate);
                          return { ...previous, previewTake: undefined, cues: previous.cues.map(item => item.id === cue.id ? restored : item) };
                        } catch (error) { setError(error instanceof Error ? error.message : "找回失败，原声仍保留。"); return previous; }
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
                    候选 {takeIndex + 1} · {take.durationSec.toFixed(2)} 秒{" "}
                    {cue.selectedTakeId === take.id && hasAdoptedManhuaAudio(cue) ? <span className="ml-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-100">已采用</span> : null}
                    {take.inputKey !== canvasAudioCueInputKey(cue)
                      ? "· 修改前版本，保留试听"
                      : ""}
                  </div>
                  <CanvasAudioPlayer
                    className="w-full h-8"
                    aria-label={`${index + 1} 候选 ${takeIndex + 1}`}
                    controls
                    src={take.previewUrl}
                    previewVolume={cue.volume}
                    onError={event =>
                      void restoreAudio(event.currentTarget, take.gcsUri)
                    }
                    preload="none"
                  />
                  <button
                    className={buttonClass}
                    disabled={
                      locked ||
                      take.inputKey !== canvasAudioCueInputKey(cue) ||
                      take.durationSec > cue.endSec - cue.startSec + 0.02
                    }
                    onClick={() =>
                      update(previous => ({
                        ...previous,
                        cues: previous.cues.map(row =>
                          row.id === cue.id
                            ? {
                                ...row,
                                selectedTakeId: take.id,
                                approved: true,
                              }
                            : row
                        ),
                      }))
                    }
                  >
                    试听后确认本段
                  </button>
                  {take.durationSec > cue.endSec - cue.startSec + 0.02 && (
                    <div className="text-xs text-amber-200">
                      <p>原声 {take.durationSec.toFixed(3)} 秒，当前窗口 {(cue.endSec - cue.startSec).toFixed(3)} 秒，还差 {(take.durationSec - (cue.endSec - cue.startSec)).toFixed(3)} 秒。保留完整原声。</p>
                      {cue.kind === "dialogue" && (() => {
                        const fit = canvasDialogueWindowFit(cue, take, state.cues, durationSec);
                        if (!fit.issue) return <button className={buttonClass} disabled={locked} onClick={() => patchCue(cue.id, { endSec: fit.endSec })}>将本句窗口延长至 {fit.endSec.toFixed(3)} 秒</button>;
                        const plan = planCanvasDialogueTiming(state.cues, cue.id, take, durationSec);
                        return <><p>{fit.issue}</p>{plan.changes.length > 0 && <details className="mt-2">
                          <summary>预览后续对白顺延</summary>
                          <table className="my-2 w-full text-left"><thead><tr><th>角色</th><th>原时间</th><th>调整后</th></tr></thead><tbody>{plan.changes.map(row => <tr key={row.id}><td>{row.labelZh}</td><td>{row.fromStart.toFixed(3)}–{row.fromEnd.toFixed(3)}</td><td>{row.startSec.toFixed(3)}–{row.endSec.toFixed(3)}</td></tr>)}</tbody></table>
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
          <p className="text-xs">
            {confirmation.kind === "resume"
              ? "恢复原单音频保存与结算，不重新配音，不重复扣费。"
              : confirmation.kind === "dialogue"
                ? `只生成当前这一句，${CANVAS_TTS_CREDITS_PER_LINE} 积分。`
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
        {onMasterTrackReady ? (
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
            void action(refreshMusic)
          }
        >
          刷新配乐素材
        </button>
      </div>
      {block.manhuaSegmentRefs?.master?.audioStudioSource && block.manhuaSegmentRefs.master.audioStudioSource !== selectedSource && <p role="alert" className="text-xs text-amber-200">当前母轨与声音配置不一致，旧版保留；请重新合听后预混。</p>}
      {state.previewTake && (
        <div className="text-xs">
          {state.previewTake.inputKey === selectedKey
            ? "秒锁合听预览（不会作为整条对白投料）"
            : "旧合听预览，当前配置已改变"}
          <CanvasAudioPlayer
            className="w-full h-8"
            controls
            src={state.previewTake.previewUrl}
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
          {error}
        </p>
      )}
      </div>
      </details>
    </section>
  );
}
