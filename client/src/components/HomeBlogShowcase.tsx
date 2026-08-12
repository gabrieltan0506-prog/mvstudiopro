import React from "react";
import { Link } from "wouter";

/**
 * 每日实测轮播（2026-08-12 用户拍板，替换旧「卡布奇诺试读样刊」区）：
 * 「说得再多不如图片视频展示」——每天自动换一篇 blog 有趣实测当门面，
 * 封面可指定文章内任意一张图（不限 frontmatter cover）。
 * 轮换机制：天数 % 池大小，纯前端确定性轮换，零后端、零请求，每日零点自动翻篇。
 * 点封面/主按钮直达对应生成工作台（最短转化路径），「看实测过程」小链去文章。
 */

type ShowcaseEntry = {
  cover: string;
  title: string;
  line: string;
  generateHref: string;
  generateLabel: string;
  articleHref: string;
};

const POOL: ShowcaseEntry[] = [
  {
    cover: "/blog-assets/pk-kimi-vs-qwen/pk-05-overview.jpg",
    title: "一条爆款选题，从文案写到 4K 成片",
    line: "选题 → 拆片表 → 海报 → 5 秒成片 → 4K 超分，全程没离开这个网站。",
    generateHref: "/platform?mode=create",
    generateLabel: "去写我的选题",
    articleHref: "/blog/kimi-k3-vs-qwen-38-max-real-test",
  },
  {
    cover: "/blog-assets/video-4k-upscale/compare-25-720p-vs-4k.jpg",
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
  {
    cover: "/blog-assets/old-photo-home-update-h3-poster.jpg",
    title: "桌上那张旧照片，终于重新笑了起来",
    line: "翻拍 → 裁切 → 修复上色 → 高清放大 → 让人动起来，一条链跑通。",
    generateHref: "/#photo-tools",
    generateLabel: "去修我的老照片",
    articleHref: "/blog/old-photo-restoration-upscale-memory-awakened",
  },
  {
    cover: "/blog-assets/sd5-board-gptimage2.jpg",
    title: "同一句提示词，价差三四倍的两台出图引擎",
    line: "中文排版、人物质感、复杂版面三题对照，贵的赢在哪一目了然。",
    generateHref: "/platform?mode=create&tab=copy",
    generateLabel: "去出我的图",
    articleHref: "/blog/seedream-5-pro-vs-gpt-image-2",
  },
  {
    cover: "/blog-assets/poster-h3-2k-5s.jpg",
    title: "视频模型的真实单价，和标价差 67%",
    line: "从账单里读出来的数字——四个模型实测，标价为什么会骗你。",
    generateHref: "/canvas",
    generateLabel: "去做我的成片",
    articleHref: "/blog/ai-video-model-real-pricing",
  },
];

/** 按自然日轮换（本地时区），同一天全站看到同一篇 */
function todayIndex(poolSize: number): number {
  const now = new Date();
  const dayNumber = Math.floor(
    (now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000,
  );
  return ((dayNumber % poolSize) + poolSize) % poolSize;
}

export default function HomeBlogShowcase() {
  const idx = todayIndex(POOL.length);
  const s = POOL[idx]!;
  return (
    <section className="mx-auto w-full max-w-[1240px] px-5 py-14">
      <div className="text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold tracking-wide text-white/60">
          每日实测 · 眼见为实
        </span>
        <h2 className="mt-4 text-[26px] font-extrabold leading-tight text-white sm:text-[34px]">
          别听我们说，看做出来的东西
        </h2>
        <p className="mx-auto mt-3 max-w-[640px] text-[13px] leading-relaxed text-white/55 sm:text-sm">
          每天换一篇真实生产实测。看中这个效果，点进去直接做同款。
        </p>
      </div>

      <div className="mx-auto mt-9 max-w-[880px] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] transition-colors hover:border-white/20">
        <Link href={s.generateHref} className="group block" aria-label={`${s.title}——去生成同款`}>
          <img
            src={s.cover}
            alt={s.title}
            loading="lazy"
            className="aspect-[16/9] w-full object-cover transition-transform duration-300 group-hover:scale-[1.01]"
          />
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-[16rem] flex-1">
            <h3 className="text-[17px] font-bold leading-snug text-white">{s.title}</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/50">{s.line}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Link
              href={s.generateHref}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/[0.06] px-4 py-2.5 text-[13px] font-semibold text-white no-underline transition-colors hover:border-white/30 hover:bg-white/[0.1]"
            >
              {s.generateLabel} <span aria-hidden>→</span>
            </Link>
            {/* /blog 是构建产出的静态页而非 SPA 路由，必须整页跳转（同 HomeNavbar 口径） */}
            <a
              href={s.articleHref}
              className="text-[12px] text-white/45 no-underline underline-offset-2 hover:text-white/70 hover:underline"
            >
              看实测过程
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
