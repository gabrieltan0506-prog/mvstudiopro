import React, { useEffect, useMemo, useState } from "react";

type Scene = {
  sceneIndex: number;
  scenePrompt: string;
  duration: number;
  camera: string;
  mood: string;
  character?: string;
  environment?: string;
  action?: string;
  lighting?: string;
};

type SceneImages = {
  sceneIndex: number;
  images: string[];
  imageUrls?: string[];
  prompt?: string;
  duration?: number;
  sceneVideoUrl?: string;
  characterLocked?: boolean;
  referenceCharacterUrl?: string;
  characterPngUrl?: string;
  backgroundStatus?: string;
};

type MainStepKey =
  | "generateScript"
  | "generateStoryboard"
  | "generateStoryboardImages"
  | "generateVoice"
  | "generateMusic"
  | "renderFinalVideo";

type StepState = {
  loading: boolean;
  error: string;
  success: boolean;
};

const INITIAL_STEP_STATES: Record<MainStepKey, StepState> = {
  generateScript: { loading: false, error: "", success: false },
  generateStoryboard: { loading: false, error: "", success: false },
  generateStoryboardImages: { loading: false, error: "", success: false },
  generateVoice: { loading: false, error: "", success: false },
  generateMusic: { loading: false, error: "", success: false },
  renderFinalVideo: { loading: false, error: "", success: false },
};

function sectionStyle(): React.CSSProperties {
  return {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
  };
}

function statusTextStyle(color: string): React.CSSProperties {
  return {
    marginTop: 8,
    fontSize: 13,
    color,
    fontWeight: 600,
  };
}

function extractErrorText(json: any): string {
  const msg =
    (typeof json?.message === "string" && json.message.trim()) ||
    (typeof json?.error === "string" && json.error.trim()) ||
    "unknown_error";
  return msg;
}

function normalizeSceneList(input: any[], fallbackDuration = 8): Scene[] {
  const src = Array.isArray(input) ? input : [];
  return src.map((item: any, idx: number) => ({
    sceneIndex: Number(item?.sceneIndex || idx + 1),
    scenePrompt: String(item?.scenePrompt || item?.prompt || "").replace(/\r/g, "").replace(/^---+$/gm, "").trim(),
    duration: 8,
    camera: String(item?.camera || "medium").trim() || "medium",
    mood: String(item?.mood || "cinematic").trim() || "cinematic",
    character: String(item?.character || "").trim(),
    environment: String(item?.environment || "").trim(),
    action: String(item?.action || "").trim(),
    lighting: String(item?.lighting || "").trim(),
  }));
}

