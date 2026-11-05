import React from "react";

const holograms = [
  { title: "宇宙奇想", description: "电影动画风 · 让星球与轨道跃出屏幕。", src: "/home-assets/ppt/hologram-zebra-cosmos.png" },
  { title: "星际探索", description: "复古未来风 · 跟随长颈鹿走进立体宇宙。", src: "/home-assets/ppt/hologram-giraffe-cosmos.png" },
  { title: "生命之窗", description: "清透展馆风 · 用空间层次呈现身体结构。", src: "/home-assets/ppt/hologram-giraffe-anatomy.png" },
];

const samples = [
  { title: "黑金商务 · 品牌提案", description: "用克制的色彩与留白，呈现品牌质感。", src: "/home-assets/ppt/luxury.png", width: 1920, height: 1080 },
  { title: "内容增长 · 数据仪表盘", description: "把关键指标、增长趋势与转化放到一张图里。", src: "/home-assets/ppt/content-growth.svg", width: 1600, height: 1000 },
];

export default function HomePresentationShowcase() {
  return (
    <section aria-labelledby="presentation-samples-heading" className="mx-auto max-w-[1240px] px-5 py-12">
      <p className="text-xs font-medium tracking-[0.18em] text-[var(--hp-accent)]">AI PPT / 数据可视化</p>
      <h2 id="presentation-samples-heading" className="mt-3 text-2xl font-semibold text-[var(--hp-ink)] sm:text-3xl">一个主题，展开成一份 AI PPT。</h2>
      <p className="mt-3 text-sm text-[var(--hp-muted)]">只需输入主题，AI 生成完整大纲；确认后制作页面，也可加入已有动效 MP4。</p>
      <p className="mt-4 text-base font-medium text-[var(--hp-ink)]">做 PPT 没灵感？让创作顾问手把手带你</p>
      <a href="/platform?mode=tools&tab=htmlPpt" className="mt-5 inline-flex rounded-full bg-[var(--hp-accent)] px-5 py-3 text-sm font-medium text-white">制作 AI PPT →</a>
      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {holograms.map(sample => (
          <a key={sample.src} href={sample.src} target="_blank" rel="noopener noreferrer" aria-label={`${sample.title}，在新标签页查看完整创意图`} className="overflow-hidden rounded-2xl border border-[var(--hp-line)] bg-[var(--hp-card)] no-underline transition hover:border-[var(--hp-accent-line)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hp-accent)]">
            <img src={sample.src} alt={sample.title + "：动物注视从 PPT 屏幕向外投射的立体内容"} width={1536} height={1024} loading="lazy" decoding="async" className="aspect-[3/2] w-full object-contain" />
            <div className="border-t border-[var(--hp-line)] px-5 py-4">
              <h3 className="font-medium text-[var(--hp-ink)]">{sample.title}</h3>
              <p className="mt-2 text-sm text-[var(--hp-muted)]">{sample.description}</p>
            </div>
          </a>
        ))}
      </div>
      <p className="mt-3 text-xs text-[var(--hp-muted)]">全息创意插画 · 展示视觉灵感，非实际投影效果；身体结构为艺术示意。</p>
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
