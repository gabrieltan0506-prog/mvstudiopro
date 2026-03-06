import React from "react";
import seed from "../data/home_seed_assets_zh.json";

const gradients = [
  "linear-gradient(135deg,#4338ca,#db2777)",
  "linear-gradient(135deg,#0f766e,#8b5cf6)",
  "linear-gradient(135deg,#1d4ed8,#7c3aed)",
  "linear-gradient(135deg,#7c2d12,#db2777)",
  "linear-gradient(135deg,#164e63,#9333ea)",
  "linear-gradient(135deg,#0f766e,#2563eb)",
  "linear-gradient(135deg,#7c3aed,#ec4899)",
  "linear-gradient(135deg,#1e3a8a,#9333ea)",
];

export default function HomeCreatorEco() {
  const actors = Array.isArray((seed as any)?.creatorActors) ? (seed as any).creatorActors : [];

  return (
    <section style={{ maxWidth: 1240, margin: "0 auto", padding: "48px 20px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "white", fontSize: 34, fontWeight: 900 }}>创作者生态</div>
          <div style={{ marginTop: 8, color: "rgba(255,255,255,0.68)" }}>
            角色库、可复用资产、我的创作与 Recreate 形成创作闭环
          </div>
        </div>
        <div style={{ color: "#ff9b75", fontWeight: 800 }}>Creator Ecosystem</div>
      </div>

      <div
        className="home-creator-layout"
        style={{
          marginTop: 24,
          display: "grid",
          gridTemplateColumns: "1.1fr 1fr",
          gap: 18,
        }}
      >
        <div
          style={{
            borderRadius: 24,
            padding: 22,
            background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div style={{ color: "white", fontSize: 24, fontWeight: 900 }}>角色库</div>
          <div style={{ marginTop: 8, color: "rgba(255,255,255,0.70)" }}>
            用于虚拟艺人工坊、角色一致性视频、Recreate 与后续批量生成。
          </div>

          <div
            className="home-actors-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,minmax(0,1fr))",
              gap: 14,
              marginTop: 18,
            }}
          >
            {actors.map((prompt: string, i: number) => {
              const name = prompt.split("，")[0] || `角色 ${i + 1}`;
              return (
                <div
                  key={name + i}
                  style={{
                    borderRadius: 18,
                    overflow: "hidden",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div
                    style={{
                      aspectRatio: "3 / 4",
                      background: gradients[i % gradients.length],
                    }}
                  />
                  <div style={{ padding: 12 }}>
                    <div style={{ color: "white", fontWeight: 900, fontSize: 14 }}>{name}</div>
                    <div style={{ marginTop: 6, color: "rgba(255,255,255,0.60)", fontSize: 12, lineHeight: 1.6 }}>
                      {prompt}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          {[
            ["我的创作", "集中管理任务、作品、历史记录，后续接入登录与积分体系。"],
            ["Recreate 同款", "浏览作品后一键进入工作流，自动带入模型、prompt 与主要参数。"],
            ["批量生成（后续）", "支持多个工作流排队执行，适合商业内容与批量创作。"],
          ].map(([title, desc]) => (
            <div
              key={title}
              style={{
                borderRadius: 22,
                padding: 22,
                background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div style={{ color: "white", fontSize: 22, fontWeight: 900 }}>{title}</div>
              <div style={{ marginTop: 10, color: "rgba(255,255,255,0.74)", lineHeight: 1.75 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 980px) {
          .home-creator-layout {
            grid-template-columns: 1fr !important;
          }
          .home-actors-grid {
            grid-template-columns: repeat(2,minmax(0,1fr)) !important;
          }
        }
      `}</style>
    </section>
  );
}
