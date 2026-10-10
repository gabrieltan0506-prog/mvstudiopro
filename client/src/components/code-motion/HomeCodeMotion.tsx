import {
  ArrowUpRight,
  ChartNoAxesColumnIncreasing,
  Image,
  Type,
} from "lucide-react";
export default function HomeCodeMotion() {
  return (
    <section
      id="yingke"
      aria-labelledby="yingke-title"
      className="mx-auto max-w-6xl scroll-mt-24 px-5 py-14 text-[var(--hp-ink)]"
    >
      <div className="grid overflow-hidden rounded-3xl border border-[var(--hp-line)] bg-[var(--hp-card)] md:grid-cols-[1.2fr_1fr]">
        <div className="p-7 sm:p-10">
          <p className="text-xs tracking-[0.2em] text-[var(--hp-accent)]">
            映客 INK · 代码创作
          </p>
          <h2
            id="yingke-title"
            className="mt-4 text-3xl font-semibold leading-tight"
          >
            一份想法，
            <br />
            两种作品。
          </h2>
          <p className="mt-4 max-w-md text-sm leading-7 text-[var(--hp-muted)]">
            放入文案、图片或 Excel
            表格，用自己的话说想法。用代码排版和制作动画，自选 PPTX 演示文稿或 MP4 视频。
          </p>
          <a
            href="/yingke"
            className="mt-6 inline-flex items-center gap-3 rounded-full bg-[var(--hp-accent)] px-5 py-3 text-sm font-medium text-white"
          >
            打开映客 INK
            <ArrowUpRight size={17} />
          </a>
          <p className="mt-3 text-xs text-[var(--hp-muted)]">
            PPTX 可编辑 · MP4 可播放 · 不需要写代码
          </p>
        </div>
        <div className="flex flex-col justify-center gap-3 bg-[var(--hp-input)] p-7 sm:p-10">
          {[
            {
              icon: Type,
              title: "把重点说清楚",
              detail: "文字依次进入，适合活动预告和知识说明",
            },
            {
              icon: Image,
              title: "让图片讲故事",
              detail: "产品图与说明搭配，做一段简洁介绍",
            },
            {
              icon: ChartNoAxesColumnIncreasing,
              title: "看见数据变化",
              detail: "用真实数值做出动态对比",
            },
          ].map(({ icon: Icon, title, detail }) => (
            <div
              key={title}
              className="flex gap-4 rounded-2xl border border-[var(--hp-line)] bg-[var(--hp-card)] p-5"
            >
              <Icon
                className="mt-1 shrink-0 text-[var(--hp-accent)]"
                size={22}
              />
              <div>
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-xs leading-5 text-[var(--hp-muted)]">
                  {detail}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
