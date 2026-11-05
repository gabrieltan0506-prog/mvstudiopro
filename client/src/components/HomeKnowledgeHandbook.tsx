import React, { useEffect, useState } from "react";
import { KNOWLEDGE_HANDBOOK_WORKSPACE_HREF } from "@/lib/platformWorkbenchMode";

const SAMPLES = [
  { file: "palace-3.webp", book: "紫禁城是城与生命", page: "原稿第 3 页", title: "一座宫城，是怎样建起来的？", detail: "从地基、木材运输到工匠分工，把营建过程拆成图解。读建筑，也读背后的人与时间。" },
  { file: "palace-4.webp", book: "紫禁城是城与生命", page: "原稿第 4 页", title: "沿着中轴线，读懂宫城格局", detail: "空间示意、历史表格与文化线索并置，从一张图进入紫禁城的秩序与观念。" },
  { file: "health-1.webp", book: "秋冬高发疾病自检宝典", page: "原稿第 1 页", title: "把健康知识，整理成易读图解", detail: "人物情境、识别口诀和对照表放在同一页，展示健康科普如何按主题整理。", note: "原稿内容节选，供科普阅读，不能替代专业诊断。" },
  { file: "health-4.webp", book: "秋冬高发疾病自检宝典", page: "原稿第 4 页", title: "用结构图与对照表，解释复杂概念", detail: "以膝关节主题为例，结合结构示意、重点标注与文字说明，让抽象知识有清晰的阅读顺序。", note: "原稿内容节选，供科普阅读，不能替代专业诊断。" },
  { file: "shiji-diagram.webp", book: "史记导读手册", page: "手册第 1 页", title: "从人物与关系，走进《史记》", detail: "把人物、篇章与知识结构整理为一页图解，先看全貌，再循着重点展开阅读。" },
  { file: "shiji-reading.webp", book: "史记导读手册", page: "手册第 2 页", title: "图解之外，还有可细读的说明", detail: "用正文与表格解释图片中的重点。图像帮助理解，文字补充脉络，共同组成一本手册。" },
];
const sampleUrl = (file: string) => "/home-assets/knowledge-handbook/" + file;

