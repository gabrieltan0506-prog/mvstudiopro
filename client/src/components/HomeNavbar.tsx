import React, { useState, useRef, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";

const nav = [
  ["首页", "Home", "/"],
  ["成长营", "Growth Camp", "/creator-growth-camp"],
  ["平台趋势", "Platform", "/creator-growth-camp/platform"],
  ["节点工作流", "Workflow", "/workflow-nodes"],
];

export default function HomeNavbar() {
  const { user, isAuthenticated, loading, logout } = useAuth({ autoFetch: true });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const isSupervisor = user?.role === "supervisor" || user?.role === "admin";
  const emailPrefix = user?.email ? user.email.split("@")[0] : null;
  const displayName = isSupervisor
    ? (user?.role === "admin" ? "Admin" : "Supervisor")
    : emailPrefix || user?.name || "用户";
  const avatarLetter = isSupervisor ? "S" : displayName.charAt(0).toUpperCase();

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
          {isAuthenticated && user ? (
            <a
              href="/dashboard"
              style={{
                color: "#e9d5ff",
                textDecoration: "none",
                fontWeight: 800,
                fontSize: 14,
                display: "grid",
                lineHeight: 1.2,
                textAlign: "center",
                padding: "4px 10px",
                borderRadius: 12,
                background: "rgba(139,92,246,0.22)",
                border: "1px solid rgba(167,139,250,0.35)",
              }}
            >
              <span>个人中心</span>
              <span style={{ fontSize: 10, opacity: 0.75 }}>Dashboard</span>
            </a>
          ) : null}
        </nav>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {loading ? (
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
                animation: "pulse 1.5s infinite",
              }}
            />
          ) : isAuthenticated && user ? (
            <div ref={menuRef} style={{ position: "relative" }}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 14,
                }}
              >
                <span
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 999,
                    background: "linear-gradient(135deg,#8b5cf6,#ff4fb3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 900,
                    flexShrink: 0,
                  }}
                >
                  {avatarLetter}
                </span>
                <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {displayName}
                </span>
                <span style={{ fontSize: 10, opacity: 0.5 }}>{menuOpen ? "▲" : "▼"}</span>
              </button>

              {menuOpen && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "calc(100% + 8px)",
                    minWidth: 180,
                    borderRadius: 14,
                    background: "rgba(15,12,28,0.97)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
                    overflow: "hidden",
                    zIndex: 100,
                  }}
                >
                  <div
                    style={{
                      padding: "12px 14px",
                      borderBottom: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", marginBottom: 2 }}>已登录</div>
                    <div style={{ fontSize: 13, color: "white", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {isSupervisor ? displayName : (user.email || displayName)}
                    </div>
                    {user.credits != null && (
                      <div style={{ marginTop: 4, fontSize: 11, color: "rgba(255,185,100,0.9)" }}>
                        積分：{user.credits}
                      </div>
                    )}
                  </div>

                  <a
                    href="/dashboard"
                    style={{ display: "block", padding: "11px 14px", color: "white", fontSize: 13, textDecoration: "none", fontWeight: 800, background: "rgba(139,92,246,0.15)" }}
                    onClick={() => setMenuOpen(false)}
                  >
                    个人中心
                  </a>
                  <a
                    href="/creator-growth-camp"
                    style={{ display: "block", padding: "11px 14px", color: "rgba(255,255,255,0.82)", fontSize: 13, textDecoration: "none", fontWeight: 600 }}
                    onClick={() => setMenuOpen(false)}
                  >
                    进入成长营
                  </a>
                  <a
                    href="/creator-growth-camp/platform"
                    style={{ display: "block", padding: "11px 14px", color: "rgba(255,255,255,0.82)", fontSize: 13, textDecoration: "none", fontWeight: 600 }}
                    onClick={() => setMenuOpen(false)}
                  >
                    平台趨勢分析
                  </a>
                  <a
                    href="/workflow-nodes"
                    style={{ display: "block", padding: "11px 14px", color: "rgba(255,255,255,0.82)", fontSize: 13, textDecoration: "none", fontWeight: 600 }}
                    onClick={() => setMenuOpen(false)}
                  >
                    节点工作流
                  </a>

                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                    <button
                      onClick={async () => { setMenuOpen(false); await logout(); window.location.href = "/"; }}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "11px 14px",
                        background: "transparent",
                        border: "none",
                        color: "rgba(255,100,100,0.85)",
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      登出
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
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
          )}
        </div>
      </div>
    </header>
  );
}
