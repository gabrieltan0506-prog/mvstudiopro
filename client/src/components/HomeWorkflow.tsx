import React from "react";

const steps = [
  ["脚本", "Gemini"],
  ["分镜", "Storyboard"],
  ["图像生成", "Nano Banana / Kling Image"],
  ["视频生成", "Veo / Kling"],
  ["音乐", "Suno / Udio"],
  ["最终视频", "Final Video"],
];

export default function HomeWorkflow() {
  return (
    <section style={{ maxWidth: 1240, margin: "0 auto", padding: "44px 20px 0" }}>
      <div style={{ color: "white", fontSize: 34, fontWeight: 900 }}>AI 工作流</div>
      <div style={{ marginTop: 8, color: "rgba(255,255,255,0.68)" }}>从灵感到成片，用统一工作流串起图像、视频与音乐</div>

      <div
        style={{
          marginTop: 22,
          borderRadius: 24,
          padding: 24,
          background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))",
          border: "1px solid rgba(255,255,255,0.08)",
          display: "grid",
          gridTemplateColumns: "repeat(6,minmax(0,1fr))",
          gap: 14,
          alignItems: "center",
        }}
      >
        {steps.map(([zh, en], i) => (
          <React.Fragment key={zh}>
            <div
              style={{
                padding: 16,
                borderRadius: 18,
                background: i === steps.length - 1 ? "linear-gradient(135deg,#8b5cf6,#ff4fb3)" : "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                minHeight: 110,
              }}
            >
              <div style={{ color: "white", fontSize: 18, fontWeight: 900 }}>{zh}</div>
              <div style={{ marginTop: 6, color: "rgba(255,255,255,0.58)", fontSize: 12 }}>{en}</div>
            </div>
          </React.Fragment>
        ))}
      </div>
    </section>
  );
}
