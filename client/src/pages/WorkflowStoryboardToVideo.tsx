import React, { useEffect, useMemo, useState } from "react";

type Scene = {
  sceneIndex: number;
  scenePrompt: string;
  duration: number;
  camera: string;
  mood: string;
  primarySubject?: string;
  voiceover?: string;
  voiceType?: string;
  voiceStyle?: string;
  character?: string;
  environment?: string;
  action?: string;
  lighting?: string;
  renderStillNeeded?: boolean;
  renderStillPrompt?: string;
};

type SceneImages = {
  sceneIndex: number;
  images: string[];
  imageUrls?: string[];
  characterImages?: string[];
  characterImageUrl?: string;
  sceneImages?: string[];
  sceneImageUrls?: string[];
  selectedSceneImageUrl?: string;
  renderStillImageUrl?: string;
  renderStillPrompt?: string;
  prompt?: string;
  duration?: number;
  sceneVideoUrl?: string;
  sceneVoiceUrl?: string;
  sceneVoicePrompt?: string;
  sceneVoiceType?: string;
  sceneVoiceStyle?: string;
  sceneVoiceVoice?: string;
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

type DebugEntry = {
  op: string;
  request: Record<string, any>;
  httpOk: boolean;
  status: number;
  json: any;
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
    primarySubject: String(item?.primarySubject || item?.character || "").trim(),
    voiceover: String(item?.voiceover || item?.scenePrompt || "").trim(),
    voiceType: String(item?.voiceType || "female").trim() || "female",
    voiceStyle: String(item?.voiceStyle || "").trim(),
    character: String(item?.character || "").trim(),
    environment: String(item?.environment || "").trim(),
    action: String(item?.action || "").trim(),
    lighting: String(item?.lighting || "").trim(),
    renderStillNeeded: Boolean(item?.renderStillNeeded),
    renderStillPrompt: String(item?.renderStillPrompt || item?.scenePrompt || "").trim(),
  }));
}

function getCharacterImageUrls(bundle: any): string[] {
  const explicit = Array.isArray(bundle?.characterImages)
    ? bundle.characterImages
    : [bundle?.characterImageUrl || bundle?.characterPngUrl || bundle?.referenceCharacterUrl].filter(Boolean);
  const normalized = explicit.map((value: any) => String(value || "").trim()).filter(Boolean);
  if (normalized.length) return normalized.slice(0, 1);
  const legacy = Array.isArray(bundle?.imageUrls) ? bundle.imageUrls : Array.isArray(bundle?.images) ? bundle.images : [];
  return legacy.map((value: any) => String(value || "").trim()).filter(Boolean).slice(0, 1);
}

function getSceneImageUrls(bundle: any): string[] {
  const selected = String(bundle?.selectedSceneImageUrl || "").trim();
  const explicit = Array.isArray(bundle?.sceneImageUrls)
    ? bundle.sceneImageUrls
    : Array.isArray(bundle?.sceneImages)
      ? bundle.sceneImages
      : [];
  const normalized = explicit.map((value: any) => String(value || "").trim()).filter(Boolean);
  if (normalized.length) {
    const ordered = selected && normalized.includes(selected)
      ? [selected, ...normalized.filter((value: string) => value !== selected)]
      : normalized;
    return ordered.slice(0, 2);
  }
  const legacy = Array.isArray(bundle?.imageUrls) ? bundle.imageUrls : Array.isArray(bundle?.images) ? bundle.images : [];
  const normalizedLegacy = legacy.map((value: any) => String(value || "").trim()).filter(Boolean).slice(1, 3);
  if (selected && normalizedLegacy.includes(selected)) {
    return [selected, ...normalizedLegacy.filter((value: string) => value !== selected)].slice(0, 2);
  }
  return normalizedLegacy;
}

function getCombinedAssetUrls(bundle: any): string[] {
  return [...getSceneImageUrls(bundle), ...getCharacterImageUrls(bundle)].filter(Boolean);
}

function isVercelBlobUrl(url: string) {
  return /\.blob\.vercel-storage\.com\//i.test(String(url || ""));
}

