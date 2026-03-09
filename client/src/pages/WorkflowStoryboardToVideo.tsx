import React, { useEffect, useState } from "react";

export default function WorkflowStoryboardToVideo() {
  const [prompt, setPrompt] = useState("未来都市追逐，镜头节奏快速，电影感强");
  const [targetWords, setTargetWords] = useState("900");
  const [targetScenes, setTargetScenes] = useState("6");
  const [workflowId, setWorkflowId] = useState("");
  const [workflow, setWorkflow] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [debug, setDebug] = useState<any>(null);

  useEffect(() => {
    if (!workflowId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      const resp = await fetch(`/api/jobs?op=workflowStatus&id=${encodeURIComponent(workflowId)}`);
      const json = await resp.json().catch(() => null);
      setDebug(json);
      if (resp.ok && json?.workflow) {
        setWorkflow(json.workflow);
        const status = String(json.workflow?.status || "");
        if (status === "done" || status === "failed") return;
      }
      timer = setTimeout(poll, 2000);
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [workflowId]);

  async function startWorkflow() {
    if (busy) return;
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setDebug({ ok: false, error: "prompt is required" });
      return;
    }

    setBusy(true);
    setWorkflow(null);
    setWorkflowId("");
    setDebug(null);

    try {
      const resp = await fetch("/api/jobs?op=startWorkflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmedPrompt,
          targetWords: Number(targetWords || 0) || undefined,
          targetScenes: Number(targetScenes || 0) || undefined,
        }),
      });
      const json = await resp.json().catch(() => null);
      setDebug(json);
      if (!resp.ok || !json?.workflow) return;
      setWorkflow(json.workflow);
      setWorkflowId(String(json.workflow.workflowId || ""));
    } finally {
      setBusy(false);
    }
  }

  const outputs = workflow?.outputs || {};
  const storyboard = Array.isArray(outputs.storyboard) ? outputs.storyboard : [];
  const storyboardImages = Array.isArray(outputs.storyboardImages) ? outputs.storyboardImages : [];

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 20, color: "white" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Workflow</h1>
      <p style={{ opacity: 0.85, marginTop: 8 }}>
        Prompt → Script → Storyboard → Storyboard Images → Character Lock → Video → Voice → BGM → Render
      </p>

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="Prompt"
          style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
        />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <input
            value={targetWords}
            onChange={(e) => setTargetWords(e.target.value)}
            placeholder="Target Words"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
          />
          <input
            value={targetScenes}
            onChange={(e) => setTargetScenes(e.target.value)}
            placeholder="Target Scenes"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
          />
        </div>

        <button
          onClick={startWorkflow}
          disabled={busy}
          style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 800, width: 200 }}
        >
          {busy ? "Starting..." : "Start Workflow"}
        </button>
      </div>

      {workflow ? (
        <div style={{ marginTop: 18, padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)" }}>
          <div>workflowId: <code>{workflow.workflowId}</code></div>
          <div>currentStep: <code>{String(workflow.currentStep || "-")}</code></div>
          <div>status: <code>{String(workflow.status || "-")}</code></div>

          <div style={{ marginTop: 10 }}>script:</div>
          <pre style={{ whiteSpace: "pre-wrap", padding: 10, borderRadius: 10, background: "rgba(0,0,0,0.3)" }}>{String(outputs.script || "")}</pre>

          <div style={{ marginTop: 10 }}>storyboard:</div>
          <pre style={{ whiteSpace: "pre-wrap", padding: 10, borderRadius: 10, background: "rgba(0,0,0,0.3)" }}>{JSON.stringify(storyboard, null, 2)}</pre>

          <div style={{ marginTop: 10 }}>storyboardImages:</div>
          <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
            {storyboardImages.map((item: any) => (
              <div key={String(item?.sceneIndex)} style={{ padding: 10, borderRadius: 10, background: "rgba(0,0,0,0.3)" }}>
                <div>sceneIndex: <code>{String(item?.sceneIndex)}</code></div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                  {(Array.isArray(item?.images) ? item.images : []).map((url: string, idx: number) => (
                    <img key={`${item.sceneIndex}-${idx}`} src={url} style={{ width: "100%", borderRadius: 8, background: "black" }} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 10 }}>videoUrl: <code>{String(outputs.videoUrl || "")}</code></div>
          <div>voiceUrl: <code>{String(outputs.voiceUrl || "")}</code></div>
          <div>musicUrl: <code>{String(outputs.musicUrl || "")}</code></div>
          <div>finalVideoUrl: <code>{String(outputs.finalVideoUrl || "")}</code></div>

          {outputs.voiceUrl ? <audio controls src={String(outputs.voiceUrl)} style={{ width: "100%", marginTop: 8 }} /> : null}
          {outputs.finalVideoUrl ? <video controls src={String(outputs.finalVideoUrl)} style={{ width: "100%", marginTop: 8, borderRadius: 8 }} /> : null}
        </div>
      ) : null}

      {debug ? (
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.3)" }}>
          {JSON.stringify(debug, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
