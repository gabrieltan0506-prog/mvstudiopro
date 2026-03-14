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
  { zh: "可灵工作室", en: "Kling Studio", desc: "图像 / 视频 / Motion Control / Lip Sync", price: "10 积分起", pro: false, href: "/remix" },
  { zh: "虚拟艺人工坊", en: "Actor Studio", desc: "上传人物图，生成场景与视频", price: "15 积分起", pro: false, href: "/actor" },
  { zh: "分镜工作流", en: "Storyboard Workflow", desc: "脚本 → 分镜 → 图像 → 视频", price: "20 积分起", pro: false, href: "/workflow" },
  { zh: "AI 音乐工坊", en: "AI Music Studio", desc: "Suno / Udio 配乐生成", price: "5 积分起", pro: false, href: "/remix" },
  { zh: "創作商業成長營", en: "Creator Growth Camp", desc: "上传内容，一键生成增长策略、商业洞察与平台建议", price: "Pro 功能", pro: true, href: "/creator-growth-camp" },
  { zh: "我的创作", en: "My Creations", desc: "作品、任务、历史记录统一管理", price: "免费", pro: false, href: "/my" },
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
                  ? "linear-gradient(135deg, rgba(124,58,237,0.32), rgba(255,79,179,0.16))"
                  : idx === 0
                  ? "linear-gradient(135deg, rgba(91,33,182,0.35), rgba(255,79,179,0.18))"
                  : "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))",
              border:
                pro
                  ? "1px solid rgba(255,79,179,0.40)"
                  : idx === 0
                  ? "1px solid rgba(255,138,91,0.36)"
                  : "1px solid rgba(255,255,255,0.08)",
              boxShadow: pro ? "0 14px 40px rgba(236,72,153,0.10)" : "none",
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
                  color: "#ff9b75",
                  fontSize: 11,
                  fontWeight: 900,
                }}
              >
                高价值功能
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
