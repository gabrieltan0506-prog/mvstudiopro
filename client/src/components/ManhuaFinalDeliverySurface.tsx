import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** 移动稳定宿主而非另挂交付组件，保留范围、忙状态和进行中的下载。 */
export default function ManhuaFinalDeliverySurface({ inReview, children }: { inReview: boolean; children: ReactNode }) {
  const fallback = useRef<HTMLDivElement>(null);
  const [host] = useState(() => typeof document === "undefined" ? null : document.createElement("div"));
  useLayoutEffect(() => {
    if (!host) return;
    const target = inReview ? document.getElementById("manhua-final-delivery-host") : null;
    (target || fallback.current)?.appendChild(host);
    return () => { host.remove(); };
  }, [host, inReview]);
  return <><div ref={fallback} data-manhua-delivery-fallback />{host ? createPortal(children, host) : null}</>;
}
