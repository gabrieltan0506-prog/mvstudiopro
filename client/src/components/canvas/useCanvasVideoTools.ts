import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { toast } from "sonner";
import { maskMediaProviderDetails } from "@/lib/maskMediaUrls";
import type { CanvasBlock } from "@/lib/canvasTypes";
import { trpc } from "@/lib/trpc";
import { useVideoEditPrefillGuard, type VideoEditResult } from "./VideoEditPanel";
import { videoEditDurationSec } from "@/lib/videoEditSubmit";
import { createAdvisorVideoEditControl } from "@/lib/advisorVideoEditControl";
import type { AdvisorVideoEditRegistration } from "@/lib/manhuaAdvisorWorkflowControl";
import { submitVideoGrade } from "@/lib/videoGradeSubmit";
import type { MontageGrade } from "@/lib/montageFinish";
import {
  addVideoToolJob,
  applyVideoToolJobResult,
  buildSubmittingVideoToolJob,
  buildVideoToolJob,
  isPostProdJobNotFound,
  readSubmittingVideoToolJobs,
  readVideoToolJobRecords,
  removeSubmittingVideoToolJob,
  resolveSubmittingVideoToolJobsOnce,
  upsertSubmittingVideoToolJob,
  videoToolJobKey,
  measureVideoToolExactSec,
  pendingVideoToolJob,
  pollVideoToolJobsOnce,
  readVideoToolJobs,
  removeVideoToolJob,
  type VideoToolJob,
  type VideoToolJobKind,
} from "@/lib/videoToolJobs";

type BlocksUpdater = CanvasBlock[] | ((prev: CanvasBlock[]) => CanvasBlock[]);

/** 画布视频块是否挂「局部修改 / 调色 / 高清放大」入口（与渲染条件同一处；顾问 videoEdit 清单只列有入口的块）。 */
export function canvasBlockHasVideoTools(block: CanvasBlock): boolean {
  return block.videoModel === "seedance-2.5" && Boolean(block.outputUrl) && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(String(block.outputUrl));
}

export type UseCanvasVideoToolsOptions = {
  /** 本次渲染的画布块。 */
  blocks: CanvasBlock[];
  /** 画布已有的「最新块」与「最新 onBlocksChange」引用（由画布每次渲染写入，本 hook 只读）。 */
  blocksRef: MutableRefObject<CanvasBlock[]>;
  onBlocksChangeRef: MutableRefObject<(blocks: BlocksUpdater) => void>;
  /** 顾问 videoEdit 登记口（同画布 props）。 */
  onAdvisorVideoEditControl?: AdvisorVideoEditRegistration;
  /** 顾问清单里块的可读名（画布左栏节点标题）。 */
  blockLabel: (block: CanvasBlock) => string;
};

/**
 * 画布视频块「局部修改 / 调色」：面板开合与草稿、提交、在途任务与「提交中」记录、刷新后续查、
 * 完成加入新版本、失败提示、顾问 videoEdit 登记与预填闸门。自 FreeformCanvas 原样抽出，画布只保留调用与渲染。
 */
