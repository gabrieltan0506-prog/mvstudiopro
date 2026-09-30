import type { ReactNode } from "react";

/** 顾问与场景共处一个工作区，收起顾问后场景恢复完整宽度。 */
export function ManhuaSecondaryStudioSurface({ immersive, title, onClose, children, advisorOpen, onOpenAdvisor, onAdvisorDockChange, onPreviewHostChange, clipId }: {
  onPreviewHostChange?: (host: HTMLDivElement | null) => void;
  clipId?: string;
  immersive: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  advisorOpen?: boolean;
  onOpenAdvisor?: () => void;
  onAdvisorDockChange?: (host: HTMLDivElement | null) => void;
}) {
  const withAdvisor = Boolean(advisorOpen && onAdvisorDockChange);
  const content = <section role="region" aria-label={title} data-manhua-secondary-studio
    className="flex h-[78dvh] min-h-[28rem] w-full min-w-0 flex-col rounded-xl border border-white/20 bg-[#0a121c] text-white">
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/15 px-4 py-3">
      <strong className="text-sm">{title}</strong>
      <div className="flex items-center gap-2">
        {onOpenAdvisor && <button type="button" onClick={onOpenAdvisor} aria-expanded={withAdvisor}
          className="rounded-lg border border-cyan-300/40 px-3 py-1.5 text-xs text-cyan-100">创作顾问</button>}
        <button type="button" onClick={onClose} aria-label={`收起${title}`} className="rounded-lg border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10">收起</button>
      </div>
    </header>
    <div className={`grid min-h-0 flex-1 ${withAdvisor ? "grid-rows-[minmax(0,1fr)_minmax(18rem,1fr)] lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-1" : "grid-cols-1 grid-rows-1"}`}>
      <div data-manhua-studio-content className="min-h-0 min-w-0 overflow-y-auto p-4"><div key={clipId} ref={onPreviewHostChange} data-manhua-advisor-preview data-clip-id={clipId} />{children}</div>
      {onAdvisorDockChange && <div ref={onAdvisorDockChange} data-manhua-advisor-dock className={withAdvisor ? "min-h-0 min-w-0 overflow-hidden" : "hidden"} />}
    </div>
  </section>;
  return content;
}
