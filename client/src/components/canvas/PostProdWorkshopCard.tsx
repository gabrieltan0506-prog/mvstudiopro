/**
 * 后期工坊卡(成片坞内):拼接 / BGM 贴装 / 响度验收,纯 ffmpeg 零积分。
 * 任务记录以服务端 jobs 为主来源(listPostProdJobs 恢复),localStorage 仅作
 * 用户级显示缓存(按 uid 分 key);拼接/BGM 产物直接进入下一道工序(gcsUri 优先)。
 * 未接通的工序(改画面保声/重拍一镜)按反空壳约定画成灰禁用,不冒充可用。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Film, Layers, Loader2,
  Maximize2,
  Music4,
  Plus,
  Scissors,
  Trash2,
  Volume2,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { copyText } from "@/lib/copyText";
import type { CanvasBlock } from "@/lib/canvasTypes";
import {
  fetchVideoUpscaleStatus,
  isVideoUpscaleTerminal,
  probeVideoDurationSec,
  startVideoUpscale,
  type VideoUpscaleTaskStatus,
  videoUpscaleStatusLabel,
} from "@/lib/videoUpscaleApi";
import { canvasVideoUpscaleCredits } from "@shared/canvasGenerationPricing";
import {
  beatTableToVolumeExpr,
  buildBeatTable,
  buildBgmAlignment,
  type BgmStructure,
  type FilmEvent,
  type FilmEventKind,
} from "@shared/manhuaBeatTable";
import {
  canSubmitManhuaBgm,
  clearPendingManhuaBgmJob,
  readManhuaBgmVariants,
  readPendingManhuaBgmJob,
  writePendingManhuaBgmJob,
  type ManhuaBgmPendingJob,
  type ManhuaBgmVariant,
} from "@/lib/manhuaBgmCardState";
import { canMountBgmNow, canUpscaleNow } from "@/lib/manhuaDeliveryOrder";
import {
  ACTION_LABEL,
  buildPostProdClipOptions,
  jobsStorageKey,
  loadStoredJobs,
  mergeClipOptions,
  mergeRemoteJobs,
  persistJobs,
  shouldNotifyTerminal,
  type PostProdJobStatus,
  type TrackedJob,
} from "@/lib/postProdWorkshop";

const AUDIO_EXT_RE = /\.(mp3|wav|m4a|aac|flac|ogg)(\?|$)/i;

type TrackedUpscale = {
  taskId: string;
  sourceUrl: string;
  sourceLabel: string;
  target: "2k" | "4k";
  status: VideoUpscaleTaskStatus;
  createdAt: number;
  episodeIndex?: number;
  creditsUsed?: number;
  videoUrl?: string;
  error?: string;
  };

function upscaleStorageKey(userId: string): string {
  return `postProd.upscale.v1.u${userId}`;
}

function loadTrackedUpscales(userId: string): TrackedUpscale[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(upscaleStorageKey(userId)) || "[]"
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is TrackedUpscale => {
        if (!item || typeof item !== "object") return false;
        const row = item as Partial<TrackedUpscale>;
        return (
          typeof row.taskId === "string" &&
          typeof row.sourceUrl === "string" &&
          (row.target === "2k" || row.target === "4k") &&
          typeof row.status === "string"
        );
      })
      .slice(0, 12);
  } catch {
    return [];
  }
}

type PostProdWorkshopCardProps = {
  blocks: CanvasBlock[];
  userId: string;
  userRole?: string | null;
};

type EditableBgmBrief = {
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

function statusBadge(status: PostProdJobStatus): { text: string; cls: string } {
  switch (status) {
    case "succeeded":
      return {
        text: "完成",
        cls: "border-emerald-400/40 bg-emerald-500/10 text-emerald-100",
      };
    case "failed":
      return {
        text: "失败",
        cls: "border-red-400/40 bg-red-500/10 text-red-100",
      };
    default:
      return {
        text: "处理中",
        cls: "border-amber-400/40 bg-amber-500/10 text-amber-100",
      };
  }
}

export default function PostProdWorkshopCard({
  blocks,
  userId,
  userRole,
}: PostProdWorkshopCardProps) {
  const queueMutation = trpc.mvAnalysis.queuePostProd.useMutation();
  const draftBgmMutation = trpc.mvAnalysis.draftManhuaBgmBrief.useMutation();
  const queueBgmMutation = trpc.mvAnalysis.queueManhuaBgm.useMutation();
  const utils = trpc.useUtils();
  const storageKey = useMemo(() => jobsStorageKey(userId), [userId]);
  const canUseScoringRoom = userRole === "admin" || userRole === "supervisor";

  /** 画布成片:视频节点已出片的(签名链走 jobs 证据放行) */
  const blockClipOptions = useMemo(
    () =>
      blocks
        .filter(b => b.kind === "video" && String(b.outputUrl || "").trim())
        .map(b => ({
          id: b.id,
          url: String(b.outputUrl).trim(),
          label:
            (Number(b.episodeIndex) > 0 ? `第${b.episodeIndex}集 · ` : "") +
            (String(b.prompt || "")
              .trim()
              .slice(0, 24) || b.id.slice(0, 12)),
        })),
    [blocks]
  );

  /** 音频素材:各节点上传里的音频文件(uploads/u<uid>/ 前缀放行) */
  const audioOptions = useMemo(() => {
    const out: Array<{ id: string; url: string; label: string }> = [];
    for (const b of blocks) {
      for (const a of b.uploadedAssets ?? []) {
        const isAudio =
          a.kind === "audio" ||
          AUDIO_EXT_RE.test(a.fileName || "") ||
          AUDIO_EXT_RE.test(a.url || "");
        if (!isAudio) continue;
        const url = String(a.gcsUri || a.url || "").trim();
        if (!url) continue;
        out.push({ id: a.id, url, label: a.fileName || a.id.slice(0, 16) });
      }
    }
    return out;
  }, [blocks]);

  const defaultStoryContext = useMemo(
    () =>
      blocks
        .filter(block => block.kind === "text" || block.kind === "video")
        .map(block => String(block.prompt || block.outputText || "").trim())
        .filter(Boolean)
        .join("\n")
        .slice(0, 900),
    [blocks]
  );
  const [scoreStoryZh, setScoreStoryZh] = useState(() => defaultStoryContext);
  const [scoreDurationSec, setScoreDurationSec] = useState(30);
  const [scoreBrief, setScoreBrief] = useState<EditableBgmBrief | null>(null);
  const [bgmPending, setBgmPending] = useState<ManhuaBgmPendingJob | null>(() =>
    readPendingManhuaBgmJob(localStorage, Date.now(), userId)
  );
  const [generatedBgmVariants, setGeneratedBgmVariants] = useState<
    ManhuaBgmVariant[]
  >([]);
  const [selectedBgmVariant, setSelectedBgmVariant] = useState<number | null>(
    null
  );
  const [filmEvents, setFilmEvents] = useState<FilmEvent[]>([]);
  const [bgmSeekSec, setBgmSeekSec] = useState(0);
  const [bgmVolumeExpr, setBgmVolumeExpr] = useState<string | undefined>();
  const [beatPreview, setBeatPreview] = useState<
    ReturnType<typeof buildBeatTable>
  >([]);

  const bgmJobsQuery = trpc.mvAnalysis.listManhuaBgmJobs.useQuery(
    { limit: 10 },
    {
      enabled: canUseScoringRoom,
      retry: false,
      refetchInterval: 5_000,
      refetchOnWindowFocus: true,
    }
  );
  useEffect(() => {
    if (!canUseScoringRoom || !bgmJobsQuery.data) return;
    const rows = bgmJobsQuery.data;
    const active = rows.find(
      row => row.status === "queued" || row.status === "running"
    );
    if (active) {
      const local = readPendingManhuaBgmJob(localStorage, Date.now(), userId);
      const next: ManhuaBgmPendingJob = {
        jobId: active.jobId,
        billingRequestId:
          local?.jobId === active.jobId ? local.billingRequestId : active.jobId,
        titleZh: active.titleZh,
        durationSec: active.durationSec,
        createdAtMs:
          local?.jobId === active.jobId ? local.createdAtMs : Date.now(),
      };
      setBgmPending(next);
      writePendingManhuaBgmJob(localStorage, next, userId);
    } else {
      setBgmPending(null);
      clearPendingManhuaBgmJob(localStorage, userId);
    }
    const succeeded = rows.find(
      row => row.status === "succeeded" && row.variants.length > 0
    );
    if (succeeded) {
      setGeneratedBgmVariants(
        readManhuaBgmVariants({ variants: succeeded.variants })
      );
    }
  }, [bgmJobsQuery.data, canUseScoringRoom, userId]);

  const latestBgmFailure = useMemo(
    () => bgmJobsQuery.data?.find(row => row.status === "failed") ?? null,
    [bgmJobsQuery.data]
  );

  const scoringAudioOptions = useMemo(
    () => [
      ...generatedBgmVariants.map(variant => ({
        id: `generated-bgm-${variant.index}`,
        url: variant.gcsUri,
        label: `生成配乐 · 变体 ${variant.index + 1}`,
      })),
      ...audioOptions,
    ],
    [audioOptions, generatedBgmVariants]
  );

  useEffect(() => {
    if (selectedBgmVariant == null) return;
    const variant = generatedBgmVariants.find(
      row => row.index === selectedBgmVariant
    );
    if (
      !variant?.structure ||
      filmEvents.length === 0 ||
      scoreDurationSec <= 0
    ) {
      setBgmEntrySec(0);
      setBgmSeekSec(0);
      setBgmVolumeExpr(undefined);
      setBeatPreview([]);
      return;
    }
    const alignment = buildBgmAlignment(variant.structure, filmEvents);
    const rows = buildBeatTable({
      structure: variant.structure,
      events: filmEvents,
      entrySec: alignment.entrySec,
      bgmSeekSec: alignment.seekSec,
      filmDurationSec: scoreDurationSec,
    });
    setBgmEntrySec(alignment.entrySec);
    setBgmSeekSec(alignment.seekSec);
    setBgmVolumeExpr(beatTableToVolumeExpr(rows));
    setBeatPreview(rows);
  }, [filmEvents, generatedBgmVariants, scoreDurationSec, selectedBgmVariant]);

  // ---- 工序表单状态 ----
  const [concatSel, setConcatSel] = useState<string[]>([]);
  const [concatRes, setConcatRes] = useState<"720p" | "1080p">("720p");
  const [bgmVideoUrl, setBgmVideoUrl] = useState("");
  const [bgmAudioUrl, setBgmAudioUrl] = useState("");
  const [bgmVolume, setBgmVolume] = useState(0.48);
  const [bgmEntrySec, setBgmEntrySec] = useState(0);
  const [bgmFadeIn, setBgmFadeIn] = useState(0.5);
  const [bgmFadeOut, setBgmFadeOut] = useState(1);
  const [loudVideoUrl, setLoudVideoUrl] = useState("");
  const [upscaleVideoUrl, setUpscaleVideoUrl] = useState("");
  const [upscaleProbedSec, setUpscaleProbedSec] = useState<number | null>(null);
  const [upscaleProbeBusy, setUpscaleProbeBusy] = useState(false);
  const [upscaleSubmitBusy, setUpscaleSubmitBusy] = useState(false);
  const [upscaleJobs, setUpscaleJobs] = useState<TrackedUpscale[]>(() =>
    loadTrackedUpscales(userId)
  );
  const upscaleJobsRef = useRef(upscaleJobs);
  upscaleJobsRef.current = upscaleJobs;

  useEffect(() => {
    try {
      localStorage.setItem(
        upscaleStorageKey(userId),
        JSON.stringify(upscaleJobs.slice(0, 12))
      );
    } catch {
      /* localStorage 不可用时，当前页面仍可继续轮询。 */
    }
  }, [upscaleJobs, userId]);

  useEffect(() => {
    setUpscaleProbedSec(null);
  }, [upscaleVideoUrl]);

  /** 超分任务由服务端持久化；本地只保存 taskId，刷新后继续查询同一任务，绝不重复提交。 */
  const upscalePollingRef = useRef(false);
  const upscaleNotifiedRef = useRef(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (upscalePollingRef.current) return;
      const pending = upscaleJobsRef.current.filter(
        job => !isVideoUpscaleTerminal(job.status)
      );
      if (!pending.length) return;
      upscalePollingRef.current = true;
      try {
        for (const job of pending) {
          try {
            const snapshot = await fetchVideoUpscaleStatus(job.taskId);
            if (cancelled) return;
            setUpscaleJobs(prev =>
              prev.map(row =>
                row.taskId === job.taskId
                  ? {
                      ...row,
                      status: snapshot.status,
                      videoUrl: snapshot.videoUrl || row.videoUrl,
                      error: snapshot.error,
                      creditsUsed: snapshot.creditsUsed || row.creditsUsed,
                    }
                  : row
              )
            );
            if (
              snapshot.status === "succeeded" &&
              snapshot.videoUrl &&
              !upscaleNotifiedRef.current.has(job.taskId)
            ) {
              upscaleNotifiedRef.current.add(job.taskId);
              setBgmVideoUrl(snapshot.videoUrl);
              setLoudVideoUrl(snapshot.videoUrl);
              toast.success(`高清版已完成（${job.target.toUpperCase()}）`, {
                description: "已自动加入 BGM 贴装与响度验收的成片列表。",
              });
            } else if (
              (snapshot.status === "failed" ||
                snapshot.status === "reconcile_manual") &&
              !upscaleNotifiedRef.current.has(job.taskId)
            ) {
              upscaleNotifiedRef.current.add(job.taskId);
              toast.error(videoUpscaleStatusLabel(snapshot.status), {
                description: snapshot.error || undefined,
              });
            }
          } catch {
            /* 查询错误视为瞬态；服务端任务仍在，下一轮继续查同一 taskId。 */
          }
        }
      } finally {
        upscalePollingRef.current = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 5_000);
    return () => {
      cancelled = true;
      upscalePollingRef.current = false;
      window.clearInterval(timer);
    };
  }, []);

  const [jobs, setJobs] = useState<TrackedJob[]>(() =>
    loadStoredJobs(jobsStorageKey(userId), localStorage)
  );
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const updateJobs = useCallback(
    (updater: (prev: TrackedJob[]) => TrackedJob[]) => {
      setJobs(prev => {
        const next = updater(prev);
        persistJobs(storageKey, next, localStorage);
        return next;
      });
    },
    [storageKey]
  );

  /** 服务端为主来源:挂载/回焦拉取本人任务列表,缓存清空后由此恢复 */
  const jobsQuery = trpc.mvAnalysis.listPostProdJobs.useQuery(
    { limit: 30 },
    { enabled: Boolean(userId), retry: false, refetchOnWindowFocus: true }
  );
  useEffect(() => {
    const data = jobsQuery.data;
    if (!data) return;
    updateJobs(prev =>
      mergeRemoteJobs(
        prev,
        data
          .filter((r): r is NonNullable<typeof r> => r != null)
          .map(r => ({
            jobId: r.jobId,
            action: r.action,
            status: r.status,
            output: r.output,
            error: r.error,
            createdAt: r.createdAt as unknown,
          }))
      )
    );
  }, [jobsQuery.data, updateJobs]);

  /** 15s 轮询未终态任务:上一轮未结束不开下一轮;终态只提示一次;403/404 收敛为失败 */
  const pollingRef = useRef(false);
  const notifiedJobsRef = useRef(new Set<string>());
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        const pending = jobsRef.current.filter(
          j => j.status !== "succeeded" && j.status !== "failed"
        );
        for (const job of pending) {
          try {
            const res = await utils.mvAnalysis.getPostProdJob.fetch({
              jobId: job.jobId,
            });
            if (cancelled || !res) return;
            const nextOutput =
              res.output &&
              typeof res.output === "object" &&
              !Array.isArray(res.output)
                ? (res.output as Record<string, unknown>)
                : null;
            updateJobs(prev =>
              prev.map(j =>
                j.jobId === job.jobId
                  ? {
                      ...j,
                      status: (res.status as PostProdJobStatus) || j.status,
                      // 服务端明确返回 null 时清除旧缓存,不继续使用旧产物
                      output: nextOutput,
                      error: res.error ?? null,
                    }
                  : j
              )
            );
            if (
              shouldNotifyTerminal(
                notifiedJobsRef.current,
                job.jobId,
                res.status
              )
            ) {
              if (res.status === "succeeded") {
                toast.success(`后期任务完成：${job.label}`);
              } else {
                toast.error(`后期任务未完成：${job.label}`, {
                  description: res.error || undefined,
                });
              }
            }
          } catch (error) {
            const httpStatus = Number(
              (error as { data?: { httpStatus?: unknown } })?.data?.httpStatus
            );
            if (httpStatus === 403 || httpStatus === 404) {
              // 记录当前不可用(被清理/无权):收敛为失败,停止后续轮询
              updateJobs(prev =>
                prev.map(j =>
                  j.jobId === job.jobId
                    ? { ...j, status: "failed", error: "任务记录当前不可用" }
                    : j
                )
              );
            }
            /* 其余错误视为瞬态,下一轮再试 */
          }
        }
      } finally {
        pollingRef.current = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 15_000);
    return () => {
      cancelled = true;
      pollingRef.current = false;
      window.clearInterval(timer);
    };
  }, [updateJobs, utils]);

  /** 后期产物直接进入下一道工序(gcsUri 优先);与画布成片合并去重 */
  const postProdClipOptions = useMemo(
    () => buildPostProdClipOptions(jobs),
    [jobs]
  );
  const upscaleClipOptions = useMemo(
    () =>
      upscaleJobs
        .filter(job => job.status === "succeeded" && job.videoUrl)
        .map(job => ({
          id: `upscale:${job.taskId}`,
          url: job.videoUrl!,
          label: `${job.target.toUpperCase()} 高清版 · ${job.sourceLabel}`,
        })),
    [upscaleJobs]
  );
  const clipOptions = useMemo(
    () =>
      mergeClipOptions(
        [...upscaleClipOptions, ...postProdClipOptions],
        blockClipOptions
      ),
    [upscaleClipOptions, postProdClipOptions, blockClipOptions]
  );

  const submit = useCallback(
    async (
      input:
        | {
            action: "concat";
            params: {
              clips: string[];
              width: number;
              height: number;
              fps: number;
            };
          }
        | {
            action: "bgm_mount";
            params: {
              videoUri: string;
              bgmUri: string;
              bgmVolume: number;
              entrySec: number;
              bgmSeekSec: number;
              volumeExpr?: string;
              fadeInSec: number;
              fadeOutSec: number;
            };
          }
        | {
            action: "loudness_check";
            params: { videoUri: string; windows: [] };
          },
      label: string
    ) => {
      try {
        const res = await queueMutation.mutateAsync(input);
        updateJobs(prev => [
          {
            jobId: res.jobId,
            action: input.action,
            label,
            status: "queued",
            createdAt: Date.now(),
          },
          ...prev,
        ]);
        toast.success(`已入队：${label}`, { description: `单号 ${res.jobId}` });
      } catch (e) {
        toast.error("入队失败", {
          description: e instanceof Error ? e.message : "素材地址无法核对,请重新选择",
        });
      }
    },
    [queueMutation, updateJobs],
  );

  const submitConcat = () => {
    const urls = concatSel
      .map((id) => clipOptions.find((c) => c.id === id)?.url)
      .filter((u): u is string => Boolean(u));
    if (urls.length < 2) {
      toast.error("拼接至少选 2 段成片(按点选顺序拼)");
      return;
    }
    const [width, height] = concatRes === "1080p" ? [1920, 1080] : [1280, 720];
    void submit(
      { action: "concat", params: { clips: urls, width, height, fps: 30 } },
      `拼接 ${urls.length} 段(${concatRes})`
    );
  };

  const probeUpscaleSource = async () => {
    if (!upscaleVideoUrl || upscaleProbeBusy) return;
    setUpscaleProbeBusy(true);
    try {
      const sec = await probeVideoDurationSec(upscaleVideoUrl);
      if (!sec) throw new Error("读取视频真实时长失败，请检查成片链接后重试");
      setUpscaleProbedSec(sec);
    } catch (error) {
      setUpscaleProbedSec(null);
      toast.error(error instanceof Error ? error.message : "读取视频时长失败");
    } finally {
      setUpscaleProbeBusy(false);
    }
  };

  const submitUpscale = async (target: "2k" | "4k") => {
    if (!upscaleVideoUrl || !upscaleProbedSec || upscaleSubmitBusy) {
      toast.error("请先选择成片并读取真实时长");
      return;
    }
    const bgmMounted = jobs.some(job => {
      if (
        job.action !== "bgm_mount" ||
        job.status !== "succeeded" ||
        !job.output
      )
        return false;
      const output = job.output as { url?: unknown; gcsUri?: unknown };
      return [output.url, output.gcsUri].some(
        value => String(value || "").trim() === upscaleVideoUrl
      );
    });
    const deliveryDecision = canUpscaleNow({
      surface: "manhua_factory",
      hasDeliveryVideo: true,
      bgmMounted,
      target,
    });
    if (!deliveryDecision.ok) {
      toast.error(deliveryDecision.reasonZh);
      return;
    }
    const directBlock = blocks.find(
      block => String(block.outputUrl || "").trim() === upscaleVideoUrl
    );
    const episodeIndex =
      directBlock && Number(directBlock.episodeIndex) > 0
        ? Math.floor(Number(directBlock.episodeIndex))
        : undefined;
    const credits = canvasVideoUpscaleCredits(target, upscaleProbedSec, {
      freeform: !episodeIndex,
    });
    if (
      !window.confirm(
        `确认提交 ${target.toUpperCase()} 高清放大？\n视频 ${upscaleProbedSec} 秒，预计扣 ${credits} 积分。\n任务创建后将按同一 taskId 恢复，不会因刷新重复提交。`
      )
    ) {
      return;
    }
    setUpscaleSubmitBusy(true);
    try {
      const option = clipOptions.find(item => item.url === upscaleVideoUrl);
      const started = await startVideoUpscale({
        videoUrl: upscaleVideoUrl,
        target,
        durationSec: upscaleProbedSec,
        episodeIndex,
        sourceResolution: directBlock?.videoResolution || "720p",
      });
      setUpscaleJobs(prev =>
        [
          {
            taskId: started.taskId,
            sourceUrl: upscaleVideoUrl,
            sourceLabel: option?.label || "成片",
            target,
            status: started.status,
            createdAt: Date.now(),
            episodeIndex,
            creditsUsed: started.creditsUsed,
          },
          ...prev.filter(item => item.taskId !== started.taskId),
        ].slice(0, 12)
      );
      toast.success(
        `高清放大已提交（${target.toUpperCase()} · ${started.creditsUsed} 积分）`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "高清放大提交失败");
    } finally {
      setUpscaleSubmitBusy(false);
    }
  };

  const draftScoringBrief = async () => {
    if (!scoreStoryZh.trim()) {
      toast.error("先填写剧情与情绪推进");
      return;
    }
    try {
      const result = await draftBgmMutation.mutateAsync({
        laneZh: "自定义剧情",
        durationSec: scoreDurationSec,
        moods: ["蓄力", "冲突", "反转", "收束"],
        moodArcZh: scoreStoryZh.trim(),
        titleZh: "剧情配乐",
        endingZh: "尾钩前收住，不泄尽",
        hasSilenceBreak: filmEvents.some(event => event.kind === "静音停顿"),
      });
      setScoreBrief(result.brief as EditableBgmBrief);
      toast.success("配乐 brief 已起草，可先修改再确认");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "配乐 brief 起草失败"
      );
    }
  };

  const queueScoringBrief = async () => {
    const gate = canSubmitManhuaBgm({
      hasDraft: Boolean(scoreBrief),
      pending: bgmPending,
      durationSec: scoreBrief?.duration ?? 0,
    });
    if (!gate.ok) {
      toast.error(gate.reasonZh);
      return;
    }
    if (!scoreBrief || queueBgmMutation.isPending) return;
    if (
      !window.confirm(
        "确认生成这条配乐？本次会建立一张上游音乐任务，刷新后继续原单。"
      )
    ) {
      return;
    }
    const billingRequestId = crypto.randomUUID();
    try {
      const result = await queueBgmMutation.mutateAsync({
        billingRequestId,
        brief: scoreBrief,
      });
      const pending: ManhuaBgmPendingJob = {
        jobId: result.jobId,
        billingRequestId,
        titleZh: result.titleZh,
        durationSec: result.durationSec,
        createdAtMs: Date.now(),
      };
      setBgmPending(pending);
      writePendingManhuaBgmJob(localStorage, pending, userId);
      await bgmJobsQuery.refetch();
      toast.success("配乐已入队", { description: `单号 ${result.jobId}` });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "配乐任务未建立");
    }
  };

  const applyGeneratedBgmVariant = (variant: ManhuaBgmVariant) => {
    setSelectedBgmVariant(variant.index);
    setBgmAudioUrl(variant.gcsUri);
    const structure = variant.structure as BgmStructure | null;
    if (!structure || filmEvents.length === 0 || scoreDurationSec <= 0) {
      setBgmEntrySec(0);
      setBgmSeekSec(0);
      setBgmVolumeExpr(undefined);
      setBeatPreview([]);
      toast.success(`已选择变体 ${variant.index + 1}`, {
        description: "已写入 BGM 贴装；添加真实画面事件后可生成卡点表。",
      });
      return;
    }
    const alignment = buildBgmAlignment(structure, filmEvents);
    const rows = buildBeatTable({
      structure,
      events: filmEvents,
      entrySec: alignment.entrySec,
      bgmSeekSec: alignment.seekSec,
      filmDurationSec: scoreDurationSec,
    });
    setBgmEntrySec(alignment.entrySec);
    setBgmSeekSec(alignment.seekSec);
    setBgmVolumeExpr(beatTableToVolumeExpr(rows));
    setBeatPreview(rows);
    toast.success(`变体 ${variant.index + 1} 已写入 BGM 贴装与卡点表`);
  };

  const addFilmEvent = () => {
    setFilmEvents(events => [
      ...events,
      { atSec: 0, durationSec: 0.5, kind: "断裂点", descZh: "真实画面事件" },
    ]);
  };

  const patchFilmEvent = (index: number, patch: Partial<FilmEvent>) => {
    setFilmEvents(events =>
      events.map((event, eventIndex) =>
        eventIndex === index ? { ...event, ...patch } : event
      )
    );
  };

  const submitBgm = () => {
    if (!bgmVideoUrl || !bgmAudioUrl) {
      toast.error("BGM 贴装需要选一段成片和一条音频");
      return;
    }
    const pendingUpscale = upscaleJobs.find(
      job =>
        job.sourceUrl === bgmVideoUrl && !isVideoUpscaleTerminal(job.status)
    );
    const deliveryDecision = canMountBgmNow({
      surface: "manhua_factory",
      hasDeliveryVideo: true,
      wantsUpscale: Boolean(pendingUpscale),
      upscaleCompleted: false,
      upscaleTarget: pendingUpscale?.target,
    });
    if (!deliveryDecision.ok) {
      toast.error(deliveryDecision.reasonZh);
      return;
    }
    if (
      deliveryDecision.warnZh &&
      !window.confirm(`${deliveryDecision.warnZh}\n仍然直接贴 BGM 吗？`)
    ) {
      return;
    }
    void submit(
      {
        action: "bgm_mount",
        params: {
          videoUri: bgmVideoUrl,
          bgmUri: bgmAudioUrl,
          bgmVolume,
          entrySec: bgmEntrySec,
          bgmSeekSec,
          ...(bgmVolumeExpr ? { volumeExpr: bgmVolumeExpr } : {}),
          fadeInSec: bgmFadeIn,
          fadeOutSec: bgmFadeOut,
        },
      },
      "BGM 贴装"
    );
  };

  const submitLoudness = () => {
    if (!loudVideoUrl) {
      toast.error("响度验收需要选一段成片");
      return;
    }
    void submit(
      {
        action: "loudness_check",
        params: { videoUri: loudVideoUrl, windows: [] },
      },
      "响度验收"
    );
  };

  const toggleConcat = (id: string) => {
    setConcatSel(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const busy = queueMutation.isPending;

  const selectCls =
    "w-full rounded-lg border border-white/12 bg-black/40 px-2 py-1.5 text-[12px] text-white";
  const numCls =
    "w-20 rounded-lg border border-white/12 bg-black/40 px-2 py-1 text-[12px] text-white";
  const goCls =
    "inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/45 bg-cyan-500/15 px-3 py-1.5 text-[12px] font-semibold text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-45";

  const renderJobOutput = (job: TrackedJob) => {
    if (job.status !== "succeeded" || !job.output) return null;
    if (job.action === "loudness_check") {
      const o = job.output as {
        status?: string;
        integratedLufs?: number | null;
        durationSec?: number;
      };
      return (
        <span className="text-[11px] text-white/60">
          {o.status === "no_audio"
            ? "无音轨"
            : `整体 ${o.integratedLufs} LUFS · ${o.durationSec}s`}
        </span>
      );
    }
    const url = String((job.output as { url?: unknown }).url || "");
    const gcsUri = String((job.output as { gcsUri?: unknown }).gcsUri || "");
    if (!url) return null;
    return (
      <span className="inline-flex items-center gap-2">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-cyan-200 underline underline-offset-2"
        >
          打开成品
        </a>
        {gcsUri ? (
          <button
            type="button"
            className="rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white/70 hover:bg-white/[0.08]"
            onClick={() =>
              void copyText(gcsUri).then(ok =>
                ok
                  ? toast.success("gs:// 地址已复制(可作下一道工序素材)")
                  : toast.error("复制失败")
              )
            }
          >
            复制 gs://
          </button>
        ) : null}
      </span>
    );
  };

  return (
    <div
      data-postprod-workshop
      className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Film className="h-4 w-4 text-cyan-300" />
        <span className="text-[14px] font-bold text-white">后期工坊</span>
        <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-px text-[10px] font-semibold text-emerald-100">
          拼接 / 贴装 / 响度 0 积分
        </span>
        <span className="text-[11px] text-white/45">
          高清放大按秒计费；产物落云端，顺序固定为成片 → 2K/4K → BGM → 响度验收
        </span>
      </div>

      {canUseScoringRoom ? (
        <div className="mt-3 rounded-xl border border-fuchsia-300/20 bg-fuchsia-500/[0.06] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
                <Music4 className="h-3.5 w-3.5 text-fuchsia-200" /> 漫剧配乐间
              </div>
              <p className="mt-1 text-[11px] text-white/45">
                剧情起草 brief → 确认生成 → 全变体入库 → 选择后写入 BGM
                贴装与卡点表。
              </p>
            </div>
            {bgmPending ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100">
                <Loader2 className="h-3 w-3 animate-spin" /> 配乐处理中 ·{" "}
                {bgmPending.jobId.slice(0, 10)}…
              </span>
            ) : null}
          </div>

          {!bgmPending && latestBgmFailure ? (
            <div className="mt-2 rounded-lg border border-red-300/25 bg-red-500/10 px-2 py-1.5 text-[10px] leading-4 text-red-100/90">
              上次配乐未完成 · {latestBgmFailure.jobId.slice(0, 12)}…
              {latestBgmFailure.error ? ` · ${latestBgmFailure.error}` : ""}
            </div>
          ) : null}

          <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_9rem_auto]">
            <textarea
              value={scoreStoryZh}
              onChange={event =>
                setScoreStoryZh(event.target.value.slice(0, 1000))
              }
              rows={3}
              placeholder="写本段剧情、情绪从哪里推进到哪里、哪里要压住或爆开…"
              className="w-full resize-y rounded-lg border border-white/10 bg-black/35 px-2 py-1.5 text-[11px] leading-5 text-white placeholder:text-white/30"
            />
            <label className="text-[10px] text-white/45">
              画面时长（秒）
              <input
                type="number"
                min={10}
                max={360}
                step={1}
                value={scoreDurationSec}
                onChange={event =>
                  setScoreDurationSec(
                    Math.max(
                      10,
                      Math.min(
                        360,
                        Math.round(Number(event.target.value) || 10)
                      )
                    )
                  )
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-white"
              />
            </label>
            <button
              type="button"
              disabled={draftBgmMutation.isPending}
              onClick={() => void draftScoringBrief()}
              className={goCls}
            >
              {draftBgmMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              起草 brief
            </button>
          </div>

          {scoreBrief ? (
            <div className="mt-2 grid gap-2 lg:grid-cols-2">
              <label className="text-[10px] text-white/45">
                配乐标题
                <input
                  value={scoreBrief.title}
                  maxLength={80}
                  onChange={event =>
                    setScoreBrief({ ...scoreBrief, title: event.target.value })
                  }
                  className={selectCls + " mt-1"}
                />
              </label>
              <label className="text-[10px] text-white/45">
                生成时长（秒）
                <input
                  type="number"
                  min={10}
                  max={360}
                  value={scoreBrief.duration}
                  onChange={event =>
                    setScoreBrief({
                      ...scoreBrief,
                      duration: Math.max(
                        10,
                        Math.min(
                          360,
                          Math.round(Number(event.target.value) || 10)
                        )
                      ),
                    })
                  }
                  className={selectCls + " mt-1"}
                />
              </label>
              <label className="text-[10px] text-white/45 lg:col-span-2">
                风格与编配
                <textarea
                  value={scoreBrief.style}
                  maxLength={1000}
                  rows={2}
                  onChange={event =>
                    setScoreBrief({ ...scoreBrief, style: event.target.value })
                  }
                  className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] leading-5 text-white"
                />
              </label>
              <label className="text-[10px] text-white/45 lg:col-span-2">
                结构标签
                <textarea
                  value={scoreBrief.prompt}
                  maxLength={5000}
                  rows={3}
                  onChange={event =>
                    setScoreBrief({ ...scoreBrief, prompt: event.target.value })
                  }
                  className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[11px] leading-5 text-white"
                />
              </label>
              <div className="lg:col-span-2">
                <button
                  type="button"
                  disabled={Boolean(bgmPending) || queueBgmMutation.isPending}
                  onClick={() => void queueScoringBrief()}
                  className={goCls}
                >
                  {queueBgmMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Music4 className="h-3.5 w-3.5" />
                  )}
                  确认生成配乐
                </button>
              </div>
            </div>
          ) : null}

          {generatedBgmVariants.length > 0 ? (
            <div className="mt-3 space-y-2 border-t border-white/10 pt-2">
              <div className="text-[11px] font-semibold text-white/75">
                已入库变体
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {generatedBgmVariants.map(variant => (
                  <div
                    key={variant.index}
                    className={`rounded-lg border p-2 ${
                      selectedBgmVariant === variant.index
                        ? "border-fuchsia-300/45 bg-fuchsia-500/10"
                        : "border-white/10 bg-black/20"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-white/70">
                        变体 {variant.index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => applyGeneratedBgmVariant(variant)}
                        className="rounded border border-fuchsia-300/35 px-2 py-1 text-[10px] text-fuchsia-100 hover:bg-fuchsia-500/10"
                      >
                        选用并写入贴装
                      </button>
                    </div>
                    {variant.previewUrl ? (
                      <audio
                        controls
                        preload="none"
                        src={variant.previewUrl}
                        className="mt-1.5 h-8 w-full"
                      />
                    ) : null}
                    <p className="mt-1 text-[9px] text-white/35">
                      {variant.structure
                        ? `最强击点 ${variant.structure.strongestAtSec.toFixed(1)}s · 留白 ${variant.structure.valleyAtSec.toFixed(1)}s`
                        : "已入库；客观击点量测暂不可用，可手动贴装"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-3 border-t border-white/10 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold text-white/75">
                  真实画面事件
                </div>
                <div className="text-[10px] text-white/40">
                  只填片中确有其事的秒点；系统不虚构卡点。
                </div>
              </div>
              <button type="button" onClick={addFilmEvent} className={goCls}>
                <Plus className="h-3.5 w-3.5" /> 添加事件
              </button>
            </div>
            <div className="mt-2 space-y-1.5">
              {filmEvents.map((event, index) => (
                <div
                  key={`${index}-${event.kind}`}
                  className="grid gap-1.5 md:grid-cols-[7rem_6rem_6rem_minmax(0,1fr)_auto]"
                >
                  <select
                    value={event.kind}
                    onChange={change =>
                      patchFilmEvent(index, {
                        kind: change.target.value as FilmEventKind,
                      })
                    }
                    className={selectCls}
                  >
                    {(
                      [
                        "断裂点",
                        "静音停顿",
                        "转场",
                        "对白窗",
                        "终画面",
                      ] as const
                    ).map(kind => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={scoreDurationSec}
                    step={0.1}
                    value={event.atSec}
                    onChange={change =>
                      patchFilmEvent(index, {
                        atSec: Number(change.target.value) || 0,
                      })
                    }
                    className={selectCls}
                    aria-label="事件秒点"
                  />
                  <input
                    type="number"
                    min={0.05}
                    max={30}
                    step={0.1}
                    value={event.durationSec ?? 0.5}
                    onChange={change =>
                      patchFilmEvent(index, {
                        durationSec: Number(change.target.value) || 0.5,
                      })
                    }
                    className={selectCls}
                    aria-label="事件时长"
                  />
                  <input
                    value={event.descZh}
                    maxLength={160}
                    onChange={change =>
                      patchFilmEvent(index, { descZh: change.target.value })
                    }
                    className={selectCls}
                    placeholder="画面中实际发生了什么"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setFilmEvents(events =>
                        events.filter((_, eventIndex) => eventIndex !== index)
                      )
                    }
                    className="rounded border border-red-300/25 px-2 text-red-100/75 hover:bg-red-500/10"
                    aria-label="删除事件"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            {beatPreview.length > 0 ? (
              <div className="mt-2 max-h-32 overflow-auto rounded-lg border border-white/10 bg-black/25 p-2 text-[10px] text-white/55">
                {beatPreview.map((row, index) => (
                  <div
                    key={`${row.filmSec}-${index}`}
                    className="grid grid-cols-[4rem_1fr_1fr] gap-2 border-b border-white/5 py-1 last:border-0"
                  >
                    <span>{row.filmSec.toFixed(1)}s</span>
                    <span>{row.filmEventZh}</span>
                    <span>{row.soundActionZh}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        {/* 拼接 */}
        <div className="rounded-xl border border-white/10 bg-black/25 p-3">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
            <Layers className="h-3.5 w-3.5 text-cyan-300" /> 拼接成片
          </div>
          <p className="mt-1 text-[11px] leading-4 text-white/45">
            按点选顺序拼 2–12 段;统一分辨率/帧率,无声段自动补静音轨。
          </p>
          <div className="mt-2 max-h-36 space-y-1 overflow-auto pr-1">
            {clipOptions.length === 0 ? (
              <p className="text-[11px] text-white/35">
                画布上还没有已出片的成片节点
              </p>
            ) : (
              clipOptions.map(c => {
                const order = concatSel.indexOf(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleConcat(c.id)}
                    className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1 text-left text-[11px] ${
                      order >= 0
                        ? "border-cyan-300/50 bg-cyan-500/10 text-cyan-50"
                        : "border-white/10 text-white/65 hover:bg-white/[0.05]"
                    }`}
                  >
                    <span
                      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
                        order >= 0 ? "bg-cyan-400 text-black" : "border border-white/25 text-white/40"
                      }`}
                    >
                      {order >= 0 ? order + 1 : ""}
                    </span>
                    <span className="truncate">{c.label}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <select
              value={concatRes}
              onChange={(e) => setConcatRes(e.target.value as "720p" | "1080p")}
              className={selectCls + " w-24"}
            >
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
            <button type="button" disabled={busy} onClick={submitConcat} className={goCls}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />}
              拼接 {concatSel.length > 0 ? `${concatSel.length} 段` : ""}
            </button>
          </div>
        </div>

        {/* 高清放大：与自由画布共用同一后端任务、计费、退款与恢复链。 */}
        <div className="rounded-xl border border-white/10 bg-black/25 p-3">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
            <Maximize2 className="h-3.5 w-3.5 text-sky-300" /> 高清放大
          </div>
          <p className="mt-1 text-[11px] leading-4 text-white/45">
            成片先放大到 2K/4K，再进入 BGM 贴装；原片保留，刷新后继续同一任务。
          </p>
          <div className="mt-2 space-y-1.5">
            <select
              value={upscaleVideoUrl}
              onChange={event => setUpscaleVideoUrl(event.target.value)}
              className={selectCls}
            >
              <option value="">选待放大的成片…</option>
              {clipOptions.map(clip => (
                <option key={clip.id} value={clip.url}>
                  {clip.label}
                </option>
              ))}
            </select>
            {!upscaleProbedSec ? (
              <button
                type="button"
                disabled={!upscaleVideoUrl || upscaleProbeBusy}
                onClick={() => void probeUpscaleSource()}
                className={goCls}
              >
                {upscaleProbeBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                读取真实时长
              </button>
            ) : (
              <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] p-2">
                <p className="text-[10px] text-white/55">
                  视频约 {upscaleProbedSec} 秒 · 按秒计费
                </p>
                <div className="grid grid-cols-2 gap-1">
                  {(["2k", "4k"] as const).map(target => {
                    const directBlock = blocks.find(
                      block =>
                        String(block.outputUrl || "").trim() === upscaleVideoUrl
                    );
                    const freeform = !(Number(directBlock?.episodeIndex) > 0);
                    return (
                      <button
                        key={target}
                        type="button"
                        disabled={upscaleSubmitBusy}
                        onClick={() => void submitUpscale(target)}
                        className="rounded-lg border border-sky-300/35 bg-sky-500/10 px-2 py-1.5 text-[11px] text-sky-50 hover:bg-sky-500/15 disabled:opacity-45"
                      >
                        {target.toUpperCase()} ·{" "}
                        {canvasVideoUpscaleCredits(target, upscaleProbedSec, {
                          freeform,
                        })}{" "}
                        积分
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {upscaleJobs.slice(0, 3).map(job => (
              <div
                key={job.taskId}
                className="rounded-lg border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-white/60"
              >
                <span>
                  {job.target.toUpperCase()} ·{" "}
                  {videoUpscaleStatusLabel(job.status)}
                </span>
                {job.videoUrl ? (
                  <a
                    href={job.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 text-cyan-200 underline underline-offset-2"
                  >
                    打开高清版
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* BGM 贴装 */}
        <div className="rounded-xl border border-white/10 bg-black/25 p-3">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
            <Music4 className="h-3.5 w-3.5 text-cyan-300" /> BGM 贴装
          </div>
          <p className="mt-1 text-[11px] leading-4 text-white/45">
            侧链压对白、按整片时间线淡入淡出;短曲自动循环。音频先上传到任意节点。
          </p>
          <div className="mt-2 space-y-1.5">
            <select
              value={bgmVideoUrl}
              onChange={e => setBgmVideoUrl(e.target.value)}
              className={selectCls}
            >
              <option value="">选成片…</option>
              {clipOptions.map(c => (
                <option key={c.id} value={c.url}>
                  {c.label}
                </option>
              ))}
            </select>
            <select
              value={bgmAudioUrl}
              onChange={e => {
                setBgmAudioUrl(e.target.value);
                setSelectedBgmVariant(null);
                setBgmSeekSec(0);
                setBgmVolumeExpr(undefined);
                setBeatPreview([]);
              }}
              className={selectCls}
            >
              <option value="">选 BGM 音频…</option>
              {scoringAudioOptions.map(a => (
                <option key={a.id} value={a.url}>
                  {a.label}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/55">
              <label className="inline-flex items-center gap-1">
                音量
                <input
                  type="number"
                  step={0.05}
                  min={0}
                  max={1}
                  value={bgmVolume}
                  onChange={e =>
                    setBgmVolume(
                      Math.max(0, Math.min(1, Number(e.target.value) || 0))
                    )
                  }
                  className={numCls}
                />
              </label>
              <label className="inline-flex items-center gap-1">
                进场s
                <input
                  type="number"
                  step={0.5}
                  min={0}
                  max={3600}
                  value={bgmEntrySec}
                  onChange={e =>
                    setBgmEntrySec(
                      Math.max(0, Math.min(3600, Number(e.target.value) || 0))
                    )
                  }
                  className={numCls}
                />
              </label>
              <label className="inline-flex items-center gap-1">
                淡入s
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={30}
                  value={bgmFadeIn}
                  onChange={e =>
                    setBgmFadeIn(
                      Math.max(0, Math.min(30, Number(e.target.value) || 0))
                    )
                  }
                  className={numCls}
                />
              </label>
              <label className="inline-flex items-center gap-1">
                淡出s
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  max={30}
                  value={bgmFadeOut}
                  onChange={e =>
                    setBgmFadeOut(
                      Math.max(0, Math.min(30, Number(e.target.value) || 0))
                    )
                  }
                  className={numCls}
                />
              </label>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={submitBgm}
              className={goCls}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Music4 className="h-3.5 w-3.5" />
              )}
              贴装 BGM
            </button>
          </div>
        </div>

        {/* 响度验收 + 未接工序 */}
        <div className="rounded-xl border border-white/10 bg-black/25 p-3">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
            <Volume2 className="h-3.5 w-3.5 text-cyan-300" /> 响度验收
          </div>
          <p className="mt-1 text-[11px] leading-4 text-white/45">
            ebur128 整体响度 + 音轨在不在;交付前最后一道尺。
          </p>
          <div className="mt-2 space-y-1.5">
            <select
              value={loudVideoUrl}
              onChange={e => setLoudVideoUrl(e.target.value)}
              className={selectCls}
            >
              <option value="">选成片…</option>
              {clipOptions.map(c => (
                <option key={c.id} value={c.url}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy}
              onClick={submitLoudness}
              className={goCls}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Volume2 className="h-3.5 w-3.5" />
              )}
              出验收报告
            </button>
          </div>
          {/* 反空壳:未接工序灰禁用,绝不冒充可用 */}
          <div className="mt-3 space-y-1 border-t border-white/10 pt-2">
            <div className="flex items-center justify-between text-[11px] text-white/30">
              <span className="line-through">改画面 · 保原声</span>
              <span className="rounded border border-white/15 px-1.5 py-px text-[9px]">
                未接 · 禁用
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-white/30">
              <span className="line-through">重拍一镜</span>
              <span className="rounded border border-white/15 px-1.5 py-px text-[9px]">
                未接 · 禁用
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 任务列表(服务端为主来源;此处为本人任务展示) */}
      {jobs.length > 0 ? (
        <div className="mt-3 space-y-1">
          {jobs.slice(0, 10).map(job => {
            const badge = statusBadge(job.status);
            return (
              <div
                key={job.jobId}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-white/8 bg-black/20 px-2.5 py-1.5"
              >
                {job.status !== "succeeded" && job.status !== "failed" ? (
                  <Loader2 className="h-3 w-3 animate-spin text-amber-300" />
                ) : null}
                <span
                  className={`rounded-full border px-2 py-px text-[10px] font-semibold ${badge.cls}`}>
                  {badge.text}
                </span>
                <span className="text-[11px] text-white/75">
                  {ACTION_LABEL[job.action]} · {job.label}
                </span>
                {renderJobOutput(job)}
                {job.status === "failed" && job.error ? (
                  <span className="max-w-[50%] truncate text-[10px] text-red-200/80" title={job.error}>
                    {job.error}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="ml-auto rounded border border-white/12 px-1.5 py-0.5 font-mono text-[9px] text-white/50 hover:bg-white/[0.06]"
                  title={`复制任务单号 ${job.jobId}`}
                  onClick={() =>
                    void copyText(job.jobId).then((ok) =>
                      ok ? toast.success("任务单号已复制") : toast.error("复制失败"),
                    )
                  }
                >
                  {job.jobId.slice(0, 8)}… ⧉
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
