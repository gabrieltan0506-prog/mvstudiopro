import React, { useEffect, useState } from "react";
import FloatingVideoWatermark from "./FloatingVideoWatermark";
import { useAuth } from "../_core/hooks/useAuth";

const slides = [
  {
    title: "雷电网球",
    subtitle: "职业女子网球比赛的关键瞬间",
    model: "Kling 3.0",
    videoUrl: "/migrated/home/video1.mp4",
    poster: "/migrated/home/poster1.jpg",
    prompt: "职业女子网球比赛的关键瞬间，网球选手腾空击球，球拍与网球接触时爆发蓝色电弧能量轨迹，观众席沸腾欢呼，夕阳逆光照射球场，强烈动感与速度感，电影级体育广告画面，超高细节，动态运动模糊，8K cinematic lighting"
  },
  {
    title: "海洋女神",
    subtitle: "史诗奇幻海洋场景",
    model: "Veo 3.1 Pro",
    videoUrl: "/migrated/home/video2.mp4",
    poster: "/migrated/home/poster2.jpg",
    prompt: "神秘海洋女神从海浪中升起，巨大的海浪在她身后形成弧形水幕，身体由水与光构成，蓝绿色能量粒子在周围漂浮，夕阳穿透海浪形成神圣光束，史诗奇幻风格，电影级光影，超高细节，幻想史诗场景"
  },
  {
    title: "秘境森林",
    subtitle: "古代森林神庙遗迹",
    model: "Veo 3.1 Pro",
    videoUrl: "/migrated/home/video3.mp4",
    poster: "/migrated/home/poster3.jpg",
    prompt: "被遗忘的古代森林神庙遗迹，巨大的石柱与藤蔓缠绕的神殿入口，发光的蓝绿色植物沿着石柱延伸，清晨阳光穿透森林形成体积光，神秘而宁静的奇幻氛围，电影级构图，超高细节，史诗探险场景"
  },
  {
    title: "太空站观景台",
    subtitle: "未来太空站内部观景大厅",
    model: "Veo 3.1 Pro",
    videoUrl: "/migrated/home/video4.mp4",
    poster: "/migrated/home/poster4.jpg",
    prompt: "未来太空站内部观景大厅，巨大弧形全景玻璃窗俯瞰地球与银河，极光在地球上空闪耀，一艘宇宙飞船从窗外掠过，空间站内部有植物与高科技控制台，温暖金色灯光与深空背景形成强烈对比，电影级科幻场景，超高细节"
  }
];

