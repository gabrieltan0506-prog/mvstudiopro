import { useState } from "react";
import {
  Zap, BarChart2, Clapperboard, Sparkles, ImagePlay,
  Mic2, FolderOpen, Gift, ChevronRight, Clock, CheckCircle2,
} from "lucide-react";

// ─── 更新日誌數據 ────────────────────────────────────────────────────
const UPDATES = [
  { date: "04/26", tag: "新功能", text: "語音輸入上線 — 說話即輸入 prompt，支援中文語音識別" },
  { date: "04/26", tag: "修復", text: "管理後台統計數據正確顯示，supervisor 帳號現可查看用戶數與活躍度" },
  { date: "04/26", tag: "新功能", text: "我的作品 — 分析快照生成可查看 URL，保存完整摘要" },
  { date: "04/26", tag: "新功能", text: "邀請碼申請表上線，填寫用途與聯絡方式可申請內測資格" },
  { date: "04/25", tag: "優化", text: "首頁文案升級為利益驅動型，內測階段重點突出核心殺手級功能" },
  { date: "04/25", tag: "安全", text: "Debug 面板對一般用戶完全隱藏，僅管理員可見切換開關" },
  { date: "04/25", tag: "修復", text: "兌換邀請碼後積分實時更新，修復 REST API 快取導致的積分顯示錯誤" },
  { date: "04/25", tag: "新功能", text: "平台分析頁支援管理員邀請碼生成，無需跳轉後台" },
  { date: "04/24", tag: "修復", text: "OTP 郵件發送成功，使用 Resend HTTP API 繞過 SMTP 端口封鎖" },
  { date: "04/24", tag: "新功能", text: "我的作品頁面上線，導航欄與首頁均可直達" },
  { date: "04/24", tag: "優化", text: "分析頁面隱藏 AI 模型名稱，保護核心技術架構不外洩" },
];

// ─── 殺手級功能模塊 ───────────────────────────────────────────────────
const MODULES = [
  {
    icon: Zap,
    color: "#a78bfa",
    glow: "rgba(167,139,250,0.25)",
    border: "rgba(167,139,250,0.2)",
    badge: "IP 戰略指揮室",
    href: "/creator-growth-camp",
    killer: "10 秒拆解爆款 DNA",
    desc: "上傳任意競品視頻，AI 輸出萬字商業戰略 + 爆款選題庫 + 導演級分鏡，直接可執行。",
    bullets: ["成長型 / 二創雙模式分析", "平台評分 + 商業邏輯拆解", "PDF 報告一鍵下載存檔"],
  },
  {
    icon: BarChart2,
    color: "#38bdf8",
    glow: "rgba(56,189,248,0.2)",
    border: "rgba(56,189,248,0.18)",
    badge: "全網流量雷達",
    href: "/creator-growth-camp/platform",
    killer: "實時爆款趨勢雷達",
    desc: "15/30 天數據窗口，捕捉小紅書、抖音等主流平台最新流量風向，量身定制起號計劃。",
    bullets: ["多平台實時熱榜追蹤", "AI 續問對話分析", "趨勢長圖一鍵導出"],
  },
  {
    icon: Clapperboard,
    color: "#34d399",
    glow: "rgba(52,211,153,0.18)",
    border: "rgba(52,211,153,0.18)",
    badge: "工業級全自動產線",
    href: "/workflow-nodes",
    killer: "從想法到成片全自動",
    desc: "可視化節點串聯 AI 腳本 → Veo 分鏡 → Suno 配樂 → 語音合成，點擊執行坐等成片。",
    bullets: ["拖拽式節點編排", "語音輸入 prompt", "Kling 高清視頻生成"],
  },
  {
    icon: Sparkles,
    color: "#fb923c",
    glow: "rgba(251,146,60,0.18)",
    border: "rgba(251,146,60,0.18)",
    badge: "爆款解構引擎",
    href: "/creator-growth-camp/premium-remix",
    killer: "一鍵二創不撞款",
    desc: "輸入對標爆款，精準拆解底層爆火邏輯，重塑為帶你個人 IP 風格的獨家落地腳本。",
    bullets: ["底層邏輯逆向工程", "個人 IP 風格融合", "可執行創作 Brief"],
  },
  {
    icon: ImagePlay,
    color: "#f472b6",
    glow: "rgba(244,114,182,0.18)",
    border: "rgba(244,114,182,0.18)",
    badge: "Kling AI 創作室",
    href: "/kling-studio",
    killer: "文字秒出高質感參考圖",
    desc: "輸入提示詞，生成電影感參考圖 + 高清放大，或直接生成創意視頻，所見即所得。",
    bullets: ["Flux / SDXL 多模型選擇", "Vertex AI 超清 4× 放大", "圖生視頻一鍵創作"],
  },
  {
    icon: Mic2,
    color: "#c084fc",
    glow: "rgba(192,132,252,0.18)",
    border: "rgba(192,132,252,0.18)",
    badge: "AI 音樂 & 音頻",
    href: "/workflow-nodes",
    killer: "一句話生成原創配樂",
    desc: "Suno AI 描述曲風即生成專屬配樂，音頻分析提取節奏數據，工作流自動對齊視頻節拍。",
    bullets: ["中英文歌詞創作", "多風格音樂生成", "自動節拍對齊"],
  },
];

