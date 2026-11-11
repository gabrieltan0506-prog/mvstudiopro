import { ArrowUpRight, ScanLine } from "lucide-react";

/** 首页「拉片」入口：紧跟爆款复刻，同属「从参考作品开始」这一组。 */
export default function HomeVideoBreakdown() {
  return (
    <section id="lapian" aria-labelledby="lapian-title" className="mx-auto max-w-[1240px] scroll-mt-24 px-5 pb-14">
      <a
        href="/lapian"
        className="group grid gap-6 rounded-3xl border border-[var(--hp-line)] bg-[var(--hp-card)] p-7 text-[var(--hp-ink)] transition hover:border-[var(--hp-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--hp-accent)] md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
      >
        <div>
          <div className="flex items-center gap-2 text-xs text-[var(--hp-muted)]">
            <ScanLine className="h-4 w-4 text-[var(--hp-accent)]" />
            <span>拆解 · 直接复刻 · 套用拍法做新片</span>
          </div>
          <h3 id="lapian-title" className="mt-5 text-2xl font-semibold">拉片</h3>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--hp-muted)]">
            拉一支好片，逐段拆开它的镜头与节奏：可以直接复刻这支片，也可以套用它的拍法，换上你自己的主体和场景，做一支新的短视频。
          </p>
        </div>
        <span className="inline-flex items-center gap-2 justify-self-start rounded-full bg-[var(--hp-accent)] px-5 py-3 text-sm font-medium text-white md:justify-self-end">
          开始拉片
          <ArrowUpRight size={17} aria-hidden="true" />
        </span>
      </a>
    </section>
  );
}
