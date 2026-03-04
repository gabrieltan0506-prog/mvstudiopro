import { useEffect, useMemo, useState } from "react";

type AnyObj = Record<string, any>;

const UI_VERSION = "20260304-1";

async function jfetch(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const text = await r.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch {}
  return { ok: r.ok, status: r.status, json: j, text };
}

const ASPECTS = [
  { v: "16:9", label: "16:9（横屏标准）" },
  { v: "9:16", label: "9:16（竖屏短视频）" },
  { v: "1:1", label: "1:1（方形）" },
  { v: "4:3", label: "4:3（传统横屏）" },
  { v: "3:4", label: "3:4（传统竖屏）" },
  { v: "21:9", label: "21:9（电影宽屏）" },
] as const;

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

async function optimizeImageForUpload(file: File): Promise<{ dataUrl: string; contentType: string }> {
  // Respect EXIF orientation from mobile photos to avoid upside-down I2V results.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  let width = bitmap.width;
  let height = bitmap.height;

  const maxSide = 1600;
  if (Math.max(width, height) > maxSide) {
    const ratio = maxSide / Math.max(width, height);
    width = Math.max(1, Math.round(width * ratio));
    height = Math.max(1, Math.round(height * ratio));
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_ctx_failed");

  ctx.drawImage(bitmap, 0, 0, width, height);

  let mime = file.type === "image/png" ? "image/png" : "image/jpeg";
  let quality = 0.88;
  let dataUrl = canvas.toDataURL(mime, quality);

  // Keep payload small to avoid hitting serverless body limits.
  while (dataUrl.length > 900_000 && quality > 0.45) {
    mime = "image/jpeg";
    quality = Number((quality - 0.08).toFixed(2));
    dataUrl = canvas.toDataURL(mime, quality);
  }

  if (dataUrl.length > 1_400_000) {
    throw new Error("image_too_large_after_optimization");
  }

  return { dataUrl, contentType: mime };
}

async function uploadToBlob(file: File): Promise<string> {
  const optimized = await optimizeImageForUpload(file);
  const ext = optimized.contentType === "image/png" ? "png" : "jpg";

  const r = await jfetch("/api/blob/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: (file.name || "reference").replace(/\.[a-zA-Z0-9]+$/, ""),
      contentType: optimized.contentType,
      dataUrl: optimized.dataUrl,
      ext,
    }),
  });

  if (!r.ok || !r.json?.ok || !(r.json?.downloadUrl || r.json?.url)) {
    const reason = [r.json?.error, r.json?.message].filter(Boolean).join(": ");
    throw new Error(reason || `upload_failed_${r.status}`);
  }

  return String(r.json.downloadUrl || r.json.url);
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export default function TestLab() {
  /* AIMUSIC_UI_WIRE */
  async function runAimusic(prompt: string) {
    setMusicResult(null);
    setMusicTaskId("");
    setDebug("AIMusic: creating task...");
    const createResp = await fetch(musicProvider === "suno" ? "/api/jobs?op=aimusicSunoCreate" : "/api/jobs?op=aimusicUdioCreate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_type: "create_music",
        custom_mode: false,
        mv: "sonic-v4-5",
        gpt_description_prompt: prompt,
      }),
    });
    const createJson = await createResp.json();
    setDebug(JSON.stringify(createJson, null, 2));

    const taskId = createJson?.json?.task_id || createJson?.task_id;
    if (!taskId) throw new Error("AIMusic: missing task_id");

    setMusicTaskId(String(taskId));
    setDebug("AIMusic: polling task " + taskId);

    const start = Date.now();
    while (true) {
      if (Date.now() - start > 8 * 60 * 1000) throw new Error("AIMusic: timeout");
      const pollResp = await fetch(`/api/jobs?op=${musicProvider === "suno" ? "aimusicSunoTask" : "aimusicUdioTask"}&taskId=${encodeURIComponent(String(taskId))}`);
      const pollJson = await pollResp.json();
      setDebug(JSON.stringify(pollJson, null, 2));

      const upstream = pollJson?.json ?? pollJson;
      const data = upstream?.data;
      if (Array.isArray(data) && data.length > 0) {
        const item = data[0];
        if (item?.audio_url || item?.video_url) {
          setMusicResult(item);
          return;
        }
      }
      // Producer API may return a single object
      if (data && (data.audio_url || data.video_url)) {
        setMusicResult(data);
        return;
      }
      const status = upstream?.status || upstream?.state || upstream?.task_status;
      if (status && String(status).toLowerCase() === "failed") {
        throw new Error("AIMusic: failed " + JSON.stringify(upstream));
      }
      await sleep(2500);
    }
  }

  const [me, setMe] = useState<AnyObj | null>(null);

  const [mode, setMode] = useState<"image" | "video" | "audio">("image");
  const [prompt, setPrompt] = useState("1K 赛博风格女偶像，电影级光影，超精细");

  // IMAGE
  const [imageProvider, setImageProvider] = useState<"nano-banana-flash" | "nano-banana-pro">("nano-banana-flash");
  const [imageSize, setImageSize] = useState<"1K" | "2K" | "4K">("1K");
  const [imageAspectRatio, setImageAspectRatio] = useState<(typeof ASPECTS)[number]["v"]>("16:9");

  // VIDEO (I2V only)
  const [videoProvider, setVideoProvider] = useState<"veo-3.1-generate-001" | "veo-3.1-fast-generate-001">("veo-3.1-generate-001");
  const [enableUpscale, setEnableUpscale] = useState(false);
  const [videoResolution, setVideoResolution] = useState<"720p" | "1080p">("720p");
  const [videoAspectRatio, setVideoAspectRatio] = useState<(typeof ASPECTS)[number]["v"]>("16:9");
  const [videoImageUrl, setVideoImageUrl] = useState("");
  const [videoImagePreview, setVideoImagePreview] = useState("");
  const [videoImageName, setVideoImageName] = useState("");

  // RESULTS
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [raw, setRaw] = useState<any>(null);
  const [imageUrl, setImageUrl] = useState<string>("");
  const [videoUrl, setVideoUrl] = useState<string>("");

  const title = useMemo(() => {
    if (mode === "image") return "图像生成";
    if (mode === "video") return "视频生成（图生视频 / 8秒 / 无音频）";
    return "音乐（暂未启用）";
  }, [mode]);

  async function loadMe() {
    const r = await jfetch("/api/me");
    if (r.ok && r.json?.ok) setMe(r.json);
    else setMe(null);
  }

  useEffect(() => { loadMe(); }, []);

  async function onPickVideoReference(file: File) {
    setStatus("准备素材中…");
    setBusy(true);
    try {
      const preview = await readFileAsDataUrl(file);
      const uploadedUrl = await uploadToBlob(file);
      setVideoImagePreview(preview);
      setVideoImageUrl(uploadedUrl);
      setVideoImageName(file.name);
      setStatus("参考图已就绪");
    } catch (e: any) {
      setVideoImagePreview("");
      setVideoImageUrl("");
      setVideoImageName("");
      setStatus(`参考图处理失败：${e?.message || "unknown"}`);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setStatus("生成中…");
    setRaw(null);
    setImageUrl("");
    setVideoUrl("");

    try {
      if (mode === "image") {
        const isPro = imageProvider === "nano-banana-pro";
        const body: any = {
          type: "image",
          provider: imageProvider,
          prompt,
        };
        if (isPro) {
          body.imageSize = imageSize;
          body.aspectRatio = imageAspectRatio;
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
        if (!videoImageUrl) {
          setRaw({ ok: false, type: "video", provider: videoProvider, error: "missing_image_url", detail: "请先上传参考图" });
          setStatus("失败（请先上传参考图）");
          return;
        }

        const body: any = {
          type: "video",
          provider: videoProvider,
          prompt,
          imageUrl: videoImageUrl,
          aspect_ratio: videoAspectRatio,
          resolution: videoResolution,
          durationSeconds: 8,
          generateAudio: false,
          upscale: enableUpscale,
        };

        const r = await jfetch("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        setRaw(r.json ?? r.text);
        if (!r.ok || !r.json?.ok || !r.json?.taskId) {
          setStatus(`失败（${r.status}）`);
          return;
        }

        const taskId = String(r.json.taskId);
        setStatus("已提交（轮询中…）");

        for (let i = 0; i < 90; i++) {
          await new Promise((res) => setTimeout(res, 3000));
          const st = await jfetch(`/api/jobs?type=video&provider=${encodeURIComponent(videoProvider)}&taskId=${encodeURIComponent(taskId)}`);
          setRaw(st.json ?? st.text);
          const url = st.json?.videoUrl;
          if (url) {
            setVideoUrl(url);
            setStatus("完成");
            return;
          }
          if (st.json?.status === "failed" || st.json?.ok === false) {
            setStatus("失败（生成失败）");
            return;
          }
        }
        setStatus("超时：未拿到视频地址");
        return;
      }

      setStatus("音乐");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-5xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xl font-semibold">{title}</div>
          <div className="text-xs text-white/60">
            UI: {UI_VERSION} · {me?.ok ? `已登录：${me.user?.email || me.user?.id || "dev_admin"}` : "未登录"}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 p-4 space-y-3 bg-white/5">
          <div className="flex flex-wrap gap-2">
            <button className={`px-3 py-2 rounded-lg border border-white/10 ${mode==="image"?"bg-white/15":"bg-transparent"}`} onClick={()=>setMode("image")}>图像</button>
            <button className={`px-3 py-2 rounded-lg border border-white/10 ${mode==="video"?"bg-white/15":"bg-transparent"}`} onClick={()=>setMode("video")}>视频</button>
            <button className={`px-3 py-2 rounded-lg border border-white/10 ${mode==="audio"?"bg-white/15":"bg-transparent"}`} onClick={()=>setMode("audio")}>音乐</button>
          </div>

          {mode === "image" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-white/70">引擎</span>
              <select
                className="bg-black border border-white/10 rounded-lg px-3 py-2"
                value={imageProvider}
                onChange={(e)=>setImageProvider(e.target.value as any)}
              >
                <option value="nano-banana-flash">Nano Banana Flash（免费）</option>
                <option value="nano-banana-pro">Nano Banana Pro（付费）</option>
              </select>

              <span className="text-white/70 ml-2">尺寸</span>
              <select
                className="bg-black border border-white/10 rounded-lg px-3 py-2"
                value={imageSize}
                onChange={(e)=>setImageSize(e.target.value as any)}
                disabled={imageProvider !== "nano-banana-pro"}
                title={imageProvider !== "nano-banana-pro" ? "付费版可用" : ""}
              >
                <option value="1K">1K</option>
                <option value="2K">2K</option>
                <option value="4K">4K</option>
              </select>

              <span className="text-white/70 ml-2">比例</span>
              <select
                className="bg-black border border-white/10 rounded-lg px-3 py-2"
                value={imageAspectRatio}
                onChange={(e)=>setImageAspectRatio(e.target.value as any)}
                disabled={imageProvider !== "nano-banana-pro"}
                title={imageProvider !== "nano-banana-pro" ? "付费版可用" : ""}
              >
                {ASPECTS.map(a => <option key={a.v} value={a.v}>{a.label}</option>)}
              </select>
            </div>
          )}

          {mode === "video" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-white/70">模型</span>
              <select
                className="bg-black border border-white/10 rounded-lg px-3 py-2"
                value={videoProvider}
                onChange={(e)=>setVideoProvider(e.target.value as any)}
              >
                <option value="veo-3.1-generate-001">Veo 3.1 Pro</option>
                <option value="veo-3.1-fast-generate-001">Veo 3.1 Rapid</option>
              </select>

              <span className="text-white/70 ml-2">分辨率</span>
              <select
                className="bg-black border border-white/10 rounded-lg px-3 py-2"
                value={videoResolution}
                onChange={(e)=>setVideoResolution(e.target.value as any)}
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
              </select>

              <span className="text-white/70 ml-2">比例</span>
              <select
                className="bg-black border border-white/10 rounded-lg px-3 py-2"
                value={videoAspectRatio}
                onChange={(e)=>setVideoAspectRatio(e.target.value as any)}
              >
                {ASPECTS.map(a => <option key={a.v} value={a.v}>{a.label}</option>)}
              </select>

              <label className="ml-2 px-3 py-2 rounded-lg border border-white/10 cursor-pointer hover:bg-white/10">
                上传参考图
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    await onPickVideoReference(file);
                  }}
                />
              </label>

              {videoImageName ? (
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border border-white/10 text-white/80"
                  onClick={() => {
                    setVideoImageName("");
                    setVideoImagePreview("");
                    setVideoImageUrl("");
                  }}
                >
                  清除参考图
                </button>
              ) : null}

              <label className="ml-2 inline-flex items-center gap-2 text-white/80">
                <input
                  type="checkbox"
                  checked={enableUpscale}
                  onChange={(e)=>setEnableUpscale(e.target.checked)}
                />
                高画质增强（额外积分）
              </label>
            </div>
          )}

          {mode === "video" && (
            <div className="text-xs text-white/70">
              <div>{videoImageName ? `已选择：${videoImageName}` : "请先上传参考图（图生视频）。"}</div>
              {videoImageUrl ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span>素材地址：</span>
                  <a
                    href={videoImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline break-all"
                    title={videoImageUrl}
                  >
                    {videoImageUrl}
                  </a>
                  <button
                    type="button"
                    className="px-2 py-1 rounded border border-white/20 text-white/80 hover:bg-white/10"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(videoImageUrl);
                        setStatus("素材地址已复制");
                      } catch {
                        setStatus("复制失败，请手动复制");
                      }
                    }}
                  >
                    复制URL
                  </button>
                </div>
              ) : null}
              {videoImagePreview ? (
                <img src={videoImagePreview} alt="reference" className="mt-2 max-h-44 rounded-lg border border-white/10" />
              ) : null}
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
              disabled={busy || (mode === "video" ? !videoImageUrl : !prompt.trim())}
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

        <div className="rounded-xl border border-white/10 p-4 bg-white/5">
          <div className="text-sm text-white/70 mb-2">返回数据（调试）</div>
          <pre className="whitespace-pre-wrap text-xs text-white/80">{raw ? JSON.stringify(raw, null, 2) : "（暂无）"}</pre>
        </div>
      </div>
    </div>
  );
}
