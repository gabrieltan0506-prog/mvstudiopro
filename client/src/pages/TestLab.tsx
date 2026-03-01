import { useState } from "react";

export default function TestLab() {
  const [prompt, setPrompt] = useState("");
  const [type, setType] = useState("image");
  const [model, setModel] = useState("nano-banana-flash");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setResult(null);
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, prompt, model, provider: model })
    });
    const json = await res.json();
    setResult(json);
    setLoading(false);
  };

  return (
    <div style={{padding:40}}>
      <h1>测试台</h1>

      <select value={type} onChange={e=>setType(e.target.value)}>
        <option value="image">图像</option>
        <option value="video">视频</option>
        <option value="music">音乐</option>
      </select>

      {type==="music" && (
        <select value={model} onChange={e=>setModel(e.target.value)}>
          <option value="suno">Suno</option>
          <option value="udio">Udio</option>
        </select>
      )}

      {type==="image" && (
        <select value={model} onChange={e=>setModel(e.target.value)}>
          <option value="nano-banana-flash">Nano Flash</option>
          <option value="nano-banana-pro">Nano Pro</option>
        </select>
      )}

      <textarea
        style={{width:"100%",height:100,marginTop:20}}
        value={prompt}
        onChange={e=>setPrompt(e.target.value)}
        placeholder="输入prompt"
      />

      <button onClick={run} disabled={loading}>
        {loading ? "生成中..." : "开始生成"}
      </button>

      {result && (
        <>
          {result?.imageUrl ? (
            <div style={{ marginTop: 20 }}>
              <div style={{ marginBottom: 8 }}>图片预览</div>
              <img src={result.imageUrl} alt="generated" style={{ maxWidth: "100%", borderRadius: 8 }} />
            </div>
          ) : Array.isArray(result?.images) && result.images.length ? (
            <div style={{ marginTop: 20 }}>
              <div style={{ marginBottom: 8 }}>图片预览</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
                {result.images.map((u: string, i: number) => (
                  <img key={i} src={u} alt={`generated-${i}`} style={{ width: "100%", borderRadius: 8 }} />
                ))}
              </div>
            </div>
          ) : result?.videoUrl ? (
            <div style={{ marginTop: 20 }}>
              <div style={{ marginBottom: 8 }}>视频预览</div>
              <video src={result.videoUrl} controls style={{ maxWidth: "100%", borderRadius: 8 }} />
            </div>
          ) : null}

          <pre style={{marginTop:20,background:"#111",color:"#0f0",padding:20}}>
            {JSON.stringify(result,null,2)}
          </pre>
        </>
      )}
    </div>
  );
}
