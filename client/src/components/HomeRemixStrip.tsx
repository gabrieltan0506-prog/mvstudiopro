import React from "react";

/** 成长营与二创中心合并入口（单行主卡 + 双 CTA） */
export default function HomeRemixStrip() {
  return (
    <section style={{ maxWidth: 1240, margin: "0 auto", padding: "16px 20px 0" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "stretch",
          gap: 12,
          padding: "18px 22px",
          borderRadius: 18,
          background:
            "linear-gradient(120deg, rgba(139,92,246,0.20), rgba(244,114,182,0.16), rgba(251,146,60,0.12))",
          border: "1px solid rgba(167,139,250,0.45)",
          boxShadow: "0 12px 40px rgba(139,92,246,0.12)",
        }}
      >
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span
              style={{
                padding: "6px 12px",
                borderRadius: 12,
                background: "rgba(0,0,0,0.28)",
                border: "1px solid rgba(255,255,255,0.12)",
                fontWeight: 900,
                fontSize: 13,
                color: "#e9d5ff",
              }}
            >
              成长营 · 二创
            </span>
            <span style={{ fontWeight: 900, fontSize: 16, color: "white" }}>一条入口，两种打法</span>
          </div>
          <p style={{ marginTop: 8, fontSize: 13, color: "rgba(255,255,255,0.72)", lineHeight: 1.6 }}>
            左侧进成长营做结构化增长诊断；右侧直达二创中心完成 remix 级脚本与分镜落地。
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <a
            href="/creator-growth-camp"
            style={{
              padding: "12px 18px",
              borderRadius: 12,
              background: "linear-gradient(135deg,#8b5cf6,#6366f1)",
              color: "white",
              fontWeight: 900,
              fontSize: 14,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            进入成长营 →
          </a>
          <a
            href="/creator-growth-camp/premium-remix"
            style={{
              padding: "12px 18px",
              borderRadius: 12,
              background: "rgba(255,255,255,0.10)",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "white",
              fontWeight: 900,
              fontSize: 14,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            二创中心 REMIX →
          </a>
        </div>
      </div>
    </section>
  );
}
