import { creativeUserText } from "@/lib/creativeUserText";
import { musicMvShotSlices, musicMvHighlightSchema } from "@shared/musicMvHighlight";
import { canvasAudioMixSource } from "@shared/canvasAudioStudio";
import { canvasAudioPreviewKey } from "@/lib/canvasAudioStudioRecovery";
import { musicCandidateSourceIdentity } from "@shared/songSourceIdentity";
import { SongOperationsPanel } from "./SongOperationsPanel";
import { CanvasAudioStudio } from "./CanvasAudioStudio";
import { songAlignmentInputKey, songOperationCandidates, songOperationStemMix } from "@/lib/songOperationConsumers";
import {SongCoverPanel} from "./SongCoverPanel";
import {buildSongCoverPrompt} from "@shared/songCover";
import {CANVAS_IMAGE_CREDITS_PER_SHOT} from "@shared/canvasGenerationPricing";
import { CanvasCreativeLearning } from "./CanvasCreativeLearning";
import { resolveMusicMvMediaUrl } from "@/lib/musicMvAdvisor";
import { CanvasSunoSongAdvisor } from "./CanvasSunoSongAdvisor";
import { uploadOneCanvasAsset } from "@/lib/canvasUpload";
import { sunoSongBriefSchema } from "@shared/canvasMusicMv";
import { CanvasMvTimelineEditor } from "./CanvasMvTimelineEditor";
import { CanvasMvPostProdWorkbench } from "./CanvasMvPostProdWorkbench";
import { musicMvEditIssues, musicMvEditKey, musicMvEditMaterialGap } from "@shared/canvasMusicMvEdit";
import { CanvasMvCreativeAdvisor } from "./CanvasMvCreativeAdvisor";
import {
  rejectedMusicSubmissionPatch,
  musicMvExclusions,
  musicMvTypePatch,
  assertMusicMvVocalExclusions,
  shouldSyncMusicUploadedReferences,
} from "@/lib/canvasMusicMvGuards";
import { parseManhuaClipTargetDurationSec } from "@shared/manhuaScriptWorkbench";
import React, { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { resolveCanvasMaterialUrl } from "@/lib/omniCanvasApi";
import { pollJobUntilTerminal } from "@/lib/jobs";
import {
  invalidateMusicMvPlan,
  hasPendingMusicMvPlan,
  mergeMusicCandidates,
  selectMusicCandidateContext,
  captureMusicCandidateContexts,
  musicPlanInputKey,
  refreshMusicCandidate,
} from "@/lib/canvasMusicMvRecovery";
import {
  mvShotNeedsStagingReference,
  canvasMusicMvDraftInputSchema,
  validateCanvasMusicMvPlan,
} from "@shared/canvasMusicMv";
import {
  createMusicMvShotBlocks,
  musicMvReadyClips,
  musicMvShotRequestSec,
  musicMvSingingLyricPatch,
} from "@/lib/canvasMusicMvWorkflow";
import {
  defaultCanvasBlock,
  type CanvasBlock,
  type CanvasVideoModel,
  type CanvasEdge,
} from "@/lib/canvasTypes";
import type {
  CanvasMusicCandidate,
  CanvasMusicMvState,
} from "@shared/canvasMusicMv";
import {
  canvasVideoClipCredits,
  CANVAS_BGM_CREDITS_PER_RUN,
} from "@shared/canvasGenerationPricing";
import { CREDIT_COSTS } from "@shared/plans";
import { CanvasMvLyricTableEditor } from "./CanvasMvLyricTableEditor";
import { planMvHighlightFades } from "@shared/canvasMusicMvLyricKinds";
import { recommendMusicMvHighlight } from "@shared/musicMvHighlight";
import { CanvasMvShotReferencePicker } from "./CanvasMvShotReferencePicker";
import type { CanvasMusicMvFinalUpscale } from "@shared/canvasMusicMv";
import {
  fetchVideoUpscaleStatus,
  probeWorkflowVideoSource,
  startVideoUpscale,
  VideoUpscaleSubmitError,
} from "@/lib/videoUpscaleApi";
import {
  MV_FINAL_UPSCALE_TARGETS,
  mvFinalUpscaleBlocker,
  mvFinalUpscaleConfirmText,
  mvFinalUpscaleDownloadName,
  mvFinalUpscaleNeedsPoll,
  mvFinalUpscaleNeedsVersionBlock,
  mvFinalUpscaleQuote,
  mvFinalUpscaleScopeKey,
  mvFinalUpscaleStatusText,
  mvFinalUpscaleSupported,
  mvFinalUpscaleVersionBlockId,
  type MvUpscaleTarget,
} from "@/lib/musicMvFinalUpscale";
import {
  EMPTY_MV_SHOT_REFERENCES,
  mvShotReferenceGaps,
  mvShotReferencesSchema,
  type MvShotReferences,
} from "@shared/canvasMusicMvReferences";

type Props = {
  projectId?: string;
  /** 第 5 步后期工坊与创作顾问的账户作用域；未登录时不挂后期工坊。 */
  userId?: string;
  block: CanvasBlock;
  blocks: CanvasBlock[];
  onPatch: (patch: Partial<CanvasBlock>) => void;
  onAdd: (blocks: CanvasBlock[], edges: CanvasEdge[]) => void;
  runShot: (id: string) => Promise<boolean | undefined>;
  getBlocks: () => CanvasBlock[];
  /** 1109：把参考槽位同步到已铺的镜头块（出片真源是镜头块 musicMvShot.references）。 */
  onPatchBlock?: (id: string, patch: Partial<CanvasBlock>) => void;
  /** 1109 模型可选：漫剧同一模型表经 filterCanvasVideoModelOptions（会员闸门）再筛 MV 可用引擎。 */
  videoModelOptions?: Array<{ id: CanvasVideoModel; label: string }>;
};
const field = "w-full rounded border border-white/20 bg-black/30 p-1.5 text-xs";
const button =
  "rounded border border-white/20 px-2 py-1.5 text-xs disabled:opacity-40";

function audioDuration(url: string, kind: "audio" | "video" = "audio"): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = kind === "video" ? document.createElement("video") : new Audio();
    const timer = window.setTimeout(
      () => done(new Error("未能读取音乐实际时长")),
      20000
    );
    const done = (error?: Error) => {
      window.clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      const duration = audio.duration;
      audio.removeAttribute("src");
      audio.load();
      if (error || !Number.isFinite(duration) || duration <= 0)
        reject(error || new Error("音频时长无效"));
      else resolve(duration);
    };
    audio.onloadedmetadata = () => done();
    audio.onerror = () => done(new Error("音乐无法读取，请重新选择音频"));
    audio.preload = "metadata";
    audio.src = url;
  });
}

