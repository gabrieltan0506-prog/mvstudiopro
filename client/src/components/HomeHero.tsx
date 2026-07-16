import { Link } from "wouter";
import React, { useEffect, useState } from "react";
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

export default function HomeHero() {
  const { isAuthenticated } = useAuth({ autoFetch: true });
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx((v) => (v + 1) % slides.length), 5500);
    return () => clearInterval(t);
  }, []);

  const slide = slides[idx];

  return (
    <section className="mx-auto max-w-[1240px] px-5 pt-7">
      <div className="rounded-3xl border border-white/10 bg-[#0c0b16]/95 p-5 md:p-6">
        <div className="home-hero-grid grid items-stretch gap-6 md:grid-cols-[1.2fr_0.8fr]">
          {/* 成片主视觉 */}
          <div>
            <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black">
              <video
                key={slide.videoUrl}
                src={slide.videoUrl}
                poster={slide.poster}
                autoPlay
                muted
                loop
                playsInline
                controls={false}
                className="block h-full w-full object-cover"
              />
              <FloatingVideoWatermark enabled text="Powered by mvstudiopro.com" />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent" />
              <div className="absolute bottom-4 left-4 right-4 text-white">
                <div className="text-xs font-semibold text-white/70">{slide.subtitle}</div>
                <div className="mt-1 text-2xl font-black tracking-tight md:text-3xl">{slide.title}</div>
              </div>
            </div>

            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {slides.map((s, i) => (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => setIdx(i)}
                  className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold ${
                    i === idx
                      ? "border-white/35 bg-white/12 text-white"
                      : "border-white/10 bg-white/[0.04] text-white/65"
                  }`}
                >
                  {s.title}
                </button>
              ))}
            </div>
          </div>

          {/* 品牌 + CTA */}
          <div className="flex flex-col justify-between rounded-2xl border border-white/8 bg-white/[0.03] p-5 md:p-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                MV Studio Pro
              </div>
              <h1 className="mt-3 text-[1.75rem] font-black leading-tight tracking-tight text-white md:text-[2.1rem]">
                从洞察到成片
                <br />
                一个人也能跑通全链路
              </h1>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/65">
                平台创作、竞品调研与创作画布同站协作。先看成片气质，再进入你要的工作台。
              </p>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/platform"
                className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-[#0a0915] no-underline"
              >
                进入平台创作
              </Link>
              {!isAuthenticated ? (
                <Link
                  href="/login"
                  className="rounded-xl border border-white/20 bg-transparent px-5 py-3 text-sm font-bold text-white no-underline"
                >
                  登录 / 注册
                </Link>
              ) : (
                <Link
                  href="/canvas"
                  className="rounded-xl border border-white/20 bg-transparent px-5 py-3 text-sm font-bold text-white no-underline"
                >
                  打开创作画布
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* 三条主能力 — 只保留一排 */}
        <div className="home-feature-cards mt-5 grid gap-3 sm:grid-cols-3">
          {FLAGSHIP.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 text-white no-underline transition hover:border-white/25 hover:bg-white/[0.06]"
            >
              <div className="text-sm font-bold">{item.label}</div>
              <div className="mt-1.5 text-[13px] leading-relaxed text-white/55">{item.desc}</div>
            </Link>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .home-hero-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
