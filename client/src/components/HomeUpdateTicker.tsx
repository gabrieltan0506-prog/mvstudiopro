import { Clock } from "lucide-react";
import { HOME_CHANGELOG_UPDATES, HOME_UPDATE_TAG_COLORS } from "./HomeChangelog";

/**
 * 首頁跑馬燈：文案僅維護 `HomeChangelog.tsx` 的 HOME_CHANGELOG_UPDATES，
 * 新增/改日期後會自動出現在此軌道（無需在 Hero 或輪播卡重複貼文）。
 */
export default function HomeUpdateTicker() {
  const tickerItems = [...HOME_CHANGELOG_UPDATES, ...HOME_CHANGELOG_UPDATES];

  return (
    <div
      style={{
        maxWidth: 1240,
        margin: "0 auto",
        padding: "0 20px 20px",
      }}
    >
      <div
        style={{
          border: "1px solid rgba(139,92,246,0.35)",
          borderRadius: 20,
          background: "rgba(139,92,246,0.04)",
          boxShadow: "0 0 40px rgba(139,92,246,0.08), inset 0 0 60px rgba(139,92,246,0.03)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px 20px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Clock size={18} color="#a78bfa" />
            <span style={{ fontSize: 16, fontWeight: 800, color: "#fff", letterSpacing: 0.5 }}>最新动态</span>
          </div>
          <span
            style={{
              fontSize: 12,
              color: "rgba(167,139,250,0.6)",
              background: "rgba(139,92,246,0.1)",
              border: "1px solid rgba(139,92,246,0.2)",
              borderRadius: 99,
              padding: "3px 12px",
            }}
          >
            滚动浏览更新
          </span>
        </div>

        <div
          style={{
            overflow: "hidden",
            background: "rgba(255,255,255,0.025)",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            padding: "12px 0",
          }}
        >
          <div className="mvsp-home-ticker-track" style={{ display: "flex", whiteSpace: "nowrap", gap: 0 }}>
            {tickerItems.map((item, i) => {
              const tc = HOME_UPDATE_TAG_COLORS[item.tag] ?? HOME_UPDATE_TAG_COLORS["新功能"];
              return (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "0 32px" }}>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", fontVariantNumeric: "tabular-nums" }}>2026/{item.date}</span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      background: tc.bg,
                      color: tc.text,
                      borderRadius: 4,
                      padding: "2px 7px",
                    }}
                  >
                    {item.tag}
                  </span>
                  <span style={{ fontSize: 15, color: "rgba(255,255,255,0.7)" }}>{item.text}</span>
                  <span style={{ color: "rgba(255,255,255,0.12)", fontSize: 20, marginLeft: 8 }}>·</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes mvsp-home-ticker {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .mvsp-home-ticker-track {
          animation: mvsp-home-ticker 40s linear infinite;
        }
        .mvsp-home-ticker-track:hover { animation-play-state: paused; }
      `}</style>
    </div>
  );
}
