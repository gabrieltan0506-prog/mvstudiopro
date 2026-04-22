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
  { zh: "创作者成长营", en: "Creator Growth Camp", desc: "上传视频或图文，生成商业战略、爆款选题与导演级分镜，GROWTH / REMIX 双模式", price: "内测功能", pro: true, href: "/creator-growth-camp" },
  { zh: "平台趋势分析", en: "Platform Trend Analysis", desc: "小红书、抖音、B站、快手平台数据洞察，含 7 天发布计划与流量承接建议", price: "内测功能", pro: true, href: "/creator-growth-camp/platform" },
  { zh: "节点式工作流", en: "Workflow Nodes", desc: "可视化节点画布，串接分镜生成、AI 影片、BGM 与发布动作，一键执行完整创作流程", price: "内测功能", pro: true, href: "/workflow-nodes" },
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
          gridTemplateColumns: "repeat(3,minmax(0,1fr))",
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