/** 首页手册入口：展示图解与说明共同成册，以及用户需要确认的步骤。 */
export default function HomeKnowledgeHandbook() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPlaying(!motion.matches);
    const stopForReducedMotion = () => { if (motion.matches) setPlaying(false); };
    motion.addEventListener("change", stopForReducedMotion);
    return () => motion.removeEventListener("change", stopForReducedMotion);
  }, []);
  useEffect(() => {
    if (!playing || hovered || focused) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex(current => (current + 1) % SAMPLES.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [playing, hovered, focused]);
  const select = (next: number) => { setIndex((next + SAMPLES.length) % SAMPLES.length); setPlaying(false); };
  const sample = SAMPLES[index];
  return (
    <section id="knowledge-handbook" aria-labelledby="home-handbook-title" className="mx-auto max-w-[1240px] px-5 py-7">
      <div className="overflow-hidden rounded-3xl border border-[var(--hp-line)] bg-[var(--hp-card)]">
        <div className="p-6 sm:p-8">
          <div>
            <p className="text-xs font-semibold tracking-wide text-[var(--hp-accent)]">职场人汇报神器 · 教师备课好帮手</p>
            <h2 id="home-handbook-title" className="mt-3 text-2xl font-bold leading-snug text-[var(--hp-ink)] sm:text-3xl">图文知识手册</h2>
            <p className="mt-4 text-sm leading-7 text-[var(--hp-muted)]">上传文档、图片或粘贴正文，把资料整理成图解、说明和表格。汇报有重点，备课有脉络：导出 PDF 图文手册，或可编辑的 PPTX 课件，按需要修改、增删和调整讲解顺序。</p>
            <p className="mt-3 text-xs leading-6 text-[var(--hp-muted)]">支持 EPUB、PDF、JPG 等多类格式上传。</p>
            <a href={KNOWLEDGE_HANDBOOK_WORKSPACE_HREF} className="mt-6 inline-flex min-h-11 items-center justify-center gap-3 rounded-full bg-[var(--hp-ink)] px-5 py-3 text-sm font-semibold text-[var(--hp-card)] transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hp-accent)]">生成图文知识手册 <span aria-hidden="true">→</span></a>
          </div>
        </div>
        <div role="region" aria-roledescription="轮播" aria-label="图文知识手册内容实样"
          className="border-t border-[var(--hp-line)] p-5 sm:p-8"
          onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
          onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-semibold text-[var(--hp-ink)]">翻几页，看看成品</h3>
            <button type="button" onClick={() => setPlaying(value => !value)} className="min-h-11 rounded-full border border-[var(--hp-line)] px-4 text-xs text-[var(--hp-muted)]">{playing ? "暂停轮播" : "自动播放"}</button>
          </div>
          <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" aria-live={playing ? "off" : "polite"} aria-atomic="true">
            <a href={sampleUrl(sample.file)} target="_blank" rel="noopener noreferrer" aria-label={"查看《"+sample.book+"》"+sample.page+"整页"}
              className="block overflow-hidden rounded-2xl border border-[var(--hp-line)] bg-[#f4eee6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--hp-accent)]">
              <img src={sampleUrl(sample.file)} alt={sample.book+" · "+sample.page} width="2000" height="1125" decoding="async" className="aspect-[16/10] w-full object-contain" />
            </a>
            <div className="min-w-0" data-handbook-caption>
              <p className="text-xs leading-6 text-[var(--hp-accent)]">{sample.book} · {sample.page}</p>
              <h4 className="mt-3 text-xl font-semibold leading-relaxed text-[var(--hp-ink)] sm:text-2xl">{sample.title}</h4>
              <p className="mt-4 text-sm leading-7 text-[var(--hp-muted)]">{sample.detail}</p>
              {sample.note && <p className="mt-3 text-xs leading-6 text-[var(--hp-muted)]">{sample.note}</p>}
              <p className="mt-4 text-xs text-[var(--hp-muted)]">点击图片，查看完整内容页 ↗</p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1" aria-label="选择内容页">
              {SAMPLES.map((item, i) => <button key={item.file} type="button" aria-label={"第"+(i+1)+"页："+item.book} aria-current={i === index ? "true" : undefined} onClick={() => select(i)} className="flex h-11 w-8 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--hp-accent)]"><span className={"h-2 rounded-full transition-all " + (i === index ? "w-6 bg-[var(--hp-accent)]" : "w-2 bg-[var(--hp-line)]")} /></button>)}
            </div>
            <div className="flex items-center gap-3 text-sm text-[var(--hp-ink)]">
              <button type="button" aria-label="上一页" onClick={() => select(index - 1)} className="h-11 w-11 rounded-full border border-[var(--hp-line)]">←</button>
              <span className="text-xs tabular-nums">{index + 1} / {SAMPLES.length}</span>
              <button type="button" aria-label="下一页" onClick={() => select(index + 1)} className="h-11 w-11 rounded-full border border-[var(--hp-line)]">→</button>
            </div>
          </div>
        </div>
        <ol className="grid gap-5 border-t border-[var(--hp-line)] px-6 py-6 text-sm sm:grid-cols-3 sm:px-8">
          {[
            ["01", "上传与确认", "提供资料，确认内容、生成设置与费用。"],
            ["02", "自动生成与整理", "批量生成配图，启动创作顾问整理说明、审校并排版。"],
            ["03", "预览后成册", "确认成稿，自动导出 HTML / PDF；改字和选模板均可选。"],
          ].map(([number, title, detail]) => <li key={number}><span className="text-xs text-[var(--hp-accent)]">{number}</span><h3 className="mt-2 font-semibold text-[var(--hp-ink)]">{title}</h3><p className="mt-2 leading-6 text-[var(--hp-muted)]">{detail}</p></li>)}
        </ol>
      </div>
    </section>
  );
}
