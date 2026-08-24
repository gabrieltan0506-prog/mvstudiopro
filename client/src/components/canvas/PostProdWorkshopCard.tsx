/**
 * 后期工坊卡(成片坞内):拼接 / BGM 贴装 / 响度验收,纯 ffmpeg 零积分。
 * 任务记录以服务端 jobs 为主来源(listPostProdJobs 恢复),localStorage 仅作
 * 用户级显示缓存(按 uid 分 key);拼接/BGM 产物直接进入下一道工序(gcsUri 优先)。
 * 未接通的工序(改画面保声/重拍一镜)按反空壳约定画成灰禁用,不冒充可用。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Film, Layers, Loader2, Music4, Scissors, Volume2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { copyText } from "@/lib/copyText";
import {
  canSubmitManhuaBgm,
  clearPendingManhuaBgmJob,
  readManhuaBgmVariants,
  readPendingManhuaBgmJob,
  restoreManhuaBgmFromServer,
  writePendingManhuaBgmJob,
  type ManhuaBgmPendingJob,
  type ManhuaBgmVariant,
} from "@/lib/manhuaBgmCardState";
import type { CanvasBlock } from "@/lib/canvasTypes";
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

type PostProdWorkshopCardProps = {
  blocks: CanvasBlock[];
  userId: string;
  /**
   * 能不能用配乐（manhuaGenerateBgm 是 adminProcedure）。
   * 给不能用的人看一个必然 FORBIDDEN 的「会花钱」按钮，是最糟的一种界面。
   */
  canGenerateBgm?: boolean;
};

function statusBadge(status: PostProdJobStatus): { text: string; cls: string } {
  switch (status) {
    case "succeeded":
      return { text: "完成", cls: "border-emerald-400/40 bg-emerald-500/10 text-emerald-100" };
    case "failed":
      return { text: "失败", cls: "border-red-400/40 bg-red-500/10 text-red-100" };
    default:
      return { text: "处理中", cls: "border-amber-400/40 bg-amber-500/10 text-amber-100" };
  }
}

