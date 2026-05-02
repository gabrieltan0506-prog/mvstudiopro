import React, { useMemo, useRef, useState } from "react";

type TabKey = "script" | "image" | "video" | "music";
type GoogleImageModel =
  | "gemini-3.1-flash-image-preview"
  | "gemini-3-pro-image-preview"
  | "imagen-4.0-ultra";
type OpenAIImageModel = "gpt-image-2";
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
  const [googleImageModel, setGoogleImageModel] = useState<GoogleImageModel>("gemini-3.1-flash-image-preview");
  const [openaiImageModel] = useState<OpenAIImageModel>("gpt-image-2");
  const [openaiSize, setOpenaiSize] = useState("1024x1024");
  const [openaiQuality, setOpenaiQuality] = useState("high");
  const [openaiFormat, setOpenaiFormat] = useState("png");
  const [openaiCompression, setOpenaiCompression] = useState("85");
  const [klingImageModel, setKlingImageModel] = useState("kling-v2-1");
  const [imageProvider, setImageProvider] = useState<"google" | "openai" | "kling">("google");
  const [imageResolution, setImageResolution] = useState("1k");
  const [imageCount, setImageCount] = useState("1");
  const [guidanceScale, setGuidanceScale] = useState("4.0");
  const [imageSeed, setImageSeed] = useState("");
  const [personGeneration, setPersonGeneration] = useState<"ALLOW_ADULT" | "ALLOW_ALL" | "DONT_ALLOW">("ALLOW_ADULT");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageTaskId, setImageTaskId] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [upscaleBusy, setUpscaleBusy] = useState(false);
  const [upscaleFactor, setUpscaleFactor] = useState<"x2" | "x3" | "x4">("x2");
  const [upscaledImageUrl, setUpscaledImageUrl] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editedImageUrl, setEditedImageUrl] = useState("");

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
      setUpscaledImageUrl("");
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
    setUpscaledImageUrl("");
    setDebug({ ok: true, action: "image:start" });

    try {
      if (imageProvider === "openai") {
        const r = await fetchJsonish("/api/trpc/openaiImage.generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            json: {
              prompt,
              model: "gpt-image-2",
              size: openaiSize,
              quality: openaiQuality,
              output_format: openaiFormat,
              output_compression: (openaiFormat === "jpeg" || openaiFormat === "webp") ? Number(openaiCompression) : undefined,
              n: 1,
            }
          }),
        });
        setDebug(r);
        const result = r?.json?.result?.data?.json ?? r?.json;
        if (!r.ok || result?.ok === false) throw new Error(result?.error || "openai_image_failed");
        const firstUrl = String(result?.imageUrl || "").trim();
        if (!firstUrl) throw new Error("openai_image_missing_url");
        setImageUrl(firstUrl);
        return;
      }

      if (imageProvider === "google") {
        const model = googleImageModel;
        const tier = model === "gemini-3.1-flash-image-preview" ? "flash" : "pro";
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

  async function runUpscale() {
    const inputImage = imageUrl || refImageUrl;
    if (!inputImage) {
      setDebug({ ok: false, error: "missing_image_for_upscale" });
      return;
    }

    setUpscaleBusy(true);
    setUpscaledImageUrl("");
    setDebug({ ok: true, action: "upscale:start" });

    try {
      const r = await fetchJsonish("/api/google?op=upscaleImage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: inputImage,
          upscaleFactor,
          prompt,
          outputMimeType: "image/png",
        }),
      });
      setDebug(r);
      if (!r.ok) throw new Error("google_upscale_failed");

      const dataUrl = String(r?.json?.imageUrl || "").trim();
      const multi = Array.isArray(r?.json?.imageUrls) ? r.json.imageUrls : [];
      const firstUrl = dataUrl || String(multi[0] || "").trim();
      if (!firstUrl) {
        throw new Error("google_upscale_missing_imageUrl");
      }
      setUpscaledImageUrl(firstUrl);
    } catch (e: any) {
      setDebug({ ok: false, error: e?.message || String(e) });
    } finally {
      setUpscaleBusy(false);
    }
  }

  async function runEditImage() {
    const srcImage = upscaledImageUrl || imageUrl;
    if (!srcImage || !editPrompt.trim()) {
      setDebug({ ok: false, error: "missing_image_or_prompt" });
      return;
    }
    setEditBusy(true);
    setEditedImageUrl("");
    setDebug({ ok: true, action: "edit:start" });
    try {
      const r = await fetchJsonish("/api/trpc/openaiImage.edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          json: {
            imageUrl: srcImage,
            prompt: editPrompt.trim(),
            size: openaiSize,
            quality: openaiQuality,
            output_format: openaiFormat,
          }
        }),
      });
      setDebug(r);
      const result = r?.json?.result?.data?.json ?? r?.json;
      if (!r.ok || result?.ok === false) throw new Error(result?.error || "edit_failed");
      const url = String(result?.imageUrl || "").trim();
      if (!url) throw new Error("edit_missing_url");
      setEditedImageUrl(url);
    } catch (e: any) {
      setDebug({ ok: false, error: e?.message || String(e) });
    } finally {
      setEditBusy(false);
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
                <option value="google">Google（Nano Banana）</option>
                <option value="openai">OpenAI（GPT-image-2）</option>
                <option value="kling">Kling</option>
              </select>
            </div>

            {imageProvider === "openai" ? (
              <div>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>模型</div>
                <select
                  value={openaiImageModel}
                  style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
                  disabled
                >
                  <option value="gpt-image-2">GPT-image-2</option>
                </select>
              </div>
            ) : imageProvider === "google" ? (
              <div>
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>模型</div>
                <select
                  value={googleImageModel}
                  onChange={(e) => setGoogleImageModel(e.target.value as GoogleImageModel)}
                  style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
                >
                  <option value="gemini-3.1-flash-image-preview">Nano Banana 2（gemini-3.1-flash-image-preview）</option>
                  <option value="gemini-3-pro-image-preview">Nano Banana Pro（gemini-3-pro-image-preview）</option>
                  <option value="imagen-4.0-ultra">Imagen 4.0 Ultra（imagen-4.0-ultra → Vertex 展開）</option>
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

            {imageProvider === "openai" ? (
              <>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>尺寸</div>
                  <select
                    value={openaiSize}
                    onChange={(e) => setOpenaiSize(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
                  >
                    <option value="1024x1024">1024×1024（方图）</option>
                    <option value="1536x1024">1536×1024（横图）</option>
                    <option value="1024x1536">1024×1536（竖图）</option>
                    <option value="2048x2048">2048×2048（2K方）</option>
                    <option value="2048x1152">2048×1152（2K横）</option>
                    <option value="3840x2160">3840×2160（4K）</option>
                    <option value="auto">auto（自动）</option>
                  </select>
                </div>

                <div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>质量</div>
                  <select
                    value={openaiQuality}
                    onChange={(e) => setOpenaiQuality(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
                  >
                    <option value="auto">auto（自动）</option>
                    <option value="high">high（高质量）</option>
                    <option value="medium">medium（中等）</option>
                    <option value="low">low（草稿/快速）</option>
                  </select>
                </div>

                <div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>格式</div>
                  <select
                    value={openaiFormat}
                    onChange={(e) => setOpenaiFormat(e.target.value)}
                    style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
                  >
                    <option value="png">PNG（无损）</option>
                    <option value="jpeg">JPEG（快速）</option>
                    <option value="webp">WebP</option>
                  </select>
                </div>

                {(openaiFormat === "jpeg" || openaiFormat === "webp") && (
                  <div>
                    <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>压缩率 ({openaiCompression}%)</div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={openaiCompression}
                      onChange={(e) => setOpenaiCompression(e.target.value)}
                      style={{ width: 120, accentColor: "#f97316" }}
                    />
                  </div>
                )}
              </>
            ) : imageProvider === "google" ? (
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

          {(imageUrl || refImageUrl) ? (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Google Upscale</div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>倍率</div>
                  <select
                    value={upscaleFactor}
                    onChange={(e) => setUpscaleFactor(e.target.value as "x2" | "x3" | "x4")}
                    style={{ padding: "8px 10px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)" }}
                  >
                    <option value="x2">x2</option>
                    <option value="x3">x3</option>
                    <option value="x4">x4</option>
                  </select>
                </div>

                <button
                  onClick={runUpscale}
                  disabled={upscaleBusy}
                  style={{ padding: "10px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 900 }}
                >
                  {upscaleBusy ? "放大中…" : "放大当前图片"}
                </button>
              </div>

              {upscaledImageUrl ? (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>放大结果</div>
                  <img src={upscaledImageUrl} style={{ width: "100%", borderRadius: 14, background: "black" }} />
                  <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <a href={upscaledImageUrl} target="_blank" rel="noreferrer" style={{ color: "white" }}>打开放大图</a>
                    <button
                      onClick={() => setRefImageUrl(upscaledImageUrl)}
                      style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 900 }}
                    >
                      设为参考图
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* GPT-image-2 图片编辑 */}
          {imageProvider === "openai" && (upscaledImageUrl || imageUrl) ? (
            <div style={{ marginTop: 16, padding: 14, borderRadius: 14, border: "1px solid rgba(249,115,22,0.25)", background: "rgba(249,115,22,0.06)" }}>
              <div style={{ fontWeight: 900, marginBottom: 10, color: "#f97316" }}>✏️ 图片编辑（gpt-image-2）</div>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>基于当前生成图，用新 prompt 修改</div>
              <textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder="描述修改内容，如：把背景改成夜晚城市，人物改穿红色服装"
                rows={3}
                style={{ width: "100%", padding: "10px 12px", borderRadius: 10, background: "#111", color: "white", border: "1px solid rgba(255,255,255,0.14)", fontSize: 13, resize: "vertical", boxSizing: "border-box" }}
              />
              <button
                onClick={runEditImage}
                disabled={editBusy || !editPrompt.trim()}
                style={{ marginTop: 10, padding: "10px 20px", borderRadius: 12, background: editBusy ? "rgba(249,115,22,0.3)" : "rgba(249,115,22,0.2)", color: "#f97316", border: "1px solid rgba(249,115,22,0.3)", fontWeight: 900, cursor: editBusy ? "not-allowed" : "pointer" }}
              >
                {editBusy ? "编辑中…" : "开始编辑"}
              </button>
              {editedImageUrl ? (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>编辑结果</div>
                  <img src={editedImageUrl} style={{ width: "100%", borderRadius: 14, background: "black" }} />
                  <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
                    <a href={editedImageUrl} target="_blank" rel="noreferrer" style={{ color: "#f97316" }}>打开编辑图</a>
                    <button
                      onClick={() => { setImageUrl(editedImageUrl); setEditedImageUrl(""); }}
                      style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(249,115,22,0.3)", background: "rgba(249,115,22,0.1)", color: "#f97316", fontWeight: 900 }}
                    >
                      替换为当前图
                    </button>
                  </div>
                </div>
              ) : null}
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

      {/* Debug Panel */}
      {debug ? (
        <div style={{ marginTop: 24, borderRadius: 14, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.45)", padding: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 8, color: debug?.ok === false ? "#ff6b6b" : "#6bffb8" }}>
            {debug?.ok === false ? "❌ 调试输出（失败）" : "✅ 调试输出"}
          </div>
          <pre style={{ fontSize: 11, color: "#ccc", overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 400 }}>
            {JSON.stringify(debug, null, 2)}
          </pre>
        </div>
      ) : null}

    </div>
  );
}
