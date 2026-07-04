import { Link } from "wouter";
import React, { useEffect, useState } from "react";
import { Mic } from "lucide-react";
import FloatingVideoWatermark from "./FloatingVideoWatermark";
import { useAuth } from "../_core/hooks/useAuth";
import HomeWeatherClock from "./HomeWeatherClock";
import HomeProductGuide from "./HomeProductGuide";
import { AmbientLocationPicker } from "@/components/AmbientLocationPicker";

/** Hero 内一键直达：与产品 flagship 模块一致 */
const HERO_FLAGSHIP_LINKS: { href: string; label: string }[] = [
  { href: "/platform", label: "平台创作" },
  { href: "/research", label: "竞品调研" },
  { href: "/canvas", label: "Omini，Seedance 2.X画布" },
];

const HERO_VIDEO_TAGS = [
  "平台创作",
  "竞品调研",
  "Omini，Seedance 2.X画布",
];

const slides = [
  {
    title: "雷电网球",
    subtitle: "职业女子网球比赛的关键瞬间",
    model: "影视级 AI",
    videoUrl: "/migrated/home/video1.mp4",
    poster: "/migrated/home/poster1.jpg",
    prompt: "职业女子网球比赛的关键瞬间，网球选手腾空击球，球拍与网球接触时爆发蓝色电弧能量轨迹，观众席沸腾欢呼，夕阳逆光照射球场，强烈动感与速度感，电影级体育广告画面，超高细节，动态运动模糊，8K cinematic lighting"
  },
  {
    title: "海洋女神",
    subtitle: "史诗奇幻海洋场景",
    model: "影视级 AI",
    videoUrl: "/migrated/home/video2.mp4",
    poster: "/migrated/home/poster2.jpg",
    prompt: "神秘海洋女神从海浪中升起，巨大的海浪在她身后形成弧形水幕，身体由水与光构成，蓝绿色能量粒子在周围漂浮，夕阳穿透海浪形成神圣光束，史诗奇幻风格，电影级光影，超高细节，幻想史诗场景"
  },
  {
    title: "秘境森林",
    subtitle: "古代森林神庙遗迹",
    model: "影视级 AI",
    videoUrl: "/migrated/home/video3.mp4",
    poster: "/migrated/home/poster3.jpg",
    prompt: "被遗忘的古代森林神庙遗迹，巨大的石柱与藤蔓缠绕的神殿入口，发光的蓝绿色植物沿着石柱延伸，清晨阳光穿透森林形成体积光，神秘而宁静的奇幻氛围，电影级构图，超高细节，史诗探险场景"
  },
  {
    title: "太空站观景台",
    subtitle: "未来太空站内部观景大厅",
    model: "影视级 AI",
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
                {HERO_VIDEO_TAGS.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      padding: "7px 12px",
                      borderRadius: 999,
                      background: "rgba(8,8,16,0.52)",
                      border: "1px solid rgba(255,255,255,0.14)",
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
                  <div style={{ marginTop: 8, fontSize: 14, opacity: 0.84, maxWidth: 560, lineHeight: 1.55 }}>
                    先看成片；平台创作、竞品调研与 Omini，Seedance 2.X画布三站闭环，从洞察到出图同页完成。
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                  <Link
                    href="/platform"
                    style={{
                      padding: "12px 18px",
                      borderRadius: 14,
                      border: "none",
                      background: "linear-gradient(135deg,#8b5cf6,#6366f1)",
                      color: "white",
                      fontWeight: 900,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      textDecoration: "none",
                    }}
                  >
                    进入平台创作
                  </Link>
                  <Link
                    href="/research"
                    style={{
                      padding: "10px 16px",
                      borderRadius: 14,
                      border: "1px solid rgba(255,255,255,0.14)",
                      background: "rgba(255,255,255,0.06)",
                      color: "rgba(255,255,255,0.92)",
                      fontWeight: 800,
                      fontSize: 13,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      textDecoration: "none",
                    }}
                  >
                    竞品调研 Hub →
                  </Link>
                </div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 12,
                padding: "12px 14px",
                borderRadius: 16,
                background: "rgba(0,0,0,0.22)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.45)", width: "100%", marginBottom: 2 }}>
                主打能力 · 一键进入
              </span>
              {HERO_FLAGSHIP_LINKS.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#fca5a5",
                    textDecoration: "none",
                    padding: "6px 11px",
                    borderRadius: 999,
                    border: "1px solid rgba(252,165,165,0.28)",
                    background: "rgba(252,165,165,0.08)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </Link>
              ))}
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
              <HomeWeatherClock />
              <div style={{ height: 10 }} />
              <AmbientLocationPicker compact />
              <div style={{ height: 12 }} />
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

              <div
                style={{
                  marginTop: 12,
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "7px 14px",
                  borderRadius: 999,
                  background: "linear-gradient(100deg, rgba(34,211,238,0.22), rgba(167,139,250,0.28))",
                  border: "1px solid rgba(34,211,238,0.5)",
                  color: "#ecfeff",
                  fontWeight: 900,
                  fontSize: 13,
                  letterSpacing: "0.04em",
                  textShadow: "0 0 20px rgba(34,211,238,0.35)",
                  boxShadow: "0 0 28px rgba(34,211,238,0.12), inset 0 1px 0 rgba(255,255,255,0.12)",
                }}
              >
                新增 GPT-image-2 生图模型
              </div>

              <div
                style={{
                  marginTop: 14,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  flexWrap: "wrap",
                  padding: "16px 20px",
                  borderRadius: 18,
                  background:
                    "linear-gradient(135deg, rgba(99,102,241,0.22) 0%, rgba(167,139,250,0.12) 100%)",
                  border: "1px solid rgba(167,139,250,0.45)",
                  boxShadow: "0 10px 36px rgba(99,102,241,0.18)",
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    background: "rgba(99,102,241,0.35)",
                    border: "1px solid rgba(199,210,254,0.35)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Mic size={24} color="#e9d5ff" strokeWidth={2.25} aria-hidden />
                </div>
                <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                  <div style={{ fontSize: 19, fontWeight: 900, color: "#f5f3ff", letterSpacing: "0.02em" }}>
                    文本支持语音输入
                  </div>
                  <div style={{ marginTop: 4, fontSize: 15, fontWeight: 600, color: "rgba(233,213,255,0.88)", lineHeight: 1.55 }}>
                    成长营、流量雷达、竞品调研、战略智库、视频基地与爆款解构等模块的输入框均可点麦克风，中文语音识别写入文案，免双手长段描述。
                  </div>
                </div>
              </div>

              <div style={{ fontSize: 42, fontWeight: 900, lineHeight: 1.12, color: "white", marginTop: 18 }}>
                从爆款洞察到大片生成，
                <br />
                一个人就是一个顶配影视工作室。
              </div>

              <div style={{ marginTop: 16, color: "rgba(255,255,255,0.78)", lineHeight: 1.75, fontSize: 15 }}>
                深度融合战略分析、多平台趋势与影院级生成：创作者成长营与二创中心、全网流量雷达、四平台竞品调研（60 点深度报告）、AI 上帝视角战略智库（半月刊 / 订阅 / 私订）、大师电影故事创作（脚本 · 分镜 · 成片）以及尊享爆款解构，覆盖从洞察到成片的全链路。
              </div>

              <HomeProductGuide />

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
                现在为内测阶段，可申请邀请码。
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
              <a
                href="/platform"
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
                进入平台创作
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

        {/* Hero 下方黑色区域内置卡片 */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 14,
            marginTop: 24,
          }}
          className="hero-inner-cards"
        >
          {[
            {
              href: "/platform",
              badge: "平台创作",
              badgeColor: "rgba(96,165,250,0.9)",
              title: "全网流量雷达 · 自定义工作台",
              desc: "趋势全案、素材分析、文案生图、选题与抠像，同页完成。",
              gradient: "linear-gradient(135deg, rgba(96,165,250,0.18), rgba(139,92,246,0.10))",
              border: "rgba(96,165,250,0.30)",
              arrow: "rgba(96,165,250,1)",
              cta: "进入平台 →",
            },
            {
              href: "/research",
              badge: "竞品调研",
              badgeColor: "rgba(249,115,22,0.95)",
              title: "调研 · 智库 · 赛道雷达",
              desc: "60 点深潜调研、战略智库、Agent 雷达与 IP 矩阵，一站切换。",
              gradient: "linear-gradient(135deg, rgba(249,115,22,0.20), rgba(234,88,12,0.10))",
              border: "rgba(249,115,22,0.38)",
              arrow: "rgba(253,186,116,1)",
              cta: "开始调研 →",
            },
            {
              href: "/canvas",
              badge: "Omini，Seedance 2.X画布",
              badgeColor: "rgba(52,211,153,0.95)",
              title: "Omini，Seedance 2.X画布",
              desc: "节点式生图、视频、抠像与多方块连线传递，自由编排创作流。",
              gradient: "linear-gradient(135deg, rgba(52,211,153,0.16), rgba(16,185,129,0.08))",
              border: "rgba(52,211,153,0.35)",
              arrow: "rgba(110,231,183,1)",
              cta: "打开画布 →",
            },
          ].map((card) => (
            <Link
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
            </Link>
          ))}
        </div>
      </div>

      {/* 核心功能入口 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 14,
          marginTop: 16,
        }}
        className="home-feature-cards"
      >
        {[
          {
            href: "/platform",
            badge: "平台创作",
            badgeColor: "rgba(96,165,250,0.9)",
            title: "趋势 · 素材 · 生图",
            desc: "全案分析、自定义工作台与成长营能力已并入；上传素材 → 优化 → 出图同页完成。",
            gradient: "linear-gradient(135deg, rgba(96,165,250,0.18), rgba(139,92,246,0.12))",
            border: "rgba(96,165,250,0.32)",
            arrow: "rgba(96,165,250,1)",
            cta: "进入平台 →",
          },
          {
            href: "/research",
            badge: "竞品调研",
            badgeColor: "rgba(249,115,22,0.95)",
            title: "调研 · 智库 · 雷达",
            desc: "四平台深潜调研、战略智库套餐、赛道雷达与 IP 矩阵，Hub 内 Tab 切换。",
            gradient: "linear-gradient(135deg, rgba(249,115,22,0.20), rgba(234,88,12,0.10))",
            border: "rgba(249,115,22,0.38)",
            arrow: "rgba(253,186,116,1)",
            cta: "开始调研 →",
          },
          {
            href: "/canvas",
            badge: "Omini，Seedance 2.X画布",
            badgeColor: "rgba(52,211,153,0.95)",
            title: "节点式视频创作",
            desc: "生图、视频、抠像与 A→B→C 连线传递；自由编排，无需跳转多页。",
            gradient: "linear-gradient(135deg, rgba(52,211,153,0.16), rgba(16,185,129,0.08))",
            border: "rgba(52,211,153,0.35)",
            arrow: "rgba(110,231,183,1)",
            cta: "打开画布 →",
          },
        ].map((card) => (
          <Link
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
          </Link>
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
          .hero-inner-cards {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 640px) {
          .home-feature-cards {
            grid-template-columns: 1fr !important;
          }
          .hero-inner-cards {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
