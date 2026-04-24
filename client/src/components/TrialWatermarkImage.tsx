import React, { useRef } from "react";

interface TrialWatermarkImageProps {
  src: string;
  alt?: string;
  isTrial?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 試用包圖片：
 * - 疊加對角線水印文字
 * - 右鍵禁止另存
 * - CSS 拖曳禁止
 */
export default function TrialWatermarkImage({
  src,
  alt = "",
  isTrial = false,
  className = "",
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
        style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", pointerEvents: isTrial ? "none" : undefined }}
      />

      {isTrial && (
        <>
          {/* 全畫面透明遮罩阻止右鍵/拖曳 */}
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

          {/* 對角線水印 */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 11,
              pointerEvents: "none",
              overflow: "hidden",
            }}
          >
            {/* 用 SVG 平鋪對角水印 */}
            <svg
              width="100%"
              height="100%"
              xmlns="http://www.w3.org/2000/svg"
              style={{ position: "absolute", inset: 0 }}
            >
              <defs>
                <pattern
                  id="wm"
                  patternUnits="userSpaceOnUse"
                  width="220"
                  height="120"
                  patternTransform="rotate(-35)"
                >
                  <text
                    x="10"
                    y="60"
                    fontSize="14"
                    fontWeight="700"
                    fontFamily="system-ui, sans-serif"
                    fill="rgba(255,255,255,0.22)"
                    letterSpacing="1"
                  >
                    試用版 · mvstudiopro
                  </text>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#wm)" />
            </svg>

            {/* 中央大水印 */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%,-50%) rotate(-35deg)",
                whiteSpace: "nowrap",
                fontSize: "clamp(14px, 3.5vw, 22px)",
                fontWeight: 900,
                color: "rgba(255,255,255,0.18)",
                letterSpacing: "2px",
                textShadow: "0 1px 2px rgba(0,0,0,0.4)",
                pointerEvents: "none",
                userSelect: "none",
              }}
            >
              試用版 · 僅供預覽
            </div>
          </div>
        </>
      )}
    </div>
  );
}
