import { ArrowUpRight, ScanLine } from "lucide-react";
import { LAPIAN_ENTRY_TITLE, LAPIAN_PATH, NOTE_REMIX_ENTRY_TITLE, NOTE_REMIX_PATH } from "@shared/premiumRemixRetired";

/**
 * 首页「拉片复刻爆款」唯一入口（站长 2026-11-11：原「爆款复刻」与「拉片」两个入口合并，分镜和出片统一走拉片）。
 * 保留旧锚点 #recreate（原爆款复刻条）与 #lapian，旧的站内锚点链接不失效。
 */
export default function HomeVideoBreakdown() {
  return (
    <section id="lapian" aria-labelledby="lapian-title" className="mx-auto max-w-[1240px] scroll-mt-24 px-5 py-14">
      <span id="recreate" className="block scroll-mt-24" aria-hidden="true" />
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-[var(--hp-accent)]">从喜欢的作品开始</p>
          <h2 id="lapian-title" className="mt-3 text-3xl font-bold text-[var(--hp-ink)]">{LAPIAN_ENTRY_TITLE}</h2>
        </div>
        <p className="max-w-lg text-sm leading-7 text-[var(--hp-muted)]">
          上传一支爆款短视频，拆开它为什么火、怎么拍、怎么说，再一键复刻或套用拍法做你自己的片。
        </p>
      </div>
      <a
        href={LAPIAN_PATH}
        className="group grid gap-6 rounded-3xl border border-[var(--hp-line)] bg-[var(--hp-card)] p-7 text-[var(--hp-ink)] transition hover:border-[var(--hp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hp-accent)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
      >
        <div>
          <div className="flex items-center gap-2 text-xs text-[var(--hp-muted)]">
            <ScanLine className="h-4 w-4 text-[var(--hp-accent)]" />
            <span>爆款策略 · 逐段拆解 · 口播台词 · 直接复刻 · 套用拍法</span>
          </div>
          <p className="mt-5 text-lg font-semibold">拉一支好片，复刻成你的爆款</p>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--hp-muted)]">
            逐段拆开镜头、节奏、口播与字幕，看懂开头钩子和爆款原因：可以直接复刻这支片，也可以套用它的拍法，换上你自己的主体和场景，做一支新的短视频。
          </p>
        </div>
        <span className="inline-flex items-center gap-2 justify-self-start rounded-full bg-[var(--hp-accent)] px-5 py-3 text-sm font-medium text-white md:justify-self-end">
          开始拉片复刻
          <ArrowUpRight size={17} aria-hidden="true" />
        </span>
      </a>
      <p className="mt-4 text-sm text-[var(--hp-muted)]">
        想复刻的是图文笔记？
        <a href={NOTE_REMIX_PATH} className="ml-1 font-medium text-[var(--hp-accent)] underline-offset-4 hover:underline">
          {NOTE_REMIX_ENTRY_TITLE}
        </a>
      </p>
    </section>
  );
}
