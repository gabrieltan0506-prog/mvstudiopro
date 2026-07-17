import React, { useEffect, useRef, useState } from "react";

const VIDEO = "/migrated/home/video3.mp4";
const POSTER = "/migrated/home/poster3.jpg";

/**
 * V3 视频背景：粘性全幅视频 + 长滚动区，滚动进度同步 video.currentTime。
 */
export default function HomeScrollVideo() {
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [progress, setProgress] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const readyRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onMeta = () => {
      readyRef.current = true;
      video.pause();
    };
    video.addEventListener("loadedmetadata", onMeta);
    if (video.readyState >= 1) onMeta();
    return () => video.removeEventListener("loadedmetadata", onMeta);
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      const video = videoRef.current;
      if (video) {
        void video.play().catch(() => undefined);
      }
      return;
    }

    let raf = 0;
    const update = () => {
      const section = sectionRef.current;
      const video = videoRef.current;
      if (!section || !video) return;
      const rect = section.getBoundingClientRect();
      const total = Math.max(1, rect.height - window.innerHeight);
      const scrolled = Math.min(total, Math.max(0, -rect.top));
      const p = scrolled / total;
      setProgress(p);
      if (readyRef.current && Number.isFinite(video.duration) && video.duration > 0) {
        const next = p * video.duration;
        if (Math.abs(video.currentTime - next) > 0.04) {
          try {
            video.currentTime = next;
          } catch {
            /* ignore seek race while buffering */
          }
        }
        if (!video.paused) video.pause();
      }
    };

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [reduceMotion]);

  return (
    <section ref={sectionRef} className="relative mt-10" style={{ height: reduceMotion ? "auto" : "320vh" }}>
      <div className={`${reduceMotion ? "relative" : "sticky top-0"} h-dvh overflow-hidden`}>
        <video
          ref={videoRef}
          src={VIDEO}
          poster={POSTER}
          muted
          playsInline
          loop={reduceMotion}
          preload="auto"
          className="absolute inset-0 h-full w-full object-cover object-right"
        />
        <div className="absolute inset-0 bg-black/35" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0a0915]/40 via-transparent to-[#0a0915]/85" />

        <div className="relative z-10 mx-auto flex h-full max-w-[1240px] flex-col justify-between px-5 py-10 md:py-14">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">Scroll · V3</div>
            <h2 className="mt-2 max-w-xl text-3xl font-black tracking-tight text-white md:text-4xl">
              滚动驱动成片
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-white/65">
              {reduceMotion
                ? "已按系统设置改为自动播放，避免滚动同步。"
                : "向下滚动，视频进度随页面推进；前景文案正常滚过，背景层更“沉”。"}
            </p>
          </div>

          <div className="grid max-w-lg gap-3">
            {[
              { t: "洞察入场", d: "平台趋势与选题先立住判断。" },
              { t: "画布编排", d: "文案、分镜、成片在同一工作流衔接。" },
              { t: "成片气质", d: "滚动不是装饰，而是叙事时间轴。" },
            ].map((item, i) => {
              const appear = reduceMotion ? 1 : Math.min(1, Math.max(0, (progress - i * 0.18) / 0.22));
              return (
                <div
                  key={item.t}
                  className="rounded-2xl border border-white/12 bg-white/[0.07] px-4 py-3 backdrop-blur-md"
                  style={{
                    opacity: 0.35 + appear * 0.65,
                    transform: reduceMotion ? undefined : `translateY(${(1 - appear) * 18}px)`,
                  }}
                >
                  <div className="text-sm font-bold text-white">{item.t}</div>
                  <div className="mt-1 text-xs leading-relaxed text-white/60">{item.d}</div>
                </div>
              );
            })}
          </div>

          {!reduceMotion ? (
            <div className="text-xs text-white/55">
              进度 <span className="tabular-nums text-white/85">{Math.round(progress * 100)}%</span>
            </div>
          ) : (
            <div />
          )}
        </div>
      </div>
    </section>
  );
}
