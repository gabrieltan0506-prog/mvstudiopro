import { useState, useEffect, useCallback } from "react";
import {
  Mic, TrendingUp, Clapperboard, BarChart2, ChevronLeft, ChevronRight, Sparkles,
  Search, Crown, BookOpen, Star, FileDown, Zap, Briefcase, Clock,
} from "lucide-react";
import { useIsMobile } from "@/hooks/useMobile";
import { HOME_CHANGELOG_UPDATES, HOME_UPDATE_TAG_COLORS } from "./HomeChangelog";

// ─── 轮播功能动态 ───────────────────────────────────────────────────
const CAROUSEL_CARDS = [
  {
    isNew: true,
    date: "2026/04/30",
    tag: "今日上线",
    title: "企业专属智能体定制",
    subtitle: "把您的销冠 SOP / 客诉手册 / 战败分析喂给一个永远在线的战略大脑",
    desc: "30 天 ¥15,000 试用版起步：1 个专属 Agent + 50 MB 知识库 + 100 次调用，企业隔离存储 + 用户主动一键删除。不满意不升级正式版。",
    pills: ["¥15,000 起", "30 天试用", "知识库 50MB", "Gemini 3 Pro", "企业隔离存储"],
    icon: Briefcase,
    accentColor: "#FB7185",
    glowColor: "rgba(251,113,133,0.20)",
    borderColor: "rgba(251,113,133,0.40)",
    bgGradient: "linear-gradient(135deg, rgba(251,113,133,0.10) 0%, rgba(251,113,133,0.03) 100%)",
    href: "/enterprise-agent",
  },
  {
    isNew: false,
    date: "2026/04/28",
    tag: "本周新版",
    title: "万能素材解析引擎",
    subtitle: "抖音 · 快手 · 小红书 · B站 · 本地化解析",
    desc: "二创功能重大升级！无需第三方API，本地化解析引擎全本地运行，支持主流国内视频平台。输入URL一键解析并下载原画无水印素材，解析失败自动更新引擎，数据安全100%自主掌控。",
    pills: ["抖音", "快手", "小红书", "B站", "本地化引擎"],
    icon: Zap,
    accentColor: "#22d3ee",
    glowColor: "rgba(34,211,238,0.18)",
    borderColor: "rgba(34,211,238,0.30)",
    bgGradient: "linear-gradient(135deg, rgba(34,211,238,0.08) 0%, rgba(34,211,238,0.02) 100%)",
    href: "/analysis",
  },
  {
    isNew: true,
    date: "2026/04/28",
    tag: "今日上线",
    title: "战略智库三档套餐",
    subtitle: "战略半月刊 · 半年订阅 · 尊享季度私人订制",
    desc: "全新战略智库产品线正式上线！战略半月刊单期 800 点（首购 720），半年订阅 6000 点（首购 5400），尊享季度私人订制 3000 点（首购 2700）。购买即享首购九折专属优惠。",
    pills: ["半月刊 800点", "半年订阅 6000点", "私人订制 3000点", "首购九折"],
    icon: Crown,
    accentColor: "#f5c842",
    glowColor: "rgba(245,200,80,0.20)",
    borderColor: "rgba(245,200,80,0.40)",
    bgGradient: "linear-gradient(135deg, rgba(245,200,80,0.10) 0%, rgba(200,160,0,0.04) 100%)",
    href: "/god-view",
  },
  {
    isNew: true,
    date: "2026/04/28",
    tag: "今日上线",
    title: "尊享季度私人订制",
    subtitle: "与历史数据深度对比 · 哈佛医师级二次进化分析",
    desc: "AI 自动调取您的历史分析快照，与当前课题进行「大洗牌」对比，输出专属战略升级方案。含10大可执行里程碑、竞争力雷达评分、四平台协同矩陣与完整数据表格。",
    pills: ["历史数据对比", "10大里程碑", "竞争力雷达", "3000点"],
    icon: Star,
    accentColor: "#f97316",
    glowColor: "rgba(249,115,22,0.20)",
    borderColor: "rgba(249,115,22,0.38)",
    bgGradient: "linear-gradient(135deg, rgba(249,115,22,0.10) 0%, rgba(249,115,22,0.03) 100%)",
    href: "/god-view",
  },
  {
    isNew: true,
    date: "2026/04/28",
    tag: "今日上线",
    title: "战报数据图表全面升级",
    subtitle: "强制输出真实数据表格 · 四平台对比矩陣 · 转化漏斗",
    desc: "每份战略报告现在强制包含：市场规模4年增速表、四平台CPM/月活对比、头部玩家变现模式解剖、商业转化漏斗转化率、90天里程碑量化目标。每章末附「数据速查」汇总表，所有数字均需真实可查。",
    pills: ["数据速查表", "平台对比矩阵", "转化漏斗", "里程碑量化"],
    icon: BarChart2,
    accentColor: "#34d399",
    glowColor: "rgba(52,211,153,0.18)",
    borderColor: "rgba(52,211,153,0.30)",
    bgGradient: "linear-gradient(135deg, rgba(52,211,153,0.08) 0%, rgba(52,211,153,0.02) 100%)",
    href: "/god-view",
  },
  {
    isNew: true,
    date: "2026/04/28",
    tag: "今日上线",
    title: "试读版 PDF 免费下载",
    subtitle: "战略半月刊 & 私人订制精华样本 · 全版水印保护",
    desc: "首页新增免费试读区！战略半月刊「医美赛道」样本与私人订制「知识博主」样本，含真实数据表格与部分精华内容，全版水印保护，一键打印保存为 PDF。",
    pills: ["免费试读", "真实数据表格", "PDF 下载", "水印保护"],
    icon: FileDown,
    accentColor: "#a78bfa",
    glowColor: "rgba(167,139,250,0.18)",
    borderColor: "rgba(167,139,250,0.30)",
    bgGradient: "linear-gradient(135deg, rgba(167,139,250,0.08) 0%, rgba(167,139,250,0.02) 100%)",
  },
  {
    isNew: true,
    date: "2026/04/28",
    tag: "今日上线",
    title: "我的战报快照库升级",
    subtitle: "封面图 + 灯塔标题 + 摘要 · 全新四栏卡片展示",
    desc: "「我的战报」全面升级！每份报告展示 AI 生成的艺术封面（3:4 比例）、灯塔标题、内容摘要与生成耗时，一键全息阅览或下载 Markdown 原文。",
    pills: ["艺术封面", "灯塔标题", "全息阅览", "Markdown 下载"],
    icon: BookOpen,
    accentColor: "#38bdf8",
    glowColor: "rgba(56,189,248,0.18)",
    borderColor: "rgba(56,189,248,0.28)",
    bgGradient: "linear-gradient(135deg, rgba(56,189,248,0.07) 0%, rgba(56,189,248,0.02) 100%)",
    href: "/my-reports",
  },
  {
    isNew: false,
    date: "2026/04/27",
    tag: "昨日上线",
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
    isNew: false,
    date: "2026/04/26",
    tag: "功能亮点",
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
    desc: "上传竞品或灵感碎片，AI 输出万字商业战略、精准选题库与导演级分镜；二创侧可逆向对标爆款逻辑，生成个人 IP 风格落地脚本。成长 / 二创双模式，PDF 一键下载。",
    pills: ["战略 + 二创一体", "商业拆解", "PDF 导出"],
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
    desc: "告别盲目自嗨。15/30 天窗口捕捉小红书、抖音、快手、B 站流量风向，AI 续问与趋势长图导出，支撑起号、发布与承接策略。",
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
    title: "大师级视频基地",
    subtitle: "脚本 · 分镜图 · 成片一条链",
    desc: "主链路：Gemini 3.1 Pro 生成脚本 → GPT-image-2 生成分镜图 → Seedance 2.0 生成影片。画布上可继续编排配乐、配音与合成；支持语音输入提示词。",
    pills: ["Gemini 3.1 Pro", "GPT-image-2", "Seedance 2.0"],
    icon: Clapperboard,
    accentColor: "#34d399",
    glowColor: "rgba(52,211,153,0.18)",
    borderColor: "rgba(52,211,153,0.28)",
    bgGradient: "linear-gradient(135deg, rgba(52,211,153,0.07) 0%, rgba(52,211,153,0.02) 100%)",
    href: "/workflow-nodes",
  },
];

