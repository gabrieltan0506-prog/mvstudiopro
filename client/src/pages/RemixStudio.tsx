import React, { useEffect, useRef, useState } from "react";

import MusicGeneratorPanel from "../components/MusicGeneratorPanel";
import BuildBadge from "../components/BuildBadge";
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function KlingTestPanel() {
  const [prompt, setPrompt] = useState("电影级动作预告片风格，夜景城市，强对比灯光，稳定镜头");

  const [upgradeMsg, setUpgradeMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState("");
  const [debug, setDebug] = useState<any>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    stopRef.current = false;
    return (
      <>
        <BuildBadge />) => {
      stopRef.current = true;
    };
  }, []);

  async function start() {
    if (busy) return;
    setBusy(true);
    setDebug({ ok: true, message: "creating..." });
    setTaskId("");

    try {
      const cr = await fetch("/api/jobs?op=klingCreate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, duration: 8 }),
      });

      const cj = await cr.json();
      setDebug(cj);

      const tid =
        cj?.json?.taskId ||
        cj?.json?.task_id ||
        cj?.taskId ||
        cj?.task_id ||
        cj?.json?.data?.taskId ||
        cj?.json?.data?.task_id ||
        cj?.data?.taskId ||
        cj?.data?.task_id;

      if (!tid) return;
      setTaskId(String(tid));

      const startAt = Date.now();
      while (!stopRef.current) {
        if (Date.now() - startAt > 10 * 60 * 1000) throw new Error("轮询超时（10分钟）");

        const pr = await fetch(`/api/jobs?op=klingTask&taskId=${encodeURIComponent(String(tid))}`);
        const pj = await pr.json();
        setDebug(pj);

        const status = pj?.json?.status || pj?.status || pj?.json?.state || pj?.state;
        const videoUrl = pj?.json?.videoUrl || pj?.json?.video_url || pj?.videoUrl || pj?.video_url;

        if (videoUrl) return;
        if (status && String(status).toLowerCase() === "failed") throw new Error("任务失败：" + JSON.stringify(pj));

        await sleep(2500);
      }

  async function redeemUpgrade(upgradeToken: string) {
    setUpgradeMsg("领取中...");
    const r = await fetch("/api/jobs?op=redeemVeoProUpgrade", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-User-Tier": "paid"
      },
      body: JSON.stringify({ upgradeToken })
    });
    const j = await r.json();
    setUpgradeMsg(j?.message || j?.error || JSON.stringify(j));
  }
    } catch (e: any) {
      setDebug({ ok: false, error: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  const videoUrl = debug?.json?.videoUrl || debug?.json?.video_url || debug?.videoUrl || debug?.video_url;

  return (
    <div
      style={{
        marginTop: 16,
        padding: 16,
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(0,0,0,0.25)",
        color: "white",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>可灵后端测试（Kling CN）</div>
        {taskId ? (
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            任务：<code>{taskId}</code>
          </div>
        ) : null}
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        style={{
          width: "100%",
          marginTop: 10,
          padding: 10,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.15)",
          background: "rgba(0,0,0,0.25)",
          color: "white",
        }}
      />

      <button
        onClick={start}
        disabled={busy || !prompt.trim()}
        style={{
          marginTop: 10,
          padding: "10px 14px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.18)",
          background: busy ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.10)",
          color: "white",
          fontWeight: 800,
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        {busy ? "生成中…" : "开始生成（8秒）"}
      </button>

      {videoUrl ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>videoUrl</div>
          <a href={videoUrl} target="_blank" rel="noreferrer">
            打开 / 下载
          </a>
        </div>
      ) : null}

      
      {debug?.upgradeEligible ? (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.20)" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Kling 排队过长（超过90秒）</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 10 }}>
            仅限付费用户：我们送你一次 Veo 3.1 Pro 免费升级（当天最多一次）。
          </div>
          <button
            onClick={() => redeemUpgrade(debug?.upgradeToken)}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.10)",
              color: "white",
              fontWeight: 800,
              cursor: "pointer"
            }}
          >
            领取免费升级
          </button>
          {upgradeMsg ? (
            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
              {upgradeMsg}
            </div>
          ) : null}
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
            领取后：请去 Veo 3.1 Pro 的生成入口发起一次生成（我们下一步把“免扣费”接到 Veo Pro）。
          </div>
        </div>
      ) : null}

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>调试输出（JSON）</summary>
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, fontSize: 12 }}>{JSON.stringify(debug, null, 2)}</pre>
      </details>
    </div>
  );
}

export default function RemixStudio() {
  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 20 }}>
      <h1 style={{ color: "white", fontSize: 22, fontWeight: 900, margin: 0 }}>可灵工作室（测试模式）</h1>
      <div style={{ color: "rgba(255,255,255,0.75)", marginTop: 6, fontSize: 13 }}>
        先跑通 Kling 后端链路：create → task → videoUrl。UI 后续再美化。
      </div>
      <KlingTestPanel />
        <MusicGeneratorPanel />
    </div>
  );
}
