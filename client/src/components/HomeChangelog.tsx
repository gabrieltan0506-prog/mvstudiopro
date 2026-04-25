import { useState } from "react";
import {
  Zap, BarChart2, Clapperboard, Sparkles,
  ChevronRight, Clock, CheckCircle2,
} from "lucide-react";

// ─── 更新日志数据（仅展示用户可感知的功能更新）────────────────────
const UPDATES = [
  { date: "04/26", tag: "新功能", text: "语音输入上线 — 说话即可输入提示词，支持中文识别，告别手动打字" },
  { date: "04/26", tag: "新功能", text: "我的作品 — 每次分析自动生成专属查看页，附带复制链接功能" },
  { date: "04/26", tag: "新功能", text: "内测邀请码申请表上线，填写用途与联系方式即可提交申请" },
  { date: "04/25", tag: "优化",   text: "兑换邀请码后积分实时刷新，不再需要重新登录" },
  { date: "04/25", tag: "优化",   text: "首页全面焕新，聚焦四大核心功能亮点，简洁直达" },
  { date: "04/24", tag: "修复",   text: "验证邮件稳定送达，登录体验全面优化" },
  { date: "04/24", tag: "新功能", text: "我的作品页面上线，所有分析记录一览无余" },
  { date: "04/24", tag: "优化",   text: "分析报告展示升级，核心洞察更突出，视觉更清晰" },
];

// ─── 杀手级功能模块 ───────────────────────────────────────────────────
const MODULES = [
  {
    icon: Zap,
    color: "#a78bfa",
    glow: "rgba(167,139,250,0.25)",
    border: "rgba(167,139,250,0.2)",
    badge: "IP 战略指挥室",
    href: "/creator-growth-camp",
    killer: "10 秒拆解爆款 DNA",
    desc: "上传任意竞品视频，AI 输出万字商业战略 + 爆款选题库 + 导演级分镜，直接可执行。",
    bullets: ["成长型 / 二创双模式分析", "平台评分 + 商业逻辑拆解", "PDF 报告一键下载存档"],
  },
  {
    icon: BarChart2,
    color: "#38bdf8",
    glow: "rgba(56,189,248,0.2)",
    border: "rgba(56,189,248,0.18)",
    badge: "全网流量雷达",
    href: "/creator-growth-camp/platform",
    killer: "实时爆款趋势雷达",
    desc: "15/30 天数据窗口，捕捉小红书、抖音等主流平台最新流量风向，量身定制起号计划。",
    bullets: ["多平台实时热榜追踪", "AI 续问对话分析", "趋势长图一键导出"],
  },
  {
    icon: Clapperboard,
    color: "#34d399",
    glow: "rgba(52,211,153,0.18)",
    border: "rgba(52,211,153,0.18)",
    badge: "影视级全自动产线",
    href: "/workflow-nodes",
    killer: "从想法到成片全自动",
    desc: "可视化节点串联脚本生成、分镜规划、配乐合成、语音合成，点击执行坐等成片。",
    bullets: ["拖拽式节点编排", "语音输入提示词", "高清视频自动生成"],
  },
  {
    icon: Sparkles,
    color: "#fb923c",
    glow: "rgba(251,146,60,0.18)",
    border: "rgba(251,146,60,0.18)",
    badge: "爆款解构引擎",
    href: "/creator-growth-camp/premium-remix",
    killer: "一键二创不撞款",
    desc: "输入对标爆款，精准拆解底层爆火逻辑，重塑为带你个人 IP 风格的独家落地脚本。",
    bullets: ["底层逻辑逆向工程", "个人 IP 风格融合", "可执行创作 Brief"],
  },
];

const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  新功能: { bg: "rgba(167,139,250,0.15)", text: "#c4b5fd" },
  修复:   { bg: "rgba(52,211,153,0.12)",  text: "#6ee7b7" },
  优化:   { bg: "rgba(56,189,248,0.12)",  text: "#7dd3fc" },
  安全:   { bg: "rgba(251,146,60,0.12)",  text: "#fdba74" },
};

// Inline ticker animation via <style>
const TICKER_STYLE = `
@keyframes mvsp-ticker {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
.mvsp-ticker-track {
  display: flex;
  white-space: nowrap;
  animation: mvsp-ticker 40s linear infinite;
}
.mvsp-ticker-track:hover { animation-play-state: paused; }
`;

