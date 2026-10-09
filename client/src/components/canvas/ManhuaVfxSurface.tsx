import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** 同一个Portal容器在原位置与body之间移动，展开不会重建编辑器或视频。 */
export function ManhuaVfxSurface({ expanded, onClose, children, advisorOpen, onAdvisorDockChange }: {
  expanded: boolean;
  onClose: () => void;
  children: ReactNode;
  advisorOpen?: boolean;
  onAdvisorDockChange?: (host: HTMLDivElement | null) => void;
}) {
  const placeholder = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [host] = useState(() => typeof document === "undefined" ? null : document.createElement("div"));
  useLayoutEffect(() => {
    if (!host || !placeholder.current) return;
    const target = expanded ? document.body : placeholder.current;
    const media = Array.from(host.querySelectorAll("video")).map(video => ({ video, time: video.currentTime, playing: !video.paused }));
    // 支持原子移动的浏览器保留媒体播放；旧浏览器移动后恢复原秒位与播放状态。
    const movable = target as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void };
    if (host.isConnected && movable.moveBefore) movable.moveBefore(host, null);
    else target.appendChild(host);
    for (const { video, time, playing } of media) {
      if (Number.isFinite(time) && video.currentTime !== time) video.currentTime = time;
      if (playing && video.paused) void video.play().catch(() => undefined);
    }
  }, [expanded, host]);
  useLayoutEffect(() => () => { host?.remove(); }, [host]);
  useLayoutEffect(() => {
    if (!expanded || !surface.current) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    surface.current.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); close.current(); return; }
      if (event.key !== "Tab") return;
      const focusScope = surface.current?.querySelector<HTMLElement>('[role="dialog"]') || surface.current;
      const controls = Array.from(focusScope?.querySelectorAll<HTMLElement>(
        'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
      ) || []).filter(element => element.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (!first || !last) { event.preventDefault(); surface.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === surface.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !focusScope?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [expanded]);
  const docked = expanded && advisorOpen && Boolean(onAdvisorDockChange);
  return <div ref={placeholder} className="min-w-0">{host && createPortal(
    <div ref={surface} tabIndex={-1} role={expanded ? "dialog" : undefined} aria-modal={expanded || undefined}
      aria-label={expanded ? "全屏特效编辑空间" : undefined} data-vfx-expanded={expanded ? "true" : "false"}
      className={expanded ? "fixed inset-0 z-[90] flex h-[100dvh] min-w-0 overflow-hidden bg-[#080f19] text-white outline-none" : "min-w-0"}>
      <div className={expanded ? "min-h-0 min-w-0 flex-1" : "min-w-0"}>{children}</div>
      {docked ? <aside aria-label="特效创作顾问" className="h-full w-[min(340px,42vw)] shrink-0 overflow-hidden border-l border-cyan-200/15 bg-slate-950">
        <div ref={onAdvisorDockChange} className="h-full min-h-0" />
      </aside> : null}
    </div>, host,
  )}</div>;
}
