import { useState, useEffect, useCallback } from "react";
import { Mic, TrendingUp, Clapperboard, BarChart2, ChevronLeft, ChevronRight, Sparkles, Search } from "lucide-react";

// ─── 固定置顶卡片（竞品分析，永久显示） ───────────────────────────────
const PINNED_CARD = {
  isNew: true,
  date: "2026/04/27",
  tag: "今日上线",
  title: "竞品与对标分析",
  subtitle: "结合四平台实时数据库 · 双引擎战略处方",
  desc: "整合小红书、抖音、快手、B站四平台实时热门内容库，双引擎深度扫描竞品流量密码，生成差异化人设定位、执行脚本与30天增长路径，单次20点即可获得降维打击方案。",
  pills: ["小红书", "抖音", "B站", "快手", "20点/次"],
  icon: Search,
  accentColor: "#f97316",
  glowColor: "rgba(249,115,22,0.22)",
  borderColor: "rgba(249,115,22,0.40)",
  bgGradient: "linear-gradient(135deg, rgba(249,115,22,0.12) 0%, rgba(249,115,22,0.04) 100%)",
  href: "/research",
};

// ─── 轮播功能动态（不含固定卡片） ───────────────────────────────────
const CAROUSEL_CARDS = [
  {
    isNew: true,
    date: "2026/04/26",
    tag: "今日上线",
    title: "语音输入功能升级",
    subtitle: "说话即可输入 · 支持 Chrome、Edge、Safari",
    desc: "全面支持三大浏览器！录音结束后 AI 自动识别中文并填入输入框，无需手动打字，创作效率大幅提升。",
    pills: ["Chrome ✓", "Edge ✓", "Safari ✓", "中文识别"],
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

// ─── 通用卡片渲染 ────────────────────────────────────────────────────
function FeatureCard({
  card,
  onMouseEnter,
  onMouseLeave,
  compact = false,
}: {
  card: (typeof CAROUSEL_CARDS)[0] & { href?: string };
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  compact?: boolean;
}) {
  const Icon = card.icon;
  return (
    <div
      style={{
        position: "relative",
        background: card.bgGradient,
        border: `1px solid ${card.borderColor}`,
        borderRadius: 20,
        boxShadow: `0 0 48px ${card.glowColor}, inset 0 0 40px ${card.glowColor.replace(/[\d.]+\)$/, "0.04)")}`,
        padding: compact ? "24px 28px" : "32px 36px",
        overflow: "hidden",
        transition: "background 0.5s ease, border-color 0.5s ease, box-shadow 0.5s ease",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* 装饰光晕 */}
      <div style={{ position: "absolute", top: -60, right: -60, width: 200, height: 200, background: card.glowColor, borderRadius: "50%", filter: "blur(60px)", pointerEvents: "none" }} />

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", position: "relative" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* 标签行 */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            {card.isNew && (
              <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.1em", color: "#fff", background: "linear-gradient(90deg,#f97316,#fb923c)", borderRadius: 6, padding: "3px 10px", boxShadow: "0 2px 8px rgba(249,115,22,0.45)", animation: "mvsp-pulse-orange 2s ease-in-out infinite" }}>
                NEW
              </span>
            )}
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.07em", color: card.accentColor, background: card.glowColor, border: `1px solid ${card.borderColor}`, borderRadius: 99, padding: "3px 10px" }}>
              {card.tag}
            </span>
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{card.date}</span>
          </div>

          <h3 style={{ fontSize: compact ? 20 : 26, fontWeight: 900, color: "#fff", margin: "0 0 4px", lineHeight: 1.25, textShadow: card.isNew ? `0 0 24px ${card.accentColor}55` : "none" }}>
            {card.title}
          </h3>
          <p style={{ fontSize: 13, color: card.accentColor, margin: "0 0 12px", fontWeight: 600 }}>{card.subtitle}</p>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.75, margin: "0 0 16px", maxWidth: 520 }}>{card.desc}</p>

          {/* Pills */}
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {card.pills.map((pill: string, i: number) => {
              const isFlash = (card as any).flashPills && i < 3;
              return (
                <span key={i} style={{ fontSize: 12, color: isFlash ? "#fff" : card.accentColor, background: isFlash ? `linear-gradient(90deg,${card.accentColor}cc,${card.accentColor}88)` : card.glowColor, border: `1px solid ${isFlash ? card.accentColor : card.borderColor}`, borderRadius: 99, padding: "4px 12px", fontWeight: 700, boxShadow: isFlash ? `0 0 10px ${card.accentColor}66` : "none", animation: isFlash ? `mvsp-flash-pill 1.6s ease-in-out ${i * 0.25}s infinite` : "none" }}>
                  {pill}
                </span>
              );
            })}
          </div>

          {/* 跳转按钮 */}
          {(card as any).href && (
            <a href={(card as any).href} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 16, fontSize: 13, fontWeight: 700, color: card.accentColor, background: card.glowColor, border: `1px solid ${card.borderColor}`, borderRadius: 10, padding: "8px 18px", textDecoration: "none", transition: "opacity 0.2s" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.75")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              立即体验 →
            </a>
          )}
        </div>

        {/* 右侧图标 */}
        <div style={{ flexShrink: 0, width: compact ? 72 : 96, height: compact ? 72 : 96, borderRadius: 20, background: `linear-gradient(135deg,${card.glowColor.replace(/[\d.]+\)$/, "0.3)")},${card.glowColor.replace(/[\d.]+\)$/, "0.08)")})`, border: `1px solid ${card.borderColor}`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 8px 32px ${card.glowColor}` }}>
          <Icon size={compact ? 32 : 42} color={card.accentColor} />
        </div>
      </div>
    </div>
  );
}

// ─── 主组件 ──────────────────────────────────────────────────────────
export default function HomeFeatureCarousel() {
  const [current, setCurrent] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const total = CAROUSEL_CARDS.length;

  const next = useCallback(() => setCurrent((c) => (c + 1) % total), [total]);
  const prev = useCallback(() => setCurrent((c) => (c - 1 + total) % total), [total]);

  useEffect(() => {
    if (isPaused) return;
    const timer = setInterval(next, 4500);
    return () => clearInterval(timer);
  }, [next, isPaused]);

  const card = CAROUSEL_CARDS[current];

  return (
    <section style={{ width: "100%", padding: "0 0 48px" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 24px" }}>

        {/* 区块标题 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "#fb923c", background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.3)", borderRadius: 99, padding: "3px 12px", textTransform: "uppercase" }}>
            新功能动态
          </span>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>最新上线与核心亮点</span>
        </div>

        {/* ── 固定卡片：竞品与对标分析 ── */}
        <FeatureCard card={PINNED_CARD as any} />

        {/* 间距分割线 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0 16px" }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", letterSpacing: "0.1em", textTransform: "uppercase" }}>功能动态</span>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
        </div>

        {/* ── 功能轮播区 ── */}
        <div style={{ position: "relative" }}>
          <FeatureCard
            card={card}
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
            compact
          />

          {/* 左右箭头 */}
          {[{ dir: "left", fn: prev, Icon: ChevronLeft }, { dir: "right", fn: next, Icon: ChevronRight }].map(({ dir, fn, Icon: Ico }) => (
            <button
              key={dir}
              onClick={fn}
              style={{ position: "absolute", [dir]: 14, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.5)", transition: "background 0.2s,color 0.2s" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}
            >
              <Ico size={15} />
            </button>
          ))}
        </div>

        {/* 点状分页 */}
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 14 }}>
          {CAROUSEL_CARDS.map((c, i) => (
            <button key={i} onClick={() => setCurrent(i)} style={{ border: "none", cursor: "pointer", padding: 0, width: i === current ? 24 : 7, height: 7, borderRadius: 99, background: i === current ? c.accentColor : "rgba(255,255,255,0.15)", boxShadow: i === current ? `0 0 8px ${c.accentColor}88` : "none", transition: "all 0.3s ease" }} />
          ))}
        </div>
      </div>

      <style>{`
        @keyframes mvsp-pulse-orange {
          0%,100% { box-shadow: 0 2px 8px rgba(249,115,22,0.45); }
          50% { box-shadow: 0 2px 16px rgba(249,115,22,0.75); }
        }
        @keyframes mvsp-flash-pill {
          0%,100% { opacity:1; box-shadow:0 0 10px rgba(251,146,60,0.5); transform:scale(1); }
          50% { opacity:0.72; box-shadow:0 0 20px rgba(251,146,60,0.9),0 0 36px rgba(251,146,60,0.4); transform:scale(1.05); }
        }
      `}</style>
    </section>
  );
}
