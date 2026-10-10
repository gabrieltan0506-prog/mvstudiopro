import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import type { ArtMotionSpec } from "@shared/artMotion";
export default function CodeMotionPreview({
  spec,
  audioSources = [],
}: {
  spec: ArtMotionSpec;
  audioSources?: { id: string; url: string }[];
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const context = useRef<AudioContext | null>(null);
  const buffers = useRef(new Map<string, AudioBuffer>());
  const nodes = useRef<AudioBufferSourceNode[]>([]);
  const abort = useRef(new AbortController());
  const mounted = useRef(true);
  const playbackAnchor = useRef({ from: 0, started: 0, audio: false });
  const [loadingAudio, setLoadingAudio] = useState(false);
  const stopAudio = () => {
    for (const node of nodes.current) {
      try {
        node.stop();
        node.disconnect();
      } catch {}
    }
    nodes.current = [];
  };
  useEffect(() => {
    mounted.current = true;
    abort.current = new AbortController();
    return () => {
      mounted.current = false;
      abort.current.abort();
      stopAudio();
      void context.current?.close();
    };
  }, []);
  const playAudio = async (from: number) => {
    if (!spec.codeAudio) {
      playbackAnchor.current = {
        from,
        started: performance.now() / 1000,
        audio: false,
      };
      return;
    }
    context.current ||= new AudioContext();
    const ac = context.current;
    await ac.resume();
    await Promise.all(
      audioSources.map(async source => {
        if (buffers.current.has(source.id)) return;
        const response = await fetch(source.url, {
          signal: abort.current.signal,
        });
        if (!response.ok)
          throw new Error("原音预览读取失败，请重新打开本次内容");
        buffers.current.set(
          source.id,
          await ac.decodeAudioData(await response.arrayBuffer())
        );
      })
    );
    if (!mounted.current) return;
    stopAudio();
    const now = ac.currentTime;
    playbackAnchor.current = { from, started: now, audio: true };
    for (const clip of spec.codeAudio.audioTimeline) {
      const elapsed = Math.max(0, from - clip.at),
        remaining = clip.duration - elapsed;
      if (remaining <= 0) continue;
      const buffer = buffers.current.get(clip.sourceId);
      if (!buffer) throw new Error("预览找不到这段原声，请重新打开本次内容");
      if (buffer.duration + 1 / buffer.sampleRate < clip.trimStart + clip.duration)
        throw new Error("这份原音解码后不足所选秒窗，请缩短片段或重新上传");
      const source = ac.createBufferSource(),
        gain = ac.createGain();
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(ac.destination);
      const when = now + Math.max(0, clip.at - from);
      const levelAt = (t: number) =>
        clip.volume *
        Math.min(1, clip.fadeIn ? t / clip.fadeIn : 1) *
        Math.min(1, clip.fadeOut ? (clip.duration - t) / clip.fadeOut : 1);
      gain.gain.setValueAtTime(Math.max(0, levelAt(elapsed)), when);
      for (const point of [
        clip.fadeIn,
        clip.duration - clip.fadeOut,
        clip.duration,
      ]
        .filter(t => t > elapsed)
        .sort((a, b) => a - b))
        gain.gain.linearRampToValueAtTime(
          Math.max(0, levelAt(point)),
          when + point - elapsed
        );
      source.start(when, clip.trimStart + elapsed, remaining);
      nodes.current.push(source);
    }
  };
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
    let handle = 0;
    const tick = () => {
      const anchor = playbackAnchor.current;
      const clock = anchor.audio
        ? (context.current?.currentTime ?? anchor.started)
        : performance.now() / 1000;
      const elapsed = anchor.from + Math.max(0, clock - anchor.started);
      const next = Math.min(spec.duration - 1 / spec.fps, elapsed);
      setTime(next);
      // 声音以完整片长收尾，画面停在最后一帧；跳转驱动避免两个播放时钟漂移。
      frame.current?.contentWindow?.postMessage(
        { type: "art-motion-seek", time: next },
        location.origin
      );
      if (elapsed >= spec.duration) {
        setPlaying(false);
        stopAudio();
      } else handle = requestAnimationFrame(tick);
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
        title="映客 INK动画预览"
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
            ? spec.codeAudio
              ? "浏览器试听已选原音；导出另做峰值保护，最终音量以导出试听为准。"
              : "这是浏览器画面预览；合成对白在导出后试听。"
            : "正在准备预览…"}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!ready || !!error || loadingAudio}
          className="rounded-lg border px-3 py-2"
          onClick={async () => {
            if (playing) {
              stopAudio();
              send({ type: "art-motion-seek", time });
              setPlaying(false);
              return;
            }
            const from = time >= spec.duration - 1 / spec.fps ? 0 : time;
            setLoadingAudio(true);
            try {
              await playAudio(from);
              if (!mounted.current) return;
              setTime(from);
              send({ type: "art-motion-seek", time: from });
              setPlaying(true);
            } catch (e) {
              stopAudio();
              if (mounted.current)
                setError(e instanceof Error ? e.message : "原音预览未能播放");
            } finally {
              if (mounted.current) setLoadingAudio(false);
            }
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
          disabled={!ready || loadingAudio}
          className="min-w-0 flex-1"
          onChange={e => {
            const t = Number(e.target.value);
            stopAudio();
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