async function postJson(op: string, body: Record<string, any>) {
  const resp = await fetch(`/api/jobs?op=${encodeURIComponent(op)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => null);
  return { httpOk: resp.ok, json };
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.readAsDataURL(file);
  });
}

export default function WorkflowStoryboardToVideo() {
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<any>(null);
  const [stepStates, setStepStates] = useState<Record<MainStepKey, StepState>>(INITIAL_STEP_STATES);

  const [prompt, setPrompt] = useState("未来都市追逐，镜头节奏快速，电影感强");
  const [targetWords, setTargetWords] = useState("900");
  const [targetScenes, setTargetScenes] = useState("6");
  const [sceneDuration] = useState("8");

  const [scriptText, setScriptText] = useState("");
  const [storyboard, setStoryboard] = useState<Scene[]>([]);

  const [dialogueText, setDialogueText] = useState("");
  const [voicePrompt, setVoicePrompt] = useState("中文自然播报，电影预告片旁白风格");

  const [musicPrompt, setMusicPrompt] = useState("cinematic trailer soundtrack, hybrid orchestral + modern electronic pulse, no vocal");
  const [musicMood, setMusicMood] = useState("cinematic");
  const [musicBpm, setMusicBpm] = useState("110");
  const [musicDuration, setMusicDuration] = useState("30");

  const [referenceInputMap, setReferenceInputMap] = useState<Record<string, string>>({});
  const [auxBusyKey, setAuxBusyKey] = useState("");
  const [auxError, setAuxError] = useState("");
  const [uploadingSceneIndex, setUploadingSceneIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!workflowId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      const resp = await fetch(`/api/jobs?op=workflowStatus&workflowId=${encodeURIComponent(workflowId)}`);
      const json = await resp.json().catch(() => null);
      if (!cancelled && resp.ok && json?.workflow && json.workflow.status !== "not_found") {
        setWorkflow(json.workflow);
      }
      timer = setTimeout(poll, 2000);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [workflowId]);

  useEffect(() => {
    if (!workflow) return;
    const outputs = workflow?.outputs || {};
    if (typeof outputs.script === "string") setScriptText(outputs.script);
    if (Array.isArray(outputs.storyboard)) {
      setStoryboard(normalizeSceneList(outputs.storyboard, 8));
    }
    if (typeof outputs.dialogueText === "string" && !dialogueText) setDialogueText(outputs.dialogueText);
    if (typeof outputs.voicePrompt === "string" && !voicePrompt) setVoicePrompt(outputs.voicePrompt);
  }, [workflow, dialogueText, voicePrompt]);

  const outputs = workflow?.outputs || {};
  const scenes: Scene[] = Array.isArray(storyboard) ? storyboard : [];
  const storyboardImages: SceneImages[] = Array.isArray(outputs.storyboardImages) ? outputs.storyboardImages : [];
  const sceneBundlesByIndex = useMemo(
    () =>
      Object.fromEntries(
        storyboardImages.map((item) => [Number(item?.sceneIndex || 0), item]),
      ) as Record<number, SceneImages>,
    [storyboardImages],
  );

  const anyMainStepLoading = Object.values(stepStates).some((s) => s.loading);
  const hasAnySceneVideo = storyboardImages.some((item) => String(item?.sceneVideoUrl || "").trim());

  function setStepState(step: MainStepKey, patch: Partial<StepState>) {
    setStepStates((prev) => ({
      ...prev,
      [step]: {
        ...prev[step],
        ...patch,
      },
    }));
  }

  function writeBackWorkflow(json: any) {
    const nextId = String(json?.workflow?.workflowId || json?.workflowId || workflowId || "");
    if (nextId) setWorkflowId(nextId);
    if (json?.workflow) setWorkflow(json.workflow);
  }

  async function refreshWorkflow() {
    if (!workflowId) return;
    const resp = await fetch(`/api/jobs?op=workflowStatus&workflowId=${encodeURIComponent(workflowId)}`);
    const json = await resp.json().catch(() => null);
    if (resp.ok && json?.workflow) setWorkflow(json.workflow);
  }

  async function runMainStep(
    step: MainStepKey,
    op: string,
    body: Record<string, any>,
    onSuccess?: (json: any) => void,
  ) {
    setStepState(step, { loading: true, error: "", success: false });
    try {
      const payload = {
        ...body,
        workflowId: body.workflowId || workflowId || undefined,
        workflow: workflow || undefined,
      };
      const { httpOk, json } = await postJson(op, payload);
      const apiOk = json?.ok === true;
      if (!httpOk || !apiOk) {
        setStepState(step, { loading: false, success: false, error: extractErrorText(json) });
        return;
      }
      writeBackWorkflow(json);
      onSuccess?.(json);
      setStepState(step, { loading: false, success: true, error: "" });
    } catch (error: any) {
      setStepState(step, {
        loading: false,
        success: false,
        error: error?.message || String(error) || "unknown_error",
      });
    }
  }

  async function runAuxStep(stepKey: string, op: string, body: Record<string, any>) {
    if (auxBusyKey) return;
    setAuxBusyKey(stepKey);
    setAuxError("");
    try {
      const payload = {
        ...body,
        workflowId: body.workflowId || workflowId || undefined,
        workflow: workflow || undefined,
      };
      const { httpOk, json } = await postJson(op, payload);
      if (!httpOk || json?.ok !== true) {
        setAuxError(extractErrorText(json));
        return;
      }
      writeBackWorkflow(json);
    } catch (error: any) {
      setAuxError(error?.message || String(error) || "unknown_error");
    } finally {
      setAuxBusyKey("");
    }
  }

  async function uploadSceneReferenceImage(file: File, sceneIndex: number) {
    try {
      setUploadingSceneIndex(sceneIndex);
      setAuxError("");
      const dataUrl = await fileToDataUrl(file);
      const uploadResp = await fetch("/api/blob-put-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, filename: `scene-${sceneIndex}.jpg` }),
      });
      const uploadJson = await uploadResp.json().catch(() => null);
      if (!uploadResp.ok || !uploadJson?.imageUrl) {
        throw new Error(extractErrorText(uploadJson));
      }

      const bindResp = await fetch("/api/jobs?op=workflowUploadSceneImage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId,
          workflow,
          sceneIndex,
          imageUrl: String(uploadJson.imageUrl || "").trim(),
        }),
      });
      const bindJson = await bindResp.json().catch(() => null);
      if (!bindResp.ok || bindJson?.ok !== true) {
        throw new Error(extractErrorText(bindJson));
      }
      writeBackWorkflow(bindJson);
      await refreshWorkflow();
    } catch (error: any) {
      setAuxError(error?.message || String(error) || "upload_failed");
    } finally {
      setUploadingSceneIndex(null);
    }
  }

  async function exportStoryboardDoc(format: "docx" | "pdf") {
    const scenesPayload = scenes.map((scene) => {
      const bundle = sceneBundlesByIndex[Number(scene.sceneIndex || 0)];
      const imageUrls = Array.isArray(bundle?.imageUrls)
        ? bundle.imageUrls
        : Array.isArray(bundle?.images)
          ? bundle.images
          : [];
      return {
        ...scene,
        imageUrls,
      };
    });
    const resp = await fetch(`/api/export?op=${format === "docx" ? "storyboard-docx" : "storyboard-pdf"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Storyboard Export",
        script: scriptText,
        scenes: scenesPayload,
        isPaidUser: false,
        musicMood,
        musicBpm,
      }),
    });
    const json = await resp.json().catch(() => null);
    if (!resp.ok || !json?.url) {
      throw new Error(extractErrorText(json));
    }
    window.open(String(json.url), "_blank", "noopener,noreferrer");
  }

  function exportStoryboardImage(imageUrl: string) {
    const a = document.createElement("a");
    a.href = imageUrl;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.download = `storyboard-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 20, color: "white" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>/workflow</h1>
      <p style={{ opacity: 0.9, marginTop: 8 }}>
        Step 1 Generate Script → Step 2 Generate Storyboard → Step 3 Generate Scene Images → Step 4 Per-scene Upload / Character Lock / Background Remove → Step 5 Generate Scene Videos → Step 6 Generate Voice → Step 7 Generate Music → Step 8 Final Render
      </p>

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>A. Prompt</h2>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="Prompt"
          style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
          <input value={targetWords} onChange={(e) => setTargetWords(e.target.value)} placeholder="Script Length" style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }} />
          <input value={targetScenes} onChange={(e) => setTargetScenes(e.target.value)} placeholder="Scene Count" style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }} />
          <input value={sceneDuration} readOnly placeholder="Scene Duration" style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", color: "white" }} />
        </div>
        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>Scene duration is fixed at 8 seconds.</div>
        <button
          onClick={() =>
            runMainStep(
              "generateScript",
              "workflowGenerateScript",
              {
                workflowId,
                prompt,
                targetWords: Number(targetWords || 0) || undefined,
                targetScenes: Number(targetScenes || 0) || undefined,
                sceneDuration: 8,
              },
              (json) => {
                const nextId = String(json?.workflow?.workflowId || json?.workflowId || "");
                if (nextId) setWorkflowId(nextId);
                if (typeof json?.script === "string") setScriptText(json.script);
                if (Array.isArray(json?.storyboard)) setStoryboard(normalizeSceneList(json.storyboard, 8));
              },
            )
          }
          disabled={anyMainStepLoading}
          style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 800 }}
        >
          {stepStates.generateScript.loading ? "Generating..." : "Generate Script"}
        </button>
        {stepStates.generateScript.loading ? <div style={statusTextStyle("#ffdd99")}>Generating script...</div> : null}
      </div>

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>B. Script</h2>
        <textarea
          value={scriptText}
          onChange={(e) => setScriptText(e.target.value)}
          rows={8}
          placeholder="Script"
          style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
        />
        <button
          onClick={() => {
            const refreshed = normalizeSceneList(
              Array.isArray(storyboard) ? storyboard : workflow?.outputs?.storyboard || [],
              8,
            );
            if (!refreshed.length) {
              setStepState("generateStoryboard", {
                loading: false,
                success: false,
                error: "storyboard is empty, run Generate Script first",
              });
              return;
            }
            setStoryboard(refreshed);
            setStepState("generateStoryboard", { loading: false, success: true, error: "" });
          }}
          disabled={anyMainStepLoading || !workflowId}
          style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 800 }}
        >
          Generate Storyboard
        </button>
        {stepStates.generateScript.success ? <div style={statusTextStyle("#84f5a0")}>Script generated successfully.</div> : null}
        {stepStates.generateScript.error ? <div style={statusTextStyle("#ff8080")}>Script Error: {stepStates.generateScript.error}</div> : null}
        {stepStates.generateStoryboard.error ? <div style={statusTextStyle("#ff8080")}>Storyboard Error: {stepStates.generateStoryboard.error}</div> : null}
      </div>

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>C. Storyboard</h2>
        <div style={{ display: "grid", gap: 10 }}>
          {scenes.map((scene, idx) => (
            <div key={scene.sceneIndex || idx} style={{ padding: 10, borderRadius: 10, background: "rgba(0,0,0,0.30)", border: "1px solid rgba(255,255,255,0.10)" }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Scene {scene.sceneIndex || idx + 1}</div>
              <textarea
                value={scene.scenePrompt}
                onChange={(e) => {
                  const next = [...scenes];
                  next[idx] = { ...scene, scenePrompt: e.target.value, duration: 8 };
                  setStoryboard(next);
                }}
                rows={3}
                placeholder="scenePrompt"
                style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
                <input value="8" readOnly placeholder="duration" style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", color: "white" }} />
                <input
                  value={scene.camera}
                  onChange={(e) => {
                    const next = [...scenes];
                    next[idx] = { ...scene, camera: e.target.value };
                    setStoryboard(next);
                  }}
                  placeholder="camera"
                  style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
                />
                <input
                  value={scene.mood}
                  onChange={(e) => {
                    const next = [...scenes];
                    next[idx] = { ...scene, mood: e.target.value };
                    setStoryboard(next);
                  }}
                  placeholder="mood"
                  style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
                />
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => runMainStep("generateStoryboardImages", "workflowGenerateStoryboardImages", { workflowId })}
          disabled={anyMainStepLoading || !workflowId || scenes.length === 0}
          style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 800 }}
        >
          {stepStates.generateStoryboardImages.loading ? "Generating..." : "Generate All Scene Images"}
        </button>
        {stepStates.generateStoryboardImages.success ? <div style={statusTextStyle("#84f5a0")}>Storyboard images generated successfully.</div> : null}
        {stepStates.generateStoryboardImages.error ? <div style={statusTextStyle("#ff8080")}>Storyboard Images Error: {stepStates.generateStoryboardImages.error}</div> : null}
      </div>

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>D. Scene Editor</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <button type="button" onClick={() => void exportStoryboardDoc("docx")}>Export DOCX</button>
          <button type="button" onClick={() => void exportStoryboardDoc("pdf")}>Export PDF</button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {scenes.map((scene) => {
            const item = sceneBundlesByIndex[Number(scene.sceneIndex || 0)] || { sceneIndex: scene.sceneIndex, images: [] };
            const imageUrls = Array.isArray(item.imageUrls)
              ? item.imageUrls
              : Array.isArray(item.images)
                ? item.images
                : [];
            const refInputValue = referenceInputMap[String(scene.sceneIndex)] || "";
            const busyGenerateImage = auxBusyKey === `scene-image-${scene.sceneIndex}`;
            const busyGenerateVideo = auxBusyKey === `scene-video-${scene.sceneIndex}`;
            const busyLock = auxBusyKey === `lock-${scene.sceneIndex}`;
            const busyBg = auxBusyKey === `bg-${scene.sceneIndex}`;
            const busyUploadRef = auxBusyKey === `upload-ref-${scene.sceneIndex}`;
            return (
              <div key={String(scene.sceneIndex)} style={{ padding: 10, borderRadius: 10, background: "rgba(0,0,0,0.3)" }}>
                <div style={{ fontWeight: 700 }}>Scene {scene.sceneIndex}</div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.88 }}>Prompt: <code>{scene.scenePrompt || "-"}</code></div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.88 }}>Background Status: <code>{String(item.backgroundStatus || "not_removed")}</code></div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.88 }}>Reference Character: <code>{String(item.referenceCharacterUrl || outputs.referenceCharacterUrl || "")}</code></div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.88 }}>Transparent Character PNG: <code>{String(item.characterPngUrl || outputs.characterPngUrl || "")}</code></div>
                {imageUrls.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                    {imageUrls.map((url: string, idx: number) => (
                      <div key={`${scene.sceneIndex}-${idx}`}>
                        <img src={url} style={{ width: "100%", borderRadius: 8, background: "black" }} />
                        <div style={{ marginTop: 8 }}>
                          <button type="button" onClick={() => exportStoryboardImage(url)}>Export Image</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {item.sceneVideoUrl ? (
                  <div style={{ marginTop: 10 }}>
                    <video controls src={String(item.sceneVideoUrl)} style={{ width: "100%", maxWidth: 720, borderRadius: 12, border: "1px solid #333" }} />
                  </div>
                ) : null}
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => runAuxStep(`scene-image-${scene.sceneIndex}`, "workflowGenerateSceneImage", { workflowId, sceneIndex: scene.sceneIndex })}
                    disabled={!!auxBusyKey || !workflowId}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}
                  >
                    {busyGenerateImage ? "Generating..." : "Generate Scene Image"}
                  </button>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}>
                    <span>{uploadingSceneIndex === scene.sceneIndex ? "Uploading..." : "Upload Image"}</span>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadSceneReferenceImage(file, Number(scene.sceneIndex || 0));
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <button
                    onClick={() => runAuxStep(`scene-video-${scene.sceneIndex}`, "workflowGenerateSceneVideo", { workflowId, sceneIndex: scene.sceneIndex, duration: "8s" })}
                    disabled={!!auxBusyKey || !workflowId || imageUrls.length === 0}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}
                  >
                    {busyGenerateVideo ? "Generating..." : "Generate Scene Video"}
                  </button>
                  <button
                    onClick={() => runAuxStep(`lock-${scene.sceneIndex}`, "workflowLockCharacter", { workflowId, sceneIndex: scene.sceneIndex, locked: !item.characterLocked })}
                    disabled={!!auxBusyKey || !workflowId || imageUrls.length === 0}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}
                  >
                    {busyLock ? "Working..." : item.characterLocked ? "Unlock Character" : "Lock Character"}
                  </button>
                  <button
                    onClick={() => runAuxStep(`bg-${scene.sceneIndex}`, "workflowBackgroundRemove", { workflowId, sceneIndex: scene.sceneIndex })}
                    disabled={!!auxBusyKey || !workflowId || imageUrls.length === 0}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}
                  >
                    {busyBg ? "Removing..." : "Background Remove"}
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 8 }}>
                  <input
                    value={refInputValue}
                    onChange={(e) => {
                      const next = { ...referenceInputMap };
                      next[String(scene.sceneIndex)] = e.target.value;
                      setReferenceInputMap(next);
                    }}
                    placeholder="Reference character image URL"
                    style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
                  />
                  <button
                    onClick={() =>
                      runAuxStep(`upload-ref-${scene.sceneIndex}`, "workflowUploadReferenceCharacter", {
                        workflowId,
                        sceneIndex: scene.sceneIndex,
                        referenceCharacterUrl: refInputValue,
                      })
                    }
                    disabled={!!auxBusyKey || !workflowId || !refInputValue.trim()}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}
                  >
                    {busyUploadRef ? "Uploading..." : "Upload Reference Character"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {auxError ? <div style={statusTextStyle("#ff8080")}>Scene Action Error: {auxError}</div> : null}
      </div>

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>E. Video</h2>
        <div style={{ marginTop: 8 }}>Each scene video is fixed at 8 seconds and generated per scene.</div>
        <div style={{ marginTop: 8 }}>videoProvider: <code>{String(outputs.videoProvider || "")}</code></div>
        <div>videoModel: <code>{String(outputs.videoModel || "")}</code></div>
        <div>videoUrl: <code>{String(outputs.videoUrl || "")}</code></div>
      </div>

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>F. Voice</h2>
        <textarea
          value={dialogueText}
          onChange={(e) => setDialogueText(e.target.value)}
          rows={4}
          placeholder="Dialogue / Voice Text"
          style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
        />
        <input
          value={voicePrompt}
          onChange={(e) => setVoicePrompt(e.target.value)}
          placeholder="Voice Prompt"
          style={{ marginTop: 8, width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
        />
        <button
          onClick={() => runMainStep("generateVoice", "workflowGenerateVoice", { workflowId, dialogueText, voicePrompt })}
          disabled={anyMainStepLoading || !workflowId || !dialogueText.trim()}
          style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 800 }}
        >
          {stepStates.generateVoice.loading ? "Generating..." : "Generate Voice"}
        </button>
        {stepStates.generateVoice.loading ? <div style={statusTextStyle("#ffdd99")}>Generating voice...</div> : null}
        {stepStates.generateVoice.success ? <div style={statusTextStyle("#84f5a0")}>Voice generated successfully.</div> : null}
        {stepStates.generateVoice.error ? <div style={statusTextStyle("#ff8080")}>Voice Error: {stepStates.generateVoice.error}</div> : null}
        <div style={{ marginTop: 8 }}>voiceProvider: <code>{String(outputs.voiceProvider || "")}</code></div>
        <div>voiceModel: <code>{String(outputs.voiceModel || "")}</code></div>
        <div>voiceUrl: <code>{String(outputs.voiceUrl || "")}</code></div>
        {outputs.voiceUrl ? <audio controls src={String(outputs.voiceUrl)} style={{ width: "100%", marginTop: 8 }} /> : null}
      </div>

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>G. Music</h2>
        <textarea
          value={musicPrompt}
          onChange={(e) => setMusicPrompt(e.target.value)}
          rows={3}
          placeholder="Music Prompt"
          style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
          <input value={musicMood} onChange={(e) => setMusicMood(e.target.value)} placeholder="Music Mood" style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }} />
          <input value={musicBpm} onChange={(e) => setMusicBpm(e.target.value)} placeholder="Music BPM" style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }} />
          <input value={musicDuration} onChange={(e) => setMusicDuration(e.target.value)} placeholder="Music Duration" style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }} />
        </div>
        <button
          onClick={() =>
            runMainStep("generateMusic", "workflowGenerateMusic", {
              workflowId,
              musicPrompt,
              musicMood,
              musicBpm: Number(musicBpm || 0) || undefined,
              musicDuration: Number(musicDuration || 0) || undefined,
            })
          }
          disabled={anyMainStepLoading || !workflowId || !musicPrompt.trim()}
          style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 800 }}
        >
          {stepStates.generateMusic.loading ? "Generating..." : "Generate Music"}
        </button>
        {stepStates.generateMusic.loading ? <div style={statusTextStyle("#ffdd99")}>Generating music...</div> : null}
        {stepStates.generateMusic.success ? <div style={statusTextStyle("#84f5a0")}>Music generated successfully.</div> : null}
        {stepStates.generateMusic.error ? <div style={statusTextStyle("#ff8080")}>Music Error: {stepStates.generateMusic.error}</div> : null}
        <div style={{ marginTop: 8 }}>musicProvider: <code>{String(outputs.musicProvider || "")}</code></div>
        <div>musicUrl: <code>{String(outputs.musicUrl || "")}</code></div>
      </div>

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>H. Render</h2>
        <button
          onClick={() => runMainStep("renderFinalVideo", "workflowRenderVideo", { workflowId })}
          disabled={anyMainStepLoading || !workflowId || !hasAnySceneVideo}
          style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 800 }}
        >
          {stepStates.renderFinalVideo.loading ? "Rendering..." : "Final Render"}
        </button>
        {stepStates.renderFinalVideo.loading ? <div style={statusTextStyle("#ffdd99")}>Rendering final video...</div> : null}
        {stepStates.renderFinalVideo.success ? <div style={statusTextStyle("#84f5a0")}>Final video rendered successfully.</div> : null}
        {stepStates.renderFinalVideo.error ? <div style={statusTextStyle("#ff8080")}>Render Error: {stepStates.renderFinalVideo.error}</div> : null}
        <div style={{ marginTop: 8 }}>finalVideoUrl: <code>{String(outputs.finalVideoUrl || "")}</code></div>
        {outputs.finalVideoUrl ? <video controls src={String(outputs.finalVideoUrl)} style={{ width: "100%", marginTop: 8, borderRadius: 8 }} /> : null}
      </div>

      {workflow ? (
        <div style={sectionStyle()}>
          <div>workflowId: <code>{String(workflow.workflowId || "")}</code></div>
          <div>currentStep: <code>{String(workflow.currentStep || "-")}</code></div>
          <div>status: <code>{String(workflow.status || "-")}</code></div>
          <div>lockedCharacters: <code>{JSON.stringify(outputs.lockedCharacters || [])}</code></div>
          <div>referenceImages: <code>{JSON.stringify(outputs.referenceImages || [])}</code></div>
        </div>
      ) : null}
    </div>
  );
}
