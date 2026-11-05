import React from "react";
import { KNOWLEDGE_HANDBOOK_WORKSPACE_HREF } from "@/lib/platformWorkbenchMode";

/** 首页手册入口：展示图解与说明共同成册，以及用户需要确认的步骤。 */
export default function HomeKnowledgeHandbook() {
  return (
    <section id="knowledge-handbook" aria-labelledby="home-handbook-title" className="mx-auto max-w-[1240px] px-5 py-7">
      <div className="overflow-hidden rounded-3xl border border-[var(--hp-line)] bg-[var(--hp-card)]">
        <div className="p-6 sm:p-8">
          <div>
            <p className="text-xs font-semibold tracking-wide text-[var(--hp-accent)]">把资料读成一本手册</p>
            <h2 id="home-handbook-title" className="mt-3 text-2xl font-bold leading-snug text-[var(--hp-ink)] sm:text-3xl">图文知识手册</h2>
            <p className="mt-4 text-sm leading-7 text-[var(--hp-muted)]">上传文档、图片或粘贴正文，把内容转成知识图解，再配上解释图中重点的文字说明。图文穿插、按主题排版，导出一本可阅读、可分享的手册。</p>
            <p className="mt-3 text-xs leading-6 text-[var(--hp-muted)]">支持 EPUB、PDF、JPG 等多类格式上传。</p>
            <a href={KNOWLEDGE_HANDBOOK_WORKSPACE_HREF} className="mt-6 inline-flex min-h-11 items-center justify-center gap-3 rounded-full bg-[var(--hp-ink)] px-5 py-3 text-sm font-semibold text-[var(--hp-card)] transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hp-accent)]">生成图文知识手册 <span aria-hidden="true">→</span></a>
          </div>
        </div>
        <div className="border-t border-[var(--hp-line)] px-6 py-6 sm:px-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold text-[var(--hp-ink)]">看看生成后的内容页</h3>
            <p className="text-xs leading-6 text-[var(--hp-muted)]">《史记导读手册》实样 · 点击查看整页</p>
          </div>
          <div className="mt-4 grid gap-5 sm:grid-cols-3">
            {[
              {file:"shiji-diagram.webp", title:"知识图解", detail:"用图像呈现人物、关系与知识结构。"},
              {file:"shiji-reading.webp", title:"主题表格与知识整理", detail:"关键概念并排比较，按主题阅读。"},
              {file:"shiji-tables.webp", title:"图解配文字说明", detail:"解释图片中的重点，展开阅读。"},
            ].map(sample => <figure key={sample.file} className="min-w-0">
              <a href={"/home-assets/knowledge-handbook/"+sample.file} target="_blank" rel="noopener noreferrer" aria-label={"查看"+sample.title+"整页"} className="block overflow-hidden rounded-xl border border-[var(--hp-line)] bg-[#faf0f6] shadow-sm transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hp-accent)]">
                <img src={"/home-assets/knowledge-handbook/"+sample.file} alt={"史记导读手册实际内容页："+sample.title} loading="lazy" decoding="async" width="960" height="1344" className="aspect-[5/7] w-full object-contain" />
              </a>
              <figcaption className="mt-3"><p className="text-sm font-semibold text-[var(--hp-ink)]">{sample.title}</p><p className="mt-1 text-xs leading-6 text-[var(--hp-muted)]">{sample.detail}</p></figcaption>
            </figure>)}
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
