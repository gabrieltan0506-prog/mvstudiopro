import React from "react";

const items = [
  ["机甲守护者", "Kling 3.0", "重新创作"],
  ["未来城市追逐", "Veo 3.1", "重新创作"],
  ["雷电网球", "Nano Banana Pro", "重新创作"],
  ["深海女王", "Kling 3.0", "重新创作"],
  ["森林秘境", "Kling 2.6", "重新创作"],
  ["霓虹歌手", "Veo 3.1", "重新创作"],
];

export default function HomeShowcase() {
  return (
    <section style={{ maxWidth: 1240, margin: "0 auto", padding: "44px 20px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end" }}>
        <div>
          <div style={{ color: "white", fontSize: 34, fontWeight: 900 }}>精选作品</div>
          <div style={{ marginTop: 8, color: "rgba(255,255,255,0.68)" }}>第一眼先看结果，再一键重新创作</div>
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
        {items.map(([title, model, btn], i) => (
          <div
            key={title}
            style={{
              borderRadius: 20,
              overflow: "hidden",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
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
              }}
            />
            <div style={{ padding: 16 }}>
              <div style={{ color: "white", fontSize: 20, fontWeight: 900 }}>{title}</div>
              <div style={{ marginTop: 6, color: "rgba(255,255,255,0.65)" }}>{model}</div>
              <button
                style={{
                  marginTop: 14,
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,138,91,0.40)",
                  background: "rgba(255,138,91,0.12)",
                  color: "white",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                {btn}
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
