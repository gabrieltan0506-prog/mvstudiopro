import React from "react";

const thumbs = [
  "太空站观景台",
  "科幻城市追逐",
  "雷电网球",
  "森林精灵",
  "未来机甲",
];

export default function HomeHero() {
  return (
    <section
      style={{
        maxWidth: 1240,
        margin: "0 auto",
        padding: "28px 20px 0",
      }}
    >
      <div
        style={{
          borderRadius: 28,
          padding: 24,
          background:
            "radial-gradient(circle at top left, rgba(123,63,255,0.35), transparent 28%), radial-gradient(circle at top right, rgba(255,79,179,0.28), transparent 26%), linear-gradient(180deg, rgba(17,13,32,0.95), rgba(7,8,18,0.96))",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.2fr 0.8fr",
            gap: 24,
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                aspectRatio: "16 / 9",
                borderRadius: 22,
                background:
                  "linear-gradient(135deg, rgba(99,102,241,0.3), rgba(236,72,153,0.18)), url('https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=1600&auto=format&fit=crop') center/cover",
                border: "1px solid rgba(255,255,255,0.10)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "linear-gradient(180deg, rgba(0,0,0,0.08), rgba(0,0,0,0.38))",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  right: 20,
                  top: 20,
                  padding: "8px 12px",
                  borderRadius: 999,
                  background: "rgba(8,8,12,0.55)",
                  color: "white",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                正在播放
              </div>
              <div
                style={{
                  position: "absolute",
                  left: 24,
                  bottom: 24,
                  color: "white",
                }}
              >
                <div style={{ fontSize: 13, color: "#ff9b75", fontWeight: 800 }}>精选作品</div>
                <div style={{ fontSize: 34, fontWeight: 900, marginTop: 6 }}>太空站观景台</div>
                <div style={{ marginTop: 8, fontSize: 14, opacity: 0.86 }}>由 Veo 3.1 / Kling / Nano Banana 驱动的高质量创作入口</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 14, overflowX: "auto" }}>
              {thumbs.map((t, i) => (
                <div
                  key={t}
                  style={{
                    minWidth: 132,
                    padding: 10,
                    borderRadius: 14,
                    background: i === 0 ? "rgba(255,138,91,0.18)" : "rgba(255,255,255,0.05)",
                    border: i === 0 ? "1px solid rgba(255,138,91,0.55)" : "1px solid rgba(255,255,255,0.08)",
                    color: "white",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {t}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div
              style={{
                display: "inline-flex",
                padding: "8px 12px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.06)",
                color: "#ff9b75",
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              AI 创作平台
            </div>

            <div style={{ fontSize: 54, fontWeight: 900, lineHeight: 1.05, color: "white", marginTop: 18 }}>
              让创作、分析、再创作
              <br />
              <span style={{ color: "#ff8a5b" }}>在一个工作流里完成</span>
            </div>

            <div style={{ marginTop: 16, color: "rgba(255,255,255,0.80)", lineHeight: 1.7, fontSize: 15 }}>
              可灵工作室、虚拟艺人工坊、分镜工作流、爆款分析师，全部围绕真实创作者工作流设计。
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
              <button
                style={{
                  padding: "14px 20px",
                  borderRadius: 14,
                  border: "none",
                  background: "linear-gradient(135deg,#8b5cf6,#ff4fb3)",
                  color: "white",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                开始创作
              </button>
              <button
                style={{
                  padding: "14px 20px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                  color: "white",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                浏览作品
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
