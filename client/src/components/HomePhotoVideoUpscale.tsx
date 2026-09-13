import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  uploadPhotoTemporaryMedia,
  cachePhotoTemporaryMedia,
} from "@/lib/photoTemporaryMedia";
import { inferCanvasAssetKind } from "@/lib/canvasUpload";
import {
  fetchVideoUpscaleStatus,
  startVideoUpscale,
  VideoUpscaleSubmitError,
  type VideoUpscaleTaskStatus,
} from "@/lib/videoUpscaleApi";
import { canvasVideoUpscaleCredits } from "@shared/canvasGenerationPricing";
import { canWavespeedUpscale } from "@shared/wavespeedVideoUpscaleModels";

type Target = "2k" | "4k";
export type VideoMetadata = {
  width: number;
  height: number;
  durationSec: number;
  sourceResolution: string;
};
type RecordStatus =
  | VideoUpscaleTaskStatus
  | "submitting"
  | "submission_unknown";
export type UpscaleRecord = {
  id: string;
  sourceUrl: string;
  target: Target;
  status: RecordStatus;
  taskId?: string;
  videoUrl?: string;
  error?: string;
};
const isUrl = (value: unknown): value is string =>
  typeof value === "string" && /^https?:\/\//i.test(value);

/** 非标准尺寸按覆盖短边的档位提交；不能把 834p 冒充 720p。 */
export function metadataForUpscale(
  width: number,
  height: number,
  duration: number
): VideoMetadata {
  if (![width, height, duration].every(v => Number.isFinite(v) && v > 0))
    throw new Error("无法读取视频真实尺寸或时长");
  if (duration > 600) throw new Error("视频最长支持 600 秒，请先剪辑");
  const short = Math.min(width, height);
  const sourceResolution =
    short <= 480
      ? "480p"
      : short <= 720
        ? "720p"
        : short <= 768
          ? "768p"
          : short <= 1080
            ? "1080p"
            : short <= 1440
              ? "2k"
              : "4k";
  return {
    width,
    height,
    durationSec: Math.max(1, Math.round(duration)),
    sourceResolution,
  };
}

export function probeUpscaleMetadata(url: string): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      try {
        if (error) reject(error);
        else
          resolve(
            metadataForUpscale(
              video.videoWidth,
              video.videoHeight,
              video.duration
            )
          );
      } catch (e) {
        reject(e);
      }
      video.removeAttribute("src");
      video.load();
    };
    const timer = setTimeout(
      () => finish(new Error("视频元数据读取超时，请检查原片链接")),
      15000
    );
    video.preload = "metadata";
    video.onloadedmetadata = () => finish();
    video.onerror = () => finish(new Error("无法读取视频，请换用可播放的原片"));
    video.src = url;
  });
}

export function restoreUpscaleRecords(raw: string | null): UpscaleRecord[] {
  try {
    const rows: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(rows)) return [];
    const states = [
      "queued",
      "running",
      "succeeded",
      "failed",
      "timed_out_pending_reconcile",
      "reconcile_manual",
      "submitting",
      "submission_unknown",
    ];
    return rows
      .filter(
        (r): r is UpscaleRecord =>
          !!r &&
          typeof r.id === "string" &&
          isUrl(r.sourceUrl) &&
          ["2k", "4k"].includes(r.target) &&
          states.includes(r.status) &&
          (!r.videoUrl || isUrl(r.videoUrl)) &&
          (!r.taskId || typeof r.taskId === "string")
      )
      .map(r => ({
        ...r,
        status: r.status === "submitting" ? "submission_unknown" : r.status,
      }));
  } catch {
    return [];
  }
}

export function blocksUpscaleSubmit(
  records: UpscaleRecord[],
  url: string,
  target: Target
): boolean {
  // 失败退款也需核账，不在此组件自动重开；成功产物直接复用。
  return records.some(r => r.sourceUrl === url && r.target === target);
}

const labels: Record<RecordStatus, string> = {
  submitting: "正在提交",
  submission_unknown: "提交回执未确认，请联系客服核查，勿重复提交",
  queued: "排队中",
  running: "放大中",
  succeeded: "已完成",
  failed: "任务失败，请核对积分退款记录",
  timed_out_pending_reconcile: "超时对账中，继续查询原任务",
  reconcile_manual: "需人工对账，请联系客服",
};

