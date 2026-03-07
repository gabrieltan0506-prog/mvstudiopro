import React from "react";
import seed from "../data/home_seed_assets_zh.json";

const gradients = [
  "linear-gradient(135deg,#1d4ed8,#7c3aed)",
  "linear-gradient(135deg,#7c2d12,#db2777)",
  "linear-gradient(135deg,#164e63,#9333ea)",
  "linear-gradient(135deg,#0f766e,#2563eb)",
  "linear-gradient(135deg,#7c3aed,#ec4899)",
  "linear-gradient(135deg,#1e3a8a,#9333ea)",
];

function normalizeItem(item: any) {
  if (typeof item === "string") {
    return {
      prompt: item,
      imageUrl: "",
      model: "",
      source: "",
    };
  }
  return {
    prompt: item?.prompt || "",
    imageUrl: item?.imageUrl || "",
    model: item?.model || "",
    source: item?.source || "",
  };
}

function getTitle(prompt: string, index: number) {
  return (prompt || "").split("，")[0] || `作品 ${index + 1}`;
}

export default function HomeShowcase() {
  const items = Array.isArray((seed as any)?.showcaseImages) ? (seed as any).showcaseImages : [];

  return (
    <section style={{ maxWidth: 1240, margin: "0 auto", padding: "44px 20px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "white", fontSize: 34, fontWeight: 900 }}>精选作品</div>
          <div style={{ marginTop: 8, color: "rgba(255,255,255,0.68)" }}>
            第一眼先看作品，再进入“重新创作”工作流
          </div>
        </div>
        <div style={{ color: "#ff9b75", fontWeight: 800 }}>作品展示 · Showcase</div>
      </div>

      <div
        className="home-showcase-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,minmax(0,1fr))",
          gap: 18,
          marginTop: 22,
        }}
      >
        {items.map((raw: any, i: number) => {
          const item = normalizeItem(raw);
          const title = getTitle(item.prompt, i);

          return (
            <div
              key={title + i}
              style={{
                borderRadius: 22,
                overflow: "hidden",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                position: "relative",
              }}
            >
              <div
                style={{
                  aspectRatio: "16 / 10",
                  background: item.imageUrl ? `url(${item.imageUrl}) center/cover no-repeat` : gradients[i % gradients.length],
                  position: "relative",
                  display: "flex",
                  alignItems: "end",
                  justifyContent: "start",
                  padding: 16,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 14,
                    top: 14,
                    padding: "6px 10px",
                    borderRadius: 999,
                    background: "rgba(8,8,16,0.48)",
                    color: "white",
                    fontSize: 11,
                    fontWeight: 800,
                  }}
                >
                  免费试用带水印
                </div>

                {item.model ? (
                  <div
                    style={{
                      position: "absolute",
                      right: 12,
                      top: 12,
                      padding: "6px 10px",
                      borderRadius: 999,
                      background: "rgba(8,8,16,0.48)",
                      color: "white",
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                  >
                    {item.model}
                  </div>
                ) : null}

                <div
                  style={{
                    position: "absolute",
                    right: 12,
                    bottom: 12,
                    padding: "6px 10px",
                    borderRadius: 999,
                    background: "rgba(8,8,16,0.48)",
                    color: "white",
                    fontSize: 11,
                    fontWeight: 800,
                  }}
                >
                  Powered by mvstudiopro.com
                </div>
              </div>

              <div style={{ padding: 16 }}>
                <div style={{ color: "white", fontSize: 20, fontWeight: 900 }}>{title}</div>
                <div style={{ marginTop: 8, color: "rgba(255,255,255,0.72)", lineHeight: 1.7, fontSize: 14 }}>
                  {item.prompt}
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
                  <a
                    href="/remix"
                    style={{
                      padding: "10px 14px",
                      borderRadius: 12,
                      border: "1px solid rgba(255,138,91,0.40)",
                      background: "rgba(255,138,91,0.12)",
                      color: "white",
                      fontWeight: 900,
                      textDecoration: "none",
                    }}
                  >
                    重新创作
                  </a>
                  <a
                    href="/workflow"
                    style={{
                      padding: "10px 14px",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(255,255,255,0.04)",
                      color: "white",
                      fontWeight: 900,
                      textDecoration: "none",
                    }}
                  >
                    查看工作流
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @media (max-width: 980px) {
          .home-showcase-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
