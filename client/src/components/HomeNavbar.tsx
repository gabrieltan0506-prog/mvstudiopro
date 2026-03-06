import React from "react";

export default function HomeNavbar() {
  const nav = [
    ["可灵工作室", "Kling Studio"],
    ["虚拟艺人工坊", "Actor Studio"],
    ["分镜工作流", "Storyboard Workflow"],
    ["作品展示", "Showcase"],
    ["我的创作", "My Creations"],
    ["套餐中心", "Plans"],
  ];

  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        backdropFilter: "blur(16px)",
        background: "rgba(10,8,20,0.72)",
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
          gap: 20,
        }}
      >
        <div style={{ fontSize: 26, fontWeight: 900, color: "white" }}>MV Studio <span style={{ color: "#ff8a5b" }}>Pro</span></div>

        <nav style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
          {nav.map(([zh, en]) => (
            <a
              key={zh}
              href="#"
              style={{
                color: "white",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: 14,
                opacity: 0.92,
                display: "grid",
                lineHeight: 1.2,
              }}
            >
              <span>{zh}</span>
              <span style={{ fontSize: 10, opacity: 0.55 }}>{en}</span>
            </a>
          ))}
        </nav>

        <button
          style={{
            padding: "10px 16px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "linear-gradient(135deg,#ff8a5b,#ff4fb3)",
            color: "white",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          登录
        </button>
      </div>
    </header>
  );
}
