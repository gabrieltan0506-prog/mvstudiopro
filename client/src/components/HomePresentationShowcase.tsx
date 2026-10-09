import React from "react";

const samples = [
  { title: "黑金商务 · 品牌提案", description: "用克制的色彩与留白，呈现品牌质感。", src: "/home-assets/ppt/luxury.png", width: 1920, height: 1080 },
  { title: "内容增长 · 数据仪表盘", description: "把关键指标、增长趋势与转化放到一张图里。", src: "/home-assets/ppt/content-growth.svg", width: 1600, height: 1000 },
];

export default function HomePresentationShowcase() {
  return (
    <section aria-labelledby="presentation-samples-heading" className="mx-auto max-w-[1240px] px-5 py-12">
      <p className="text-xs font-medium tracking-[0.18em] text-[var(--hp-accent)]">PPT / 数据可视化</p>
      <h2 id="presentation-samples-heading" className="mt-3 text-2xl font-semibold text-[var(--hp-ink)] sm:text-3xl">让内容，有值得打开的样子。</h2>
      <p className="mt-3 text-sm text-[var(--hp-muted)]">品牌提案与数据报告样张，点击查看完整大图。</p>
      <div className="mt-6 grid gap-5 md:grid-cols-2">
        {samples.map(sample => (
          <a key={sample.src} href={sample.src} target="_blank" rel="noopener noreferrer" aria-label={`${sample.title}，在新标签页查看完整样张`} className="group overflow-hidden rounded-2xl border border-[var(--hp-line)] bg-[var(--hp-card)] no-underline transition hover:border-[var(--hp-accent-line)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hp-accent)]">
            <div className="flex aspect-[16/10] items-center bg-[var(--hp-input)]">
              <img src={sample.src} alt={sample.title} width={sample.width} height={sample.height} loading="lazy" decoding="async" className="h-full w-full object-contain" />
            </div>
            <div className="border-t border-[var(--hp-line)] px-5 py-4">
              <h3 className="font-medium text-[var(--hp-ink)]">{sample.title}<span aria-hidden="true" className="float-right text-[var(--hp-accent)]">↗</span></h3>
              <p className="mt-2 text-sm text-[var(--hp-muted)]">{sample.description}</p>
            </div>
          </a>
        ))}
      </div>
      <p className="mt-3 text-xs text-[var(--hp-muted)]">视觉设计样张 · 品牌与数据均为演示内容，仪表盘为静态展示。</p>
    </section>
  );
}