export default function HomePhotoVideoUpscale({
  generatedVideoUrl,
}: {
  generatedVideoUrl?: string;
}) {
  const { user, isAuthenticated } = useAuth();
  const [identity, setIdentity] = useState<{
    key: string;
    storageKey?: string;
  } | null>(null);
  const claimedId = user?.id;
  useEffect(() => {
    let cancelled = false;
    setIdentity(null);
    // useAuth 允许本地缓存回退，持久化身份必须另经服务端确认。
    void fetch("/api/me", { credentials: "include", cache: "no-store" })
      .then(async response => {
        const me = response.ok ? await response.json() : null;
        if (cancelled) return;
        const valid = Number.isSafeInteger(me?.id) && me.id > 0;
        setIdentity(
          valid
            ? {
                key: String(me.id),
                storageKey: `home-photo-video-upscale:v1:${me.id}`,
              }
            : { key: "session" }
        );
      })
      .catch(() => {
        if (!cancelled) setIdentity({ key: "session" });
      });
    return () => {
      cancelled = true;
    };
  }, [claimedId, isAuthenticated]);
  if (!identity) return <p>正在确认视频工具身份…</p>;
  return (
    <UpscalePanel
      key={identity.key}
      storageKey={identity.storageKey}
      authenticated={isAuthenticated}
      generatedVideoUrl={generatedVideoUrl}
    />
  );
}

