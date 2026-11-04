import React from "react";

/** 新增趋势能力的首页介绍，沿用现有趋势工作台入口。 */
export default function HomeTrendIntro() {
  return (
    <section aria-labelledby="home-trend-title" className="mx-auto max-w-[1240px] px-5 pb-3 pt-7">
      <div className="flex flex-col gap-6 rounded-3xl border border-[var(--hp-line)] bg-[var(--hp-card)] p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold tracking-wide text-[var(--hp-accent)]">新增能力 · 从趋势找到下一条作品</p>
          <h2 id="home-trend-title" className="mt-3 text-2xl font-bold leading-snug text-[var(--hp-ink)] sm:text-3xl">
            视频号与 TikTok 趋势追踪
          </h2>
          <p className="mt-3 text-sm leading-7 text-[var(--hp-muted)]">
            发现近期热门内容，拆解博主爆款作品的选题切口、内容结构与可借鉴做法。
          </p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-[var(--hp-ink)]">
            <span>近期趋势追踪</span>
            <span>博主爆款作品拆解</span>
            <span>创作选题建议</span>
          </div>
        </div>
        <a href="/platform?mode=trend" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-3 self-start rounded-full bg-[var(--hp-ink)] px-5 py-3 text-sm font-semibold text-[var(--hp-card)] transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hp-accent)] lg:self-center">
          查看趋势与作品拆解 <span aria-hidden="true">→</span>
        </a>
      </div>
    </section>
  );
}
