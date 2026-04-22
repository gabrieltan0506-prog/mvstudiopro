import React from "react";

const nav = [
  ["首页", "Home", "/"],
  ["成长营", "Growth Camp", "/creator-growth-camp"],
  ["平台趋势", "Platform", "/creator-growth-camp/platform"],
  ["节点工作流", "Workflow", "/workflow-nodes"],
];

export default function HomeNavbar() {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        backdropFilter: "blur(16px)",
        background: "rgba(10,8,20,0.70)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 18,
          flexWrap: "wrap",
        }}
      >
        <a href="/" style={{ textDecoration: "none" }}>
          <div style={{ fontSize: 26, fontWeight: 900, color: "white" }}>
            MV Studio <span style={{ color: "#ff8a5b" }}>Pro</span>
          </div>
        </a>

        <nav
          style={{
            display: "flex",
            gap: 18,
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {nav.map(([zh, en, href]) => (
            <a
              key={zh}
              href={href}
              style={{
                color: "white",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: 14,
                opacity: 0.92,
                display: "grid",
                lineHeight: 1.2,
                textAlign: "center",
              }}
            >
              <span>{zh}</span>
              <span style={{ fontSize: 10, opacity: 0.55 }}>{en}</span>
            </a>
          ))}
        </nav>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <a
            href="/login"
            style={{
              padding: "10px 16px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "linear-gradient(135deg,#ff8a5b,#ff4fb3)",
              color: "white",
              fontWeight: 900,
              cursor: "pointer",
              textDecoration: "none",
            }}
          >
            登录
          </a>
        </div>
      </div>
    </header>
  );
}