function toAssetDisplayUrl(url: string) {
  const normalized = String(url || "").trim();
  if (!normalized) return "";
  if (!isVercelBlobUrl(normalized)) return normalized;
  return `/api/jobs?op=blobMedia&url=${encodeURIComponent(normalized)}`;
}

function toAbsoluteAssetUrl(url: string) {
  const normalized = toAssetDisplayUrl(url);
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (typeof window === "undefined") return normalized;
  return new URL(normalized, window.location.origin).toString();
}

function buildMusicPromptSeedFromScenes(scenes: Scene[]) {
  const joined = scenes.slice(0, 4).map((scene) => scene.scenePrompt?.trim() || "").join(" ");
  const moodText = scenes.slice(0, 4).map((scene) => scene.mood?.trim() || "").join(" ");
  const combined = `${joined} ${moodText}`;
  const style =
    /(间谍|特工|潜行|追逐|杀手)/.test(combined) ? "间谍电影风格" :
    /(拉丁|热带|舞蹈|海边)/.test(combined) ? "拉丁电影风格" :
    "电影配乐";
  const mood =
    /(紧张|惊险|悬疑|危机|追逐)/.test(combined) ? "紧张悬疑" :
    /(浪漫|温柔|治愈)/.test(combined) ? "温柔抒情" :
    /(悲伤|孤独|诀别)/.test(combined) ? "伤感克制" :
    "电影感推进";
  const instrumentation =
    /(紧张|惊险|悬疑|危机|追逐)/.test(combined)
      ? "管弦乐与电子脉冲"
      : "弦乐与钢琴";
  const lead =
    /(拉丁|热带)/.test(combined) ? "拉丁打击乐主律动" :
    /(间谍|特工|潜行|追逐|杀手)/.test(combined) ? "低音弦乐与钢琴主旋律" :
    "钢琴主旋律";
  return `${style}，${mood}，${instrumentation}，${lead}，纯音乐，无人声。`.slice(0, 100);
}

function mapSceneVoiceTypeToVoice(voiceType: string) {
  const normalized = String(voiceType || "").trim().toLowerCase();
  if (normalized === "male") return "onyx";
  if (normalized === "cartoon") return "echo";
  return "shimmer";
}

