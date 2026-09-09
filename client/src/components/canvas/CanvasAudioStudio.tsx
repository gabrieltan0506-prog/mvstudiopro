import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { CanvasBlock } from "@/lib/canvasTypes";
import type { ManhuaSegmentReferenceEntry } from "@shared/manhuaSegmentReference";
import { buildPremixTimelineClips, isPremixPendingKey, PREMIX_PENDING_PREFIX } from "@/lib/manhuaPremixMaster";
import { resolveCanvasMaterialUrl } from "@/lib/omniCanvasApi";
import { compileCanvasDialogueInput } from "@shared/canvasDialogueControls";
import { canvasAudioPreviewKey, loadCanvasMusicHistory } from "@/lib/canvasAudioStudioRecovery";
import { parseManhuaClipTargetDurationSec } from "@shared/manhuaScriptWorkbench";
import { clampManhuaClipDurationSecForVideoModel } from "@shared/manhuaSeedanceLayout";
import {
  emptyCanvasAudioStudio,
  canvasAudioStudioSchema,
  createCanvasAudioCue,
  canvasAudioCueInputKey,
  getSelectedAudioTake,
  canvasAudioCueSchema,
  type CanvasAudioStudio as CanvasAudioStudioState,
  type CanvasAudioCue,
  type CanvasAudioTake,
} from "@shared/canvasAudioStudio";
import {
  CANVAS_TTS_CREDITS_PER_LINE,
  CANVAS_BGM_CREDITS_PER_RUN,
} from "@shared/canvasGenerationPricing";
import {
  buildQwenTtsVoiceId,
  QWEN_TTS_VOICE_CATALOG,
} from "@shared/qwenTtsVoiceCatalog";

const VOICES = QWEN_TTS_VOICE_CATALOG.filter(row =>
  row.lang.includes("中文")
).map(row => ({
  id: buildQwenTtsVoiceId("plus", row.suffix),
  label: `${row.nameZh} · ${row.gender} · ${row.traitZh}`,
}));
const fieldClass =
  "min-w-0 w-full rounded border border-white/15 bg-black/30 px-2 py-1.5 text-xs text-white";
const buttonClass =
  "rounded border border-white/20 px-2 py-1.5 text-xs text-white hover:bg-white/10 disabled:opacity-40";

type MusicBrief = {
  model: "suno-v5.5-beta";
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
};

type Props = {
  block: CanvasBlock;
  disabled?: boolean;
  onChange: (next: CanvasAudioStudioState) => void;
  /**
   * 一键预混母轨出好后回调：对白原音量 + BGM 压 12 dB 带淡入淡出，合成一条 ≤30 s 单轨，
   * 由上层挂到本段 manhuaSegmentRefs.master（出片时作唯一 @音频1）。不传则不显示按钮。
   */
  onMasterTrackReady?: (entry: ManhuaSegmentReferenceEntry) => void;
};


/** 生产适配器与视图分开；离线测试运行真实视图，不能触发真实付费。 */
export function CanvasAudioStudio(props: Props) {
  const utils = trpc.useUtils();
  const dialogue = trpc.canvasAudio.generateDialogue.useMutation();
  const draft = trpc.mvAnalysis.draftManhuaBgmBrief.useMutation();
  const music = trpc.mvAnalysis.queueManhuaBgm.useMutation();
  const post = trpc.mvAnalysis.queuePostProd.useMutation();
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
  };
  return <CanvasAudioStudioView {...props} services={services} />;
}

