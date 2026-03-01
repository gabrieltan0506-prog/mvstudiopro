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
      body: JSON.stringify({ type, prompt, model })
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
        <pre style={{marginTop:20,background:"#111",color:"#0f0",padding:20}}>
          {JSON.stringify(result,null,2)}
        </pre>
      )}
    </div>
  );
}
