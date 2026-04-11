import React, { useMemo, useRef, useState } from "react";

type TabKey = "script" | "image" | "video" | "music";
type GoogleImageModel = "gemini-3-flash-image-001" | "gemini-3-pro-image-001";
type VeoMode = "rapid" | "pro";
type KlingVideoMode = "rapid" | "pro";
type MusicProvider = "suno" | "udio";

async function fetchJsonish(url: string, init?: RequestInit) {
  const resp = await fetch(url, init);
  const text = await resp.text();
  const contentType = resp.headers.get("content-type") || "";
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return {
    ok: resp.ok,
    status: resp.status,
    url,
    contentType,
    json,
    rawText: text,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("read_file_failed"));
    fr.onload = () => resolve(String(fr.result || ""));
    fr.readAsDataURL(file);
  });
}

function getScriptText(j: any): string {
  return (
    j?.raw?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("\n") ||
    j?.json?.raw?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text || "").join("\n") ||
    ""
  );
}

function getMusicTaskId(j: any): string {
  return String(
    j?.raw?.task_id ||
    j?.raw?.data?.task_id ||
    j?.json?.raw?.task_id ||
    j?.json?.raw?.data?.task_id ||
    ""
  );
}

function getMusicClips(j: any): any[] {
  const raw = j?.raw || j?.json?.raw || j?.json || {};
  const data = raw?.data;
  return Array.isArray(data) ? data : [];
}

