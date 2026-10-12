import React from "react";

export default function HomeRemixStrip() {
  return (
    <section
      id="recreate"
      aria-labelledby="recreate-title"
      className="mx-auto max-w-[1240px] px-5 py-14"
    >
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-[var(--hp-accent)]">
            从喜欢的作品开始
          </p>
          <h2
            id="recreate-title"
            className="mt-3 text-3xl font-bold text-[var(--hp-ink)]"
          >
            爆款复刻
          </h2>
        </div>
        <p className="max-w-lg text-sm leading-7 text-[var(--hp-muted)]">
          分析参考作品的结构，整理成你的故事或图文方案。
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[
          {
            mode: "video",
            title: "复刻视频",
            number: "01",
            detail: "镜头 · 节奏 · 表演 · 声音",
            desc: "分析镜头、叙事和声音，整理复刻方案后进入漫剧工厂制作。",
            label: "从参考视频开始",
          },
          {
            mode: "note",
            title: "复刻笔记",
            number: "02",
            detail: "封面 · 标题 · 图文 · 正文",
            desc: "看懂封面与阅读顺序，逐页整理自己的图文内容，保留可继续修改的发布稿。",
            label: "从参考笔记开始",
          },
        ].map(item => (
          <a
            key={item.mode}
            href={`/creator-growth-camp/premium-remix?format=${item.mode}`}
            className="group block rounded-3xl border border-[var(--hp-line)] bg-[var(--hp-card)] p-7 text-[var(--hp-ink)] transition hover:border-[var(--hp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hp-accent)]"
          >
            <div className="flex justify-between text-xs text-[var(--hp-muted)]">
              <span>{item.detail}</span>
              <span>{item.number}</span>
            </div>
            <h3 className="mt-7 text-2xl font-semibold">{item.title}</h3>
            <p className="mt-3 max-w-md text-sm leading-7 text-[var(--hp-muted)]">
              {item.desc}
            </p>
            <div className="mt-7 font-semibold text-[var(--hp-accent)]">
              {item.label} <span aria-hidden="true">→</span>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