export function CanvasAudioStudioView({
  block,
  disabled = false,
  onChange,
  onMasterTrackReady,
  services,
}: Props & { services: CanvasAudioStudioServices }) {
  const state = block.audioStudio || emptyCanvasAudioStudio();
  const durationSec = clampManhuaClipDurationSecForVideoModel(
    block.videoModel,
    block.manhuaAutoSegment?.durationSec ??
      parseManhuaClipTargetDurationSec(block.prompt)
  );
  const current = useRef({ state, onChange, services, block });
  current.current = { state, onChange, services, block };
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [musicJobs, setMusicJobs] = useState<MusicJob[]>([]);
  const [musicPrompt, setMusicPrompt] = useState("");
  const [musicDuration, setMusicDuration] = useState(30);
  const [brief, setBrief] = useState<MusicBrief | null>(null);
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
        element.src = url;
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
    if (!mounted.current || current.current.block.id !== block.id) return;
    const next = fn(current.current.state);
    current.current.state = next;
    current.current.onChange(next);
  };
  const patchCue = (id: string, patch: Partial<CanvasAudioCue>) => {
    setConfirmation(null);
    const previousCue = current.current.state.cues.find(cue => cue.id === id);
    if (!previousCue) return;
    const parsed = canvasAudioCueSchema.safeParse({
      ...previousCue,
      ...patch,
      approved: false,
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
    setBrief(null);
    setError("");
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
                // 预混母轨：不当合听预览，直接挂到本段 master
                onMasterTrackReady?.({
                  url: take.previewUrl,
                  gcsUri: take.gcsUri,
                  fileName: `预混母轨-${block.id}.wav`,
                  durationSec: take.durationSec,
                  updatedAt: new Date().toISOString(),
                });
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
  const addCue = (kind: "dialogue" | "bgm") => {
    if (current.current.state.cues.length >= 100) {
      setError("本段已达 100 条音轨草稿上限，原片段全部保留，未添加新片段。");
      return;
    }
    const cue = createCanvasAudioCue(kind, crypto.randomUUID());
    update(previous => ({
      ...previous,
      cues: [...previous.cues, { ...cue, voice: VOICES[0]?.id || "" }],
    }));
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
      const requestId = crypto.randomUUID();
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
        const jobId = requestId;
        update(previous => ({
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
        }));
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
        const jobId = `bgm_${requestId.replace(/-/g, "")}`;
        update(previous => ({
          ...previous,
          musicJobIds: [...previous.musicJobIds, jobId],
          pendingOperations: [
            ...previous.pendingOperations,
            { id: jobId, kind: "bgm", inputKey: JSON.stringify(saved.brief) },
          ],
        }));
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
      if (!source) throw new Error("先选择这一段使用的配乐原曲。");
      if (
        !(
          cue.sourceStartSec >= 0 &&
          cue.sourceEndSec > cue.sourceStartSec &&
          cue.sourceEndSec <= source.durationSec + 0.02
        )
      )
        throw new Error("裁切区间必须在原曲真实时长内。");
      const inputKey = canvasAudioCueInputKey(cue);
      const result = await services.queuePost({
        action: "audio_trim",
        params: {
          audioUri: source.gcsUri,
          sourceStartSec: cue.sourceStartSec,
          sourceEndSec: cue.sourceEndSec,
          volume: cue.volume,
          fadeInSec: cue.fadeInSec,
          fadeOutSec: cue.fadeOutSec,
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
  const selectedSource = JSON.stringify(
    state.cues
      .filter(cue => cue.approved && cue.enabled !== false)
      .map(cue => [
        cue.id,
        canvasAudioCueInputKey(cue),
        cue.selectedTakeId,
        cue.startSec,
        cue.endSec,
        durationSec,
      ])
  );
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
      const clips = cues.map(cue => {
        checkWindow(cue);
        const take = getSelectedAudioTake(cue);
        if (!take || take.inputKey !== canvasAudioCueInputKey(cue))
          throw new Error("音频内容已修改，请重新试听确认。");
        if (take.durationSec > cue.endSec - cue.startSec + 0.02)
          throw new Error("对白或音乐长于秒窗，请调整结束秒；不会截断对白。");
        return {
          audioUri: take.gcsUri,
          sourceStartSec: 0,
          sourceEndSec: take.durationSec,
          startSec: cue.startSec,
          volume: 1,
          fadeInSec: 0,
          fadeOutSec: 0,
        };
      });
      const previewKey = await canvasAudioPreviewKey(selectedSource);
      canvasAudioStudioSchema.parse({ ...current.current.state, pendingOperations: [
        ...current.current.state.pendingOperations, { id: "preflight-preview", kind: "post_prod", inputKey: previewKey },
      ] });
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
      });
      const premixKey = `${PREMIX_PENDING_PREFIX}${await canvasAudioPreviewKey(selectedSource)}`;
      canvasAudioStudioSchema.parse({ ...current.current.state, pendingOperations: [
        ...current.current.state.pendingOperations, { id: "preflight-premix", kind: "post_prod", inputKey: premixKey },
      ] });
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
        labelZh: "已选配乐原曲",
      },
      sourceStartSec: 0,
      sourceEndSec: Math.min(
        take.durationSec,
        Math.max(1, cue.endSec - cue.startSec)
      ),
    });
  };
  return (
    <section
      aria-label="逐句配音与分段配乐"
      className="space-y-3 rounded-lg border border-sky-200/20 bg-slate-900/70 p-3 text-white"
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
    >
      <h3 className="text-sm font-semibold">逐句配音 · 分段配乐</h3>
      <p className="text-xs text-amber-100">
        逐段声音投料目前仅支持加长成片的多模态参考；其他引擎可制作、试听音频，但不自动用于出片。
        {block.videoModel !== "seedance-2.5"
          ? "当前引擎不支持逐段声音投料，请在生成付费音频前确认用途。"
          : ""}
      </p>
      <details open>
        <summary className="text-xs text-sky-100">先看本段剧本与对白</summary>
        <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap text-xs leading-5 text-white/70">
          {block.prompt ||
            "先在视频节点填写剧本，再逐句添加对白或逐段添加音乐。"}
        </pre>
      </details>
      <p className="text-xs text-white/60">
        本段 {durationSec} 秒，时间从本段 0
        秒开始。每次只处理一段。生成后先试听，再确认秒窗；对白独立投料，合听预览不代替口型绑定。
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className={buttonClass}
          disabled={disabled || busy}
          onClick={() => addCue("dialogue")}
        >
          添加一句对白
        </button>
        <button
          className={buttonClass}
          disabled={disabled || busy}
          onClick={() => addCue("bgm")}
        >
          添加一段配乐
        </button>
      </div>
      {state.cues.map((cue, index) => {
        const pending = state.pendingOperations.some(
          row => row.cueId === cue.id
        );
        const locked = disabled || busy || pending;
        const source = sourceFor(cue);
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
            className="space-y-2 border-t border-white/15 pt-3"
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
                {index + 1} · {cue.kind === "dialogue" ? "对白" : "配乐"}{" "}
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
                    {VOICES.map(voice => (
                      <option key={voice.id} value={voice.id}>
                        {voice.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs">
                  语气标签
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
                <button
                  className={buttonClass}
                  disabled={locked}
                  onClick={() => {
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
                      setError("");
                      setConfirmation({
                        kind: "dialogue",
                        cueId: cue.id,
                        inputKey: canvasAudioCueInputKey(cue),
                      });
                    } catch (caught) {
                      setError((caught as Error).message);
                    }
                  }}
                >
                  生成本句 · {CANVAS_TTS_CREDITS_PER_LINE} 积分
                </button>
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
                            <audio
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
                          <audio
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
                            选这条上传原曲
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
                    <audio
                      className="w-full h-8"
                      controls
                      src={source.previewUrl}
                      onError={event =>
                        void restoreAudio(event.currentTarget, source.gcsUri)
                      }
                      preload="none"
                    />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {numberField("原曲裁切起点", "sourceStartSec")}
                  {numberField("原曲裁切终点", "sourceEndSec")}
                  {numberField("音量", "volume")}
                  {numberField("淡入秒", "fadeInSec")}
                  {numberField("淡出秒", "fadeOutSec")}
                </div>
                <button
                  className={buttonClass}
                  disabled={locked}
                  onClick={() => void trim(cue)}
                >
                  只裁这一段 · 免费
                </button>
              </>
            )}
            {cue.takes
              .filter(take => take.inputKey !== "source")
              .map((take, takeIndex) => (
                <div key={take.id} className="space-y-1 rounded bg-white/5 p-2">
                  <div className="text-xs">
                    候选 {takeIndex + 1} · {take.durationSec.toFixed(2)} 秒{" "}
                    {take.inputKey !== canvasAudioCueInputKey(cue)
                      ? "· 修改前版本，保留试听"
                      : ""}
                  </div>
                  <audio
                    className="w-full h-8"
                    aria-label={`${index + 1} 候选 ${takeIndex + 1}`}
                    controls
                    src={take.previewUrl}
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
                    <p className="text-xs text-amber-200">
                      音频超出秒窗，请调整；对白不会自动截断。
                    </p>
                  )}
                </div>
              ))}
          </article>
        );
      })}
      <details className="border-t border-white/15 pt-2">
        <summary className="text-xs font-semibold">
          生成配乐原曲 · 保留所有版本
        </summary>
        <div className="mt-2 space-y-2">
          <label className="block text-xs">
            剧情与情绪推进
            <textarea
              className={fieldClass}
              aria-label="配乐剧情与情绪推进"
              rows={3}
              value={musicPrompt}
              disabled={disabled || busy}
              onChange={event => {
                setMusicPrompt(event.target.value);
                setBrief(null);
                setConfirmation(null);
              }}
            />
          </label>
          <label className="block text-xs">
            原曲目标时长
            <input
              className={fieldClass}
              type="number"
              min="1"
              max="3600"
              value={musicDuration}
              disabled={disabled || busy}
              onChange={event => {
                setMusicDuration(Number(event.target.value));
                setBrief(null);
                setConfirmation(null);
              }}
            />
          </label>
          <button
            className={buttonClass}
            disabled={disabled || busy || !musicPrompt.trim()}
            onClick={() =>
              void action(async () => {
                const result = await services.draftMusic({
                  laneZh: "本段剧情配乐",
                  durationSec: musicDuration,
                  moods: ["蓄力", "冲突", "反转", "收束"],
                  moodArcZh: musicPrompt,
                  titleZh: "剧情配乐",
                });
                setBrief(result.brief);
              })
            }
          >
            整理配乐要求 · 免费
          </button>
          {brief && (
            <>
              <label className="block text-xs">
                配乐要求
                <textarea
                  className={fieldClass}
                  value={brief.prompt}
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
                  setConfirmation({ kind: "bgm", brief });
                }}
              >
                生成这版配乐 · {CANVAS_BGM_CREDITS_PER_RUN} 积分
              </button>
            </>
          )}
        </div>
      </details>
      {confirmation && (
        <div
          role="dialog"
          aria-label="确认音频费用"
          className="space-y-2 rounded border border-amber-300/40 bg-amber-900/20 p-3"
        >
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
            state.pendingOperations.some(
              row => !row.cueId && row.kind === "post_prod"
            )
          }
          onClick={() => void createPreview()}
        >
          合听已确认秒窗 · 免费
        </button>
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
            title="对白原音量、配乐压 12 dB 带淡入淡出，合成一条本段单轨并挂为本段母轨（出片时作唯一 @音频1）。免费。"
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
      {state.previewTake && (
        <div className="text-xs">
          {state.previewTake.inputKey === selectedKey
            ? "秒锁合听预览（不会作为整条对白投料）"
            : "旧合听预览，当前配置已改变"}
          <audio
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
      {error && (
        <p role="alert" className="text-xs text-amber-200">
          {error}
        </p>
      )}
    </section>
  );
}
