import { useEffect, useMemo, useState } from "react";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

async function jfetch(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const text = await r.text();
  try { return { ok: r.ok, status: r.status, json: JSON.parse(text) }; }
  catch { return { ok: r.ok, status: r.status, json: null, text }; }
}

export default function TestLab() {
  const [mode, setMode] = useState<"image" | "video">("image");
  const [prompt, setPrompt] = useState("");

  const [imageProvider] = useState("gemini-3-pro-image-preview");
  const [imageSize, setImageSize] = useState<"1K" | "2K" | "4K">("1K");

  const [videoProvider, setVideoProvider] = useState<"veo-3.1-generate-001" | "veo-3.1-fast-generate-001">("veo-3.1-generate-001");
  const [videoAspectRatio, setVideoAspectRatio] = useState<"16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9">("16:9");
  const [videoResolution, setVideoResolution] = useState<"720p" | "1080p">("720p");
  const [videoImageDataUrl, setVideoImageDataUrl] = useState("");
  const [videoImageName, setVideoImageName] = useState("");

  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const [imageUrl, setImageUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [rawJson, setRawJson] = useState<any>(null);

  const title = useMemo(() => (mode === "image" ? "图像生成" : "视频生成"), [mode]);

  async function run() {
    setBusy(true);
    setStatus("生成中...");
    setRawJson(null);
    setImageUrl("");
    setVideoUrl("");

    try {
      const body: any = { type: mode, prompt };

      if (mode === "image") {
        body.provider = imageProvider;
        body.imageSize = imageSize;
      }

      if (mode === "video") {
        if (!videoImageDataUrl) {
          setStatus("失败（请先上传参考图）");
          return;
        }
        body.provider = videoProvider;
        body.imageDataUrl = videoImageDataUrl;
        body.aspect_ratio = videoAspectRatio;
        body.resolution = videoResolution;
        body.duration = 8;
        body.generateAudio = false;
      }

      const r = await jfetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setRawJson(r.json);

      if (mode === "image" && r.json?.imageUrl) setImageUrl(r.json.imageUrl);
      if (mode === "video" && r.json?.taskId) setStatus("已提交，轮询中...");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!rawJson?.taskId) return;
    const tid = rawJson.taskId;
    const interval = setInterval(async () => {
      const r = await jfetch(`/api/jobs?type=video&taskId=${encodeURIComponent(tid)}&provider=${encodeURIComponent(videoProvider)}`);
      setRawJson(r.json);
      if (r.json?.videoUrl) {
        setVideoUrl(r.json.videoUrl);
        setStatus("完成");
        clearInterval(interval);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [rawJson, videoProvider]);

  return (
    <div style={{ padding: 24, fontFamily: "sans-serif" }}>
      <h2>{title}</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => setMode("image")}>图像</button>
        <button onClick={() => setMode("video")}>视频</button>
      </div>

      {mode === "image" && (
        <div>
          <label>尺寸:
            <select value={imageSize} onChange={e => setImageSize(e.target.value as any)}>
              <option value="1K">1K</option>
              <option value="2K">2K</option>
              <option value="4K">4K</option>
            </select>
          </label>
        </div>
      )}

      {mode === "video" && (
        <div>
          <label>模型:
            <select value={videoProvider} onChange={e => setVideoProvider(e.target.value as any)}>
              <option value="veo-3.1-generate-001">Veo 3.1 Pro</option>
              <option value="veo-3.1-fast-generate-001">Veo 3.1 Rapid</option>
            </select>
          </label>

          <label>分辨率:
            <select value={videoResolution} onChange={e => setVideoResolution(e.target.value as any)}>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
          </label>

          <label>比例:
            <select value={videoAspectRatio} onChange={e => setVideoAspectRatio(e.target.value as any)}>
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
              <option value="21:9">21:9</option>
            </select>
          </label>

          <div>
            <label>
              上传参考图:
              <input type="file" accept="image/*" onChange={async e => {
                const f = e.target.files?.[0];
                if (!f) return;
                const d = await fileToDataUrl(f);
                setVideoImageDataUrl(d);
                setVideoImageName(f.name);
              }} />
            </label>
            {videoImageName && <span>{videoImageName}</span>}
          </div>
        </div>
      )}

      <textarea
        rows={4}
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="输入提示词…"
      />

      <button disabled={busy} onClick={run}>
        {busy ? "生成中…" : "开始生成"}
      </button>

      <div>{status}</div>
      {imageUrl && <div><img src={imageUrl} style={{ maxWidth: "100%" }} /></div>}
      {videoUrl && <div><video src={videoUrl} controls style={{ maxWidth: "100%" }} /></div>}

      <pre style={{ fontSize: 12, marginTop: 12 }}>{JSON.stringify(rawJson, null, 2)}</pre>
    </div>
  );
}
