import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import type { ArtMotionSpec } from "@shared/artMotion";
export default function CodeMotionPreview({ spec }: { spec: ArtMotionSpec }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false);
  useEffect(() => {
    const receive = (e: MessageEvent) => {
      if (
        e.source !== frame.current?.contentWindow ||
        e.origin !== location.origin
      )
        return;
      if (e.data?.type === "art-motion-awaiting")
        frame.current?.contentWindow?.postMessage(
          { type: "art-motion-init", spec },
          location.origin
        );
      if (e.data?.type === "art-motion-ready") setReady(true);
      if (e.data?.type === "art-motion-error")
        setError(
          String(e.data.message).replace(/https?:\/\/[^\s]+/g, "相关素材")
        );
    };
    addEventListener("message", receive);
    return () => removeEventListener("message", receive);
  }, [spec]);
  useEffect(() => {
    if (!playing) return;
    const start = performance.now(),
      from = time;
    let handle = 0;
    const tick = (now: number) => {
      const next = Math.min(
        spec.duration - 1 / spec.fps,
        from + (now - start) / 1000
      );
      setTime(next);
      if (next >= spec.duration - 1 / spec.fps) setPlaying(false);
      else handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, spec.duration, spec.fps]);
  const send = (message: unknown) =>
    frame.current?.contentWindow?.postMessage(message, location.origin);
  return (
    <div className="space-y-3">
      <iframe
        ref={frame}
        title="映刻动画预览"
        src="/art-motion/engine/studio.html"
        onLoad={() => send({ type: "art-motion-init", spec })}
        className="mx-auto max-h-[520px] w-full rounded-xl bg-stone-100"
        style={{ aspectRatio: `${spec.width}/${spec.height}` }}
      />
      {error ? (
        <p role="alert" className="text-red-700">
          预览没有打开：{error}
        </p>
      ) : (
        <p role="status" className="text-xs text-stone-500">
          {ready
            ? "这是浏览器预览；导出的视频完成后会显示在下方。预览无声。"
            : "正在准备预览…"}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!ready || !!error}
          className="rounded-lg border px-3 py-2"
          onClick={() => {
            if (!playing && time >= spec.duration - 1 / spec.fps) {
              setTime(0);
              send({ type: "art-motion-seek", time: 0 });
            }
            send({ type: "art-motion-play" });
            setPlaying(v => !v);
          }}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
          <span className="sr-only">{playing ? "暂停预览" : "播放预览"}</span>
        </button>
        <input
          aria-label="查看视频时间"
          type="range"
          min={0}
          max={spec.duration - 1 / spec.fps}
          step={1 / spec.fps}
          value={time}
          disabled={!ready}
          className="min-w-0 flex-1"
          onChange={e => {
            const t = Number(e.target.value);
            setTime(t);
            setPlaying(false);
            send({ type: "art-motion-seek", time: t });
          }}
        />
        <span className="text-xs tabular-nums">
          {time.toFixed(1)} / {spec.duration} 秒
        </span>
      </div>
    </div>
  );
}
