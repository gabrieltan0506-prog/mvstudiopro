import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type VideoEditCompareMode = "after" | "before" | "side";

const tabCls =
  "rounded-md px-2.5 py-1 pointer-coarse:min-h-9 pointer-coarse:px-3 text-[12px] text-white/70 hover:text-white aria-pressed:bg-white/15 aria-pressed:font-semibold aria-pressed:text-white";
const videoCls = "max-h-64 w-full rounded-lg bg-black";

const seek = (v: HTMLVideoElement | null, sec: number) => {
  if (!v || !Number.isFinite(sec)) return;
  try {
    v.currentTime = Math.max(0, sec);
  } catch {
    // 元数据未就绪的个别浏览器会抛，下一次 loadedmetadata 再对齐
  }
};
const play = (v: HTMLVideoElement | null) => void v?.play().catch(() => undefined);

/**
 * 修改前 / 修改后对比：两条视频始终挂着（只切显隐），切换时沿用同一播放位置与播放状态；
 * 进入结果时两条都跳到改动区间起点前 1 秒；可两条同时同步播放（容器够宽左右并排，窄屏上下叠放；修改前静音，避免双重声音）。
 */
export function VideoEditCompare(props: {
  /** 原片可播放地址；没有就只显示修改后。 */
  beforeSrc?: string;
  afterSrc: string;
  editedRange?: { startSec: number; endSec: number };
}) {
  const { beforeSrc, afterSrc, editedRange } = props;
  const [mode, setMode] = useState<VideoEditCompareMode>("after");
  const beforeRef = useRef<HTMLVideoElement | null>(null);
  const afterRef = useRef<HTMLVideoElement | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const jumpSec = editedRange ? Math.max(0, Math.round((editedRange.startSec - 1) * 10) / 10) : 0;

  // 新结果进来：回到「修改后」，两条都停在改动处前 1 秒
  useEffect(() => {
    setMode("after");
    for (const v of [beforeRef.current, afterRef.current]) {
      v?.pause();
      seek(v, jumpSec);
    }
  }, [afterSrc, jumpSec]);

  const switchTo = (next: VideoEditCompareMode) => {
    if (next === mode) return;
    const before = beforeRef.current, after = afterRef.current;
    const from = mode === "before" ? before : after;
    const at = from?.currentTime ?? jumpSec;
    const playing = Boolean(from && !from.paused && !from.ended);
    seek(before, at);
    seek(after, at);
    if (before) before.muted = next === "side";
    // 倍速跟当前这条走，切过去不会忽快忽慢
    if (from) for (const v of [before, after]) if (v && v.playbackRate !== from.playbackRate) v.playbackRate = from.playbackRate;
    if (next === "side") {
      if (playing) {
        play(before);
        play(after);
      }
    } else {
      const to = next === "before" ? before : after;
      (next === "before" ? after : before)?.pause();
      if (playing) play(to);
    }
    setMode(next);
  };

  /** 并排时两条互相跟随：播放/暂停/拖动进度/倍速都同步，播放中漂移超过 0.3 秒拉齐（以修改后为准），一条播完另一条也停。 */
  const follow = (self: "before" | "after", event: "play" | "pause" | "seeked" | "timeupdate" | "ratechange" | "ended") => {
    if (modeRef.current !== "side") return;
    const me = (self === "before" ? beforeRef : afterRef).current;
    const other = (self === "before" ? afterRef : beforeRef).current;
    if (!me || !other) return;
    if (event === "play") {
      if (other.paused) play(other);
    } else if (event === "pause") {
      if (!other.paused && !me.ended) other.pause();
    } else if (event === "ended") {
      if (!other.paused) other.pause();
    } else if (event === "ratechange") {
      if (other.playbackRate !== me.playbackRate) other.playbackRate = me.playbackRate;
    } else if (event === "seeked") {
      if (Math.abs(other.currentTime - me.currentTime) > 0.15) seek(other, me.currentTime);
    } else if (self === "after" && Math.abs(other.currentTime - me.currentTime) > 0.3) {
      seek(other, me.currentTime);
    }
  };
  const handlers = (self: "before" | "after") => ({
    onPlay: () => follow(self, "play"),
    onPause: () => follow(self, "pause"),
    onSeeked: () => follow(self, "seeked"),
    onTimeUpdate: () => follow(self, "timeupdate"),
    onRateChange: () => follow(self, "ratechange"),
    onEnded: () => follow(self, "ended"),
    onLoadedMetadata: (e: { currentTarget: HTMLVideoElement }) => {
      // 元数据到了再对齐一次（未就绪时设的位置个别浏览器不认）
      const other = (self === "before" ? afterRef : beforeRef).current;
      const want = other && other.readyState > 0 ? other.currentTime : jumpSec;
      if (Math.abs(e.currentTarget.currentTime - want) > 0.15) seek(e.currentTarget, want);
    },
  });

  const side = mode === "side";
  return (
    <div className="@container space-y-1.5" data-compare-mode={mode}>
      {beforeSrc && (
        <div role="group" aria-label="对比方式" className="inline-flex flex-wrap gap-0.5 rounded-lg border border-white/12 bg-black/40 p-0.5">
          <button type="button" aria-pressed={mode === "before"} className={tabCls} onClick={() => switchTo("before")}>
            修改前
          </button>
          <button type="button" aria-pressed={mode === "after"} className={tabCls} onClick={() => switchTo("after")}>
            修改后
          </button>
          <button type="button" aria-pressed={side} className={tabCls} onClick={() => switchTo("side")}>
            并排对比
          </button>
        </div>
      )}
      <div className={cn("grid gap-2", side && "@xl:grid-cols-2")}>
        {beforeSrc && (
          <figure className={cn("m-0 space-y-0.5", mode === "after" && "hidden")} hidden={mode === "after"}>
            <video ref={beforeRef} src={beforeSrc} controls playsInline preload="metadata" className={cn(videoCls, side && "max-h-44 @xl:max-h-64")} aria-label="修改前" {...handlers("before")} />
            {side && <figcaption className="text-[11px] text-white/55">修改前（已静音）</figcaption>}
          </figure>
        )}
        <figure className={cn("m-0 space-y-0.5", mode === "before" && "hidden")} hidden={mode === "before"}>
          <video ref={afterRef} src={afterSrc} controls playsInline preload="metadata" className={cn(videoCls, side && "max-h-44 @xl:max-h-64")} aria-label="修改后" {...handlers("after")} />
          {side && <figcaption className="text-[11px] text-white/55">修改后</figcaption>}
        </figure>
      </div>
    </div>
  );
}
