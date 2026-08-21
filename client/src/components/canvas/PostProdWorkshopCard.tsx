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

export default function PostProdWorkshopCard({ blocks, userId }: PostProdWorkshopCardProps) {
  const queueMutation = trpc.mvAnalysis.queuePostProd.useMutation();
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
            updateJobs((prev) =>
              prev.map((j) =>
                j.jobId === job.jobId
                  ? {
                      ...j,
                      status: (res.status as PostProdJobStatus) || j.status,
                      output: (res.output as Record<string, unknown> | null) ?? j.output,
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