export default function HomeHero() {
  const { isAuthenticated } = useAuth({ autoFetch: true });
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx((v) => (v + 1) % slides.length), 5500);
    return () => clearInterval(t);
  }, []);

  const slide = slides[idx];

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
          className="home-hero-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1.28fr) minmax(320px,0.72fr)",
            gap: 24,
            alignItems: "stretch",
          }}
        >
          <div>
            <div
              style={{
                aspectRatio: "16 / 9",
                borderRadius: 26,
                border: "1px solid rgba(255,255,255,0.10)",
                position: "relative",
                overflow: "hidden",
                background: "#090909",
              }}
            >
              <video
                key={slide.videoUrl}
                src={slide.videoUrl}
                poster={slide.poster}
                autoPlay
                muted
                loop
                playsInline
                controls={false}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                }}
              />
              <FloatingVideoWatermark enabled text="Powered by mvstudiopro.com" />

              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.34))",
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
                {slide.model}
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
                  flexWrap: "wrap",
                }}
              >
                <div style={{ color: "white" }}>
                  <div style={{ fontSize: 13, color: "#ff9b75", fontWeight: 800 }}>{slide.subtitle}</div>
                  <div style={{ fontSize: 34, fontWeight: 900, marginTop: 6 }}>{slide.title}</div>
                  <div style={{ marginTop: 8, fontSize: 14, opacity: 0.84 }}>
                    先看结果，再进入重新创作工作流
                  </div>
                </div>

                <a
                  href="/kling-studio"
                  style={{
                    padding: "12px 18px",
                    borderRadius: 14,
                    border: "1px solid rgba(255,138,91,0.38)",
                    background: "rgba(255,138,91,0.14)",
                    color: "white",
                    fontWeight: 900,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    textDecoration: "none",
                  }}
                >
                  重新创作
                </a>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 14, overflowX: "auto", paddingBottom: 2 }}>
              {slides.map((s, i) => (
                <button
                  key={s.title}
                  onClick={() => setIdx(i)}
                  style={{
                    minWidth: 136,
                    padding: 10,
                    borderRadius: 14,
                    background: i === idx ? "rgba(255,138,91,0.18)" : "rgba(255,255,255,0.05)",
                    border: i === idx ? "1px solid rgba(255,138,91,0.55)" : "1px solid rgba(255,255,255,0.08)",
                    color: "white",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  {s.title}
                </button>
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
                内测阶段开放多项核心功能，帮助创作者快速完成内容策略、平台洞察、二次创作与工作流落地。
              </div>

              <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
                {[
                  { label: "创作者成长营", desc: "上传内容 → 商业战略 + 爆款选题 + 导演分镜", href: "/creator-growth-camp" },
                  { label: "二创中心", desc: "图/文/视频 · 拆解结构、选题与分镜级方案（REMIX）", href: "/creator-growth-camp/premium-remix" },
                  { label: "平台趋势分析", desc: "平台数据洞察 + 7 天发布计划", href: "/creator-growth-camp/platform" },
                  { label: "节点式工作流", desc: "可视化节点画布，一键执行完整创作流程", href: "/workflow-nodes" },
                ].map((item) => (
                  <a
                    key={item.label}
                    href={item.href}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 14,
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      color: "rgba(255,255,255,0.86)",
                      fontSize: 14,
                      textDecoration: "none",
                      display: "block",
                    }}
                  >
                    <span style={{ fontWeight: 800, color: "white" }}>{item.label}</span>
                    <span style={{ color: "rgba(255,255,255,0.5)", marginLeft: 8, fontSize: 13 }}>{item.desc}</span>
                  </a>
                ))}
              </div>

              <div
                style={{
                  marginTop: 16,
                  padding: "12px 14px",
                  borderRadius: 14,
                  background: "rgba(139,92,246,0.10)",
                  border: "1px solid rgba(139,92,246,0.22)",
                  color: "rgba(255,255,255,0.75)",
                  fontSize: 13,
                  lineHeight: 1.7,
                }}
              >
                内测阶段限量开放，持有内测码的用户可解锁完整功能。
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
              <a
                href="/creator-growth-camp"
                style={{
                  padding: "14px 20px",
                  borderRadius: 14,
                  border: "none",
                  background: "linear-gradient(135deg,#8b5cf6,#ff4fb3)",
                  color: "white",
                  fontWeight: 900,
                  cursor: "pointer",
                  textDecoration: "none",
                }}
              >
                进入成长营
              </a>
              {!isAuthenticated && (
                <a
                  href="/login"
                  style={{
                    padding: "14px 20px",
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.04)",
                    color: "white",
                    fontWeight: 900,
                    cursor: "pointer",
                    textDecoration: "none",
                  }}
                >
                  登录 / 注册
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 核心功能入口 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 14,
          marginTop: 16,
        }}
        className="home-feature-cards"
      >
        {[
          {
            href: "/creator-growth-camp",
            badge: "核心功能",
            badgeColor: "rgba(251,146,60,0.9)",
            title: "创作者成长营",
            desc: "上传视频或图文，即时生成商业战略、爆款选题与导演级分镜；商业成长（GROWTH）与二次创作（REMIX）双模式。",
            gradient: "linear-gradient(135deg, rgba(251,146,60,0.18), rgba(239,68,68,0.10))",
            border: "rgba(251,146,60,0.30)",
            arrow: "rgba(251,146,60,1)",
            cta: "开始分析 →",
          },
          {
            href: "/creator-growth-camp/premium-remix",
            badge: "二创 / REMIX",
            badgeColor: "rgba(244,114,182,0.95)",
            title: "二创中心",
            desc: "二次创作中心：上传或引用图、文、视频等参考，完成结构拆解、选题策划与分镜级执行指引。",
            gradient: "linear-gradient(135deg, rgba(244,114,182,0.22), rgba(251,146,60,0.12))",
            border: "rgba(244,114,182,0.45)",
            arrow: "rgba(244,114,182,1)",
            cta: "进入二创中心 →",
          },
          {
            href: "/creator-growth-camp/platform",
            badge: "平台洞察",
            badgeColor: "rgba(96,165,250,0.9)",
            title: "平台趨勢分析",
            desc: "小红书、抖音、B站、快手平台数据洞察，含 7 天发布计划与流量承接建议。",
            gradient: "linear-gradient(135deg, rgba(96,165,250,0.18), rgba(139,92,246,0.10))",
            border: "rgba(96,165,250,0.30)",
            arrow: "rgba(96,165,250,1)",
            cta: "查看趨勢 →",
          },
          {
            href: "/workflow-nodes",
            badge: "创作工作流",
            badgeColor: "rgba(167,139,250,0.9)",
            title: "节点式工作流",
            desc: "可视化节点画布，串接分镜生成、AI 视频、BGM 与发布动作，一键执行完整创作流程。",
            gradient: "linear-gradient(135deg, rgba(167,139,250,0.18), rgba(236,72,153,0.10))",
            border: "rgba(167,139,250,0.30)",
            arrow: "rgba(167,139,250,1)",
            cta: "进入工作流 →",
          },
        ].map((card) => (
          <a
            key={card.href}
            href={card.href}
            style={{
              display: "block",
              padding: "20px 22px",
              borderRadius: 20,
              background: card.gradient,
              border: `1px solid ${card.border}`,
              textDecoration: "none",
              color: "white",
              transition: "transform 0.18s, box-shadow 0.18s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(-3px)";
              (e.currentTarget as HTMLAnchorElement).style.boxShadow = "0 12px 36px rgba(0,0,0,0.35)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(0)";
              (e.currentTarget as HTMLAnchorElement).style.boxShadow = "none";
            }}
          >
            <div style={{ marginBottom: 10 }}>
              <span
                style={{
                  display: "inline-block",
                  padding: "3px 10px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 800,
                  color: card.badgeColor,
                  background: "rgba(255,255,255,0.07)",
                  border: `1px solid ${card.border}`,
                }}
              >
                {card.badge}
              </span>
            </div>
            <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1.3 }}>{card.title}</div>
            <div style={{ marginTop: 8, fontSize: 13, color: "rgba(255,255,255,0.68)", lineHeight: 1.7 }}>
              {card.desc}
            </div>
            <div style={{ marginTop: 14, fontSize: 13, fontWeight: 800, color: card.arrow }}>
              {card.cta}
            </div>
          </a>
        ))}
      </div>

      <style>{`
        @media (max-width: 980px) {
          .home-hero-grid {
            grid-template-columns: 1fr !important;
          }
          .home-feature-cards {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 640px) {
          .home-feature-cards {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