/** 每个阶段先保存请求身份；刷新只查原任务，下一付费阶段由明确按钮启动。 */
export function CanvasMusicMvStudio({
  block,
  blocks,
  projectId,
  userId,
  onPatch,
  onAdd,
  runShot,
  getBlocks,
  onPatchBlock,
  videoModelOptions,
}: Props) {
  const state = block.musicMv || { status: "idle", candidates: [] };
  const latest = useRef(state);
  latest.current = state;
  const currentBlock = useRef(block);
  currentBlock.current = block;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const songOnly = state.deliveryMode === "song";
  const highlightMode = state.deliveryMode === "highlight";
  const coverAspect = state.deliveryMode ? "1:1" as const : "9:16" as const;
  const lock = useRef(false);
  const studio = useRef<HTMLDivElement>(null);
  const highlightAudio = useRef<HTMLAudioElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [history, setHistory] = useState<
    Array<{ jobId: string; titleZh: string }>
  >([]);
  const utils = trpc.useUtils();
  const songPrepare = trpc.songOperations.prepare.useMutation();
  const songSubmit = trpc.songOperations.submit.useMutation();
  const songResume = trpc.songOperations.resume.useMutation();
  const music = trpc.mvAnalysis.queueManhuaBgm.useMutation();
  const upload = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();
  const plan = trpc.canvasMusicMv.draftPlan.useMutation();
  const recognizeLyrics = trpc.canvasMusicMv.recognizeLyrics.useMutation({ retry: false });
  const reviseForLyrics = trpc.canvasMusicMv.reviseForLyrics.useMutation({ retry: false });
  const assemble = trpc.canvasMusicMvAssemble.queue.useMutation();
  const patch = (
    delta: Partial<CanvasMusicMvState>,
    extra: Partial<CanvasBlock> = {}
  ) => {
    if (!alive.current) return;
    latest.current = { ...latest.current, ...delta };
    onPatch({ ...extra, musicMv: latest.current });
  };
  const perform = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    const startedInputKey = musicPlanInputKey(
      latest.current,
      currentBlock.current.prompt
    );
    try {
      await work();
    } catch (error) {
      if (
        startedInputKey ===
        musicPlanInputKey(latest.current, currentBlock.current.prompt)
      )
        patch({
          error:
            error instanceof Error
              ? error.message
              : "操作未能确认，请查询原任务",
        });
    } finally {
      lock.current = false;
      if (alive.current) {
        setBusy(false);
        setProgress("");
      }
    }
  };
  const selected = state.candidates.find(
    row => row.id === state.selectedCandidateId
  );
  const pendingPlan = hasPendingMusicMvPlan(state);
  const importJob = async (jobId: string) => {
    const previous = latest.current;
    if (
      previous.musicJobId &&
      previous.musicJobId !== jobId &&
      !["succeeded", "failed", "cancelled"].includes(
        previous.musicJobStatus || ""
      )
    ) {
      throw new Error("请先查询当前音乐任务，确认结束后再导入另一任务");
    }
    patch({ musicJobId: jobId });
    const current = () => alive.current && latest.current.musicJobId === jobId;
    const job = await utils.mvAnalysis.getManhuaBgmJob.fetch({ jobId });
    if (!current()) return;
    if (job.status !== "succeeded") {
      patch({ musicJobStatus: job.status });
      if (job.status === "failed" || job.status === "cancelled")
        patch({
          status: "error",
          error: job.error || "音乐生成未成功，原任务已保留",
        });
      else setProgress(`音乐任务：${job.status}`);
      return;
    }
    const results = await Promise.allSettled(
      job.variants.map(async variant => {
        const url = await resolveCanvasMaterialUrl(variant.gcsUri);
        const durationSec =
          variant.durationSec &&
          Number.isFinite(variant.durationSec) &&
          variant.durationSec > 0
            ? variant.durationSec
            : await audioDuration(url);
        return {
          id: `${job.jobId}:${variant.index}`,
          ...musicCandidateSourceIdentity(job.jobId, variant),
          url,
          gcsUri: variant.gcsUri,
          durationSec,
          title: `${job.titleZh} · 版本 ${variant.index + 1}`,
        };
      })
    );
    if (!current()) return;
    const candidates = results.flatMap(result =>
      result.status === "fulfilled" ? [result.value] : []
    );
    const all = mergeMusicCandidates(latest.current.candidates, candidates);
    const pending =
      results.some(result => result.status === "rejected") ||
      !candidates.length;
    patch(
      {
        candidates: all,
        candidateContexts: captureMusicCandidateContexts(
          latest.current,
          job.jobId,
          candidates.map(c => c.id)
        ),
        musicJobStatus: pending ? "media_pending" : "succeeded",
        missingVariants: Math.max(0, Number(job.missingVariants) || 0),
        status: latest.current.plan
          ? latest.current.finalBlockId
            ? "done"
            : "planned"
          : all.length
            ? "music_ready"
            : "error",
        error: pending
          ? "部分音乐尚未恢复播放，请查询原音乐任务；已恢复候选和全部历史均已保留"
          : undefined,
      },
      { outputUrls: all.map(row => row.url) }
    );
  };
  useEffect(() => {
    if (
      !state.musicJobId ||
      ["succeeded", "failed", "cancelled"].includes(state.musicJobStatus || "")
    )
      return;
    const check = () => {
      if (!lock.current) void perform(() => importJob(state.musicJobId!));
    };
    check();
    const timer = window.setInterval(check, 10000);
    return () => window.clearInterval(timer);
  }, [state.musicJobId, state.musicJobStatus]);
  const choose = (candidate: CanvasMusicCandidate) =>
    perform(async () => {
      if (
        latest.current.planRequestId &&
        !latest.current.plan &&
        !latest.current.planTerminalStatus
      )
        throw new Error("请先查询原分镜结果，再切换歌曲");
      const previousSelection = latest.current.selectedCandidateId;
      const fresh = await refreshMusicCandidate(
        candidate,
        resolveCanvasMaterialUrl
      );
      if (
        !alive.current ||
        latest.current.selectedCandidateId !== previousSelection ||
        !latest.current.candidates.some(row => row.id === candidate.id)
      )
        return;
      patch(
        {
          ...invalidateMusicMvPlan(latest.current),
          candidates: mergeMusicCandidates(latest.current.candidates, [fresh]),
          ...selectMusicCandidateContext(latest.current, fresh.id),
          selectedCandidateId: fresh.id,
          highlight: undefined,
          status: "music_ready",
        },
        { outputUrl: fresh.url }
      );
    });
  const generate = () =>
    perform(async () => {
      const source = latest.current;
      if (!block.prompt.trim())
        throw new Error("请先填写音乐风格、乐器和情绪要求");
      if ((source.lyrics || "").length > 5000)
        throw new Error("本次歌曲歌词最多 5000 字，请精简后再生成");
      if (source.musicRequestId)
        throw new Error(
          "本次音乐已有提交编号，请查询原任务；重新创作请先点击新一轮音乐"
        );
      const instrumental = source.instrumental !== false;
      assertMusicMvVocalExclusions(source);
      if (!instrumental && !source.lyrics?.trim())
        throw new Error("歌曲需要填写完整歌词");
      const duration = source.requestedDurationSec ?? 200;
      if (!Number.isFinite(duration) || duration < 10 || duration > 360)
        throw new Error("目标时长须为 10 至 360 秒");
      const brief = sunoSongBriefSchema.parse({
        model: "suno-v6",
        custom_mode: true,
        instrumental,
        style: currentBlock.current.prompt,
        prompt:
          source.lyrics?.trim() ||
          (instrumental ? currentBlock.current.prompt : ""),
        title: source.songTitle?.trim() || "画布音乐",
        duration: Math.round(duration),
        negative_tags: musicMvExclusions(source),
        style_weight: source.songStyleWeight ?? 0.78,
        weirdness_constraint: source.songWeirdness ?? 0.25,
      });
      const requestId = crypto.randomUUID();
      const jobId = `bgm_${requestId.replace(/-/g, "")}`;
      patch({
        musicRequestId: requestId,
        musicSubmission: brief,
        songCovers: [...(source.songCovers || []), {musicJobId:jobId,prompt:buildSongCoverPrompt(brief,coverAspect),aspectRatio:coverAspect,status:"waiting_music"}],
        lyricsCandidateId: undefined,
        musicSubmissionDirection: source.creativePrompt || "",
        musicJobId: jobId,
        musicJobStatus: "queued",
        missingVariants: undefined,
        status: "music_running",
        error: undefined,
      });
      try {
        await music.mutateAsync({
          billingRequestId: requestId,
          brief,
        });
      } catch (error) {
        const rejected = rejectedMusicSubmissionPatch(
          latest.current,
          requestId,
          error
        );
        if (rejected && alive.current) {
          patch({...rejected,songCovers:(latest.current.songCovers||[]).map(row=>row.musicJobId===jobId?{...row,status:"failed" as const,error:"歌曲未提交成功，封面未生成"}:row)});
          throw new Error(rejected.error || "音乐请求未创建，请稍后重新提交");
        }
        throw error;
      }
      if (alive.current && latest.current.musicRequestId === requestId)
        await importJob(jobId);
    });
  const references =
    state.referenceImages ||
    (block.uploadedAssets || []).filter(row => row.kind === "image");
  const uploadedReferenceKey = JSON.stringify(
    (block.uploadedAssets || [])
      .filter(row => row.kind === "image")
      .map(row => [row.id, row.gcsUri || row.url])
  );
  const previousUploadedReferenceCount = useRef<number | null>(null);
  useEffect(() => {
    const uploaded = (block.uploadedAssets || []).filter(
      row => row.kind === "image"
    );
    if (
      latest.current.planRequestId &&
      !latest.current.plan &&
      !latest.current.planTerminalStatus
    )
      return;
    const shouldSync = shouldSyncMusicUploadedReferences(
      previousUploadedReferenceCount.current,
      uploaded.length
    );
    previousUploadedReferenceCount.current = uploaded.length;
    if (!shouldSync) return;
    const referenceImages = uploaded.map(row => ({
      id: row.id,
      url: row.url,
      gcsUri: row.gcsUri,
      fileName: row.fileName || row.id,
    }));
    if (
      JSON.stringify(referenceImages) ===
      JSON.stringify(latest.current.referenceImages)
    )
      return;
    patch({ ...invalidateMusicMvPlan(latest.current), referenceImages });
  }, [uploadedReferenceKey, pendingPlan]);
  const draft = () =>
    perform(async () => {
      const source = latest.current;
      const song = source.candidates.find(
        row => row.id === source.selectedCandidateId
      );
      if (!song) throw new Error("请先选择一版音乐");
      if (source.plan && source.planRequestId) return;
      const inputKey = musicPlanInputKey(source, currentBlock.current.prompt);
      let input = source.planInput;
      if (source.planRequestId) {
        if (!input || input.requestId !== source.planRequestId)
          throw new Error(
            "原分镜缺少请求快照，不能用不同内容重发；请先查询原请求"
          );
      } else {
        const audio = await refreshMusicCandidate(
          song,
          resolveCanvasMaterialUrl
        );
        if (
          !alive.current ||
          musicPlanInputKey(latest.current, currentBlock.current.prompt) !==
            inputKey
        )
          return;
        input = canvasMusicMvDraftInputSchema.parse({
          requestId: crypto.randomUUID(),
          audio,
          lyrics: source.lyrics || "",
          creativePrompt: source.creativePrompt || currentBlock.current.prompt,
          referenceSummaries: (source.referenceImages || references).map(
            row => row.fileName || row.id
          ),
        });
        patch({
          planRequestId: input.requestId,
          planInput: input,
          planTerminalStatus: undefined,
          status: "planning",
          error: undefined,
        });
      }
      const request = input!;
      const result = await plan.mutateAsync(request);
      if (
        !alive.current ||
        latest.current.planRequestId !== request.requestId ||
        musicPlanInputKey(latest.current, currentBlock.current.prompt) !==
          inputKey
      )
        return;
      patch({
        plan: validateCanvasMusicMvPlan(result.plan, request),
        status: "planned",
        error: undefined,
      });
    });
  const referenceInputKey = musicPlanInputKey(state, block.prompt);
  useEffect(() => {
    if (!latest.current.planInput || !latest.current.planRequestId) return;
    // 外层提示词、云同步或其他入口更新也不能使未知付费请求丢失身份。
    if (hasPendingMusicMvPlan(latest.current)) return;
    const expected = latest.current.planInput;
    if (
      expected.lyrics !== (latest.current.lyrics || "") ||
      expected.creativePrompt !==
        (latest.current.creativePrompt || block.prompt)
    )
      patch(invalidateMusicMvPlan(latest.current));
  }, [referenceInputKey]);
  useEffect(() => {
    if (!state.planRequestId || state.plan || state.planTerminalStatus) return;
    const requestId = state.planRequestId;
    let stopped = false;
    const check = async () => {
      try {
        const result = await utils.canvasMusicMv.getPlan.fetch({ requestId });
        if (
          stopped ||
          !alive.current ||
          latest.current.planRequestId !== requestId
        )
          return;
        if (result.status === "succeeded" && latest.current.planInput)
          patch({
            plan: validateCanvasMusicMvPlan(
              result.plan,
              latest.current.planInput
            ),
            status: "planned",
            error: undefined,
          });
        else if (result.status === "failed")
          patch({
            status: "error",
            planTerminalStatus: "failed",
            error: "原分镜已确认未交付，证据保留；可主动开始新一轮分镜",
          });
      } catch (error) {
        if (
          !stopped &&
          alive.current &&
          latest.current.planRequestId === requestId
        )
          patch({
            error: error instanceof Error ? error.message : "原分镜查询失败",
          });
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 10000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [state.planRequestId, state.plan, state.planTerminalStatus]);
  const previewIdentityKey = JSON.stringify(
    state.candidates.map(row => [row.id, row.gcsUri])
  );
  useEffect(() => {
    let stopped = false;
    void Promise.allSettled(
      state.candidates.map(row =>
        refreshMusicCandidate(row, resolveCanvasMaterialUrl)
      )
    ).then(results => {
      if (stopped || !alive.current || !results.length) return;
      const fresh = results.flatMap(result =>
        result.status === "fulfilled" ? [result.value] : []
      );
      const candidates = mergeMusicCandidates(
        latest.current.candidates,
        fresh.filter(row =>
          latest.current.candidates.some(old => old.id === row.id)
        )
      );
      const chosen = candidates.find(
        row => row.id === latest.current.selectedCandidateId
      );
      patch(
        {
          candidates,
          ...(results.some(result => result.status === "rejected")
            ? { error: "部分试听地址续期失败，请查询原音乐任务" }
            : {}),
        },
        {
          outputUrls: candidates.map(row => row.url),
          ...(chosen ? { outputUrl: chosen.url } : {}),
        }
      );
    });
    return () => {
      stopped = true;
    };
  }, [previewIdentityKey]);
  const layOut = () =>
    perform(async () => {
      if (!state.plan || !state.planRequestId) throw new Error("请先生成分镜");
      if (state.shotBlockIds?.length) return;
      const refs = await Promise.all(
        references.map(async row => ({
          ...row,
          url: row.gcsUri
            ? await resolveCanvasMaterialUrl(row.gcsUri)
            : row.url,
        }))
      );
      const shots = createMusicMvShotBlocks(
        block,
        state.plan,
        state.planRequestId,
        refs,
        selected,
        effectiveShotReferences(latest.current),
        latest.current.lyricTable
      );
      for (const shot of shots)
        if (shot.musicMvShot?.kind === "footage" && shot.outputUrl) {
          shot.outputUrl = await resolveMusicMvMediaUrl(shot.outputUrl);
          shot.outputUrls = [shot.outputUrl];
        }
      if (
        !alive.current ||
        latest.current.planRequestId !== state.planRequestId
      )
        return;
      onAdd(
        shots,
        shots.map(row => ({ fromId: block.id, toId: row.id }))
      );
      patch({ shotBlockIds: shots.map(row => row.id), error: undefined });
    });
  const highlightRange = (source: CanvasMusicMvState) => {
    if (source.deliveryMode !== "highlight") return undefined;
    const song = source.candidates.find(row => row.id === source.selectedCandidateId);
    if (!song) throw new Error("请先选定歌曲");
    const parsed = musicMvHighlightSchema.safeParse(source.highlight || {startSec:0,endSec:Math.min(45,song.durationSec)});
    if (!parsed.success) throw new Error("高光MV须为30至60秒，请选择足够长的歌曲并调整区间");
    if (parsed.data.endSec > song.durationSec) throw new Error("高光区间超出所选歌曲");
    return parsed.data;
  };
  const activeShotIds = (source: CanvasMusicMvState) => {
    if (source.deliveryMode !== "highlight") return source.shotBlockIds || [];
    if (!source.plan) return [];
    const wanted = new Set(musicMvShotSlices(source.plan, highlightRange(source)).map(row=>row.shot.id));
    return (source.shotBlockIds || []).filter(id => wanted.has(getBlocks().find(row=>row.id === id)?.musicMvShot?.shotId || ""));
  };
  /** 每镜有效参考 = 本镜槽位 + 未单独设定时继承全片主锚图。 */
  const effectiveShotReferences = (source: CanvasMusicMvState): Record<string, MvShotReferences> => {
    const out: Record<string, MvShotReferences> = {};
    for (const shot of source.plan?.shots || []) {
      const own = source.shotReferences?.[shot.id];
      if (!own && !source.anchorImage) continue;
      out[shot.id] = mvShotReferencesSchema.parse({
        ...EMPTY_MV_SHOT_REFERENCES,
        ...(own || {}),
        ...(!own?.anchorImage && source.anchorImage ? { anchorImage: source.anchorImage } : {}),
      });
    }
    return out;
  };
  /** 参考变更：写入音乐块状态，并同步到已铺镜头块（出片读镜头块）。已出片镜头不改。 */
  const updateReferences = (next: { anchorImage?: CanvasMusicMvState["anchorImage"]; shotReferences: Record<string, MvShotReferences> }) => {
    patch({ anchorImage: next.anchorImage, shotReferences: next.shotReferences });
    const effective = effectiveShotReferences(latest.current);
    for (const id of latest.current.shotBlockIds || []) {
      const shotBlock = getBlocks().find(row => row.id === id);
      const binding = shotBlock?.musicMvShot;
      if (!shotBlock || !binding || binding.kind === "footage") continue;
      if (shotBlock.status === "running" || (shotBlock.videoTaskId && shotBlock.videoTaskStatus !== "failed")) continue;
      const refs = effective[binding.shotId];
      if (!refs) continue;
      const gaps = mvShotReferenceGaps(refs, shotBlock.videoModel, { requiresStaging: mvShotNeedsStagingReference(binding.complexity) }).blocking;
      onPatchBlock?.(id, {
        musicMvShot: { ...binding, references: refs },
        seedance25WorkMode: "reference_to_video",
        error: gaps.length ? `参考素材不完整：${gaps.map(g => g.messageZh).join("；")}` : undefined,
      });
    }
  };
  const render = () =>
    perform(async () => {
      const ids = activeShotIds(latest.current);
      if (!ids.length) throw new Error("请先确认分镜并铺设镜头");
      // 1109 硬规则：整批先核参考，任一镜缺项即全部不发（无参考不得退回文生）。
      const gapLines: string[] = [];
      ids.forEach((id, i) => {
        const shotBlock = getBlocks().find(row => row.id === id);
        const binding = shotBlock?.musicMvShot;
        if (!shotBlock || !binding || binding.kind === "footage" || (shotBlock.status === "done" && shotBlock.outputUrl)) return;
        // 吟唱段不生成：按顾问建议选素材合成（素材填充），未合成前整批拦
        if (binding.fillRequested) { gapLines.push(`镜头 ${i + 1}：吟唱段走素材填充，请在「为镜头选参考素材」里按建议选素材并合成`); return; }
        if (!binding.references) {
          if (!binding.referenceImages.length) gapLines.push(`镜头 ${i + 1}：未选参考素材`);
          return;
        }
        // 超长参考片出片时自动裁切（canvasRunBlock），这里不因「超长」拦
        const gaps = mvShotReferenceGaps(binding.references, shotBlock.videoModel, { requiresStaging: mvShotNeedsStagingReference(binding.complexity) }).blocking.filter(g => !/尚未自动裁切/.test(g.messageZh));
        if (gaps.length) gapLines.push(`镜头 ${i + 1}：${gaps.map(g => g.messageZh).join("、")}`);
        // 演唱段只读用户确认版歌词时间表；未确认不得生成（非演唱段不受影响）
        if (binding.kind === "singing" && (latest.current.lyricTable?.status !== "confirmed" || !binding.lyricLines?.length))
          gapLines.push(`镜头 ${i + 1}：演唱段，先确认本段歌词`);
      });
      if (gapLines.length) throw new Error(`请先为镜头选参考素材，本次未提交、未扣费。${gapLines.join("；")}`);
      patch({ status: "rendering", error: undefined });
      for (let i = 0; i < ids.length; i++) {
        if (
          !alive.current ||
          latest.current.planRequestId !== state.planRequestId
        )
          return;
        const shot = getBlocks().find(row => row.id === ids[i]);
        if (!shot) throw new Error(`镜头 ${i + 1} 已移除，请重新确认`);
        if (shot.status === "done" && shot.outputUrl) continue;
        if (
          (shot.videoTaskId && shot.videoTaskStatus !== "failed") ||
          shot.status === "running"
        )
          throw new Error(`镜头 ${i + 1} 已有任务，请先查询原镜头结果，未重提`);
        setProgress(
          `正在制作 ${i + 1}/${ids.length}（${Math.round((i / ids.length) * 100)}%）`
        );
        const succeeded = await runShot(shot.id);
        if (!succeeded)
          throw new Error(`镜头 ${i + 1} 尚未确认成功，已停止后续提交`);
      }
      patch({ status: "planned" });
    });
  const finish = (newVersion = false) =>
    perform(async () => {
      const source = latest.current;
      if (newVersion && !source.assembleTerminalStatus)
        throw new Error("原合成尚无明确终态，请先查询原任务，未提交新版本");
      if (!newVersion && source.assembleTerminalStatus && source.assembleInput && songAlignmentInputKey(source.selectedCandidateId, source.songAlignment) !== songAlignmentInputKey(source.assembleInput.audio.id, source.assembleInput.alignmentRequestId ? {sourceId:source.assembleInput.audio.id,requestId:source.assembleInput.alignmentRequestId} : undefined)) throw new Error("歌词字幕已变更，请点击合成新版本；原成片保留");
      let submission = newVersion ? undefined : source.assembleInput;
      if (!submission) {
        if (!newVersion && source.assembleRequestId)
          throw new Error("原合成缺少输入快照，请查询已保存任务，未重新提交");
        const song = source.candidates.find(
          row => row.id === source.selectedCandidateId
        );
        if (!song || !source.plan || !source.planRequestId)
          throw new Error("缺少已选择的歌曲或分镜");
        const range = highlightRange(source);
        const edit = range ? undefined : source.timelineEdits?.find(
          e => e.draft.basePlanRequestId === source.planRequestId
        );
        if (edit) {
          if (
            !edit.saved ||
            musicMvEditKey(edit.saved.document) !== musicMvEditKey(edit.draft)
          )
            throw new Error("请先保存当前剪辑版本");
          const issues = musicMvEditIssues(edit.draft, source.plan);
          if (issues.length) throw new Error(issues.join("；"));
        }
        const clips = edit
          ? edit.draft.clips.map(c => ({
              shotId: c.id,
              url: c.source!.url,
              taskId: c.source!.taskId,
            }))
          : musicMvReadyClips(
              source.plan,
              activeShotIds(source),
              getBlocks(),
              range
            );
        submission = {
          requestId: crypto.randomUUID(),
          highlight: range,
          planRequestId: source.planRequestId,
          editRevisionId: edit?.saved?.revisionId,
          audio: song,
          alignmentRequestId: source.songAlignment?.sourceId === song.id ? source.songAlignment.requestId : undefined,
          plan: source.plan,
          clips,
          resolution: range ? "9:16" : block.aspectRatio === "9:16" ? "9:16" : "16:9",
          // 1109 高光结尾必须淡出（对齐拍点/句尾），起点落在句中做短淡入；用户可调
          ...(range ? (() => {
            const f = planMvHighlightFades({ range, lines: source.lyricTable?.lines, beatGrid: source.plan.beatGrid, fadeInSec: source.highlightFadeInSec, fadeOutSec: source.highlightFadeOutSec });
            return { ...(f.fadeInSec > 0 ? { videoFadeInSec: f.fadeInSec } : {}), ...(f.fadeOutSec > 0 ? { videoFadeOutSec: f.fadeOutSec } : {}) };
          })() : {}),
        };
        patch({
          assembleRequestId: submission.requestId,
          assembleInput: submission,
          assembleJobId: undefined,
          assembleTerminalStatus: undefined,
          finalBlockId: undefined,
          assembleHistory:
            newVersion &&
            source.assembleRequestId &&
            source.assembleTerminalStatus
              ? [
                  ...(source.assembleHistory || []),
                  {
                    requestId: source.assembleRequestId,
                    jobId: source.assembleJobId,
                    status: source.assembleTerminalStatus,
                    input: source.assembleInput,
                    finalBlockId: source.finalBlockId,
                  },
                ]
              : source.assembleHistory,
          status: "assembling",
          error: undefined,
        });
      }
      const request = submission;
      const identityCurrent = () =>
        alive.current && latest.current.assembleRequestId === request.requestId;
      // 已收到任务号时仅查询，画布改稿也不重建原合成。
      const jobId =
        (!newVersion && source.assembleJobId) ||
        (await assemble.mutateAsync(request)).jobId;
      if (identityCurrent())
        patch({ assembleJobId: jobId, status: "assembling" });
      const job = await pollJobUntilTerminal(jobId, {
        maxWaitMs: 18 * 60_000,
        intervalMs: 3000,
        onPoll: tick => {
          if (identityCurrent()) setProgress(`合成：${tick.status}`);
        },
      });
      if (job.status !== "succeeded") {
        if (identityCurrent())
          patch({
            status: "error",
            assembleTerminalStatus:
              job.status === "failed" ? "failed" : undefined,
          });
        throw new Error(job.error || "合成未成功，请查看原任务");
      }
      if (identityCurrent()) patch({ assembleTerminalStatus: "succeeded" });
      const output = job.output as { finalVideoUrl?: string };
      if (!output?.finalVideoUrl) throw new Error("合成缺少可播放地址");
      if (!alive.current) return;
      const final = defaultCanvasBlock(
        "video",
        block.x + block.width + 60,
        block.y - 540,
        block.id
      );
      final.id = `mvfinal-${block.id}-${request.requestId}`;
      final.prompt = request.highlight ? `抖音高光MV · ${request.highlight.startSec}–${request.highlight.endSec}秒 · 原歌速度` : "完整 MV · 采用所选歌曲原音轨";
      final.status = "done";
      final.outputUrl = output.finalVideoUrl;
      final.outputUrls = [output.finalVideoUrl];
      final.aspectRatio = request.resolution;
      onAdd(
        [final],
        [...(source.shotBlockIds || []), block.id].map(id => ({
          fromId: id,
          toId: final.id,
        }))
      );
      if (identityCurrent())
        patch({ finalBlockId: final.id, status: "done", error: undefined });
    });
  /** 1109 成片超分：只改本记录，其他字段以 latest 为准，避免轮询与按钮并发互相覆盖。 */
  const patchUpscale = (id: string, delta: Partial<CanvasMusicMvFinalUpscale>) =>
    patch({
      finalUpscales: (latest.current.finalUpscales || []).map(r =>
        r.id === id ? { ...r, ...delta } : r
      ),
    });
  const finalBlock = state.finalBlockId
    ? blocks.find(b => b.id === state.finalBlockId)
    : undefined;
  const finalSource = String(finalBlock?.outputUrl || "").trim();
  const upscaleFinal = (target: MvUpscaleTarget) =>
    perform(async () => {
      const finalId = latest.current.finalBlockId;
      const fb = finalId ? getBlocks().find(b => b.id === finalId) : undefined;
      const src = String(fb?.outputUrl || "").trim();
      if (!finalId || !/^https:\/\//i.test(src))
        throw new Error("请先完成合成成片再超分");
      const blocker = mvFinalUpscaleBlocker(latest.current.finalUpscales, finalId, target);
      if (blocker) throw new Error(blocker);
      setProgress("读取成片实测规格…");
      const meta = await probeWorkflowVideoSource(src);
      if (!mvFinalUpscaleSupported(meta.sourceResolution, target))
        throw new Error(
          meta.sourceResolution === "480p"
            ? "该成片最高可超分到 2K"
            : "该成片已达到目标档位，无需超分"
        );
      const credits = mvFinalUpscaleQuote(target, meta.durationSec);
      if (
        !window.confirm(
          mvFinalUpscaleConfirmText({ target, width: meta.width, height: meta.height, durationSec: meta.durationSec, credits })
        )
      )
        return;
      // 提交结果未确认的旧记录复用同一条（服务端同源同档幂等），不另起记录。
      const unknown = (latest.current.finalUpscales || []).find(
        r => r.finalBlockId === finalId && r.target === target && r.status === "submission_unknown"
      );
      const record: CanvasMusicMvFinalUpscale = {
        id: unknown?.id || crypto.randomUUID(),
        finalBlockId: finalId,
        sourceUrl: src,
        target,
        status: "submitting",
        durationSec: meta.durationSec,
        width: meta.width,
        height: meta.height,
        creditsQuoted: credits,
      };
      patch({
        finalUpscales: [
          ...(latest.current.finalUpscales || []).filter(r => r.id !== record.id),
          record,
        ],
      });
      try {
        const started = await startVideoUpscale({
          videoUrl: src,
          target,
          durationSec: meta.durationSec,
          sourceResolution: meta.sourceResolution,
          scopeKey: mvFinalUpscaleScopeKey(block.id, finalId, target),
        });
        patchUpscale(record.id, {
          taskId: started.taskId,
          status: started.status === "succeeded" ? "running" : started.status,
          creditsUsed: started.creditsUsed,
          error: undefined,
        });
        setProgress(`${target.toUpperCase()} 超分已提交`);
      } catch (e) {
        if (e instanceof VideoUpscaleSubmitError && e.definitelyNotStarted) {
          patch({ finalUpscales: (latest.current.finalUpscales || []).filter(r => r.id !== record.id) });
        } else {
          patchUpscale(record.id, {
            status: "submission_unknown",
            error: e instanceof Error ? e.message : "提交结果未确认",
          });
        }
        throw e;
      }
    });
  // 超分任务轮询（刷新恢复：记录随 MV 块持久化，挂载即接管）；成功后把结果挂成成片旁的新版本块。
  const upscalePollKey = (state.finalUpscales || [])
    .filter(mvFinalUpscaleNeedsPoll)
    .map(r => `${r.id}:${r.taskId}`)
    .join(",");
  useEffect(() => {
    if (!upscalePollKey) return;
    let cancelled = false;
    const tick = async () => {
      for (const r of (latest.current.finalUpscales || []).filter(mvFinalUpscaleNeedsPoll)) {
        try {
          const snap = await fetchVideoUpscaleStatus(r.taskId!);
          if (cancelled || !alive.current) return;
          patchUpscale(r.id, {
            status: snap.status === "succeeded" && !snap.videoUrl ? "running" : snap.status,
            ...(snap.videoUrl ? { videoUrl: snap.videoUrl } : {}),
            ...(snap.creditsUsed ? { creditsUsed: snap.creditsUsed } : {}),
            error: snap.status === "failed" ? snap.error : undefined,
          });
        } catch {
          // 查询失败按瞬态处理，下一轮再查；终态只信服务端
        }
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upscalePollKey]);
  const versionKey = (state.finalUpscales || [])
    .filter(mvFinalUpscaleNeedsVersionBlock)
    .map(r => r.id)
    .join(",");
  useEffect(() => {
    if (!versionKey) return;
    for (const r of (latest.current.finalUpscales || []).filter(mvFinalUpscaleNeedsVersionBlock)) {
      const source = getBlocks().find(b => b.id === r.finalBlockId);
      const id = mvFinalUpscaleVersionBlockId(r.finalBlockId, r);
      if (!getBlocks().some(b => b.id === id)) {
        const anchorBlock = source || block;
        const version = defaultCanvasBlock(
          "video",
          anchorBlock.x + (r.target === "4k" ? anchorBlock.width + 60 : 0),
          anchorBlock.y + anchorBlock.height + 60,
          anchorBlock.id
        );
        version.id = id;
        version.prompt = `${source?.prompt || "MV 成片"} · ${r.target.toUpperCase()} 超分版`;
        version.status = "done";
        version.outputUrl = r.videoUrl;
        version.outputUrls = [r.videoUrl!];
        version.aspectRatio = source?.aspectRatio || version.aspectRatio;
        onAdd([version], source ? [{ fromId: source.id, toId: id }] : []);
      }
      patchUpscale(r.id, { versionBlockId: id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionKey]);
  /** 歌词表变化 → 未出片的演唱镜同步唱句（只有确认版会写入；改动后回到待确认即清空，出片前拦）。 */
  const syncSingingLyrics = (table: CanvasMusicMvState["lyricTable"]) => {
    for (const id of latest.current.shotBlockIds || []) {
      const shot = getBlocks().find(row => row.id === id);
      const binding = shot?.musicMvShot;
      if (!shot || !binding || binding.kind !== "singing" || (shot.status === "done" && shot.outputUrl)) continue;
      const { lyricLines: _l, lyricTiming: _t, ...rest } = binding;
      onPatchBlock?.(id, { musicMvShot: { ...rest, ...musicMvSingingLyricPatch(binding, table) } });
    }
  };
  /** 换镜头成片模型：音乐块记住选择，未出片的镜头块同步模型与请求时长（已出片的不动）。 */
  const chooseShotModel = (videoModel: CanvasVideoModel) => {
    onPatch({ videoModel });
    for (const id of latest.current.shotBlockIds || []) {
      const shot = getBlocks().find(row => row.id === id);
      if (!shot?.musicMvShot || (shot.status === "done" && shot.outputUrl) || shot.musicMvShot.kind === "footage") continue;
      const sec = musicMvShotRequestSec(videoModel, shot.musicMvShot.endSec - shot.musicMvShot.startSec);
      onPatchBlock?.(id, { videoModel, prompt: shot.prompt.replace(/目标时长：\s*\d+(?:\.\d+)?\s*秒/, `目标时长：${sec} 秒`) });
    }
  };
  let visibleShotIds: string[] = [];
  let highlightError = "";
  let planShots = state.plan?.shots || [];
  if (highlightMode && state.plan) { try { planShots = musicMvShotSlices(state.plan, highlightRange(state)).map(row=>row.shot); } catch { planShots = []; } }
  try { visibleShotIds = activeShotIds(state); if (highlightMode && selected) highlightRange(state); } catch(error) { highlightError = error instanceof Error ? error.message : "高光区间无效"; }
  const missingShots = visibleShotIds.flatMap(id => {
    const shot = blocks.find(row => row.id === id);
    return shot && !(shot.status === "done" && shot.outputUrl) ? [shot] : [];
  });
  // 合成前素材缺口：有剪辑会话时按草稿已绑定源计（合成只消费草稿），否则按画布镜头成片计。
  const editSession = highlightMode
    ? undefined
    : state.timelineEdits?.find(
        e => e.draft.basePlanRequestId === state.planRequestId
      );
  const materialGap = editSession
    ? musicMvEditMaterialGap(editSession.draft, blocks).missing
    : missingShots.length;
  const missingCredits = missingShots.reduce(
    (sum, shot) =>
      sum +
      canvasVideoClipCredits({
        videoModel: shot.videoModel,
        resolution: shot.videoResolution,
        durationSec: parseManhuaClipTargetDurationSec(shot.prompt),
      }),
    0
  );
  return (
    <div
      ref={studio}
      data-mv-studio={block.id}
      aria-busy={busy}
      className="space-y-2 overflow-auto text-white/85"
      onPointerDown={event => event.stopPropagation()}
    >
      <label className="block text-sm font-semibold">本次交付
        <select aria-label="MV交付类型" className={field} value={state.deliveryMode || "legacy"} disabled={busy || pendingPlan || Boolean(state.assembleRequestId && !state.assembleTerminalStatus)} onChange={e=>patch({deliveryMode:e.target.value as "song"|"highlight"})}>
          {!state.deliveryMode && <option value="legacy">原有完整 MV 工作流</option>}
          <option value="song">歌词、歌曲与专辑封面</option>
          <option value="highlight">抖音高光 MV · 30–60 秒</option>
        </select>
      </label>
      <p className="text-xs leading-6">{songOnly ? "创作完整歌曲，交付歌词、音频和方形专辑封面。" : highlightMode ? "从完整歌曲中选出30–60秒高光，制作竖屏MV，在抖音引流到汽水音乐。" : "参考歌曲 → 新歌创作 → 选版 → MV分镜 → 剪辑"}</p>
      <nav aria-label="MV 制作步骤" className="mb-5 grid grid-cols-3 gap-2" style={songOnly ? {gridTemplateColumns:"repeat(2,minmax(0,1fr))"} : undefined}>
        {(songOnly ? [{id:"song",label:"歌词与歌曲",enabled:true},{id:"delivery",label:"歌曲与封面",enabled:Boolean(selected)}] : [
          { id: "song", label: "选定歌曲", enabled: true },
          { id: "concept", label: "视觉方案", enabled: Boolean(selected) },
          { id: "storyboard", label: "确认分镜", enabled: Boolean(selected) },
          { id: "shots", label: "制作镜头", enabled: Boolean(state.plan) },
          {
            id: "edit",
            label: "剪辑",
            enabled: Boolean(
              selected &&
                state.plan &&
                state.planRequestId &&
                state.shotBlockIds?.length
            ),
          },
          { id: "finish", label: "合成成片", enabled: Boolean(state.plan) },
        ]).map((step, i) => (
          <button
            key={step.id}
            type="button"
            disabled={!step.enabled}
            className="rounded-lg border border-white/20 bg-white/5 px-2 py-3 text-sm font-semibold disabled:opacity-35"
            onClick={() =>
              studio.current
                ?.querySelector<HTMLElement>(`[data-mv-step="${step.id}"]`)
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            {i + 1}. {step.label}
          </button>
        ))}
      </nav>
      <h3 data-mv-step="song" className="pt-3 text-base font-semibold">
        1. 选定歌曲
      </h3>
      <p className="text-xs leading-6 text-white/60">
        {songOnly ? "可以按主题创作人声歌曲，也可以制作纯音乐。选定版本后保留完整音频、歌词和专辑封面。" : "人声歌曲和纯音乐都可以制作 MV。上传或创作歌曲，选定版本后安排画面；需要人物唱歌时，在分镜中选择演唱镜头。"}
      </p>
      <label className="block text-xs">
        音乐类型
        <select
          aria-label="MV音乐类型"
          className={field}
          value={state.instrumental === false ? "song" : "instrumental"}
          disabled={busy || pendingPlan || Boolean(state.musicRequestId)}
          onChange={e =>
            patch({ ...invalidateMusicMvPlan(latest.current), ...musicMvTypePatch(latest.current, e.target.value === "instrumental") })
          }
        >
          <option value="song">人声歌曲（有演唱）</option>
          <option value="instrumental">纯音乐（无演唱）</option>
        </select>
      </label>

      <label className="block text-xs">
        上传参考音频或MV（MP3 / WAV / M4A / MP4）
        <input
          aria-label="上传参考歌曲"
          type="file"
          accept=".mp3,.wav,.m4a,.mp4,audio/mpeg,audio/wav,audio/mp4,video/mp4"
          disabled={busy}
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file)
              void perform(async () => {
                if (!/\.(mp3|wav|m4a|mp4)$/i.test(file.name))
                  throw new Error("请使用MP3、WAV、M4A音频或MP4视频");
                const mediaKind = /\.mp4$/i.test(file.name) ? "video" as const : "audio" as const;
                if (file.size > 64 * 1024 * 1024)
                  throw new Error("听音参考最大64MB，请先选择较小文件");
                const asset = await uploadOneCanvasAsset({
                  file,
                  index: 0,
                  getSignedUploadUrl: input => upload.mutateAsync(input),
                });
                if (!alive.current) return;
                // 先保存已上传素材；即使时长读取失败，也能从原素材重新读取，避免重复上传。
                patch(
                  {},
                  {
                    uploadedAssets: [
                      ...(currentBlock.current.uploadedAssets || []),
                      asset,
                    ],
                  }
                );
                const durationSec = await audioDuration(asset.url, mediaKind);
                if (!alive.current) return;
                patch({
                  songReferenceMediaKind: mediaKind,
                  songReference: {
                    id: `upload:${asset.id}`,
                    url: asset.url,
                    gcsUri: asset.gcsUri,
                    durationSec,
                    title: file.name,
                  },
                });
              });
          }}
        />
      </label>
      {state.songReference && (
        <button
          className={button}
          disabled={busy || state.songAdvisor?.status === "pending"}
          onClick={() => patch({ songReference: undefined })}
        >
          移除参考，改按主题创作
        </button>
      )}
      <CanvasCreativeLearning audio={state.songReference} mediaKind={state.songReferenceMediaKind || "audio"} projectId={projectId} videoModel={block.videoModel}
        disabled={busy || pendingPlan || Boolean(state.musicRequestId)} session={state.creativeLearning}
        onSession={(creativeLearning,isNew) => patch({creativeLearning,...(isNew && latest.current.creativeLearning ? {creativeLearningHistory:[...(latest.current.creativeLearningHistory||[]),latest.current.creativeLearning]}:{})})} />
      <CanvasSunoSongAdvisor
        demos={state.songDemos||[]}
        onDemos={songDemos=>patch({songDemos})}
        selectedDemo={state.selectedSongDemo}
        onSelectDemo={(requestId,variantIndex)=>patch({selectedSongDemo:{requestId,variantIndex}})}
        optimizeExisting={state.songOptimizeExisting}
        onOptimizeExisting={songOptimizeExisting=>patch({songOptimizeExisting})}
        originalBrief={(()=>{const parsed=sunoSongBriefSchema.safeParse({model:"suno-v6",custom_mode:true,instrumental:state.instrumental!==false,title:state.songTitle?.trim()||"画布音乐",style:block.prompt,prompt:state.lyrics||"",negative_tags:musicMvExclusions(state),duration:state.requestedDurationSec??200,style_weight:state.songStyleWeight??0.78,weirdness_constraint:state.songWeirdness??0.25});return parsed.success?parsed.data:undefined;})()}
        craftIds={state.songCraftIds || []}
        onCraftIds={songCraftIds => patch({ songCraftIds })}
        audio={state.songReference}
        referenceMediaKind={state.songReferenceMediaKind || "audio"}
        requirements={state.songRequirements || ""}
        projectId={projectId}
        videoModel={block.videoModel}
        session={state.songAdvisor}
        history={state.songAdvisorHistory || []}
        disabled={busy || pendingPlan || Boolean(state.musicRequestId)}
        onRequirements={songRequirements => patch({ songRequirements })}
        onSession={songAdvisor => patch({ songAdvisor })}
        onNew={songAdvisor =>
          patch({
            songAdvisor,
            songAdvisorHistory: latest.current.songAdvisor
              ? [
                  ...(latest.current.songAdvisorHistory || []),
                  latest.current.songAdvisor,
                ]
              : latest.current.songAdvisorHistory,
          })
        }
        onApply={(brief, session, conceptId) => {
          if (session.proposal?.review && session.proposal.review.verdict !== "approved") {
            patch({ error: "创作顾问审阅尚有待处理事项，未采用" });
            return;
          }
          if (
            hasPendingMusicMvPlan(latest.current) ||
            latest.current.musicRequestId
          )
            return;
          const chosenConcept = session.proposal?.concepts.find(c => c.id === conceptId);
          const emotionNotes = chosenConcept?.emotionalArc?.map(a => `${a.sectionZh}：${a.emotion.fromZh}→${a.emotion.toZh}；触发：${a.emotion.triggerZh}；音乐：${a.emotion.musicZh}；画面：${a.emotion.visualZh}`).join("\n");
          patch(
            {
              ...invalidateMusicMvPlan(latest.current),
              candidateContexts: selectMusicCandidateContext(
                latest.current,
                latest.current.selectedCandidateId || ""
              ).candidateContexts,
              lyricsCandidateId: undefined,
              songBrief: brief,
              songTitle: brief.title,
              songExcludes: brief.negative_tags,
              songStyleWeight: brief.style_weight,
              songWeirdness: brief.weirdness_constraint,
              lyrics: brief.prompt,
              instrumental: brief.instrumental,
              requestedDurationSec: brief.duration,
              selectedCandidateId: undefined,
              songReference: session.target.audio,
              songReferenceMediaKind: session.target.referenceMediaKind || "audio",
              songRequirements: session.target.requirements,
              songCraftIds: session.target.craftIds,
              creativePrompt: [chosenConcept?.mvDirectionZh || latest.current.creativePrompt, emotionNotes ? `逐段情绪设计（创作建议，非实测秒位）：\n${emotionNotes}` : ""].filter(Boolean).join("\n"),
              songAdoption: {
                requestId: session.requestId,
                evidenceId: session.proposal!.evidenceId!,
                conceptId,
                referenceAudioId: session.target.audio?.id,
              },
            },
            { prompt: brief.style, outputUrl: undefined }
          );
        }}
      />
      <label className="block text-xs">
        歌曲名称
        <input
          aria-label="歌曲名称"
          className={field}
          maxLength={80}
          value={state.songTitle || ""}
          disabled={busy}
          onChange={e => patch({ songTitle: e.target.value })}
        />
      </label>
      <label className="block text-xs">
        音乐风格与编曲
        <textarea
          aria-label="音乐风格与编曲"
          className={field}
          rows={3}
          value={block.prompt}
          disabled={busy || pendingPlan}
          onChange={e => patch({}, { prompt: e.target.value })}
        />
      </label>
      <label className="block text-xs">
        目标秒数
        <input
          className={field}
          type="number"
          min={10}
          max={360}
          value={state.requestedDurationSec || 200}
          disabled={busy}
          onChange={e =>
            patch({ requestedDurationSec: Number(e.target.value) })
          }
        />
      </label>
      {
        <textarea
          className={field}
          rows={5}
          aria-label="歌曲歌词或段落结构"
          placeholder={
            state.instrumental === false
              ? "完整歌词，含段落标签"
              : "器乐段落、演奏与收束要求（可选）"
          }
          value={state.lyrics || ""}
          disabled={busy || pendingPlan}
          onChange={e =>
            patch({
              ...invalidateMusicMvPlan(latest.current),
              lyrics: e.target.value,
            })
          }
        />
      }
      <label className="block text-xs">
        排除风格/声音
        <input
          aria-label="排除风格"
          className={field}
          maxLength={200}
          value={musicMvExclusions(state)}
          placeholder={state.instrumental === false ? "可留空；仅填写不想要的风格，不默认排除演唱" : "纯音乐默认排除人声"}
          disabled={busy}
          onChange={e => patch({ songExcludes: e.target.value })}
        />
      </label>
      <label className="block text-xs">
        风格强度 {Math.round((state.songStyleWeight ?? 0.78) * 100)}%
        <input
          aria-label="风格强度"
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round((state.songStyleWeight ?? 0.78) * 100)}
          disabled={busy}
          onChange={e =>
            patch({ songStyleWeight: Number(e.target.value) / 100 })
          }
        />
      </label>
      <label className="block text-xs">
        随机性 {Math.round((state.songWeirdness ?? 0.25) * 100)}%
        <input
          aria-label="随机性"
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round((state.songWeirdness ?? 0.25) * 100)}
          disabled={busy}
          onChange={e => patch({ songWeirdness: Number(e.target.value) / 100 })}
        />
      </label>
      <details className="text-xs" open><summary>本次歌曲封面 · {CANVAS_IMAGE_CREDITS_PER_SHOT} 积分</summary><p>歌曲成功后生成一张{coverAspect === "1:1" ? "1:1专辑封面" : "9:16封面"}，同次返回的歌曲版本共用。按歌词与曲风设计；关闭页面后回来会继续原任务。</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{buildSongCoverPrompt({title:state.songTitle?.trim()||"画布音乐",style:block.prompt,prompt:state.lyrics?.trim()||(state.instrumental!==false?block.prompt:""),instrumental:state.instrumental!==false},coverAspect)}</pre></details>
      <p className="text-xs">
        本次歌曲 · {CANVAS_BGM_CREDITS_PER_RUN}{" "}
        积分。提交上方完整歌词/段落与风格；参考作品用于分析创作方法，本次生成原创歌曲。
      </p>
      {state.musicSubmission && state.musicRequestId && (
        <details>
          <summary>原音乐提交快照</summary>
          <p>
            {state.musicSubmission.title} · {state.musicSubmission.duration}秒
          </p>
          <p>{state.musicSubmission.style}</p>
          <pre className="whitespace-pre-wrap">
            {state.musicSubmission.prompt}
          </pre>
          <p>
            排除：{state.musicSubmission.negative_tags}；风格强度：
            {state.musicSubmission.style_weight}；随机性：
            {state.musicSubmission.weirdness_constraint}
          </p>
        </details>
      )}
      <div className="flex flex-wrap gap-1">
        <button
          className={button}
          disabled={busy || pendingPlan || !!state.musicRequestId}
          onClick={generate}
        >
          生成音乐与封面 · {CANVAS_BGM_CREDITS_PER_RUN + CANVAS_IMAGE_CREDITS_PER_SHOT} 积分
        </button>
        {state.musicJobId && (
          <button
            className={button}
            disabled={busy}
            onClick={() => void perform(() => importJob(state.musicJobId!))}
          >
            查询原音乐任务
          </button>
        )}
        {["succeeded", "failed", "cancelled"].includes(
          state.musicJobStatus || ""
        ) && (
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              patch({
                musicRequestId: undefined,
                musicSubmission: undefined,
                lyricsCandidateId: undefined,
                musicSubmissionDirection: undefined,
                musicJobId: undefined,
                musicJobStatus: undefined,
              })
            }
          >
            新一轮音乐
          </button>
        )}
        <button
          className={button}
          disabled={busy}
          onClick={() =>
            void perform(async () =>
              setHistory(
                await utils.mvAnalysis.listManhuaBgmJobs.fetch({ limit: 30 })
              )
            )
          }
        >
          读取已有音乐
        </button>
      </div>
      {history.map(job => (
        <button
          className={button}
          key={job.jobId}
          disabled={busy}
          onClick={() => void perform(() => importJob(job.jobId))}
        >
          {job.titleZh}
        </button>
      ))}
      {(block.uploadedAssets || [])
        .filter(row => row.kind === "audio")
        .map(row => (
          <button
            className={button}
            key={row.id}
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const url = await resolveCanvasMaterialUrl(
                  row.gcsUri || row.url
                );
                const durationSec = await audioDuration(url);
                const candidate = {
                  id: `upload:${row.id}`,
                  url,
                  gcsUri: row.gcsUri,
                  durationSec,
                  title: row.fileName,
                };
                if (
                  !alive.current ||
                  !currentBlock.current.uploadedAssets?.some(
                    asset => asset.id === row.id
                  )
                )
                  return;
                const candidates = mergeMusicCandidates(
                  latest.current.candidates,
                  [candidate]
                );
                patch(
                  {
                    candidates,
                    status: latest.current.plan
                      ? latest.current.status
                      : "music_ready",
                  },
                  { outputUrls: candidates.map(item => item.url) }
                );
              })
            }
          >
            导入 {row.fileName}
          </button>
        ))}
      <div data-mv-step="delivery" />
      <SongCoverPanel records={state.songCovers||[]} onUpdate={(musicJobId,delta)=>patch({songCovers:(latest.current.songCovers||[]).map(row=>row.musicJobId===musicJobId?{...row,...delta}:row)})}/>
      {state.candidates.map(candidate => (
        <div key={candidate.id} className="rounded border border-white/15 p-1">
          <button
            className={button}
            disabled={busy || pendingPlan || candidate.id === selected?.id}
            onClick={() => choose(candidate)}
          >
            {candidate.id === selected?.id ? "已采用" : "采用"}{" "}
            {candidate.title} · {candidate.durationSec.toFixed(2)} 秒
          </button>
          <button
            className={button}
            disabled={busy || state.songAdvisor?.status === "pending"}
            onClick={() => patch({ songReference: candidate })}
          >
            作为新歌参考
          </button>
          <audio controls src={candidate.url} className="w-full" />
        </div>
      ))}
      {selected && <SongOperationsPanel key={selected.id} source={selected} lyrics={state.lyrics || ""} sessions={state.songOperations || []} disabled={busy || pendingPlan}
        services={{prepare: input => songPrepare.mutateAsync(input), submit: input => songSubmit.mutateAsync(input), resume: input => songResume.mutateAsync(input), get: input => utils.songOperations.get.fetch(input)}}
        onSession={session => patch({songOperations: [...(latest.current.songOperations || []).filter(s => s.requestId !== session.requestId), session]})}
        onCandidates={receipt => {
          const candidates = mergeMusicCandidates(latest.current.candidates, songOperationCandidates(receipt));
          patch({candidates}, {outputUrls: candidates.map(c => c.url)});
        }}
        onAlignment={receipt => {
          if (!receipt.alignment || receipt.sourceId !== latest.current.selectedCandidateId) throw new Error("请先采用本次对齐的来源歌曲");
          patch({songAlignment: {requestId:receipt.requestId,sourceId:receipt.sourceId,...receipt.alignment}});
        }}
        onStems={receipt => patch({}, {audioStudio: songOperationStemMix(receipt, currentBlock.current.audioStudio)})}
      />}
      {block.audioStudio?.previewTake && block.audioStudio.cues.some(c => c.id.startsWith("songstem_")) && <button className={button} disabled={busy || pendingPlan} onClick={() => perform(async () => {
        const take = currentBlock.current.audioStudio?.previewTake;
        if (!take) throw new Error("请先生成混音试听");
        const studio = currentBlock.current.audioStudio!;
        const currentSong = latest.current.candidates.find(c => c.id === latest.current.selectedCandidateId);
        if (!currentSong || take.inputKey !== await canvasAudioPreviewKey(canvasAudioMixSource(studio.cues, currentSong.durationSec))) throw new Error("音轨或歌曲已修改，请先更新混音试听，原混音仍保留");
        const url = await resolveCanvasMaterialUrl(take.gcsUri);
        const candidates = mergeMusicCandidates(latest.current.candidates, [{id:`songmix_${take.id}`,gcsUri:take.gcsUri,url,durationSec:take.durationSec,title:`${selected?.title || "歌曲"} · 混音`}]);
        patch({candidates}, {outputUrls:candidates.map(c => c.url)});
      })}>将混音保留为 MV 歌曲候选</button>}
      {state.songAlignment?.sourceId === selected?.id && state.songAlignment && <p className="text-xs text-violet-200">已应用歌词时间，共 {state.songAlignment.words.length} 项；下次合成 MV 时使用。<button className={button} disabled={busy} onClick={() => patch({songAlignment:undefined})}>移除本次字幕</button></p>}
      {block.audioStudio?.cues.some(c => c.id.startsWith("songstem_")) && selected && <details className="rounded-lg border border-white/15 p-2"><summary className="text-xs">歌曲分轨与混音</summary><CanvasAudioStudio block={block} musicWorkbench timelineDurationSec={selected.durationSec} disabled={busy || pendingPlan} onChange={audioStudio => patch({}, {audioStudio})}/></details>}
      {songOnly && selected && <section className="space-y-3 border-t border-white/15 pt-5" aria-label="歌曲交付">
        <h3 className="text-base font-semibold">歌词、歌曲与专辑封面</h3>
        <p className="text-sm">{selected.title || state.songTitle || "所选歌曲"} · {selected.durationSec.toFixed(1)} 秒</p>
        <a className={button} href={selected.url} target="_blank" rel="noreferrer">打开歌曲文件</a>
        <button className={button} disabled={!state.lyrics?.trim()} onClick={()=>{const url=URL.createObjectURL(new Blob([state.lyrics || ""],{type:"text/plain;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download=`${state.songTitle || "歌曲"}-歌词.txt`;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}}>下载歌词</button>
        <p className="text-xs text-white/60">专辑封面在上方查看和打开。准备做推广时，可切换到高光 MV，沿用这首歌；汽水音乐发布需自行完成。</p>
      </section>}
      {!songOnly && <>
      {highlightMode && <section className="space-y-3 border-t border-white/15 pt-5" aria-label="高光区间" data-mv-step="edit">
        <h3 className="text-base font-semibold">抖音高光区间 · 原曲秒位</h3>
        <p className="text-xs text-white/60">选择30–60秒精彩唱段。只制作区间内镜头，音轨保持原速；专辑版保留完整歌曲。</p>
        <form key={selected?.id || "no-song"} className="flex flex-wrap items-end gap-3" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void perform(async()=>{const range=musicMvHighlightSchema.parse({startSec:Number(data.get("start")),endSec:Number(data.get("start"))+Number(data.get("duration"))});if(!selected || range.endSec>selected.durationSec)throw new Error("高光区间超出所选歌曲");if(state.plan)musicMvShotSlices(state.plan,range);patch({highlight:range,error:undefined});});}}>
          <label className="text-xs">开始秒数<input aria-label="高光开始秒数" name="start" type="number" min="0" step="0.1" defaultValue={state.highlight?.startSec || 0} className={field}/></label>
          <label className="text-xs">高光时长<input aria-label="高光时长" name="duration" type="number" min="30" max="60" step="0.1" defaultValue={state.highlight ? state.highlight.endSec-state.highlight.startSec : 45} className={field}/></label>
          <button className={button} disabled={busy || !selected || Boolean(state.assembleRequestId && !state.assembleTerminalStatus)}>应用高光区间</button>
        </form>
        {selected && <p className="text-xs">当前区间：{(state.highlight?.startSec || 0).toFixed(1)}–{(state.highlight?.endSec ?? Math.min(45,selected.durationSec)).toFixed(1)} 秒 · 9:16竖屏</p>}
        {selected && <div className="space-y-2">
          <audio ref={highlightAudio} controls src={selected.url} className="w-full" onTimeUpdate={e=>{try {const range=highlightRange(latest.current);if(range && e.currentTarget.currentTime>=range.endSec)e.currentTarget.pause();}catch{e.currentTarget.pause();}}}/>
          <button className={button} disabled={busy || Boolean(highlightError)} onClick={()=>void perform(async()=>{const range=highlightRange(latest.current);if(!range || !highlightAudio.current)return;highlightAudio.current.currentTime=range.startSec;await highlightAudio.current.play();})}>试听高光区间</button>
        </div>}
        {highlightError && <p role="alert" className="text-xs text-amber-200">{highlightError}</p>}
        {selected && state.highlight && (() => {
          const f = planMvHighlightFades({ range: state.highlight, lines: state.lyricTable?.lines, beatGrid: state.plan?.beatGrid, fadeInSec: state.highlightFadeInSec, fadeOutSec: state.highlightFadeOutSec });
          return <div className="flex flex-wrap items-end gap-3 text-xs">
            <label>淡入（秒）<input aria-label="高光淡入秒数" type="number" min="0" max="3" step="0.1" className={field} value={f.fadeInSec.toFixed(1)} disabled={busy} onChange={e=>patch({highlightFadeInSec:Math.max(0,Math.min(3,Math.round(Number(e.target.value)*10)/10))})}/></label>
            <label>淡出（秒）<input aria-label="高光淡出秒数" type="number" min="0" max="6" step="0.1" className={field} value={f.fadeOutSec.toFixed(1)} disabled={busy} onChange={e=>patch({highlightFadeOutSec:Math.max(0,Math.min(6,Math.round(Number(e.target.value)*10)/10))})}/></label>
            <span className="text-white/60">{f.reasonZh}；音画同步淡出，不硬切</span>
          </div>;
        })()}
        {selected && !songOnly && <button className={button} disabled={busy || !state.lyricTable?.lines.length} onClick={()=>void perform(async()=>{
          // 高光只取有歌词的部分：按歌词时间表推荐（规则见 recommendMusicMvHighlight），用户仍可手动改
          const rec=recommendMusicMvHighlight(latest.current.lyricTable?.lines||[],selected.durationSec,latest.current.plan?.beatGrid?.segments||[]);
          if(!rec)throw new Error("歌词表里没有唱句，无法推荐高光；请先识别并核对歌词");
          const range=musicMvHighlightSchema.parse({startSec:rec.startSec,endSec:rec.endSec});
          if(latest.current.plan)musicMvShotSlices(latest.current.plan,range);
          patch({highlight:range,error:undefined});
        })}>推荐高光（只取有歌词的段落）</button>}
        {selected && !songOnly && <CanvasMvLyricTableEditor
          table={state.lyricTable}
          range={selected ? { startSec: 0, endSec: selected.durationSec } : undefined}
          disabled={busy}
          onRecognize={async () => {
            if (!selected) throw new Error("请先选定歌曲");
            const table = await recognizeLyrics.mutateAsync({ requestId: crypto.randomUUID(), audio: selected, range: { startSec: 0, endSec: selected.durationSec }, ...(latest.current.musicJobId ? { musicJobId: latest.current.musicJobId } : {}), ...(latest.current.lyrics?.trim() ? { lyricsHint: latest.current.lyrics } : {}) });
            patch({ lyricTable: table });
            syncSingingLyrics(table);
          }}
          onChange={next => { patch({ lyricTable: next }); syncSingingLyrics(next); }}
          onConfirm={next => { patch({ lyricTable: next }); syncSingingLyrics(next); }}
          onPlayLine={line => { const a = highlightAudio.current; if (!a) return; a.currentTime = line.startSec; void a.play(); window.setTimeout(() => a.pause(), Math.max(200, (line.endSec - line.startSec) * 1000)); }}
        />}
      </section>}
      <h3 data-mv-step="concept" className="border-t border-white/15 pt-5 text-base font-semibold">2. 视觉方案</h3>
      <textarea
        className={field}
        rows={3}
        placeholder="MV 画面创意、主角与场景、节奏安排"
        value={state.creativePrompt || ""}
        disabled={busy || pendingPlan}
        onChange={e =>
          patch({
            ...invalidateMusicMvPlan(latest.current),
            creativePrompt: e.target.value,
          })
        }
      />
      {Boolean(state.missingVariants) && (
        <p className="text-xs text-amber-200">
          本次缺少 {state.missingVariants} 个候选，可查询原任务，不自动补单。
        </p>
      )}
      {references.length > 0 && (
        <button
          className={button}
          disabled={busy || pendingPlan}
          onClick={() => {
            previousUploadedReferenceCount.current = 0;
            patch(
              { ...invalidateMusicMvPlan(latest.current), referenceImages: [] },
              {
                uploadedAssets: (
                  currentBlock.current.uploadedAssets || []
                ).filter(row => row.kind !== "image"),
              }
            );
          }}
        >
          移除全部参考图（{references.length}）
        </button>
      )}
      <p className="text-[10px] text-white/50">
        MV创作顾问会听取歌曲后给出方案；下方普通分镜仅依据歌词与创意。可上传人物、场景参考图。
      </p>
      <CanvasMvCreativeAdvisor
        audio={selected}
        lyrics={state.lyrics || ""}
        creativePrompt={state.creativePrompt || block.prompt}
        videoModel={block.videoModel}
        projectId={projectId}
        blocks={blocks}
        references={references}
        disabled={busy || pendingPlan}
        session={state.advisor}
        footageIds={state.advisorFootageIds || []}
        onFootageIds={advisorFootageIds => patch({ advisorFootageIds })}
        onSession={advisor => patch({ advisor })}
        onNewSession={advisor =>
          patch({
            advisor,
            advisorHistory: latest.current.advisor
              ? [
                  ...(latest.current.advisorHistory || []),
                  latest.current.advisor,
                ]
              : latest.current.advisorHistory,
          })
        }
        onApply={async result => {
          const previous = latest.current;
          const version = JSON.stringify({
            lyrics: previous.lyrics,
            creativePrompt: previous.creativePrompt,
            referenceImages: previous.referenceImages,
            selectedCandidateId: previous.selectedCandidateId,
          });
          const song = previous.candidates.find(
            row => row.id === previous.selectedCandidateId
          );
          if (
            !song ||
            song.id !== result.plan.audioId ||
            song.durationSec !== result.plan.audioDurationSec
          )
            throw new Error("歌曲已切换，原方案保留，未铺设镜头");
          const refs = await Promise.all(
            references.map(async row => ({
              ...row,
              url: row.gcsUri
                ? await resolveCanvasMaterialUrl(row.gcsUri)
                : row.url,
            }))
          );
          const shots = createMusicMvShotBlocks(
            block,
            result.plan,
            result.requestId,
            refs,
            song,
            effectiveShotReferences(previous),
            previous.lyricTable
          );
          for (const shot of shots)
            if (shot.musicMvShot?.kind === "footage" && shot.outputUrl) {
              shot.outputUrl = await resolveMusicMvMediaUrl(shot.outputUrl);
              shot.outputUrls = [shot.outputUrl];
            }
          const now = latest.current;
          if (
            !alive.current ||
            version !==
              JSON.stringify({
                lyrics: now.lyrics,
                creativePrompt: now.creativePrompt,
                referenceImages: now.referenceImages,
                selectedCandidateId: now.selectedCandidateId,
              })
          )
            throw new Error("歌曲或创意版本已变化，未采用");
          if (
            now.planRequestId === result.requestId &&
            now.shotBlockIds?.length === result.plan.shots.length
          )
            return;
          onAdd(
            shots,
            shots.map(row => ({ fromId: block.id, toId: row.id }))
          );
          patch({
            ...invalidateMusicMvPlan(latest.current),
            plan: result.plan,
            planInput: result.input,
            planRequestId: result.requestId,
            shotBlockIds: shots.map(row => row.id),
            status: "planned",
            planHistory: previous.planRequestId
              ? [
                  ...(previous.planHistory || []),
                  {
                    requestId: previous.planRequestId,
                    input: previous.planInput,
                  },
                ]
              : previous.planHistory,
          });
        }}
      />
      <h3 data-mv-step="storyboard" className="border-t border-white/15 pt-5 text-base font-semibold">3. 确认分镜</h3>
      <button
        className={button}
        disabled={busy || !selected || !!state.plan}
        onClick={draft}
      >
        {state.planRequestId && !state.plan ? "恢复原分镜请求" : "生成 MV 分镜"}{" "}
        · {CREDIT_COSTS.storyboard} 积分
      </button>
      {state.planRequestId &&
        state.planTerminalStatus === "failed" &&
        !state.plan && (
          <button
            className={button}
            disabled={busy}
            onClick={() => {
              const previous = latest.current;
              patch({
                ...invalidateMusicMvPlan(previous),
                planHistory: [
                  ...(previous.planHistory || []),
                  {
                    requestId: previous.planRequestId!,
                    input: previous.planInput,
                  },
                ],
              });
            }}
          >
            原请求已失败，准备新一轮分镜
          </button>
        )}
      {state.plan &&
        state.planInput &&
        (state.planInput.creativePrompt !==
          (state.creativePrompt || block.prompt) ||
          state.planInput.lyrics !== (state.lyrics || "")) && (
          <div className="text-xs text-amber-200">
            原分镜基于提交时的创意，已保留原稿；当前说明已有变化。
            <button
              className={button}
              disabled={busy}
              onClick={() => {
                const previous = latest.current;
                patch({
                  ...invalidateMusicMvPlan(previous),
                  planHistory: [
                    ...(previous.planHistory || []),
                    {
                      requestId: previous.planRequestId!,
                      input: previous.planInput,
                    },
                  ],
                });
              }}
            >
              按当前创意准备新分镜
            </button>
          </div>
        )}
      {state.plan && (
        <>
          <details open>
            <summary className="text-xs">
              {highlightMode ? "本次高光分镜" : "完整分镜"} · {planShots.length} 镜 /{" "}
              {(highlightMode && !highlightError ? (highlightRange(state)!.endSec-highlightRange(state)!.startSec) : state.plan.audioDurationSec).toFixed(2)} 秒
            </summary>
            {planShots.map((shot, i) => (
              <p className="my-1 text-xs" key={shot.id}>
                {i + 1}. {shot.startSec.toFixed(2)}–{shot.endSec.toFixed(2)}秒：
                {shot.visualPrompt}；{shot.cameraPrompt}
                {highlightMode && !highlightError && `；成片保留 ${Math.max(shot.startSec,highlightRange(state)!.startSec).toFixed(2)}–${Math.min(shot.endSec,highlightRange(state)!.endSec).toFixed(2)} 秒`}
              </p>
            ))}
          </details>
          <CanvasMvShotReferencePicker
            projectId={projectId}
            videoModel={block.videoModel}
            onFillComposed={async (shotId, clip) => {
              const id = (latest.current.shotBlockIds || []).find(b => getBlocks().find(row => row.id === b)?.musicMvShot?.shotId === shotId);
              if (!id) throw new Error("请先确认分镜并铺到画布，再合成素材填充镜头");
              const url = await resolveCanvasMaterialUrl(clip.gcsUri);
              onPatchBlock?.(id, { status: "done", outputUrl: url, outputUrls: [url], error: undefined });
            }}
            planRequestId={state.planRequestId}
            shots={planShots}
            anchorImage={state.anchorImage}
            shotReferences={state.shotReferences}
            shotBlocks={(state.shotBlockIds || []).flatMap(id => {
              const row = blocks.find(b => b.id === id);
              const shotId = row?.musicMvShot?.shotId;
              if (!row || !shotId) return [];
              const adopted = row.manhuaSegmentRefs?.previs;
              const last = row.previsStudio?.history?.[row.previsStudio.history.length - 1];
              const previs = adopted?.gcsUri && adopted.durationSec
                ? { gcsUri: adopted.gcsUri, durationSec: adopted.durationSec }
                : last?.gcsUri
                  ? { gcsUri: last.gcsUri, durationSec: last.durationSec, requestId: last.requestId }
                  : undefined;
              return [{ shotId, blockId: id, previs }];
            })}
            orientation={block.aspectRatio === "9:16" || highlightMode ? "portrait" : "landscape"}
            cinemaHintZh={state.creativePrompt}
            disabled={busy}
            onChange={updateReferences}
          />
          {highlightMode && state.plan && state.planRequestId && <button className={button} disabled={busy || state.lyricTable?.status !== "confirmed" || !state.highlight} onClick={()=>void perform(async()=>{
            // 1109：真歌词→演唱段，吟唱→素材填充段（跨吟唱起点的镜切开），补逐窗节拍与填充建议；存为新分镜记录后重新铺镜头
            const revised = await reviseForLyrics.mutateAsync({ basePlanRequestId: latest.current.planRequestId!, lyricTable: latest.current.lyricTable, highlight: latest.current.highlight, ...(latest.current.musicJobId ? { musicJobId: latest.current.musicJobId } : {}) });
            patch({ plan: revised.plan, planRequestId: revised.requestId, shotBlockIds: undefined, error: revised.beatsFailed.length || revised.fillFailuresZh.length ? `已重排镜头；${revised.beatsFailed.length ? `逐窗节拍未出：${revised.beatsFailed.join("、")}；` : ""}${revised.fillFailuresZh.join("；")}` : undefined });
          })}>按确认版歌词重排镜头（演唱/素材填充）</button>}
          <h3 data-mv-step="shots" className="border-t border-white/15 pt-5 text-base font-semibold">4. 制作镜头</h3>
          {!!videoModelOptions?.length && (
            <label className="block text-xs">
              镜头成片模型（与漫剧工厂同一模型表；参考上限与时长按所选模型）
              <select
                aria-label="MV镜头成片模型"
                className={field}
                value={videoModelOptions.some(m => m.id === block.videoModel) ? block.videoModel : videoModelOptions[0]!.id}
                disabled={busy}
                onChange={e => chooseShotModel(e.target.value as CanvasVideoModel)}
              >
                {videoModelOptions.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>
          )}
          <button
            className={button}
            disabled={busy || !!state.shotBlockIds?.length}
            onClick={layOut}
          >
            确认分镜并铺到画布
          </button>
          <button
            className={button}
            disabled={busy || !visibleShotIds.length || Boolean(highlightError)}
            onClick={render}
          >
            生成缺失镜头（{missingShots.length} 镜，预计 {missingCredits} 积分）
          </button>
          {!highlightMode && selected && state.planRequestId && !!state.shotBlockIds?.length && (
            <div data-mv-step="edit">
            <h3 className="mb-3 border-t border-white/15 pt-5 text-base font-semibold">5. 剪辑</h3>
            <CanvasMvTimelineEditor
              key={state.planRequestId}
              plan={state.plan}
              baseId={state.planRequestId}
              audio={selected}
              blocks={blocks}
              shotIds={state.shotBlockIds}
              disabled={busy}
              projectId={projectId}
              orientation={block.aspectRatio === "9:16" ? "portrait" : "landscape"}
              session={state.timelineEdits?.find(
                s => s.draft.basePlanRequestId === state.planRequestId
              )}
              onSession={session =>
                patch({
                  timelineEdits: [
                    ...(latest.current.timelineEdits || []).filter(
                      s =>
                        s.draft.basePlanRequestId !==
                        session.draft.basePlanRequestId
                    ),
                    session,
                  ],
                })
              }
            />
            {userId && (() => {
              // 复用后期工坊：原片=已出片镜头与已合成版本，主音=原歌曲；剪辑方案采用后才提交 concat。
              const shotClips = (state.shotBlockIds || []).flatMap((id, i) => {
                const b = blocks.find(row => row.id === id);
                return b?.status === "done" && b.outputUrl
                  ? [{ id: b.id, url: b.outputUrl, label: `镜头${i + 1}` }]
                  : [];
              });
              const finalBlock = state.finalBlockId ? blocks.find(row => row.id === state.finalBlockId) : undefined;
              const clips = finalBlock?.outputUrl ? [...shotClips, { id: finalBlock.id, url: finalBlock.outputUrl, label: "已合成MV" }] : shotClips;
              return (
                <CanvasMvPostProdWorkbench
                  key={`${userId}:${state.planRequestId}`}
                  userId={userId}
                  projectId={projectId}
                  scope={`music-mv:${block.id}:${state.planRequestId}`}
                  title={state.songTitle?.trim() || "音乐MV"}
                  aspect={block.aspectRatio === "9:16" ? "9:16" : "16:9"}
                  videoModel={block.videoModel || ""}
                  media={{
                    clips,
                    audio: [{ id: selected.id, url: selected.gcsUri || selected.url, label: "原歌曲" }],
                    story: state.lyrics || "",
                  }}
                  storage={window.localStorage}
                  disabled={busy}
                  beforeSubmit={async () => {}}
                />
              );
            })()}
            </div>
          )}
          {highlightMode && <p className="text-xs">5. 剪辑：按上方已应用的高光区间裁取画面、原歌曲与对齐歌词，不变速；调整区间后先补齐缺失镜头。</p>}
          <h3 data-mv-step="finish" className="border-t border-white/15 pt-5 text-base font-semibold">6. 合成成片</h3>
          <button
            className={button}
            disabled={
              busy ||
              !state.shotBlockIds?.length ||
              (!state.assembleRequestId && materialGap > 0)
            }
            onClick={() => finish()}
          >
            {state.assembleRequestId
              ? "查询／恢复原合成"
              : `合成${highlightMode ? "抖音高光 MV" : "完整 MV"} · ${CREDIT_COSTS.workflowFinalRender} 积分`}
          </button>
          {state.assembleTerminalStatus && (
            <button
              className={button}
              disabled={busy || !state.shotBlockIds?.length || materialGap > 0}
              onClick={() => finish(true)}
            >
              合成新版本 · {CREDIT_COSTS.workflowFinalRender} 积分
            </button>
          )}
          {state.assembleTerminalStatus === "succeeded" && /^https:\/\//i.test(finalSource) && state.finalBlockId && (
            <div className="space-y-1.5 rounded border border-white/15 p-2" data-mv-final-upscale>
              <p className="text-xs">成片超分（结果作为新版本放在成片旁，原成片保留；点击后先显示预估积分再确认）</p>
              <div className="flex gap-2">
                {MV_FINAL_UPSCALE_TARGETS.map(t => {
                  const blocker = mvFinalUpscaleBlocker(state.finalUpscales, state.finalBlockId!, t);
                  return (
                    <button
                      key={t}
                      type="button"
                      className={button}
                      disabled={busy || Boolean(blocker)}
                      title={blocker || `按成片实测时长计费，确认前显示预估积分`}
                      onClick={() => upscaleFinal(t)}
                    >
                      {t.toUpperCase()} 超分
                    </button>
                  );
                })}
              </div>
              {(state.finalUpscales || []).map(r => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span>
                    {r.target.toUpperCase()} 超分{r.finalBlockId !== state.finalBlockId ? "（旧成片）" : ""} · {mvFinalUpscaleStatusText(r)}
                    {r.creditsUsed !== undefined ? ` · ${r.creditsUsed} 积分` : ` · 预估 ${r.creditsQuoted} 积分`}
                  </span>
                  {r.videoUrl && (
                    <a
                      className="underline"
                      href={r.videoUrl}
                      target="_blank"
                      rel="noreferrer"
                      download={mvFinalUpscaleDownloadName(state.songTitle, r.target)}
                    >
                      下载 {r.target.toUpperCase()} 版
                    </a>
                  )}
                  {r.error && r.status !== "succeeded" && (
                    <span className="text-amber-200">{creativeUserText(r.error)}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {!!state.shotBlockIds?.length && materialGap > 0 && (
            <p className="text-xs text-amber-200">
              还缺 {materialGap} 个镜头素材
              {editSession
                ? "，请在剪辑中为待素材镜头找素材或同步已有镜头"
                : "，请生成缺失镜头或在剪辑中找素材"}
            </p>
          )}
        </>
      )}
      </>}
      <p role="status" className="text-xs">
        {progress ||
          `阶段：${({ idle: "待创作", music_running: "音乐生成中", music_ready: "音乐待选版", planning: "分镜规划中", planned: "分镜已生成", rendering: "镜头制作中", assembling: "合成中", done: "成片已回写", error: "需处理" } as const)[state.status]}`}
      </p>
      {state.error && (
        <p role="alert" className="text-xs text-amber-200">
          {creativeUserText(state.error)}
        </p>
      )}
    </div>
  );
}