export default function TestLab() {
  const [tab, setTab] = useState<TabKey>("image");

  // Shared input
  const [prompt, setPrompt] = useState("a cinematic tennis stadium at sunset, dramatic lighting, ultra detailed");
  const [negativePrompt, setNegativePrompt] = useState("blurry, low quality, duplicate person, extra fingers");
  const [aspectRatio, setAspectRatio] = useState("16:9");

  // Upload / reference image
  const [refImageUrl, setRefImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  // Script
  const [scriptBusy, setScriptBusy] = useState(false);
  const [scriptText, setScriptText] = useState("");

  // Image
  const [googleImageModel, setGoogleImageModel] = useState<GoogleImageModel>("gemini-3-flash-image-001");
  const [klingImageModel, setKlingImageModel] = useState("kling-v2-1");
  const [imageProvider, setImageProvider] = useState<"google" | "kling">("google");
  const [imageResolution, setImageResolution] = useState("1k");
  const [imageCount, setImageCount] = useState("1");
  const [guidanceScale, setGuidanceScale] = useState("4.0");
  const [imageSeed, setImageSeed] = useState("");
  const [personGeneration, setPersonGeneration] = useState<"ALLOW_ADULT" | "ALLOW_ALL" | "DONT_ALLOW">("ALLOW_ADULT");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageTaskId, setImageTaskId] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  // Video
  const [videoProvider, setVideoProvider] = useState<"google" | "kling">("google");
  const [veoMode, setVeoMode] = useState<VeoMode>("pro");
  const [veoResolution, setVeoResolution] = useState("720p");
  const [klingVideoMode, setKlingVideoMode] = useState<KlingVideoMode>("pro");
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoTaskId, setVideoTaskId] = useState("");
  const [videoUrl, setVideoUrl] = useState("");

  // Music
  const [musicProvider, setMusicProvider] = useState<MusicProvider>("suno");
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicTaskId, setMusicTaskId] = useState("");
  const [musicClips, setMusicClips] = useState<any[]>([]);
  const [selectedClipId, setSelectedClipId] = useState("");

  const [debug, setDebug] = useState<any>(null);

  const stopRef = useRef(false);

  const selectedClip = useMemo(() => {
    if (!musicClips.length) return null;
    return musicClips.find((c) => String(c?.clip_id || "") === selectedClipId) || musicClips[0];
  }, [musicClips, selectedClipId]);

  async function uploadRefImage(file: File) {
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const r = await fetchJsonish("/api/blob-put-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, filename: file.name || "ref.png" }),
      });
      setDebug(r);
      const url =
        r?.json?.imageUrl ||
        r?.json?.json?.imageUrl ||
        r?.json?.url ||
        "";
      if (!r.ok || !url) {
        throw new Error("upload_failed");
      }
      setRefImageUrl(String(url));

      // reset downstream outputs when ref image changes
      setImageTaskId("");
      setImageUrl("");
      setVideoTaskId("");
      setVideoUrl("");
    } catch (e: any) {
      setDebug({ ok: false, error: e?.message || String(e) });
      throw e;
    } finally {
      setUploading(false);
    }
  }

  async function runGeminiScript() {
    setScriptBusy(true);
    setScriptText("");
    setDebug({ ok: true, action: "geminiScript:start" });
    try {
      const r = await fetchJsonish("/api/google?op=geminiScript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      setDebug(r);
      if (!r.ok) throw new Error("gemini_script_failed");
      const txt = getScriptText(r.json);
      setScriptText(txt || JSON.stringify(r.json, null, 2));
    } catch (e: any) {
      setDebug({ ok: false, error: e?.message || String(e) });
    } finally {
      setScriptBusy(false);
    }
  }

  async function runImage() {
    setImageBusy(true);
    setImageTaskId("");
    setImageUrl("");
    setDebug({ ok: true, action: "image:start" });

    try {
      if (imageProvider === "google") {
        const model = googleImageModel;
        const tier = model === "gemini-3-pro-image-001" ? "pro" : "flash";
        const r = await fetchJsonish(
          `/api/google?op=nanoImage&tier=${encodeURIComponent(tier)}&model=${encodeURIComponent(model)}&imageSize=${encodeURIComponent(imageResolution)}&aspectRatio=${encodeURIComponent(aspectRatio)}&numberOfImages=${encodeURIComponent(imageCount)}&guidanceScale=${encodeURIComponent(guidanceScale)}&personGeneration=${encodeURIComponent(personGeneration)}${imageSeed ? `&seed=${encodeURIComponent(imageSeed)}` : ""}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt,
              tier,
              model,
              imageSize: imageResolution,
              aspectRatio,
              negativePrompt,
              numberOfImages: Number(imageCount || 1),
              guidanceScale: Number(guidanceScale || 4),
              seed: imageSeed ? Number(imageSeed) : undefined,
              personGeneration,
            }),
          }
        );
        setDebug(r);
        if (!r.ok) throw new Error("google_image_failed");

        const dataUrl = String(r?.json?.imageUrl || "").trim();
        const multi = Array.isArray(r?.json?.imageUrls) ? r.json.imageUrls : [];
        const firstUrl = dataUrl || String(multi[0] || "").trim();
        if (!firstUrl) {
          throw new Error("google_image_missing_imageUrl");
        }
        setImageUrl(firstUrl);
        return;
      }

      // Kling image
      const create = await fetchJsonish("/api/kling-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_name: klingImageModel,
          prompt,
          negative_prompt: negativePrompt,
          resolution: imageResolution,
          aspect_ratio: aspectRatio,
        }),
      });
      setDebug(create);

      const taskId = String(create?.json?.taskId || "");
      if (!create.ok || !taskId) throw new Error("kling_image_create_failed");

      setImageTaskId(taskId);

      for (let i = 0; i < 90 && !stopRef.current; i++) {
        const poll = await fetchJsonish(`/api/kling-image?taskId=${encodeURIComponent(taskId)}`);
        setDebug(poll);

        const status = String(poll?.json?.task_status || "");
        const url = String(poll?.json?.imageUrl || "");

        if (url) {
          setImageUrl(url);
          return;
        }
        if (status.toLowerCase() === "failed") {
          throw new Error("kling_image_failed");
        }
        await sleep(2000);
      }

      throw new Error("kling_image_timeout");
    } catch (e: any) {
      setDebug({ ok: false, error: e?.message || String(e) });
    } finally {
      setImageBusy(false);
    }
  }

  async function runVideo() {
    setVideoBusy(true);
    setVideoTaskId("");
    setVideoUrl("");
    setDebug({ ok: true, action: "video:start" });

    try {
      const inputImage = imageUrl || refImageUrl;
      if (!inputImage) throw new Error("missing_reference_image");

      if (videoProvider === "google") {
        const provider = veoMode === "rapid" ? "rapid" : "pro";
        const create = await fetchJsonish("/api/google?op=veoCreate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            imageUrl: inputImage,
            provider,
            durationSeconds: 8,
            aspectRatio,
            resolution: veoResolution,
          }),
        });
        setDebug(create);

        const taskId = String(create?.json?.taskId || "");
        if (!create.ok || !taskId) throw new Error("veo_create_failed");

        setVideoTaskId(taskId);

        for (let i = 0; i < 120 && !stopRef.current; i++) {
          const poll = await fetchJsonish(
            `/api/google?op=veoTask&provider=${encodeURIComponent(provider)}&taskId=${encodeURIComponent(taskId)}`
          );
          setDebug(poll);

          const status = String(poll?.json?.status || "");
          const url = String(poll?.json?.videoUrl || "");

          if (url) {
            setVideoUrl(url);
            return;
          }
          if (status.toLowerCase() === "failed") throw new Error("veo_task_failed");
          await sleep(2500);
        }

        throw new Error("veo_timeout");
      }

      // Kling video
      const create = await fetchJsonish("/api/jobs?op=klingCreate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: inputImage,
          prompt,
          duration: "10",
          mode: klingVideoMode,
          model_name: "kling-v2-6",
        }),
      });
      setDebug(create);

      const taskId = String(create?.json?.taskId || create?.json?.task_id || "");
      if (!create.ok || !taskId) throw new Error("kling_video_create_failed");

      setVideoTaskId(taskId);

      for (let i = 0; i < 120 && !stopRef.current; i++) {
        const poll = await fetchJsonish(`/api/jobs?op=klingTask&taskId=${encodeURIComponent(taskId)}`);
        setDebug(poll);

        const status =
          String(poll?.json?.taskStatus || poll?.json?.raw?.data?.task_status || "");
        const url =
          String(poll?.json?.videoUrl || poll?.json?.raw?.data?.task_result?.videos?.[0]?.url || "");

        if (url) {
          setVideoUrl(url);
          return;
        }
        if (status.toLowerCase() === "failed") throw new Error("kling_video_failed");
        await sleep(2500);
      }

      throw new Error("kling_video_timeout");
    } catch (e: any) {
      setDebug({ ok: false, error: e?.message || String(e) });
    } finally {
      setVideoBusy(false);
    }
  }

  async function runMusic() {
    setMusicBusy(true);
    setMusicTaskId("");
    setMusicClips([]);
    setSelectedClipId("");
    setDebug({ ok: true, action: "music:start" });

    try {
      const createOp = musicProvider === "suno" ? "aimusicSunoCreate" : "aimusicUdioCreate";
      const taskOp = musicProvider === "suno" ? "aimusicSunoTask" : "aimusicUdioTask";

      const create = await fetchJsonish(`/api/jobs?op=${createOp}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      setDebug(create);

      const taskId = getMusicTaskId(create.json);
      if (!create.ok || !taskId) throw new Error("music_create_failed");

      setMusicTaskId(taskId);

      for (let i = 0; i < 120 && !stopRef.current; i++) {
        const poll = await fetchJsonish(`/api/jobs?op=${taskOp}&taskId=${encodeURIComponent(taskId)}`);
        setDebug(poll);

        const clips = getMusicClips(poll.json);
        if (clips.length) {
          setMusicClips(clips);
          if (!selectedClipId) {
            const first = clips.find((c: any) => c?.audio_url) || clips[0];
            if (first?.clip_id) setSelectedClipId(String(first.clip_id));
          }
          const okItem = clips.find((c: any) => c?.audio_url && String(c?.state || "").toLowerCase() === "succeeded");
          if (okItem) return;
        }

        await sleep(2500);
      }

      throw new Error("music_timeout");
    } catch (e: any) {
      setDebug({ ok: false, error: e?.message || String(e) });
    } finally {
      setMusicBusy(false);
    }
  }

  const tabButton = (key: TabKey, label: string) => (
    <button
      onClick={() => setTab(key)}
      style={{
        padding: "10px 14px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.14)",
        background: tab === key ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)",
        color: "white",
        fontWeight: 900,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: 20, color: "white" }}>
      <h1 style={{ fontSize: 28, margin: 0, fontWeight: 900 }}>AI Studio TestLab</h1>
      <div style={{ marginTop: 8, opacity: 0.78 }}>
        统一测试：Google / Kling / Music。这里只做功能验证，不是最终用户页面。
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
        {tabButton("script", "脚本")}
        {tabButton("image", "图像")}
        {tabButton("video", "视频")}
        {tabButton("music", "音乐")}
      </div>

      <div style={{ marginTop: 20, padding: 16, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.20)" }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>公共输入</div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.15)",
            background: "rgba(0,0,0,0.25)",
            color: "white",
          }}
        />

        <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>比例</div>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
            >
              <option value="16:9">16:9（横屏标准）</option>
              <option value="9:16">9:16（竖屏短视频）</option>
              <option value="1:1">1:1（方形）</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
              <option value="21:9">21:9</option>
            </select>
          </div>

          <div>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>上传参考图</div>
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                try {
                  await uploadRefImage(file);
                } catch {}
              }}
            />
          </div>

          <div style={{ fontSize: 12, opacity: 0.85 }}>
            {uploading ? "上传中…" : refImageUrl ? <>已上传：<code>{refImageUrl}</code></> : "未上传参考图"}
          </div>
        </div>
      </div>

      {tab === "script" && (
        <div style={{ marginTop: 20, padding: 16, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.20)" }}>
          <div style={{ fontSize: 20, fontWeight: 900 }}>Google · Gemini Script</div>
          <div style={{ marginTop: 8, opacity: 0.8 }}>智能生成脚本 / 分镜草案</div>
          <button
            onClick={runGeminiScript}
            disabled={scriptBusy}
            style={{ marginTop: 12, padding: "10px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 900 }}
          >
            {scriptBusy ? "生成中…" : "生成脚本"}
          </button>

          {scriptText ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>结果</div>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.6 }}>{scriptText}</pre>
            </div>
          ) : null}
        </div>
      )}

      {tab === "image" && (
        <div style={{ marginTop: 20, padding: 16, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.20)" }}>
          <div style={{ fontSize: 20, fontWeight: 900 }}>图像生成</div>

          <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>引擎</div>
              <select
                value={imageProvider}
                onChange={(e) => setImageProvider(e.target.value as any)}
                style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
              >
                <option value="google">Google</option>
                <option value="kling">Kling</option>
              </select>
            </div>

            {imageProvider === "google" ? (
              <div>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>模型</div>
                <select
                  value={googleImageModel}
                  onChange={(e) => setGoogleImageModel(e.target.value as GoogleImageModel)}
                  style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
                >
                  <option value="gemini-3-flash-image-001">Nano Banana 2（gemini-3-flash-image-001）</option>
                  <option value="gemini-3-pro-image-001">Nano Banana Pro（gemini-3-pro-image-001）</option>
                </select>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>模型</div>
                <select
                  value={klingImageModel}
                  onChange={(e) => setKlingImageModel(e.target.value)}
                  style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
                >
                  <option value="kling-v2">Kling 2.6（教育）</option>
                  <option value="kling-v2-1">Kling 3.0</option>
                </select>
              </div>
            )}

            <div>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>分辨率</div>
              <select
                value={imageResolution}
                onChange={(e) => setImageResolution(e.target.value)}
                style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
              >
                <option value="1k">1K</option>
                <option value="2k">2K</option>
              </select>
            </div>

            {imageProvider === "google" ? (
              <>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>图片数量</div>
                  <select
                    value={imageCount}
                    onChange={(e) => setImageCount(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                  </select>
                </div>

                <div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>引导系数</div>
                  <input
                    value={guidanceScale}
                    onChange={(e) => setGuidanceScale(e.target.value)}
                    placeholder="4.0"
                    style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)", width: 110 }}
                  />
                </div>

                <div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>随机种子</div>
                  <input
                    value={imageSeed}
                    onChange={(e) => setImageSeed(e.target.value)}
                    placeholder="可选"
                    style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)", width: 110 }}
                  />
                </div>

                <div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>人物生成</div>
                  <select
                    value={personGeneration}
                    onChange={(e) => setPersonGeneration(e.target.value as any)}
                    style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
                  >
                    <option value="ALLOW_ADULT">允许成人</option>
                    <option value="ALLOW_ALL">允许全部</option>
                    <option value="DONT_ALLOW">不允许人物</option>
                  </select>
                </div>
              </>
            ) : null}
          </div>

          {imageProvider === "kling" ? (
            <textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              rows={2}
              placeholder="Negative prompt"
              style={{
                width: "100%",
                marginTop: 12,
                padding: 12,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(0,0,0,0.25)",
                color: "white",
              }}
            />
          ) : null}

          <button
            onClick={runImage}
            disabled={imageBusy}
            style={{ marginTop: 12, padding: "10px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 900 }}
          >
            {imageBusy ? "生成中…" : "开始生成图片"}
          </button>

          {imageTaskId ? <div style={{ marginTop: 8, opacity: 0.8 }}>任务：<code>{imageTaskId}</code></div> : null}

          {imageUrl ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>结果图片</div>
              <img src={imageUrl} style={{ width: "100%", borderRadius: 14, background: "black" }} />
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <a href={imageUrl} target="_blank" rel="noreferrer" style={{ color: "white" }}>打开图片</a>
                <button
                  onClick={() => setRefImageUrl(imageUrl)}
                  style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 900 }}
                >
                  设为参考图
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {tab === "video" && (
        <div style={{ marginTop: 20, padding: 16, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.20)" }}>
          <div style={{ fontSize: 20, fontWeight: 900 }}>视频生成</div>

          <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>引擎</div>
              <select
                value={videoProvider}
                onChange={(e) => setVideoProvider(e.target.value as any)}
                style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
              >
                <option value="google">Google Veo</option>
                <option value="kling">Kling Video</option>
              </select>
            </div>

            {videoProvider === "google" ? (
              <>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>模型</div>
                  <select
                    value={veoMode}
                    onChange={(e) => setVeoMode(e.target.value as VeoMode)}
                    style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
                  >
                    <option value="pro">Veo 3.1 Pro</option>
                    <option value="rapid">Veo 3.1 Rapid</option>
                  </select>
                </div>

                <div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>分辨率</div>
                  <select
                    value={veoResolution}
                    onChange={(e) => setVeoResolution(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </select>
                </div>
              </>
            ) : (
              <div>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>模式</div>
                <select
                  value={klingVideoMode}
                  onChange={(e) => setKlingVideoMode(e.target.value as KlingVideoMode)}
                  style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
                >
                  <option value="pro">Kling Pro</option>
                  <option value="rapid">Kling Rapid</option>
                </select>
              </div>
            )}
          </div>

          <div style={{ marginTop: 12, opacity: 0.8 }}>
            当前参考图：{refImageUrl ? <code>{refImageUrl}</code> : "未上传，也未从图像生成结果中设置"}
          </div>

          <button
            onClick={runVideo}
            disabled={videoBusy}
            style={{ marginTop: 12, padding: "10px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 900 }}
          >
            {videoBusy ? "生成中…" : "开始生成视频"}
          </button>

          {videoTaskId ? <div style={{ marginTop: 8, opacity: 0.8 }}>任务：<code>{videoTaskId}</code></div> : null}

          {videoUrl ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>结果视频</div>
              <video controls src={videoUrl} style={{ width: "100%", borderRadius: 14, background: "black" }} />
              <div style={{ marginTop: 10 }}>
                <a href={videoUrl} target="_blank" rel="noreferrer" style={{ color: "white" }}>打开 / 下载视频</a>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {tab === "music" && (
        <div style={{ marginTop: 20, padding: 16, borderRadius: 16, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.20)" }}>
          <div style={{ fontSize: 20, fontWeight: 900 }}>音乐生成</div>

          <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>模型</div>
              <select
                value={musicProvider}
                onChange={(e) => setMusicProvider(e.target.value as MusicProvider)}
                style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
              >
                <option value="suno">Suno</option>
                <option value="udio">Udio</option>
              </select>
            </div>
          </div>

          <button
            onClick={runMusic}
            disabled={musicBusy}
            style={{ marginTop: 12, padding: "10px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 900 }}
          >
            {musicBusy ? "生成中…" : "开始生成音乐"}
          </button>

          {musicTaskId ? <div style={{ marginTop: 8, opacity: 0.8 }}>任务：<code>{musicTaskId}</code></div> : null}

          {musicClips.length ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>结果（歌曲列表）</div>
              <div style={{ display: "grid", gap: 8 }}>
                {musicClips.map((clip: any) => {
                  const active = String(clip?.clip_id || "") === selectedClipId;
                  return (
                    <button
                      key={String(clip?.clip_id || Math.random())}
                      onClick={() => setSelectedClipId(String(clip?.clip_id || ""))}
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        padding: 10,
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,0.14)",
                        background: active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.06)",
                        color: "white",
                        textAlign: "left",
                        cursor: "pointer"
                      }}
                    >
                      {clip?.image_url ? (
                        <img src={clip.image_url} alt="cover" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover" }} />
                      ) : (
                        <div style={{ width: 44, height: 44, borderRadius: 10, background: "rgba(255,255,255,0.08)" }} />
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 900 }}>{clip?.title || "未命名"}</div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>{clip?.state || ""}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedClip?.audio_url ? (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>播放</div>
                  {selectedClip?.image_url ? (
                    <img src={selectedClip.image_url} alt="cover" style={{ width: 220, borderRadius: 14, objectFit: "cover", marginBottom: 10 }} />
                  ) : null}
                  <audio controls autoPlay src={selectedClip.audio_url} style={{ width: "100%" }} />
                  <div style={{ marginTop: 10 }}>
                    <a href={selectedClip.audio_url} target="_blank" rel="noreferrer" style={{ color: "white" }}>打开 / 下载 MP3</a>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <details style={{ marginTop: 20 }}>
        <summary style={{ cursor: "pointer", fontWeight: 900 }}>返回数据（调试）</summary>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, lineHeight: 1.5, marginTop: 12 }}>
          {debug ? JSON.stringify(debug, null, 2) : "（暂无）"}
        </pre>
      </details>
    </div>
  );
}
