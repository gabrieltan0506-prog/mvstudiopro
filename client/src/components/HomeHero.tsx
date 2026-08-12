import { Link } from "wouter";
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/** Hero 主能力入口（视频下方横排一行；用户 2026-08-12：不许再遮视频） */
const FLAGSHIP: { href: string; label: string; desc: string }[] = [
  { href: "/platform", label: "平台创作", desc: "趋势分析、选题文案与自定义工作台。" },
  { href: "/canvas", label: "创作画布", desc: "节点式生图、分镜与成片编排。" },
];

/**
 * 片单全部来自 /blog 实测新片（用户 2026-08-12：视频只留片名，文字别糊脸；
 * 「从洞察到成片」的话 /blog 已经讲过，这里不重复）。海洋女神/太空站观景台旧片下架。
 */
const slides = [
  {
    title: "雁门 · 残玉",
    videoUrl: "/blog-assets/video-4k-upscale/01-sd25-yuji-720p.mp4",
    poster: "/blog-assets/video-4k-upscale/poster-25-720p.jpg",
  },
  {
    title: "剑客 · 雨中对峙",
    videoUrl: "/blog-assets/video-4k-upscale/03-sd20-swordsmen-1080p.mp4",
    poster: "/blog-assets/video-4k-upscale/poster-20-1080p.jpg",
  },
  {
    title: "苹果茶 · 倾倒",
    videoUrl: "/blog-assets/manhua-video-model-review/01-seedance-25-tea-r2v-11s.mp4",
    poster: "/blog-assets/manhua-video-model-review/00-cover-seedance-25-pour.jpg",
  },
];

export default function HomeHero() {
  const [idx, setIdx] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const t = setInterval(() => setIdx((v) => (v + 1) % slides.length), 8000);
    return () => clearInterval(t);
  }, [reduceMotion]);

  const slide = slides[idx]!;

  return (
    <section className="relative mx-auto max-w-[1240px] px-5 pt-7">
      {/* 视频全幅干净展示：画面上只有底部片名切换条，其余文字一概不上脸 */}
      <div className="relative aspect-[16/9] overflow-hidden rounded-3xl border border-white/10 bg-[#0c0b16] md:aspect-[21/9]">
        <AnimatePresence mode="wait">
          <motion.video
            key={slide.videoUrl}
            src={slide.videoUrl}
            poster={slide.poster}
            autoPlay
            muted
            loop
            playsInline
            initial={reduceMotion ? false : { opacity: 0.35, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0.2 }}
            transition={{ duration: 0.7 }}
            className="absolute inset-0 h-full w-full object-cover"
          />
        </AnimatePresence>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-2 px-5 pb-4">
          {slides.map((s, i) => (
            <button
              key={s.title}
              type="button"
              onClick={() => setIdx(i)}
              className={`home-liquid-glass shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                i === idx ? "text-white ring-1 ring-white/40" : "text-white/60 hover:text-white"
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>
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
