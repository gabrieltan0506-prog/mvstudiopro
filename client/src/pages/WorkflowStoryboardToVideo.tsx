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
  backgroundStatus?: string;
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

async function postJson(op: string, body: Record<string, any>) {
  const resp = await fetch(`/api/jobs?op=${encodeURIComponent(op)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => null);
  return { ok: resp.ok, json };
}

export default function WorkflowStoryboardToVideo() {
  const [workflowId, setWorkflowId] = useState("");
  const [workflow, setWorkflow] = useState<any>(null);
  const [busyKey, setBusyKey] = useState("");
  const [debug, setDebug] = useState<any>(null);

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

  useEffect(() => {
    if (!workflowId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      const resp = await fetch(`/api/jobs?op=workflowStatus&id=${encodeURIComponent(workflowId)}`);
      const json = await resp.json().catch(() => null);
      if (!cancelled && resp.ok && json?.workflow) {
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
    if (Array.isArray(outputs.storyboard)) setStoryboard(outputs.storyboard);
    if (typeof outputs.dialogueText === "string" && !dialogueText) setDialogueText(outputs.dialogueText);
    if (typeof outputs.voicePrompt === "string" && !voicePrompt) setVoicePrompt(outputs.voicePrompt);
  }, [workflow]);

  const outputs = workflow?.outputs || {};
  const scenes: Scene[] = Array.isArray(storyboard) ? storyboard : [];
  const storyboardImages: SceneImages[] = Array.isArray(outputs.storyboardImages) ? outputs.storyboardImages : [];
  const storyboardConfirmed = Boolean(outputs.storyboardConfirmed);

  async function runStep(stepKey: string, op: string, body: Record<string, any>) {
    if (busyKey) return;
    setBusyKey(stepKey);
    setDebug(null);
    const { ok, json } = await postJson(op, body);
    setDebug(json);
    if (ok && json?.workflow) {
      const nextId = String(json.workflow.workflowId || workflowId || "");
      if (nextId) setWorkflowId(nextId);
      setWorkflow(json.workflow);
    }
    setBusyKey("");
  }

  const isBusy = (step: string) => busyKey === step;

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
          onClick={() => runStep("generateScript", "workflowGenerateScript", {
            workflowId,
            prompt,
            targetWords: Number(targetWords || 0) || undefined,
            targetScenes: Number(targetScenes || 0) || undefined,
            sceneDuration: Number(sceneDuration || 0) || 5,
          })}
          disabled={!!busyKey}
          style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 800 }}
        >
          {isBusy("generateScript") ? "Generating..." : "Generate Script"}
        </button>
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
          onClick={() => runStep("generateStoryboard", "workflowGenerateStoryboard", { workflowId, script: scriptText, targetScenes: Number(targetScenes || 0) || undefined, sceneDuration: Number(sceneDuration || 0) || 5 })}
          disabled={!!busyKey || !workflowId || !scriptText.trim()}
          style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 800 }}
        >
          {isBusy("generateStoryboard") ? "Generating..." : "Generate Storyboard"}
        </button>
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
          onClick={() => runStep("generateStoryboardImages", "workflowGenerateStoryboardImages", { workflowId, storyboard: scenes })}
          disabled={!!busyKey || !workflowId || scenes.length === 0}
          style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 800 }}
        >
          {isBusy("generateStoryboardImages") ? "Generating..." : "Generate Storyboard Images"}
        </button>
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
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => runStep(`regen-${item.sceneIndex}`, "workflowRegenerateSceneImages", { workflowId, sceneIndex: item.sceneIndex })}
                    disabled={!!busyKey || !workflowId}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}
                  >
                    {isBusy(`regen-${item.sceneIndex}`) ? "Regenerating..." : "Regenerate Scene Images"}
                  </button>
                  <button
                    onClick={() => runStep(`lock-${item.sceneIndex}`, "workflowLockCharacter", { workflowId, sceneIndex: item.sceneIndex, locked: !item.characterLocked })}
                    disabled={!!busyKey || !workflowId}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}
                  >
                    {item.characterLocked ? "Unlock Character" : "Lock Character"}
                  </button>
                  <button
                    onClick={() => runStep(`bg-${item.sceneIndex}`, "workflowBackgroundRemove", { workflowId, sceneIndex: item.sceneIndex })}
                    disabled={!!busyKey || !workflowId}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}
                  >
                    {isBusy(`bg-${item.sceneIndex}`) ? "Removing..." : "Background Remove"}
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
                    onClick={() => runStep(`upload-${item.sceneIndex}`, "workflowUploadReferenceCharacter", { workflowId, sceneIndex: item.sceneIndex, referenceCharacterUrl: refInputValue })}
                    disabled={!!busyKey || !workflowId || !refInputValue.trim()}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}
                  >
                    Upload Reference Character
                  </button>
                </div>
                {item.referenceCharacterUrl ? <div style={{ marginTop: 6, fontSize: 12, opacity: 0.9 }}>Reference: <code>{item.referenceCharacterUrl}</code></div> : null}
              </div>
            );
          })}
        </div>
      </div>

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>E. Confirm</h2>
        <button
          onClick={() => runStep("confirmStoryboard", "workflowConfirmStoryboard", { workflowId, storyboard: scenes })}
          disabled={!!busyKey || !workflowId || scenes.length === 0}
          style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 800 }}
        >
          {isBusy("confirmStoryboard") ? "Confirming..." : "Confirm Storyboard"}
        </button>
        <div style={{ marginTop: 8 }}>Storyboard Confirmed: <code>{String(storyboardConfirmed)}</code></div>
      </div>

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>F. Video</h2>
        <button
          onClick={() => runStep("generateVideo", "workflowGenerateVideo", { workflowId })}
          disabled={!!busyKey || !workflowId || !storyboardConfirmed}
          style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: storyboardConfirmed ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)", color: "white", fontWeight: 800 }}
        >
          {isBusy("generateVideo") ? "Generating..." : "Generate Video"}
        </button>
        <div style={{ marginTop: 8 }}>videoProvider: <code>{String(outputs.videoProvider || "")}</code></div>
        <div>videoModel: <code>{String(outputs.videoModel || "")}</code></div>
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
          onClick={() => runStep("generateVoice", "workflowGenerateVoice", { workflowId, dialogueText, voicePrompt })}
          disabled={!!busyKey || !workflowId || !dialogueText.trim()}
          style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 800 }}
        >
          {isBusy("generateVoice") ? "Generating..." : "Generate Voice"}
        </button>
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
          onClick={() => runStep("generateMusic", "workflowGenerateMusic", { workflowId, musicPrompt, musicMood, musicBpm: Number(musicBpm || 0) || undefined, musicDuration: Number(musicDuration || 0) || undefined })}
          disabled={!!busyKey || !workflowId || !musicPrompt.trim()}
          style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 800 }}
        >
          {isBusy("generateMusic") ? "Generating..." : "Generate Music"}
        </button>
        <div style={{ marginTop: 8 }}>musicProvider: <code>{String(outputs.musicProvider || "")}</code></div>
        <div>musicUrl: <code>{String(outputs.musicUrl || "")}</code></div>
      </div>

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>I. Render</h2>
        <button
          onClick={() => runStep("renderFinal", "workflowRenderFinalVideo", { workflowId })}
          disabled={!!busyKey || !workflowId || !outputs.videoUrl}
          style={{ padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 800 }}
        >
          {isBusy("renderFinal") ? "Rendering..." : "Render Final Video"}
        </button>
        <div style={{ marginTop: 8 }}>finalVideoUrl: <code>{String(outputs.finalVideoUrl || "")}</code></div>
        {outputs.finalVideoUrl ? <video controls src={String(outputs.finalVideoUrl)} style={{ width: "100%", marginTop: 8, borderRadius: 8 }} /> : null}
      </div>

      {workflow ? (
        <div style={sectionStyle()}>
          <div>workflowId: <code>{String(workflow.workflowId || "")}</code></div>
          <div>currentStep: <code>{String(workflow.currentStep || "-")}</code></div>
          <div>status: <code>{String(workflow.status || "-")}</code></div>
        </div>
      ) : null}

      {debug ? (
        <pre style={{ whiteSpace: "pre-wrap", marginTop: 16, padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.3)" }}>
          {JSON.stringify(debug, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}
