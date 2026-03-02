import { useEffect, useMemo, useState } from "react";

type AnyObj = Record<string, any>;
type Mode = "image" | "video";

async function jfetch(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const text = await r.text();
  let j: any = null;
  try {
    j = JSON.parse(text);
  } catch {}
  return { ok: r.ok, status: r.status, json: j, text };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function TestLab() {
  const [me, setMe] = useState<AnyObj | null>(null);
  const [prompt, setPrompt] = useState("1K 赛博风格女偶像，电影级光影，超精细");
  const [mode, setMode] = useState<Mode>("image");

  const [imageProvider, setImageProvider] = useState<"nano-banana-flash" | "nano-banana-pro" | "kling_image">("kling_image");
  const [klingImageModel, setKlingImageModel] = useState("kling-image-o1");
  const [klingImageResolution, setKlingImageResolution] = useState<"1k" | "2k">("1k");
  const [klingImageAspect, setKlingImageAspect] = useState("1:1");

  const [videoProvider, setVideoProvider] = useState<"kling_beijing">("kling_beijing");
  const [klingVideoModel, setKlingVideoModel] = useState("kling-v3-omni");
  const [klingVideoMode, setKlingVideoMode] = useState<"std" | "pro">("std");
  const [klingVideoDuration, setKlingVideoDuration] = useState("5");
  const [klingVideoAspect, setKlingVideoAspect] = useState<"16:9" | "9:16" | "1:1">("16:9");

  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const [imageUrl, setImageUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [taskId, setTaskId] = useState("");
  const [raw, setRaw] = useState<any>(null);

  const title = useMemo(() => (mode === "image" ? "Kling 生图测试" : "Kling 视频测试"), [mode]);

  async function loadMe() {
    const r = await jfetch("/api/me");
    if (r.ok && r.json) {
      setMe(r.json);
      return;
    }
    setMe(null);
  }

  useEffect(() => {
    void loadMe();
  }, []);

  async function pollImage(provider: string, id: string) {
    setStatus("生图生成中…（轮询）");
    for (let i = 0; i < 60; i++) {
      await sleep(2000);
      const st = await jfetch(`/api/jobs?provider=${encodeURIComponent(provider)}&taskId=${encodeURIComponent(id)}`);
      if (st.json) setRaw(st.json);
      const url = st.json?.imageUrl || st.json?.images?.[0] || "";
      const taskStatus = String(st.json?.taskStatus || "");
      if (url) {
        setImageUrl(url);
        setStatus("完成");
        return;
      }
      if (taskStatus === "failed") {
        setStatus("失败（任务执行失败）");
        return;
      }
    }
    setStatus("超时：未拿到图片地址");
  }

  async function pollVideo(provider: string, id: string) {
    setStatus("视频生成中…（轮询）");
    for (let i = 0; i < 80; i++) {
      await sleep(3000);
      const st = await jfetch(`/api/jobs?provider=${encodeURIComponent(provider)}&taskId=${encodeURIComponent(id)}`);
      if (st.json) setRaw(st.json);
      const url =
        st.json?.videoUrl ||
        st.json?.raw?.data?.task_result?.videos?.[0]?.url ||
        st.json?.raw?.data?.[0]?.task_result?.videos?.[0]?.url ||
        "";
      const taskStatus = String(st.json?.taskStatus || "");
      if (url) {
        setVideoUrl(url);
        setStatus("完成");
        return;
      }
      if (taskStatus === "failed") {
        setStatus("失败（任务执行失败）");
        return;
      }
    }
    setStatus("超时：未拿到视频地址");
  }

  async function run() {
    setBusy(true);
    setStatus("提交任务中…");
    setRaw(null);
    setImageUrl("");
    setVideoUrl("");
    setTaskId("");

    try {
      if (mode === "image") {
        const body: AnyObj = {
          type: "image",
          provider: imageProvider,
          prompt,
        };
        if (imageProvider === "kling_image") {
          body.model = klingImageModel;
          body.resolution = klingImageResolution;
          body.aspect_ratio = klingImageAspect;
          body.count = 1;
        }

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

        if (r.json?.imageUrl) {
          setImageUrl(r.json.imageUrl);
          setStatus("完成");
          return;
        }

        const id = String(r.json?.taskId || "");
        if (!id) {
          setStatus("失败（未返回 taskId）");
          return;
        }
        setTaskId(id);
        await pollImage(imageProvider, id);
        return;
      }

      const r = await jfetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "video",
          provider: videoProvider,
          prompt,
          model_name: klingVideoModel,
          mode: klingVideoMode,
          duration: klingVideoDuration,
          aspect_ratio: klingVideoAspect,
        }),
      });
      setRaw(r.json ?? r.text);
      if (!r.ok || !r.json?.ok || !r.json?.taskId) {
        setStatus(`失败（${r.status}）`);
        return;
      }

      const id = String(r.json.taskId);
      setTaskId(id);
      await pollVideo(videoProvider, id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xl font-semibold">{title}</div>
          <div className="text-sm text-white/70">
            {me ? `已登录：${me.email || me.user?.email || me.id || "unknown"}` : "未登录（如需权限请先登录）"}
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap gap-2">
            <button className={`rounded-lg border border-white/10 px-3 py-2 ${mode === "image" ? "bg-white/15" : "bg-transparent"}`} onClick={() => setMode("image")}>图像</button>
            <button className={`rounded-lg border border-white/10 px-3 py-2 ${mode === "video" ? "bg-white/15" : "bg-transparent"}`} onClick={() => setMode("video")}>视频</button>
          </div>

          {mode === "image" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-white/70">引擎</span>
              <select className="rounded-lg border border-white/10 bg-black px-3 py-2" value={imageProvider} onChange={(e) => setImageProvider(e.target.value as any)}>
                <option value="kling_image">Kling Image（可灵文生图）</option>
                <option value="nano-banana-flash">Nano Banana Flash</option>
                <option value="nano-banana-pro">Nano Banana Pro</option>
              </select>
            </div>
          )}

          {mode === "image" && imageProvider === "kling_image" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-white/70">模型</span>
              <input className="w-44 rounded-lg border border-white/10 bg-black px-3 py-2" value={klingImageModel} onChange={(e) => setKlingImageModel(e.target.value)} />
              <span className="text-white/70">分辨率</span>
              <select className="rounded-lg border border-white/10 bg-black px-3 py-2" value={klingImageResolution} onChange={(e) => setKlingImageResolution(e.target.value as "1k" | "2k")}>
                <option value="1k">1k</option>
                <option value="2k">2k</option>
              </select>
              <span className="text-white/70">比例</span>
              <input className="w-24 rounded-lg border border-white/10 bg-black px-3 py-2" value={klingImageAspect} onChange={(e) => setKlingImageAspect(e.target.value)} />
            </div>
          )}

          {mode === "video" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-white/70">引擎</span>
              <select className="rounded-lg border border-white/10 bg-black px-3 py-2" value={videoProvider} onChange={(e) => setVideoProvider(e.target.value as "kling_beijing")}>
                <option value="kling_beijing">可灵（北京）</option>
              </select>
              <span className="text-white/70">模型</span>
              <input className="w-44 rounded-lg border border-white/10 bg-black px-3 py-2" value={klingVideoModel} onChange={(e) => setKlingVideoModel(e.target.value)} />
              <span className="text-white/70">模式</span>
              <select className="rounded-lg border border-white/10 bg-black px-3 py-2" value={klingVideoMode} onChange={(e) => setKlingVideoMode(e.target.value as "std" | "pro")}>
                <option value="std">std</option>
                <option value="pro">pro</option>
              </select>
              <span className="text-white/70">时长</span>
              <select className="rounded-lg border border-white/10 bg-black px-3 py-2" value={klingVideoDuration} onChange={(e) => setKlingVideoDuration(e.target.value)}>
                <option value="5">5s</option>
                <option value="8">8s</option>
                <option value="10">10s</option>
              </select>
              <span className="text-white/70">比例</span>
              <select className="rounded-lg border border-white/10 bg-black px-3 py-2" value={klingVideoAspect} onChange={(e) => setKlingVideoAspect(e.target.value as "16:9" | "9:16" | "1:1")}>
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
              </select>
            </div>
          )}

          <textarea
            className="min-h-[120px] w-full rounded-lg border border-white/10 bg-black px-3 py-2"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="输入提示词…"
          />

          <div className="flex items-center gap-3">
            <button className="rounded-lg bg-white px-4 py-2 font-semibold text-black disabled:opacity-50" disabled={busy || !prompt.trim()} onClick={run}>
              {busy ? "处理中…" : "开始生成"}
            </button>
            <button className="rounded-lg border border-white/10 px-4 py-2 text-white/80" onClick={loadMe} disabled={busy}>
              刷新登录态
            </button>
            <div className="text-sm text-white/70">{status}</div>
            {taskId ? <div className="text-xs text-white/50">taskId: {taskId}</div> : null}
          </div>
        </div>

        {imageUrl && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 text-sm text-white/70">图片结果</div>
            <img src={imageUrl} className="max-w-full rounded-lg border border-white/10" />
          </div>
        )}

        {videoUrl && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 text-sm text-white/70">视频结果</div>
            <video src={videoUrl} controls className="max-w-full rounded-lg border border-white/10" />
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-2 text-sm text-white/70">返回数据（调试）</div>
          <pre className="whitespace-pre-wrap text-xs text-white/80">{raw ? JSON.stringify(raw, null, 2) : "（暂无）"}</pre>
        </div>
      </div>
    </div>
  );
}
