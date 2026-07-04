import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Sparkles } from "lucide-react";

export type PlatformSignalsCarouselTone = "platform" | "topic" | "action";

export type PlatformSignalsCarouselItem = {
  title: string;
  summary: string;
  detail: string;
  tone: PlatformSignalsCarouselTone;
  purchaseCta?: { href: string; label: string };
};

function shellCard(extra = "") {
  return `rounded-[28px] border border-white/10 bg-[rgba(14,9,32,0.88)] shadow-[0_18px_80px_rgba(0,0,0,0.28)] backdrop-blur ${extra}`.trim();
}

function toneGlowFrom(tone: PlatformSignalsCarouselTone): string {
  switch (tone) {
    case "platform":
      return "from-[#49e6ff]/50 via-[#7d73ff]/35 to-transparent";
    case "topic":
      return "from-[#ff4fb8]/50 via-[#ff7fd5]/38 to-transparent";
    default:
      return "from-[#ffdd44]/52 via-[#ffb020]/40 to-transparent";
  }
}

/** 分析报告轮播大卡：与「分析中」「分镜／封面区」共用。 */
export default function PlatformSignalsCarouselPanel(props: {
  items: PlatformSignalsCarouselItem[];
  activeIndex: number;
  onPickIndex: (i: number) => void;
  subtitle: string;
  eyebrow?: string;
  autoRotateMs?: number;
}) {
  const { items, activeIndex, onPickIndex, subtitle, eyebrow = "战略信号 · 自动轮播", autoRotateMs = 4500 } = props;
  if (!items.length) return null;
  const safeIdx = activeIndex % items.length;
  const active = items[safeIdx] ?? items[0];
  const toneCn =
    active.tone === "platform" ? "平台信号" : active.tone === "topic" ? "热点切口" : "动作建议";
  const barDurationSec = autoRotateMs / 1000;

  return (
    <div
      className={`${shellCard("relative overflow-hidden p-6 md:p-8")}`}
      role="region"
      aria-roledescription="carousel"
      aria-label="平台与热点信号轮播"
    >
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-[4px] bg-gradient-to-r ${toneGlowFrom(active.tone)}`} />
      <div className="pointer-events-none absolute -right-20 -top-24 h-52 w-52 rounded-full bg-[radial-gradient(circle,rgba(73,230,255,0.16),transparent_65%)] motion-safe:opacity-75 motion-safe:animate-[platformCarouselGlow_10s_ease-in-out_infinite]" />

      <div className="relative flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-5 w-5 shrink-0 text-[#ffdd44] motion-safe:animate-pulse" />
              <span className="text-base font-black tracking-tight text-white md:text-lg">{eyebrow}</span>
              <span className="rounded-full border border-[#49e6ff]/35 bg-[rgba(73,230,255,0.09)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8cefff]">
                LIVE
              </span>
            </div>
            <p className="mt-3 max-w-lg text-sm leading-7 text-[#c8bfe7] md:text-[15px]">{subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-[11px] text-[#dfe6ff]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#49e6ff]/50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#49e6ff]" />
            </span>
            每 <span className="mx-1 font-bold text-[#8cefff]">{barDurationSec}</span> 秒自动切换 · 亦可点下方卡片预览
          </div>
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]" aria-hidden>
          <div
            key={`prog-${safeIdx}`}
            className="h-full w-full origin-left scale-x-0 bg-gradient-to-r from-[#49e6ff] via-[#7d73ff] to-[#ff4fb8]"
            style={{ animation: `platformCarouselProg ${barDurationSec}s linear forwards` }}
          />
        </div>

        <div className="relative min-h-[clamp(220px,32vw,340px)]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${toneCn}-${safeIdx}-${active.title}`}
              initial={{ opacity: 0, y: 16, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.99 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-[28px] border border-white/14 bg-[linear-gradient(135deg,rgba(73,230,255,0.11),rgba(125,115,255,0.07),rgba(255,117,189,0.09))] p-6 md:p-8 shadow-[0_28px_80px_rgba(0,0,0,0.35)] backdrop-blur-sm"
            >
              <div
                className={`text-[12px] font-bold uppercase tracking-[0.26em] ${
                  toneCn === "平台信号" ? "text-[#8cefff]" : toneCn === "热点切口" ? "text-[#ff98d9]" : "text-[#ffe77a]"
                }`}
              >
                {toneCn}
              </div>
              <div className="mt-5 text-[1.65rem] font-black leading-[1.08] tracking-tight text-white md:text-4xl xl:text-[2.35rem]">
                {active.title}
              </div>
              <div className="mt-5 whitespace-pre-line text-base font-medium leading-relaxed text-[#eef6ff] md:text-lg">
                {active.summary}
              </div>
              <div className="mt-6 rounded-[22px] border border-white/12 bg-[rgba(8,6,22,0.55)] px-5 py-4 text-sm leading-8 text-[#d9d1f5] md:text-[15px]">
                {active.detail}
              </div>
              {active.purchaseCta ? (
                <a
                  href={active.purchaseCta.href}
                  className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#8cefff] underline-offset-4 hover:text-[#49e6ff] hover:underline"
                >
                  {active.purchaseCta.label}
                  <ChevronRight className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
                </a>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex gap-2.5 overflow-x-auto pb-1 custom-scrollbar [-webkit-overflow-scrolling:touch]">
          {items.map((item, idx) => {
            const selected = idx === safeIdx;
            return (
              <button
                key={`${item.title}-${idx}-${item.tone}`}
                type="button"
                onClick={() => onPickIndex(idx)}
                title={item.title}
                className={`min-w-[7.25rem] max-w-[min(11rem,calc((100vw-4rem)/2))] shrink-0 rounded-2xl border px-3 py-2.5 text-left transition hover:border-[#49e6ff]/35 hover:bg-[rgba(73,230,255,0.06)] md:min-w-[8.75rem] ${
                  selected
                    ? "border-[#49e6ff]/50 bg-[rgba(73,230,255,0.12)] shadow-[0_0_28px_-8px_rgba(73,230,255,0.55)]"
                    : "border-white/12 bg-black/25"
                }`}
              >
                <div
                  className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${
                    item.tone === "platform"
                      ? "text-[#7ceaff]"
                      : item.tone === "topic"
                        ? "text-[#ff94d9]"
                        : "text-[#ffe07a]"
                  }`}
                >
                  {item.tone === "platform" ? "平台" : item.tone === "topic" ? "热点" : "动作"}
                </div>
                <div className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-white">{item.title}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
