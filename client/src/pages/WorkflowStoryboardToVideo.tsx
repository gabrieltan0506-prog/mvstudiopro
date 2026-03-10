import React, { useEffect, useMemo, useState } from "react";

type Scene = {
  sceneIndex: number;
  scenePrompt: string;
  duration: number;
  camera: string;
  mood: string;
};

type SceneImages = {
  sceneIndex: number;
  images: string[];
  characterLocked?: boolean;
  referenceCharacterUrl?: string;
  characterPngUrl?: string;
  backgroundStatus?: string;
};

function normalizeSceneList(input: any[], fallbackDuration = 5): Scene[] {
  const src = Array.isArray(input) ? input : [];
  return src.map((item: any, idx: number) => ({
    sceneIndex: Number(item?.sceneIndex || idx + 1),
    scenePrompt: String(item?.scenePrompt || "").replace(/\r/g, "").replace(/^---+$/gm, "").trim(),
    duration: Number(item?.duration || 0) || fallbackDuration,
    camera: String(item?.camera || "medium").trim() || "medium",
    mood: String(item?.mood || "cinematic").trim() || "cinematic",
  }));
}

type MainStepKey =
  | "generateScript"
  | "generateStoryboard"
  | "generateStoryboardImages"
  | "generateVideo"
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
  generateVideo: { loading: false, error: "", success: false },
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

