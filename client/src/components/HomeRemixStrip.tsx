import React from "react";

/** 強化「二創中心」入口可見性（獨立一條，避免被大圖輪播擠到視野外） */
export default function HomeRemixStrip() {
  return (
    <section style={{ maxWidth: 1240, margin: "0 auto", padding: "16px 20px 0" }}>
      <a
        href="/creator-growth-camp/premium-remix"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "16px 22px",
          borderRadius: 18,
          textDecoration: "none",
          color: "white",
          background:
            "linear-gradient(120deg, rgba(244,114,182,0.22), rgba(251,146,60,0.14), rgba(139,92,246,0.12))",
          border: "1px solid rgba(244,114,182,0.45)",
          boxShadow: "0 12px 40px rgba(244,114,182,0.12)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <span
            style={{
              flexShrink: 0,
              padding: "8px 12px",
              borderRadius: 12,
              background: "rgba(0,0,0,0.25)",
              border: "1px solid rgba(255,255,255,0.12)",
              fontWeight: 900,
              fontSize: 15,
              color: "#fda4af",
            }}
          >
            二创中心
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: 0.2 }}>二次创作中心 · REMIX</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", marginTop: 4, lineHeight: 1.5 }}>
              图、文、视频素材皆可：结构拆解、选题与分镜级执行指引
            </div>
          </div>
        </div>
        <span
          style={{
            flexShrink: 0,
            padding: "10px 18px",
            borderRadius: 12,
            background: "rgba(255,255,255,0.12)",
            border: "1px solid rgba(255,255,255,0.2)",
            fontWeight: 900,
            fontSize: 14,
          }}
        >
          进入二创中心 →
        </span>
      </a>
    </section>
  );
}
