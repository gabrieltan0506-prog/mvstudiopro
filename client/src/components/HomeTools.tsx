import React from "react";

const cards = [
  ["可灵工作室", "Kling Studio", "图像 / 视频 / Motion Control / Lip Sync", "10 积分起", false],
  ["虚拟艺人工坊", "Actor Studio", "上传人物图，生成场景与视频", "15 积分起", false],
  ["分镜工作流", "Storyboard Workflow", "脚本 → 分镜 → 图像 → 视频", "20 积分起", false],
  ["AI 音乐工坊", "AI Music Studio", "Suno / Udio 配乐生成", "5 积分起", false],
  ["爆款分析师", "Viral Analyst", "免费试用每日 3 次，付费解锁优化方案", "Pro 功能", true],
  ["我的创作", "My Creations", "作品、任务、历史记录统一管理", "免费", false],
];

export default function HomeTools() {
  return (
    <section style={{ maxWidth: 1240, margin: "0 auto", padding: "42px 20px 0" }}>
      <div style={{ color: "white", fontSize: 34, fontWeight: 900 }}>AI 创作工具</div>
      <div style={{ marginTop: 8, color: "rgba(255,255,255,0.68)" }}>围绕真实创作工作流设计的核心模块</div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,minmax(0,1fr))",
          gap: 18,
          marginTop: 22,
        }}
      >
        {cards.map(([zh, en, desc, price, pro], idx) => (
          <div
            key={zh}
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
          </div>
        ))}
      </div>
    </section>
  );
}
