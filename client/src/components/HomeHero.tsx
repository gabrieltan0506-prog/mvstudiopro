import { Link } from "wouter";
import React, { useRef, useState } from "react";

/** Hero 主能力入口（视频下方横排一行；用户 2026-08-12：不许再遮视频） */
const FLAGSHIP: { href: string; label: string; desc: string }[] = [
  { href: "/platform", label: "平台创作", desc: "趋势分析、选题文案与自定义工作台。" },
  { href: "/canvas", label: "创作画布", desc: "节点式生图、分镜与成片编排。" },
];

/**
 * 片单使用用户指定的水果茶与战船完整样片（用户 2026-08-12：视频只留片名，文字别糊脸；
 * 「从洞察到成片」的话 /blog 已经讲过，这里不重复）。海洋女神/太空站观景台旧片下架。
 */
const slides = [
  { title: "水果茶", videoUrl: "/blog-assets/manhua-video-model-review/01-seedance-25-tea-r2v-11s.mp4", poster: "/blog-assets/manhua-video-model-review/00-cover-seedance-25-pour.jpg" },
  { title: "战船", videoUrl: "/home-assets/warship-2k-1.2x.mp4", poster: "/home-assets/warship-2k-poster.jpg" },
];

export default function HomeHero() {
  const [idx, setIdx] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const [notice, setNotice] = useState("");
  const attempt = useRef(0);

  const play = (index = idx) => {
    const player = video.current;
    if (!player) return;
    const request = ++attempt.current;
    if (player.getAttribute("src") !== slides[index]!.videoUrl) {
      player.pause();
      player.src = slides[index]!.videoUrl;
      player.poster = slides[index]!.poster;
      player.load();
    }
    setIdx(index);
    setNotice("");
    // 切片和播放保持在同一次点击中，保留浏览器的用户手势授权。
    void player.play().catch((error: DOMException) => {
      if (request !== attempt.current || error.name === "AbortError") return;
      setNotice(error.name === "NotAllowedError" ? "点击播放，开启声音" : "视频暂时无法播放，请重试");
    });
  };

  return (
    <section className="relative mx-auto max-w-[1240px] px-5 pt-7">
      {/* 视频全幅干净展示：片名切换条放在播放器外，不遮挡画面与播放控制 */}
      <div className="relative aspect-[16/9] overflow-hidden rounded-3xl border border-white/10 bg-[#0c0b16] md:aspect-[21/9]">
        <video
          ref={video}
          src={slides[0]!.videoUrl}
          poster={slides[0]!.poster}
          controls
          playsInline
          preload="metadata"
          onMouseEnter={() => play()}
          onPlay={() => setNotice("")}
          onError={() => setNotice("视频暂时无法播放，请重试")}
          aria-label={slides[idx]!.title}
          className="absolute inset-0 h-full w-full object-contain"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
          {slides.map((s, i) => (
            <button
              key={s.title}
              type="button"
              onClick={() => play(i)}
              onMouseEnter={() => play(i)}
              aria-pressed={i === idx}
              className={`home-liquid-glass shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                i === idx ? "text-white ring-1 ring-white/40" : "text-white/60 hover:text-white"
              }`}
            >
              {s.title}
            </button>
          ))}
        <span role="status" className="ml-2 text-xs text-white/60">{notice || "点击或停留播放 · 默认有声 · 完整播放"}</span>
      </div>

      {/* 两个工作台入口：视频下方横排一行，不占画面 */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {FLAGSHIP.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="home-liquid-glass flex items-baseline justify-between gap-3 rounded-2xl px-5 py-3.5 text-white no-underline transition hover:bg-white/[0.1]"
          >
            <span className="text-sm font-bold">{item.label}</span>
            <span className="min-w-0 flex-1 truncate text-right text-[12px] text-white/55">{item.desc}</span>
            <span aria-hidden className="text-white/40">→</span>
          </Link>
        ))}
      </div>

      <style>{`
        .home-liquid-glass {
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.18);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
        }
      `}</style>
    </section>
  );
}
