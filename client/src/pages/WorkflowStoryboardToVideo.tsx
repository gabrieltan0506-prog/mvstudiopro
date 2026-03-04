import React, { useState } from "react";

export default function WorkflowStoryboardToVideo() {
  const [text, setText] = useState("一段紧张刺激的动作片开场，主角在夜色中潜入。");
  const [debug, setDebug] = useState<any>(null);

  async function start() {
    setDebug(null);
    const r = await fetch("/api/jobs?op=wfCreate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "storyboardToVideo", input: { text } }),
    });
    const j = await r.json();
    setDebug(j);
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 20, color: "white" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>分镜转视频（工作流 v1）</h1>
      <p style={{ opacity: 0.85 }}>输入剧情描述 → 自动生成分镜（下一步将逐镜生成参考图与 8 秒视频）</p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        style={{ width: "100%", padding: 12, borderRadius: 12, background: "rgba(0,0,0,0.35)", color: "white", border: "1px solid rgba(255,255,255,0.15)" }}
      />

      <div style={{ marginTop: 12 }}>
        <button
          onClick={start}
          style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "white", fontWeight: 800 }}
        >
          开始生成分镜
        </button>
      </div>

      {debug ? (
        <pre style={{ marginTop: 16, whiteSpace: "pre-wrap", background: "rgba(0,0,0,0.35)", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)" }}>
          {JSON.stringify(debug, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
