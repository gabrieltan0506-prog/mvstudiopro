import { useEffect, useRef, useState } from "react";
import { digitalHumanMediaUrl } from "@/lib/digitalHumanVideo";
import type { DigitalHumanDraft } from "@shared/digitalHumanStudio";

/** 三维渲染仍须单独审片；生成或下载成功不能直接变成模型参考。 */
export function DigitalHumanRenderReview({
  candidate,
  disabled,
  onApprove,
}: {
  candidate: NonNullable<DigitalHumanDraft["spatialRenderCandidate"]>;
  disabled?: boolean;
  onApprove: (review: {
    notes: string;
    frameCount: number;
    reviewedAt: string;
  }) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState(""),
    [error, setError] = useState("");
  const [metadataValid, setMetadataValid] = useState(false);
  const [reviewed, setReviewed] = useState<number[]>([]),
    [frame, setFrame] = useState(0),
    [notes, setNotes] = useState("");
  const [normalPlayed, setNormalPlayed] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const normal = useRef({ active: false, last: 0, startMs: 0 });
  const duration = candidate.reference.durationSec || 0,
    total = Math.round(duration * 24);
  useEffect(() => {
    let alive = true;
    digitalHumanMediaUrl(candidate.reference.gcsUri || candidate.reference.url)
      .then(url => {
        if (alive) setUrl(url);
      })
      .catch(e => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [candidate.reference.url, candidate.reference.gcsUri]);
  return (
    <section className="dh-card">
      <h4>三维预演审片后再采用</h4>
      <p>
        逐帧检查人数、站位、接触、穿模和镜头衔接，并从头常速播放。修改输入后需重新渲染。
      </p>
      {error && <p role="alert">{error}</p>}
      {url && (
        <video
          ref={video}
          src={url}
          controls
          playsInline
          aria-label="三维预演审片播放器"
          style={{ maxHeight: 440, width: "100%" }}
          onLoadedMetadata={() => {
            const v = video.current;
            setMetadataValid(
              Boolean(
                v &&
                  Number.isFinite(v.duration) &&
                  duration > 0 &&
                  Math.abs(v.duration - duration) <= 0.1
              )
            );
            if (
              v &&
              (!Number.isFinite(v.duration) ||
                Math.abs(v.duration - duration) > 0.1)
            )
              setError("实际视频时长与渲染回执不符，不能采用");
          }}
          onSeeking={() => {
            normal.current.active = false;
          }}
          onPlay={() => {
            const v = video.current;
            if (v && v.currentTime < 0.05 && v.playbackRate === 1)
              normal.current = {
                active: true,
                last: 0,
                startMs: performance.now(),
              };
          }}
          onPause={() => {
            if (!video.current?.ended) normal.current.active = false;
          }}
          onRateChange={() => {
            if (video.current?.playbackRate !== 1)
              normal.current.active = false;
          }}
          onTimeUpdate={() => {
            const v = video.current;
            if (!v) return;
            setFrame(
              Math.min(total - 1, Math.floor(v.currentTime * 24 + 0.001))
            );
            if (normal.current.active) {
              if (
                v.currentTime < normal.current.last ||
                v.currentTime - normal.current.last > 1.2
              )
                normal.current.active = false;
              else normal.current.last = v.currentTime;
            }
          }}
          onEnded={() => {
            if (
              normal.current.active &&
              (performance.now() - normal.current.startMs) / 1000 >=
                duration - 0.3
            )
              setNormalPlayed(true);
            normal.current.active = false;
          }}
        />
      )}
      <p>
        当前第{frame + 1}帧 · 已检查{reviewed.length}/{total}帧
      </p>
      <button
        type="button"
        disabled={disabled || !url || !metadataValid || Boolean(error)}
        onClick={() => {
          const v = video.current;
          if (!v || v.readyState < 2 || v.seeking || v.ended) {
            setError("请先载入并停在可见画面上，再标记当前帧");
            return;
          }
          v.pause();
          const n = Math.min(total - 1, Math.floor(v.currentTime * 24 + 0.001));
          setReviewed(rows => (rows.includes(n) ? rows : [...rows, n]));
          if (n + 1 < total) v.currentTime = (n + 1) / 24;
        }}
      >
        确认当前帧并看下一帧
      </button>
      <button
        type="button"
        disabled={!url}
        onClick={() => {
          const v = video.current;
          if (v) {
            setError("");
            v.pause();
            v.currentTime = Math.max(0, (frame - 1) / 24);
          }
        }}
      >
        上一帧
      </button>
      <button
        type="button"
        disabled={disabled || !url}
        onClick={() => {
          const v = video.current;
          if (v) {
            normal.current.active = false;
            v.pause();
            v.currentTime = 0;
            v.playbackRate = 1;
            setError("");
            void v.play().catch(() => setError("播放未开始，请点击播放器播放"));
          }
        }}
      >
        从头常速播放
      </button>
      <label>
        问题帧与处理记录
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="例如第48帧手臂穿模，修正对应动作后重新渲染；无问题可写“未发现问题”。"
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          disabled={reviewed.length !== total || !normalPlayed || !notes.trim()}
          onChange={e => setConfirmed(e.target.checked)}
        />
        已逐帧与常速审看，所有问题已处理
      </label>
      <button
        type="button"
        disabled={
          disabled ||
          !metadataValid ||
          total <= 0 ||
          !confirmed ||
          reviewed.length !== total ||
          !normalPlayed ||
          !notes.trim() ||
          Boolean(error)
        }
        onClick={() =>
          onApprove({
            notes: notes.trim(),
            frameCount: total,
            reviewedAt: new Date().toISOString(),
          })
        }
      >
        采用此三维预演作为视频参考
      </button>
    </section>
  );
}
