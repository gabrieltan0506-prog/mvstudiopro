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
  innerRef?: React.Ref<HTMLDivElement>;
};

const PLATFORM_ICONS: Record<string, string> = {
  douyin: "🎵",
  xiaohongshu: "📖",
  kuaishou: "⚡",
  toutiao: "📰",
  bilibili: "📺",
  weixin_channels: "💬",
};

const PLATFORM_NAMES: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  kuaishou: "快手",
  toutiao: "今日头条",
  bilibili: "B站",
  weixin_channels: "微信视频号",
};

const PLATFORM_COLORS: Record<string, string> = {
  douyin: "#3eedff",
  xiaohongshu: "#ff4fb8",
  kuaishou: "#ff9944",
  toutiao: "#ff4444",
  bilibili: "#6699ff",
  weixin_channels: "#44f0a0",
};

export const VisualReportTemplate = React.forwardRef<HTMLDivElement, Props>(
  function VisualReportTemplate({ data }, ref) {
    const isDark = data.theme === "dark";

    const containerStyle: React.CSSProperties = isDark
      ? {
          background: "linear-gradient(135deg, #080618 0%, #10082a 50%, #080618 100%)",
          color: "#f0eaff",
          fontFamily: '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif',
          padding: "32px 36px 48px",
          minWidth: "900px",
          maxWidth: "1200px",
        }
      : {
          background: "linear-gradient(135deg, #fff5f0 0%, #fdf0ff 50%, #f0f8ff 100%)",
          color: "#1a0a2e",
          fontFamily: '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif',
          padding: "32px 36px 48px",
          minWidth: "900px",
          maxWidth: "1200px",
        };

    const cardStyle: React.CSSProperties = isDark
      ? { background: "#10082a", border: "1px solid #2a1a52", borderRadius: "14px", padding: "18px 20px" }
      : { background: "#ffffff", border: "1px solid #e8d8f8", borderRadius: "14px", padding: "18px 20px", boxShadow: "0 2px 12px rgba(160,80,220,0.08)" };

    const mutedColor = isDark ? "#8a78b5" : "#8060a0";
    const tagBg = isDark ? "#1e0d40" : "#f0e8ff";
    const tagBorder = isDark ? "#3a2a66" : "#c8a8e8";
    const tagColor = isDark ? "#c060ff" : "#7030c8";

    return (
      <div ref={ref} style={containerStyle}>
        {/* HEADER */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "6px", paddingBottom: "16px", borderBottom: `1px solid ${isDark ? "#2a1a52" : "#e8d8f8"}` }}>
          <span style={{ fontSize: "32px" }}>📊</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "22px", fontWeight: 900, letterSpacing: "0.3px", background: "linear-gradient(135deg,#3eedff,#c060ff,#ff4fb8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              {data.reportTitle}
            </div>
            <div style={{ fontSize: "12px", color: mutedColor, marginTop: "3px" }}>平台流量扶持 · 现金奖励 · 热门赛道</div>
          </div>
          <div style={{ fontSize: "12px", color: mutedColor, background: isDark ? "#160c38" : "#f0e8ff", border: `1px solid ${isDark ? "#3a1a66" : "#d0b8e8"}`, borderRadius: "20px", padding: "4px 12px" }}>
            {data.dateRange}
          </div>
        </div>

        {/* TAG ROW */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", margin: "14px 0 20px" }}>
          {["流量扶持活动", "创作者现金奖励", "热门内容赛道", "算法推荐信号"].map((tag) => (
            <span key={tag} style={{ fontSize: "11px", background: tagBg, color: tagColor, border: `1px solid ${tagBorder}`, borderRadius: "20px", padding: "3px 12px" }}>{tag}</span>
          ))}
        </div>

        {/* INSIGHT SUMMARY */}
        {data.insightSummary.length > 0 && (
          <div style={{ ...cardStyle, marginBottom: "20px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: isDark ? "#3eedff" : "#5020b0", marginBottom: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>🎯</span> 核心洞察
            </div>
            {data.insightSummary.map((insight, idx) => (
              <div key={idx} style={{ display: "flex", gap: "8px", marginBottom: "8px", fontSize: "13px", color: isDark ? "#d0c8f0" : "#2a1040" }}>
                <span style={{ color: isDark ? "#3eedff" : "#6030d8", fontWeight: 700, minWidth: "18px" }}>{idx + 1}</span>
                <span style={{ lineHeight: "1.6" }}>{insight}</span>
              </div>
            ))}
          </div>
        )}

        {/* PLATFORM CARDS GRID */}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(data.platformDetails.length, 2)}, 1fr)`, gap: "14px" }}>
          {data.platformDetails.map((platform) => {
            const icon = PLATFORM_ICONS[platform.platform] || "📱";
            const name = PLATFORM_NAMES[platform.platform] || platform.displayName;
            const accentColor = PLATFORM_COLORS[platform.platform] || "#3eedff";
            return (
              <div key={platform.platform} style={{ ...cardStyle, borderTop: `3px solid ${accentColor}` }}>
                {/* Platform header */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                  <span style={{ fontSize: "22px" }}>{icon}</span>
                  <div style={{ fontSize: "16px", fontWeight: 800, color: isDark ? "#f0eaff" : "#1a0a2e" }}>{name}</div>
                  <span style={{ marginLeft: "auto", fontSize: "11px", background: isDark ? `${accentColor}22` : `${accentColor}18`, color: accentColor, border: `1px solid ${accentColor}55`, borderRadius: "20px", padding: "2px 10px" }}>
                    赛道分析
                  </span>
                </div>

                {/* Traffic Boosters */}
                {platform.trafficBoosters.length > 0 && (
                  <div style={{ marginBottom: "14px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#ff9944", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                      🚀 流量扶持活动
                    </div>
                    {platform.trafficBoosters.map((booster, bi) => (
                      <div key={bi} style={{ display: "flex", gap: "8px", marginBottom: "6px", fontSize: "12px", color: isDark ? "#d0c8f0" : "#2a1040", lineHeight: "1.6" }}>
                        <span style={{ color: "#ff9944", fontWeight: 700, minWidth: "18px" }}>{bi + 1}</span>
                        {booster}
                      </div>
                    ))}
                  </div>
                )}

                {/* Cash Rewards */}
                {platform.cashRewards.length > 0 && (
                  <div style={{ marginBottom: "14px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#44f0a0", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                      💰 现金奖励任务
                    </div>
                    {platform.cashRewards.map((reward, ri) => (
                      <div key={ri} style={{ display: "flex", gap: "8px", marginBottom: "6px", fontSize: "12px", color: isDark ? "#d0c8f0" : "#2a1040", lineHeight: "1.6" }}>
                        <span style={{ color: "#44f0a0", fontWeight: 700, minWidth: "18px" }}>💎</span>
                        {reward}
                      </div>
                    ))}
                  </div>
                )}

                {/* Hot Topics */}
                {platform.hotTopics.length > 0 && (
                  <div>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#ffdd44", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                      🔥 当下热门赛道
                    </div>
                    <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                      {platform.hotTopics.map((topic, ti) => (
                        <span key={ti} style={{ fontSize: "11px", background: isDark ? "#1e0d40" : "#fff5e0", color: "#ffdd44", border: "1px solid rgba(255,221,68,0.3)", borderRadius: "20px", padding: "2px 10px" }}>
                          {topic}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* FOOTER */}
        <div style={{ marginTop: "24px", paddingTop: "14px", borderTop: `1px solid ${isDark ? "#2a1a52" : "#e8d8f8"}`, fontSize: "11px", color: mutedColor, textAlign: "center" }}>
          由 mvstudiopro Platform Intelligence 生成 · 数据基于近期平台真实趋势
        </div>
      </div>
    );
  }
);
