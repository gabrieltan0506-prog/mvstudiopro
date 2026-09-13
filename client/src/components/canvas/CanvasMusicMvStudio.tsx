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

function audioDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
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
  const music = trpc.mvAnalysis.queueManhuaBgm.useMutation();
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
      if (block.prompt.length > 1000)
        throw new Error("音乐风格说明最多 1000 字，请精简后再生成");
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
      const requestId = crypto.randomUUID();
      const jobId = `bgm_${requestId.replace(/-/g, "")}`;
      patch({
        musicRequestId: requestId,
        musicJobId: jobId,
        musicJobStatus: "queued",
        missingVariants: undefined,
        status: "music_running",
        error: undefined,
      });
      try {
        await music.mutateAsync({
          billingRequestId: requestId,
          brief: {
            model: "suno-v6",
            custom_mode: true,
            instrumental,
            style: block.prompt,
            prompt: instrumental ? block.prompt : source.lyrics!,
            title: "画布音乐",
            duration: Math.round(duration),
            negative_tags: instrumental
              ? "vocals, singing, voice, choir, lyrics"
              : "",
            style_weight: 0.78,
            weirdness_constraint: 0.25,
          },
        });
      } catch (error) {
        const rejected = rejectedMusicSubmissionPatch(
          latest.current,
          requestId,
          error
        );
        if (rejected && alive.current) {
          patch(rejected);
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
        refs
      );
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
      let submission = newVersion ? undefined : source.assembleInput;
      if (!submission) {
        if (!newVersion && source.assembleRequestId)
          throw new Error("原合成缺少输入快照，请查询已保存任务，未重新提交");
        const song = source.candidates.find(
          row => row.id === source.selectedCandidateId
        );
        if (!song || !source.plan || !source.planRequestId)
          throw new Error("缺少已选择的歌曲或分镜");
        const clips = musicMvReadyClips(
          source.plan,
          source.shotBlockIds || [],
          getBlocks()
        );
        submission = {
          requestId: crypto.randomUUID(),
          planRequestId: source.planRequestId,
          audio: song,
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
      <p className="text-xs">音乐 → 选版 → 分镜 → 逐镜制作 → 完整 MV</p>
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
      {state.instrumental === false && (
        <textarea
          className={field}
          rows={5}
          placeholder="完整歌词"
          value={state.lyrics || ""}
          disabled={busy || pendingPlan}
          onChange={e =>
            patch({
              ...invalidateMusicMvPlan(latest.current),
              lyrics: e.target.value,
            })
          }
        />
      )}
      <div className="flex flex-wrap gap-1">
        <button
          className={button}
          disabled={busy || pendingPlan || !!state.musicRequestId}
          onClick={generate}
        >
          生成音乐 · {CANVAS_BGM_CREDITS_PER_RUN} 积分
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
          <audio controls src={candidate.url} className="w-full" />
        </div>
      ))}
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
        分镜依据歌词与创意说明；未进行听音卡点分析。可上传人物、场景参考图供镜头使用。
      </p>
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
