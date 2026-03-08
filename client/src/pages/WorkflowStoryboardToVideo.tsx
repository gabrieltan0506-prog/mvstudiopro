import React, { useEffect, useRef, useState } from "react";

export default function WorkflowStoryboardToVideo() {
  const [prompt, setPrompt] = useState("未来都市追逐，镜头节奏快速，电影感强");
  const [workflowId, setWorkflowId] = useState("");
  const [workflow, setWorkflow] = useState<any>(null);
  const [storyboardImageMap, setStoryboardImageMap] = useState<Record<number, string[]>>({});
  const [debug, setDebug] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const generatingScenesRef = useRef<Set<number>>(new Set());

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
  const storyboard = Array.isArray(outputs?.storyboard) ? outputs.storyboard : [];

  useEffect(() => {
    if (!storyboard.length) return;
    let cancelled = false;
    const run = async () => {
      for (const scene of storyboard) {
        const sceneIndex = Number(scene?.sceneIndex);
        const scenePrompt = String(scene?.scenePrompt || "").trim();
        if (!sceneIndex || !scenePrompt) continue;
        if (storyboardImageMap[sceneIndex]?.length) continue;
        if (generatingScenesRef.current.has(sceneIndex)) continue;
        generatingScenesRef.current.add(sceneIndex);
        try {
          const r = await fetch("/api/jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              op: "bananaGenerate",
              prompt: scenePrompt,
              numImages: 2,
              aspectRatio: "16:9",
            }),
          });
          const j = await r.json().catch(() => null);
          const urls = Array.isArray(j?.imageUrls) ? j.imageUrls.filter((u: any) => typeof u === "string") : [];
          if (!cancelled) {
            setStoryboardImageMap((prev) => ({ ...prev, [sceneIndex]: urls.slice(0, 2) }));
          }
        } finally {
          generatingScenesRef.current.delete(sceneIndex);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [storyboard, storyboardImageMap]);

  async function start() {
    if (busy) return;
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setDebug({ ok: false, error: "prompt is required" });
      return;
    }
    setBusy(true);
    setDebug(null);
    setWorkflow(null);
    setWorkflowId("");
    setStoryboardImageMap({});
    try {
      const r = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "workflowTest",
          sourceType: "workflow",
          inputType: "script",
          payload: { prompt: trimmedPrompt },
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
      <p style={{ opacity: 0.85 }}>固定流程：Prompt → Script(Gemini) → Storyboard → Storyboard Images(Banana2, 每镜2张) → Video(Kling) → Render。</p>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={5}
        placeholder="输入 Prompt"
        style={{ width: "100%", padding: 12, borderRadius: 12, background: "rgba(0,0,0,0.35)", color: "white", border: "1px solid rgba(255,255,255,0.15)" }}
      />

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
        <div style={{ marginTop: 16, background: "rgba(0,0,0,0.35)", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)" }}>
          <div>workflowId: <code>{workflow.workflowId}</code></div>
          <div>currentStep: <code>{String(workflow.currentStep || "-")}</code></div>
          <div>status: <code>{String(workflow.status || "-")}</code></div>
          <div style={{ marginTop: 10 }}>script:</div>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 6, padding: 10, background: "rgba(0,0,0,0.25)", borderRadius: 10 }}>{String(outputs.script || "")}</pre>
          <div style={{ marginTop: 10 }}>storyboard JSON:</div>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 6, padding: 10, background: "rgba(0,0,0,0.25)", borderRadius: 10 }}>
            {JSON.stringify(storyboard, null, 2)}
          </pre>
          <div style={{ marginTop: 10 }}>storyboardImages:</div>
          {storyboard.length ? (
            <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
              {storyboard.map((scene: any) => {
                const sceneIndex = Number(scene?.sceneIndex);
                const scenePrompt = String(scene?.scenePrompt || "");
                const images = storyboardImageMap[sceneIndex] || [];
                return (
                  <div key={sceneIndex} style={{ padding: 10, borderRadius: 10, background: "rgba(0,0,0,0.25)" }}>
                    <div>sceneIndex: <code>{sceneIndex}</code></div>
                    <div>scenePrompt: <code>{scenePrompt}</code></div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                      {[0, 1].map((idx) =>
                        images[idx] ? (
                          <img key={idx} src={images[idx]} style={{ width: "100%", borderRadius: 8, background: "black" }} />
                        ) : (
                          <div key={idx} style={{ minHeight: 140, borderRadius: 8, border: "1px dashed rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.7 }}>
                            generating...
                          </div>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ opacity: 0.8, marginTop: 6 }}>暂无 storyboard scenes</div>
          )}
          <div style={{ marginTop: 10 }}>videoProvider: <code>{String(outputs.videoProvider || "-")}</code></div>
          <div>videoModel: <code>{String(outputs.videoModel || "-")}</code></div>
          <div>videoIsFallback: <code>{String(Boolean(outputs.videoIsFallback))}</code></div>
          <div>videoErrorMessage: <code>{String(outputs.videoErrorMessage || "")}</code></div>
          <div>videoUrl: <code>{String(outputs.videoUrl || "")}</code></div>
          <div style={{ marginTop: 10 }}>finalVideoUrl: <code>{String(outputs.finalVideoUrl || "")}</code></div>
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
