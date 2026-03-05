import React, { useEffect, useRef, useState } from "react";
import BuildBadge from "../components/BuildBadge";

async function fetchJsonish(url: string, init?: RequestInit) {
  const resp = await fetch(url, init);
  const rawText = await resp.text();
  const contentType = resp.headers.get("content-type") || "";
  try {
    const json = JSON.parse(rawText);
    return { ok: resp.ok, status: resp.status, url, contentType, json };
  } catch (e: any) {
    return { ok: false, status: resp.status, url, contentType, parseError: e?.message || String(e), rawText: rawText.slice(0, 4000) };
  }
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function KlingPanel() {
  const [prompt, setPrompt] = useState("电影级场景，稳定镜头，高细节，人物一致性强");
  const [imageUrl, setImageUrl] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState<string>("");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [debug, setDebug] = useState<any>(null);
  const stopRef = useRef(false);

  useEffect(() => { stopRef.current = false; return () => { stopRef.current = true; }; }, []);

  async function toDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("read file failed"));
      fr.onload = () => resolve(String(fr.result || ""));
      fr.readAsDataURL(file);
    });
  }

  async function upload(file: File) {
    const dataUrl = await toDataUrl(file);
    // 统一走独立上传口（避免 /api/jobs 不稳定时上传挂）
    const j = await fetchJsonish("/api/blob-put-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl, filename: file.name }),
    });
    setDebug(j);
    const url = (j as any)?.json?.imageUrl || (j as any)?.imageUrl;
    if (!url) throw new Error("upload failed: no imageUrl. resp=" + JSON.stringify(j));
    setImageUrl(String(url));
    return String(url);
  }

  async function start() {
    if (busy) return;
    setBusy(true);
    setTaskId("");
    setVideoUrl("");
    setDebug({ ok: true, message: "clicked: klingCreate" });
    try {
      if (!imageUrl) throw new Error("请先上传参考图（图生视频）。");
      const cj = await fetchJsonish("/api/jobs?op=klingCreate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, prompt, duration: "10" }),
      });
      setDebug(cj);
      const tid = (cj as any)?.json?.taskId || (cj as any)?.json?.task_id;
      if (!tid) throw new Error("missing taskId. resp=" + JSON.stringify(cj));
      setTaskId(String(tid));

      for (let i = 0; i < 120 && !stopRef.current; i++) {
        const pj = await fetchJsonish(`/api/jobs?op=klingTask&taskId=${encodeURIComponent(String(tid))}`);
        setDebug(pj);
        const raw = (pj as any)?.json?.raw || (pj as any)?.json || {};
        const status = (pj as any)?.json?.taskStatus || raw?.data?.task_status || "";
        const msg = raw?.data?.task_status_msg || "";
        const vu = (pj as any)?.json?.videoUrl || raw?.data?.task_result?.videos?.[0]?.url || null;

        if (vu) { setVideoUrl(String(vu)); return; }
        if (String(status).toLowerCase() === "failed") throw new Error("kling failed: " + msg);
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
      <div style={{ fontSize: 18, fontWeight: 900 }}>可灵后端测试（Kling CN）</div>

      <div style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center" }}>
        <input type="file" accept="image/*"
          onChange={async (e) => {
            const f = (e.target as any).files?.[0];
            if (!f) return;
            try { await upload(f); } catch (err: any) { setDebug({ ok: false, error: err?.message || String(err) }); }
          }}
        />
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          {imageUrl ? <>已上传：<code>{imageUrl}</code></> : "未上传参考图"}
        </div>
      </div>

      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4}
        style={{ width: "100%", marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.25)", color: "white" }} />

      <button onClick={start} disabled={busy}
        style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: busy ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.10)", color: "white", fontWeight: 900 }}>
        {busy ? "生成中…" : "开始生成（10秒）"}
      </button>

      {taskId ? <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>任务：<code>{taskId}</code></div> : null}

      {videoUrl ? (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.20)" }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>生成结果（视频）</div>
          <video controls src={videoUrl} style={{ width: "100%", borderRadius: 12, background: "black" }} />
          <div style={{ marginTop: 8 }}>
            <a href={videoUrl} download target="_blank" rel="noreferrer"
              style={{ display: "inline-block", padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 900, textDecoration: "none" }}>
              下载 MP4
            </a>
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

type MusicProvider = "suno" | "udio";

function MusicPanel() {
  const [provider, setProvider] = useState<MusicProvider>("suno");
  const [prompt, setPrompt] = useState("电影感史诗配乐，适合动作预告片，鼓点强烈，旋律上头");
  const [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState<string>("");
  const [debug, setDebug] = useState<any>(null);

  // 核心：固定列表，不再依赖 debug 渲染
  const [clipsState, setClipsState] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  const stopRef = useRef(false);
  useEffect(() => { stopRef.current = false; return () => { stopRef.current = true; }; }, []);

  function clipsFrom(d: any) {
    const raw = d?.json?.raw || d?.raw || d?.json || {};
    const data = raw?.data;
    return Array.isArray(data) ? data : [];
  }

  const clips = clipsState.length ? clipsState : clipsFrom(debug);
  const selected = clips.find((c: any) => selectedId && c?.clip_id && String(c.clip_id) === selectedId) || (clips[0] || null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setTaskId("");
    setDebug({ ok: true, message: "clicked: music create" });
    setClipsState([]);
    setSelectedId("");

    try {
      const createOp = provider === "suno" ? "aimusicSunoCreate" : "aimusicUdioCreate";
      const taskOp   = provider === "suno" ? "aimusicSunoTask"   : "aimusicUdioTask";

      const cj = await fetchJsonish(`/api/jobs?op=${createOp}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      setDebug(cj);

      const raw = (cj as any)?.json?.raw || (cj as any)?.raw || (cj as any)?.json || {};
      const tid = raw?.task_id || raw?.data?.task_id || null;
      if (!tid) throw new Error("missing task_id. resp=" + JSON.stringify(cj));
      setTaskId(String(tid));

      for (let i = 0; i < 120 && !stopRef.current; i++) {
        const pj = await fetchJsonish(`/api/jobs?op=${taskOp}&taskId=${encodeURIComponent(String(tid))}`);
        setDebug(pj);
        const list = clipsFrom(pj);
        if (Array.isArray(list) && list.length) {
          setClipsState(list);
          const first = list.find((c:any)=>c?.audio_url) || list[0];
          if (first?.clip_id && !selectedId) setSelectedId(String(first.clip_id));
        }
        const okItem = list.find((c:any)=>c?.audio_url && String(c?.state||"").toLowerCase()==="succeeded");
        if (okItem) return;
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
        <select value={provider} onChange={(e) => setProvider(e.target.value as MusicProvider)}
          style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(0,0,0,0.25)", color: "white", fontWeight: 900 }}>
          <option value="suno">Suno（高质量）</option>
          <option value="udio">Udio（更便宜）</option>
        </select>
      </div>

      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4}
        style={{ width: "100%", marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.25)", color: "white" }} />

      <button onClick={start} disabled={busy}
        style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: busy ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.10)", color: "white", fontWeight: 900 }}>
        {busy ? "生成中…" : "开始生成"}
      </button>

      {taskId ? <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>任务：<code>{taskId}</code></div> : null}

      {Array.isArray(clips) && clips.length ? (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.20)" }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>生成结果（歌曲列表）</div>

          <div style={{ display: "grid", gap: 8 }}>
            {clips.map((c: any) => {
              const active = selectedId && c?.clip_id && selectedId === String(c.clip_id);
              return (
                <button key={String(c?.clip_id || Math.random())}
                  onClick={() => { if (!c?.audio_url) return; if (c?.clip_id) setSelectedId(String(c.clip_id)); }}
                  disabled={!c?.audio_url}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)",
                    color: "white",
                    cursor: c?.audio_url ? "pointer" : "not-allowed",
                    opacity: c?.audio_url ? 1 : 0.6,
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    gap: 10
                  }}
                >
                  {c?.image_url ? (
                    <img src={c.image_url} alt="cover" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover" }} />
                  ) : (
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: "rgba(255,255,255,0.08)" }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span>{c?.title || "未命名"}</span>
                      <span style={{ fontSize: 12, opacity: 0.75 }}>{c?.state || ""}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {selected?.audio_url ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>正在播放：<b>{selected?.title || "未命名"}</b></div>
              {selected?.image_url ? <img src={selected.image_url} alt="cover" style={{ width: 220, borderRadius: 12, objectFit: "cover", marginBottom: 10 }} /> : null}
              <audio controls autoPlay src={selected.audio_url} style={{ width: "100%" }} />
              <div style={{ marginTop: 6 }}>
                {String(selected?.state || "").toLowerCase() === "succeeded"
                  ? <a href={selected.audio_url} target="_blank" rel="noreferrer">下载 MP3</a>
                  : <span style={{ fontSize: 12, opacity: 0.8 }}>生成中…（完成后可下载）</span>}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 800 }}>调试输出（JSON）</summary>
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, fontSize: 12 }}>{JSON.stringify(debug, null, 2)}</pre>
      </details>
    </div>
  );
}

export default function RemixStudio() {
  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 20 }}>
      <BuildBadge />
      <h1 style={{ color: "white", fontSize: 22, fontWeight: 900, margin: 0 }}>可灵工作室（测试模式）</h1>
      <div style={{ color: "rgba(255,255,255,0.75)", marginTop: 6, fontSize: 13 }}>
        Kling（北京官方 image2video）与 Suno/Udio（AIMusicAPI）回归测试页。
      </div>
      <KlingPanel />
      <MusicPanel />
    </div>
  );
}
