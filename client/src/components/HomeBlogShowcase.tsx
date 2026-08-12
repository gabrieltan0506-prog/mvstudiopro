import React from "react";
import { Link } from "wouter";

/**
 * 实测展示区（2026-08-12 替换旧「卡布奇诺试读样刊」区）：
 * 用户拍板——说得再多不如图片视频展示；用 /blog 实测文章的封面当主视觉，
 * 点封面直达对应生成工作台（最短转化路径），「看实测过程」小链去文章。
 */

type ShowcaseEntry = {
  cover: string;
  title: string;
  line: string;
  /** 点封面/主按钮直达的生成入口 */
  generateHref: string;
  generateLabel: string;
  /** 实测文章 */
  articleHref: string;
};

const SHOWCASE: ShowcaseEntry[] = [
  {
    cover: "/blog-assets/pk-kimi-vs-qwen/pk-05-overview.jpg",
    title: "一条爆款选题，从文案写到 4K 成片",
    line: "选题 → 拆片表 → 海报 → 5 秒成片 → 4K 超分，全程没离开这个网站。",
    generateHref: "/platform?mode=create",
    generateLabel: "去写我的选题",
    articleHref: "/blog/kimi-k3-vs-qwen-38-max-real-test",
  },
  {
    cover: "/blog-assets/video-4k-upscale/poster-25-4k.jpg",
    title: "720P 实测升到 4K，泪痕和睫毛都回来了",
    line: "哭戏、雨中对峙、K-pop 三组同帧对比，超分放大的真实功效。",
    generateHref: "/canvas",
    generateLabel: "去做我的成片",
    articleHref: "/blog/video-4k-upscale",
  },
  {
    cover: "/blog-assets/manhua-video-model-review/00-cover-seedance-25-pour.jpg",
    title: "做漫剧，哪个引擎更能打？",
    line: "同一套素材实测三代引擎，画面、速度、价格带一次看清。",
    generateHref: "/canvas",
    generateLabel: "去开我的漫剧",
    articleHref: "/blog/manhua-video-model-review",
  },
];

export default function HomeBlogShowcase() {
  return (
    <section className="mx-auto w-full max-w-[1240px] px-5 py-14">
      <div className="text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold tracking-wide text-white/60">
          真实实测 · 眼见为实
        </span>
        <h2 className="mt-4 text-[26px] font-extrabold leading-tight text-white sm:text-[34px]">
          别听我们说，看做出来的东西
        </h2>
        <p className="mx-auto mt-3 max-w-[640px] text-[13px] leading-relaxed text-white/55 sm:text-sm">
          每张图背后都是一篇真实生产实测。看中哪个效果，点进去直接做同款。
        </p>
      </div>

      <div className="mt-9 grid gap-4 sm:grid-cols-3">
        {SHOWCASE.map((s) => (
          <div
            key={s.articleHref}
            className="group flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition-colors hover:border-white/20 hover:bg-white/[0.05]"
          >
            <Link href={s.generateHref} className="block" aria-label={`${s.title}——去生成同款`}>
              <img
                src={s.cover}
                alt={s.title}
                loading="lazy"
                className="aspect-[16/10] w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              />
            </Link>
            <div className="flex flex-1 flex-col p-4">
              <h3 className="text-[15px] font-bold leading-snug text-white">{s.title}</h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-white/50">{s.line}</p>
              <div className="mt-auto flex items-center justify-between gap-2 pt-4">
                <Link
                  href={s.generateHref}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.06] px-3.5 py-2 text-[12.5px] font-semibold text-white no-underline transition-colors hover:border-white/30 hover:bg-white/[0.1]"
                >
                  {s.generateLabel} <span aria-hidden>→</span>
                </Link>
                <Link
                  href={s.articleHref}
                  className="text-[11.5px] text-white/45 no-underline underline-offset-2 hover:text-white/70 hover:underline"
                >
                  看实测过程
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
