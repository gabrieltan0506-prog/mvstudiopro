import React from "react";

const steps = [
  ["脚本生成", "Gemini", "生成脚本与创意方向"],
  ["故事板", "Storyboard", "拆解镜头与叙事结构"],
  ["图像生成", "Nano Banana / Kling Image", "生成关键视觉与角色场景"],
  ["视频生成", "Veo / Kling", "生成视频片段与动态镜头"],
  ["音乐生成", "Suno / Udio", "生成配乐与情绪氛围"],
  ["最终成片", "Final Video", "拼接输出完整作品"],
];

export default function HomeWorkflow() {
  return (
    <section style={{ maxWidth: 1240, margin: "0 auto", padding: "48px 20px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "end", flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "white", fontSize: 34, fontWeight: 900 }}>AI 工作流</div>
          <div style={{ marginTop: 8, color: "rgba(255,255,255,0.68)" }}>
            从脚本到成片，用统一工作流串起创作、分析与再创作
          </div>
        </div>
        <div style={{ color: "#ff9b75", fontWeight: 800 }}>Workflow Engine</div>
      </div>

      <div
        style={{
          marginTop: 24,
          borderRadius: 28,
          padding: 24,
          background:
            "radial-gradient(circle at 10% 0%, rgba(139,92,246,0.16), transparent 22%), radial-gradient(circle at 90% 100%, rgba(255,79,179,0.14), transparent 20%), linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.03))",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(6,minmax(0,1fr))",
            gap: 14,
            alignItems: "stretch",
          }}
        >
          {steps.map(([zh, en, desc], i) => (
            <div
              key={zh}
              style={{
                minHeight: 160,
                padding: 18,
                borderRadius: 20,
                background:
                  i === steps.length - 1
                    ? "linear-gradient(135deg, rgba(139,92,246,0.55), rgba(255,79,179,0.38))"
                    : "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ color: "white", fontSize: 20, fontWeight: 900 }}>{zh}</div>
                <div style={{ marginTop: 6, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>{en}</div>
              </div>
              <div style={{ color: "rgba(255,255,255,0.76)", lineHeight: 1.65, fontSize: 13 }}>{desc}</div>
            </div>
          ))}
        </div>

        <div
          style={{
            marginTop: 18,
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 14,
          }}
        >
          {[
            "创作工作流：脚本 → 图像 → 视频 → 音乐",
            "創作商業成長營：上传素材 → 诊断 → 渠道策略 → 再创作",
            "Recreate 工作流：浏览作品 → 一键复刻 → 替换人物 / 场景",
          ].map((line) => (
            <div
              key={line}
              style={{
                padding: "14px 16px",
                borderRadius: 16,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.86)",
                lineHeight: 1.6,
              }}
            >
              {line}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