function UpscalePanel({
  storageKey,
  authenticated,
  generatedVideoUrl,
}: {
  storageKey?: string;
  authenticated: boolean;
  generatedVideoUrl?: string;
}) {
  const [uploaded, setUploaded] = useState("");
  const [choice, setChoice] = useState<"uploaded" | "generated">("uploaded");
  const source = choice === "generated" ? generatedVideoUrl || "" : uploaded;
  const [probed, setProbed] = useState<{
    url: string;
    value: VideoMetadata;
  } | null>(null);
  const metadata = probed?.url === source ? probed.value : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [records, setRecords] = useState<UpscaleRecord[]>(() => {
    try {
      return storageKey
        ? restoreUpscaleRecords(localStorage.getItem(storageKey))
        : [];
    } catch {
      return [];
    }
  });
  const recordsRef = useRef(records);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function save(next: UpscaleRecord[]) {
    recordsRef.current = next;
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        setError("浏览器无法保存恢复记录，请保留本页和任务编号");
      }
    }
    setRecords(next);
  }
  useEffect(() => {
    let cancelled = false;
    setProbed(null);
    setError("");
    if (source)
      void probeUpscaleMetadata(source)
        .then(value => {
          if (!cancelled) setProbed({ url: source, value });
        })
        .catch(e => {
          if (!cancelled) setError(String(e.message || e));
        });
    return () => {
      cancelled = true;
    };
  }, [source]);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      for (const record of recordsRef.current) {
        if (cancelled) return;
        if (
          !record.taskId ||
          ["failed", "reconcile_manual"].includes(record.status) ||
          (record.status === "succeeded" && record.videoUrl)
        )
          continue;
        try {
          const snapshot = await fetchVideoUpscaleStatus(record.taskId);
          if (cancelled) return;
          const videoUrl = isUrl(snapshot.videoUrl)
            ? await cachePhotoTemporaryMedia(snapshot.videoUrl, "video")
            : record.videoUrl;
          if (cancelled) return;
          save(
            recordsRef.current.map(r =>
              r.id === record.id
                ? {
                    ...r,
                    status: snapshot.status,
                    videoUrl,
                    error: snapshot.error,
                  }
                : r
            )
          );
        } catch {
          if (cancelled) return;
          setError("进度查询断线，将继续查询原任务；请勿重新提交");
        }
      }
      if (!cancelled) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  async function upload(file?: File) {
    if (!file || lock.current) return;
    if (!authenticated) {
      setError("请先登录");
      return;
    }
    if (inferCanvasAssetKind(file) !== "video") {
      setError("请选择视频文件");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    const local = URL.createObjectURL(file);
    try {
      await probeUpscaleMetadata(local);
      if (!mounted.current) return;
      const asset = await uploadPhotoTemporaryMedia(file);
      if (mounted.current) {
        setUploaded(asset.url);
        setChoice("uploaded");
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      URL.revokeObjectURL(local);
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function start(target: Target) {
    if (
      lock.current ||
      !metadata ||
      !isUrl(source) ||
      blocksUpscaleSubmit(recordsRef.current, source, target)
    )
      return;
    if (!authenticated) {
      setError("请先登录");
      return;
    }
    if (!canWavespeedUpscale(metadata.sourceResolution, target)) {
      setError("源片已达到目标或当前服务不支持此源档位");
      return;
    }
    const credits = canvasVideoUpscaleCredits(target, metadata.durationSec, {
      freeform: true,
    });
    if (
      !window.confirm(
        `原片 ${metadata.width}×${metadata.height}，计费时长 ${metadata.durationSec} 秒，放大至 ${target.toUpperCase()} 需要 ${credits} 积分。确认提交？`
      )
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    const record: UpscaleRecord = {
      id: crypto.randomUUID(),
      sourceUrl: source,
      target,
      status: "submitting",
    };
    save([...recordsRef.current, record]);
    try {
      const task = await startVideoUpscale({
        videoUrl: source,
        target,
        durationSec: metadata.durationSec,
        sourceResolution: metadata.sourceResolution,
      });
      // 即使卸载，保存已收到的同一任务编号，供下次按身份恢复。
      save(
        recordsRef.current.map(r =>
          r.id === record.id
            ? { ...r, taskId: task.taskId, status: task.status }
            : r
        )
      );
    } catch (e) {
      if (e instanceof VideoUpscaleSubmitError && e.definitelyNotStarted) {
        save(recordsRef.current.filter(r => r.id !== record.id));
        if (mounted.current) setError(e.message);
      } else
        save(
          recordsRef.current.map(r =>
            r.id === record.id
              ? {
                  ...r,
                  status: "submission_unknown",
                  error: e instanceof Error ? e.message : String(e),
                }
              : r
          )
        );
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-2xl border border-white/10 p-5">
      <h3 className="text-lg font-semibold">视频高清放大</h3>
      <p className="text-sm text-muted-foreground">
        单独上传视频，或选择照片动画成片；原片和结果分别提供下载，临时保留12小时。
      </p>
      <label className="block">
        上传视频
        <input
          aria-label="上传视频"
          type="file"
          accept="video/*,.mp4,.mov,.webm,.m4v"
          disabled={busy}
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void upload(file);
          }}
        />
      </label>
      <select
        aria-label="视频来源"
        value={choice}
        disabled={busy}
        onChange={e => setChoice(e.target.value as typeof choice)}
      >
        <option value="uploaded">独立上传的视频</option>
        <option value="generated" disabled={!generatedVideoUrl}>
          照片动画成片
        </option>
      </select>
      {source && (
        <div>
          <video
            src={source}
            controls
            preload="metadata"
            className="max-h-64 w-full"
          />
          <a href={source} target="_blank" rel="noreferrer" download>
            下载原片
          </a>
        </div>
      )}
      {metadata && (
        <p>
          {metadata.width}×{metadata.height} · 计费时长 {metadata.durationSec}{" "}
          秒
        </p>
      )}
      <div className="flex gap-3">
        {(["2k", "4k"] as const).map(target => (
          <button
            key={target}
            className="rounded-lg border px-4 py-2"
            disabled={
              busy ||
              !metadata ||
              !canWavespeedUpscale(metadata.sourceResolution, target) ||
              blocksUpscaleSubmit(records, source, target)
            }
            onClick={() => void start(target)}
          >
            {target.toUpperCase()}
            {metadata
              ? ` · ${canvasVideoUpscaleCredits(target, metadata.durationSec, { freeform: true })} 积分`
              : ""}
          </button>
        ))}
      </div>
      {metadata && !canWavespeedUpscale(metadata.sourceResolution, "4k") && (
        <p>当前服务不支持此源档位继续放大，请保留原片。</p>
      )}
      {!storageKey && (
        <p>当前无法确认持久化身份，请保持本页打开并保存任务编号。</p>
      )}
      {busy && <p role="status">处理中，请稍候…</p>}
      {error && <p role="alert">{error}</p>}
      {records.map(record => (
        <article key={record.id} className="space-y-2 border-t pt-3">
          <p>
            {record.target.toUpperCase()} · {labels[record.status]}
          </p>
          {record.taskId && (
            <p className="break-all text-xs">任务编号：{record.taskId}</p>
          )}
          {record.error && <p>{record.error}</p>}
          <a href={record.sourceUrl} target="_blank" rel="noreferrer" download>
            下载此任务原片
          </a>
          {record.videoUrl && (
            <div>
              <video
                src={record.videoUrl}
                controls
                preload="metadata"
                className="max-h-64 w-full"
              />
              <a
                href={record.videoUrl}
                target="_blank"
                rel="noreferrer"
                download={`照片视频-${record.target}.mp4`}
              >
                下载 {record.target.toUpperCase()} 成片
              </a>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