const WORKFLOW_LINKS: { href: string; label: string }[] = [
  { href: "/creator-growth-camp", label: "成长营 · 二创" },
  { href: "/research", label: "竞品调研 · 60 点" },
  { href: "/creator-growth-camp/platform", label: "流量雷达" },
  { href: "/workflow-nodes", label: "大师级视频基地" },
  { href: "/creator-growth-camp/premium-remix", label: "爆款解构" },
];

function MergedGodResearchCard({ isMobile }: { isMobile: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: "stretch",
        borderRadius: 20,
        overflow: "hidden",
        border: "1px solid rgba(200,140,60,0.42)",
        boxShadow: "0 0 48px rgba(200,160,0,0.14)",
        marginBottom: 16,
      }}
    >
      <a
        href="/god-view"
        style={{
          flex: 1,
          textDecoration: "none",
          color: "inherit",
          display: "block",
          background: "linear-gradient(135deg, #0e0800 0%, #1a1000 50%, #0a0600 100%)",
          padding: "26px 26px 24px",
          borderRight: isMobile ? "none" : "1px solid rgba(255,255,255,0.08)",
          borderBottom: isMobile ? "1px solid rgba(255,255,255,0.08)" : "none",
          position: "relative",
          transition: "filter 0.2s",
        }}
      >
        <div style={{ position: "absolute", top: -50, right: -50, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(200,160,0,0.16) 0%, transparent 70%)", filter: "blur(28px)", pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: "linear-gradient(135deg,#c8a000,#7a5c00)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 22px rgba(200,160,0,0.38)", flexShrink: 0 }}>
            <Crown size={22} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontWeight: 900, color: "#0a0600", background: "linear-gradient(90deg,#f5c842,#c8a000)", borderRadius: 99, padding: "3px 10px", letterSpacing: "0.06em" }}>VIP · 算力巅峰</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(167,139,250,0.95)", background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 99, padding: "2px 8px" }}>800 点起</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(52,211,153,0.95)", background: "rgba(52,211,153,0.10)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: 99, padding: "2px 8px" }}>私订 3000</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(245,200,80,0.85)", background: "rgba(245,200,80,0.08)", border: "1px solid rgba(245,200,80,0.2)", borderRadius: 99, padding: "2px 8px" }}>首购九折</span>
            </div>
            <h3 style={{ fontSize: isMobile ? 19 : 21, fontWeight: 900, background: "linear-gradient(90deg,#f5c842,#ffd878,#c8a000)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", margin: "0 0 8px", letterSpacing: "-0.01em" }}>
              AI 上帝视角战略智库
            </h3>
            <p style={{ color: "rgba(245,218,150,0.62)", fontSize: 13, lineHeight: 1.7, margin: "0 0 12px" }}>
              半月刊 · 半年订阅 · 尊享私订：真实数据表与四平台对比矩阵。进入上帝视角页可<strong style={{ color: "#fb923c" }}>同屏使用内嵌竞品调研</strong>，一站完成战略 + 对标。
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {["宏观趋势", "变现拆解", "数据图表", "私域路径"].map((t) => (
                <span key={t} style={{ fontSize: 10, fontWeight: 700, color: "rgba(245,200,80,0.72)", background: "rgba(180,130,0,0.12)", border: "1px solid rgba(180,130,0,0.26)", borderRadius: 99, padding: "3px 10px" }}>{t}</span>
              ))}
              <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.38)", fontStyle: "italic" }}>异步 ≈15–20 分钟</span>
            </div>
            <div style={{ marginTop: 14, fontSize: 13, fontWeight: 800, color: "#f5c842" }}>进入智库 →</div>
          </div>
        </div>
      </a>

      <div
        style={{
          flex: 1,
          background: "linear-gradient(135deg, rgba(249,115,22,0.14) 0%, rgba(249,115,22,0.04) 100%)",
          padding: "26px 26px 24px",
          position: "relative",
        }}
      >
        <div style={{ position: "absolute", top: -40, right: -30, width: 180, height: 180, borderRadius: "50%", background: "rgba(249,115,22,0.12)", filter: "blur(50px)", pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: 14, background: "linear-gradient(135deg,#fb923c,#ea580c)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 22px rgba(249,115,22,0.35)", flexShrink: 0 }}>
            <Search size={22} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", color: "#fff", background: "linear-gradient(90deg,#f97316,#fb923c)", borderRadius: 6, padding: "3px 10px", boxShadow: "0 2px 8px rgba(249,115,22,0.45)" }}>NEW</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#fb923c", background: "rgba(249,115,22,0.15)", border: "1px solid rgba(249,115,22,0.35)", borderRadius: 99, padding: "2px 10px" }}>今日上线</span>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>2026/04/27</span>
            </div>
            <h3 style={{ fontSize: isMobile ? 19 : 21, fontWeight: 900, color: "#fff", margin: "0 0 6px", lineHeight: 1.25 }}>
              竞品与对标分析
            </h3>
            <p style={{ fontSize: 13, color: "#fb923c", margin: "0 0 10px", fontWeight: 600 }}>四平台实时库 · 双引擎战略处方 · 已汇入上帝视角</p>
            <p style={{ color: "rgba(255,255,255,0.58)", fontSize: 13, lineHeight: 1.65, margin: "0 0 12px" }}>
              小红书 / 抖音 / 快手 / B 站双引擎扫描，输出人设卡位、脚本与 30 天增长路径，单次 <strong style={{ color: "#fb923c" }}>60 点</strong>。
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {["小红书", "抖音", "B 站", "快手", "60 点/次"].map((p) => (
                <span key={p} style={{ fontSize: 11, fontWeight: 700, color: "#fb923c", background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.32)", borderRadius: 99, padding: "3px 10px" }}>{p}</span>
              ))}
            </div>
            <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
              <a href="/god-view" style={{ fontSize: 13, fontWeight: 800, color: "#fb923c", textDecoration: "none" }}>
                进入上帝视角（含调研）→
              </a>
              <a href="/research" style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.4)", textDecoration: "underline" }}>
                仅打开调研全屏页
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 通用卡片渲染 ────────────────────────────────────────────────────
function FeatureCard({
  card,
  onMouseEnter,
  onMouseLeave,
  compact = false,
  defaultDetailOpen = false,
}: {
  card: (typeof CAROUSEL_CARDS)[0] & { href?: string };
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  compact?: boolean;
  defaultDetailOpen?: boolean;
}) {
  const Icon = card.icon;
  const [detailOpen, setDetailOpen] = useState(defaultDetailOpen);
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        position: "relative",
        background: card.bgGradient,
        border: `1px solid ${card.borderColor}`,
        borderRadius: 20,
        boxShadow: hovered
          ? `0 18px 56px ${card.glowColor}, inset 0 0 40px ${card.glowColor.replace(/[\d.]+\)$/, "0.04)")}`
          : `0 0 48px ${card.glowColor}, inset 0 0 40px ${card.glowColor.replace(/[\d.]+\)$/, "0.04)")}`,
        padding: compact ? "24px 28px" : "32px 36px",
        overflow: "hidden",
        transition: "background 0.5s ease, border-color 0.5s ease, box-shadow 0.5s ease, transform 0.22s ease",
        transform: hovered ? "translateY(-6px)" : "translateY(0)",
      }}
      onMouseEnter={() => {
        setHovered(true);
        onMouseEnter?.();
      }}
      onMouseLeave={() => {
        setHovered(false);
        onMouseLeave?.();
      }}
    >
      <div style={{ position: "absolute", top: -60, right: -60, width: 200, height: 200, background: card.glowColor, borderRadius: "50%", filter: "blur(60px)", pointerEvents: "none" }} />

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", position: "relative" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => setDetailOpen((v) => !v)}
            style={{
              display: "block",
              width: "100%",
              background: "none",
              border: "none",
              padding: 0,
              margin: 0,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
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
              <span style={{ marginLeft: "auto", fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{detailOpen ? "▲ 收起说明" : "▼ 展开说明"}</span>
            </div>

            <h3 style={{ fontSize: compact ? 20 : 26, fontWeight: 900, color: "#fff", margin: "0 0 4px", lineHeight: 1.25, textShadow: card.isNew ? `0 0 24px ${card.accentColor}55` : "none" }}>
              {card.title}
            </h3>
            <p style={{ fontSize: 13, color: card.accentColor, margin: "0 0 12px", fontWeight: 600 }}>{card.subtitle}</p>
          </button>
          {detailOpen ? (
            <>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.75, margin: "0 0 16px", maxWidth: 520 }}>{card.desc}</p>

              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {card.pills.map((pill: string, i: number) => {
                  const isFlash = (card as { flashPills?: boolean }).flashPills && i < 3;
                  return (
                    <span key={i} style={{ fontSize: 12, color: isFlash ? "#fff" : card.accentColor, background: isFlash ? `linear-gradient(90deg,${card.accentColor}cc,${card.accentColor}88)` : card.glowColor, border: `1px solid ${isFlash ? card.accentColor : card.borderColor}`, borderRadius: 99, padding: "4px 12px", fontWeight: 700, boxShadow: isFlash ? `0 0 10px ${card.accentColor}66` : "none", animation: isFlash ? `mvsp-flash-pill 1.6s ease-in-out ${i * 0.25}s infinite` : "none" }}>
                      {pill}
                    </span>
                  );
                })}
              </div>

              {"href" in card && card.href && (
                <a href={card.href} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 16, fontSize: 13, fontWeight: 700, color: card.accentColor, background: card.glowColor, border: `1px solid ${card.borderColor}`, borderRadius: 10, padding: "8px 18px", textDecoration: "none", transition: "opacity 0.2s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.75"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                >
                  立即体验 →
                </a>
              )}
            </>
          ) : null}
        </div>

        <div style={{ flexShrink: 0, width: compact ? 72 : 96, height: compact ? 72 : 96, borderRadius: 20, background: `linear-gradient(135deg,${card.glowColor.replace(/[\d.]+\)$/, "0.3)")},${card.glowColor.replace(/[\d.]+\)$/, "0.08)")})`, border: `1px solid ${card.borderColor}`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 8px 32px ${card.glowColor}` }}>
          <Icon size={compact ? 32 : 42} color={card.accentColor} />
        </div>
      </div>
    </div>
  );
}

// ─── 主组件 ──────────────────────────────────────────────────────────
export default function HomeFeatureCarousel() {
  const isMobile = useIsMobile();
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
  const tickerItems = [...HOME_CHANGELOG_UPDATES, ...HOME_CHANGELOG_UPDATES];

  return (
    <section style={{ width: "100%", padding: "0 0 48px" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", color: "#fb923c", background: "rgba(251,146,60,0.12)", border: "1px solid rgba(251,146,60,0.3)", borderRadius: 99, padding: "3px 12px", textTransform: "uppercase" }}>
            旗舰入口
          </span>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>战略智库与竞品调研 · 桌面端横排浏览</span>
        </div>

        <MergedGodResearchCard isMobile={isMobile} />

        <div
          style={{
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            flexWrap: "wrap",
            alignItems: isMobile ? "stretch" : "center",
            gap: isMobile ? 10 : 12,
            marginBottom: 22,
            padding: "14px 18px",
            borderRadius: 16,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.45)", marginRight: isMobile ? 0 : 4 }}>创作工作流</span>
          {WORKFLOW_LINKS.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#a78bfa",
                textDecoration: "none",
                padding: "6px 12px",
                borderRadius: 99,
                border: "1px solid rgba(167,139,250,0.25)",
                background: "rgba(167,139,250,0.06)",
                transition: "background 0.2s",
              }}
            >
              {label}
            </a>
          ))}
        </div>

        <div style={{
          border: "1px solid rgba(139,92,246,0.35)",
          borderRadius: 20,
          background: "rgba(139,92,246,0.04)",
          boxShadow: "0 0 40px rgba(139,92,246,0.08), inset 0 0 60px rgba(139,92,246,0.03)",
          overflow: "hidden",
        }}>
          <div style={{ padding: "22px 24px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Clock size={18} color="#a78bfa" />
              <span style={{ fontSize: 17, fontWeight: 800, color: "#fff", letterSpacing: 0.5 }}>更新日志 & 功能动态</span>
            </div>
            <span style={{ fontSize: 12, color: "rgba(167,139,250,0.6)", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 99, padding: "3px 12px" }}>持续迭代中</span>
          </div>

          <div style={{
            overflow: "hidden",
            background: "rgba(255,255,255,0.025)",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            padding: "12px 0",
          }}>
            <div className="mvsp-home-ticker-track" style={{ display: "flex", whiteSpace: "nowrap", gap: 0 }}>
              {tickerItems.map((item, i) => {
                const tc = HOME_UPDATE_TAG_COLORS[item.tag] ?? HOME_UPDATE_TAG_COLORS["新功能"];
                return (
                  <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "0 32px" }}>
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", fontVariantNumeric: "tabular-nums" }}>{item.date}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", background: tc.bg, color: tc.text, borderRadius: 4, padding: "2px 7px" }}>{item.tag}</span>
                    <span style={{ fontSize: 15, color: "rgba(255,255,255,0.7)" }}>{item.text}</span>
                    <span style={{ color: "rgba(255,255,255,0.12)", fontSize: 20, marginLeft: 8 }}>·</span>
                  </span>
                );
              })}
            </div>
          </div>

          <div style={{ padding: "20px 24px 24px", position: "relative" }}>
            <FeatureCard
              card={card}
              onMouseEnter={() => setIsPaused(true)}
              onMouseLeave={() => setIsPaused(false)}
              compact
            />
            {[{ dir: "left" as const, fn: prev, Icon: ChevronLeft }, { dir: "right" as const, fn: next, Icon: ChevronRight }].map(({ dir, fn, Icon: Ico }) => (
              <button
                key={dir}
                type="button"
                onClick={fn}
                style={{ position: "absolute", [dir]: 14, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.5)", transition: "background 0.2s,color 0.2s" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "#fff"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}
              >
                <Ico size={15} />
              </button>
            ))}
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 14 }}>
              {CAROUSEL_CARDS.map((c, i) => (
                <button key={i} type="button" onClick={() => setCurrent(i)} style={{ border: "none", cursor: "pointer", padding: 0, width: i === current ? 24 : 7, height: 7, borderRadius: 99, background: i === current ? c.accentColor : "rgba(255,255,255,0.15)", boxShadow: i === current ? `0 0 8px ${c.accentColor}88` : "none", transition: "all 0.3s ease" }} />
              ))}
            </div>
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
