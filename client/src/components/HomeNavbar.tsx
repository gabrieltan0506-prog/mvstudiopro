import React, { useState, useRef, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useIsBelowXl } from "@/hooks/useMobile";
import { Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const nav = [
  ["首页", "Home", "/"],
  ["成长营", "Growth Camp", "/creator-growth-camp"],
  ["平台趋势", "Platform", "/creator-growth-camp/platform"],
  ["节点工作流", "Workflow", "/workflow-nodes"],
];

export default function HomeNavbar() {
  const { user, isAuthenticated, loading, logout } = useAuth({ autoFetch: true });
  const isBelowXl = useIsBelowXl();
  const [menuOpen, setMenuOpen] = useState(false); // desktop dropdown
  const [sheetOpen, setSheetOpen] = useState(false); // mobile drawer
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

  const isSupervisor = user?.role === "supervisor";
  const isAdmin = user?.role === "admin";
  const displayName = isAdmin
    ? "Admin"
    : isSupervisor
    ? "Supervisor"
    : user?.name || "用户";
  const avatarLetter = (isAdmin || isSupervisor) ? "S" : displayName.charAt(0).toUpperCase();

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
          padding: isBelowXl ? "12px 16px" : "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: isBelowXl ? 12 : 18,
          flexWrap: isBelowXl ? "nowrap" : "wrap",
        }}
      >
        <a href="/" style={{ textDecoration: "none" }}>
          <div style={{ fontSize: isBelowXl ? 22 : 26, fontWeight: 900, color: "white" }}>
            MV Studio <span style={{ color: "#ff8a5b" }}>Pro</span>
          </div>
        </a>

        {isBelowXl ? (
          // ─── 移动分支 (< 1280px)：汉堡 + Sheet 右侧抽屉 ───
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label={sheetOpen ? "关闭菜单" : "打开菜单"}
                aria-expanded={sheetOpen}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 44,
                  minHeight: 44,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                <Menu size={20} />
              </button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-[85vw] sm:max-w-sm flex flex-col p-0 border-l-0 text-white"
              style={{
                background: "rgba(15,12,28,0.97)",
                backdropFilter: "blur(16px)",
              }}
            >
              <SheetTitle className="sr-only">主菜单</SheetTitle>
              <SheetDescription className="sr-only">站点导航与用户操作</SheetDescription>

              {/* 顶部品牌 + 用户卡 */}
              <div
                style={{
                  padding: "20px 18px 16px",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 900,
                    color: "white",
                    marginBottom: isAuthenticated || loading ? 14 : 0,
                  }}
                >
                  MV Studio <span style={{ color: "#ff8a5b" }}>Pro</span>
                </div>
                {loading ? (
                  <div
                    style={{
                      width: "100%",
                      height: 36,
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.08)",
                      animation: "pulse 1.5s infinite",
                    }}
                  />
                ) : isAuthenticated && user ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 999,
                        background: "linear-gradient(135deg,#8b5cf6,#ff4fb3)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 14,
                        fontWeight: 900,
                        flexShrink: 0,
                      }}
                    >
                      {avatarLetter}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {displayName}
                      </div>
                      {user.credits != null && (
                        <div style={{ fontSize: 11, color: "rgba(255,185,100,0.9)" }}>
                          积分：{user.credits}
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              {/* 导航 */}
              <nav style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
                {nav.map(([zh, en, href]) => (
                  <a
                    key={zh}
                    href={href}
                    onClick={() => setSheetOpen(false)}
                    className="min-h-11"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "12px 14px",
                      borderRadius: 10,
                      color: "white",
                      textDecoration: "none",
                      fontWeight: 700,
                      fontSize: 14,
                      gap: 10,
                    }}
                  >
                    <span style={{ flex: 1 }}>{zh}</span>
                    <span style={{ fontSize: 11, opacity: 0.55 }}>{en}</span>
                  </a>
                ))}

                {isAuthenticated && user && (
                  <>
                    <div
                      style={{
                        height: 1,
                        background: "rgba(255,255,255,0.08)",
                        margin: "8px 4px",
                      }}
                    />
                    <a
                      href="/dashboard"
                      onClick={() => setSheetOpen(false)}
                      className="min-h-11"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "12px 14px",
                        borderRadius: 10,
                        color: "#e9d5ff",
                        textDecoration: "none",
                        fontWeight: 800,
                        fontSize: 14,
                        background: "rgba(139,92,246,0.18)",
                        border: "1px solid rgba(167,139,250,0.30)",
                      }}
                    >
                      个人中心 · Dashboard
                    </a>
                    <a
                      href="/my-works"
                      onClick={() => setSheetOpen(false)}
                      className="min-h-11"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "12px 14px",
                        borderRadius: 10,
                        color: "rgba(255,255,255,0.92)",
                        textDecoration: "none",
                        fontWeight: 700,
                        fontSize: 14,
                        marginTop: 4,
                      }}
                    >
                      📁 我的作品
                    </a>
                  </>
                )}
              </nav>

              {/* 底部：登录 / 退出 */}
              <div
                style={{
                  padding: "12px 14px 16px",
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                {loading ? null : isAuthenticated && user ? (
                  <button
                    onClick={async () => {
                      setSheetOpen(false);
                      await logout();
                      window.location.href = "/";
                    }}
                    className="min-h-11"
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      borderRadius: 10,
                      background: "transparent",
                      border: "1px solid rgba(255,100,100,0.25)",
                      color: "rgba(255,100,100,0.95)",
                      fontSize: 14,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    退出登录
                  </button>
                ) : (
                  <a
                    href="/login"
                    onClick={() => setSheetOpen(false)}
                    className="min-h-11"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "12px 16px",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "linear-gradient(135deg,#ff8a5b,#ff4fb3)",
                      color: "white",
                      fontWeight: 900,
                      textDecoration: "none",
                      fontSize: 14,
                    }}
                  >
                    登录
                  </a>
                )}
              </div>
            </SheetContent>
          </Sheet>
        ) : (
          // ─── 桌面分支 (≥ 1280px)：保留原 inline style 不动 ───
          <>
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
                          {displayName}
                        </div>
                        {user.credits != null && (
                          <div style={{ marginTop: 4, fontSize: 11, color: "rgba(255,185,100,0.9)" }}>
                            积分：{user.credits}
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
                        href="/my-works"
                        style={{ display: "block", padding: "11px 14px", color: "rgba(255,255,255,0.9)", fontSize: 13, textDecoration: "none", fontWeight: 700, background: "rgba(99,102,241,0.12)" }}
                        onClick={() => setMenuOpen(false)}
                      >
                        📁 我的作品
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
                        平台趋势分析
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
                          退出登录
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
          </>
        )}
      </div>
    </header>
  );
}
