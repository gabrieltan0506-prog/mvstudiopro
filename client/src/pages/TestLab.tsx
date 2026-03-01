import { useEffect, useState } from "react";

type MeResp =
  | { ok: true; user?: { id: string; email?: string; role?: string }; credits?: number }
  | { ok: false; error?: string };

async function getMe(): Promise<MeResp> {
  const r = await fetch("/api/me", { credentials: "include" });
  return (await r.json()) as MeResp;
}

export default function TestLab() {
  const [me, setMe] = useState<MeResp | null>(null);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getMe().then(setMe).catch(() => setMe({ ok: false, error: "fetch /api/me failed" }));
  }, []);

  const authed = !!me && (me as any).ok === true;

  async function postJob(payload: any) {
    const r = await fetch("/api/jobs", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return { ok: false, error: `non-json response (${r.status})` };
    }
    return await r.json();
  }

  async function runImage() {
    setLoading(true);
    setResult(null);

    // ✅ 统一：后端支持的 provider 名称
    // ✅ 统一：请求体使用 { provider, input }，避免后端只读某个字段导致 Unsupported provider
    const data = await postJob({
      provider: "nano-banana-flash",
      type: "image",
      input: { prompt, size: "1024" },
      prompt, // 兼容旧实现
    });

    setResult(data);
    setLoading(false);
  }

  async function runVideo() {
    setLoading(true);
    setResult(null);

    const data = await postJob({
      provider: "kling_beijing",
      type: "video",
      input: { prompt, duration: 8, aspect_ratio: "16:9" },
      prompt, // 兼容旧实现
    });

    setResult(data);
    setLoading(false);
  }

  if (!authed) {
    return (
      <div style={{ padding: 40 }}>
        <h2>请先登录</h2>
        <div style={{ marginTop: 8, color: "#666" }}>
          如果你已用 Dev Admin 登录但仍看到此页：先打开一次 /api/me，再刷新。
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
        <button onClick={runImage} disabled={loading || !prompt.trim()}>
          测试生图（nano-banana-flash）
        </button>
        <button onClick={runVideo} disabled={loading || !prompt.trim()} style={{ marginLeft: 10 }}>
          测试视频（kling_beijing）
        </button>
      </div>

      <pre style={{ marginTop: 20, whiteSpace: "pre-wrap" }}>
        {JSON.stringify(result, null, 2)}
      </pre>
    </div>
  );
}
