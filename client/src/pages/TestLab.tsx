import { useEffect, useMemo, useState } from "react";

type AnyObj = Record<string, any>;

async function jfetch(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const text = await r.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, json: j, text };
}

export default function TestLab() {
  const [me, setMe] = useState<AnyObj | null>(null);
  const [prompt, setPrompt] = useState("1K 赛博风格女偶像，电影级光影，超精细");
  const [mode, setMode] = useState<"image" | "video" | "audio">("image");
  const [imageProvider, setImageProvider] = useState<"nano-banana-flash" | "nano-banana-pro" | "kling_image">("nano-banana-flash");
  const [klingRoute, setKlingRoute] = useState<"auto" | "beijing" | "singapore">("auto");
  const [klingModelName, setKlingModelName] = useState("kling-v2-1");

  const [videoProvider, setVideoProvider] = useState<"kling_beijing">("kling_beijing");
  const [audioProvider, setAudioProvider] = useState<"suno" | "udio">("udio");
  const [duration, setDuration] = useState(60);

  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const [imageUrl, setImageUrl] = useState<string>("");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [audioUrl, setAudioUrl] = useState<string>("");

  const [raw, setRaw] = useState<any>(null);

  const title = useMemo(() => {
    if (mode === "image") return "生图测试";
    if (mode === "video") return "视频测试";
    return "音乐测试";
  }, [mode]);

  async function loadMe() {
    const r = await jfetch("/api/me");
    if (r.ok && r.json?.ok) setMe(r.json);
    else setMe(null);
  }

  useEffect(() => { loadMe(); }, []);

  async function run() {
    setBusy(true);
    setStatus("生成中…");
    setRaw(null);
    setImageUrl("");
    setVideoUrl("");
    setAudioUrl("");
    try {
      if (mode === "image") {
        const body = { type: "image", provider: imageProvider, prompt } as any;
        if (imageProvider === "kling_image") {
          const kr = await jfetch("/api/kling/image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt, model_name: klingModelName, route: klingRoute, n: 1 }),
          });
          setRaw(kr.json ?? kr.text);
          if (!kr.ok || !kr.json?.ok || !kr.json?.taskId) {
            setStatus(`失败（${kr.status}）`);
            return;
          }
          const taskId = kr.json.taskId as string;
          setStatus("可灵生图生成中…（轮询）");
          for (let i = 0; i < 60; i++) {
            await new Promise((res) => setTimeout(res, 2000));
            const st = await jfetch(`/api/kling/image-status?taskId=${encodeURIComponent(taskId)}&route=${encodeURIComponent(klingRoute)}`);
            if (st.json) setRaw(st.json);
            const url = st.json?.imageUrl;
            if (url) {
              setImageUrl(url);
              setStatus("完成");
              return;
            }
          }
          setStatus("超时：未拿到图片地址");
          return;
        }
        const r = await jfetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        setRaw(r.json ?? r.text);
        if (!r.ok || !r.json?.ok || !r.json?.imageUrl) {
          setStatus(`失败（${r.status}）`);
          return;
        }
        setImageUrl(r.json.imageUrl);
        setStatus("完成");
        return;
      }

      if (mode === "video") {
        const body = { type: "video", provider: videoProvider, prompt, duration: 8, aspect_ratio: "16:9" };
        const r = await jfetch(`/api/jobs?provider=${encodeURIComponent(videoProvider)}&prompt=${encodeURIComponent(prompt)}`, {
          method: "GET",
        });
        setRaw(r.json ?? r.text);
        if (!r.ok || !r.json?.ok || !r.json?.taskId) {
          setStatus(`失败（${r.status}）`);
          return;
        }
        const taskId = r.json.taskId as string;
        setStatus("视频生成中…（轮询）");

        // 轮询（最多 60 次）
        for (let i = 0; i < 60; i++) {
          await new Promise(res => setTimeout(res, 3000));
          const st = await jfetch(`/api/jobs?provider=${encodeURIComponent(videoProvider)}&taskId=${encodeURIComponent(taskId)}`);
          if (st.json) setRaw(st.json);
          const vids = st.json?.raw?.data?.[0]?.task_result?.videos || st.json?.raw?.data?.task_result?.videos;
          const url = vids?.[0]?.url;
          if (url) {
            setVideoUrl(url);
            setStatus("完成");
            return;
          }
        }
        setStatus("超时：未拿到视频地址");
        return;
      }

      // audio
      {
        const body = { type: "audio", provider: audioProvider, prompt, duration };
        const r = await jfetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        setRaw(r.json ?? r.text);
        if (!r.ok || !r.json?.ok) {
          setStatus(`失败（${r.status}）`);
          return;
        }
        // 尽量从返回里找可播放链接（不同供应商字段可能不同）
        const raw = r.json?.raw;
        const url =
          raw?.data?.audio_url ||
          raw?.data?.streamUrl ||
          raw?.data?.url ||
          raw?.audio_url ||
          raw?.streamUrl ||
          raw?.url ||
          "";
        if (url) {
          setAudioUrl(url);
          setStatus("完成");
        } else {
          setStatus("已提交（未返回音频链接，需接入 status 轮询时再补）");
        }
        return;
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xl font-semibold">{title}</div>
          <div className="text-sm text-white/70">
            {me?.ok ? `已登录：${me.user?.email || me.user?.id || "dev_admin"}` : "未登录（如需权限请先登录）"}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 p-4 space-y-3 bg-white/5">
          <div className="flex flex-wrap gap-2">
            <button className={`px-3 py-2 rounded-lg border border-white/10 ${mode==="image"?"bg-white/15":"bg-transparent"}`} onClick={()=>setMode("image")}>图像</button>
            <button className={`px-3 py-2 rounded-lg border border-white/10 ${mode==="video"?"bg-white/15":"bg-transparent"}`} onClick={()=>setMode("video")}>视频</button>
            <button className={`px-3 py-2 rounded-lg border border-white/10 ${mode==="audio"?"bg-white/15":"bg-transparent"}`} onClick={()=>setMode("audio")}>音乐</button>
          </div>

          
          {mode === "image" && imageProvider === "kling_image" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-white/70">线路</span>
              <select
                className="bg-black border border-white/10 rounded-lg px-3 py-2"
                value={klingRoute}
                onChange={(e) => setKlingRoute(e.target.value as any)}
              >
                <option value="auto">自动优选（新加坡/北京）</option>
                <option value="singapore">新加坡</option>
                <option value="beijing">北京</option>
              </select>

              <span className="text-white/70 ml-2">模型</span>
              <input
                className="bg-black border border-white/10 rounded-lg px-3 py-2 w-56"
                value={klingModelName}
                onChange={(e) => setKlingModelName(e.target.value)}
                placeholder="kling-v2-1"
              />
              <span className="text-white/50">示例：kling-v2-1</span>
            </div>
          )}

          {mode === "image" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-white/70">引擎</span>
              <select className="bg-black border border-white/10 rounded-lg px-3 py-2"
                value={imageProvider}
                onChange={(e)=>setImageProvider(e.target.value as any)}
              >
                <option value="nano-banana-flash">Nano Banana Flash（免费/默认）</option>
                <option value="nano-banana-pro">Nano Banana Pro（付费）</option>
                <option value="kling_image">Kling Image（可灵文生图）</option>
              </select>
            </div>
          )}

          {mode === "video" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-white/70">引擎</span>
              <select className="bg-black border border-white/10 rounded-lg px-3 py-2"
                value={videoProvider}
                onChange={(e)=>setVideoProvider(e.target.value as any)}
              >
                <option value="kling_beijing">可灵（北京）</option>
              </select>
            </div>
          )}

          {mode === "audio" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-white/70">引擎</span>
              <select className="bg-black border border-white/10 rounded-lg px-3 py-2"
                value={audioProvider}
                onChange={(e)=>setAudioProvider(e.target.value as any)}
              >
                <option value="udio">Udio</option>
                <option value="suno">Suno</option>
              </select>
              <span className="text-white/70 ml-2">时长（秒）</span>
              <input
                className="w-24 bg-black border border-white/10 rounded-lg px-3 py-2"
                type="number"
                value={duration}
                onChange={(e)=>setDuration(Number(e.target.value||60))}
                min={10}
                max={240}
              />
            </div>
          )}

          <textarea
            className="w-full min-h-[120px] bg-black border border-white/10 rounded-lg px-3 py-2"
            value={prompt}
            onChange={(e)=>setPrompt(e.target.value)}
            placeholder="输入提示词…"
          />

          <div className="flex items-center gap-3">
            <button
              className="px-4 py-2 rounded-lg bg-white text-black font-semibold disabled:opacity-50"
              disabled={busy || !prompt.trim()}
              onClick={run}
            >
              {busy ? "生成中…" : "开始生成"}
            </button>
            <button
              className="px-4 py-2 rounded-lg border border-white/10 text-white/80"
              onClick={loadMe}
              disabled={busy}
            >
              刷新登录态
            </button>
            <div className="text-sm text-white/70">{status}</div>
          </div>
        </div>

        {/* 结果区：直接展示，不再只给 JSON */}
        {imageUrl && (
          <div className="rounded-xl border border-white/10 p-4 bg-white/5">
            <div className="text-sm text-white/70 mb-2">图片结果</div>
            <img src={imageUrl} className="max-w-full rounded-lg border border-white/10" />
          </div>
        )}

        {videoUrl && (
          <div className="rounded-xl border border-white/10 p-4 bg-white/5">
            <div className="text-sm text-white/70 mb-2">视频结果</div>
            <video src={videoUrl} controls className="max-w-full rounded-lg border border-white/10" />
          </div>
        )}

        {audioUrl && (
          <div className="rounded-xl border border-white/10 p-4 bg-white/5">
            <div className="text-sm text-white/70 mb-2">音频结果</div>
            <audio src={audioUrl} controls className="w-full" />
          </div>
        )}

        {/* 调试区（可折叠，默认显示，避免你看不到返回） */}
        <div className="rounded-xl border border-white/10 p-4 bg-white/5">
          {raw?.debug ? (
            <div className="mb-3 rounded-lg border border-emerald-500/40 bg-black/60 p-3 text-xs text-emerald-300">
              <div>Provider: {String(raw.debug.provider ?? "-")}</div>
              <div>Model: {String(raw.debug.model ?? "-")}</div>
              <div>Location: {String(raw.debug.location ?? "-")}</div>
            </div>
          ) : null}
          <div className="text-sm text-white/70 mb-2">返回数据（调试）</div>
          <pre className="whitespace-pre-wrap text-xs text-white/80">{raw ? JSON.stringify(raw, null, 2) : "（暂无）"}</pre>
        </div>
      </div>
    </div>
  );
}
