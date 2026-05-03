import React, { useRef } from "react";
import { TrialReadWatermarkOverlay } from "@/components/TrialReadWatermarkOverlay";

interface TrialWatermarkImageProps {
  src: string;
  alt?: string;
  isTrial?: boolean;
  className?: string;
  /** 底圖 object-fit；預設 cover（小紅書 16:9 雙卡建議 contain） */
  objectFit?: "contain" | "cover";
  style?: React.CSSProperties;
}

/**
 * 试用包图片：复用首页「试读样本」对角水印（MVSTUDIOPRO.COM · 试读）+ 品牌 Logo 平铺；
 * 右键禁止另存、禁止拖拽。
 */
export default function TrialWatermarkImage({
  src,
  alt = "",
  isTrial = false,
  className = "",
  objectFit = "cover",
  style,
}: TrialWatermarkImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const preventAction = (e: React.MouseEvent | React.DragEvent) => {
    if (isTrial) e.preventDefault();
  };

  return (
    <div
      ref={containerRef}
      className="relative overflow-hidden select-none"
      style={style}
      onContextMenu={preventAction}
    >
      <img
        src={src}
        alt={alt}
        className={className}
        draggable={isTrial ? false : undefined}
        onContextMenu={preventAction}
        onDragStart={preventAction}
        style={{ display: "block", width: "100%", height: "100%", objectFit: objectFit, pointerEvents: isTrial ? "none" : undefined }}
      />

      {isTrial && (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 10,
              cursor: "default",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
            onContextMenu={(e) => e.preventDefault()}
            onDragStart={(e) => e.preventDefault()}
          />

          <TrialReadWatermarkOverlay zIndex={11} showCornerBadge />
        </>
      )}
    </div>
  );
}
