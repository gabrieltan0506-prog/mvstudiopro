import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";

const FEATURES = [
  {
    icon: "🎬",
    title: "结构拆解",
    desc: "AI 自动拆解参考视频的镜头结构、叙事逻辑与视觉节奏，秒速提炼可复用框架",
  },
  {
    icon: "📝",
    title: "选题与分镜执行",
    desc: "基于拆解结果生成差异化选题方向，配合分镜脚本与场景提示词一键输出",
  },
  {
    icon: "🖼️",
    title: "图·文·视频皆可",
    desc: "上传图片、文章或视频链接，多模态理解全面支持二次创作",
  },
  {
    icon: "⚡",
    title: "一键生成分镜",
    desc: "执行指引直达导演工作流，场景图像、配乐、字幕一站式完成",
  },
];

export default function RemixLanding() {
  const [, navigate] = useLocation();
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    if (!loading && isAuthenticated) {
      navigate("/creator-growth-camp", { replace: true });
    }
  }, [loading, isAuthenticated, navigate]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0814",
        }}
      />
    );
  }

  if (isAuthenticated) return null;

  return (
    <div
      style={{
        minHeight: "100dvh",
        background:
          "radial-gradient(circle at 20% 20%, rgba(244,114,182,0.14), transparent 35%), radial-gradient(circle at 80% 60%, rgba(139,92,246,0.15), transparent 35%), linear-gradient(180deg,#0a0814 0%,#0a0d1f 60%,#090915 100%)",
        color: "#f7f4ef",
        fontFamily: "system-ui,sans-serif",
      }}
    >
      {/* 顶部导航 */}
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 32px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <a
          href="/"
          style={{
            fontWeight: 900,
            fontSize: 18,
            color: "#f7f4ef",
            textDecoration: "none",
            letterSpacing: 0.4,
          }}
        >
          MV Studio Pro
        </a>
        <div style={{ display: "flex", gap: 12 }}>
          <a
            href="/login"
            style={{
              padding: "9px 20px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.2)",
              color: "#f7f4ef",
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            登录
          </a>
          <a
            href="/login"
            style={{
              padding: "9px 20px",
              borderRadius: 12,
              background: "linear-gradient(120deg,#f472b6,#a78bfa)",
              color: "#fff",
              textDecoration: "none",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            免费注册
          </a>
        </div>
      </nav>

      {/* Hero */}
      <div
        style={{
          maxWidth: 860,
          margin: "0 auto",
          padding: "72px 24px 48px",
          textAlign: "center",
        }}
      >
        <span
          style={{
            display: "inline-block",
            padding: "5px 16px",
            borderRadius: 999,
            background: "rgba(244,114,182,0.15)",
            border: "1px solid rgba(244,114,182,0.4)",
            color: "#fda4af",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 0.6,
            marginBottom: 24,
          }}
        >
          二次创作中心 · REMIX
        </span>

        <h1
          style={{
            fontSize: "clamp(32px,5vw,56px)",
            fontWeight: 900,
            lineHeight: 1.2,
            margin: "0 0 20px",
            background: "linear-gradient(120deg,#f9a8d4,#c084fc,#93c5fd)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          看到好视频
          <br />
          AI 帮你拆解、再创作
        </h1>

        <p
          style={{
            fontSize: 17,
            color: "rgba(255,255,255,0.68)",
            lineHeight: 1.7,
            maxWidth: 560,
            margin: "0 auto 40px",
          }}
        >
          上传图片、文章或视频，AI 实时拆解叙事结构与镜头节奏，
          生成差异化选题方向与完整分镜脚本——直达导演工作流。
        </p>

        <a
          href="/login"
          style={{
            display: "inline-block",
            padding: "16px 40px",
            borderRadius: 18,
            background: "linear-gradient(120deg,#f472b6,#a78bfa 60%,#60a5fa)",
            color: "#fff",
            textDecoration: "none",
            fontWeight: 900,
            fontSize: 17,
            boxShadow: "0 12px 40px rgba(244,114,182,0.30)",
            letterSpacing: 0.3,
          }}
        >
          立即登录，开始二创 →
        </a>
        <div style={{ marginTop: 14, fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
          注册即送免费积分，无需绑卡
        </div>
      </div>

      {/* 功能卡片 */}
      <div
        style={{
          maxWidth: 960,
          margin: "0 auto",
          padding: "0 24px 80px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))",
          gap: 18,
        }}
      >
        {FEATURES.map((f) => (
          <div
            key={f.title}
            style={{
              padding: "24px 22px",
              borderRadius: 20,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 12 }}>{f.icon}</div>
            <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8 }}>{f.title}</div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.58)", lineHeight: 1.6 }}>
              {f.desc}
            </div>
          </div>
        ))}
      </div>

      {/* 底部 CTA */}
      <div
        style={{
          maxWidth: 700,
          margin: "0 auto",
          padding: "0 24px 80px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            padding: "40px 32px",
            borderRadius: 24,
            background: "linear-gradient(135deg,rgba(244,114,182,0.12),rgba(139,92,246,0.10))",
            border: "1px solid rgba(244,114,182,0.25)",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 22, marginBottom: 12 }}>
            已有帐号？直接开始
          </div>
          <div
            style={{ fontSize: 14, color: "rgba(255,255,255,0.56)", marginBottom: 24 }}
          >
            登录后即可使用完整二创工作流，积分消耗详见定价页
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <a
              href="/login"
              style={{
                padding: "12px 28px",
                borderRadius: 14,
                background: "linear-gradient(120deg,#f472b6,#a78bfa)",
                color: "#fff",
                textDecoration: "none",
                fontWeight: 800,
                fontSize: 15,
              }}
            >
              登录帐号
            </a>
            <a
              href="/pricing"
              style={{
                padding: "12px 28px",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.2)",
                color: "#f7f4ef",
                textDecoration: "none",
                fontWeight: 700,
                fontSize: 15,
              }}
            >
              查看定价
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
