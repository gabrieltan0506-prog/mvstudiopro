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
  onError?: React.ReactEventHandler<HTMLImageElement>;
  onLoad?: React.ReactEventHandler<HTMLImageElement>;
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
  onError,
  onLoad,
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
        /** 外鏈生圖（GCS/R2 等）部分桶依 Referer 攔截嵌入；不帶 Referer 可避免封面/2×4 裂圖 */
        referrerPolicy="no-referrer"
        draggable={isTrial ? false : undefined}
        onContextMenu={preventAction}
        onDragStart={preventAction}
        onError={onError}
        onLoad={onLoad}
        style={{
          display: "block",
          width: "100%",
          height: objectFit === "contain" ? "auto" : "100%",
          objectFit,
          pointerEvents: isTrial ? "none" : undefined,
        }}
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
