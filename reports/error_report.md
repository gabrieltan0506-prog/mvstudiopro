
# MVStudioPro Error Report

Generated: 2026-03-05T02:00:11.398346 UTC

## 1 Repository Info
f995b39122806c5241ebc00342d278eacba59f4f


## 2 API Directory
api/vertex.ts.bak
api/diag/providers.ts
api/auth/verify-otp.ts.bak
api/auth/send-otp.ts.bak
api/utils/vertex.ts.bak
api/jobs.ts


## 3 Frontend API Calls
client/src/components/MusicGeneratorPanel.tsx:36:      const cr = await fetch(`/api/jobs?op=${createOp}`, {
client/src/components/MusicGeneratorPanel.tsx:52:        const pr = await fetch(`/api/jobs?op=${taskOp}&taskId=${encodeURIComponent(String(tid))}`);
client/src/components/MusicGenerator.tsx:45:              // Udio via Producer mapping in backend (/api/jobs ops)
client/src/components/MusicGenerator.tsx:52:      const cr = await fetch(`/api/jobs?op=${createOp}`, {
client/src/components/MusicGenerator.tsx:70:        const pr = await fetch(`/api/jobs?op=${taskOp}&taskId=${encodeURIComponent(String(tid))}`);
client/src/lib/jobs.ts:15:  const response = await fetch("/api/jobs", {
client/src/lib/jobs.ts:33:  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
client/src/pages/WorkflowStoryboardToVideo.tsx:9:    const r = await fetch("/api/jobs?op=wfCreate", {
client/src/pages/RemixStudio.tsx:45:    const j = await fetchJsonish("/api/jobs?op=blobPutImage", {
client/src/pages/RemixStudio.tsx:69:      const cj = await fetchJsonish("/api/jobs?op=klingCreate", {
client/src/pages/RemixStudio.tsx:95:        const pj = await fetchJsonish(`/api/jobs?op=klingTask&taskId=${encodeURIComponent(String(tid))}`);
client/src/pages/RemixStudio.tsx:206:      const cj = await fetchJsonish(`/api/jobs?op=${createOp}`, {
client/src/pages/RemixStudio.tsx:221:        const pj = await fetchJsonish(`/api/jobs?op=${taskOp}&taskId=${encodeURIComponent(tid)}`);
client/src/pages/AIFilmFactory.tsx:10:    const r = await fetch("/api/jobs?op=wfCreate", {
client/src/pages/TestLab.tsx:162:    const cr = await fetch(`/api/jobs?op=${createOp}`, {
client/src/pages/TestLab.tsx:179:      const pr = await fetch(`/api/jobs?op=${taskOp}&taskId=${encodeURIComponent(String(taskId))}`);
client/src/pages/TestLab.tsx:236:    const cr = await fetch(`/api/jobs?op=${createOp}`, {
client/src/pages/TestLab.tsx:251:      const pr = await fetch(`/api/jobs?op=${taskOp}&taskId=${encodeURIComponent(String(taskId))}`);
client/src/pages/TestLab.tsx:285:    const createResp = await fetch(musicProvider === "suno" ? "/api/jobs?op=aimusicSunoCreate" : "/api/jobs?op=aimusicUdioCreate", {
client/src/pages/TestLab.tsx:307:      const pollResp = await fetch(`/api/jobs?op=${musicProvider === "suno" ? "aimusicSunoTask" : "aimusicUdioTask"}&taskId=${encodeURIComponent(String(taskId))}`);
client/src/pages/TestLab.tsx:421:        const r = await jfetch("/api/jobs", {
client/src/pages/TestLab.tsx:456:        const r = await jfetch("/api/jobs", {
client/src/pages/TestLab.tsx:473:          const st = await jfetch(`/api/jobs?type=video&provider=${encodeURIComponent(videoProvider)}&taskId=${encodeURIComponent(taskId)}`);


## 4 Kling Usage
./api/jobs.ts:64:    if(op==="klingCreate"){
./client/src/pages/RemixStudio.tsx:64:    setDebug({ ok: true, message: "clicked: klingCreate" });
./client/src/pages/RemixStudio.tsx:69:      const cj = await fetchJsonish("/api/jobs?op=klingCreate", {


## 5 Music Usage
./server/routers/suno.ts:22:} from "../services/aimusic-producer";
./server/jobs/runner.ts:41:} from "../services/aimusic-producer";
./server/jobs/runner.ts:563:        provider: "aimusicapi",
./server/jobs/runner.ts:585:    return { provider: "aimusicapi", output: lastStatus };
./api/diag/providers.ts:26:    music: { enabled: true, provider: "aimusicapi", sunoCreateOp: "aimusicSunoCreate", sunoTaskOp: "aimusicSunoTask", creditsOp: "aimusicCredits" },
./api/jobs.ts:115:    const AIM_BASE = (s(process.env.AIMUSIC_BASE_URL)||"https://api.aimusicapi.ai").replace(/\/+$/,""
./api/jobs.ts:122:    if(op==="aimusicSunoCreate"){
./api/jobs.ts:142:    if(op==="aimusicSunoTask"){
./api_disabled/_core/aimusicapi.ts:13: * - baseUrl MUST be host-only, e.g. https://api.aimusicapi.ai
./api_disabled/_core/aimusicapi.ts:16:export async function aimusicFetch(path: string, init: RequestInit) {
./api_disabled/_core/aimusicapi.ts:17:  const baseUrl = (process.env.AIMUSIC_BASE_URL || "https://api.aimusicapi.ai").replace(/\/+$/, "");
./client/src/components/MusicGeneratorPanel.tsx:28:      const createOp = provider === "suno" ? "aimusicSunoCreate" : "aimusicUdioCreate";
./client/src/components/MusicGeneratorPanel.tsx:29:      const taskOp   = provider === "suno" ? "aimusicSunoTask"   : "aimusicUdioTask";
./client/src/components/MusicGenerator.tsx:33:      const createOp = provider === "suno" ? "aimusicSunoCreate" : "aimusicUdioCreate";
./client/src/components/MusicGenerator.tsx:34:      const taskOp = provider === "suno" ? "aimusicSunoTask" : "aimusicUdioTask";
./client/src/pages/RemixStudio.tsx:198:      const createOp = provider === "suno" ? "aimusicSunoCreate" : "aimusicUdioCreate";
./client/src/pages/RemixStudio.tsx:199:      const taskOp = provider === "suno" ? "aimusicSunoTask" : "aimusicUdioTask";
./client/src/pages/TestLab.tsx:143:    const createOp = musicProvider === "suno" ? "aimusicSunoCreate" : "aimusicUdioCreate";
./client/src/pages/TestLab.tsx:144:    const taskOp = musicProvider === "suno" ? "aimusicSunoTask" : "aimusicUdioTask";
./client/src/pages/TestLab.tsx:217:    const createOp = musicProvider === "suno" ? "aimusicSunoCreate" : "aimusicUdioCreate";
./client/src/pages/TestLab.tsx:218:    const taskOp = musicProvider === "suno" ? "aimusicSunoTask" : "aimusicUdioTask";
./client/src/pages/TestLab.tsx:285:    const createResp = await fetch(musicProvider === "suno" ? "/api/jobs?op=aimusicSunoCreate" : "/api/jobs?op=aimusicUdioCreate", {
./client/src/pages/TestLab.tsx:307:      const pollResp = await fetch(`/api/jobs?op=${musicProvider === "suno" ? "aimusicSunoTask" : "aimusicUdioTask"}&taskId=${encodeURIComponent(String(taskId))}`);
./src/components/AIMusicPanel.tsx:33:      const r = await fetch("/api/jobs?op=aimusicSunoCreate", {
./src/components/AIMusicPanel.tsx:58:        const pr = await fetch(`/api/jobs?op=aimusicSunoTask&taskId=${encodeURIComponent(String(tid))}`, {
./src/components/AIMusicPanel.tsx:93:        Calls <code>/api/jobs?op=aimusicSunoCreate</code> then polls <code>aimusicSunoTask</code>.


## 6 jobs.ts Head
import type { VercelRequest, VercelResponse } from "@vercel/node";
import crypto from "node:crypto";
import { put, getDownloadUrl } from "@vercel/blob";

function s(v:any){ if(v==null) return ""; if(Array.isArray(v)) return String(v[0] ?? ""); return String(v); }
function jparse(t:string){ try{return JSON.parse(t)}catch{return null} }
function body(req:VercelRequest){
  if(!req.body) return {}
  if(typeof req.body==="string") return jparse(req.body) ?? {}
  return req.body
}
function b64url(buf: Buffer){
  return buf.toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function jwtHS256(iss: string, secret: string){
  const header = b64url(Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"}),"utf-8"));
  const now = Math.floor(Date.now()/1000);
  const payload = b64url(Buffer.from(JSON.stringify({iss, iat: now, exp: now+3600}),"utf-8"));
  const unsigned = `${header}.${payload}`;
  const sig = crypto.createHmac("sha256", secret).update(unsigned).digest();
  return `${unsigned}.${b64url(sig)}`;
}
async function fetchJson(url:string, init:RequestInit){
  const r = await fetch(url, init);
  const text = await r.text();
  const json = jparse(text);
  return { ok: r.ok, status: r.status, url, json, rawText: text.slice(0,4000) };
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  try{
    const q:any=req.query||{};
    const b:any=req.method==="POST"?body(req):{};
    const op=s(q.op||b.op).trim();
    if(!op) return res.status(400).json({ok:false,error:"missing op"});

    // ---------- upload: blobPutImage ----------
    if(op==="blobPutImage"){
      const dataUrl = s(b.dataUrl);
      const filename = s(b.filename||"ref.png") || "ref.png";
      if(!dataUrl.startsWith("data:")) return res.status(400).json({ok:false,error:"missing_data_url"});
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if(!m) return res.status(400).json({ok:false,error:"invalid_data_url"});
      const mime = m[1];
      const b64 = m[2];
      const buf = Buffer.from(b64,"base64");
      if(!buf.length) return res.status(400).json({ok:false,error:"empty_file"});
      if(buf.length>10*1024*1024) return res.status(400).json({ok:false,error:"file_too_large",detail:"max 10MB"});
      const blob = await put(`refs/${Date.now()}-${filename}`, buf, { access:"private", contentType:mime });
      const downloadUrl = await getDownloadUrl(blob.url);
      return res.status(200).json({ ok:true, imageUrl: downloadUrl, blobUrl: blob.url, blob });
    }

    // ---------- Kling (CN Beijing) ----------
    const KLING_BASE = (s(process.env.KLING_CN_BASE_URL)||"https://api-beijing.klingai.com").replace(/\/+$/,""
);
    const KLING_AK = s(process.env.KLING_CN_VIDEO_ACCESS_KEY).trim();
    const KLING_SK = s(process.env.KLING_CN_VIDEO_SECRET_KEY).trim();
    if(!KLING_AK || !KLING_SK){
      return res.status(500).json({ok:false,error:"missing_env",detail:"Missing KLING_CN_VIDEO_ACCESS_KEY/SECRET_KEY"});
    }
    const KLING_TOKEN = jwtHS256(KLING_AK, KLING_SK);

    if(op==="klingCreate"){
      const imageUrl = s(b.imageUrl||b.image||q.imageUrl||q.image).trim();
      if(!imageUrl) return res.status(400).json({ok:false,error:"missing_image_url"});
      const prompt = s(b.prompt||q.prompt||"");
      const duration = s(b.duration||"10"); // doc enum "5"/"10"
      if(duration!=="5" && duration!=="10"){
        return res.status(400).json({ok:false,error:"invalid_duration",detail:duration});
      }
      const payload = {
        model_name: s(b.model_name||"kling-v2-6"),
        image: imageUrl,            // URL allowed in doc  [oai_citation:5‡Kling imagetoVideo.docx](sediment://file_0000000045fc71fd815421cc15312ce5)
        image_tail: s(b.image_tail||""),
        prompt,
        negative_prompt: s(b.negative_prompt||""),
        duration,
        mode: s(b.mode||"pro"),
        sound: s(b.sound||"off"),
        callback_url: s(b.callback_url||""),
        external_task_id: s(b.external_task_id||"")
      };

      const r = await fetchJson(`${KLING_BASE}/v1/videos/image2video`,{
        method:"POST",
        headers:{
          "Authorization":"Bearer "+KLING_TOKEN,      // doc says Bearer <token>  [oai_citation:6‡Kling imagetoVideo.docx](sediment://file_0000000045fc71fd815421cc15312ce5)
          "Content-Type":"application/json",
          "Accept":"application/json"
        },
        body: JSON.stringify(payload)
      });

      const taskId = r.json?.data?.task_id || null;
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, url:r.url, taskId, raw:r.json ?? r.rawText });
    }

    if(op==="klingTask"){
      const taskId = s(q.taskId||b.taskId||q.task_id||b.task_id).trim();
      if(!taskId) return res.status(400).json({ok:false,error:"missing_task_id"});
      const r = await fetchJson(`${KLING_BASE}/v1/videos/image2video/${encodeURIComponent(taskId)}`,{
        method:"GET",
        headers:{
          "Authorization":"Bearer "+KLING_TOKEN,
          "Accept":"application/json"
        }
      });
      const taskStatus = s(r.json?.data?.task_status||"");
      const videoUrl = r.json?.data?.task_result?.videos?.[0]?.url || null; // doc  [oai_citation:7‡Kling imagetoVideo.docx](sediment://file_0000000045fc71fd815421cc15312ce5)
      return res.status(r.ok?200:502).json({ ok:r.ok, status:r.status, url:r.url, taskStatus, videoUrl, raw:r.json ?? r.rawText });
    }

    // ---------- AIMusic (Suno) ----------
    const AIM_BASE = (s(process.env.AIMUSIC_BASE_URL)||"https://api.aimusicapi.ai").replace(/\/+$/,""
);
    const AIM_KEY  = s(process.env.AIMUSIC_API_KEY||process.env.AIMUSICAPI_KEY).trim();
    if(!AIM_KEY){
      return res.status(500).json({ok:false,error:"missing_env",detail:"Missing AIMUSIC_API_KEY"});
    }


## 7 RemixStudio Upload Section
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


## 8 Known Errors

### Blob Upload
Private store vs public access mismatch.

### Kling
Depends on blob upload imageUrl.

### Music
API returns task_id but UI sometimes misses parsing.

## 9 Deployment Context
Platform: Vercel
Region: iad1
Build Tool: Vite
