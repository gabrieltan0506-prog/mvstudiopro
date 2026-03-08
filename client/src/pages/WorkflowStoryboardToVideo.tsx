import React, { useEffect, useMemo, useState } from "react";

export default function WorkflowStoryboardToVideo() {
  const [prompt, setPrompt] = useState("一段紧张刺激的动作片开场，主角在夜色中潜入。");
  const [inputType, setInputType] = useState<"script" | "image">("script");
  const [imageUrl, setImageUrl] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [workflow, setWorkflow] = useState<any>(null);
  const [debug, setDebug] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!workflowId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (stopped) return;
      const r = await fetch(`/api/jobs?op=workflowStatus&id=${encodeURIComponent(workflowId)}`);
      const j = await r.json().catch(() => null);
      setDebug(j);
      if (r.ok && j?.workflow) {
        setWorkflow(j.workflow);
        const status = String(j.workflow?.status || "");
        if (status === "done" || status === "failed") return;
      }
      timer = setTimeout(poll, 2000);
    };

    void poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [workflowId]);

  const outputs = workflow?.outputs || {};
  const storyboardImages = useMemo(() => {
    const list = outputs?.storyboardImages;
    if (Array.isArray(list)) return list;
    if (Array.isArray(outputs?.imageUrls)) return outputs.imageUrls;
    return [];
  }, [outputs]);

  async function start() {
    if (busy) return;
    if (inputType === "image" && !imageUrl.trim()) {
      setDebug({ ok: false, error: "image mode requires imageUrl" });
      return;
    }
    setBusy(true);
    setDebug(null);
    setWorkflow(null);
    setWorkflowId("");
    try {
      const payload =
        inputType === "image"
          ? {
              imageUrl: imageUrl.trim(),
              ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
            }
          : { prompt: prompt.trim() };
      const r = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "workflowTest",
          sourceType: "direct",
          inputType,
          payload,
        }),
      });
      const j = await r.json().catch(() => null);
      setDebug(j);
      if (!r.ok || !j?.workflow) return;
      setWorkflow(j.workflow);
      setWorkflowId(String(j.workflow.workflowId || ""));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 20, color: "white" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800 }}>Workflow</h1>
      <p style={{ opacity: 0.85 }}>主入口：创建 workflow 并展示状态与输出结果。</p>

      <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}>
        <label style={{ fontSize: 13, opacity: 0.9 }}>inputType</label>
        <select
          value={inputType}
          onChange={(e) => setInputType(e.target.value as "script" | "image")}
          style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(0,0,0,0.25)", color: "white", fontWeight: 800 }}
        >
          <option value="script">script</option>
          <option value="image">image</option>
        </select>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={5}
        placeholder="prompt（可选，image 模式会连同 imageUrl 一起提交）"
        style={{ width: "100%", padding: 12, borderRadius: 12, background: "rgba(0,0,0,0.35)", color: "white", border: "1px solid rgba(255,255,255,0.15)" }}
      />

      {inputType === "image" ? (
        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="https://example.com/your-image.jpg"
          style={{ width: "100%", marginTop: 10, padding: 12, borderRadius: 12, background: "rgba(0,0,0,0.35)", color: "white", border: "1px solid rgba(255,255,255,0.15)" }}
        />
      ) : null}

      <div style={{ marginTop: 12 }}>
        <button
          onClick={start}
          disabled={busy}
          style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.08)", color: "white", fontWeight: 800 }}
        >
          {busy ? "启动中..." : "启动 Workflow"}
        </button>
      </div>

      {workflow ? (
        <div style={{ marginTop: 16, whiteSpace: "pre-wrap", background: "rgba(0,0,0,0.35)", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)" }}>
          <div>workflowId: <code>{workflow.workflowId}</code></div>
          <div>currentStep: <code>{String(workflow.currentStep || "-")}</code></div>
          <div>status: <code>{String(workflow.status || "-")}</code></div>
          <div>script: <code>{String(outputs.script || "")}</code></div>
          <div>storyboard: <code>{JSON.stringify(outputs.storyboard || [])}</code></div>
          <div>storyboardImages: <code>{JSON.stringify(storyboardImages)}</code></div>
          <div>videoUrl: <code>{String(outputs.videoUrl || "")}</code></div>
          <div>finalVideoUrl: <code>{String(outputs.finalVideoUrl || "")}</code></div>
        </div>
      ) : null}

      {debug ? (
        <pre style={{ marginTop: 16, whiteSpace: "pre-wrap", background: "rgba(0,0,0,0.35)", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)" }}>
          {JSON.stringify(debug, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
