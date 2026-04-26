import { useState, useEffect, useCallback } from "react";
import { Mic, TrendingUp, Clapperboard, BarChart2, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

// ─── 功能卡片数据（isNew = 橙色高亮）────────────────────────────────
const CARDS = [
  {
    isNew: true,
    date: "2026/04/26",
    tag: "今日上线",
    title: "语音输入功能升级",
    subtitle: "說話即可輸入 · 支援 Chrome、Edge、Safari",
    desc: "全面支援三大瀏覽器！錄音結束後 AI 自動識別中文並填入輸入框，無需手動打字，創作效率大幅提升。",
    pills: ["Chrome ✓", "Edge ✓", "Safari ✓", "中文識別"],
    flashPills: true,
    icon: Mic,
    accentColor: "#fb923c",
    glowColor: "rgba(251,146,60,0.20)",
    borderColor: "rgba(251,146,60,0.35)",
    bgGradient: "linear-gradient(135deg, rgba(251,146,60,0.10) 0%, rgba(251,146,60,0.03) 100%)",
  },
  {
    isNew: true,
    date: "2026/04/26",
    tag: "今日上线",
    title: "我的作品中心",
    subtitle: "历史分析永久留存 · 一键分享",
    desc: "每次创作者分析与平台趋势报告自动保存为专属页面，附带可复制链接，随时回顾或分享给团队成员。",
    pills: ["自动保存", "专属链接", "一键分享"],
    icon: Sparkles,
    accentColor: "#fb923c",
    glowColor: "rgba(251,146,60,0.20)",
    borderColor: "rgba(251,146,60,0.35)",
    bgGradient: "linear-gradient(135deg, rgba(251,146,60,0.10) 0%, rgba(251,146,60,0.03) 100%)",
  },
  {
    isNew: false,
    date: "2026/04/25",
    tag: "功能亮点",
    title: "IP 战略指挥室",
    subtitle: "10 秒拆解爆款 DNA",
    desc: "上传任意竞品视频，AI 输出万字商业战略 + 爆款选题库 + 导演级分镜。成长型 / 二创双模式，PDF 报告一键下载。",
    pills: ["双模式分析", "商业拆解", "PDF 导出"],
    icon: TrendingUp,
    accentColor: "#a78bfa",
    glowColor: "rgba(167,139,250,0.20)",
    borderColor: "rgba(167,139,250,0.30)",
    bgGradient: "linear-gradient(135deg, rgba(167,139,250,0.08) 0%, rgba(167,139,250,0.02) 100%)",
    href: "/creator-growth-camp",
  },
  {
    isNew: false,
    date: "2026/04/25",
    tag: "功能亮点",
    title: "全网流量趋势雷达",
    subtitle: "实时捕捉爆款热浪",
    desc: "15/30 天数据窗口追踪小红书、抖音等主流平台最新流量风向，AI 对话分析，量身定制起号计划，趋势长图一键导出。",
    pills: ["多平台追踪", "AI 续问", "趋势导出"],
    icon: BarChart2,
    accentColor: "#38bdf8",
    glowColor: "rgba(56,189,248,0.18)",
    borderColor: "rgba(56,189,248,0.28)",
    bgGradient: "linear-gradient(135deg, rgba(56,189,248,0.07) 0%, rgba(56,189,248,0.02) 100%)",
    href: "/creator-growth-camp/platform",
  },
  {
    isNew: false,
    date: "2026/04/24",
    tag: "功能亮点",
    title: "影视级全自动产线",
    subtitle: "从想法到成片全自动",
    desc: "可视化节点串联脚本生成、分镜规划、配乐合成、语音合成，点击执行坐等成片。拖拽式节点编排，语音输入提示词。",
    pills: ["节点编排", "语音输入", "高清成片"],
    icon: Clapperboard,
    accentColor: "#34d399",
    glowColor: "rgba(52,211,153,0.18)",
    borderColor: "rgba(52,211,153,0.28)",
    bgGradient: "linear-gradient(135deg, rgba(52,211,153,0.07) 0%, rgba(52,211,153,0.02) 100%)",
    href: "/workflow-nodes",
  },
];

export default function HomeFeatureCarousel() {
  const [current, setCurrent] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const total = CARDS.length;

  const next = useCallback(() => setCurrent((c) => (c + 1) % total), [total]);
  const prev = useCallback(() => setCurrent((c) => (c - 1 + total) % total), [total]);

  useEffect(() => {
    if (isPaused) return;
    const timer = setInterval(next, 4500);
    return () => clearInterval(timer);
  }, [next, isPaused]);

  const card = CARDS[current];
  const Icon = card.icon;

  return (
    <section style={{ width: "100%", padding: "0 0 48px" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 24px" }}>

        {/* 区块标题 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <span style={{
            fontSize: 11, fontWeight: 800, letterSpacing: "0.12em",
            color: "#fb923c",
            background: "rgba(251,146,60,0.12)",
            border: "1px solid rgba(251,146,60,0.3)",
            borderRadius: 99, padding: "3px 12px",
            textTransform: "uppercase",
          }}>
            新功能动态
          </span>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>最新上线与核心亮点</span>
        </div>

        {/* 主卡片区域 */}
        <div
          style={{
            position: "relative",
            background: card.bgGradient,
            border: `1px solid ${card.borderColor}`,
            borderRadius: 20,
            boxShadow: `0 0 48px ${card.glowColor}, inset 0 0 40px ${card.glowColor.replace("0.20", "0.04")}`,
            padding: "32px 36px",
            transition: "background 0.5s ease, border-color 0.5s ease, box-shadow 0.5s ease",
            overflow: "hidden",
            cursor: "default",
          }}
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
        >
          {/* 装饰背景光晕 */}
          <div style={{
            position: "absolute", top: -60, right: -60,
            width: 200, height: 200,
            background: card.glowColor,
            borderRadius: "50%",
            filter: "blur(60px)",
            pointerEvents: "none",
            transition: "background 0.5s",
          }} />

          <div style={{ display: "flex", gap: 32, alignItems: "flex-start", position: "relative" }}>
            {/* 左侧内容 */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* 顶部标签行 */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                {/* NEW 徽章（橙色仅限 isNew） */}
                {card.isNew && (
                  <span style={{
                    fontSize: 11, fontWeight: 900, letterSpacing: "0.1em",
                    color: "#fff",
                    background: "linear-gradient(90deg, #f97316, #fb923c)",
                    borderRadius: 6, padding: "3px 10px",
                    boxShadow: "0 2px 8px rgba(249,115,22,0.45)",
                    animation: "mvsp-pulse-orange 2s ease-in-out infinite",
                  }}>
                    NEW
                  </span>
                )}
                <span style={{
                  fontSize: 11, fontWeight: 700, letterSpacing: "0.07em",
                  color: card.accentColor,
                  background: card.glowColor,
                  border: `1px solid ${card.borderColor}`,
                  borderRadius: 99, padding: "3px 10px",
                }}>
                  {card.tag}
                </span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{card.date}</span>
              </div>

              {/* 标题 */}
              <h3 style={{
                fontSize: 26, fontWeight: 900, color: "#fff",
                margin: "0 0 4px", lineHeight: 1.25,
                textShadow: card.isNew ? `0 0 24px ${card.accentColor}55` : "none",
              }}>
                {card.title}
              </h3>
              <p style={{ fontSize: 14, color: card.accentColor, margin: "0 0 14px", fontWeight: 600 }}>
                {card.subtitle}
              </p>
              <p style={{
                fontSize: 14, color: "rgba(255,255,255,0.6)",
                lineHeight: 1.75, margin: "0 0 20px", maxWidth: 520,
              }}>
                {card.desc}
              </p>

              {/* 功能标签 Pills */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {card.pills.map((pill, i) => {
                  const isFlash = (card as any).flashPills && i < 3;
                  return (
                    <span key={i} style={{
                      fontSize: 12, color: isFlash ? "#fff" : card.accentColor,
                      background: isFlash
                        ? `linear-gradient(90deg, ${card.accentColor}cc, ${card.accentColor}88)`
                        : card.glowColor,
                      border: `1px solid ${isFlash ? card.accentColor : card.borderColor}`,
                      borderRadius: 99, padding: "4px 14px",
                      fontWeight: 700,
                      boxShadow: isFlash ? `0 0 10px ${card.accentColor}66` : "none",
                      animation: isFlash
                        ? `mvsp-flash-pill 1.6s ease-in-out ${i * 0.25}s infinite`
                        : "none",
                    }}>
                      {pill}
                    </span>
                  );
                })}
              </div>

              {/* 跳转按钮（仅有 href 的卡片显示） */}
              {"href" in card && card.href && (
                <a
                  href={card.href}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    marginTop: 20,
                    fontSize: 13, fontWeight: 700,
                    color: card.accentColor,
                    background: card.glowColor,
                    border: `1px solid ${card.borderColor}`,
                    borderRadius: 10, padding: "8px 18px",
                    textDecoration: "none",
                    transition: "opacity 0.2s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.75")}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
                >
                  立即体验 →
                </a>
              )}
            </div>

            {/* 右侧图标区 */}
            <div style={{
              flexShrink: 0,
              width: 100, height: 100,
              borderRadius: 24,
              background: `linear-gradient(135deg, ${card.glowColor.replace("0.20", "0.3")}, ${card.glowColor.replace("0.20", "0.08")})`,
              border: `1px solid ${card.borderColor}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 8px 32px ${card.glowColor}`,
              transition: "all 0.5s ease",
            }}>
              <Icon size={44} color={card.accentColor} />
            </div>
          </div>

          {/* 左右导航箭头 */}
          <button
            onClick={prev}
            style={{
              position: "absolute", left: 14, top: "50%",
              transform: "translateY(-50%)",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 10, width: 34, height: 34,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "rgba(255,255,255,0.5)",
              transition: "background 0.2s, color 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.12)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              e.currentTarget.style.color = "rgba(255,255,255,0.5)";
            }}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={next}
            style={{
              position: "absolute", right: 14, top: "50%",
              transform: "translateY(-50%)",
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 10, width: 34, height: 34,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", color: "rgba(255,255,255,0.5)",
              transition: "background 0.2s, color 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.12)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              e.currentTarget.style.color = "rgba(255,255,255,0.5)";
            }}
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* 点状分页 + 进度条 */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 18 }}>
          {CARDS.map((c, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              style={{
                border: "none", cursor: "pointer", padding: 0,
                width: i === current ? 28 : 8,
                height: 8, borderRadius: 99,
                background: i === current ? c.accentColor : "rgba(255,255,255,0.15)",
                boxShadow: i === current ? `0 0 8px ${c.accentColor}88` : "none",
                transition: "all 0.3s ease",
              }}
            />
          ))}
        </div>
      </div>

      {/* 动画关键帧 */}
      <style>{`
        @keyframes mvsp-pulse-orange {
          0%, 100% { box-shadow: 0 2px 8px rgba(249,115,22,0.45); }
          50% { box-shadow: 0 2px 16px rgba(249,115,22,0.75); }
        }
        @keyframes mvsp-flash-pill {
          0%, 100% {
            opacity: 1;
            box-shadow: 0 0 10px rgba(251,146,60,0.5);
            transform: scale(1);
          }
          50% {
            opacity: 0.72;
            box-shadow: 0 0 20px rgba(251,146,60,0.9), 0 0 36px rgba(251,146,60,0.4);
            transform: scale(1.05);
          }
        }
      `}</style>
    </section>
  );
}
