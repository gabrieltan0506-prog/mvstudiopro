import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./knowledgeAuthoringDock.css";

/** 移动同一个宿主，不重新挂载顾问，保留输入、云稿与进行中的请求。 */
export function StableStudioDock({ target, children, hideWhenUndocked = false }: {
  target: HTMLElement | null;
  children: ReactNode;
  /** 没有停靠位时保持挂载但不显示（例如切到别的工作模式），不丢输入与进行中的请求。 */
  hideWhenUndocked?: boolean;
}) {
  const fallback = useRef<HTMLDivElement>(null);
  const [host] = useState(() => document.createElement("div"));
  useLayoutEffect(() => {
    (target ?? fallback.current)?.appendChild(host);
    return () => { host.remove(); };
  }, [target, host]);
  return <><div ref={fallback} hidden={Boolean(target) || hideWhenUndocked} />{createPortal(children, host)}</>;
}

export function KnowledgeAuthoringRow({ enabled, onDock, children }: {
  enabled: boolean;
  onDock: (element: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return <div className={enabled ? "knowledge-authoring-row" : undefined}>
    <div className={enabled ? "knowledge-authoring-grid" : undefined}>
      <div className={enabled ? "knowledge-authoring-text" : undefined}>{children}</div>
      {enabled && <aside ref={onDock} className="knowledge-authoring-advisor" aria-label="图文手册预览" />}
    </div>
  </div>;
}
