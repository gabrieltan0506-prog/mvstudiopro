import React from "react";

type ToolCard = {
  zh: string;
  en: string;
  desc: string;
  price: string;
  pro: boolean;
  href: string;
};

const cards: ToolCard[] = [
  { zh: "IP 战略指挥室", en: "IP Strategy Hub", desc: "丢掉低效的头脑风暴。上传竞品或灵感碎片，AI 瞬间为您输出万字商业战略、精准爆款选题库与导演级机位分镜。", price: "公测功能", pro: true, href: "/creator-growth-camp" },
  { zh: "爆款解构引擎", en: "Viral Remix Engine", desc: "万物皆可爆改。一键输入对标爆款，精准拆解其底层爆火逻辑，为您重塑生成极具个人 IP 风格的独家二创落地脚本。", price: "公测功能", pro: true, href: "/creator-growth-camp/premium-remix" },
  { zh: "全网流量雷达", en: "Trend Radar", desc: "告别盲目自嗨。实时捕捉小红书、抖音等主流平台最新流量风向，并为您量身定制快速起号、发布计划与精准流量承接策略。", price: "公测功能", pro: true, href: "/creator-growth-camp/platform" },
  { zh: "工业级全自动产线", en: "Auto-Pilot Workflow", desc: "将繁琐步骤降维打击。可视化无缝串联 AI 脚本、Veo 顶级分镜、Suno 配乐与语音合成。点击执行，喝杯咖啡坐等成片。", price: "公测功能", pro: true, href: "/workflow-nodes" },
];

export default function HomeTools() {
  return (
    <section style={{ maxWidth: 1240, margin: "0 auto", padding: "42px 20px 0" }}>
      <div style={{ color: "white", fontSize: 34, fontWeight: 900 }}>AI 创作工具</div>
      <div style={{ marginTop: 8, color: "rgba(255,255,255,0.68)" }}>围绕真实创作工作流设计的核心模块</div>

      <div
        className="home-tools-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 18,
          marginTop: 22,
        }}
      >
        {cards.map(({ zh, en, desc, price, pro, href }, idx) => (
          <a
            key={zh}
            href={href}
            style={{
              padding: 22,
              borderRadius: 24,
              background:
                pro
                  ? "radial-gradient(circle at top left, rgba(255,138,61,0.3), transparent 35%), linear-gradient(135deg, rgba(17,33,58,0.96), rgba(12,18,32,0.96))"
                  : idx === 0
                  ? "linear-gradient(135deg, rgba(91,33,182,0.35), rgba(255,79,179,0.18))"
                  : "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))",
              border:
                pro
                  ? "1px solid rgba(255,179,127,0.34)"
                  : idx === 0
                  ? "1px solid rgba(255,138,91,0.36)"
                  : "1px solid rgba(255,255,255,0.08)",
              boxShadow: pro ? "0 18px 42px rgba(255,138,61,0.12)" : "none",
              position: "relative",
              textDecoration: "none",
            }}
          >
            {pro ? (
              <div
                style={{
                  position: "absolute",
                  right: 16,
                  top: 16,
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.08)",
                  color: "#ffb37f",
                  fontSize: 11,
                  fontWeight: 900,
                }}
              >
                增长主线
              </div>
            ) : null}

            <div style={{ color: "white", fontSize: 22, fontWeight: 900 }}>{zh}</div>
            <div style={{ marginTop: 4, color: "rgba(255,255,255,0.48)", fontSize: 12 }}>{en}</div>
            <div style={{ marginTop: 14, color: "rgba(255,255,255,0.78)", lineHeight: 1.65 }}>{desc}</div>

            <div
              style={{
                marginTop: 18,
                display: "inline-flex",
                padding: "8px 12px",
                borderRadius: 999,
                background: "rgba(255,138,91,0.12)",
                border: "1px solid rgba(255,138,91,0.20)",
                color: "#ffb08b",
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              {price}
            </div>
          </a>
        ))}
      </div>

      <style>{`
        @media (max-width: 980px) {
          .home-tools-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