export function useCanvasVideoTools({ blocks, blocksRef, onBlocksChangeRef, onAdvisorVideoEditControl, blockLabel }: UseCanvasVideoToolsOptions) {
  // 调色：面板展开的 block、草稿、来源（原片 / 高清版）、提交中锁；结果作新版本，原片留在 outputUrls。
  // gradeProbedSec：按地址存实测原始秒（局部修改与调色共用），进面板时再按各自规则取一位小数。
  const [gradePanelBlockId, setGradePanelBlockId] = useState<string | null>(null);
  const [gradeDraft, setGradeDraft] = useState<MontageGrade | undefined>(undefined);
  const [gradeUseUpscaled, setGradeUseUpscaled] = useState(false);
  const [gradeProbedSec, setGradeProbedSec] = useState<Record<string, number>>({});
  const [gradeBusyId, setGradeBusyId] = useState<string | null>(null);
  // 局部修改：面板展开的 block（报价/提交在 VideoEditPanel 内）；提交成功任务号记到块上，完成后新版本写入 outputUrls，原片保留
  const [editPanelBlockId, setEditPanelBlockId] = useState<string | null>(null);
  /** 本次挂载已落过的任务（面板 onDone 与刷新后轮询可能命中同一 jobId，提示只出一次；数据层另按产物去重）。 */
  const settledVideoToolJobsRef = useRef(new Set<string>());
  const queuePostProd = trpc.mvAnalysis.queuePostProd.useMutation();
  const postProdUtils = trpc.useUtils();
  const fetchPostProdJob = (jobId: string) => postProdUtils.mvAnalysis.getPostProdJob.fetch({ jobId });
  /** 局部修改按 requestId 查任务（只读；任务号由 requestId 决定性派生）：「提交中」刷新后续查用。 */
  const fetchVideoEditJobByRequest = (requestId: string) => postProdUtils.mvAnalysis.findVideoPartialEditJob.fetch({ requestId });

  /** 调色面板：读实测时长（分段调色按成片秒，同提交时服务端实读）；高清版（CloudFront）提交时由 videoGradeSubmit 先导入。 */
  const openGradePanel = useCallback(
    async (blockId: string) => {
      const block = blocks.find(b => b.id === blockId);
      const src = String(block?.outputUrl || "").trim();
      if (!block || !/^https:\/\//i.test(src)) {
        toast.error("请先生成成片再调色");
        return;
      }
      if (pendingVideoToolJob(block.videoToolJobs, "grade")) {
        toast.error("该视频已有调色在处理，完成后自动作为新版本加入");
        return;
      }
      setGradePanelBlockId(blockId);
      setGradeDraft(undefined);
      setGradeUseUpscaled(false);
      for (const url of [src, String(block.upscaledVideoUrl || "").trim()]) {
        if (!/^https:\/\//i.test(url) || gradeProbedSec[url]) continue;
        const sec = await measureVideoToolExactSec(url);
        if (sec) setGradeProbedSec(prev => ({ ...prev, [url]: sec }));
        else if (url === src) toast.error("读取视频时长失败，请稍后重试");
      }
    },
    [blocks, gradeProbedSec]
  );

  /** 顾问 videoEdit 预填（按块；nonce 变化即覆盖面板内容）。 */
  const [editPrefill, setEditPrefill] = useState<{ blockId: string; startSec: number; endSec: number; promptZh: string; nonce: number }>();
  const editGuard = useVideoEditPrefillGuard();
  const advisorEditLive = useRef({ blocks, sec: gradeProbedSec });
  advisorEditLive.current = { blocks, sec: gradeProbedSec };
  useEffect(() => {
    if (!onAdvisorVideoEditControl) return;
    const cur = () => advisorEditLive.current;
    const srcOf = (b: CanvasBlock) => String(b.outputUrl || "").trim();
    // 只列画布上真有「局部修改」入口且为 https 成片的块（同 openEditPanel 条件），预填才能打开对应面板；
    // 局部修改仍在处理的块不列（入口已锁，防重复提交）
    const videos = () => cur().blocks.filter(b => canvasBlockHasVideoTools(b) && /^https:\/\//i.test(srcOf(b)) && !pendingVideoToolJob(b.videoToolJobs, "edit"));
    const known: Record<string, number> = {};
    const base = createAdvisorVideoEditControl({
      targets: () =>
        videos().flatMap((b, i) => {
          // 实测秒数一位小数向下取（同面板与服务端选段），10.08 → 10.0
          const sec = videoEditDurationSec(cur().sec[srcOf(b)] ?? known[srcOf(b)]);
          return sec ? [{ id: b.id, label: `画布视频块${i + 1}·${blockLabel(b)}`, url: srcOf(b), durationSec: sec }] : [];
        }),
      open: p => {
        setEditPanelBlockId(p.targetId);
        setEditPrefill({ blockId: p.targetId, startSec: p.startSec, endSec: p.endSec, promptZh: p.promptZh, nonce: Date.now() });
      },
    });
    // 面板确认框打开、正在报价、提交或任务进行中时，顾问预填被拒并回中文原因（面板内容不动）
    onAdvisorVideoEditControl(editGuard.withGuard(async (action, signal) => {
      // 未读过时长的已出片视频块先读实测时长（只读元数据，不扣费）
      const missing = videos().map(srcOf).filter(src => !cur().sec[src] && !known[src]);
      const measured = await Promise.all(missing.map(async src => [src, await measureVideoToolExactSec(src)] as const));
      signal.throwIfAborted();
      const got: Record<string, number> = {};
      for (const [src, sec] of measured) if (sec) got[src] = known[src] = sec;
      if (Object.keys(got).length) setGradeProbedSec(prev => ({ ...prev, ...got }));
      return base(action, signal);
    }));
    return () => onAdvisorVideoEditControl(null);
  }, [onAdvisorVideoEditControl]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 局部修改面板：读实测时长（选区间按成片秒，同报价时服务端实读）。仍有局部修改在处理时不再打开（防重复提交）。 */
  const openEditPanel = useCallback(
    async (blockId: string) => {
      const block = blocks.find(b => b.id === blockId);
      const src = String(block?.outputUrl || "").trim();
      if (!block || !/^https:\/\//i.test(src)) {
        toast.error("请先生成成片再局部修改");
        return;
      }
      if (pendingVideoToolJob(block.videoToolJobs, "edit")) {
        toast.error("该视频已有局部修改在处理，完成后自动作为新版本加入");
        return;
      }
      setEditPanelBlockId(blockId);
      if (gradeProbedSec[src]) return;
      const sec = await measureVideoToolExactSec(src);
      if (sec) setGradeProbedSec(prev => ({ ...prev, [src]: sec }));
      else toast.error("读取视频时长失败，请稍后重试");
    },
    [blocks, gradeProbedSec]
  );

  /** 提交成功即把任务号记到块上（随画布保存）；刷新后由下方轮询接管。同 jobId 只记一条。 */
  const trackVideoToolJob = useCallback((blockId: string, job: VideoToolJob | null) => {
    if (!job) return;
    onBlocksChangeRef.current(prev =>
      prev.map(b => (b.id === blockId ? { ...b, videoToolJobs: addVideoToolJob(b.videoToolJobs, job) } : b))
    );
  }, []);

  /** 「提交中」补全为已入队（按 requestId 查到任务号或面板回执先到都走这里）；之后按任务号正常轮询。 */
  const confirmSubmittingVideoEdit = useCallback((blockId: string, requestId: string, jobId: string) => {
    onBlocksChangeRef.current(prev =>
      prev.map(b => {
        if (b.id !== blockId) return b;
        const pending = readSubmittingVideoToolJobs(b.videoToolJobs).find(j => j.requestId === requestId);
        const job = pending && buildVideoToolJob({ kind: "edit", jobId, requestId, sourceUrl: pending.sourceUrl, range: pending.range, now: new Date(pending.startedAt) });
        return job ? { ...b, videoToolJobs: addVideoToolJob(b.videoToolJobs, job) } : b;
      })
    );
  }, []);

  /**
   * 局部修改面板 onSubmitting：入队请求发出前以 requestId 先记「提交中」（随画布与云草稿保存，刷新后按 requestId 续查）；
   * 服务端已回拒绝时按 requestId 核对一次：查到任务就补全，确无任务才清（之后用同一 requestId 重试过的不清）。
   */
  const trackVideoEditSubmitting = useCallback(
    (blockId: string, sourceUrl: string, p: { requestId: string; startSec: number; endSec: number; phase: "sending" | "rejected" }) => {
      if (p.phase === "rejected") {
        const rejectedAt = Date.now();
        void fetchVideoEditJobByRequestRef.current(p.requestId).then(
          data => {
            const jobId = String((data as { jobId?: unknown } | null)?.jobId || "");
            if (jobId) confirmSubmittingVideoEdit(blockId, p.requestId, jobId);
          },
          error => {
            if (!isPostProdJobNotFound(error)) return;
            onBlocksChangeRef.current(prev =>
              prev.map(b => (b.id === blockId ? { ...b, videoToolJobs: removeSubmittingVideoToolJob(b.videoToolJobs, p.requestId, rejectedAt) } : b))
            );
          }
        );
        return;
      }
      const pending = buildSubmittingVideoToolJob({ requestId: p.requestId, sourceUrl, range: { startSec: p.startSec, endSec: p.endSec } });
      if (!pending) return;
      onBlocksChangeRef.current(prev =>
        prev.map(b => (b.id === blockId ? { ...b, videoToolJobs: upsertSubmittingVideoToolJob(b.videoToolJobs, pending) } : b))
      );
    },
    [confirmSubmittingVideoEdit]
  );

  /**
   * 局部修改 / 调色完成：同 eraseCornerMarkForBlock 写法加新版本，原片留在 outputUrls 不覆盖；追踪字段同批清掉。
   * 面板 onDone 与刷新后轮询都走这里：本挂载按 jobId 只落一次，updater 内再按产物去重（多处挂载也不重复加）。
   */
  const applyVideoToolJobOnBlock = useCallback(
    (blockId: string, kind: VideoToolJobKind, jobId: string, url: string, sourceUrl?: string) => {
      if (!jobId || settledVideoToolJobsRef.current.has(jobId)) return;
      settledVideoToolJobsRef.current.add(jobId);
      onBlocksChangeRef.current(prev =>
        prev.map(b => (b.id === blockId ? applyVideoToolJobResult(b, jobId, url, sourceUrl).block : b))
      );
      if (!/^https:\/\//i.test(String(url || "").trim())) return;
      if (kind === "edit") setEditPanelBlockId(cur => (cur === blockId ? null : cur));
      toast.success(kind === "edit" ? "局部修改完成，已作为新版本加入，原片保留" : "调色完成，已作为新版本加入，原片保留");
    },
    []
  );

  /** 失败 / 被拒：提示服务端原句（局部修改即「积分已全额退回」那句），然后清掉追踪字段。 */
  const failVideoToolJobOnBlock = useCallback((blockId: string, jobId: string, message: string) => {
    if (!jobId || settledVideoToolJobsRef.current.has(jobId)) return;
    settledVideoToolJobsRef.current.add(jobId);
    onBlocksChangeRef.current(prev =>
      prev.map(b => (b.id === blockId ? { ...b, videoToolJobs: removeVideoToolJob(b.videoToolJobs, jobId) } : b))
    );
    toast.error(maskMediaProviderDetails(message));
  }, []);

  /** 局部修改面板 onDone（本次挂载内完成）：与刷新后轮询同一落点。 */
  const applyVideoEditForBlock = useCallback(
    (blockId: string, sourceUrl: string, result: VideoEditResult) =>
      applyVideoToolJobOnBlock(blockId, "edit", String(result?.jobId || ""), String(result?.url || ""), sourceUrl),
    [applyVideoToolJobOnBlock]
  );

  /** 轮询一轮（挂载即跑，刷新恢复就是这一轮）：按块上的追踪记录查后期任务，终态落回对应块。 */
  const pollCanvasVideoToolJobs = (pairs: Array<[string, string]>, isCancelled: () => boolean) =>
    pollVideoToolJobsOnce({
      jobs: pairs.flatMap(([blockId, jobId]) => {
        const job = readVideoToolJobs(blocksRef.current.find(b => b.id === blockId)?.videoToolJobs).find(j => j.jobId === jobId);
        return job ? [{ ...job, blockId }] : [];
      }),
      fetchJob: fetchPostProdJob,
      isCancelled,
      onSettled: (job, outcome) =>
        outcome.status === "succeeded"
          ? applyVideoToolJobOnBlock(job.blockId, job.kind, job.jobId, outcome.url)
          : failVideoToolJobOnBlock(job.blockId, job.jobId, outcome.message),
    });
  const pollCanvasVideoToolJobsRef = useRef(pollCanvasVideoToolJobs);
  pollCanvasVideoToolJobsRef.current = pollCanvasVideoToolJobs;
  const fetchVideoEditJobByRequestRef = useRef(fetchVideoEditJobByRequest);
  fetchVideoEditJobByRequestRef.current = fetchVideoEditJobByRequest;
  /**
   * 「提交中」核对一轮（挂载即跑）：按 requestId 查到任务号就补全、转入上面的按任务号轮询；
   * 过了宽限仍查不到（请求没发出去或服务端未受理）才清掉并提示，可重新发起。
   */
  const resolveCanvasSubmittingVideoEdits = (pairs: Array<[string, string]>, isCancelled: () => boolean) =>
    resolveSubmittingVideoToolJobsOnce({
      jobs: pairs.flatMap(([blockId, key]) => {
        const job = readSubmittingVideoToolJobs(blocksRef.current.find(b => b.id === blockId)?.videoToolJobs).find(j => videoToolJobKey(j) === key);
        return job ? [{ ...job, blockId }] : [];
      }),
      findByRequest: fetchVideoEditJobByRequestRef.current,
      isCancelled,
      onFound: (job, jobId) => confirmSubmittingVideoEdit(job.blockId, job.requestId, jobId),
      onMissing: job => {
        onBlocksChangeRef.current(prev =>
          prev.map(b => (b.id === job.blockId ? { ...b, videoToolJobs: removeSubmittingVideoToolJob(b.videoToolJobs, job.requestId, Date.parse(job.startedAt)) } : b))
        );
        toast.error("这次局部修改没有提交成功，未生成新版本，可重新发起");
      },
    });
  const resolveCanvasSubmittingVideoEditsRef = useRef(resolveCanvasSubmittingVideoEdits);
  resolveCanvasSubmittingVideoEditsRef.current = resolveCanvasSubmittingVideoEdits;
  // 局部修改 / 调色在途任务统一轮询（含刷新恢复：追踪字段随画布持久化，挂载即接管）；deps 用任务键串，不随画布重渲重建。
  const activeVideoToolJobKey = JSON.stringify(
    blocks.flatMap(b => readVideoToolJobRecords(b.videoToolJobs).map(j => [b.id, videoToolJobKey(j)]))
  );
  useEffect(() => {
    const pairs = JSON.parse(activeVideoToolJobKey) as Array<[string, string]>;
    if (!pairs.length) return;
    let cancelled = false;
    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        await pollCanvasVideoToolJobsRef.current(pairs, () => cancelled);
        await resolveCanvasSubmittingVideoEditsRef.current(pairs, () => cancelled);
      } finally {
        inFlight = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeVideoToolJobKey]);

  /**
   * 单片调色：提交后期 concat（单片 + grade）→ 任务号记到块上（随画布保存）→ 由在途任务轮询等结果
   * （刷新后同样接管）→ 新版本写入 outputUrls，提交时的原片留在历史不覆盖。同块已有调色在处理时不再提交。
   */
  const startGradeForBlock = useCallback(
    async (blockId: string, grade: MontageGrade | undefined, useUpscaled: boolean) => {
      const block = blocks.find(b => b.id === blockId);
      const original = String(block?.outputUrl || "").trim();
      const src = useUpscaled ? String(block?.upscaledVideoUrl || "").trim() : original;
      if (!block || !/^https:\/\//i.test(src)) {
        toast.error(useUpscaled ? "高清版尚未生成，无法调色" : "请先生成成片再调色");
        return;
      }
      if (!grade) {
        toast.error("请先设置调色参数");
        return;
      }
      if (gradeBusyId) return;
      if (pendingVideoToolJob(block.videoToolJobs, "grade")) {
        toast.error("该视频已有调色在处理，完成后自动作为新版本加入");
        return;
      }
      setGradeBusyId(blockId);
      try {
        const requestId = crypto.randomUUID();
        const jobId = await submitVideoGrade(
          { videoUrl: src, grade, scopeKey: `canvas-grade:${blockId}`.slice(0, 128) },
          { queue: input => queuePostProd.mutateAsync(input) }
        );
        // 历史里留提交时的原片（调高清版时也是原片，不把高清临时链写进 outputUrls）
        const job = buildVideoToolJob({ kind: "grade", jobId, requestId, sourceUrl: original || src });
        if (!job) throw new Error("调色已提交，但未能记下任务，请勿重复提交，稍后到后期任务记录查看结果");
        trackVideoToolJob(blockId, job);
        setGradePanelBlockId(null);
        toast.success("调色已提交，完成后作为新版本加入，原片保留");
      } catch (e: unknown) {
        toast.error(e instanceof Error ? maskMediaProviderDetails(e.message) : "调色提交失败");
      } finally {
        setGradeBusyId(null);
      }
    },
    [blocks, gradeBusyId, queuePostProd, trackVideoToolJob]
  );

  return {
    gradePanelBlockId,
    setGradePanelBlockId,
    gradeDraft,
    setGradeDraft,
    gradeUseUpscaled,
    setGradeUseUpscaled,
    gradeProbedSec,
    gradeBusyId,
    editPanelBlockId,
    setEditPanelBlockId,
    editPrefill,
    editGuard,
    openGradePanel,
    openEditPanel,
    startGradeForBlock,
    trackVideoToolJob,
    trackVideoEditSubmitting,
    applyVideoEditForBlock,
  };
}