async function postJson(op: string, body: Record<string, any>) {
  const resp = await fetch(`/api/jobs?op=${encodeURIComponent(op)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => null);
  return { httpOk: resp.ok, json };
}

export default function WorkflowStoryboardToVideo() {
  const [debugInfo, setDebugInfo] = useState<any>(null);
  function showDebug(data: any) {
    try {
      setDebugInfo(JSON.stringify(data, null, 2));
    } catch (e) {
      setDebugInfo(String(data));
    }
  }

  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [workflow, setWorkflow] = useState<any>(null);
  const [stepStates, setStepStates] = useState<Record<MainStepKey, StepState>>(INITIAL_STEP_STATES);

  const [prompt, setPrompt] = useState("未来都市追逐，镜头节奏快速，电影感强");
  const [targetWords, setTargetWords] = useState("900");
  const [targetScenes, setTargetScenes] = useState("6");
  const [sceneDuration, setSceneDuration] = useState("5");

  const [scriptText, setScriptText] = useState("");
  const [storyboard, setStoryboard] = useState<Scene[]>([]);

  const [dialogueText, setDialogueText] = useState("");
  const [voicePrompt, setVoicePrompt] = useState("中文自然播报，电影预告片旁白风格");

  const defaultMusicPrompt = useMemo(
    () => "cinematic trailer soundtrack, hybrid orchestral + modern electronic pulse, no vocal",
    [],
  );
  const [musicPrompt, setMusicPrompt] = useState(defaultMusicPrompt);
  const [musicMood, setMusicMood] = useState("cinematic");
  const [musicBpm, setMusicBpm] = useState("110");
  const [musicDuration, setMusicDuration] = useState("30");

  const [referenceInputMap, setReferenceInputMap] = useState<Record<string, string>>({});
  const [auxBusyKey, setAuxBusyKey] = useState("");
  const [auxError, setAuxError] = useState("");

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
      setStoryboard(normalizeSceneList(outputs.storyboard, Number(outputs.sceneDuration || 0) || 5));
    }
    if (typeof outputs.dialogueText === "string" && !dialogueText) setDialogueText(outputs.dialogueText);
    if (typeof outputs.voicePrompt === "string" && !voicePrompt) setVoicePrompt(outputs.voicePrompt);
  }, [workflow]);

  const outputs = workflow?.outputs || {};
  const scenes: Scene[] = Array.isArray(storyboard) ? storyboard : [];
  const storyboardImages: SceneImages[] = Array.isArray(outputs.storyboardImages) ? outputs.storyboardImages : [];
  const storyboardConfirmed = Boolean(outputs.storyboardConfirmed);

  const anyMainStepLoading = Object.values(stepStates).some((s) => s.loading);

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
    if (json?.workflow) {
      setWorkflow(json.workflow);
    }
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
      showDebug({ step, op, payload, httpOk, json });
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
      showDebug({ stepKey, op, payload, httpOk, json });
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

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 20, color: "white" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>/workflow</h1>
      <p style={{ opacity: 0.9, marginTop: 8 }}>
        Step 1 Generate Script → Step 2 Generate Storyboard → Step 3 Generate Storyboard Images → Step 4 Character Lock / Upload Reference Character / Background Remove → Step 5 Confirm Storyboard → Step 6 Generate Video → Step 7 Generate Voice → Step 8 Generate Music → Step 9 Render Final Video
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
          <input value={sceneDuration} onChange={(e) => setSceneDuration(e.target.value)} placeholder="Scene Duration" style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }} />
        </div>
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
                sceneDuration: Number(sceneDuration || 0) || 5,
              },
              (json) => {
                const nextId = String(json?.workflow?.workflowId || json?.workflowId || "");
                if (nextId) setWorkflowId(nextId);
                if (typeof json?.script === "string") setScriptText(json.script);
                if (Array.isArray(json?.storyboard)) {
                  setStoryboard(normalizeSceneList(json.storyboard, Number(sceneDuration || 0) || 5));
                }
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
              Number(sceneDuration || 0) || 5,
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
          {stepStates.generateStoryboard.loading ? "Refreshing..." : "Generate Storyboard"}
        </button>
        {stepStates.generateScript.success ? <div style={statusTextStyle("#84f5a0")}>Script generated successfully.</div> : null}
        {stepStates.generateScript.error ? <div style={statusTextStyle("#ff8080")}>Script Error: {stepStates.generateScript.error}</div> : null}
        {stepStates.generateStoryboard.loading ? <div style={statusTextStyle("#ffdd99")}>Refreshing storyboard...</div> : null}
        <div style={{ marginTop: 8 }}>scriptProvider: <code>{String(outputs.scriptProvider || "")}</code></div>
        <div>scriptModel: <code>{String(outputs.scriptModel || "")}</code></div>
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
                  next[idx] = { ...scene, scenePrompt: e.target.value };
                  setStoryboard(next);
                }}
                rows={3}
                placeholder="scenePrompt"
                style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
              />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
                <input
                  value={String(scene.duration)}
                  onChange={(e) => {
                    const next = [...scenes];
                    next[idx] = { ...scene, duration: Number(e.target.value || 0) || 5 };
                    setStoryboard(next);
                  }}
                  placeholder="duration"
                  style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
                />
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
          {stepStates.generateStoryboardImages.loading ? "Generating..." : "Generate Storyboard Images"}
        </button>
        {stepStates.generateStoryboard.success ? <div style={statusTextStyle("#84f5a0")}>Storyboard generated successfully.</div> : null}
        {stepStates.generateStoryboard.error ? <div style={statusTextStyle("#ff8080")}>Storyboard Error: {stepStates.generateStoryboard.error}</div> : null}
        {stepStates.generateStoryboardImages.loading ? <div style={statusTextStyle("#ffdd99")}>Generating storyboard images...</div> : null}
        <div style={{ marginTop: 8 }}>storyboard structured status: <code>{String(outputs.storyboardStructuredStatus || "")}</code></div>
      </div>

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>D. Storyboard Images</h2>
        <div style={{ display: "grid", gap: 10 }}>
          {storyboardImages.map((item) => {
            const refInputValue = referenceInputMap[String(item.sceneIndex)] || "";
            return (
              <div key={String(item.sceneIndex)} style={{ padding: 10, borderRadius: 10, background: "rgba(0,0,0,0.3)" }}>
                <div style={{ fontWeight: 700 }}>Scene {item.sceneIndex}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                  {(Array.isArray(item.images) ? item.images : []).map((url: string, idx: number) => (
                    <img key={`${item.sceneIndex}-${idx}`} src={url} style={{ width: "100%", borderRadius: 8, background: "black" }} />
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9 }}>
                  Background Status: <code>{String(item.backgroundStatus || "not_checked")}</code>
                </div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>
                  Reference Character: <code>{String(item.referenceCharacterUrl || outputs.referenceCharacterUrl || "")}</code>
                </div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>
                  Transparent Character PNG: <code>{String(item.characterPngUrl || outputs.characterPngUrl || "")}</code>
                </div>
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => runAuxStep(`regen-${item.sceneIndex}`, "workflowRegenerateSceneImages", { workflowId, sceneIndex: item.sceneIndex })}
                    disabled={!!auxBusyKey || !workflowId}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}
                  >
                    {auxBusyKey === `regen-${item.sceneIndex}` ? "Regenerating..." : "Regenerate Scene Images"}
                  </button>
                  <button
                    onClick={() => runAuxStep(`lock-${item.sceneIndex}`, "workflowLockCharacter", { workflowId, sceneIndex: item.sceneIndex, locked: !item.characterLocked })}
                    disabled={!!auxBusyKey || !workflowId}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}
                  >
                    {item.characterLocked ? "Unlock Character" : "Lock Character"}
                  </button>
                  <button
                    onClick={() => runAuxStep(`bg-${item.sceneIndex}`, "workflowBackgroundRemove", { workflowId, sceneIndex: item.sceneIndex })}
                    disabled={!!auxBusyKey || !workflowId}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}
                  >
                    {auxBusyKey === `bg-${item.sceneIndex}` ? "Removing..." : "Background Remove"}
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 8 }}>
                  <input
                    value={refInputValue}
                    onChange={(e) => {
                      const next = { ...referenceInputMap };
                      next[String(item.sceneIndex)] = e.target.value;
                      setReferenceInputMap(next);
                    }}
                    placeholder="Reference character image URL"
                    style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
                  />
                  <button
                    onClick={() =>
                      runAuxStep(`upload-${item.sceneIndex}`, "workflowUploadReferenceCharacter", {
                        workflowId,
                        sceneIndex: item.sceneIndex,
                        referenceCharacterUrl: refInputValue,
                      })
                    }
                    disabled={!!auxBusyKey || !workflowId || !refInputValue.trim()}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}
                  >
                    Upload Reference Character
                  </button>
                </div>
                {item.referenceCharacterUrl ? <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>Reference: <code>{item.referenceCharacterUrl}</code></div> : null}
                {item.characterPngUrl ? <img src={item.characterPngUrl} style={{ width: 180, marginTop: 8, borderRadius: 8, background: "rgba(255,255,255,0.05)" }} /> : null}
              </div>
            );
          })}
        </div>
        {stepStates.generateStoryboardImages.success ? <div style={statusTextStyle("#84f5a0")}>Storyboard images generated successfully.</div> : null}
        {stepStates.generateStoryboardImages.error ? <div style={statusTextStyle("#ff8080")}>Storyboard Images Error: {stepStates.generateStoryboardImages.error}</div> : null}
        {auxError ? <div style={statusTextStyle("#ff8080")}>Storyboard Images Action Error: {auxError}</div> : null}
      </div>

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>E. Confirm</h2>
        <button
          onClick={() => runAuxStep("confirmStoryboard", "workflowConfirmStoryboard", { workflowId, storyboard: scenes })}
          disabled={!!auxBusyKey || !workflowId || scenes.length === 0}
          style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 800 }}
        >
          {auxBusyKey === "confirmStoryboard" ? "Confirming..." : "Confirm Storyboard"}
        </button>
        <div style={{ marginTop: 8 }}>Storyboard Confirmed: <code>{String(storyboardConfirmed)}</code></div>
      </div>

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>F. Video</h2>
        <button
          onClick={() => runMainStep("generateVideo", "workflowGenerateVideo", { workflowId })}
          disabled={anyMainStepLoading || !workflowId || !storyboardConfirmed}
          style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: storyboardConfirmed ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)", color: "white", fontWeight: 800 }}
        >
          {stepStates.generateVideo.loading ? "Generating..." : "Generate Video"}
        </button>
        {stepStates.generateVideo.loading ? <div style={statusTextStyle("#ffdd99")}>Generating video...</div> : null}
        {stepStates.generateVideo.success ? <div style={statusTextStyle("#84f5a0")}>Video generated successfully.</div> : null}
        {stepStates.generateVideo.error ? <div style={statusTextStyle("#ff8080")}>Video Error: {stepStates.generateVideo.error}</div> : null}
        <div style={{ marginTop: 8 }}>videoProvider: fal <code>{String(outputs.videoProvider || "")}</code></div>
        <div>videoModel: fal-ai/veo3.1/reference-to-video <code>{String(outputs.videoModel || "")}</code></div>
        <div>videoUrl: <code>{String(outputs.videoUrl || "")}</code></div>
        <div>finalVideoUrl: <code>{String(outputs.finalVideoUrl || "")}</code></div>
      </div>

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>G. Voice</h2>
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
        <h2 style={{ marginTop: 0 }}>H. Music</h2>
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
        <h2 style={{ marginTop: 0 }}>I. Render</h2>
        <button
          onClick={() => runMainStep("renderFinalVideo", "workflowRenderFinalVideo", { workflowId })}
          disabled={anyMainStepLoading || !workflowId || !outputs.videoUrl}
          style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 800 }}
        >
          {stepStates.renderFinalVideo.loading ? "Rendering..." : "Render Final Video"}
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
      {debugInfo ? (
        <div style={{ marginTop: 20, padding: 12, border: "1px solid #444", borderRadius: 6, background: "#111", color: "#0f0", fontSize: 12, whiteSpace: "pre-wrap" }}>
          DEBUG RESPONSE:
          {`\n`}{debugInfo}
        </div>
      ) : null}
    </div>
  );
}
