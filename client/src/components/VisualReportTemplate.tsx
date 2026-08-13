import React from "react";

export type VisualReportData = {
  reportTitle: string;
  dateRange: string;
  theme: "dark" | "light";
  // insightSummary: 判断/热点/结构/建议 四栏；兼容旧 string / {title, description}
  insightSummary: Array<string | { role?: string; title: string; description: string }>;
  trackGrowth?: Array<{ name: string; growth: string; isHot?: boolean }>;
  audiencesAndBiz?: Array<{ audience: string; bizDirection: string }>;
  topicExamples?: Array<{ structure: string; concept: string; realCase: string }>;
  excellentCoverReferences?: Array<{
    sourceId: string;
    platform: string;
    title: string;
    author?: string;
    sourceUrl?: string;
    coverUrl?: string;
    rank: number;
    highCtrReason?: string;
  }>;
  legacyCoverReferences?: Array<{
    sourceId: string;
    platform: string;
    title: string;
    author?: string;
    sourceUrl?: string;
  }>;
  // New global fields from upgraded prompt
  trafficSupport?: string[];
  hotFestivals?: string[];
  /**
   * 全局蓝海词（一/二级分级）：在核心洞察下方展示，每条平台 2-4 组。
   * 格式：[{ primary: "一级蓝海词", secondary: ["二级词1","二级词2",...] }]
   * 不区分平台，聚合各平台高价值词条。
   */
  globalBlueOceanWords?: Array<{ primary: string; secondary: string[] }>;
  /** 抖音 AI 漫剧合集飙升榜（由 mix_info.mixPlayCount 聚合，非 LLM 编造） */
  aiManhuaRising?: {
    windowDays: number;
    hasBaseline: boolean;
    note: string;
    entries: Array<{
      mixId: string;
      mixName: string;
      dramaKind: string;
      mixPlayCount: number;
      delta7d: number | null;
      status: string;
      author?: string;
      sampleTitle?: string;
      url?: string;
    }>;
  } | null;
  platformDetails: Array<{
    platform: string;
    displayName: string;
    trafficBoosters: string[];
    cashRewards: string[];
    hotTopics: string[];
    /** 蓝海词：一级词（父级大词）+ 二级词（子词，从评论区/下拉联想词挖掘） */
    blueOceanWords?: Array<{ primary: string; secondary: string[] }>;
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

/** 色块条：高饱和冷暖跳色；刻意避开咖啡/陶土底，避免与爱马仕橙页底撞色看不清 */
const C = ["#0ea5b7","#7c3aed","#db2777","#ca8a04","#059669","#2563eb","#c026d3","#ea580c","#0891b2","#4d7c0f"];
/** 页底爱马仕橙系（浅咖啡 → 浅红），偏哑光高级感，不做荧光橙 */
const HERMES_PAGE_BG =
  "linear-gradient(168deg, #EDE4D8 0%, #E8D0C0 38%, #E4B8A8 72%, #DC9E90 100%)";
const HERMES_ACCENT = "#B85C38";

function safeTxt(item: any): string {
  if (!item) return "";
  if (typeof item === "string") return item;
  if (typeof item === "object") {
    return String(item.text || item.title || item.content || item.name || item.desc || Object.values(item)[0] || "");
  }
  return String(item);
}

/** 正文分层：书名号/数字涨幅高亮划线，避免满屏同色灰字 */
function renderRichText(text: string, accent: string): React.ReactNode {
  const s = String(text || "");
  if (!s) return null;
  const chunks = s.split(/(「[^」]+」|『[^』]+』|\d+(?:\.\d+)?%|\+\d+(?:\.\d+)?%|增长\d+(?:\.\d+)?倍)/g);
  return chunks.map((chunk, i) => {
    if (!chunk) return null;
    if (/^[「『]/.test(chunk) && /[」』]$/.test(chunk)) {
      return (
        <span
          key={i}
          style={{
            color: accent,
            fontWeight: 700,
            borderBottom: `1.5px solid ${accent}`,
            paddingBottom: 1,
          }}
        >
          {chunk}
        </span>
      );
    }
    if (/^(\d+(?:\.\d+)?%|\+\d+(?:\.\d+)?%|增长\d+(?:\.\d+)?倍)$/.test(chunk)) {
      return (
        <span
          key={i}
          style={{
            color: accent,
            fontWeight: 800,
            background: `${accent}1f`,
            borderRadius: 3,
            padding: "0 3px",
          }}
        >
          {chunk}
        </span>
      );
    }
    return <span key={i}>{chunk}</span>;
  });
}

function isKeyBullet(text: string, index: number): boolean {
  if (index < 2) return true;
  return /建议|重点|机会|优先|蓝海|爆发|必做|高热/.test(String(text || ""));
}

/** 解析「+72%」「增长1.5倍」「高热」「-3%」等为整数（用于条宽）；「高热」按 101 视为满条 */
function parseGrowthPercentString(growth: string): number | null {
  const s = String(growth || "").trim();
  if (!s) return null;
  if (s === "高热") return 101;
  const times = s.replace(/\s/g, "").match(/^增长(\d+(?:\.\d+)?)倍$/);
  if (times) {
    const mult = Number(times[1]);
    if (Number.isFinite(mult)) return Math.round(mult * 100);
  }
  const compact = s.replace(/\s/g, "").replace(/%$/i, "");
  const m = compact.match(/^([+-]?)(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const n = sign * Number(m[2]);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export const VisualReportTemplate = React.forwardRef<HTMLDivElement, Props>(
  function VisualReportTemplate({ data }, ref) {
    const isDark = data.theme === "dark";
    // dark 主题在 /platform 趋势长图上改为爱马仕橙暖底（浅咖啡→浅红），正文深咖，条轨中性灰咖
    const bg      = isDark ? HERMES_PAGE_BG : "linear-gradient(168deg, #F7F1EA 0%, #F3E0D6 100%)";
    const cardBg  = isDark ? "rgba(255,249,242,0.94)" : "#ffffff";
    const border  = isDark ? "rgba(140,90,70,0.28)" : "rgba(180,140,120,0.35)";
    const txt     = isDark ? "#2A1810" : "#2A1810";
    const muted   = isDark ? "#6B4E3D" : "#7A5C4A";
    const trackBg = isDark ? "rgba(70,48,36,0.14)" : "rgba(70,48,36,0.10)";
    const tagBg   = isDark ? "rgba(184,92,56,0.12)" : "rgba(184,92,56,0.08)";
    const tagClr  = isDark ? HERMES_ACCENT : "#8B3A1F";
    const tagBdr  = isDark ? "rgba(184,92,56,0.38)" : "rgba(184,92,56,0.28)";
    const bodyTxt = isDark ? "#3D2A20" : "#3D2A20";

    const wrap: React.CSSProperties = { background: bg, color: txt, fontFamily: '"PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif', padding: "28px 32px 60px", minWidth: "900px", maxWidth: "1200px" };
    const card = (extra?: React.CSSProperties): React.CSSProperties => ({
      background: cardBg,
      border: `1px solid ${border}`,
      borderRadius: "12px",
      padding: "18px 20px",
      boxShadow: isDark ? "0 8px 28px rgba(80,40,24,0.08)" : "0 4px 16px rgba(80,40,24,0.05)",
      ...extra,
    });
    const ct = (color: string): React.CSSProperties => ({ fontSize: "14px", fontWeight: 700, marginBottom: "13px", color: txt, display: "flex", alignItems: "center", gap: "8px" });
    const dot = (color: string): React.CSSProperties => ({ width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0, background: color });
    const sec: React.CSSProperties = { fontSize: "13px", fontWeight: 700, color: muted, letterSpacing: "1px", margin: "20px 0 10px", borderLeft: `3px solid ${HERMES_ACCENT}`, paddingLeft: "10px" };

    // progress bar row
    const barRow = (label: string, fillPct: number, color: string, valueTxt?: string, tagTxt?: string, tagColors?: { bg: string; color: string }) => (
      <div style={{ display: "flex", alignItems: "center", gap: "9px", marginBottom: "8px", fontSize: "12px" }}>
        <span style={{ width: "76px", textAlign: "right", color: muted, fontSize: "11px", flexShrink: 0, lineHeight: "1.4", wordBreak: "break-word" }}>{label}</span>
        <div style={{ flex: 1, height: "10px", background: trackBg, borderRadius: "99px", overflow: "hidden" }}>
          <div style={{ height: "100%", borderRadius: "99px", background: color, width: `${fillPct}%` }} />
        </div>
        {valueTxt ? <span style={{ minWidth: "52px", textAlign: "right", fontWeight: 700, fontSize: "12px", color, flexShrink: 0 }}>{valueTxt}</span> : null}
        {tagTxt && tagColors ? (
          <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "3px", background: tagColors.bg, color: tagColors.color, flexShrink: 0, whiteSpace: "nowrap" }}>{tagTxt}</span>
        ) : null}
      </div>
    );

    const STATUS_CYCLE = [
      { label: "高热", bg: "rgba(190,40,90,0.12)", color: "#be185d" },
      { label: "高热", bg: "rgba(190,40,90,0.12)", color: "#be185d" },
      { label: "偏强", bg: "rgba(160,120,20,0.14)", color: "#a16207" },
      { label: "升温", bg: "rgba(20,120,80,0.12)", color: "#047857" },
      { label: "新爆", bg: "rgba(100,40,160,0.12)", color: "#6d28d9" },
      { label: "稳态", bg: "rgba(30,80,160,0.12)", color: "#1d4ed8" },
    ];

    return (
      <div ref={ref} style={wrap}>

        {/* ── HEADER ── */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "16px", marginBottom: "6px", paddingBottom: "14px", borderBottom: `1px solid ${border}` }}>
          <h1 style={{ fontSize: "26px", fontWeight: 800, letterSpacing: "0.5px" }}>{data.reportTitle}</h1>
          <span style={{ fontSize: "12px", color: muted }}>数据区间 · {data.dateRange}</span>
          <span style={{ display: "inline-block", fontSize: "11px", background: tagBg, color: tagClr, border: `1px solid ${tagBdr}`, borderRadius: "4px", padding: "2px 8px", marginLeft: "6px" }}>实时数据版</span>
        </div>

        {/* TAG ROW */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "22px" }}>
          {["平台趋势","蓝海词","赛道判断","流量扶持","热门赛道","算法推荐信号"].map((t) => (
            <span key={t} style={{ fontSize: "11px", background: tagBg, color: tagClr, border: `1px solid ${tagBdr}`, borderRadius: "4px", padding: "3px 10px" }}>{t}</span>
          ))}
        </div>

        {/* ── 顶部四宫格 (g4) — supports {title, description} objects and legacy strings ── */}
        {data.insightSummary.length > 0 && (
          <>
            <div style={sec}>核心洞察</div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(data.insightSummary.length, 4)}, 1fr)`, gap: "14px", marginBottom: "16px", alignItems: "start" }}>
              {data.insightSummary.slice(0, 4).map((insight: any, i) => {
                const isObj = typeof insight === "object" && insight !== null;
                const roleLabels = ["判断", "热点", "结构", "建议"] as const;
                const roleRaw = isObj ? safeTxt(insight.role || "") : "";
                const role = (roleLabels as readonly string[]).includes(roleRaw)
                  ? roleRaw
                  : roleLabels[i] || "洞察";
                const title = isObj ? safeTxt(insight.title || insight.name || "") : safeTxt(insight).slice(0, 48);
                const desc = isObj ? safeTxt(insight.description || insight.desc || insight.content || "") : safeTxt(insight);
                const accent = C[i % C.length];
                return (
                  <div key={i} style={card({ height: "auto", minHeight: 0, overflow: "visible", alignSelf: "start", borderTop: `3px solid ${accent}` })}>
                    <div style={{ ...ct(accent), color: accent }}>
                      <div style={dot(accent)} />
                      <span style={{ color: accent }}>★</span>
                      <span style={{ color: accent }}>{role}{i + 1}</span>
                    </div>
                    <div style={{ fontSize: "16px", fontWeight: 800, color: accent, lineHeight: "1.35", marginBottom: "10px", wordBreak: "break-word", overflowWrap: "anywhere", whiteSpace: "normal" }}>
                      {title}
                    </div>
                    <div style={{ fontSize: "11px", color: bodyTxt, lineHeight: "1.75", wordBreak: "break-word", overflowWrap: "anywhere", whiteSpace: "normal", height: "auto", minHeight: 0, paddingBottom: "8px" }}>
                      {renderRichText(desc, accent)}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── 蓝海词 · Blue Ocean Keywords（全局；空时仍占位，避免整栏消失）── */}
        <>
          <div style={sec}>🌊 蓝海词 · Blue Ocean Keywords</div>
          <div style={{ background: "rgba(184,92,56,0.06)", border: `1px solid rgba(184,92,56,0.22)`, borderRadius: "12px", padding: "16px 18px", marginBottom: "16px" }}>
            {(data.globalBlueOceanWords?.length || 0) > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "14px" }}>
                {(data.globalBlueOceanWords || []).map((bow, bi) => {
                  const catColor = C[bi % C.length];
                  return (
                  <div key={bi} style={{ background: "rgba(255,249,242,0.75)", border: `1px solid rgba(140,90,70,0.18)`, borderLeft: `3px solid ${catColor}`, borderRadius: "8px", padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                      <span style={{ fontSize: "10px", color: muted, fontWeight: 600, letterSpacing: "0.06em" }}>一级</span>
                      <span style={{ fontSize: "13px", fontWeight: 800, color: catColor, background: `${catColor}14`, border: `1px solid ${catColor}55`, borderRadius: "5px", padding: "2px 10px" }}>
                        ★ {bow.primary}
                      </span>
                    </div>
                    {bow.secondary && bow.secondary.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap" as const, gap: "5px", paddingLeft: "8px" }}>
                        {bow.secondary.map((s2, si) => {
                          const chip = C[(bi + si + 1) % C.length];
                          const hot = si < 2;
                          return (
                          <span
                            key={si}
                            style={{
                              fontSize: "11px",
                              color: chip,
                              fontWeight: hot ? 700 : 500,
                              background: `${chip}12`,
                              border: `1px solid ${chip}40`,
                              borderRadius: "4px",
                              padding: "2px 8px",
                              textDecoration: hot ? "underline" : undefined,
                              textUnderlineOffset: 2,
                            }}
                          >
                            {hot ? "★ " : ""}{s2}
                          </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: "12px", color: muted, lineHeight: 1.7 }}>
                本窗暂无可用蓝海词种子；请换更长窗口或更多平台后重跑「平台趋势分析」。下方赛道与热词仍可作选题参考。
              </div>
            )}
          </div>
        </>

        {/* ── AI 漫剧飙升榜（抖音 mix_info 结构化）── */}
        {(data.aiManhuaRising?.entries?.length || 0) > 0 && (
          <>
            <div style={sec}>🎬 AI 漫剧 · {data.aiManhuaRising!.windowDays} 天飙升榜</div>
            <div style={{ background: "rgba(184,92,56,0.06)", border: `1px solid rgba(184,92,56,0.22)`, borderRadius: "12px", padding: "16px 18px", marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", color: muted, marginBottom: "12px", lineHeight: 1.6 }}>{data.aiManhuaRising!.note}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {data.aiManhuaRising!.entries.slice(0, 8).map((row, idx) => {
                  const statusLabel =
                    row.status === "surging" ? "飙升"
                      : row.status === "hot" ? "高热"
                        : row.status === "new" ? "新爆"
                          : "稳态";
                  const statusColor =
                    row.status === "surging" ? C[2]
                      : row.status === "hot" ? C[3]
                        : row.status === "new" ? C[1]
                          : C[6];
                  const playTxt = row.mixPlayCount >= 10000
                    ? `${(row.mixPlayCount / 10000).toFixed(1)}万`
                    : String(row.mixPlayCount || 0);
                  const deltaTxt = row.delta7d == null
                    ? "—"
                    : row.delta7d >= 10000
                      ? `+${(row.delta7d / 10000).toFixed(1)}万`
                      : `+${row.delta7d}`;
                  return (
                    <div key={row.mixId || idx} style={{ display: "grid", gridTemplateColumns: "28px 1fr 72px 72px 48px", gap: "10px", alignItems: "center", padding: "8px 10px", background: "rgba(255,249,242,0.7)", borderRadius: "8px" }}>
                      <span style={{ fontSize: "12px", fontWeight: 800, color: muted }}>#{idx + 1}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: txt, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.url ? (
                            <a href={row.url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "none" }}>{row.mixName}</a>
                          ) : row.mixName}
                        </div>
                        <div style={{ fontSize: "10px", color: muted, marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.author ? `${row.author} · ` : ""}{row.sampleTitle || row.dramaKind}
                        </div>
                      </div>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: C[0], textAlign: "right" }}>{playTxt}</span>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: statusColor, textAlign: "right" }}>{deltaTxt}</span>
                      <span style={{ fontSize: "10px", fontWeight: 700, color: statusColor, textAlign: "right" }}>{statusLabel}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 72px 72px 48px", gap: "10px", marginTop: "8px", padding: "0 10px", fontSize: "10px", color: muted }}>
                <span />
                <span>剧名</span>
                <span style={{ textAlign: "right" }}>合集播放</span>
                <span style={{ textAlign: "right" }}>{data.aiManhuaRising!.hasBaseline ? "环比增量" : "环比(待建)"}</span>
                <span style={{ textAlign: "right" }}>状态</span>
              </div>
            </div>
          </>
        )}

        {/* ── trafficSupport + hotFestivals (g2) ── */}
        {((data.trafficSupport?.length || 0) > 0 || (data.hotFestivals?.length || 0) > 0) && (
          <>
            <div style={sec}>流量扶持活动 + 节日与社会热点</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "16px" }}>
              {(data.trafficSupport?.length || 0) > 0 && (
                <div style={card()}>
                  <div style={ct(C[5])}><div style={dot(C[5])} />🚀 当前官方流量扶持活动</div>
                  {(data.trafficSupport || []).length === 0 ? (
                    <div style={{ fontSize: "12px", color: muted }}>当前无重大官方活动</div>
                  ) : (data.trafficSupport || []).map((item, i) => {
                    const line = safeTxt(item);
                    const key = isKeyBullet(line, i);
                    const accent = C[(5 + i) % C.length];
                    return (
                    <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "9px", fontSize: "12px", color: bodyTxt, lineHeight: "1.6" }}>
                      <span style={{ color: accent, fontWeight: 800, minWidth: "22px" }}>{key ? "★" : i + 1}</span>
                      <span style={{ wordBreak: "break-word", whiteSpace: "normal", color: key ? accent : bodyTxt, fontWeight: key ? 600 : 400 }}>
                        {renderRichText(line, accent)}
                      </span>
                    </div>
                    );
                  })}
                </div>
              )}
              {(data.hotFestivals?.length || 0) > 0 && (
                <div style={card()}>
                  <div style={{ ...ct(C[2]), color: C[2] }}><div style={dot(C[2])} />🔥 当期节日与社会热点</div>
                  {(data.hotFestivals || []).length === 0 ? (
                    <div style={{ fontSize: "12px", color: muted }}>当前无显着节日热点</div>
                  ) : (data.hotFestivals || []).map((item, i) => {
                    const line = safeTxt(item);
                    const key = isKeyBullet(line, i);
                    const accent = C[(2 + i) % C.length];
                    return (
                    <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "9px", fontSize: "12px", color: bodyTxt, lineHeight: "1.6" }}>
                      <span style={{ color: accent, fontWeight: 800 }}>{key ? "★" : "•"}</span>
                      <span style={{
                        wordBreak: "break-word",
                        whiteSpace: "normal",
                        color: key ? accent : bodyTxt,
                        fontWeight: key ? 600 : 400,
                        borderBottom: key ? `1px solid ${accent}66` : undefined,
                        paddingBottom: key ? 1 : undefined,
                      }}>
                        {renderRichText(line, accent)}
                      </span>
                    </div>
                    );
                  })}
                </div>
              )}
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
                  <div style={ct(C[4])}><div style={dot(C[4])} />热门赛道 · 样本热度增速</div>
                  {(data.trackGrowth || []).map((t, i) => {
                    const color = C[i % C.length];
                    const gStr = safeTxt(t.growth || "");
                    const isHighHeat = gStr === "高热";
                    const parsed = parseGrowthPercentString(gStr);
                    let fillPct: number;
                    let valueTxt: string;
                    const isNeg = parsed != null && parsed < 0;
                    if (isHighHeat) {
                      fillPct = 100;
                      valueTxt = "高热";
                    } else if (isNeg) {
                      fillPct = 10;
                      valueTxt = /%/.test(gStr) ? gStr.trim() : `${parsed}%`;
                    } else if (parsed != null) {
                      const v = Math.round(parsed);
                      if (v > 100) {
                        fillPct = 100;
                        valueTxt = "高热";
                      } else {
                        const compactG = gStr.replace(/\s/g, "");
                        const isTimesForm = /^增长\d+(\.\d+)?倍$/.test(compactG);
                        valueTxt = isTimesForm ? gStr.trim() : `+${v}%`;
                        fillPct = Math.max(8, v);
                      }
                    } else {
                      fillPct = 8;
                      valueTxt = gStr.trim() || "无匹配样本";
                    }
                    const barColor = isNeg ? muted : parsed != null || isHighHeat ? color : muted;
                    return barRow(
                      safeTxt(t.name || t),
                      isNeg ? 10 : fillPct,
                      barColor,
                      valueTxt,
                      t.isHot ? "热" : undefined,
                      t.isHot ? { bg: "#3a0e2a", color: "#ff4fb8" } : undefined
                    );
                  })}
                </div>
              )}

              {/* Audiences & Biz */}
              {(data.audiencesAndBiz?.length || 0) > 0 && (
                <div style={card()}>
                  <div style={{ ...ct(C[2]), color: C[2] }}><div style={dot(C[2])} />★ 目标人群与商业方向</div>
                  {(data.audiencesAndBiz || []).map((ab, i) => {
                    const aAccent = C[i % C.length];
                    const bAccent = C[(i + 3) % C.length];
                    return (
                    <div key={i} style={{ marginBottom: "14px" }}>
                      <div style={{ fontSize: "12px", color: bodyTxt, lineHeight: "1.6", marginBottom: "4px" }}>
                        <span style={{ color: aAccent, fontWeight: 800 }}>★ 目标人群 {i + 1}</span><br />
                        <span style={{ borderBottom: i === 0 ? `1.5px solid ${aAccent}` : undefined, paddingBottom: i === 0 ? 1 : undefined }}>
                          {renderRichText(safeTxt(ab.audience), aAccent)}
                        </span>
                      </div>
                      {i < (data.audiencesAndBiz?.length || 0) - 1 && <div style={{ height: "1px", background: border, margin: "8px 0" }} />}
                      <div style={{ fontSize: "12px", color: bodyTxt, lineHeight: "1.6" }}>
                        <span style={{ color: bAccent, fontWeight: 800 }}>商业方向 {i + 1}</span><br />
                        <span style={{ color: bAccent, fontWeight: 600 }}>
                          {renderRichText(safeTxt(ab.bizDirection), bAccent)}
                        </span>
                      </div>
                    </div>
                    );
                  })}
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
                const conceptAccent = C[(i + 2) % C.length];
                return (
                  <div key={i} style={{ marginBottom: "13px", borderLeft: `3px solid ${color}`, paddingLeft: "10px" }}>
                    <div style={{ fontSize: "13px", fontWeight: 800, color, marginBottom: "5px" }}>
                      {i < 2 ? "★ " : ""}{safeTxt(ex.structure)}
                    </div>
                    <div style={{ height: "5px", background: trackBg, borderRadius: "99px", overflow: "hidden", marginBottom: "4px" }}>
                      <div style={{ height: "100%", borderRadius: "99px", background: color, width: `${barW}%` }} />
                    </div>
                    <div style={{ fontSize: "11px", color: bodyTxt, lineHeight: "1.6" }}>
                      {renderRichText(safeTxt(ex.concept), conceptAccent)}
                    </div>
                    {ex.realCase && (
                      <div style={{
                        fontSize: "11px",
                        color,
                        lineHeight: "1.6",
                        marginTop: "3px",
                        fontWeight: 700,
                        fontStyle: "italic",
                        borderBottom: `1.5px solid ${color}`,
                        display: "inline",
                        paddingBottom: 1,
                      }}>
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
                    <div style={{ fontSize: "11px", fontWeight: 700, color: C[5], marginBottom: "8px" }}>🚀 流量扶持活动</div>
                    {pl.trafficBoosters.map((b, bi) => {
                      const line = safeTxt(b);
                      const key = isKeyBullet(line, bi);
                      const lineAccent = C[(5 + bi) % C.length];
                      return (
                      <div key={bi} style={{ display: "flex", gap: "9px", alignItems: "flex-start", marginBottom: "8px", fontSize: "12px" }}>
                        <span style={{ color: lineAccent, fontWeight: 800, minWidth: "18px", flexShrink: 0 }}>{key ? "★" : bi + 1}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ height: "6px", background: trackBg, borderRadius: "99px", overflow: "hidden", marginBottom: "3px" }}>
                            <div style={{ height: "100%", borderRadius: "99px", background: `linear-gradient(90deg,${C[5]},${C[0]})`, width: `${Math.max(100 - bi * 18, 30)}%` }} />
                          </div>
                          <div style={{ fontSize: "11px", color: key ? lineAccent : bodyTxt, fontWeight: key ? 600 : 400, lineHeight: "1.5", wordBreak: "break-word", whiteSpace: "normal" }}>
                            {renderRichText(line, lineAccent)}
                          </div>
                        </div>
                      </div>
                      );
                    })}
                  </>
                )}
                {pl.hotTopics.length > 0 && (
                  <>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: C[3], marginTop: "10px", marginBottom: "8px" }}>🔥 热门赛道</div>
                    {pl.hotTopics.map((tp, ti) => {
                      const st = STATUS_CYCLE[ti % STATUS_CYCLE.length];
                      const barW = Math.max(100 - ti * 8, 40);
                      const color = C[ti % C.length];
                      const top = ti < 3;
                      return (
                        <div key={ti} style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "10px" }}>
                          <div style={{
                            fontSize: "12px",
                            color,
                            fontWeight: top ? 700 : 500,
                            lineHeight: "1.5",
                            wordBreak: "break-word",
                            whiteSpace: "normal",
                            textDecoration: top ? "underline" : undefined,
                            textUnderlineOffset: 2,
                          }}>
                            {top ? "★ " : ""}{safeTxt(tp)}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <div style={{ flex: 1, height: "8px", background: trackBg, borderRadius: "99px", overflow: "hidden" }}>
                              <div style={{ height: "100%", borderRadius: "99px", background: color, width: `${barW}%` }} />
                            </div>
                            <span style={{ fontSize: "11px", fontWeight: 700, color, minWidth: "36px", textAlign: "right" }}>#{ti + 1}</span>
                            <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "99px", background: st.bg, color: st.color, flexShrink: 0 }}>{st.label}</span>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
                {/* ── 蓝海词 · Blue Ocean Keywords ── */}
                {pl.blueOceanWords && pl.blueOceanWords.length > 0 && (
                  <div style={{ marginTop: "14px", borderTop: "1px solid rgba(140,90,70,0.22)", paddingTop: "12px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, color: HERMES_ACCENT, marginBottom: "8px" }}>
                      🌊 蓝海词 · Blue Ocean Keywords
                    </div>
                    {pl.blueOceanWords.map((bow, bi) => {
                      const catColor = C[bi % C.length];
                      return (
                      <div key={bi} style={{ marginBottom: "10px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}>
                          <span style={{ fontSize: "12px", fontWeight: 800, color: catColor, background: `${catColor}14`, border: `1px solid ${catColor}55`, borderRadius: "6px", padding: "2px 10px", whiteSpace: "nowrap" }}>
                            ★ 一级：{bow.primary}
                          </span>
                        </div>
                        {bow.secondary && bow.secondary.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", paddingLeft: "8px" }}>
                            {bow.secondary.map((s2, si) => {
                              const chip = C[(bi + si + 1) % C.length];
                              const hot = si < 2;
                              return (
                              <span key={si} style={{
                                fontSize: "11px",
                                color: chip,
                                fontWeight: hot ? 700 : 500,
                                background: `${chip}12`,
                                border: `1px solid ${chip}40`,
                                borderRadius: "4px",
                                padding: "1px 8px",
                                whiteSpace: "nowrap",
                                textDecoration: hot ? "underline" : undefined,
                                textUnderlineOffset: 2,
                              }}>
                                {hot ? "★ " : ""}{s2}
                              </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      );
                    })}
                  </div>
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
                        <div style={{ fontSize: "11px", fontWeight: 700, color: C[5], marginBottom: "8px" }}>🚀 流量扶持活动</div>
                        {pl.trafficBoosters.map((b, bi) => {
                          const line = safeTxt(b);
                          const key = isKeyBullet(line, bi);
                          const lineAccent = C[(5 + bi) % C.length];
                          return (
                          <div key={bi} style={{ display: "flex", gap: "9px", alignItems: "flex-start", marginBottom: "8px", fontSize: "12px" }}>
                            <span style={{ color: lineAccent, fontWeight: 800, minWidth: "18px", flexShrink: 0 }}>{key ? "★" : bi + 1}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ height: "6px", background: trackBg, borderRadius: "99px", overflow: "hidden", marginBottom: "3px" }}>
                                <div style={{ height: "100%", borderRadius: "99px", background: `linear-gradient(90deg,${C[5]},${C[0]})`, width: `${Math.max(100 - bi * 18, 30)}%` }} />
                              </div>
                              <div style={{ fontSize: "11px", color: key ? lineAccent : bodyTxt, fontWeight: key ? 600 : 400, lineHeight: "1.5", wordBreak: "break-word", whiteSpace: "normal" }}>
                                {renderRichText(line, lineAccent)}
                              </div>
                            </div>
                          </div>
                          );
                        })}
                      </>
                    )}
                    {pl.cashRewards.length > 0 && (
                      <>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: C[4], marginTop: "10px", marginBottom: "8px" }}>💰 现金奖励任务</div>
                        {pl.cashRewards.map((rw, ri) => {
                          const line = safeTxt(rw);
                          const lineAccent = C[(4 + ri) % C.length];
                          return (
                          <div key={ri} style={{ display: "flex", gap: "9px", alignItems: "flex-start", marginBottom: "8px", fontSize: "12px" }}>
                            <span style={{ color: lineAccent, fontWeight: 800, minWidth: "18px", flexShrink: 0 }}>{ri < 2 ? "★" : "💎"}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ height: "6px", background: trackBg, borderRadius: "99px", overflow: "hidden", marginBottom: "3px" }}>
                                <div style={{ height: "100%", borderRadius: "99px", background: `linear-gradient(90deg,${C[4]},${C[0]})`, width: `${Math.max(100 - ri * 22, 30)}%` }} />
                              </div>
                              <div style={{ fontSize: "11px", color: ri < 2 ? lineAccent : bodyTxt, fontWeight: ri < 2 ? 600 : 400, lineHeight: "1.5", wordBreak: "break-word", whiteSpace: "normal" }}>
                                {renderRichText(line, lineAccent)}
                              </div>
                            </div>
                          </div>
                          );
                        })}
                      </>
                    )}
                    {pl.hotTopics.length > 0 && (
                      <>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: C[3], marginTop: "10px", marginBottom: "8px" }}>🔥 热门赛道</div>
                        {pl.hotTopics.map((tp, ti) => {
                          const st = STATUS_CYCLE[ti % STATUS_CYCLE.length];
                          const barW = Math.max(100 - ti * 8, 40);
                          const color = C[ti % C.length];
                          const top = ti < 3;
                          return (
                            <div key={ti} style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "10px" }}>
                              <div style={{
                                fontSize: "12px",
                                color,
                                fontWeight: top ? 700 : 500,
                                lineHeight: "1.5",
                                wordBreak: "break-word",
                                whiteSpace: "normal",
                                textDecoration: top ? "underline" : undefined,
                                textUnderlineOffset: 2,
                              }}>
                                {top ? "★ " : ""}{safeTxt(tp)}
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <div style={{ flex: 1, height: "8px", background: trackBg, borderRadius: "99px", overflow: "hidden" }}>
                                  <div style={{ height: "100%", borderRadius: "99px", background: color, width: `${barW}%` }} />
                                </div>
                                <span style={{ fontSize: "11px", fontWeight: 700, color, minWidth: "36px", textAlign: "right" }}>#{ti + 1}</span>
                                <span style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "99px", background: st.bg, color: st.color, flexShrink: 0 }}>{st.label}</span>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                    {/* ── 蓝海词 · Blue Ocean Keywords ── */}
                    {pl.blueOceanWords && pl.blueOceanWords.length > 0 && (
                      <div style={{ marginTop: "12px", borderTop: "1px solid rgba(140,90,70,0.22)", paddingTop: "10px" }}>
                        <div style={{ fontSize: "11px", fontWeight: 700, color: HERMES_ACCENT, marginBottom: "7px" }}>
                          🌊 蓝海词
                        </div>
                        {pl.blueOceanWords.map((bow, bi) => {
                          const catColor = C[bi % C.length];
                          return (
                          <div key={bi} style={{ marginBottom: "8px" }}>
                            <span style={{ fontSize: "11px", fontWeight: 800, color: catColor, background: `${catColor}14`, border: `1px solid ${catColor}55`, borderRadius: "5px", padding: "1px 8px", display: "inline-block", marginBottom: "4px" }}>
                              ★ 一级：{bow.primary}
                            </span>
                            {bow.secondary && bow.secondary.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", paddingLeft: "6px" }}>
                                {bow.secondary.map((s2, si) => {
                                  const chip = C[(bi + si + 1) % C.length];
                                  const hot = si < 2;
                                  return (
                                  <span key={si} style={{
                                    fontSize: "10px",
                                    color: chip,
                                    fontWeight: hot ? 700 : 500,
                                    background: `${chip}12`,
                                    border: `1px solid ${chip}40`,
                                    borderRadius: "3px",
                                    padding: "1px 6px",
                                    textDecoration: hot ? "underline" : undefined,
                                    textUnderlineOffset: 2,
                                  }}>
                                    {hot ? "★ " : ""}{s2}
                                  </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          );
                        })}
                      </div>
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

/** 独立第二张 PNG：不挤占主周报版面，不触发生图调用。 */
export const VisualReportCoverPage = React.forwardRef<HTMLDivElement, Props>(
  function VisualReportCoverPage({ data }, ref) {
    const border = "rgba(140,90,70,0.28)";
    const bodyTxt = "#3D2A20";
    return (
      <div
        ref={ref}
        style={{
          background: data.theme === "dark" ? HERMES_PAGE_BG : "linear-gradient(168deg, #F7F1EA 0%, #F3E0D6 100%)",
          color: "#2A1810",
          fontFamily: '"PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif',
          padding: "32px",
          minWidth: "900px",
          maxWidth: "1200px",
        }}
      >
        <div style={{ borderBottom: `1px solid ${border}`, paddingBottom: "14px", marginBottom: "18px" }}>
          <div style={{ fontSize: "26px", fontWeight: 900 }}>本期优秀封面 · Terra High 选秀</div>
          <div style={{ marginTop: "5px", fontSize: "12px", color: "#6B4E3D" }}>
            {data.dateRange} · 从真实平台封面候选中按点击吸引力排序
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "14px" }}>
          {(data.excellentCoverReferences || []).slice(0, 10).map((cover) => (
            <div key={cover.sourceId} style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: "12px", minHeight: "210px", padding: "12px", background: "rgba(255,249,242,0.96)", border: `1px solid ${border}`, borderRadius: "12px" }}>
              {cover.coverUrl ? (
                <img src={cover.coverUrl} crossOrigin="anonymous" alt={cover.title} style={{ width: "150px", height: "210px", objectFit: "cover", borderRadius: "9px" }} />
              ) : <div style={{ width: "150px", height: "210px", borderRadius: "9px", background: "rgba(70,48,36,0.08)" }} />}
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ fontSize: "18px", fontWeight: 900, color: C[(cover.rank - 1) % C.length] }}>#{cover.rank}</div>
                <div style={{ marginTop: "7px", fontSize: "14px", fontWeight: 800, lineHeight: 1.45 }}>{safeTxt(cover.title)}</div>
                <div style={{ marginTop: "6px", fontSize: "11px", color: "#6B4E3D" }}>{PLATFORM_ICONS[cover.platform] || "📱"} {safeTxt(cover.author) || "作者未标注"}</div>
                <div style={{ marginTop: "auto", paddingTop: "10px", borderTop: `1px solid ${border}`, fontSize: "12px", color: bodyTxt, lineHeight: 1.6 }}>
                  <span style={{ color: C[(cover.rank + 2) % C.length], fontWeight: 900 }}>高 CTR 判断：</span>
                  {safeTxt(cover.highCtrReason) || "真实互动领先，首屏主体与标题信息易识别"}
                </div>
              </div>
            </div>
          ))}
        </div>
        {(data.legacyCoverReferences?.length || 0) > 0 && (
          <div style={{ marginTop: "18px", padding: "16px 18px", background: "rgba(255,249,242,0.94)", border: `1px solid ${border}`, borderRadius: "12px" }}>
            <div style={{ fontSize: "13px", fontWeight: 900, color: C[6], marginBottom: "9px" }}>历史参考（旧数据无封面，仅列标题与作者）</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 18px" }}>
              {(data.legacyCoverReferences || []).slice(0, 20).map((row) => (
                <div key={row.sourceId} style={{ fontSize: "11px", color: bodyTxt, lineHeight: 1.5 }}>
                  {PLATFORM_ICONS[row.platform] || "📱"} {safeTxt(row.title)} · {safeTxt(row.author) || "作者未标注"}
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ marginTop: "20px", paddingTop: "12px", borderTop: `1px solid ${border}`, fontSize: "11px", color: "#6B4E3D", textAlign: "center" }}>
          由 mvstudiopro Platform Intelligence 生成 · 封面来自真实平台内容，不使用 GPT‑Image‑2 重绘
        </div>
      </div>
    );
  },
);
