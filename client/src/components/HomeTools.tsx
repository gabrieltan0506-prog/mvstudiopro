import React from "react";

type ToolCard = {
  zh: string;
  en: string;
  desc: string;
  price: string;
  pro: boolean;
  href: string;
};

const cards: ToolCard[] = [
  {
    zh: "成长营 · 二创中心",
    en: "Growth Camp + REMIX",
    desc: "创作者成长营与二创中心合并入口：既可做商业级增长分析（GROWTH），也可走爆款解构与分镜级二创（REMIX）。",
    price: "公测功能",
    pro: true,
    href: "/creator-growth-camp",
  },
  {
    zh: "竞品分析调研",
    en: "Competitor Research",
    desc: "四平台双引擎竞品扫描，输出人设卡位、脚本、视觉与 30 天增长路径。",
    price: "60 点/次",
    pro: true,
    href: "/research",
  },
  {
    zh: "AI 上帝视角",
    en: "Strategic Think Tank",
    desc: "旗舰级深度研报：半月刊、半年订阅与私人订制，含数据表与四平台对比矩阵。",
    price: "800 点起",
    pro: true,
    href: "/god-view",
  },
  {
    zh: "全网流量雷达",
    en: "Trend Radar",
    desc: "实时捕捉小红书、抖音、快手、B 站等主流平台流量风向，AI 续问与趋势导出。",
    price: "公测功能",
    pro: true,
    href: "/creator-growth-camp/platform",
  },
];

export default function HomeTools() {
  return (
    <section style={{ maxWidth: 1240, margin: "0 auto", padding: "42px 20px 0" }}>
      <div style={{ color: "white", fontSize: 34, fontWeight: 900 }}>AI 创作工具</div>
      <div style={{ marginTop: 8, color: "rgba(255,255,255,0.68)" }}>围绕真实创作工作流设计的核心模块</div>

      <div
        className="home-tools-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 18,
          marginTop: 22,
        }}
      >
        {cards.map(({ zh, en, desc, price, pro, href }, idx) => (
          <a
            key={zh}
            href={href}
            style={{
              padding: 22,
              borderRadius: 24,
              background:
                pro
                  ? "radial-gradient(circle at top left, rgba(255,138,61,0.3), transparent 35%), linear-gradient(135deg, rgba(17,33,58,0.96), rgba(12,18,32,0.96))"
                  : idx === 0
                    ? "linear-gradient(135deg, rgba(91,33,182,0.35), rgba(255,79,179,0.18))"
                    : "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))",
              border:
                pro
                  ? "1px solid rgba(255,179,127,0.34)"
                  : idx === 0
                    ? "1px solid rgba(255,138,91,0.36)"
                    : "1px solid rgba(255,255,255,0.08)",
              boxShadow: pro ? "0 18px 42px rgba(255,138,61,0.12)" : "none",
              position: "relative",
              textDecoration: "none",
              transition: "transform 0.2s ease, box-shadow 0.2s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(-4px)";
              (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 22px 48px rgba(0,0,0,0.35)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.transform = "none";
              (e.currentTarget as HTMLAnchorElement).style.boxShadow = pro ? "0 18px 42px rgba(255,138,61,0.12)" : "none";
            }}
          >
            {pro ? (
              <div
                style={{
                  position: "absolute",
                  right: 16,
                  top: 16,
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.08)",
                  color: "#ffb37f",
                  fontSize: 11,
                  fontWeight: 900,
                }}
              >
                增长主线
              </div>
            ) : null}

            <div style={{ color: "white", fontSize: 22, fontWeight: 900 }}>{zh}</div>
            <div style={{ marginTop: 4, color: "rgba(255,255,255,0.48)", fontSize: 12 }}>{en}</div>
            <div style={{ marginTop: 14, color: "rgba(255,255,255,0.78)", lineHeight: 1.65 }}>{desc}</div>

            <div
              style={{
                marginTop: 18,
                display: "inline-flex",
                padding: "8px 12px",
                borderRadius: 999,
                background: "rgba(255,138,91,0.12)",
                border: "1px solid rgba(255,138,91,0.20)",
                color: "#ffb08b",
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              {price}
            </div>
          </a>
        ))}
      </div>

      <style>{`
        @media (max-width: 980px) {
          .home-tools-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
