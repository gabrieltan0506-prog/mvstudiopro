import React, { useEffect, useRef, useState } from "react";

type CreateResp =
  | { ok: true; status: number; url: string; json: any }
  | { ok: false; status?: number; url?: string; json?: any; rawText?: string; raw?: string; parseError?: string; contentType?: string; message?: string };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function AIMusicPanel() {
  const [prompt, setPrompt] = useState<string>("upbeat pop song about freedom and travel");
  const [loading, setLoading] = useState(false);
  const [taskId, setTaskId] = useState<string>("");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>("");
  const stopRef = useRef(false);

  useEffect(() => {
    return () => {
      stopRef.current = true;
    };
  }, []);

  async function createTask() {
    setError("");
    setResult(null);
    setTaskId("");
    setLoading(true);
    stopRef.current = false;

    try {
      const r = await fetch("/api/jobs?op=aimusicSunoCreate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_type: "create_music",
          custom_mode: false,
          mv: "sonic-v4-5",
          gpt_description_prompt: prompt,
        }),
      });

      const j: CreateResp = await r.json();
      if (!j || (j as any).ok !== true) {
        throw new Error(`create failed: ${JSON.stringify(j)}`);
      }

      const tid = (j as any).json?.task_id || (j as any).json?.data?.task_id;
      if (!tid) throw new Error(`missing task_id in response: ${JSON.stringify(j)}`);

      setTaskId(String(tid));

      const start = Date.now();
      while (!stopRef.current) {
        if (Date.now() - start > 8 * 60 * 1000) throw new Error("timeout waiting for result");

        const pr = await fetch(`/api/jobs?op=aimusicSunoTask&taskId=${encodeURIComponent(String(tid))}`, {
          method: "GET",
          headers: { "Accept": "application/json" },
        });
        const pj: any = await pr.json();

        const upstream = pj?.json ?? pj;
        const data = upstream?.data;

        if (Array.isArray(data) && data.length > 0) {
          const item = data[0];
          if (item?.audio_url || item?.video_url) {
            setResult(item);
            setLoading(false);
            return;
          }
        }

        const status = upstream?.status || upstream?.state || upstream?.task_status;
        if (status && String(status).toLowerCase() === "failed") {
          throw new Error(`task failed: ${JSON.stringify(upstream)}`);
        }

        await sleep(2500);
      }
    } catch (e: any) {
      setError(e?.message || String(e));
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>AI Music (AIMusicAPI · Suno/Udio)</h1>
      <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 16 }}>
        Calls <code>/api/jobs?op=aimusicSunoCreate</code> then polls <code>aimusicSunoTask</code>.
      </div>

      <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>Prompt</label>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={5}
        style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(0,0,0,0.2)" }}
        placeholder="Describe the song..."
      />

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
        <button
          onClick={createTask}
          disabled={loading || !prompt.trim()}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.2)",
            cursor: loading ? "not-allowed" : "pointer",
            fontWeight: 700,
          }}
        >
          {loading ? "Generating..." : "Generate music"}
        </button>

        {taskId ? (
          <div style={{ fontSize: 13, opacity: 0.85 }}>
            Task: <code>{taskId}</code>
          </div>
        ) : null}
      </div>

      {error ? (
        <pre style={{ marginTop: 12, color: "#b00020", whiteSpace: "pre-wrap" }}>{error}</pre>
      ) : null}

      {result ? (
        <div style={{ marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid rgba(0,0,0,0.15)" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Result</div>

          {result.image_url ? (
            <img src={result.image_url} alt="cover" style={{ width: 220, borderRadius: 12, display: "block", marginBottom: 10 }} />
          ) : null}

          {result.audio_url ? (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Audio</div>
              <audio controls src={result.audio_url} style={{ width: "100%" }} />
              <div style={{ marginTop: 6 }}>
                <a href={result.audio_url} target="_blank" rel="noreferrer">Open audio_url</a>
              </div>
            </div>
          ) : null}

          {result.video_url ? (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>Video</div>
              <div>
                <a href={result.video_url} target="_blank" rel="noreferrer">Open video_url</a>
              </div>
            </div>
          ) : null}

          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer" }}>Raw JSON</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(result, null, 2)}</pre>
          </details>
        </div>
      ) : null}
    </div>
  );
}
