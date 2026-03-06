import React from "react";

const actors = ["用户角色A", "用户角色B", "系统角色C", "系统角色D", "虚拟艺人E", "虚拟艺人F"];

export default function HomeCreatorEco() {
  return (
    <section style={{ maxWidth: 1240, margin: "0 auto", padding: "44px 20px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end" }}>
        <div>
          <div style={{ color: "white", fontSize: 34, fontWeight: 900 }}>创作者生态</div>
          <div style={{ marginTop: 8, color: "rgba(255,255,255,0.68)" }}>角色库、复用资产与创作者内容生态</div>
        </div>
        <div style={{ color: "#ff9b75", fontWeight: 800 }}>Creator Ecosystem</div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6,minmax(0,1fr))",
          gap: 16,
          marginTop: 22,
        }}
      >
        {actors.map((name, i) => (
          <div
            key={name}
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
                background:
                  i % 2 === 0
                    ? "linear-gradient(135deg,#4338ca,#db2777)"
                    : "linear-gradient(135deg,#0f766e,#8b5cf6)",
              }}
            />
            <div style={{ padding: 12, color: "white", fontWeight: 800 }}>{name}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