export default function PostProdWorkshopCard({ blocks, userId, canGenerateBgm = false }: PostProdWorkshopCardProps) {
  const queueMutation = trpc.mvAnalysis.queuePostProd.useMutation();
  const generateBgmMutation = trpc.mvAnalysis.manhuaGenerateBgm.useMutation();
  const utils = trpc.useUtils();
  const storageKey = useMemo(() => jobsStorageKey(userId), [userId]);

  /** 画布成片:视频节点已出片的(签名链走 jobs 证据放行) */
  const blockClipOptions = useMemo(
    () =>
      blocks
        .filter((b) => b.kind === "video" && String(b.outputUrl || "").trim())
        .map((b) => ({
          id: b.id,
          url: String(b.outputUrl).trim(),
          label:
            (Number(b.episodeIndex) > 0 ? `第${b.episodeIndex}集 · ` : "") +
            (String(b.prompt || "").trim().slice(0, 24) || b.id.slice(0, 12)),
        })),
    [blocks],
  );

  /** 音频素材:各节点上传里的音频文件(uploads/u<uid>/ 前缀放行) */
  const audioOptions = useMemo(() => {
    const out: Array<{ id: string; url: string; label: string }> = [];
    for (const b of blocks) {
      for (const a of b.uploadedAssets ?? []) {
        const isAudio =
          a.kind === "audio" || AUDIO_EXT_RE.test(a.fileName || "") || AUDIO_EXT_RE.test(a.url || "");
        if (!isAudio) continue;
        const url = String(a.gcsUri || a.url || "").trim();
        if (!url) continue;
        out.push({ id: a.id, url, label: a.fileName || a.id.slice(0, 16) });
      }
    }
    return out;
  }, [blocks]);

  // ---- 工序表单状态 ----
  const [concatSel, setConcatSel] = useState<string[]>([]);
  const [concatRes, setConcatRes] = useState<"720p" | "1080p">("720p");
  const [bgmVideoUrl, setBgmVideoUrl] = useState("");
  const [bgmAudioUrl, setBgmAudioUrl] = useState("");
  /* ── 配乐间：起草（免费）→ 用户改 → 确认建单（花钱）→ 轮询 → 选变体 ── */
  const [scoreLane, setScoreLane] = useState("悬疑权谋");
  const [scoreDuration, setScoreDuration] = useState(21);
  const [scoreDraft, setScoreDraft] = useState<{
    style: string;
    prompt: string;
    title: string;
    duration: number;
  } | null>(null);
  const [scorePending, setScorePending] = useState<ManhuaBgmPendingJob | null>(() =>
    typeof window === "undefined"
      ? null
      : readPendingManhuaBgmJob(window.localStorage, Date.now(), userId),
  );
  const [scoreVariants, setScoreVariants] = useState<ManhuaBgmVariant[]>([]);
  const scorePollRef = useRef(false);
  const [bgmVolume, setBgmVolume] = useState(0.48);
  const [bgmEntrySec, setBgmEntrySec] = useState(0);
  const [bgmFadeIn, setBgmFadeIn] = useState(0.5);
  const [bgmFadeOut, setBgmFadeOut] = useState(1);
  const [loudVideoUrl, setLoudVideoUrl] = useState("");

  const [jobs, setJobs] = useState<TrackedJob[]>(() =>
    loadStoredJobs(jobsStorageKey(userId), localStorage),
  );
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const updateJobs = useCallback(
    (updater: (prev: TrackedJob[]) => TrackedJob[]) => {
      setJobs((prev) => {
        const next = updater(prev);
        persistJobs(storageKey, next, localStorage);
        return next;
      });
    },
    [storageKey],
  );

  /** 服务端为主来源:挂载/回焦拉取本人任务列表,缓存清空后由此恢复 */
  const jobsQuery = trpc.mvAnalysis.listPostProdJobs.useQuery(
    { limit: 30 },
    { enabled: Boolean(userId), retry: false, refetchOnWindowFocus: true },
  );
  useEffect(() => {
    const data = jobsQuery.data;
    if (!data) return;
    updateJobs((prev) =>
      mergeRemoteJobs(
        prev,
        data
          .filter((r): r is NonNullable<typeof r> => r != null)
          .map((r) => ({
            jobId: r.jobId,
            action: r.action,
            status: r.status,
            output: r.output,
            error: r.error,
            createdAt: r.createdAt as unknown,
          })),
      ),
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
          (j) => j.status !== "succeeded" && j.status !== "failed",
        );
        for (const job of pending) {
          try {
            const res = await utils.mvAnalysis.getPostProdJob.fetch({ jobId: job.jobId });
            if (cancelled || !res) return;
            const nextOutput =
              res.output && typeof res.output === "object" && !Array.isArray(res.output)
                ? (res.output as Record<string, unknown>)
                : null;
            updateJobs((prev) =>
              prev.map((j) =>
                j.jobId === job.jobId
                  ? {
                      ...j,
                      status: (res.status as PostProdJobStatus) || j.status,
                      // 服务端明确返回 null 时清除旧缓存,不继续使用旧产物
                      output: nextOutput,
                      error: res.error ?? null,
                    }
                  : j,
              ),
            );
            if (shouldNotifyTerminal(notifiedJobsRef.current, job.jobId, res.status)) {
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
              (error as { data?: { httpStatus?: unknown } })?.data?.httpStatus,
            );
            if (httpStatus === 403 || httpStatus === 404) {
              // 记录当前不可用(被清理/无权):收敛为失败,停止后续轮询
              updateJobs((prev) =>
                prev.map((j) =>
                  j.jobId === job.jobId
                    ? { ...j, status: "failed", error: "任务记录当前不可用" }
                    : j,
                ),
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
  const postProdClipOptions = useMemo(() => buildPostProdClipOptions(jobs), [jobs]);
  const clipOptions = useMemo(
    () => mergeClipOptions(postProdClipOptions, blockClipOptions),
    [postProdClipOptions, blockClipOptions],
  );

  const submit = useCallback(
    async (
      input:
        | { action: "concat"; params: { clips: string[]; width: number; height: number; fps: number } }
        | {
            action: "bgm_mount";
            params: {
              videoUri: string;
              bgmUri: string;
              bgmVolume: number;
              entrySec: number;
              fadeInSec: number;
              fadeOutSec: number;
            };
          }
        | { action: "loudness_check"; params: { videoUri: string; windows: [] } },
      label: string,
    ) => {
      try {
        const res = await queueMutation.mutateAsync(input);
        updateJobs((prev) => [
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
      `拼接 ${urls.length} 段(${concatRes})`,
    );
  };

  const composeBgmDraft = async () => {
    try {
      const brief = await utils.mvAnalysis.manhuaComposeBgmBrief.fetch({
        laneZh: scoreLane,
        durationSec: scoreDuration,
        moods: ["蓄力", "冲突", "收束"],
      });
      // 起草是**零成本**的：先摆出来让用户改，改完才谈发不发
      setScoreDraft({
        style: brief.style,
        prompt: brief.prompt,
        title: brief.title,
        duration: brief.duration,
      });
      setScoreDuration(brief.duration);
    } catch (e) {
      toast.error(`起草配乐提示词失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const submitScoring = async () => {
    const gate = canSubmitManhuaBgm({
      hasDraft: Boolean(scoreDraft),
      pending: scorePending,
      durationSec: scoreDuration,
    });
    if (!gate.ok) {
      toast.error(gate.reasonZh);
      return;
    }
    // 幂等号在**确认那一刻**产生：网络重发复用它，不会建第二单
    const billingRequestId = crypto.randomUUID();
    try {
      const res = await generateBgmMutation.mutateAsync({
        billingRequestId,
        laneZh: scoreLane,
        durationSec: scoreDuration,
        moods: ["蓄力", "冲突", "收束"],
        styleOverrideZh: scoreDraft?.style,
        titleZh: scoreDraft?.title,
      });
      const pending: ManhuaBgmPendingJob = {
        jobId: res.jobId,
        billingRequestId,
        titleZh: scoreDraft?.title || "",
        durationSec: scoreDuration,
        createdAtMs: Date.now(),
      };
      setScorePending(pending);
      writePendingManhuaBgmJob(window.localStorage, pending, userId);
      toast.message("配乐任务已提交", { description: "生成约 2 分钟，可离开本页" });
    } catch (e) {
      toast.error(`配乐提交失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /**
   * 挂载时先问**服务端**要任务：localStorage 会因换账号、清缓存、写入失败而丢，
   * 丢了用户就会再点一次 = 再付一次。成功任务的变体也一并恢复，
   * 用户还没选变体就刷新时不至于全丢。
   */
  useEffect(() => {
    if (!canGenerateBgm) return;
    let alive = true;
    void (async () => {
      try {
        const rows = await utils.mvAnalysis.listManhuaBgmJobs.fetch({ limit: 10 });
        if (!alive || !rows) return;
        const restored = restoreManhuaBgmFromServer(rows);
        if (restored.pending) setScorePending(restored.pending);
        if (restored.variants.length) setScoreVariants(restored.variants);
      } catch {
        // 拿不到列表不清状态：清了就等于让用户重来一遍
      }
    })();
    return () => {
      alive = false;
    };
  }, [utils, canGenerateBgm]);

  /** 轮询未完成的配乐任务；pollingRef 防重叠 */
  useEffect(() => {
    if (!scorePending) return;
    let alive = true;
    const tick = async () => {
      if (scorePollRef.current) return;
      scorePollRef.current = true;
      try {
        const res = await utils.mvAnalysis.getManhuaBgmJob.fetch({ jobId: scorePending.jobId });
        // 查不到就当还在跑：清了状态用户会再点一次 = 再付一次
        if (!alive || !res) return;
        if (res.status === "succeeded") {
          setScoreVariants(readManhuaBgmVariants(res.output));
          setScorePending(null);
          clearPendingManhuaBgmJob(window.localStorage, userId);
          toast.success("配乐已生成，选一条贴装");
        } else if (res.status === "failed") {
          setScorePending(null);
          clearPendingManhuaBgmJob(window.localStorage, userId);
          toast.error(`配乐失败：${String(res.error || "").slice(0, 120)}`);
        }
      } catch {
        // 查不到不清状态：任务可能还在，清了用户会再点一次 = 再付一次
      } finally {
        scorePollRef.current = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 8000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [scorePending, utils]);

  const submitBgm = () => {
    if (!bgmVideoUrl || !bgmAudioUrl) {
      toast.error("BGM 贴装需要选一段成片和一条音频");
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
          fadeInSec: bgmFadeIn,
          fadeOutSec: bgmFadeOut,
        },
      },
      "BGM 贴装",
    );
  };

  const submitLoudness = () => {
    if (!loudVideoUrl) {
      toast.error("响度验收需要选一段成片");
      return;
    }
    void submit(
      { action: "loudness_check", params: { videoUri: loudVideoUrl, windows: [] } },
      "响度验收",
    );
  };

  const toggleConcat = (id: string) => {
    setConcatSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
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
          {o.status === "no_audio" ? "无音轨" : `整体 ${o.integratedLufs} LUFS · ${o.durationSec}s`}
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
              void copyText(gcsUri).then((ok) =>
                ok ? toast.success("gs:// 地址已复制(可作下一道工序素材)") : toast.error("复制失败"),
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
    <div data-postprod-workshop className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Film className="h-4 w-4 text-cyan-300" />
        <span className="text-[14px] font-bold text-white">后期工坊</span>
        <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-px text-[10px] font-semibold text-emerald-100">
          三件套 0 积分 · 纯算力
        </span>
        <span className="text-[11px] text-white/45">
          拼接 / BGM 贴装 / 响度验收;产物落云端,7 天签名链;成品可直接进下一道工序
        </span>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
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
              <p className="text-[11px] text-white/35">画布上还没有已出片的成片节点</p>
            ) : (
              clipOptions.map((c) => {
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

        {/* 配乐间：起草免费 → 用户改 → 确认建单（花钱）→ 选变体 → 贴装。
            无权限者整卡不渲染，不给看必然 FORBIDDEN 的按钮 */}
        {canGenerateBgm ? (
        <div className="rounded-xl border border-amber-300/25 bg-amber-500/[0.04] p-3">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
            <Music4 className="h-3.5 w-3.5 text-amber-300" /> 配乐间
            <span className="ml-auto rounded bg-amber-400/15 px-1.5 text-[9px] font-medium text-amber-100">
              会花钱
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-4 text-white/45">
            按剧情自动起草配乐提示词（免费），改完确认才生成。一次出多条变体，选一条贴装。
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={scoreLane}
              onChange={(e) => setScoreLane(e.target.value)}
              className={selectCls + " w-32"}
            >
              {["爽文逆袭", "古言种田", "系统觉醒", "甜宠", "悬疑权谋", "搞笑沙雕", "游戏竞技"].map(
                (l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ),
              )}
            </select>
            <label className="flex items-center gap-1 text-[11px] text-white/55">
              时长
              <input
                type="number"
                min={10}
                max={360}
                value={scoreDuration}
                onChange={(e) => setScoreDuration(Math.round(Number(e.target.value) || 0))}
                className={selectCls + " w-20"}
              />
              秒
            </label>
            <button type="button" onClick={() => void composeBgmDraft()} className={selectCls}>
              起草提示词（免费）
            </button>
          </div>

          {scoreDraft ? (
            <div className="mt-2 space-y-1.5">
              {/* 改完原样送上游，不在用户文本上追加标签 */}
              <textarea
                value={scoreDraft.style}
                onChange={(e) => setScoreDraft({ ...scoreDraft, style: e.target.value })}
                rows={3}
                className="w-full rounded border border-white/12 bg-black/40 px-2 py-1 text-[11px] leading-4 text-white/80"
              />
              <pre className="overflow-x-auto rounded border border-white/10 bg-black/30 px-2 py-1 text-[10px] leading-4 text-white/50">
                {scoreDraft.prompt}
              </pre>
              <button
                type="button"
                disabled={Boolean(scorePending) || generateBgmMutation.isPending}
                onClick={() => void submitScoring()}
                className={goCls}
              >
                {scorePending || generateBgmMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Music4 className="h-3.5 w-3.5" />
                )}
                {scorePending ? "配乐生成中…" : `确认生成 · ${scoreDuration}s`}
              </button>
            </div>
          ) : null}

          {scorePending ? (
            <p className="mt-1.5 text-[10px] text-amber-100/70">
              任务 {scorePending.jobId.slice(0, 16)}… 生成中，刷新页面不会丢
            </p>
          ) : null}

          {scoreVariants.length ? (
            <div className="mt-2 space-y-1.5">
              <div className="text-[11px] text-white/55">
                出了 {scoreVariants.length} 条，试听后选一条填进下面的贴装
              </div>
              {scoreVariants.map((v) => (
                <div key={v.gcsUri} className="flex items-center gap-2">
                  <audio controls src={v.previewUrl} className="h-7 flex-1" />
                  <button
                    type="button"
                    onClick={() => {
                      setBgmAudioUrl(v.gcsUri);
                      toast.message(`已选变体 ${v.index + 1}`, { description: "可直接贴装" });
                    }}
                    className={selectCls}
                  >
                    用这条
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        ) : null}

        {/* BGM 贴装 */}
        <div className="rounded-xl border border-white/10 bg-black/25 p-3">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
            <Music4 className="h-3.5 w-3.5 text-cyan-300" /> BGM 贴装
          </div>
          <p className="mt-1 text-[11px] leading-4 text-white/45">
            侧链压对白、按整片时间线淡入淡出;短曲自动循环。音频先上传到任意节点。
          </p>
          <div className="mt-2 space-y-1.5">
            <select value={bgmVideoUrl} onChange={(e) => setBgmVideoUrl(e.target.value)} className={selectCls}>
              <option value="">选成片…</option>
              {clipOptions.map((c) => (
                <option key={c.id} value={c.url}>
                  {c.label}
                </option>
              ))}
            </select>
            <select value={bgmAudioUrl} onChange={(e) => setBgmAudioUrl(e.target.value)} className={selectCls}>
              <option value="">选 BGM 音频…</option>
              {audioOptions.map((a) => (
                <option key={a.id} value={a.url}>
                  {a.label}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/55">
              <label className="inline-flex items-center gap-1">
                音量
                <input
                  type="number" step={0.05} min={0} max={1} value={bgmVolume}
                  onChange={(e) => setBgmVolume(Math.max(0, Math.min(1, Number(e.target.value) || 0)))}
                  className={numCls}
                />
              </label>
              <label className="inline-flex items-center gap-1">
                进场s
                <input
                  type="number" step={0.5} min={0} max={3600} value={bgmEntrySec}
                  onChange={(e) =>
                    setBgmEntrySec(Math.max(0, Math.min(3600, Number(e.target.value) || 0)))
                  }
                  className={numCls}
                />
              </label>
              <label className="inline-flex items-center gap-1">
                淡入s
                <input
                  type="number" step={0.1} min={0} max={30} value={bgmFadeIn}
                  onChange={(e) => setBgmFadeIn(Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
                  className={numCls}
                />
              </label>
              <label className="inline-flex items-center gap-1">
                淡出s
                <input
                  type="number" step={0.1} min={0} max={30} value={bgmFadeOut}
                  onChange={(e) => setBgmFadeOut(Math.max(0, Math.min(30, Number(e.target.value) || 0)))}
                  className={numCls}
                />
              </label>
            </div>
            <button type="button" disabled={busy} onClick={submitBgm} className={goCls}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Music4 className="h-3.5 w-3.5" />}
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
            <select value={loudVideoUrl} onChange={(e) => setLoudVideoUrl(e.target.value)} className={selectCls}>
              <option value="">选成片…</option>
              {clipOptions.map((c) => (
                <option key={c.id} value={c.url}>
                  {c.label}
                </option>
              ))}
            </select>
            <button type="button" disabled={busy} onClick={submitLoudness} className={goCls}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}
              出验收报告
            </button>
          </div>
          {/* 反空壳:未接工序灰禁用,绝不冒充可用 */}
          <div className="mt-3 space-y-1 border-t border-white/10 pt-2">
            <div className="flex items-center justify-between text-[11px] text-white/30">
              <span className="line-through">改画面 · 保原声</span>
              <span className="rounded border border-white/15 px-1.5 py-px text-[9px]">未接 · 禁用</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-white/30">
              <span className="line-through">重拍一镜</span>
              <span className="rounded border border-white/15 px-1.5 py-px text-[9px]">未接 · 禁用</span>
            </div>
            <p className="text-[10px] leading-4 text-white/35">
              视频 4K 超分:自由画布视频节点已有入口,后续迁入本卡。
            </p>
          </div>
        </div>
      </div>

      {/* 任务列表(服务端为主来源;此处为本人任务展示) */}
      {jobs.length > 0 ? (
        <div className="mt-3 space-y-1">
          {jobs.slice(0, 10).map((job) => {
            const badge = statusBadge(job.status);
            return (
              <div
                key={job.jobId}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-white/8 bg-black/20 px-2.5 py-1.5"
              >
                {job.status !== "succeeded" && job.status !== "failed" ? (
                  <Loader2 className="h-3 w-3 animate-spin text-amber-300" />
                ) : null}
                <span className={`rounded-full border px-2 py-px text-[10px] font-semibold ${badge.cls}`}>
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
