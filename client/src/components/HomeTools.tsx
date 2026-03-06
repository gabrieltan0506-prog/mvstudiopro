import React from "react";

const cards = [
  ["可灵工作室", "Kling Studio", "图像 / 视频 / Motion Control / Lip Sync"],
  ["虚拟艺人工坊", "Actor Studio", "上传人物图，生成场景与视频"],
  ["分镜工作流", "Storyboard Workflow", "脚本 → 分镜 → 图像 → 视频"],
  ["AI 音乐工坊", "AI Music Studio", "Suno / Udio 配乐生成"],
  ["爆款分析师", "Viral Analyst", "内容优缺点分析与优化方向"],
  ["我的创作", "My Creations", "作品、任务、历史记录统一管理"],
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
        {cards.map(([zh, en, desc], idx) => (
          <div
            key={zh}
            style={{
              padding: 22,
              borderRadius: 22,
              background:
                idx === 0
                  ? "linear-gradient(135deg, rgba(91,33,182,0.35), rgba(255,79,179,0.18))"
                  : "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))",
              border: idx === 0 ? "1px solid rgba(255,138,91,0.36)" : "1px solid rgba(255,255,255,0.08)",
              boxShadow: idx === 0 ? "0 12px 36px rgba(255,79,179,0.10)" : "none",
            }}
          >
            <div style={{ color: "white", fontSize: 22, fontWeight: 900 }}>{zh}</div>
            <div style={{ marginTop: 4, color: "rgba(255,255,255,0.48)", fontSize: 12 }}>{en}</div>
            <div style={{ marginTop: 14, color: "rgba(255,255,255,0.78)", lineHeight: 1.65 }}>{desc}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
