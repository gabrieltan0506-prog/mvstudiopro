import { TRIAL_READ_WATERMARK_LINE } from "@shared/const";

function svgToDataUri(svg: string): string {
  const compact = svg.replace(/\s+/g, " ").replace(/>\s+</g, "><").trim();
  const utf8 = unescape(encodeURIComponent(compact));
  return `data:image/svg+xml;base64,${typeof btoa !== "undefined" ? btoa(utf8) : ""}`;
}

const BRAND_LOGO_DARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="50" viewBox="0 0 260 50">
  <defs>
    <linearGradient id="hexgWM" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#d8a23a"/>
      <stop offset="100%" stop-color="#7a5410"/>
    </linearGradient>
  </defs>
  <g transform="translate(2, 2)">
    <path d="M22 2 L40 12 V32 L22 42 L4 32 V12 Z" fill="url(#hexgWM)" stroke="#f0c984" stroke-width="1.4"/>
    <ellipse cx="22" cy="22" rx="7.5" ry="11" fill="#fff7df" opacity="0.95"/>
    <path d="M22 12 V32" stroke="#3e2a1c" stroke-width="1.5" stroke-linecap="round"/>
  </g>
  <text x="52" y="24" font-family="'Playfair Display', 'Times New Roman', serif" font-size="18" font-weight="700" fill="#fff7df" letter-spacing="0.3">MVStudio<tspan font-weight="900" fill="#f0c984">Pro</tspan></text>
  <text x="52" y="40" font-family="'Helvetica Neue', sans-serif" font-size="8" font-weight="700" fill="rgba(255,247,223,0.78)" letter-spacing="2.4">STRATEGIC INTELLIGENCE · MVSTUDIOPRO.COM</text>
</svg>`;

const BRAND_LOGO_DARK_URI = svgToDataUri(BRAND_LOGO_DARK_SVG);

export type TrialReadWatermarkOverlayProps = {
  zIndex?: number;
  /** 与首页试读卡片一致：右上角 MVSTUDIOPRO.COM 深底角标 */
  showCornerBadge?: boolean;
};

/**
 * 首页「试读样本」卡片同款：对角平铺 MVSTUDIOPRO.COM · 试读 + 错落品牌 Logo。
 * 供 SampleReportDownload 封面、TrialWatermarkImage（试用账户叠图）复用。
 */
export function TrialReadWatermarkOverlay({
  zIndex = 3,
  showCornerBadge = true,
}: TrialReadWatermarkOverlayProps) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex,
      }}
    >
      {Array.from({ length: 4 }).map((_, row) =>
        Array.from({ length: 3 }).map((_, col) => {
          const offsetX = row % 2 === 0 ? 0 : 50;
          const left = `${col * 38 - 8 + (offsetX / 100) * 38}%`;
          const top = `${row * 28 + 8}%`;
          return (
            <div
              key={`trial-wm-txt-${row}-${col}`}
              style={{
                position: "absolute",
                left,
                top,
                transform: "rotate(-26deg)",
                fontFamily: "'Playfair Display', Georgia, 'PingFang SC', serif",
                fontSize: "clamp(10px, 2.6vw, 14px)",
                fontWeight: 800,
                color: "rgba(255,247,223,0.55)",
                letterSpacing: "0.18em",
                whiteSpace: "nowrap",
                textShadow: "0 1px 3px rgba(0,0,0,0.45)",
                userSelect: "none",
              }}
            >
              {TRIAL_READ_WATERMARK_LINE}
            </div>
          );
        }),
      )}
      {Array.from({ length: 2 }).map((_, row) =>
        Array.from({ length: 2 }).map((_, col) => (
          <img
            key={`trial-wm-logo-${row}-${col}`}
            src={BRAND_LOGO_DARK_URI}
            alt=""
            style={{
              position: "absolute",
              left: `${col * 50 + 18}%`,
              top: `${row * 45 + 22}%`,
              width: "30%",
              height: "auto",
              opacity: 0.22,
              transform: "rotate(-22deg)",
              filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.35))",
              pointerEvents: "none",
              userSelect: "none",
            }}
            draggable={false}
          />
        )),
      )}
      {showCornerBadge ? (
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            zIndex: 2,
            padding: "4px 10px",
            borderRadius: 4,
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(4px)",
            color: "rgba(255,247,223,0.92)",
            fontSize: "clamp(7px, 1.8vw, 9px)",
            fontWeight: 800,
            letterSpacing: "0.12em",
            fontFamily: "'Helvetica Neue', sans-serif",
          }}
        >
          MVSTUDIOPRO.COM
        </div>
      ) : null}
    </div>
  );
}
