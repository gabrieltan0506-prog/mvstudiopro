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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("read file failed"));
    fr.onload = () => resolve(String(fr.result || ""));
    fr.readAsDataURL(file);
  });
}

function KlingPanel() {
  const [prompt, setPrompt] = useState("电影级动作预告片风格，夜景城市，强对比灯光，稳定镜头");
  const [imageUrl, setImageUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [debug, setDebug] = useState<any>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = false;
    return () => { stopRef.current = true; };
  }, []);

  async function upload(file: File) {
    const dataUrl = await toDataUrl(file);

    const j = await fetchJsonish("/api/jobs?op=blobPutImage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl, filename: file.name }),
    });

    setDebug(j);

    const url = j?.imageUrl || j?.json?.imageUrl || j?.blob?.url || j?.json?.blob?.url;
    if (!url) throw new Error("upload failed: no imageUrl. resp=" + JSON.stringify(j));

    setImageUrl(String(url));
    return String(url);
  }

  async function start() {
    if (busy) return;
    setBusy(true);
    setTaskId("");
    setDebug({ ok: true, message: "clicked: klingCreate" });

    try {
      if (!imageUrl) throw new Error("请先上传参考图");

      const cj = await fetchJsonish("/api/jobs?op=klingCreate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "video",
          provider: "rapid",
          imageUrl,
          prompt,
          duration: 8
        }),
      });
      setDebug(cj);

      const tid =
        cj?.json?.taskId || cj?.json?.task_id ||
        cj?.json?.json?.taskId || cj?.json?.json?.task_id ||
        cj?.json?.data?.taskId || cj?.json?.data?.task_id ||
        cj?.taskId || cj?.task_id;

      if (!tid) return;
      setTaskId(String(tid));

      const startAt = Date.now();
      while (!stopRef.current) {
        if (Date.now() - startAt > 10 * 60 * 1000) throw new Error("轮询超时（10分钟）");

        const pj = await fetchJsonish(`/api/jobs?op=klingTask&taskId=${encodeURIComponent(String(tid))}`);
        setDebug(pj);

        const status = pj?.json?.status || pj?.json?.state || pj?.json?.json?.status || pj?.json?.json?.state;
        const videoUrl = pj?.json?.videoUrl || pj?.json?.video_url || pj?.json?.json?.videoUrl || pj?.json?.json?.video_url;

        if (videoUrl) return;
        if (status && String(status).toLowerCase() === "failed") throw new Error("任务失败");
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
        <input
          type="file"
          accept="image/*"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try { await upload(f); } catch (err: any) { setDebug({ ok:false, error: err?.message || String(err) }); }
          }}
        />
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          {imageUrl ? <>已上传：<code>{imageUrl}</code></> : "未上传参考图"}
        </div>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        style={{ width: "100%", marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.25)", color: "white" }}
      />

      <button
        onClick={start}
        disabled={busy}
        style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: busy ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.10)", color: "white", fontWeight: 900 }}
      >
        {busy ? "生成中…" : "开始生成（8秒）"}
      </button>

      {taskId ? (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>任务：<code>{taskId}</code></div>
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
  const [taskId, setTaskId] = useState("");
  const [debug, setDebug] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = false;
    return () => { stopRef.current = true; };
  }, []);

  function extractTaskId(anyResp: any): string {
    const j = anyResp?.json ?? anyResp;
    const cands = [
      j?.task_id, j?.taskId,
      j?.json?.task_id, j?.json?.taskId,
      j?.data?.task_id, j?.data?.taskId,
      j?.json?.data?.task_id, j?.json?.data?.taskId,
      j?.result?.task_id, j?.result?.taskId
    ];
    for (const x of cands) {
      const v = String(x || "").trim();
      if (v) return v;
    }
    return "";
  }

  async function start() {
    if (busy) return;
    setBusy(true);
    setTaskId("");
    setResult(null);
    setDebug({ ok: true, message: "clicked: music create" });

    try {
      const createOp = provider === "suno" ? "aimusicSunoCreate" : "aimusicUdioCreate";
      const taskOp = provider === "suno" ? "aimusicSunoTask" : "aimusicUdioTask";

      const body =
        provider === "suno"
          ? { task_type: "create_music", custom_mode: false, mv: "sonic-v4-5", gpt_description_prompt: prompt }
          : { prompt, task_type: "create_music", make_instrumental: true, mv: "FUZZ-2.0" };

      const cj = await fetchJsonish(`/api/jobs?op=${createOp}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setDebug(cj);

      const tid = extractTaskId(cj);
      if (!tid) throw new Error("missing task_id (see debug)");
      setTaskId(tid);

      const startAt = Date.now();
      while (!stopRef.current) {
        if (Date.now() - startAt > 10 * 60 * 1000) throw new Error("timeout (10m)");

        const pj = await fetchJsonish(`/api/jobs?op=${taskOp}&taskId=${encodeURIComponent(tid)}`);
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
      setDebug({ ok: false, error: e?.message || String(e), last: debug });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 16, padding: 16, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)", color: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 900 }}>音乐生成（测试）</div>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as MusicProvider)}
          style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(0,0,0,0.25)", color: "white", fontWeight: 900 }}
        >
          <option value="suno">Suno（高质量）</option>
          <option value="udio">Udio（更便宜）</option>
        </select>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        style={{ width: "100%", marginTop: 10, padding: 10, borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.25)", color: "white" }}
      />

      <button
        onClick={start}
        disabled={busy}
        style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", background: busy ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.10)", color: "white", fontWeight: 900 }}
      >
        {busy ? "生成中…" : "开始生成"}
      </button>

      {taskId ? (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>任务：<code>{taskId}</code></div>
      ) : null}

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

export default function RemixStudio() {
  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 20 }}>
      <BuildBadge />
      <h1 style={{ color: "white", fontSize: 22, fontWeight: 900, margin: 0 }}>可灵工作室（测试模式）</h1>
      <div style={{ color: "rgba(255,255,255,0.75)", marginTop: 6, fontSize: 13 }}>
        先跑通 Kling（北京官方 image2video）与音乐（AIMusicAPI）。UI 后续再美化。
      </div>

      <KlingPanel />
      <MusicPanel />
    </div>
  );
}
