import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/** 顾问与场景共处一个工作区，收起顾问后场景恢复完整宽度。 */
export function ManhuaSecondaryStudioSurface({ immersive, title, onClose, children, advisorOpen, onOpenAdvisor, onAdvisorDockChange }: {
  immersive: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  advisorOpen?: boolean;
  onOpenAdvisor?: () => void;
  onAdvisorDockChange?: (host: HTMLDivElement | null) => void;
}) {
  if (!immersive && !onAdvisorDockChange) return <>{children}</>;
  const withAdvisor = Boolean(advisorOpen && onAdvisorDockChange);
  const content = <section role={immersive ? "dialog" : "region"} aria-modal={immersive ? true : undefined} aria-label={title}
    className={`flex min-h-0 min-w-0 flex-col border-l border-white/20 bg-[#0a121c] text-white shadow-2xl ${immersive ? withAdvisor ? "h-full w-full" : "h-full w-[min(96vw,80rem)]" : "h-[85dvh] w-full"}`}>
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/15 px-4 py-3">
      <strong className="text-sm">{title}</strong>
      <div className="flex items-center gap-2">
        {onOpenAdvisor && <button type="button" onClick={onOpenAdvisor} aria-expanded={withAdvisor}
          className="rounded-lg border border-cyan-300/40 px-3 py-1.5 text-xs text-cyan-100">创作顾问</button>}
        <button type="button" onClick={onClose} aria-label={`关闭${title}`} className="rounded-lg border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10">关闭</button>
      </div>
    </header>
    <div className={`grid min-h-0 flex-1 ${withAdvisor ? "grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-1" : "grid-cols-1 grid-rows-1"}`}>
      <div data-manhua-studio-content className="min-h-0 min-w-0 overflow-y-auto p-4">{children}</div>
      {onAdvisorDockChange && <div ref={onAdvisorDockChange} data-manhua-advisor-dock className={withAdvisor ? "min-h-0 min-w-0 overflow-hidden" : "hidden"} />}
    </div>
  </section>;
  if (!immersive) return content;
  if (typeof document === "undefined") return null;
  return createPortal(<div data-manhua-secondary-studio-overlay className="fixed inset-0 z-[90] flex justify-end bg-black/65">{content}</div>, document.body);
}
