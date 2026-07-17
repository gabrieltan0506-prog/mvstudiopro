import { Link } from "wouter";
import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import FloatingVideoWatermark from "./FloatingVideoWatermark";
import { useAuth } from "../_core/hooks/useAuth";

/** Hero 主能力入口（与导航一致） */
const FLAGSHIP: { href: string; label: string; desc: string }[] = [
  { href: "/platform", label: "平台创作", desc: "趋势分析、选题文案与自定义工作台。" },
  { href: "/research", label: "竞品调研", desc: "多平台调研与战略报告。" },
  { href: "/canvas", label: "创作画布", desc: "节点式生图、分镜与成片编排。" },
];

const slides = [
  {
    title: "雷电网球",
    subtitle: "职业女子网球比赛的关键瞬间",
    videoUrl: "/migrated/home/video1.mp4",
    poster: "/migrated/home/poster1.jpg",
  },
  {
    title: "海洋女神",
    subtitle: "史诗奇幻海洋场景",
    videoUrl: "/migrated/home/video2.mp4",
    poster: "/migrated/home/poster2.jpg",
  },
  {
    title: "秘境森林",
    subtitle: "古代森林神庙遗迹",
    videoUrl: "/migrated/home/video3.mp4",
    poster: "/migrated/home/poster3.jpg",
  },
  {
    title: "太空站观景台",
    subtitle: "未来太空站内部观景大厅",
    videoUrl: "/migrated/home/video4.mp4",
    poster: "/migrated/home/poster4.jpg",
  },
];

const HEADLINE_LINES = ["从洞察到成片", "一个人也能跑通全链路"];

function BlurInWords({ text, delay = 0 }: { text: string; delay?: number }) {
  const words = text.split(/\s+/);
  return (
    <span className="inline-flex flex-wrap gap-x-[0.28em]">
      {words.map((w, i) => (
        <motion.span
          key={`${w}-${i}`}
          initial={{ opacity: 0, filter: "blur(10px)", y: 8 }}
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          transition={{ duration: 0.55, delay: delay + i * 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="inline-block"
        >
          {w}
        </motion.span>
      ))}
    </span>
  );
}

export default function HomeHero() {
  const { isAuthenticated } = useAuth({ autoFetch: true });
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
    const t = setInterval(() => setIdx((v) => (v + 1) % slides.length), 5500);
    return () => clearInterval(t);
  }, [reduceMotion]);

  const slide = slides[idx]!;

  return (
    <section className="relative mx-auto max-w-[1240px] px-5 pt-7">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0c0b16]">
        {/* 全幅视频底（V2 MotionSite 灵感：object-cover + 轻遮罩） */}
        <div className="absolute inset-0">
          <AnimatePresence mode="wait">
            <motion.video
              key={slide.videoUrl}
              src={slide.videoUrl}
              poster={slide.poster}
              autoPlay
              muted
              loop
              playsInline
              initial={reduceMotion ? false : { opacity: 0.35, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0.2 }}
              transition={{ duration: 0.7 }}
              className="h-full w-full object-cover object-right"
            />
          </AnimatePresence>
          <div className="absolute inset-0 bg-black/45" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0c0b16]/95 via-[#0c0b16]/55 to-transparent" />
          <FloatingVideoWatermark enabled text="Powered by mvstudiopro.com" />
        </div>

        <div className="relative z-10 grid items-stretch gap-6 p-5 md:grid-cols-[1.15fr_0.85fr] md:p-7">
          <div className="flex min-h-[320px] flex-col justify-end pb-2 md:min-h-[420px]">
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="home-liquid-glass mb-4 w-fit rounded-full px-3 py-1 text-[11px] font-semibold text-white/85"
            >
              New · 成片气质预览
            </motion.div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/55">MV Studio Pro</div>
            <h1 className="mt-3 max-w-xl text-[1.85rem] font-black leading-[1.05] tracking-tight text-white md:text-[2.45rem]">
              {HEADLINE_LINES.map((line, i) => (
                <span key={line} className="block">
                  {reduceMotion ? line : <BlurInWords text={line} delay={0.12 + i * 0.22} />}
                </span>
              ))}
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/70">
              平台创作、竞品调研与创作画布同站协作。先看成片气质，再进入你要的工作台。
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link
                href="/platform"
                className="home-liquid-glass-strong rounded-full px-6 py-2.5 text-sm font-bold text-white no-underline transition hover:scale-[1.03]"
              >
                进入平台创作
              </Link>
              {!isAuthenticated ? (
                <Link
                  href="/login"
                  className="home-liquid-glass rounded-full px-6 py-2.5 text-sm font-bold text-white no-underline transition hover:scale-[1.03]"
                >
                  登录 / 注册
                </Link>
              ) : (
                <Link
                  href="/canvas"
                  className="home-liquid-glass rounded-full px-6 py-2.5 text-sm font-bold text-white no-underline transition hover:scale-[1.03]"
                >
                  打开创作画布
                </Link>
              )}
            </div>
            <div className="mt-5 text-xs text-white/55">
              {slide.subtitle} · <span className="text-white/85">{slide.title}</span>
            </div>
          </div>

          <div className="flex flex-col justify-between">
            <div className="flex flex-wrap gap-2">
              {slides.map((s, i) => (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => setIdx(i)}
                  className={`home-liquid-glass shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    i === idx ? "text-white ring-1 ring-white/40" : "text-white/60 hover:text-white"
                  }`}
                >
                  {s.title}
                </button>
              ))}
            </div>
            <div className="mt-5 grid gap-2">
              {FLAGSHIP.map((item, i) => (
                <motion.div
                  key={item.href}
                  initial={reduceMotion ? false : { opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + i * 0.08, duration: 0.4 }}
                >
                  <Link
                    href={item.href}
                    className="home-liquid-glass block rounded-2xl px-4 py-3 text-white no-underline transition hover:bg-white/[0.1]"
                  >
                    <div className="text-sm font-bold">{item.label}</div>
                    <div className="mt-1 text-[12px] leading-relaxed text-white/60">{item.desc}</div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .home-liquid-glass {
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.18);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.12);
        }
        .home-liquid-glass-strong {
          background: linear-gradient(135deg, rgba(255,255,255,0.22), rgba(255,255,255,0.08));
          border: 1px solid rgba(255,255,255,0.28);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 0 8px 28px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.2);
        }
        @media (max-width: 900px) {
          .home-hero-grid { grid-template-columns: 1fr !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .home-liquid-glass-strong:hover { transform: none; }
        }
      `}</style>
    </section>
  );
}
