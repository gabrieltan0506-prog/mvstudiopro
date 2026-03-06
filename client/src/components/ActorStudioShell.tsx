import React from "react";

type Props = {
  userEmail?: string;
};

function Card(props: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(0,0,0,0.22)",
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 900 }}>{props.title}</div>
      {props.subtitle ? (
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.78 }}>{props.subtitle}</div>
      ) : null}
      <div style={{ marginTop: 14 }}>{props.children}</div>
    </div>
  );
}

export default function ActorStudioShell(props: Props) {
  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: 24, color: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 34, fontWeight: 900 }}>Actor Studio</div>
          <div style={{ marginTop: 8, fontSize: 14, opacity: 0.78 }}>
            正式用户工作流：角色上传 → 场景图 → 视频 → 音乐 → 成片
          </div>
        </div>
        <div style={{ fontSize: 13, opacity: 0.82 }}>
          {props.userEmail ? <>已登录：<b>{props.userEmail}</b></> : "未登录"}
        </div>
      </div>

      <div
        style={{
          marginTop: 24,
          display: "grid",
          gridTemplateColumns: "1.15fr 1fr",
          gap: 16,
        }}
      >
        <Card title="1. 角色输入" subtitle="上传人物图，建立角色基准">
          <div style={{ display: "grid", gap: 12 }}>
            <button style={btnStyle}>上传人物图</button>
            <div style={hintStyle}>后续将接统一上传模块与角色 ID 锁定。</div>
          </div>
        </Card>

        <Card title="2. 场景图生成" subtitle="Kling 3.0 / Nano Banana Pro">
          <div style={{ display: "grid", gap: 12 }}>
            <button style={btnStyle}>生成角色场景图</button>
            <div style={hintStyle}>后续支持：Kling 2.6（教育）/ Kling 3.0 / Google Flash / Pro。</div>
          </div>
        </Card>

        <Card title="3. 视频生成" subtitle="Veo / Kling 双路线">
          <div style={{ display: "grid", gap: 12 }}>
            <button style={btnStyle}>生成视频片段</button>
            <div style={hintStyle}>后续支持：Veo Rapid / Pro、Kling 2.6 / 3.0、透明 PNG 首帧优化。</div>
          </div>
        </Card>

        <Card title="4. 音乐生成" subtitle="Suno / Udio">
          <div style={{ display: "grid", gap: 12 }}>
            <button style={btnStyle}>生成配乐</button>
            <div style={hintStyle}>后续支持：片段配乐、封面、下载、自动匹配镜头节奏。</div>
          </div>
        </Card>

        <div style={{ gridColumn: "1 / -1" }}>
          <Card title="5. 工作流与成片" subtitle="AI Actor Engine 主路径">
            <div style={{ display: "grid", gap: 10 }}>
              <div style={hintStyle}>人物图 → 场景图 → 视频 → 音乐 → 成片</div>
              <button style={btnStyle}>开始完整工作流</button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "11px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.10)",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const hintStyle: React.CSSProperties = {
  fontSize: 13,
  opacity: 0.78,
  lineHeight: 1.6,
};
