import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** 只移动既有编辑视图；素材、剪辑状态和保存回调仍由同一工作台持有。 */
export function ManhuaFineCutSurface({ inCanvas, children }: { inCanvas?: boolean; children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setHost(inCanvas ? document.getElementById("manhua-freeform-finecut") : null);
  }, [inCanvas]);
  return inCanvas ? (host ? createPortal(children, host) : null) : <>{children}</>;
}
