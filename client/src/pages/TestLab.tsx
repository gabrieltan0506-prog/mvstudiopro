import { useEffect, useState } from "react";

export default function TestLab() {
  const [authOk, setAuthOk] = useState<boolean | null>(null);
  const [user, setUser] = useState<any>(null);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/me")
      .then(r => r.json())
      .then(d => {
        if (d?.ok) {
          setAuthOk(true);
          setUser(d.user);
        } else {
          setAuthOk(false);
        }
      })
      .catch(() => setAuthOk(false));
  }, []);

  if (authOk === null) {
    return <div style={{padding:40}}>Checking login...</div>;
  }

  if (!authOk) {
    return (
      <div style={{padding:40}}>
        <h2>请先登录</h2>
        <a href="/login">去登录</a>
      </div>
    );
  }

  async function runImage() {
    setLoading(true);
    setResult(null);

    const r = await fetch("/api/jobs", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        provider: "nano-banana-flash",
        prompt
      })
    });

    const d = await r.json();
    setResult(d);
    setLoading(false);
  }

  async function runVideo() {
    setLoading(true);
    setResult(null);

    const r = await fetch("/api/jobs", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        provider: "veo",
        prompt
      })
    });

    const d = await r.json();
    setResult(d);
    setLoading(false);
  }

  return (
    <div style={{padding:40}}>
      <h1>Test Lab</h1>

      <div style={{marginBottom:20}}>
        登录状态：{user?.role} / {user?.email}
      </div>

      <textarea
        value={prompt}
        onChange={e=>setPrompt(e.target.value)}
        placeholder="输入测试 prompt"
        style={{width:"100%",height:120}}
      />

      <div style={{marginTop:20}}>
        <button onClick={runImage} disabled={loading}>
          测试生图
        </button>

        <button onClick={runVideo} disabled={loading} style={{marginLeft:10}}>
          测试视频
        </button>
      </div>

      <pre style={{marginTop:20,whiteSpace:"pre-wrap"}}>
        {JSON.stringify(result,null,2)}
      </pre>
    </div>
  );
}
