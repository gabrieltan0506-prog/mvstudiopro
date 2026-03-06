import React from "react";

const thumbs = [
  "太空站观景台",
  "未来机甲",
  "雷电网球",
  "霓虹都市",
  "森林秘境",
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
          borderRadius: 32,
          padding: 24,
          background:
            "radial-gradient(circle at 12% 10%, rgba(168,85,247,0.24), transparent 22%), radial-gradient(circle at 88% 12%, rgba(236,72,153,0.20), transparent 22%), linear-gradient(135deg, rgba(10,12,30,0.96), rgba(8,9,20,0.98))",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.28fr 0.72fr",
            gap: 24,
            alignItems: "stretch",
          }}
        >
          <div>
            <div
              style={{
                aspectRatio: "16 / 9",
                borderRadius: 26,
                background:
                  "linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.32)), url('https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=1600&auto=format&fit=crop') center/cover",
                border: "1px solid rgba(255,255,255,0.10)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "radial-gradient(circle at center, rgba(255,255,255,0.02), transparent 30%), linear-gradient(180deg, rgba(0,0,0,0.06), rgba(0,0,0,0.34))",
                }}
              />

              <div
                style={{
                  position: "absolute",
                  top: 18,
                  left: 18,
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                {["可灵 3.0", "Veo 3.1", "Nano Banana Pro"].map((tag) => (
                  <span
                    key={tag}
                    style={{
                      padding: "7px 10px",
                      borderRadius: 999,
                      background: "rgba(8,8,16,0.48)",
                      border: "1px solid rgba(255,255,255,0.10)",
                      color: "white",
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div
                style={{
                  position: "absolute",
                  right: 18,
                  top: 18,
                  padding: "8px 12px",
                  borderRadius: 999,
                  background: "rgba(8,8,12,0.55)",
                  color: "white",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                精选轮播
              </div>

              <div
                style={{
                  position: "absolute",
                  left: 24,
                  right: 24,
                  bottom: 24,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "end",
                  gap: 16,
                }}
              >
                <div style={{ color: "white" }}>
                  <div style={{ fontSize: 13, color: "#ff9b75", fontWeight: 800 }}>本周推荐作品</div>
                  <div style={{ fontSize: 34, fontWeight: 900, marginTop: 6 }}>太空站观景台</div>
                  <div style={{ marginTop: 8, fontSize: 14, opacity: 0.84 }}>
                    先看结果，再一键重新创作
                  </div>
                </div>

                <button
                  style={{
                    padding: "12px 18px",
                    borderRadius: 14,
                    border: "1px solid rgba(255,138,91,0.38)",
                    background: "rgba(255,138,91,0.14)",
                    color: "white",
                    fontWeight: 900,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  重新创作
                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 14, overflowX: "auto", paddingBottom: 2 }}>
              {thumbs.map((t, i) => (
                <div
                  key={t}
                  style={{
                    minWidth: 136,
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

          <div
            style={{
              borderRadius: 26,
              background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))",
              border: "1px solid rgba(255,255,255,0.08)",
              padding: 24,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div
                style={{
                  display: "inline-flex",
                  padding: "8px 12px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.05)",
                  color: "#ff9b75",
                  fontWeight: 800,
                  fontSize: 12,
                }}
              >
                AI 创作平台
              </div>

              <div style={{ fontSize: 42, fontWeight: 900, lineHeight: 1.12, color: "white", marginTop: 18 }}>
                一站式完成
                <br />
                图像、视频、音乐与分析
              </div>

              <div style={{ marginTop: 16, color: "rgba(255,255,255,0.78)", lineHeight: 1.75, fontSize: 15 }}>
                围绕创作者工作流设计：可灵工作室、虚拟艺人工坊、分镜工作流、爆款分析师。
              </div>

              <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
                {[
                  "可灵工作室：图像 / 视频 / Motion Control / Lip Sync",
                  "虚拟艺人工坊：人物上传 → 场景 → 视频",
                  "爆款分析师：免费试用，付费解锁优化方案",
                ].map((line) => (
                  <div
                    key={line}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 14,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      color: "rgba(255,255,255,0.86)",
                      fontSize: 14,
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
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
