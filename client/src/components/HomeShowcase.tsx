import React from "react";

const items = [
  ["机甲守护者", "Kling 3.0", "免费试用带水印"],
  ["未来城市追逐", "Veo 3.1", "免费试用带水印"],
  ["雷电网球", "Nano Banana Pro", "免费试用带水印"],
  ["深海女王", "Kling 3.0", "免费试用带水印"],
  ["森林秘境", "Kling 2.6", "免费试用带水印"],
  ["霓虹歌手", "Veo 3.1", "免费试用带水印"],
];

export default function HomeShowcase() {
  return (
    <section style={{ maxWidth: 1240, margin: "0 auto", padding: "44px 20px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end" }}>
        <div>
          <div style={{ color: "white", fontSize: 34, fontWeight: 900 }}>精选作品</div>
          <div style={{ marginTop: 8, color: "rgba(255,255,255,0.68)" }}>
            第一眼先看作品，再进入“重新创作”工作流
          </div>
        </div>
        <div style={{ color: "#ff9b75", fontWeight: 800 }}>作品展示 · Showcase</div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,minmax(0,1fr))",
          gap: 18,
          marginTop: 22,
        }}
      >
        {items.map(([title, model, tag], i) => (
          <div
            key={title}
            style={{
              borderRadius: 22,
              overflow: "hidden",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              position: "relative",
            }}
          >
            <div
              style={{
                aspectRatio: "16 / 10",
                background:
                  i % 3 === 0
                    ? "linear-gradient(135deg,#1d4ed8,#7c3aed)"
                    : i % 3 === 1
                    ? "linear-gradient(135deg,#7c2d12,#db2777)"
                    : "linear-gradient(135deg,#164e63,#9333ea)",
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 14,
                  top: 14,
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: "rgba(8,8,16,0.48)",
                  color: "white",
                  fontSize: 11,
                  fontWeight: 800,
                }}
              >
                {tag}
              </div>
              <div
                style={{
                  position: "absolute",
                  right: 12,
                  bottom: 12,
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: "rgba(8,8,16,0.48)",
                  color: "white",
                  fontSize: 11,
                  fontWeight: 800,
                }}
              >
                动态水印 / 图片双水印
              </div>
            </div>

            <div style={{ padding: 16 }}>
              <div style={{ color: "white", fontSize: 20, fontWeight: 900 }}>{title}</div>
              <div style={{ marginTop: 6, color: "rgba(255,255,255,0.65)" }}>{model}</div>
              <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                <button
                  style={{
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,138,91,0.40)",
                    background: "rgba(255,138,91,0.12)",
                    color: "white",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  重新创作
                </button>
                <button
                  style={{
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.04)",
                    color: "white",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  查看工作流
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