const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  新功能: { bg: "rgba(167,139,250,0.15)", text: "#c4b5fd" },
  修復:   { bg: "rgba(52,211,153,0.12)",  text: "#6ee7b7" },
  優化:   { bg: "rgba(56,189,248,0.12)",  text: "#7dd3fc" },
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

      {/* ── 標題列 ── */}
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 24px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Clock size={18} color="#a78bfa" />
            <span style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: 0.5 }}>
              更新日誌 & 功能導覽
            </span>
          </div>
          <span style={{ fontSize: 12, color: "rgba(167,139,250,0.6)", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 99, padding: "3px 12px" }}>
            持續迭代中
          </span>
        </div>
      </div>

      {/* ── 滾動更新跑馬燈 ── */}
      <div style={{
        width: "100%", overflow: "hidden",
        background: "rgba(255,255,255,0.025)",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        padding: "10px 0", marginBottom: 40,
      }}>
        <div className="mvsp-ticker-track" style={{ gap: 0 }}>
          {tickerItems.map((item, i) => {
            const tc = TAG_COLORS[item.tag] ?? TAG_COLORS["新功能"];
            return (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "0 28px" }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", fontVariantNumeric: "tabular-nums" }}>
                  {item.date}
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                  background: tc.bg, color: tc.text,
                  borderRadius: 4, padding: "1px 6px",
                }}>
                  {item.tag}
                </span>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,0.65)" }}>{item.text}</span>
                <span style={{ color: "rgba(255,255,255,0.1)", fontSize: 18, marginLeft: 6 }}>·</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* ── 功能模塊卡片 ── */}
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
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
                  {/* 頂部：圖標 + Badge */}
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

                  {/* 殺手級功能標題 */}
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: "#fff", lineHeight: 1.35, marginBottom: 6 }}>
                      {mod.killer}
                    </div>
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.65 }}>
                      {mod.desc}
                    </div>
                  </div>

                  {/* 功能要點 */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: "auto" }}>
                    {mod.bullets.map((b, bi) => (
                      <div key={bi} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <CheckCircle2 size={12} color={mod.color} style={{ flexShrink: 0, opacity: 0.8 }} />
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{b}</span>
                      </div>
                    ))}
                  </div>

                  {/* 進入連結 */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 4,
                    fontSize: 12, fontWeight: 600,
                    color: isActive ? mod.color : "rgba(255,255,255,0.25)",
                    transition: "color 0.2s", marginTop: 4,
                  }}>
                    立即體驗 <ChevronRight size={13} />
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
