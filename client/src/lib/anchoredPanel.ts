/**
 * 面板锚定到点击处（0902 UX 铁律·零位移）：宽屏下贴右缘抽屉/居中弹窗都离
 * 触发按钮十万八千里，用户甚至以为功能不存在。这里全局记住最近一次
 * pointerdown 的坐标，面板打开时把自己摆到点击处旁边（视口内夹取）。
 */
import type { CSSProperties } from "react";

let lastPointer: { x: number; y: number } | null = null;

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (event) => {
      lastPointer = { x: event.clientX, y: event.clientY };
    },
    true
  );
}

export function getLastPointerAnchor(): { x: number; y: number } | null {
  return lastPointer;
}

/**
 * 生成面板定位样式：优先摆在点击点右下方一点，越界时往回夹。
 * anchor 为空（键盘触发/无记录）时回落到视口右上,与旧行为一致。
 */
export function anchoredPanelStyle(
  anchor: { x: number; y: number } | null,
  panelWidthPx: number,
  panelMaxHeightPx: number
): CSSProperties {
  if (typeof window === "undefined" || !anchor) {
    return { position: "absolute", right: 16, top: 16 };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(panelWidthPx, vw - 24);
  const maxHeight = Math.min(panelMaxHeightPx, vh - 24);
  const left = Math.max(12, Math.min(anchor.x + 12, vw - width - 12));
  const top = Math.max(12, Math.min(anchor.y - 24, vh - maxHeight - 12));
  return { position: "absolute", left, top, width, maxHeight };
}
