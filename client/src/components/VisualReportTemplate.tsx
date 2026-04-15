import React from "react";

export type VisualReportData = {
  reportTitle: string;
  dateRange: string;
  theme: "dark" | "light";
  insightSummary: string[];
  platformDetails: Array<{
    platform: string;
    displayName: string;
    trafficBoosters: string[];
    cashRewards: string[];
    hotTopics: string[];
  }>;
};

type Props = {
  data: VisualReportData;
};

const PLATFORM_ICONS: Record<string, string> = {
  douyin: "🎵",
  xiaohongshu: "📖",
  kuaishou: "⚡",
  toutiao: "📰",
  bilibili: "📺",
  weixin_channels: "💬",
};

// Accent color palette matching HTML --c1..--c10
const ACCENT_COLORS = ["#3eedff", "#bf5fff", "#ff4fb8", "#ffdd44", "#44f0a0", "#ff7050", "#6699ff", "#ff9944", "#ff66cc", "#aaffaa"];

// Safe text extractor
function safeTxt(item: any): string {
  if (!item) return "";
  if (typeof item === "string") return item;
  if (typeof item === "object") {
    return String(item.text || item.title || item.content || item.name || item.desc || Object.values(item)[0] || "");
  }
  return String(item);
}

export const VisualReportTemplate = React.forwardRef<HTMLDivElement, Props>(
  function VisualReportTemplate({ data }, ref) {
    const isDark = data.theme === "dark";

    // ── CSS variables mapped to Tailwind inline styles ──
    const bg = isDark ? "#0d0820" : "#faf8ff";
    const cardBg = isDark ? "#160d2e" : "#ffffff";
    const cardBorder = isDark ? "#2a1a4e" : "#e2d8f4";
    const textMain = isDark ? "#eeeaf8" : "#1a0a2e";
    const textMuted = isDark ? "#8a78b5" : "#7060a0";
    const trackBg = isDark ? "#1a0c36" : "#f0e8ff";
    const borderAccent = isDark ? "#3a1a66" : "#c8a8e8";
    const tagBg = isDark ? "#1e0d40" : "#f0e8ff";
    const tagColor = isDark ? "#bf5fff" : "#7030c8";
    const sectionBorder = "#bf5fff";

    const container: React.CSSProperties = {
      background: bg,
      color: textMain,
      fontFamily: '"PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif',
      padding: "28px 32px 60px",
      minWidth: "900px",
      maxWidth: "1200px",
    };

    const cardStyle: React.CSSProperties = {
      background: cardBg,
      border: `1px solid ${cardBorder}`,
      borderRadius: "12px",
      padding: "18px 20px",
    };

    return (
      <div ref={ref} style={container}>
        {/* ── PAGE HEADER ── */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "16px", marginBottom: "6px", paddingBottom: "14px", borderBottom: `1px solid ${cardBorder}` }}>
          <h1 style={{ fontSize: "26px", fontWeight: 800, letterSpacing: "0.5px" }}>{data.reportTitle}</h1>
          <span style={{ fontSize: "12px", color: textMuted }}>数据区间 · {data.dateRange}</span>
          <span style={{ display: "inline-block", fontSize: "11px", background: tagBg, color: ACCENT_COLORS[0], border: `1px solid ${borderAccent}`, borderRadius: "4px", padding: "2px 8px", marginLeft: "6px" }}>实时数据版</span>
        </div>

        {/* ── TAG ROW ── */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "22px" }}>
          {["运营看板", "赛道判断", "流量扶持", "现金奖励", "热门赛道", "算法推荐信号"].map((tag) => (
            <span key={tag} style={{ fontSize: "11px", background: tagBg, color: tagColor, border: `1px solid ${borderAccent}`, borderRadius: "4px", padding: "3px 10px" }}>
              {tag}
            </span>
          ))}
        </div>

        {/* ── INSIGHT SUMMARY ── */}
        {data.insightSummary.length > 0 && (
          <>
            <div style={{ fontSize: "13px", fontWeight: 700, color: textMuted, letterSpacing: "1px", margin: "0 0 10px", borderLeft: `3px solid ${sectionBorder}`, paddingLeft: "10px" }}>
              核心洞察摘要
            </div>
            <div style={{ ...cardStyle, marginBottom: "20px" }}>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(data.insightSummary.length, 2)}, 1fr)`, gap: "12px" }}>
                {data.insightSummary.map((insight, idx) => (
                  <div key={idx} style={{ display: "flex", gap: "8px", fontSize: "12px", color: isDark ? "#d0c8f0" : "#2a1040", lineHeight: "1.6" }}>
                    <span style={{ color: ACCENT_COLORS[0], fontWeight: 700, minWidth: "18px" }}>{idx + 1}</span>
                    <span>{safeTxt(insight)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── PLATFORM CARDS ── */}
        <div style={{ fontSize: "13px", fontWeight: 700, color: textMuted, letterSpacing: "1px", margin: "0 0 10px", borderLeft: `3px solid ${sectionBorder}`, paddingLeft: "10px" }}>
          各平台详细数据 · 流量扶持 / 现金奖励 / 热门赛道
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(data.platformDetails.length, 2)}, 1fr)`, gap: "14px" }}>
          {data.platformDetails.map((platform, pIdx) => {
            const icon = PLATFORM_ICONS[platform.platform] || "📱";
            const accentColor = ACCENT_COLORS[pIdx % ACCENT_COLORS.length];
            const accentColor2 = ACCENT_COLORS[(pIdx + 1) % ACCENT_COLORS.length];
            return (
              <div key={platform.platform} style={{ ...cardStyle, borderTop: `3px solid ${accentColor}` }}>
                {/* Platform header */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                  <span style={{ fontSize: "22px" }}>{icon}</span>
                  <div style={{ fontSize: "16px", fontWeight: 800, color: textMain }}>{platform.displayName}</div>
                  <span style={{ marginLeft: "auto", fontSize: "11px", background: isDark ? `${accentColor}22` : `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}55`, borderRadius: "20px", padding: "2px 10px" }}>
                    赛道分析
                  </span>
                </div>

                {/* ── Traffic Boosters ── */}
                {platform.trafficBoosters.length > 0 && (
                  <div style={{ marginBottom: "16px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#ff9944", marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
                      🚀 流量扶持活动
                    </div>
                    {platform.trafficBoosters.map((booster, bi) => {
                      const txt = safeTxt(booster);
                      const barW = Math.max(100 - bi * 18, 25);
                      return (
                        <div key={bi} style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "9px", fontSize: "12px" }}>
                          <span style={{ width: "20px", color: "#ff9944", fontWeight: 700, flexShrink: 0 }}>{bi + 1}</span>
                          <div style={{ flex: 1, height: "8px", background: trackBg, borderRadius: "99px", overflow: "hidden" }}>
                            <div style={{ height: "100%", borderRadius: "99px", background: `linear-gradient(90deg, #ff9944, #ffdd44)`, width: `${barW}%` }} />
                          </div>
                          <span style={{ fontSize: "11px", color: isDark ? "#d0c8f0" : "#2a1040", flex: 2, lineHeight: "1.5" }}>{txt}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ── Cash Rewards ── */}
                {platform.cashRewards.length > 0 && (
                  <div style={{ marginBottom: "16px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#44f0a0", marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
                      💰 现金奖励任务
                    </div>
                    {platform.cashRewards.map((reward, ri) => {
                      const txt = safeTxt(reward);
                      const barW = Math.max(100 - ri * 22, 30);
                      return (
                        <div key={ri} style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "9px", fontSize: "12px" }}>
                          <span style={{ width: "20px", color: "#44f0a0", fontWeight: 700, flexShrink: 0 }}>💎</span>
                          <div style={{ flex: 1, height: "8px", background: trackBg, borderRadius: "99px", overflow: "hidden" }}>
                            <div style={{ height: "100%", borderRadius: "99px", background: `linear-gradient(90deg, #44f0a0, #3eedff)`, width: `${barW}%` }} />
                          </div>
                          <span style={{ fontSize: "11px", color: isDark ? "#d0c8f0" : "#2a1040", flex: 2, lineHeight: "1.5" }}>{txt}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ── Hot Topics track bar ── */}
                {platform.hotTopics.length > 0 && (
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#ffdd44", marginBottom: "10px", display: "flex", alignItems: "center", gap: "6px" }}>
                      🔥 当下热门赛道
                    </div>
                    {platform.hotTopics.map((topic, ti) => {
                      const txt = safeTxt(topic);
                      const barW = Math.max(100 - ti * 15, 20);
                      const color = ACCENT_COLORS[ti % ACCENT_COLORS.length];
                      // status tag cycling: 高热 → 高热 → 偏强 → 升温 → 新爆
                      const statusLabels = ["高热", "高热", "偏强", "升温", "新爆", "稳态"];
                      const statusColors: Record<string, { bg: string; color: string }> = {
                        高热: { bg: "#3a0e2a", color: "#ff4fb8" },
                        偏强: { bg: "#2a2a0e", color: "#ffdd44" },
                        升温: { bg: "#0e2a1a", color: "#44f0a0" },
                        新爆: { bg: "#1e0a40", color: "#bf5fff" },
                        稳态: { bg: "#1a1a2a", color: "#6699ff" },
                      };
                      const status = statusLabels[ti % statusLabels.length];
                      const st = statusColors[status];
                      return (
                        <div key={ti} style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "8px", fontSize: "12px" }}>
                          <span style={{ width: "76px", textAlign: "right", color: textMuted, fontSize: "11px", whiteSpace: "nowrap", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {txt}
                          </span>
                          <div style={{ flex: 1, height: "10px", background: isDark ? "#1a0c36" : "#f0e8ff", borderRadius: "99px", overflow: "hidden" }}>
                            <div style={{ height: "100%", borderRadius: "99px", background: color, width: `${barW}%` }} />
                          </div>
                          <span style={{ width: "44px", textAlign: "right", fontWeight: 700, fontSize: "12px", color }}>{barW}%</span>
                          <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "3px", background: st.bg, color: st.color, flexShrink: 0 }}>
                            {status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── FOOTER ── */}
        <div style={{ marginTop: "24px", paddingTop: "14px", borderTop: `1px solid ${cardBorder}`, fontSize: "11px", color: textMuted, textAlign: "center" }}>
          由 mvstudiopro Platform Intelligence 生成 · 数据基于近期平台真实趋势 · {data.dateRange}
        </div>
      </div>
    );
  }
);
