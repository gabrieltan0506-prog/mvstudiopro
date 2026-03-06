import React from "react";

const plans = [
  ["学生计划", "Student Plan", "适合教育项目与入门创作"],
  ["商业计划", "Business Plan", "适合日常商用创作与分析"],
  ["导演计划", "Director Plan", "适合高质量内容与高级控制"],
];

export default function HomePlans() {
  return (
    <section style={{ maxWidth: 1240, margin: "0 auto", padding: "44px 20px 80px" }}>
      <div style={{ color: "white", fontSize: 34, fontWeight: 900 }}>套餐中心</div>
      <div style={{ marginTop: 8, color: "rgba(255,255,255,0.68)" }}>按创作深度与高级能力选择合适计划</div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,minmax(0,1fr))",
          gap: 18,
          marginTop: 22,
        }}
      >
        {plans.map(([zh, en, desc], i) => (
          <div
            key={zh}
            style={{
              padding: 24,
              borderRadius: 22,
              background:
                i === 2
                  ? "linear-gradient(135deg, rgba(91,33,182,0.45), rgba(255,79,179,0.18))"
                  : "rgba(255,255,255,0.04)",
              border: i === 2 ? "1px solid rgba(255,138,91,0.42)" : "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ color: "white", fontSize: 24, fontWeight: 900 }}>{zh}</div>
            <div style={{ marginTop: 6, color: "rgba(255,255,255,0.52)", fontSize: 12 }}>{en}</div>
            <div style={{ marginTop: 14, color: "rgba(255,255,255,0.78)", lineHeight: 1.7 }}>{desc}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
