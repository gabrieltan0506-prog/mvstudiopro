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
import { musicMvEditIssues, musicMvEditKey } from "@shared/canvasMusicMvEdit";
import { CanvasMvCreativeAdvisor } from "./CanvasMvCreativeAdvisor";
import {
  rejectedMusicSubmissionPatch,
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
  canvasMusicMvDraftInputSchema,
  validateCanvasMusicMvPlan,
} from "@shared/canvasMusicMv";
import {
  createMusicMvShotBlocks,
  musicMvReadyClips,
} from "@/lib/canvasMusicMvWorkflow";
import {
  defaultCanvasBlock,
  type CanvasBlock,
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

type Props = {
  projectId?: string;
  block: CanvasBlock;
  blocks: CanvasBlock[];
  onPatch: (patch: Partial<CanvasBlock>) => void;
  onAdd: (blocks: CanvasBlock[], edges: CanvasEdge[]) => void;
  runShot: (id: string) => Promise<boolean | undefined>;
  getBlocks: () => CanvasBlock[];
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
  onPatch,
  onAdd,
  runShot,
  getBlocks,
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
  const lock = useRef(false);
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
        negative_tags:
          source.songExcludes ??
          (instrumental ? "vocals, singing, voice, choir, lyrics" : ""),
        style_weight: source.songStyleWeight ?? 0.78,
        weirdness_constraint: source.songWeirdness ?? 0.25,
      });
      const requestId = crypto.randomUUID();
      const jobId = `bgm_${requestId.replace(/-/g, "")}`;
      patch({
        musicRequestId: requestId,
        musicSubmission: brief,
        songCovers: [...(source.songCovers || []), {musicJobId:jobId,prompt:buildSongCoverPrompt(brief),status:"waiting_music"}],
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
        selected
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
  const render = () =>
    perform(async () => {
      const ids = state.shotBlockIds || [];
      if (!ids.length) throw new Error("请先确认分镜并铺设镜头");
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
        const edit = source.timelineEdits?.find(
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
              source.shotBlockIds || [],
              getBlocks()
            );
        submission = {
          requestId: crypto.randomUUID(),
          planRequestId: source.planRequestId,
          editRevisionId: edit?.saved?.revisionId,
          audio: song,
          alignmentRequestId: source.songAlignment?.sourceId === song.id ? source.songAlignment.requestId : undefined,
          plan: source.plan,
          clips,
          resolution: block.aspectRatio === "9:16" ? "9:16" : "16:9",
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
      final.prompt = "完整 MV · 采用所选歌曲原音轨";
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
  const missingShots = (state.shotBlockIds || []).flatMap(id => {
    const shot = blocks.find(row => row.id === id);
    return shot && !(shot.status === "done" && shot.outputUrl) ? [shot] : [];
  });
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
      className="space-y-2 overflow-auto text-white/85"
      onPointerDown={event => event.stopPropagation()}
    >
      <p className="text-xs">参考歌曲 → 新歌创作 → 选版 → MV分镜 → 剪辑</p>
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
        originalBrief={(()=>{const parsed=sunoSongBriefSchema.safeParse({model:"suno-v6",custom_mode:true,instrumental:state.instrumental!==false,title:state.songTitle?.trim()||"画布音乐",style:block.prompt,prompt:state.lyrics||"",negative_tags:state.songExcludes||"",duration:state.requestedDurationSec??200,style_weight:state.songStyleWeight??0.78,weirdness_constraint:state.songWeirdness??0.25});return parsed.success?parsed.data:undefined;})()}
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
        Suno风格与编曲
        <textarea
          aria-label="Suno风格与编曲"
          className={field}
          rows={3}
          value={block.prompt}
          disabled={busy || pendingPlan}
          onChange={e => patch({}, { prompt: e.target.value })}
        />
      </label>
      <label className="block text-xs">
        音乐类型
        <select
          className={field}
          value={state.instrumental === false ? "song" : "instrumental"}
          disabled={busy}
          onChange={e =>
            patch({ instrumental: e.target.value === "instrumental" })
          }
        >
          <option value="instrumental">纯音乐</option>
          <option value="song">有歌词歌曲</option>
        </select>
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
          value={
            state.songExcludes ??
            (state.instrumental !== false
              ? "vocals, singing, voice, choir, lyrics"
              : "")
          }
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
      <details className="text-xs" open><summary>本次自动封面 · Image 2.5 Flare · {CANVAS_IMAGE_CREDITS_PER_SHOT} 积分</summary><p>歌曲成功后生成一张9:16封面，同次返回的歌曲版本共用。无图片参考，不额外调用文字模型；关闭页面后回来会继续原任务。</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{buildSongCoverPrompt({title:state.songTitle?.trim()||"画布音乐",style:block.prompt,prompt:state.lyrics?.trim()||(state.instrumental!==false?block.prompt:""),instrumental:state.instrumental!==false})}</pre></details>
      <p className="text-xs">
        本次音乐：Suno V6 · 标准模式 · {CANVAS_BGM_CREDITS_PER_RUN}{" "}
        积分。提交上方完整歌词/段落与风格；参考原曲只用于听音创作，不作为Suno翻唱输入。
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
            song
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
              完整分镜 · {state.plan.shots.length} 镜 /{" "}
              {state.plan.audioDurationSec.toFixed(2)} 秒
            </summary>
            {state.plan.shots.map((shot, i) => (
              <p className="my-1 text-xs" key={shot.id}>
                {i + 1}. {shot.startSec.toFixed(2)}–{shot.endSec.toFixed(2)}秒：
                {shot.visualPrompt}；{shot.cameraPrompt}
              </p>
            ))}
          </details>
          {selected && state.planRequestId && !!state.shotBlockIds?.length && (
            <CanvasMvTimelineEditor
              key={state.planRequestId}
              plan={state.plan}
              baseId={state.planRequestId}
              audio={selected}
              blocks={blocks}
              shotIds={state.shotBlockIds}
              disabled={busy}
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
            disabled={busy || !state.shotBlockIds?.length}
            onClick={render}
          >
            生成缺失镜头（{missingShots.length} 镜，预计 {missingCredits} 积分）
          </button>
          <button
            className={button}
            disabled={busy || !state.shotBlockIds?.length}
            onClick={() => finish()}
          >
            {state.assembleRequestId
              ? "查询／恢复原合成"
              : `合成完整 MV · ${CREDIT_COSTS.workflowFinalRender} 积分`}
          </button>
          {state.assembleTerminalStatus && (
            <button
              className={button}
              disabled={busy || !state.shotBlockIds?.length}
              onClick={() => finish(true)}
            >
              合成新版本 · {CREDIT_COSTS.workflowFinalRender} 积分
            </button>
          )}
        </>
      )}
      <p role="status" className="text-xs">
        {progress ||
          `阶段：${({ idle: "待创作", music_running: "音乐生成中", music_ready: "音乐待选版", planning: "分镜规划中", planned: "分镜已生成", rendering: "镜头制作中", assembling: "合成中", done: "成片已回写", error: "需处理" } as const)[state.status]}`}
      </p>
      {state.error && (
        <p role="alert" className="text-xs text-amber-200">
          {state.error}
        </p>
      )}
    </div>
  );
}
