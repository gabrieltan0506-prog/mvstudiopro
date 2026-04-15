import React from "react";

export type VisualReportData = {
  reportTitle: string;
  dateRange: string;
  theme: "dark" | "light";
  insightSummary: string[];
  trackGrowth?: Array<{ name: string; growth: string; isHot?: boolean }>;
  audiencesAndBiz?: Array<{ audience: string; bizDirection: string }>;
  topicExamples?: Array<{ structure: string; concept: string; realCase: string }>;
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

const C = ["#3eedff","#bf5fff","#ff4fb8","#ffdd44","#44f0a0","#ff7050","#6699ff","#ff9944","#ff66cc","#aaffaa"];

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
    const bg      = isDark ? "#0d0820" : "#faf8ff";
    const cardBg  = isDark ? "#160d2e" : "#ffffff";
    const border  = isDark ? "#2a1a4e" : "#e2d8f4";
    const txt     = isDark ? "#eeeaf8" : "#1a0a2e";
    const muted   = isDark ? "#8a78b5" : "#7060a0";
    const trackBg = isDark ? "#1a0c36" : "#f0e8ff";
    const tagBg   = isDark ? "#1e0d40" : "#f0e8ff";
    const tagClr  = isDark ? "#bf5fff" : "#7030c8";
    const tagBdr  = isDark ? "#3a1a66" : "#c8a8e8";

    const wrap: React.CSSProperties = { background: bg, color: txt, fontFamily: '"PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif', padding: "28px 32px 60px", minWidth: "900px", maxWidth: "1200px" };
    const card = (extra?: React.CSSProperties): React.CSSProperties => ({ background: cardBg, border: `1px solid ${border}`, borderRadius: "12px", padding: "18px 20px", ...extra });
    const ct = (color: string): React.CSSProperties => ({ fontSize: "14px", fontWeight: 700, marginBottom: "13px", color: txt, display: "flex", alignItems: "center", gap: "8px" });
    const dot = (color: string): React.CSSProperties => ({ width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0, background: color });
    const sec: React.CSSProperties = { fontSize: "13px", fontWeight: 700, color: muted, letterSpacing: "1px", margin: "20px 0 10px", borderLeft: `3px solid ${C[1]}`, paddingLeft: "10px" };

    // progress bar row
    const barRow = (label: string, fillPct: number, color: string, valueTxt?: string, tagTxt?: string, tagColors?: { bg: string; color: string }) => (
      <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "8px", fontSize: "12px" }}>
        <span style={{ width: "76px", textAlign: "right", color: muted, fontSize: "11px", flexShrink: 0, lineHeight: "1.4", wordBreak: "break-word" }}>{label}</span>
        <div style={{ flex: 1, height: "10px", background: trackBg, borderRadius: "99px", overflow: "hidden" }}>
          <div style={{ height: "100%", borderRadius: "99px", background: color, width: `${fillPct}%` }} />
        </div>
        {valueTxt ? <span style={{ width: "44px", textAlign: "right", fontWeight: 700, fontSize: "12px", color, flexShrink: 0 }}>{valueTxt}</span> : null}
        {tagTxt && tagColors ? (
          <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "3px", background: tagColors.bg, color: tagColors.color, flexShrink: 0, whiteSpace: "nowrap" }}>{tagTxt}</span>
        ) : null}
      </div>
    );

    const STATUS_CYCLE = [
      { label: "高热", bg: "#3a0e2a", color: "#ff4fb8" },
      { label: "高热", bg: "#3a0e2a", color: "#ff4fb8" },
      { label: "偏强", bg: "#2a2a0e", color: "#ffdd44" },
      { label: "升温", bg: "#0e2a1a", color: "#44f0a0" },
      { label: "新爆", bg: "#1e0a40", color: "#bf5fff" },
      { label: "稳态", bg: "#1a1a2a", color: "#6699ff" },
    ];

    return (
      <div ref={ref} style={wrap}>

        {/* ── HEADER ── */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "16px", marginBottom: "6px", paddingBottom: "14px", borderBottom: `1px solid ${border}` }}>
          <h1 style={{ fontSize: "26px", fontWeight: 800, letterSpacing: "0.5px" }}>{data.reportTitle}</h1>
          <span style={{ fontSize: "12px", color: muted }}>数据区间 · {data.dateRange}</span>
          <span style={{ display: "inline-block", fontSize: "11px", background: tagBg, color: C[0], border: `1px solid ${tagBdr}`, borderRadius: "4px", padding: "2px 8px", marginLeft: "6px" }}>实时数据版</span>
        </div>

        {/* TAG ROW */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "22px" }}>
          {["运营看板","赛道判断","流量扶持","现金奖励","热门赛道","算法推荐信号"].map((t) => (
            <span key={t} style={{ fontSize: "11px", background: tagBg, color: tagClr, border: `1px solid ${tagBdr}`, borderRadius: "4px", padding: "3px 10px" }}>{t}</span>
          ))}
        </div>

        {/* ── 顶部四宫格 (g4) ── */}
        {data.insightSummary.length > 0 && (
          <>
            <div style={sec}>核心洞察</div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(data.insightSummary.length, 4)}, 1fr)`, gap: "14px", marginBottom: "16px" }}>
              {data.insightSummary.slice(0, 4).map((insight, i) => (
                <div key={i} style={card()}>
                  <div style={ct(C[i % C.length])}><div style={dot(C[i % C.length])} />{["判断","热点","结构","建议"][i] || "洞察"}{i + 1}</div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: C[i % C.length], lineHeight: "1.5", marginBottom: "6px" }}>
                    {safeTxt(insight).slice(0, 30)}
                  </div>
                  <div style={{ fontSize: "11px", color: muted, lineHeight: "1.6" }}>
                    {safeTxt(insight)}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── trackGrowth + audiencesAndBiz (g2) ── */}
        {((data.trackGrowth?.length || 0) > 0 || (data.audiencesAndBiz?.length || 0) > 0) && (
          <>
            <div style={sec}>赛道增长 + 目标人群与商业方向</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "16px" }}>

              {/* Track growth */}
              {(data.trackGrowth?.length || 0) > 0 && (
                <div style={card()}>
                  <div style={ct(C[4])}><div style={dot(C[4])} />赛道爆款增长率排行</div>
                  {(data.trackGrowth || []).map((t, i) => {
                    const pct = Math.max(10, 100 - i * 12);
                    const color = C[i % C.length];
                    const gStr = safeTxt(t.growth || "");
                    const isNeg = gStr.startsWith("-");
                    return barRow(
                      safeTxt(t.name || t),
                      isNeg ? 10 : pct,
                      isNeg ? muted : color,
                      gStr || `${pct}%`,
                      t.isHot ? "热" : undefined,
                      t.isHot ? { bg: "#3a0e2a", color: "#ff4fb8" } : undefined
                    );
                  })}
                </div>
              )}

              {/* Audiences & Biz */}
              {(data.audiencesAndBiz?.length || 0) > 0 && (
                <div style={card()}>
                  <div style={ct(C[2])}><div style={dot(C[2])} />目标人群与商业方向</div>
                  {(data.audiencesAndBiz || []).map((ab, i) => (
                    <div key={i} style={{ marginBottom: "14px" }}>
                      <div style={{ fontSize: "12px", color: muted, lineHeight: "1.6", marginBottom: "4px" }}>
                        <span style={{ color: txt, fontWeight: 700 }}>目标人群 {i+1}</span><br />
                        {safeTxt(ab.audience)}
                      </div>
                      {i < (data.audiencesAndBiz?.length || 0) - 1 && <div style={{ height: "1px", background: border, margin: "8px 0" }} />}
                      <div style={{ fontSize: "12px", color: C[4], lineHeight: "1.6" }}>
                        <span style={{ color: txt, fontWeight: 700 }}>商业方向 {i+1}</span><br />
                        {safeTxt(ab.bizDirection)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Topic Examples + Platform Details (g2) ── */}
        <div style={sec}>选题结构实例 + 平台详细数据</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "16px" }}>

          {/* Topic Examples */}
          {(data.topicExamples?.length || 0) > 0 && (
            <div style={card()}>
              <div style={ct(C[1])}><div style={dot(C[1])} />近期选题结构 · 实例分析</div>
              {(data.topicExamples || []).map((ex, i) => {
                const color = C[i % C.length];
                const barW = Math.max(96 - i * 14, 30);
                return (
                  <div key={i} style={{ marginBottom: "13px" }}>
                    <div style={{ fontSize: "13px", fontWeight: 700, color, marginBottom: "5px" }}>{safeTxt(ex.structure)}</div>
                    <div style={{ height: "5px", background: trackBg, borderRadius: "99px", overflow: "hidden", marginBottom: "4px" }}>
                      <div style={{ height: "100%", borderRadius: "99px", background: color, width: `${barW}%` }} />
                    </div>
                    <div style={{ fontSize: "11px", color: muted, lineHeight: "1.6" }}>
                      {safeTxt(ex.concept)}
                    </div>
                    {ex.realCase && (
                      <div style={{ fontSize: "11px", color: txt, lineHeight: "1.6", marginTop: "3px", fontStyle: "italic" }}>
                        「{safeTxt(ex.realCase)}」
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* First platform detail */}
          {data.platformDetails[0] && (() => {
            const pl = data.platformDetails[0];
            const icon = PLATFORM_ICONS[pl.platform] || "📱";
            const accent = C[0];
            return (
              <div style={card({ borderTop: `3px solid ${accent}` })}>
                <div style={ct(accent)}>
                  <span style={{ fontSize: "18px" }}>{icon}</span>
                  <span style={{ fontSize: "16px", fontWeight: 800 }}>{pl.displayName}</span>
                  <span style={{ marginLeft: "auto", fontSize: "11px", background: `${accent}22`, color: accent, border: `1px solid ${accent}55`, borderRadius: "20px", padding: "2px 10px" }}>赛道分析</span>
                </div>
                {pl.trafficBoosters.length > 0 && (
                  <>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#ff9944", marginBottom: "8px" }}>🚀 流量扶持活动</div>
                    {pl.trafficBoosters.map((b, bi) => (
                      <div key={bi} style={{ display: "flex", gap: "9px", alignItems: "flex-start", marginBottom: "8px", fontSize: "12px" }}>
                        <span style={{ color: "#ff9944", fontWeight: 700, minWidth: "18px", flexShrink: 0 }}>{bi + 1}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ height: "6px", background: trackBg, borderRadius: "99px", overflow: "hidden", marginBottom: "3px" }}>
                            <div style={{ height: "100%", borderRadius: "99px", background: "linear-gradient(90deg,#ff9944,#ffdd44)", width: `${Math.max(100 - bi * 18, 30)}%` }} />
                          </div>
                          <div style={{ fontSize: "11px", color: isDark ? "#d0c8f0" : "#2a1040", lineHeight: "1.5", wordBreak: "break-word", whiteSpace: "normal" }}>{safeTxt(b)}</div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {pl.hotTopics.length > 0 && (
                  <>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: "#ffdd44", marginTop: "10px", marginBottom: "8px" }}>🔥 热门赛道</div>
                    {pl.hotTopics.map((tp, ti) => {
                      const st = STATUS_CYCLE[ti % STATUS_CYCLE.length];
                      const barW = Math.max(100 - ti * 8, 40);
                      const color = C[ti % C.length];
                      return (
                        <div key={ti} style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "10px" }}>
                          <div style={{ fontSize: "12px", color: isDark ? "#d0c8f0" : "#2a1040", lineHeight: "1.5", wordBreak: "break-word", whiteSpace: "normal" }}>{safeTxt(tp)}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <div style={{ flex: 1, height: "8px", background: trackBg, borderRadius: "99px", overflow: "hidden" }}>
                              <div style={{ height: "100%", borderRadius: "99px", background: color, width: `${barW}%` }} />
                            </div>
                            <span style={{ fontSize: "11px", fontWeight: 700, color, minWidth: "36px", textAlign: "right" }}>{barW}%</span>
                            <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "99px", background: st.bg, color: st.color, flexShrink: 0 }}>{st.label}</span>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            );
          })()}
        </div>

        {/* ── Remaining platform cards (g2 grid) ── */}
        {data.platformDetails.length > 1 && (
          <>
            <div style={sec}>各平台详细数据 · 流量扶持 / 现金奖励 / 热门赛道</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
              {data.platformDetails.slice(1).map((pl, pIdx) => {
                const icon = PLATFORM_ICONS[pl.platform] || "📱";
                const accent = C[(pIdx + 1) % C.length];
                return (
                  <div key={pl.platform} style={card({ borderTop: `3px solid ${accent}` })}>
                    <div style={ct(accent)}>
                      <span style={{ fontSize: "18px" }}>{icon}</span>
                      <span style={{ fontSize: "16px", fontWeight: 800 }}>{pl.displayName}</span>
                      <span style={{ marginLeft: "auto", fontSize: "11px", background: `${accent}22`, color: accent, border: `1px solid ${accent}55`, borderRadius: "20px", padding: "2px 10px" }}>赛道分析</span>
                    </div>
                    {pl.trafficBoosters.length > 0 && (
                      <>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#ff9944", marginBottom: "8px" }}>🚀 流量扶持活动</div>
                        {pl.trafficBoosters.map((b, bi) => (
                          <div key={bi} style={{ display: "flex", gap: "9px", alignItems: "flex-start", marginBottom: "8px", fontSize: "12px" }}>
                            <span style={{ color: "#ff9944", fontWeight: 700, minWidth: "18px", flexShrink: 0 }}>{bi + 1}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ height: "6px", background: trackBg, borderRadius: "99px", overflow: "hidden", marginBottom: "3px" }}>
                                <div style={{ height: "100%", borderRadius: "99px", background: "linear-gradient(90deg,#ff9944,#ffdd44)", width: `${Math.max(100 - bi * 18, 30)}%` }} />
                              </div>
                              <div style={{ fontSize: "11px", color: isDark ? "#d0c8f0" : "#2a1040", lineHeight: "1.5", wordBreak: "break-word", whiteSpace: "normal" }}>{safeTxt(b)}</div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                    {pl.cashRewards.length > 0 && (
                      <>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#44f0a0", marginTop: "10px", marginBottom: "8px" }}>💰 现金奖励任务</div>
                        {pl.cashRewards.map((rw, ri) => (
                          <div key={ri} style={{ display: "flex", gap: "9px", alignItems: "flex-start", marginBottom: "8px", fontSize: "12px" }}>
                            <span style={{ color: "#44f0a0", fontWeight: 700, minWidth: "18px", flexShrink: 0 }}>💎</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ height: "6px", background: trackBg, borderRadius: "99px", overflow: "hidden", marginBottom: "3px" }}>
                                <div style={{ height: "100%", borderRadius: "99px", background: "linear-gradient(90deg,#44f0a0,#3eedff)", width: `${Math.max(100 - ri * 22, 30)}%` }} />
                              </div>
                              <div style={{ fontSize: "11px", color: isDark ? "#d0c8f0" : "#2a1040", lineHeight: "1.5", wordBreak: "break-word", whiteSpace: "normal" }}>{safeTxt(rw)}</div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                    {pl.hotTopics.length > 0 && (
                      <>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: "#ffdd44", marginTop: "10px", marginBottom: "8px" }}>🔥 热门赛道</div>
                        {pl.hotTopics.map((tp, ti) => {
                          const st = STATUS_CYCLE[ti % STATUS_CYCLE.length];
                          const barW = Math.max(100 - ti * 8, 40);
                          const color = C[ti % C.length];
                          return (
                            <div key={ti} style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "10px" }}>
                              <div style={{ fontSize: "12px", color: isDark ? "#d0c8f0" : "#2a1040", lineHeight: "1.5", wordBreak: "break-word", whiteSpace: "normal" }}>{safeTxt(tp)}</div>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <div style={{ flex: 1, height: "8px", background: trackBg, borderRadius: "99px", overflow: "hidden" }}>
                                  <div style={{ height: "100%", borderRadius: "99px", background: color, width: `${barW}%` }} />
                                </div>
                                <span style={{ fontSize: "11px", fontWeight: 700, color, minWidth: "36px", textAlign: "right" }}>{barW}%</span>
                                <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "99px", background: st.bg, color: st.color, flexShrink: 0 }}>{st.label}</span>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── FOOTER ── */}
        <div style={{ marginTop: "24px", paddingTop: "14px", borderTop: `1px solid ${border}`, fontSize: "11px", color: muted, textAlign: "center" }}>
          由 mvstudiopro Platform Intelligence 生成 · 数据基于近期平台真实趋势 · {data.dateRange}
        </div>
      </div>
    );
  }
);
