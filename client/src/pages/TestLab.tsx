import { useEffect, useState } from "react";

type MeResp =
  | { ok: true; user?: { id: string; email?: string; role?: string }; credits?: number }
  | { ok: false; error?: string };

async function getMe(): Promise<MeResp> {
  const r = await fetch("/api/me", { credentials: "include" });
  return (await r.json()) as MeResp;
}

type ImgProvider = "nano-banana-flash" | "nano-banana-pro" | "kling_image";

export default function TestLab() {
  const [me, setMe] = useState<MeResp | null>(null);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const [imgProvider, setImgProvider] = useState<ImgProvider>("nano-banana-flash");

  useEffect(() => {
    getMe().then(setMe).catch(() => setMe({ ok: false, error: "fetch /api/me failed" }));
  }, []);

  const authed = !!me && (me as any).ok === true;

  async function postJobs(payload: any) {
    const r = await fetch("/api/jobs", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return { ok: false, error: `non-json response (${r.status})` };
    return await r.json();
  }

  async function runImage() {
    setLoading(true);
    setResult(null);
    const data = await postJobs({
      type: "image",
      provider: imgProvider,
      input: { prompt, size: "1024" },
    });
    setResult(data);
    setLoading(false);
  }

  async function runVideo() {
    setLoading(true);
    setResult(null);
    const data = await postJobs({
      type: "video",
      provider: "kling_beijing",
      input: { prompt, duration: 8, aspect_ratio: "16:9" },
    });
    setResult(data);
    setLoading(false);
  }

  if (!authed) {
    return (
      <div style={{ padding: 40 }}>
        <h2>请先登录</h2>
        <div style={{ marginTop: 8, color: "#666" }}>
          先打开：/api/admin/dev-login → 再确认 /api/me 为 ok:true → 再回到 /test-lab
        </div>
        <a href="/login" style={{ display: "inline-block", marginTop: 12 }}>去登录</a>
        <pre style={{ marginTop: 16, whiteSpace: "pre-wrap" }}>{JSON.stringify(me, null, 2)}</pre>
      </div>
    );
  }

  return (
    <div style={{ padding: 40 }}>
      <h1>Test Lab</h1>

      <div style={{ marginBottom: 12 }}>
        登录状态：{(me as any)?.user?.role} / {(me as any)?.user?.email || (me as any)?.user?.id} ｜ Credits：{(me as any)?.credits ?? "-"}
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="输入测试 prompt"
        style={{ width: "100%", height: 120 }}
      />

      <div style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 10 }}>
          生图引擎：
          <select value={imgProvider} onChange={(e) => setImgProvider(e.target.value as ImgProvider)} style={{ marginLeft: 8 }}>
            <option value="nano-banana-flash">nano-banana-flash（免费）</option>
            <option value="nano-banana-pro">nano-banana-pro（付费）</option>
            <option value="kling_image">kling_image（付费）</option>
          </select>
        </div>

        <button onClick={runImage} disabled={loading || !prompt.trim()}>
          测试生图
        </button>

        <button onClick={runVideo} disabled={loading || !prompt.trim()} style={{ marginLeft: 10 }}>
          测试视频（kling_beijing）
        </button>
      </div>

      {result?.imageUrl ? (<div style={{marginTop:16}}><img src={result.imageUrl} style={{maxWidth:'100%',borderRadius:12}} /></div>) : null}

<pre style={{ marginTop: 20, whiteSpace: "pre-wrap" }}>
        {JSON.stringify(result, null, 2)}
      </pre>
    </div>
  );
}