async function postJson(op: string, body: Record<string, any>) {
  const resp = await fetch(`/api/jobs?op=${encodeURIComponent(op)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => null);
  return { httpOk: resp.ok, status: resp.status, json };
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

  const [renderStillPromptMap, setRenderStillPromptMap] = useState<Record<string, string>>({});
  const [sceneVoiceTypeMap, setSceneVoiceTypeMap] = useState<Record<string, string>>({});
  const [sceneVoiceStyleMap, setSceneVoiceStyleMap] = useState<Record<string, string>>({});
  const [scriptDirty, setScriptDirty] = useState(false);
  const [storyboardDirty, setStoryboardDirty] = useState(false);
  const [auxBusyKey, setAuxBusyKey] = useState("");
  const [auxError, setAuxError] = useState("");
  const [exportError, setExportError] = useState("");
  const [uploadingAssetKey, setUploadingAssetKey] = useState<string | null>(null);
  const [renderStillWarningScene, setRenderStillWarningScene] = useState<number | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [envStatus, setEnvStatus] = useState<Record<string, boolean> | null>(null);
  const [lastDebugEntry, setLastDebugEntry] = useState<DebugEntry | null>(null);

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
    if (typeof outputs.script === "string" && !scriptDirty) setScriptText(outputs.script);
    if (Array.isArray(outputs.storyboard) && !storyboardDirty) {
      const normalizedStoryboard = normalizeSceneList(outputs.storyboard, 8);
      setStoryboard(normalizedStoryboard);
      setSceneVoiceTypeMap((prev) => {
        const next = { ...prev };
        for (const scene of normalizedStoryboard) {
          const key = String(scene.sceneIndex || "");
          if (!next[key]) next[key] = scene.voiceType || "female";
        }
        return next;
      });
      setSceneVoiceStyleMap((prev) => {
        const next = { ...prev };
        for (const scene of normalizedStoryboard) {
          const key = String(scene.sceneIndex || "");
          if (!(key in next)) next[key] = scene.voiceStyle || "";
        }
        return next;
      });
    }
    if (typeof outputs.dialogueText === "string" && !dialogueText) setDialogueText(outputs.dialogueText);
    if (typeof outputs.voicePrompt === "string" && !voicePrompt) setVoicePrompt(outputs.voicePrompt);
  }, [workflow, dialogueText, voicePrompt, scriptDirty, storyboardDirty]);

  useEffect(() => {
    const generated = buildMusicPromptSeedFromScenes(Array.isArray(storyboard) ? storyboard : []);
    if (!generated) return;
    setMusicPrompt((prev) => {
      const trimmed = String(prev || "").trim();
      if (!trimmed || trimmed === "cinematic trailer soundtrack, hybrid orchestral + modern electronic pulse, no vocal") {
        return generated;
      }
      return prev;
    });
  }, [storyboard]);

  useEffect(() => {
    if (!debugMode) return;
    let cancelled = false;
    void (async () => {
      const resp = await fetch("/api/jobs?op=envStatus");
      const json = await resp.json().catch(() => null);
      if (!cancelled && resp.ok && json?.env) setEnvStatus(json.env);
    })();
    return () => {
      cancelled = true;
    };
  }, [debugMode]);

  const outputs = workflow?.outputs || {};
  const scenes: Scene[] = Array.isArray(storyboard) ? storyboard : [];
  const storyboardImages: SceneImages[] = Array.isArray(outputs.storyboardImages) ? outputs.storyboardImages : [];
  const storyboardImageWarnings: string[] = Array.isArray(outputs.storyboardImageWarnings) ? outputs.storyboardImageWarnings : [];
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
    setScriptDirty(false);
    setStoryboardDirty(false);
  }

  function getSceneVoiceTypeValue(scene: Scene) {
    return sceneVoiceTypeMap[String(scene.sceneIndex)] ?? scene.voiceType ?? "female";
  }

  function getSceneVoiceStyleValue(scene: Scene) {
    return sceneVoiceStyleMap[String(scene.sceneIndex)] ?? scene.voiceStyle ?? "";
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
        script: scriptText,
        storyboard: scenes,
      };
      const { httpOk, status, json } = await postJson(op, payload);
      if (debugMode) {
        setLastDebugEntry({ op, request: payload, httpOk, status, json });
      }
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
        script: scriptText,
        storyboard: scenes,
      };
      const { httpOk, status, json } = await postJson(op, payload);
      if (debugMode) {
        setLastDebugEntry({ op, request: payload, httpOk, status, json });
      }
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

  async function uploadSceneReferenceImage(file: File, sceneIndex: number, assetType: "character" | "scene" | "renderstill") {
    try {
      setUploadingAssetKey(`${sceneIndex}:${assetType}`);
      setAuxError("");
      const dataUrl = await fileToDataUrl(file);
      const uploadResp = await fetch("/api/blob-put-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, filename: `scene-${sceneIndex}-${assetType}.jpg` }),
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
          assetType,
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
      setUploadingAssetKey(null);
    }
  }

  async function exportStoryboardDoc(format: "docx" | "pdf") {
    setExportError("");
    const scenesPayload = scenes.map((scene) => {
      const bundle = sceneBundlesByIndex[Number(scene.sceneIndex || 0)];
      const imageUrls = getCombinedAssetUrls(bundle).map((value) => toAbsoluteAssetUrl(value)).filter(Boolean);
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
      const message = extractErrorText(json);
      setExportError(message);
      throw new Error(message);
    }
    const link = document.createElement("a");
    link.href = String(json.url);
    if (!String(json.url).startsWith("data:")) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    link.download = format === "pdf" ? "storyboard.pdf" : "storyboard.docx";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function exportStoryboardImage(imageUrl: string) {
    const a = document.createElement("a");
    a.href = toAssetDisplayUrl(imageUrl);
    a.target = "_blank";
    a.rel = "noreferrer";
    a.download = `storyboard-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function requestSceneVideoGeneration(scene: Scene) {
    if (scene.renderStillNeeded) {
      setRenderStillWarningScene(Number(scene.sceneIndex || 0));
      return;
    }
    const sceneVoiceType = getSceneVoiceTypeValue(scene);
    const sceneVoiceStyle = getSceneVoiceStyleValue(scene);
    void runAuxStep(`scene-video-${scene.sceneIndex}`, "workflowGenerateSceneVideo", {
      workflowId,
      sceneIndex: scene.sceneIndex,
      duration: "8s",
      scenePrompt: String(scene.scenePrompt || "").trim(),
      primarySubject: String(scene.primarySubject || scene.character || "").trim(),
      character: String(scene.character || "").trim(),
      action: String(scene.action || "").trim(),
      camera: String(scene.camera || "").trim(),
      mood: String(scene.mood || "").trim(),
      lighting: String(scene.lighting || "").trim(),
      voiceType: String(sceneVoiceType || "female").trim() || "female",
      voiceStyle: String(sceneVoiceStyle || "").trim(),
    });
  }

  function requestSceneVoiceGeneration(scene: Scene) {
    const sceneVoiceType = getSceneVoiceTypeValue(scene);
    const sceneVoiceStyle = getSceneVoiceStyleValue(scene);
    void runAuxStep(`scene-voice-${scene.sceneIndex}`, "workflowGenerateSceneVoice", {
      workflowId,
      sceneIndex: scene.sceneIndex,
      dialogueText: String(scene.voiceover || scene.scenePrompt || "").trim(),
      voicePrompt,
      voiceType: String(sceneVoiceType || "female").trim() || "female",
      voiceStyle: String(sceneVoiceStyle || "").trim(),
      voice: mapSceneVoiceTypeToVoice(String(sceneVoiceType || "female")),
    });
  }

  async function generateAllSceneAssetsSequentially() {
    if (!workflowId || scenes.length === 0) return;
    setStepState("generateStoryboardImages", { loading: true, error: "", success: false });
    const warnings: string[] = [];
    let currentWorkflow = workflow;
    let completed = 0;
    for (const scene of scenes) {
      const payload = {
        workflowId,
        workflow: currentWorkflow || workflow || undefined,
        script: scriptText,
        storyboard: scenes,
        sceneIndex: scene.sceneIndex,
      };
      try {
        const { httpOk, status, json } = await postJson("workflowGenerateSceneImage", payload);
        if (debugMode) {
          setLastDebugEntry({ op: "workflowGenerateSceneImage", request: payload, httpOk, status, json });
        }
        if (!httpOk || json?.ok !== true) {
          warnings.push(`scene ${scene.sceneIndex}: ${extractErrorText(json)}`);
          continue;
        }
        completed += 1;
        currentWorkflow = json.workflow || currentWorkflow;
        writeBackWorkflow(json);
      } catch (error: any) {
        warnings.push(`scene ${scene.sceneIndex}: ${error?.message || String(error) || "unknown_error"}`);
      }
    }
    if (warnings.length && completed === 0) {
      setStepState("generateStoryboardImages", { loading: false, success: false, error: warnings.join(" | ") });
      return;
    }
    if (warnings.length) {
      setStepState("generateStoryboardImages", { loading: false, success: true, error: warnings.join(" | ") });
      return;
    }
    setStepState("generateStoryboardImages", { loading: false, success: true, error: "" });
  }

  function selectSceneImage(sceneIndex: number, imageUrl: string) {
    setWorkflow((prev: any) => {
      if (!prev?.outputs?.storyboardImages) return prev;
      const storyboardImages = prev.outputs.storyboardImages.map((item: any) =>
        Number(item?.sceneIndex) === sceneIndex
          ? {
              ...item,
              selectedSceneImageUrl: imageUrl,
              sceneImageUrls: Array.isArray(item?.sceneImageUrls)
                ? [imageUrl, ...item.sceneImageUrls.filter((value: string) => value !== imageUrl)].slice(0, 2)
                : item?.sceneImageUrls,
              sceneImages: Array.isArray(item?.sceneImages)
                ? [imageUrl, ...item.sceneImages.filter((value: string) => value !== imageUrl)].slice(0, 2)
                : item?.sceneImages,
            }
          : item,
      );
      return {
        ...prev,
        outputs: {
          ...prev.outputs,
          storyboardImages,
        },
      };
    });
    void runAuxStep(`scene-select-${sceneIndex}`, "workflowSelectSceneImage", {
      workflowId,
      sceneIndex,
      imageUrl,
    });
  }

  function getRenderStillPromptValue(scene: Scene) {
    return renderStillPromptMap[String(scene.sceneIndex)] ?? scene.renderStillPrompt ?? scene.scenePrompt ?? "";
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 20, color: "white" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>/workflow</h1>
      <p style={{ opacity: 0.9, marginTop: 8 }}>
        Step 1 Generate Script → Step 2 Generate Storyboard → Step 3 Generate Scene Assets → Step 4 Per-scene Character + Scene Upload → Step 5 Per-scene Voice + Video → Step 6 Optional Global Voice → Step 7 Generate Music → Step 8 Final Render
      </p>
      <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setDebugMode((prev) => !prev)}
          style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: debugMode ? "rgba(236,72,153,0.18)" : "rgba(255,255,255,0.08)", color: "white" }}
        >
          {debugMode ? "Debug Mode: ON" : "Debug Mode: OFF"}
        </button>
        {envStatus ? (
          <div style={{ fontSize: 12, opacity: 0.82 }}>
            env:
            {" hasFAL="}{String(Boolean(envStatus.hasFalKey))}
            {" hasOpenAI="}{String(Boolean(envStatus.hasOpenAIKey))}
            {" hasAiMusic="}{String(Boolean(envStatus.hasAiMusicKey))}
            {" hasBlob="}{String(Boolean(envStatus.hasBlobReadWriteToken))}
            {" hasMVSPBlob="}{String(Boolean(envStatus.hasMvspReadWriteToken))}
          </div>
        ) : null}
      </div>
      {debugMode && lastDebugEntry ? (
        <div style={{ ...sectionStyle(), marginTop: 12 }}>
          <h2 style={{ marginTop: 0 }}>Debug</h2>
          <div style={{ fontSize: 13, opacity: 0.88 }}>Last Op: <code>{lastDebugEntry.op}</code></div>
          <div style={{ fontSize: 13, opacity: 0.88 }}>HTTP: <code>{String(lastDebugEntry.status)}</code> / ok=<code>{String(lastDebugEntry.httpOk)}</code></div>
          <div style={{ marginTop: 10, fontWeight: 700 }}>Request</div>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, opacity: 0.9 }}>{JSON.stringify(lastDebugEntry.request, null, 2)}</pre>
          <div style={{ marginTop: 10, fontWeight: 700 }}>Response</div>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, opacity: 0.9 }}>{JSON.stringify(lastDebugEntry.json, null, 2)}</pre>
        </div>
      ) : null}

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
          onChange={(e) => {
            setScriptDirty(true);
            setScriptText(e.target.value);
          }}
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
            setStoryboardDirty(true);
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
              <div style={{ fontSize: 14, lineHeight: 1.6, opacity: 0.92 }}>{scene.scenePrompt || "-"}</div>
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.75 }}>
                主体：{scene.primarySubject || scene.character || "-"} / 时长：8 秒 / 如需编辑视频 prompt、旁白、render still，请在下方 `D. Scene Editor` 中修改。
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => void generateAllSceneAssetsSequentially()}
          disabled={anyMainStepLoading || !workflowId || scenes.length === 0}
          style={{ marginTop: 10, padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white", fontWeight: 800 }}
        >
          {stepStates.generateStoryboardImages.loading ? "Generating..." : "Generate All Scene Assets"}
        </button>
        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.85 }}>Each scene generates one character image plus one to two scene images. Multi-person moments should be handled as render stills, not AI scene videos.</div>
        {stepStates.generateStoryboardImages.success ? <div style={statusTextStyle("#84f5a0")}>Scene assets generated successfully.</div> : null}
        {stepStates.generateStoryboardImages.error ? <div style={statusTextStyle("#ff8080")}>Storyboard Images Error: {stepStates.generateStoryboardImages.error}</div> : null}
        {storyboardImageWarnings.length ? (
          <div style={statusTextStyle("#ffdd99")}>Scene Asset Warnings: {storyboardImageWarnings.join(" | ")}</div>
        ) : null}
      </div>

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>D. Scene Editor</h2>
        <div style={{ marginBottom: 12, fontSize: 13, opacity: 0.85 }}>
          Rule: each scene keeps one character image and one or two scene-only images. Scene video uses this exact bundle for FAL.
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <button type="button" onClick={() => void exportStoryboardDoc("docx").catch(() => undefined)}>Export DOCX</button>
          <button type="button" onClick={() => void exportStoryboardDoc("pdf").catch(() => undefined)}>Export PDF</button>
        </div>
        {exportError ? <div style={statusTextStyle("#ff8080")}>Export Error: {exportError}</div> : null}
        <div style={{ display: "grid", gap: 10 }}>
          {scenes.map((scene) => {
            const item = sceneBundlesByIndex[Number(scene.sceneIndex || 0)] || { sceneIndex: scene.sceneIndex, images: [] };
            const characterImageUrls = getCharacterImageUrls(item);
            const sceneImageUrls = getSceneImageUrls(item);
            const busyGenerateImage = auxBusyKey === `scene-image-${scene.sceneIndex}`;
            const busyGenerateVideo = auxBusyKey === `scene-video-${scene.sceneIndex}`;
            const busyGenerateVoice = auxBusyKey === `scene-voice-${scene.sceneIndex}`;
            const busyGenerateRenderStill = auxBusyKey === `render-still-${scene.sceneIndex}`;
            const renderStillPromptValue = getRenderStillPromptValue(scene);
            const selectedSceneImageUrl = String(item.selectedSceneImageUrl || sceneImageUrls[0] || "").trim();
            return (
              <div key={String(scene.sceneIndex)} style={{ padding: 10, borderRadius: 10, background: "rgba(0,0,0,0.3)" }}>
                <div style={{ fontWeight: 700 }}>Scene {scene.sceneIndex}</div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.88 }}>Primary Subject: <code>{scene.primarySubject || scene.character || "-"}</code></div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.88 }}>Render Still Needed: <code>{String(Boolean(scene.renderStillNeeded))}</code></div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.88 }}>Character Image: <code>{String(characterImageUrls[0] || "")}</code></div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.88 }}>Scene Images: <code>{String(sceneImageUrls.length)}</code></div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.88 }}>Selected Scene Image: <code>{selectedSceneImageUrl || "-"}</code></div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.88 }}>Render Still Image: <code>{String(item.renderStillImageUrl || "")}</code></div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.88 }}>Scene Voice URL: <code>{String(item.sceneVoiceUrl || "")}</code></div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.88 }}>Scene Voice Type: <code>{String(item.sceneVoiceType || scene.voiceType || "-")}</code></div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.88 }}>Scene Voice Style: <code>{String(item.sceneVoiceStyle || scene.voiceStyle || "-")}</code></div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.88 }}>Scene Voice Engine Voice: <code>{String(item.sceneVoiceVoice || "-")}</code></div>
                <div style={{ marginTop: 10, fontWeight: 600 }}>Scene Prompt</div>
                <textarea
                  value={scene.scenePrompt || ""}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setStoryboardDirty(true);
                    setStoryboard((prev) =>
                      prev.map((entry) =>
                        Number(entry.sceneIndex) === Number(scene.sceneIndex)
                          ? { ...entry, scenePrompt: nextValue }
                          : entry,
                      ),
                    );
                  }}
                  rows={3}
                  placeholder="Per-scene video prompt"
                  style={{ width: "100%", marginTop: 8, padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
                />
                <div style={{ marginTop: 10, fontWeight: 600 }}>Render Still Prompt</div>
                <textarea
                  value={renderStillPromptValue}
                  onChange={(e) => setRenderStillPromptMap((prev) => ({ ...prev, [String(scene.sceneIndex)]: e.target.value }))}
                  rows={3}
                  placeholder="Describe the multi-character still frame for final render"
                  style={{ width: "100%", marginTop: 8, padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
                />
                <div style={{ marginTop: 8, fontWeight: 600 }}>Character</div>
                {characterImageUrls.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 360px)", gap: 8, marginTop: 8 }}>
                    {characterImageUrls.map((url: string, idx: number) => (
                      <div key={`${scene.sceneIndex}-${idx}`}>
                        <img src={toAssetDisplayUrl(url)} style={{ width: "100%", borderRadius: 8, background: "black" }} />
                        <div style={{ marginTop: 8 }}>
                          <button type="button" onClick={() => exportStoryboardImage(url)}>Export Image</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div style={{ marginTop: 12, fontWeight: 600 }}>Scene Images</div>
                {sceneImageUrls.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                    {sceneImageUrls.map((url: string, idx: number) => (
                      <div
                        key={`${scene.sceneIndex}-scene-${idx}`}
                        onClick={() => selectSceneImage(Number(scene.sceneIndex || 0), url)}
                        style={{
                          borderRadius: 10,
                          padding: 6,
                          border: selectedSceneImageUrl === url ? "2px solid #f59e0b" : "1px solid rgba(255,255,255,0.12)",
                          boxShadow: selectedSceneImageUrl === url ? "0 0 0 2px rgba(245,158,11,0.18)" : "none",
                          cursor: "pointer",
                        }}
                      >
                        <img src={toAssetDisplayUrl(url)} style={{ width: "100%", borderRadius: 8, background: "black" }} />
                        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button type="button" onClick={(e) => { e.stopPropagation(); selectSceneImage(Number(scene.sceneIndex || 0), url); }}>
                            {selectedSceneImageUrl === url ? "Selected" : "Use This Scene"}
                          </button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); exportStoryboardImage(url); }}>Export Image</button>
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
                {item.renderStillImageUrl ? (
                  <div style={{ marginTop: 10, maxWidth: 360 }}>
                    <img src={toAssetDisplayUrl(String(item.renderStillImageUrl))} style={{ width: "100%", borderRadius: 8, background: "black" }} />
                  </div>
                ) : null}
                <div style={{ marginTop: 10, fontWeight: 600 }}>Scene Voice Text</div>
                <textarea
                  value={scene.voiceover || scene.scenePrompt || ""}
                  onChange={(e) => {
                    setStoryboardDirty(true);
                    setStoryboard((prev) =>
                      prev.map((entry) =>
                        Number(entry.sceneIndex) === Number(scene.sceneIndex)
                          ? { ...entry, voiceover: e.target.value }
                          : entry,
                      ),
                    );
                  }}
                  rows={2}
                  placeholder="Per-scene voice text"
                  style={{ width: "100%", marginTop: 8, padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
                />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                  <select
                    value={getSceneVoiceTypeValue(scene)}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setSceneVoiceTypeMap((prev) => ({ ...prev, [String(scene.sceneIndex)]: nextValue }));
                      setStoryboardDirty(true);
                      setStoryboard((prev) =>
                        prev.map((entry) =>
                          Number(entry.sceneIndex) === Number(scene.sceneIndex)
                            ? { ...entry, voiceType: nextValue }
                            : entry,
                        ),
                      );
                    }}
                    style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
                  >
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="cartoon">Cartoon</option>
                  </select>
                  <select
                    value={getSceneVoiceStyleValue(scene)}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setSceneVoiceStyleMap((prev) => ({ ...prev, [String(scene.sceneIndex)]: nextValue }));
                      setStoryboardDirty(true);
                      setStoryboard((prev) =>
                        prev.map((entry) =>
                          Number(entry.sceneIndex) === Number(scene.sceneIndex)
                            ? { ...entry, voiceStyle: nextValue }
                            : entry,
                        ),
                      );
                    }}
                    style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
                  >
                    <option value="">Normal</option>
                    <option value="warm">Warm</option>
                    <option value="calm">Calm</option>
                    <option value="energetic">Energetic</option>
                    <option value="cinematic">Cinematic</option>
                  </select>
                </div>
                {item.sceneVoiceUrl ? <audio controls src={String(item.sceneVoiceUrl)} style={{ width: "100%", marginTop: 8 }} /> : null}
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => runAuxStep(`scene-image-${scene.sceneIndex}`, "workflowGenerateSceneImage", { workflowId, sceneIndex: scene.sceneIndex })}
                    disabled={!!auxBusyKey || !workflowId}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}
                  >
                    {busyGenerateImage ? "Generating..." : "Generate Scene Assets"}
                  </button>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}>
                    <span>{uploadingAssetKey === `${scene.sceneIndex}:character` ? "Uploading..." : "Upload Character Image"}</span>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadSceneReferenceImage(file, Number(scene.sceneIndex || 0), "character");
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}>
                    <span>{uploadingAssetKey === `${scene.sceneIndex}:scene` ? "Uploading..." : "Upload Scene Image"}</span>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadSceneReferenceImage(file, Number(scene.sceneIndex || 0), "scene");
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <button
                    onClick={() => requestSceneVoiceGeneration(scene)}
                    disabled={!!auxBusyKey || !workflowId || !String(scene.voiceover || scene.scenePrompt || "").trim()}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}
                  >
                    {busyGenerateVoice ? "Generating..." : "Generate Scene Voice"}
                  </button>
                  <button
                    onClick={() => requestSceneVideoGeneration(scene)}
                    disabled={!!auxBusyKey || !workflowId || characterImageUrls.length === 0 || sceneImageUrls.length === 0}
                    style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}
                  >
                    {busyGenerateVideo ? "Generating..." : "Generate Scene Video"}
                  </button>
                </div>
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ marginBottom: 8, fontWeight: 600 }}>Render Still</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}>
                      <span>{uploadingAssetKey === `${scene.sceneIndex}:renderstill` ? "Uploading..." : "Upload Render Still"}</span>
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadSceneReferenceImage(file, Number(scene.sceneIndex || 0), "renderstill");
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <button
                      onClick={() =>
                        runAuxStep(`render-still-${scene.sceneIndex}`, "workflowGenerateRenderStill", {
                          workflowId,
                          sceneIndex: scene.sceneIndex,
                          renderStillPrompt: renderStillPromptValue,
                        })
                      }
                      disabled={!!auxBusyKey || !workflowId || !renderStillPromptValue.trim()}
                      style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.10)", color: "white" }}
                    >
                      {busyGenerateRenderStill ? "Generating..." : "Generate Render Still"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {auxError ? <div style={statusTextStyle("#ff8080")}>Scene Action Error: {auxError}</div> : null}
      </div>

      {renderStillWarningScene ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "#111",
              padding: 20,
              boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 800 }}>多人場景提示</div>
            <div style={{ marginTop: 12, lineHeight: 1.65, opacity: 0.92 }}>
              此分镜检测为多角色或多人场景，建议不要直接生成 AI 视频。请改为上传或生成静态展示图，最终在 Render 阶段插入。
            </div>
            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
              Scene {renderStillWarningScene} 已标记为 <code>Render Still Needed</code>。
            </div>
            <div style={{ marginTop: 18, display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setRenderStillWarningScene(null)}
                style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", color: "white" }}
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>E. Video</h2>
        <div style={{ marginTop: 8 }}>Each scene video is fixed at 8 seconds and generated per scene.</div>
        <div style={{ marginTop: 8 }}>videoProvider: <code>{String(outputs.videoProvider || "")}</code></div>
        <div>videoModel: <code>{String(outputs.videoModel || "")}</code></div>
        <div>videoUrl: <code>{String(outputs.videoUrl || "")}</code></div>
      </div>

      <div style={sectionStyle()}>
        <h2 style={{ marginTop: 0 }}>F. Global Voice (Optional)</h2>
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <button type="button" onClick={() => setMusicPrompt(buildMusicPromptSeedFromScenes(scenes) || musicPrompt)}>
            Auto Fill From Scenes
          </button>
        </div>
        <textarea
          value={musicPrompt}
          onChange={(e) => setMusicPrompt(e.target.value.slice(0, 100))}
          maxLength={100}
          rows={3}
          placeholder="Music Prompt"
          style={{ width: "100%", padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "white" }}
        />
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.78 }}>
          {String(musicPrompt || "").length}/100 - 以音乐风格、情绪、主旋律和主乐器为主，剧情描述尽量不超过五句。
        </div>
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
        {outputs.musicUrl ? <audio controls src={String(outputs.musicUrl)} style={{ width: "100%", marginTop: 8 }} /> : null}
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
