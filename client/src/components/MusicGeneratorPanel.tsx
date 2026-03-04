import React, { useEffect, useRef, useState } from "react";

type Provider = "suno" | "udio";
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export default function MusicGeneratorPanel() {
  const [provider, setProvider] = useState<Provider>("suno");
  const [prompt, setPrompt] = useState("电影感史诗配乐，适合动作预告片，鼓点强烈，旋律上头");
  const [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [debug, setDebug] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = false;
    return () => { stopRef.current = true; };
  }, []);

  async function start() {
    if (busy) return;
    setBusy(true);
    setResult(null);
    setTaskId("");
    setDebug({ ok: true, message: "clicked: start music" });

    try {
      const createOp = provider === "suno" ? "aimusicSunoCreate" : "aimusicUdioCreate";
      const taskOp   = provider === "suno" ? "aimusicSunoTask"   : "aimusicUdioTask";

      const body =
        provider === "suno"
          ? { task_type: "create_music", custom_mode: false, mv: "sonic-v4-5", gpt_description_prompt: prompt }
          : { prompt, task_type: "create_music", make_instrumental: true, mv: "FUZZ-2.0" };

      const cr = await fetch(`/api/jobs?op=${createOp}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const cj = await cr.json();
      setDebug(cj);

      const tid = cj?.json?.task_id || cj?.task_id;
      if (!tid) throw new Error("missing task_id (see debug)");
      setTaskId(String(tid));

      const startAt = Date.now();
      while (!stopRef.current) {
        if (Date.now() - startAt > 10 * 60 * 1000) throw new Error("timeout (10m)");

        const pr = await fetch(`/api/jobs?op=${taskOp}&taskId=${encodeURIComponent(String(tid))}`);
        const pj = await pr.json();
        setDebug(pj);

        const upstream = pj?.json ?? pj;
        const data = upstream?.data;

        if (Array.isArray(data) && data.length > 0) {
          const item = data[0];
          if (item?.audio_url || item?.video_url) { setResult(item); return; }
        }
        if (data && (data.audio_url || data.video_url)) { setResult(data); return; }

        const status = upstream?.status || upstream?.state || upstream?.task_status;
        if (status && String(status).toLowerCase() === "failed") throw new Error("task failed");

        await sleep(2500);
      }
    } catch (e: any) {
      setDebug({ ok: false, error: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 16, padding: 16, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)", color: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>音乐生成（测试）</div>
        <div style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, opacity: 0.85 }}>模型</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
            style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(0,0,0,0.25)", color: "white", fontWeight: 800 }}
          >
            <option value="suno">Suno（高质量）</option>
            <option value="udio">Udio（更便宜）</option>
          </select>
        </div>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        style={{ width: "100%", marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.25)", color: "white" }}
      />

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
        <button
          onClick={start}
          disabled={busy || !prompt.trim()}
          style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: busy ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.10)", color: "white", fontWeight: 900 }}
        >
          {busy ? "生成中…" : "开始生成"}
        </button>
        {taskId ? <div style={{ fontSize: 12, opacity: 0.85 }}>任务：<code>{taskId}</code></div> : null}
      </div>

      {result?.audio_url ? (
        <div style={{ marginTop: 12 }}>
          <audio controls src={result.audio_url} style={{ width: "100%" }} />
          <div style={{ marginTop: 6 }}>
            <a href={result.audio_url} target="_blank" rel="noreferrer">下载 / 打开 audio_url</a>
          </div>
        </div>
      ) : null}

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>调试输出（JSON）</summary>
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, fontSize: 12 }}>{JSON.stringify(debug, null, 2)}</pre>
      </details>
    </div>
  );
}