export default function HomeChangelog() {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  // Duplicate items for seamless loop
  const tickerItems = [...UPDATES, ...UPDATES];

  return (
    <section style={{ width: "100%", padding: "0 0 64px" }}>
      <style>{TICKER_STYLE}</style>

      {/* ── 高亮边框容器 ── */}
      <div style={{
        maxWidth: 1120,
        margin: "0 auto",
        padding: "0 24px",
      }}>
        <div style={{
          border: "1px solid rgba(139,92,246,0.35)",
          borderRadius: 20,
          background: "rgba(139,92,246,0.04)",
          boxShadow: "0 0 40px rgba(139,92,246,0.08), inset 0 0 60px rgba(139,92,246,0.03)",
          overflow: "hidden",
          padding: "28px 0 28px",
        }}>

        {/* ── 标题列 ── */}
        <div style={{ padding: "0 28px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Clock size={18} color="#a78bfa" />
              <span style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: 0.5 }}>
                更新日志 & 功能导览
              </span>
            </div>
            <span style={{ fontSize: 12, color: "rgba(167,139,250,0.6)", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 99, padding: "3px 12px" }}>
              持续迭代中
            </span>
          </div>
        </div>

        {/* ── 滚动更新跑马灯 ── */}
        <div style={{
          overflow: "hidden",
          background: "rgba(255,255,255,0.025)",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          padding: "12px 0", marginBottom: 28,
        }}>
          <div className="mvsp-ticker-track" style={{ gap: 0 }}>
            {tickerItems.map((item, i) => {
              const tc = TAG_COLORS[item.tag] ?? TAG_COLORS["新功能"];
              return (
                <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "0 32px" }}>
                  <span style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", fontVariantNumeric: "tabular-nums" }}>
                    {item.date}
                  </span>
                  <span style={{
                    fontSize: 12, fontWeight: 700, letterSpacing: "0.08em",
                    background: tc.bg, color: tc.text,
                    borderRadius: 4, padding: "2px 7px",
                  }}>
                    {item.tag}
                  </span>
                  <span style={{ fontSize: 15, color: "rgba(255,255,255,0.7)" }}>{item.text}</span>
                  <span style={{ color: "rgba(255,255,255,0.12)", fontSize: 20, marginLeft: 8 }}>·</span>
                </span>
              );
            })}
          </div>
        </div>

        {/* ── 功能模块卡片 ── */}
        <div style={{ padding: "0 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(440px, 1fr))", gap: 16 }}>
          {MODULES.map((mod, idx) => {
            const Icon = mod.icon;
            const isActive = activeIdx === idx;
            return (
              <a
                key={idx}
                href={mod.href}
                style={{ textDecoration: "none" }}
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseLeave={() => setActiveIdx(null)}
              >
                <div style={{
                  background: isActive
                    ? `linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.03) 100%)`
                    : "rgba(255,255,255,0.03)",
                  border: `1px solid ${isActive ? mod.border.replace("0.2", "0.45") : mod.border}`,
                  borderRadius: 16,
                  padding: "20px 22px 18px",
                  transition: "all 0.2s ease",
                  transform: isActive ? "translateY(-3px)" : "none",
                  boxShadow: isActive ? `0 8px 32px ${mod.glow}` : "none",
                  cursor: "pointer",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}>
                  {/* 顶部：图标 + Badge */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 10,
                      background: `linear-gradient(135deg, ${mod.glow.replace("0.2", "0.35")}, ${mod.glow.replace("0.2", "0.1")})`,
                      border: `1px solid ${mod.border}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Icon size={20} color={mod.color} />
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 700, letterSpacing: "0.06em",
                      color: mod.color, background: mod.glow,
                      border: `1px solid ${mod.border}`,
                      borderRadius: 99, padding: "3px 10px",
                    }}>
                      {mod.badge}
                    </span>
                  </div>

                  {/* 杀手级功能标题 */}
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: "#fff", lineHeight: 1.35, marginBottom: 6 }}>
                      {mod.killer}
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.65 }}>
                      {mod.desc}
                    </div>
                  </div>

                  {/* 功能要点 */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: "auto" }}>
                    {mod.bullets.map((b, bi) => (
                      <div key={bi} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <CheckCircle2 size={12} color={mod.color} style={{ flexShrink: 0, opacity: 0.8 }} />
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{b}</span>
                      </div>
                    ))}
                  </div>

                  {/* 进入连结 */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 4,
                    fontSize: 12, fontWeight: 600,
                    color: isActive ? mod.color : "rgba(255,255,255,0.25)",
                    transition: "color 0.2s", marginTop: 4,
                  }}>
                    立即体验 <ChevronRight size={13} />
                  </div>
                </div>
              </a>
            );
          })}
        </div>
        </div>{/* 功能卡片 padding */}
        </div>{/* 高亮边框 */}
      </div>{/* 外层 maxWidth */}
    </section>
  );
}
