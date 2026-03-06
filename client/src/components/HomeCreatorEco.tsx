import React from "react";

const actors = [
  ["虚拟艺人 A", "用户角色"],
  ["虚拟艺人 B", "系统角色"],
  ["机甲守护者", "可复用角色"],
  ["都市女主", "用户角色"],
  ["未来特工", "角色模板"],
  ["森林精灵", "角色模板"],
  ["电竞主播", "用户角色"],
  ["科幻舰长", "可复用角色"],
];

export default function HomeCreatorEco() {
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
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4,minmax(0,1fr))",
              gap: 14,
              marginTop: 18,
            }}
          >
            {actors.map(([name, type], i) => (
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
                <div style={{ padding: 12 }}>
                  <div style={{ color: "white", fontWeight: 900, fontSize: 14 }}>{name}</div>
                  <div style={{ marginTop: 4, color: "rgba(255,255,255,0.55)", fontSize: 12 }}>{type}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gap: 18,
          }}
        >
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
    </section>
  );
}
