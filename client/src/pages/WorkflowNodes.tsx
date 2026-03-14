import React, { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FileText,
  PanelsTopLeft,
  Image as ImageIcon,
  Video,
  Mic2,
  Music2,
  Clapperboard,
  Sparkles,
  Move,
  Lock,
  Scissors,
  AlertCircle,
  CheckCircle2,
  Bug,
  RefreshCcw,
  LoaderCircle,
  CloudUpload,
  Wand2,
  ArrowRight,
} from "lucide-react";

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
};

type StepState = { loading: boolean; error: string; success: boolean };

type DebugEntry = {
  op: string;
  request: Record<string, any>;
  httpOk: boolean;
  status: number;
  json: any;
};

type NodeStatus = "已接入" | "开发中" | "未接入";

type NodeItem = {
  id: string;
  title: string;
  en: string;
  x: number;
  y: number;
  color: string;
  desc: string;
  icon: React.ComponentType<any>;
  status: NodeStatus;
};

const NODE_ITEMS: NodeItem[] = [
  { id: "prompt", title: "提示词输入", en: "Prompt", x: 60, y: 120, color: "from-fuchsia-500/30 to-pink-500/10", desc: "输入主题、脚本长度与分镜数量，固定 8 秒规则在节点链路内生效。", icon: Sparkles, status: "已接入" },
  { id: "script", title: "脚本生成", en: "Script", x: 320, y: 70, color: "from-violet-500/30 to-indigo-500/10", desc: "根据提示生成完整脚本，并可继续编辑后续场景。", icon: FileText, status: "已接入" },
  { id: "storyboard", title: "故事板", en: "Storyboard", x: 590, y: 70, color: "from-sky-500/30 to-cyan-500/10", desc: "拆分成 scene prompt、主角、镜头、动作、情绪。", icon: PanelsTopLeft, status: "已接入" },
  { id: "assets", title: "分镜资产", en: "Scene Assets", x: 860, y: 70, color: "from-emerald-500/30 to-teal-500/10", desc: "每个分镜保留 1 张角色图和 1 张场景图。", icon: ImageIcon, status: "已接入" },
  { id: "renderStill", title: "多人静帧", en: "Render Still", x: 860, y: 290, color: "from-amber-500/30 to-yellow-500/10", desc: "多人场景不走 AI 视频，改走 Render Still 插帧。", icon: Lock, status: "已接入" },
  { id: "removebg", title: "去背景", en: "Background Removal", x: 1120, y: 290, color: "from-orange-500/30 to-red-500/10", desc: "后续会继续接入角色抠图和延展链路。", icon: Scissors, status: "开发中" },
  { id: "video", title: "视频生成", en: "Scene Video", x: 1120, y: 70, color: "from-blue-500/30 to-indigo-500/10", desc: "按场景逐镜生成 8 秒视频。", icon: Video, status: "已接入" },
  { id: "voice", title: "智能旁白", en: "Scene Voice", x: 1380, y: 70, color: "from-cyan-500/30 to-blue-500/10", desc: "每个 scene 单独生成旁白，可选 voiceType / voiceStyle。", icon: Mic2, status: "已接入" },
  { id: "music", title: "自动配乐", en: "Music", x: 1380, y: 290, color: "from-pink-500/30 to-fuchsia-500/10", desc: "支持 Suno / Udio，生成后统一落到稳定 URL。", icon: Music2, status: "已接入" },
  { id: "render", title: "最终成片", en: "Final Render", x: 1640, y: 180, color: "from-white/20 to-white/5", desc: "统一输出 finalVideoUrl，音乐和语音在这里完成拼接。", icon: Clapperboard, status: "已接入" },
];

const EDGES = [
  ["prompt", "script"],
  ["script", "storyboard"],
  ["storyboard", "assets"],
  ["assets", "renderStill"],
  ["assets", "video"],
  ["video", "render"],
  ["voice", "render"],
  ["music", "render"],
];

const INITIAL_STEP: StepState = { loading: false, error: "", success: false };
const DEFAULT_SCENE_VOICE_PROMPT = "中文自然播报，电影预告片旁白风格";

function badgeClass(status: NodeStatus) {
  if (status === "已接入") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300";
  if (status === "开发中") return "border-amber-400/30 bg-amber-400/10 text-amber-300";
  return "border-white/15 bg-white/5 text-white/60";
}

function edgePath(from: NodeItem, to: NodeItem) {
  const x1 = from.x + 220;
  const y1 = from.y + 58;
  const x2 = to.x;
  const y2 = to.y + 58;
  const c1 = x1 + Math.max(80, (x2 - x1) / 2);
  const c2 = x2 - Math.max(80, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}`;
}

function jparse(t: string) { try { return JSON.parse(t); } catch { return null; } }
function s(v: any): string { if (v == null) return ""; if (Array.isArray(v)) return String(v[0] ?? ""); return String(v); }
function extractErrorText(json: any): string {
  return s(json?.message || json?.error).trim() || "request_failed";
}
function mapSceneVoiceTypeToVoice(voiceType: string) {
  const normalized = s(voiceType).trim().toLowerCase();
  if (normalized === "male") return "onyx";
  if (normalized === "cartoon") return "echo";
  return "shimmer";
}

function normalizeSceneList(input: any[]): Scene[] {
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
    : [bundle?.characterImageUrl].filter(Boolean);
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
    return selected && normalized.includes(selected)
      ? [selected, ...normalized.filter((value: string) => value !== selected)].slice(0, 1)
      : normalized.slice(0, 1);
  }
  const legacy = Array.isArray(bundle?.imageUrls) ? bundle.imageUrls : Array.isArray(bundle?.images) ? bundle.images : [];
  const normalizedLegacy = legacy.map((value: any) => String(value || "").trim()).filter(Boolean).slice(1, 2);
  if (selected && normalizedLegacy.includes(selected)) {
    return [selected, ...normalizedLegacy.filter((value: string) => value !== selected)].slice(0, 1);
  }
  return normalizedLegacy;
}

function buildMusicPromptSeedFromScenes(scenes: Scene[]) {
  const joined = scenes.slice(0, 4).map((scene) => scene.scenePrompt?.trim() || "").join(" ");
  const moodText = scenes.slice(0, 4).map((scene) => scene.mood?.trim() || "").join(" ");
  const combined = `${joined} ${moodText}`;
  const style = /(间谍|特工|潜行|追逐|杀手)/.test(combined) ? "spy thriller trailer" : /(拉丁|热带|舞蹈|海边)/.test(combined) ? "latin cinematic" : "cinematic trailer";
  const mood = /(紧张|惊险|悬疑|危机|追逐)/.test(combined) ? "tense suspense" : /(浪漫|温柔|治愈)/.test(combined) ? "warm emotional" : /(悲伤|孤独|诀别)/.test(combined) ? "restrained melancholy" : "dramatic uplift";
  const instrumentation = /(紧张|惊险|悬疑|危机|追逐)/.test(combined) ? "orchestra with electronic pulse" : "strings and piano";
  const lead = /(拉丁|热带)/.test(combined) ? "latin percussion lead" : "piano lead melody";
  return `${style}, ${mood}, ${instrumentation}, ${lead}, instrumental only`.slice(0, 100);
}

function toMediaUrl(url: string) {
  const normalized = String(url || "").trim();
  if (!normalized) return "";
  return normalized;
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.readAsDataURL(file);
  });
}

async function postJson(op: string, body: Record<string, any>) {
  const resp = await fetch(`/api/jobs?op=${encodeURIComponent(op)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  return { httpOk: resp.ok, status: resp.status, json: jparse(text) ?? { rawText: text } };
}

export default function WorkflowNodes() {
  const [selected, setSelected] = useState<string>("prompt");
  const [workflowId, setWorkflowId] = useState<string>("");
  const [workflowIdInput, setWorkflowIdInput] = useState<string>("");
  const [workflow, setWorkflow] = useState<any>(null);
  const [envStatus, setEnvStatus] = useState<Record<string, boolean> | null>(null);
  const [debugMode, setDebugMode] = useState(true);
  const [lastDebugEntry, setLastDebugEntry] = useState<DebugEntry | null>(null);
  const [globalStep, setGlobalStep] = useState<StepState>(INITIAL_STEP);
  const [auxBusyKey, setAuxBusyKey] = useState("");
  const [auxError, setAuxError] = useState("");
  const [uploadingAssetKey, setUploadingAssetKey] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("未来都市追逐，镜头节奏快速，电影感强");
  const [targetWords, setTargetWords] = useState("900");
  const [targetScenes, setTargetScenes] = useState("6");
  const [scriptText, setScriptText] = useState("");
  const [scriptDirty, setScriptDirty] = useState(false);
  const [storyboard, setStoryboard] = useState<Scene[]>([]);
  const [storyboardDirty, setStoryboardDirty] = useState(false);
  const [sceneVoiceTypeMap, setSceneVoiceTypeMap] = useState<Record<string, string>>({});
  const [sceneVoiceStyleMap, setSceneVoiceStyleMap] = useState<Record<string, string>>({});
  const [renderStillPromptMap, setRenderStillPromptMap] = useState<Record<string, string>>({});
  const [musicPrompt, setMusicPrompt] = useState("cinematic trailer soundtrack, hybrid orchestral + modern electronic pulse, no vocal");
  const [musicProvider, setMusicProvider] = useState("suno");
  const [musicMood, setMusicMood] = useState("cinematic");
  const [musicBpm, setMusicBpm] = useState("110");
  const [musicDuration, setMusicDuration] = useState("30");
  const [musicStartSec, setMusicStartSec] = useState("0");
  const [musicEndSec, setMusicEndSec] = useState("0");
  const [renderVoiceSceneMap, setRenderVoiceSceneMap] = useState<Record<string, boolean>>({});

  const nodes = useMemo(() => NODE_ITEMS, []);
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const current = nodeMap.get(selected) || nodes[0];
  const outputs = workflow?.outputs || {};
  const storyboardImages: SceneImages[] = Array.isArray(outputs.storyboardImages) ? outputs.storyboardImages : [];
  const storyboardImageWarnings: string[] = Array.isArray(outputs.storyboardImageWarnings) ? outputs.storyboardImageWarnings : [];
  const sceneBundlesByIndex = useMemo(
    () => Object.fromEntries(storyboardImages.map((item) => [Number(item?.sceneIndex || 0), item])) as Record<number, SceneImages>,
    [storyboardImages],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const existingId = s(params.get("workflowId")).trim() || s(window.localStorage.getItem("workflowNodes:workflowId")).trim();
    if (existingId) {
      setWorkflowId(existingId);
      setWorkflowIdInput(existingId);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (workflowId) {
      window.localStorage.setItem("workflowNodes:workflowId", workflowId);
      setWorkflowIdInput(workflowId);
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("workflowId", workflowId);
      window.history.replaceState({}, "", nextUrl.toString());
      return;
    }
    window.localStorage.removeItem("workflowNodes:workflowId");
  }, [workflowId]);

  useEffect(() => {
    if (!workflowId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const resp = await fetch(`/api/jobs?op=workflowStatus&workflowId=${encodeURIComponent(workflowId)}`);
      const json = await resp.json().catch(() => null);
      if (!cancelled && resp.ok && json?.workflow && json.workflow.status !== "not_found") {
        setWorkflow(json.workflow);
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [workflowId]);

  useEffect(() => {
    if (!debugMode) return;
    let cancelled = false;
    void (async () => {
      const resp = await fetch("/api/jobs?op=envStatus");
      const json = await resp.json().catch(() => null);
      if (!cancelled && resp.ok && json?.env) setEnvStatus(json.env);
    })();
    return () => { cancelled = true; };
  }, [debugMode]);

  useEffect(() => {
    if (!workflow) return;
    const nextOutputs = workflow.outputs || {};
    if (typeof nextOutputs.script === "string" && !scriptDirty) setScriptText(nextOutputs.script);
    if (Array.isArray(nextOutputs.storyboard) && !storyboardDirty) {
      const normalized = normalizeSceneList(nextOutputs.storyboard);
      setStoryboard(normalized);
      setSceneVoiceTypeMap((prev) => {
        const next = { ...prev };
        for (const scene of normalized) {
          const key = String(scene.sceneIndex);
          if (!next[key]) next[key] = scene.voiceType || "female";
        }
        return next;
      });
      setSceneVoiceStyleMap((prev) => {
        const next = { ...prev };
        for (const scene of normalized) {
          const key = String(scene.sceneIndex);
          if (!(key in next)) next[key] = scene.voiceStyle || "";
        }
        return next;
      });
      setRenderStillPromptMap((prev) => {
        const next = { ...prev };
        for (const scene of normalized) {
          const key = String(scene.sceneIndex);
          if (!next[key]) next[key] = scene.renderStillPrompt || scene.scenePrompt || "";
        }
        return next;
      });
      setRenderVoiceSceneMap((prev) => {
        const next = { ...prev };
        for (const scene of normalized) {
          const key = String(scene.sceneIndex);
          if (!(key in next)) next[key] = true;
        }
        return next;
      });
    }
  }, [workflow, scriptDirty, storyboardDirty]);

  useEffect(() => {
    const generated = buildMusicPromptSeedFromScenes(storyboard);
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
    const nextProvider = s(outputs.musicProvider).trim().toLowerCase();
    if (nextProvider === "suno" || nextProvider === "udio") setMusicProvider(nextProvider);
  }, [outputs.musicProvider]);

  function writeBackWorkflow(json: any) {
    const nextId = s(json?.workflow?.workflowId || json?.workflowId || workflowId).trim();
    if (nextId) setWorkflowId(nextId);
    if (json?.workflow) setWorkflow(json.workflow);
    setScriptDirty(false);
    setStoryboardDirty(false);
  }

  function buildRequestBody(body: Record<string, any>) {
    return {
      ...body,
      workflowId: body.workflowId || workflowId || undefined,
      workflow: body.workflow || workflow || undefined,
      script: body.script ?? scriptText,
      storyboard: body.storyboard ?? storyboard,
    };
  }

  async function refreshWorkflow(targetWorkflowId?: string) {
    const nextId = s(targetWorkflowId || workflowId || workflowIdInput).trim();
    if (!nextId) return;
    const resp = await fetch(`/api/jobs?op=workflowStatus&workflowId=${encodeURIComponent(nextId)}`);
    const json = await resp.json().catch(() => null);
    if (resp.ok && json?.workflow && json.workflow.status !== "not_found") {
      setWorkflow(json.workflow);
      setWorkflowId(nextId);
    } else if (resp.ok && json?.workflow?.status === "not_found") {
      setGlobalStep({ loading: false, error: "workflow_not_found", success: false });
    }
  }

  async function runOp(op: string, body: Record<string, any>, onSuccess?: (json: any) => void) {
    setGlobalStep({ loading: true, error: "", success: false });
    setAuxError("");
    try {
      const payload = buildRequestBody(body);
      const result = await postJson(op, payload);
      setLastDebugEntry({ op, request: payload, httpOk: result.httpOk, status: result.status, json: result.json });
      if (!result.httpOk || result.json?.ok === false) {
        const errorText = extractErrorText(result.json);
        setGlobalStep({ loading: false, error: errorText, success: false });
        return null;
      }
      writeBackWorkflow(result.json);
      setGlobalStep({ loading: false, error: "", success: true });
      onSuccess?.(result.json);
      return result.json;
    } catch (error: any) {
      setGlobalStep({ loading: false, error: error?.message || String(error) || "request_failed", success: false });
      return null;
    }
  }

  async function runAuxStep(key: string, op: string, body: Record<string, any>, onSuccess?: (json: any) => void) {
    setAuxBusyKey(key);
    setAuxError("");
    try {
      const payload = buildRequestBody(body);
      const result = await postJson(op, payload);
      setLastDebugEntry({ op, request: payload, httpOk: result.httpOk, status: result.status, json: result.json });
      if (!result.httpOk || result.json?.ok === false) {
        setAuxError(extractErrorText(result.json));
        return null;
      }
      writeBackWorkflow(result.json);
      onSuccess?.(result.json);
      return result.json;
    } catch (error: any) {
      setAuxError(error?.message || String(error) || "request_failed");
      return null;
    } finally {
      setAuxBusyKey("");
    }
  }

  async function uploadSceneReferenceImage(file: File, sceneIndex: number, assetType: "character" | "scene" | "renderstill") {
    setUploadingAssetKey(`${sceneIndex}:${assetType}`);
    setAuxError("");
    try {
      const dataUrl = await fileToDataUrl(file);
      const uploadResp = await fetch("/api/blob-put-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, filename: `workflow-node-${sceneIndex}-${assetType}.jpg` }),
      });
      const uploadJson = await uploadResp.json().catch(() => null);
      if (!uploadResp.ok || !uploadJson?.imageUrl) {
        throw new Error(extractErrorText(uploadJson));
      }
      const bound = await runAuxStep(`upload-${sceneIndex}-${assetType}`, "workflowUploadSceneImage", {
        workflowId,
        sceneIndex,
        imageUrl: s(uploadJson.imageUrl).trim(),
        assetType,
      });
      if (!bound) throw new Error("workflow_image_bind_failed");
    } catch (error: any) {
      setAuxError(error?.message || String(error) || "upload_failed");
    } finally {
      setUploadingAssetKey(null);
    }
  }

  function updateScene(sceneIndex: number, patch: Partial<Scene>) {
    setStoryboardDirty(true);
    setStoryboard((prev) => prev.map((scene) => scene.sceneIndex === sceneIndex ? { ...scene, ...patch } : scene));
  }

  function selectSceneImage(sceneIndex: number, imageUrl: string) {
    setWorkflow((prev: any) => {
      if (!prev?.outputs) return prev;
      const currentImages = Array.isArray(prev.outputs.storyboardImages) ? prev.outputs.storyboardImages : [];
      const storyboardImages = currentImages.map((item: any) => Number(item?.sceneIndex) === sceneIndex ? { ...item, selectedSceneImageUrl: imageUrl } : item);
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

  function renderNodeStatus(nodeId: string) {
    if (nodeId === "script") return outputs.script ? "已生成" : "待执行";
    if (nodeId === "storyboard") return Array.isArray(outputs.storyboard) && outputs.storyboard.length ? `${outputs.storyboard.length} scenes` : "待执行";
    if (nodeId === "assets") return storyboardImages.length ? `${storyboardImages.length} bundles` : "待执行";
    if (nodeId === "renderStill") return storyboardImages.some((item) => s(item?.renderStillImageUrl).trim()) ? "已生成" : "待执行";
    if (nodeId === "video") return storyboardImages.filter((item) => s(item?.sceneVideoUrl).trim()).length ? `${storyboardImages.filter((item) => s(item?.sceneVideoUrl).trim()).length} videos` : "待执行";
    if (nodeId === "voice") return storyboardImages.filter((item) => s(item?.sceneVoiceUrl).trim()).length ? `${storyboardImages.filter((item) => s(item?.sceneVoiceUrl).trim()).length} voices` : "待执行";
    if (nodeId === "music") return outputs.musicUrl ? "已生成" : "待执行";
    if (nodeId === "render") return outputs.finalVideoUrl ? "已完成" : "待执行";
    return workflowId ? "已载入" : "待开始";
  }

  function selectedScenesForRender() {
    return storyboard.filter((scene) => renderVoiceSceneMap[String(scene.sceneIndex)] !== false);
  }

  function selectedNodeRuntimeStatus() {
    return renderNodeStatus(selected);
  }

  function nextRecommendedNode() {
    if (!workflowId) return "prompt";
    if (!outputs.script) return "script";
    if (!Array.isArray(outputs.storyboard) || !outputs.storyboard.length || !outputs.storyboardConfirmed) return "storyboard";
    if (!storyboardImages.length) return "assets";
    if (!storyboardImages.some((item) => s(item?.sceneVideoUrl).trim())) return "video";
    if (!outputs.musicUrl) return "music";
    if (!outputs.finalVideoUrl) return "render";
    return "render";
  }

  function stepCountSummary() {
    return {
      scenes: Array.isArray(outputs.storyboard) ? outputs.storyboard.length : 0,
      bundles: storyboardImages.length,
      sceneVideos: storyboardImages.filter((item) => s(item?.sceneVideoUrl).trim()).length,
      sceneVoices: storyboardImages.filter((item) => s(item?.sceneVoiceUrl).trim()).length,
    };
  }

  function selectedNodeSnapshot() {
    switch (selected) {
      case "prompt":
        return {
          workflowId,
          prompt,
          targetWords: Number(targetWords || 0) || undefined,
          targetScenes: Number(targetScenes || 0) || undefined,
        };
      case "script":
        return {
          script: outputs.script || scriptText,
          currentStep: workflow?.currentStep,
        };
      case "storyboard":
        return {
          storyboardConfirmed: outputs.storyboardConfirmed,
          storyboardCount: storyboard.length,
          storyboard: storyboard.slice(0, 6),
        };
      case "assets":
        return {
          bundleCount: storyboardImages.length,
          warnings: storyboardImageWarnings,
          bundles: storyboardImages.slice(0, 4),
        };
      case "renderStill":
        return storyboard.map((scene) => {
          const bundle = sceneBundlesByIndex[Number(scene.sceneIndex || 0)];
          return {
            sceneIndex: scene.sceneIndex,
            renderStillNeeded: Boolean(scene.renderStillNeeded),
            renderStillPrompt: renderStillPromptMap[String(scene.sceneIndex)] ?? scene.renderStillPrompt ?? "",
            renderStillImageUrl: s(bundle?.renderStillImageUrl).trim(),
          };
        });
      case "video":
        return storyboard.map((scene) => {
          const bundle = sceneBundlesByIndex[Number(scene.sceneIndex || 0)];
          return {
            sceneIndex: scene.sceneIndex,
            selectedSceneImageUrl: s(bundle?.selectedSceneImageUrl).trim(),
            sceneVideoUrl: s(bundle?.sceneVideoUrl).trim(),
          };
        });
      case "voice":
        return storyboard.map((scene) => {
          const bundle = sceneBundlesByIndex[Number(scene.sceneIndex || 0)];
          return {
            sceneIndex: scene.sceneIndex,
            voiceover: scene.voiceover || scene.scenePrompt,
            sceneVoiceType: sceneVoiceTypeMap[String(scene.sceneIndex)] ?? scene.voiceType ?? "female",
            sceneVoiceStyle: sceneVoiceStyleMap[String(scene.sceneIndex)] ?? scene.voiceStyle ?? "",
            sceneVoiceUrl: s(bundle?.sceneVoiceUrl).trim(),
          };
        });
      case "music":
        return {
          musicProvider,
          musicPrompt,
          musicMood,
          musicBpm,
          musicDuration,
          outputMusicUrl: outputs.musicUrl,
        };
      case "render":
        return {
          includeSceneVoiceIndexes: selectedScenesForRender().map((scene) => scene.sceneIndex),
          musicStartSec: Number(musicStartSec || 0) || 0,
          musicEndSec: Number(musicEndSec || 0) || 0,
          finalVideoUrl: outputs.finalVideoUrl,
        };
      default:
        return {};
    }
  }

  function renderPromptPanel() {
    return (
      <div className="space-y-4">
        <div>
          <div className="mb-2 text-sm font-medium text-white/80">创作提示</div>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} className="w-full rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white outline-none" />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <input value={targetWords} onChange={(e) => setTargetWords(e.target.value)} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" placeholder="Script Length" />
          <input value={targetScenes} onChange={(e) => setTargetScenes(e.target.value)} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" placeholder="Scene Count" />
        </div>
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">固定规则：在节点工作流里每个 scene 的时长固定为 8 秒，不再单独输入。</div>
        <Button disabled={globalStep.loading} onClick={() => void runOp("workflowGenerateScript", {
          workflowId,
          prompt,
          targetWords: Number(targetWords || 0) || undefined,
          targetScenes: Number(targetScenes || 0) || undefined,
          sceneDuration: 8,
        }, (json) => {
          const nextWorkflowId = String(json?.workflow?.workflowId || json?.workflowId || "");
          if (nextWorkflowId) setWorkflowId(nextWorkflowId);
          if (typeof json?.script === "string") setScriptText(json.script);
          if (Array.isArray(json?.storyboard)) setStoryboard(normalizeSceneList(json.storyboard));
          setSelected("script");
        })} className="rounded-xl bg-primary px-5">
          {globalStep.loading ? "Generating..." : "Generate Script"}
        </Button>
      </div>
    );
  }

  function renderScriptPanel() {
    return (
      <div className="space-y-4">
        <textarea
          value={scriptText}
          onChange={(e) => { setScriptDirty(true); setScriptText(e.target.value); }}
          rows={14}
          className="w-full rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white outline-none"
        />
        <div className="flex flex-wrap gap-3">
          <Button disabled={globalStep.loading || !scriptText.trim()} onClick={() => void runOp("workflowGenerateStoryboard", {
            workflowId,
            script: scriptText,
          }, (json) => {
            if (Array.isArray(json?.workflow?.outputs?.storyboard)) {
              setStoryboard(normalizeSceneList(json.workflow.outputs.storyboard));
              setStoryboardDirty(false);
            }
            setSelected("storyboard");
          })} className="rounded-xl bg-primary px-5">
            {globalStep.loading ? "Updating..." : "Load Storyboard Stage"}
          </Button>
          <div className="text-sm text-white/60">這一步沿用現有後端 contract，將 workflow 切到 storyboard stage。分鏡內容的編修與保存在下一個節點完成。</div>
        </div>
      </div>
    );
  }

  function renderStoryboardPanel() {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={globalStep.loading || !storyboard.length}
            onClick={() => void runOp("workflowConfirmStoryboard", {
              workflowId,
              storyboard,
            }, () => setSelected("assets"))}
            className="rounded-xl bg-primary px-5"
          >
            {globalStep.loading ? "Saving..." : "Confirm Storyboard"}
          </Button>
          <div className="text-sm text-white/60">把目前 inspector 裡修改過的 scenes 寫回 workflow，後續節點直接使用這份 storyboard。</div>
        </div>
        {storyboard.length ? storyboard.map((scene) => (
          <div key={scene.sceneIndex} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 text-sm font-semibold text-white">Scene {scene.sceneIndex}</div>
            <textarea value={scene.scenePrompt} onChange={(e) => updateScene(scene.sceneIndex, { scenePrompt: e.target.value })} rows={4} className="mb-3 w-full rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <input value={scene.primarySubject || ""} onChange={(e) => updateScene(scene.sceneIndex, { primarySubject: e.target.value })} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" placeholder="Primary Subject" />
              <input value={scene.character || ""} onChange={(e) => updateScene(scene.sceneIndex, { character: e.target.value })} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" placeholder="Character" />
              <input value={scene.action || ""} onChange={(e) => updateScene(scene.sceneIndex, { action: e.target.value })} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" placeholder="Action" />
              <input value={scene.camera || ""} onChange={(e) => updateScene(scene.sceneIndex, { camera: e.target.value })} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" placeholder="Camera" />
              <input value={scene.mood || ""} onChange={(e) => updateScene(scene.sceneIndex, { mood: e.target.value })} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" placeholder="Mood" />
              <input value={scene.lighting || ""} onChange={(e) => updateScene(scene.sceneIndex, { lighting: e.target.value })} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" placeholder="Lighting" />
            </div>
            <label className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/75">
              <input
                type="checkbox"
                checked={Boolean(scene.renderStillNeeded)}
                onChange={(e) => updateScene(scene.sceneIndex, { renderStillNeeded: e.target.checked })}
              />
              Mark as render still scene
            </label>
          </div>
        )) : <div className="rounded-xl border border-dashed border-white/15 p-4 text-sm text-white/55">先生成 script 才会出现 storyboard 节点内容。</div>}
      </div>
    );
  }

  function renderAssetsPanel() {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
          這個節點是 scene 級素材工作台。每個分鏡保留 1 張角色圖與 1 張場景圖，並在這裡決定目前用哪張素材進入後續 Scene Video。
        </div>
        <div className="flex flex-wrap gap-3">
          <Button disabled={globalStep.loading || !storyboard.length} onClick={() => void runOp("workflowGenerateStoryboardImages", {
            workflowId,
            workflow,
            storyboard,
          }, () => setSelected("renderStill"))} className="rounded-xl bg-primary px-5">
            {globalStep.loading ? "Generating..." : "Generate All Scene Assets"}
          </Button>
          <div className="text-sm text-white/60">每个 scene 会生成 1 张人物图 + 1 张场景图，视频节点直接吃这里当前这一组。</div>
        </div>
        {storyboardImages.length ? storyboardImages.map((bundle) => {
          const characterUrls = getCharacterImageUrls(bundle);
          const sceneUrls = getSceneImageUrls(bundle);
          const selectedSceneUrl = s(bundle.selectedSceneImageUrl).trim() || sceneUrls[0] || "";
          return (
            <div key={bundle.sceneIndex} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white">Scene {bundle.sceneIndex}</div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={auxBusyKey === `scene-assets-${bundle.sceneIndex}`}
                    onClick={() => void runAuxStep(`scene-assets-${bundle.sceneIndex}`, "workflowGenerateSceneImage", {
                      workflowId,
                      workflow,
                      storyboard,
                      sceneIndex: bundle.sceneIndex,
                    })}
                    className="rounded-xl bg-primary px-4"
                  >
                    {auxBusyKey === `scene-assets-${bundle.sceneIndex}` ? "Generating..." : "Generate Scene Assets"}
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                    onClick={() => setSelected("video")}
                  >
                    Continue to Video
                  </Button>
                </div>
              </div>
              <div className="grid gap-4 xl:grid-cols-[220px_1fr]">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/55">Character</div>
                  {characterUrls.length ? (
                    <img
                      src={toMediaUrl(characterUrls[0])}
                      alt={`scene-${bundle.sceneIndex}-character`}
                      className="h-64 w-full rounded-xl border border-white/10 object-cover"
                    />
                  ) : (
                    <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-white/15 text-sm text-white/40">No character image</div>
                  )}
                  <label className="mt-3 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10">
                    <CloudUpload className="h-4 w-4" />
                    {uploadingAssetKey === `${bundle.sceneIndex}:character` ? "Uploading..." : "Upload Character"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadSceneReferenceImage(file, Number(bundle.sceneIndex || 0), "character");
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/55">Scene Images</div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {sceneUrls.length ? sceneUrls.map((url) => {
                      const active = url === selectedSceneUrl;
                      return (
                        <button
                          key={url}
                          type="button"
                          onClick={() => selectSceneImage(bundle.sceneIndex, url)}
                          className={`overflow-hidden rounded-2xl border text-left transition-all ${active ? "border-primary shadow-[0_0_0_1px_rgba(236,72,153,0.28)]" : "border-white/10 hover:border-white/20"}`}
                        >
                          <img src={toMediaUrl(url)} alt={`scene-${bundle.sceneIndex}`} className="h-48 w-full object-cover" />
                          <div className="flex items-center justify-between gap-3 p-3 text-sm">
                            <span className={active ? "text-primary" : "text-white/80"}>{active ? "Selected Scene" : "Use This Scene"}</span>
                            <span className="text-xs text-white/45">for video</span>
                          </div>
                        </button>
                      );
                    }) : (
                      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-white/15 text-sm text-white/40">No scene images yet</div>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10">
                      <CloudUpload className="h-4 w-4" />
                      {uploadingAssetKey === `${bundle.sceneIndex}:scene` ? "Uploading..." : "Upload Scene"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void uploadSceneReferenceImage(file, Number(bundle.sceneIndex || 0), "scene");
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <div className="text-xs text-white/50 break-all">selectedSceneImageUrl: {selectedSceneUrl || "--"}</div>
                  </div>
                </div>
              </div>
            </div>
          );
        }) : null}
      </div>
    );
  }

  function renderRenderStillPanel() {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-100">
          多人場景建議走 Render Still，再在 Final Render 中插入，避免直接用 scene video 造成角色不穩定。
        </div>
        {storyboard.map((scene) => (
          <div key={scene.sceneIndex} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-white">Scene {scene.sceneIndex}</div>
              <div className={`rounded-full border px-2 py-1 text-xs ${scene.renderStillNeeded ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'}`}>{scene.renderStillNeeded ? 'Render Still Needed' : 'Scene Video OK'}</div>
            </div>
            <textarea value={renderStillPromptMap[String(scene.sceneIndex)] ?? scene.renderStillPrompt ?? ""} onChange={(e) => setRenderStillPromptMap((prev) => ({ ...prev, [String(scene.sceneIndex)]: e.target.value }))} rows={3} className="w-full rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" />
            <div className="mt-3 flex flex-wrap gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10">
                <CloudUpload className="h-4 w-4" />
                {uploadingAssetKey === `${scene.sceneIndex}:renderstill` ? "Uploading..." : "Upload Render Still"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadSceneReferenceImage(file, Number(scene.sceneIndex || 0), "renderstill");
                    e.currentTarget.value = "";
                  }}
                />
              </label>
              <Button disabled={auxBusyKey === `render-still-${scene.sceneIndex}`} onClick={() => void runAuxStep(`render-still-${scene.sceneIndex}`, "workflowGenerateRenderStill", {
                workflowId,
                workflow,
                storyboard,
                sceneIndex: scene.sceneIndex,
                renderStillPrompt: renderStillPromptMap[String(scene.sceneIndex)] ?? scene.renderStillPrompt ?? scene.scenePrompt,
              })} className="rounded-xl bg-primary px-5">{auxBusyKey === `render-still-${scene.sceneIndex}` ? "Generating..." : "Generate Render Still"}</Button>
              <div className="text-xs text-white/60 break-all">{s(storyboardImages.find((item) => Number(item.sceneIndex) === scene.sceneIndex)?.renderStillImageUrl) || "no render still yet"}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderVoicePanel() {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
          旁白以 scene 為單位生成。勾選 <span className="font-semibold text-white">Include in render</span> 的 scene 才會在最終 Render 中混入。
        </div>
        {storyboard.map((scene) => {
          const key = String(scene.sceneIndex);
          const bundle = storyboardImages.find((item) => Number(item.sceneIndex) === scene.sceneIndex);
          return (
            <div key={scene.sceneIndex} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 text-sm font-semibold text-white">Scene {scene.sceneIndex}</div>
              <textarea value={scene.voiceover || ""} onChange={(e) => updateScene(scene.sceneIndex, { voiceover: e.target.value })} rows={3} className="mb-3 w-full rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" />
              <div className="grid gap-3 md:grid-cols-2">
                <select value={sceneVoiceTypeMap[key] ?? scene.voiceType ?? "female"} onChange={(e) => setSceneVoiceTypeMap((prev) => ({ ...prev, [key]: e.target.value }))} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white">
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="cartoon">Cartoon</option>
                </select>
                <select value={sceneVoiceStyleMap[key] ?? scene.voiceStyle ?? ""} onChange={(e) => setSceneVoiceStyleMap((prev) => ({ ...prev, [key]: e.target.value }))} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white">
                  <option value="">Normal</option>
                  <option value="warm">Warm</option>
                  <option value="calm">Calm</option>
                  <option value="energetic">Energetic</option>
                  <option value="cinematic">Cinematic</option>
                </select>
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button disabled={auxBusyKey === `scene-voice-${scene.sceneIndex}`} onClick={() => void runAuxStep(`scene-voice-${scene.sceneIndex}`, "workflowGenerateSceneVoice", {
                  workflowId,
                  sceneIndex: scene.sceneIndex,
                  dialogueText: scene.voiceover || scene.scenePrompt,
                  voicePrompt: DEFAULT_SCENE_VOICE_PROMPT,
                  voiceType: sceneVoiceTypeMap[key] ?? scene.voiceType ?? "female",
                  voiceStyle: sceneVoiceStyleMap[key] ?? scene.voiceStyle ?? "",
                  voice: mapSceneVoiceTypeToVoice(sceneVoiceTypeMap[key] ?? scene.voiceType ?? "female"),
                })} className="rounded-xl bg-primary px-5">{auxBusyKey === `scene-voice-${scene.sceneIndex}` ? "Generating..." : "Generate Scene Voice"}</Button>
                <label className="inline-flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={Boolean(renderVoiceSceneMap[key])} onChange={(e) => setRenderVoiceSceneMap((prev) => ({ ...prev, [key]: e.target.checked }))} /> Include in render</label>
              </div>
              {bundle?.sceneVoiceUrl ? <audio key={bundle.sceneVoiceUrl} className="mt-3 w-full" controls src={toMediaUrl(bundle.sceneVoiceUrl)} /> : null}
            </div>
          );
        })}
      </div>
    );
  }

  function renderMusicPanel() {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
          音樂節點只負責生成與保存穩定 URL；真正的截取區間與混音在 Final Render。
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <select value={musicProvider} onChange={(e) => setMusicProvider(e.target.value)} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white">
            <option value="suno">Suno</option>
            <option value="udio">Udio</option>
          </select>
          <input value={musicMood} onChange={(e) => setMusicMood(e.target.value)} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" placeholder="Mood" />
        </div>
        <textarea value={musicPrompt} onChange={(e) => setMusicPrompt(e.target.value)} rows={4} className="w-full rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" />
        <div className="grid gap-3 md:grid-cols-3">
          <input value={musicBpm} onChange={(e) => setMusicBpm(e.target.value)} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" placeholder="BPM" />
          <input value={musicDuration} onChange={(e) => setMusicDuration(e.target.value)} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" placeholder="Duration" />
          <Button variant="outline" className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={() => setMusicPrompt(buildMusicPromptSeedFromScenes(storyboard))}>Auto Fill From Scenes</Button>
        </div>
        <Button disabled={globalStep.loading} onClick={() => void runOp("workflowGenerateMusic", {
          workflowId,
          musicPrompt,
          musicProvider,
          musicMood,
          musicBpm: Number(musicBpm || 0) || undefined,
          musicDuration: Number(musicDuration || 0) || undefined,
        })} className="rounded-xl bg-primary px-5">{globalStep.loading ? "Generating..." : "Generate Music"}</Button>
        {outputs.musicUrl ? <audio key={outputs.musicUrl} className="w-full" controls src={toMediaUrl(outputs.musicUrl)} /> : null}
      </div>
    );
  }

  function renderVideoPanel() {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
          Scene Video 會讀取這個 workflow 裡目前已選定的角色圖與場景圖。如果 scene 被標記為多人場景，建議回 Render Still 節點處理。
        </div>
        {storyboard.map((scene) => {
          const bundle = storyboardImages.find((item) => Number(item.sceneIndex) === scene.sceneIndex);
          return (
            <div key={scene.sceneIndex} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white">Scene {scene.sceneIndex}</div>
                <div className="text-xs text-white/55">固定 8 秒</div>
              </div>
              <div className="text-xs text-white/60">Primary Subject: {scene.primarySubject || "--"}</div>
              <div className="text-xs text-white/60">Render Still Needed: {String(Boolean(scene.renderStillNeeded))}</div>
              <div className="mt-3 flex flex-wrap gap-3">
                <Button disabled={auxBusyKey === `scene-video-${scene.sceneIndex}`} onClick={() => void runAuxStep(`scene-video-${scene.sceneIndex}`, "workflowGenerateSceneVideo", {
                  workflowId,
                  sceneIndex: scene.sceneIndex,
                  duration: "8s",
                  scenePrompt: scene.scenePrompt,
                  primarySubject: scene.primarySubject,
                  character: scene.character,
                  action: scene.action,
                  camera: scene.camera,
                  mood: scene.mood,
                  lighting: scene.lighting,
                  voiceType: sceneVoiceTypeMap[String(scene.sceneIndex)] ?? scene.voiceType ?? "female",
                  voiceStyle: sceneVoiceStyleMap[String(scene.sceneIndex)] ?? scene.voiceStyle ?? "",
                })} className="rounded-xl bg-primary px-5">{auxBusyKey === `scene-video-${scene.sceneIndex}` ? "Generating..." : "Generate Scene Video"}</Button>
              </div>
              {bundle?.sceneVideoUrl ? <video key={bundle.sceneVideoUrl} className="mt-3 w-full rounded-xl border border-white/10" controls src={toMediaUrl(bundle.sceneVideoUrl)} /> : null}
            </div>
          );
        })}
      </div>
    );
  }

  function renderFinalPanel() {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <input value={musicStartSec} onChange={(e) => setMusicStartSec(e.target.value)} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" placeholder="Music Start Sec" />
          <input value={musicEndSec} onChange={(e) => setMusicEndSec(e.target.value)} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" placeholder="Music End Sec" />
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
          Render 会自动拼接已生成的 scene video、勾选的 scene voice，以及指定区间内的音乐片段，并统一输出 finalVideoUrl。
        </div>
        <Button disabled={globalStep.loading} onClick={() => void runOp("workflowRenderVideo", {
          workflowId,
          musicStartSec: Number(musicStartSec || 0) || 0,
          musicEndSec: Number(musicEndSec || 0) || 0,
          includeSceneVoiceIndexes: selectedScenesForRender().map((scene) => scene.sceneIndex),
        })} className="rounded-xl bg-primary px-5">{globalStep.loading ? "Rendering..." : "Final Render"}</Button>
        {outputs.finalVideoUrl ? <video key={outputs.finalVideoUrl} className="w-full rounded-xl border border-white/10" controls src={toMediaUrl(outputs.finalVideoUrl)} /> : null}
      </div>
    );
  }

  function renderSummaryCards() {
    const summary = stepCountSummary();
    const cards = [
      { label: "Storyboard", value: String(summary.scenes), hint: "Scenes" },
      { label: "Asset Bundles", value: String(summary.bundles), hint: "Character + scene" },
      { label: "Scene Videos", value: String(summary.sceneVideos), hint: "Ready clips" },
      { label: "Scene Voices", value: String(summary.sceneVoices), hint: "Narration" },
    ];
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-white/45">{card.label}</div>
            <div className="mt-3 text-3xl font-black text-white">{card.value}</div>
            <div className="mt-1 text-sm text-white/55">{card.hint}</div>
          </div>
        ))}
      </div>
    );
  }

  function getSceneVoiceTypeValue(scene: Scene) {
    return sceneVoiceTypeMap[String(scene.sceneIndex)] ?? scene.voiceType ?? "female";
  }

  function getSceneVoiceStyleValue(scene: Scene) {
    return sceneVoiceStyleMap[String(scene.sceneIndex)] ?? scene.voiceStyle ?? "";
  }

  function getRenderStillPromptValue(scene: Scene) {
    return renderStillPromptMap[String(scene.sceneIndex)] ?? scene.renderStillPrompt ?? scene.scenePrompt ?? "";
  }

  function renderWorkflowRibbon() {
    return (
      <div className="grid gap-3 lg:grid-cols-3 xl:grid-cols-5">
        {nodes.map((node) => {
          const Icon = node.icon;
          const active = selected === node.id;
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => setSelected(node.id)}
              className={`rounded-[24px] border p-4 text-left transition-all ${active ? "border-primary/50 bg-primary/10 shadow-[0_20px_60px_rgba(236,72,153,0.16)]" : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 text-white">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-base font-bold text-white">{node.title}</div>
                    <div className="text-xs text-white/45">{node.en}</div>
                  </div>
                </div>
                <span className={`rounded-full border px-2 py-1 text-[11px] ${badgeClass(node.status)}`}>{node.status}</span>
              </div>
              <div className="mt-4 text-sm leading-6 text-white/68">{node.desc}</div>
              <div className="mt-4 text-xs text-white/45">{renderNodeStatus(node.id)}</div>
            </button>
          );
        })}
      </div>
    );
  }

  function renderSceneCanvas() {
    if (!storyboard.length) {
      return (
        <div className="rounded-[28px] border border-dashed border-white/15 bg-white/[0.03] p-8 text-sm text-white/55">
          先生成 script 與 storyboard，左側畫布才會展開真正的 scene 創作工作區。
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
          <div>
            <div className="text-lg font-bold text-white">Scene Canvas</div>
            <div className="mt-1 text-sm text-white/60">左側畫布現在是創作主工作區。分鏡文案、角色圖、場景圖、旁白、場景視頻與生成操作都在這裡完成。</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="rounded-xl bg-primary px-4"
              disabled={globalStep.loading || !storyboard.length}
              onClick={() => void runOp("workflowConfirmStoryboard", { workflowId, storyboard })}
            >
              保存分镜
            </Button>
            <Button
              variant="outline"
              className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
              disabled={globalStep.loading || !storyboard.length}
              onClick={() => void runOp("workflowGenerateStoryboardImages", { workflowId, workflow, storyboard })}
            >
              生成全部分镜资产
            </Button>
          </div>
        </div>

        {storyboard.map((scene) => {
          const bundle = sceneBundlesByIndex[Number(scene.sceneIndex || 0)] || { sceneIndex: scene.sceneIndex, images: [] };
          const characterUrl = getCharacterImageUrls(bundle)[0] || "";
          const sceneUrl = getSceneImageUrls(bundle)[0] || "";
          const renderStillUrl = s(bundle?.renderStillImageUrl).trim();
          const sceneVoiceUrl = s(bundle?.sceneVoiceUrl).trim();
          const sceneVideoUrl = s(bundle?.sceneVideoUrl).trim();
          const selectedSceneImageUrl = s(bundle?.selectedSceneImageUrl).trim() || sceneUrl;
          const busyAssets = auxBusyKey === `scene-assets-${scene.sceneIndex}`;
          const busyVoice = auxBusyKey === `scene-voice-${scene.sceneIndex}`;
          const busyVideo = auxBusyKey === `scene-video-${scene.sceneIndex}`;
          const busyStill = auxBusyKey === `render-still-${scene.sceneIndex}`;
          const sceneVoiceType = getSceneVoiceTypeValue(scene);
          const sceneVoiceStyle = getSceneVoiceStyleValue(scene);
          const renderStillPrompt = getRenderStillPromptValue(scene);
          return (
            <div key={scene.sceneIndex} className="overflow-hidden rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))]">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
                <div>
                  <div className="text-xl font-black text-white">Scene {scene.sceneIndex}</div>
                  <div className="mt-1 text-sm text-white/55">Primary subject: {scene.primarySubject || scene.character || "-"}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/60">8s fixed</span>
                  <span className={`rounded-full border px-3 py-1 text-xs ${scene.renderStillNeeded ? "border-amber-400/30 bg-amber-400/10 text-amber-200" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"}`}>
                    {scene.renderStillNeeded ? "Render Still" : "Scene Video"}
                  </span>
                </div>
              </div>

              <div className="grid gap-6 p-5 xl:grid-cols-[360px_minmax(0,1fr)]">
                <div className="space-y-4">
                  <div className="rounded-2xl border border-white/10 bg-[#0b1020] p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.18em] text-white/45">Scene Prompt</div>
                    <textarea
                      value={scene.scenePrompt || ""}
                      onChange={(e) => updateScene(scene.sceneIndex, { scenePrompt: e.target.value })}
                      rows={6}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm leading-6 text-white outline-none"
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                    <input value={scene.primarySubject || ""} onChange={(e) => updateScene(scene.sceneIndex, { primarySubject: e.target.value })} className="rounded-xl border border-white/10 bg-[#0b1020] p-3 text-sm text-white" placeholder="Primary Subject" />
                    <input value={scene.character || ""} onChange={(e) => updateScene(scene.sceneIndex, { character: e.target.value })} className="rounded-xl border border-white/10 bg-[#0b1020] p-3 text-sm text-white" placeholder="Character" />
                    <input value={scene.action || ""} onChange={(e) => updateScene(scene.sceneIndex, { action: e.target.value })} className="rounded-xl border border-white/10 bg-[#0b1020] p-3 text-sm text-white" placeholder="Action" />
                    <input value={scene.camera || ""} onChange={(e) => updateScene(scene.sceneIndex, { camera: e.target.value })} className="rounded-xl border border-white/10 bg-[#0b1020] p-3 text-sm text-white" placeholder="Camera" />
                    <input value={scene.mood || ""} onChange={(e) => updateScene(scene.sceneIndex, { mood: e.target.value })} className="rounded-xl border border-white/10 bg-[#0b1020] p-3 text-sm text-white" placeholder="Mood" />
                    <input value={scene.lighting || ""} onChange={(e) => updateScene(scene.sceneIndex, { lighting: e.target.value })} className="rounded-xl border border-white/10 bg-[#0b1020] p-3 text-sm text-white" placeholder="Lighting" />
                  </div>

                  <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/75">
                    <input
                      type="checkbox"
                      checked={Boolean(scene.renderStillNeeded)}
                      onChange={(e) => updateScene(scene.sceneIndex, { renderStillNeeded: e.target.checked })}
                    />
                    Mark as render still scene
                  </label>

                  <div className="rounded-2xl border border-white/10 bg-[#0b1020] p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.18em] text-white/45">Voice Text</div>
                    <textarea
                      value={scene.voiceover || ""}
                      onChange={(e) => updateScene(scene.sceneIndex, { voiceover: e.target.value })}
                      rows={4}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm leading-6 text-white outline-none"
                    />
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <select value={sceneVoiceType} onChange={(e) => setSceneVoiceTypeMap((prev) => ({ ...prev, [String(scene.sceneIndex)]: e.target.value }))} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white">
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                        <option value="cartoon">Cartoon</option>
                      </select>
                      <select value={sceneVoiceStyle} onChange={(e) => setSceneVoiceStyleMap((prev) => ({ ...prev, [String(scene.sceneIndex)]: e.target.value }))} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white">
                        <option value="">Normal</option>
                        <option value="warm">Warm</option>
                        <option value="calm">Calm</option>
                        <option value="energetic">Energetic</option>
                        <option value="cinematic">Cinematic</option>
                      </select>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-[#0b1020] p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.18em] text-white/45">Render Still Prompt</div>
                    <textarea
                      value={renderStillPrompt}
                      onChange={(e) => setRenderStillPromptMap((prev) => ({ ...prev, [String(scene.sceneIndex)]: e.target.value }))}
                      rows={4}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm leading-6 text-white outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-[26px] border border-white/10 bg-[#0b1020] p-4">
                      <div className="mb-3 text-xs uppercase tracking-[0.18em] text-white/45">Character</div>
                      {characterUrl ? (
                        <img src={toMediaUrl(characterUrl)} alt={`scene-${scene.sceneIndex}-character`} className="h-[420px] w-full rounded-2xl border border-white/10 object-cover" />
                      ) : (
                        <div className="flex h-[420px] items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-white/35">No character image</div>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/80 hover:bg-white/10">
                          <CloudUpload className="h-4 w-4" />
                          {uploadingAssetKey === `${scene.sceneIndex}:character` ? "Uploading..." : "Upload Character"}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void uploadSceneReferenceImage(file, Number(scene.sceneIndex || 0), "character");
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                        <Button className="rounded-xl bg-primary px-4" disabled={busyAssets} onClick={() => void runAuxStep(`scene-assets-${scene.sceneIndex}`, "workflowGenerateSceneImage", { workflowId, workflow, storyboard, sceneIndex: scene.sceneIndex })}>
                          {busyAssets ? "Generating..." : "Generate Scene Assets"}
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-[26px] border border-white/10 bg-[#0b1020] p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-white/45">Scene Image</div>
                        <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] text-primary">{selectedSceneImageUrl ? "Selected" : "Pending"}</span>
                      </div>
                      {sceneUrl ? (
                        <button type="button" onClick={() => selectSceneImage(scene.sceneIndex, sceneUrl)} className="block w-full">
                          <img src={toMediaUrl(sceneUrl)} alt={`scene-${scene.sceneIndex}-environment`} className={`h-[420px] w-full rounded-2xl border object-cover transition-all ${selectedSceneImageUrl === sceneUrl ? "border-primary shadow-[0_0_0_1px_rgba(236,72,153,0.28)]" : "border-white/10"}`} />
                        </button>
                      ) : (
                        <div className="flex h-[420px] items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-white/35">No scene image</div>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/80 hover:bg-white/10">
                          <CloudUpload className="h-4 w-4" />
                          {uploadingAssetKey === `${scene.sceneIndex}:scene` ? "Uploading..." : "Upload Scene"}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void uploadSceneReferenceImage(file, Number(scene.sceneIndex || 0), "scene");
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                        <Button variant="outline" className="rounded-xl border-white/10 bg-white/[0.03] text-white hover:bg-white/10" disabled={!sceneUrl} onClick={() => selectSceneImage(scene.sceneIndex, sceneUrl)}>
                          Use This Scene
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-3">
                    <div className="rounded-[24px] border border-white/10 bg-[#0b1020] p-4 lg:col-span-1">
                      <div className="mb-3 text-xs uppercase tracking-[0.18em] text-white/45">Scene Voice</div>
                      {sceneVoiceUrl ? (
                        <audio key={sceneVoiceUrl} controls className="w-full" src={toMediaUrl(sceneVoiceUrl)} />
                      ) : (
                        <div className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-sm text-white/35">No voice generated yet</div>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button className="rounded-xl bg-primary px-4" disabled={busyVoice} onClick={() => void runAuxStep(`scene-voice-${scene.sceneIndex}`, "workflowGenerateSceneVoice", {
                          workflowId,
                          sceneIndex: scene.sceneIndex,
                          dialogueText: scene.voiceover || scene.scenePrompt,
                          voicePrompt: DEFAULT_SCENE_VOICE_PROMPT,
                          voiceType: sceneVoiceType,
                          voiceStyle: sceneVoiceStyle,
                          voice: mapSceneVoiceTypeToVoice(sceneVoiceType),
                        })}>
                          {busyVoice ? "Generating..." : "Generate Voice"}
                        </Button>
                        <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/70">
                          <input type="checkbox" checked={Boolean(renderVoiceSceneMap[String(scene.sceneIndex)])} onChange={(e) => setRenderVoiceSceneMap((prev) => ({ ...prev, [String(scene.sceneIndex)]: e.target.checked }))} />
                          Include in render
                        </label>
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-[#0b1020] p-4 lg:col-span-1">
                      <div className="mb-3 text-xs uppercase tracking-[0.18em] text-white/45">Scene Video</div>
                      {sceneVideoUrl ? (
                        <video key={sceneVideoUrl} controls className="h-[210px] w-full rounded-2xl border border-white/10 object-cover" src={toMediaUrl(sceneVideoUrl)} />
                      ) : (
                        <div className="flex h-[210px] items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-white/35">No scene video yet</div>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button className="rounded-xl bg-primary px-4" disabled={busyVideo || !characterUrl || !sceneUrl} onClick={() => void runAuxStep(`scene-video-${scene.sceneIndex}`, "workflowGenerateSceneVideo", {
                          workflowId,
                          sceneIndex: scene.sceneIndex,
                          duration: "8s",
                          scenePrompt: scene.scenePrompt,
                          primarySubject: scene.primarySubject,
                          character: scene.character,
                          action: scene.action,
                          camera: scene.camera,
                          mood: scene.mood,
                          lighting: scene.lighting,
                          voiceType: sceneVoiceType,
                          voiceStyle: sceneVoiceStyle,
                        })}>
                          {busyVideo ? "Generating..." : "Generate Video"}
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-[#0b1020] p-4 lg:col-span-1">
                      <div className="mb-3 text-xs uppercase tracking-[0.18em] text-white/45">Render Still</div>
                      {renderStillUrl ? (
                        <img src={toMediaUrl(renderStillUrl)} alt={`scene-${scene.sceneIndex}-renderstill`} className="h-[210px] w-full rounded-2xl border border-white/10 object-cover" />
                      ) : (
                        <div className="flex h-[210px] items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-white/35">No render still yet</div>
                      )}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/80 hover:bg-white/10">
                          <CloudUpload className="h-4 w-4" />
                          {uploadingAssetKey === `${scene.sceneIndex}:renderstill` ? "Uploading..." : "Upload Still"}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void uploadSceneReferenceImage(file, Number(scene.sceneIndex || 0), "renderstill");
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                        <Button variant="outline" className="rounded-xl border-white/10 bg-white/[0.03] text-white hover:bg-white/10" disabled={busyStill || !renderStillPrompt.trim()} onClick={() => void runAuxStep(`render-still-${scene.sceneIndex}`, "workflowGenerateRenderStill", {
                          workflowId,
                          workflow,
                          storyboard,
                          sceneIndex: scene.sceneIndex,
                          renderStillPrompt,
                        })}>
                          {busyStill ? "Generating..." : "Generate Still"}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderCanvasSurface() {
    if (selected === "prompt" || selected === "script") {
      return (
        <div className="space-y-5">
          {renderWorkflowRibbon()}
          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
            {selected === "prompt" ? renderPromptPanel() : renderScriptPanel()}
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-5">
        {renderWorkflowRibbon()}
        {renderSceneCanvas()}
      </div>
    );
  }

  function renderCompactInspector() {
    if (selected === "prompt" || selected === "script" || selected === "music" || selected === "render") {
      return renderSelectedPanel();
    }

    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-[#0b1020] p-4 text-sm text-white/70">
          這個節點的主要創作操作已經搬到左側畫布。右側只保留節點說明、狀態與輸出快照，方便你對照驗收。
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#0b1020] p-4 text-sm text-white/72">
          <div className="text-xs uppercase tracking-[0.18em] text-white/45">Node Focus</div>
          <div className="mt-3 space-y-2">
            <div>selected: <code>{selected}</code></div>
            <div>runtime: <code>{selectedNodeRuntimeStatus()}</code></div>
            <div>workflowId: <code>{workflowId || "--"}</code></div>
          </div>
        </div>
      </div>
    );
  }

  function renderSelectedPanel() {
    switch (selected) {
      case "prompt": return renderPromptPanel();
      case "script": return renderScriptPanel();
      case "storyboard": return renderStoryboardPanel();
      case "assets": return renderAssetsPanel();
      case "renderStill": return renderRenderStillPanel();
      case "voice": return renderVoicePanel();
      case "music": return renderMusicPanel();
      case "video": return renderVideoPanel();
      case "render": return renderFinalPanel();
      default:
        return <div className="rounded-xl border border-dashed border-white/15 p-4 text-sm text-white/55">这个节点下一批继续接入。</div>;
    }
  }

  return (
    <div className="min-h-screen bg-[#050816] text-white">
      <Navbar />
      <main className="px-4 pb-8 pt-24 md:px-6">
        <div className="mx-auto max-w-[1880px]">
          <div className="mb-4 overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(236,72,153,0.22),transparent_32%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.18),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-6 md:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm text-primary">画布式工作流 <span className="ml-2 text-xs text-white/45">Canvas Workflow</span></div>
                <h1 className="mt-4 text-3xl font-black tracking-tight md:text-5xl">/workflow-nodes 第一、二阶段验收版</h1>
                <p className="mt-3 max-w-4xl text-sm leading-7 text-white/72 md:text-base">保留旧版 <span className="text-white">/workflow</span> 作为 fallback，这里负责真实执行、调试、节点检查与 scene 级编辑。现在的目标是让 Prompt 到 Final Render 全链可验收。</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button className="rounded-xl bg-primary px-5 text-primary-foreground hover:bg-primary/90" onClick={() => setSelected(nextRecommendedNode())}>
                  <Wand2 className="mr-2 h-4 w-4" />
                  打开建议节点
                </Button>
                <a href="/workflow">
                  <Button variant="outline" className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10">查看旧版页面</Button>
                </a>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-white/60">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                <ArrowRight className="h-4 w-4" />
                Recommended: <span className="font-semibold text-white">{nextRecommendedNode()}</span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                <LoaderCircle className={`h-4 w-4 ${globalStep.loading || !!auxBusyKey ? "animate-spin text-primary" : "text-white/45"}`} />
                Runtime: <span className="font-semibold text-white">{globalStep.loading || !!auxBusyKey ? "busy" : "idle"}</span>
              </div>
            </div>
          </div>

          <div className="mb-4">
            {renderSummaryCards()}
          </div>

          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-lg font-bold text-white">验收导航</div>
              <div className="mt-1 text-sm text-white/55">Phase 1 + Phase 2 一次看完，畫布負責上下文，右側 inspector 負責真實操作。</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {["prompt", "script", "storyboard", "assets", "renderStill", "voice", "music", "video", "render"].map((nodeId) => (
                <button
                  key={nodeId}
                  type="button"
                  onClick={() => setSelected(nodeId)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${selected === nodeId ? "border-primary/40 bg-primary/15 text-primary" : "border-white/10 bg-white/5 text-white/65 hover:bg-white/10"}`}
                >
                  {nodeId}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
            <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-4 md:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-bold">节点画布 <span className="ml-2 text-xs text-white/45">Node Canvas</span></div>
                  <div className="mt-1 text-sm text-white/55">左側是主創作區，不再只是示意圖。你可以直接在 scene 卡片裡完成素材、旁白、視頻與靜幀操作。</div>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/60">
                  <Move className="h-4 w-4" />
                  Canvas-first creation
                </div>
              </div>
              {renderCanvasSurface()}
            </div>

            <div className="space-y-4">
              <Card className="border-white/10 bg-white/5">
                <CardContent className="p-5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-lg font-bold">当前节点 <span className="ml-2 text-xs text-white/45">Selected Node</span></div>
                    <button type="button" onClick={() => setDebugMode((prev) => !prev)} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/70"><Bug className="h-3.5 w-3.5" /> {debugMode ? "Debug ON" : "Debug OFF"}</button>
                  </div>
                  <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="mb-1 text-xl font-black">{current.title}</div>
                    <div className="mb-3 text-xs text-white/45">{current.en}</div>
                    <div className="mb-3 flex flex-wrap gap-2">
                      <div className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${badgeClass(current.status)}`}>接入：{current.status}</div>
                      <div className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary">运行：{selectedNodeRuntimeStatus()}</div>
                    </div>
                    <div className="text-sm leading-7 text-white/72">{current.desc}</div>
                    <div className="mt-3 text-xs text-white/50">workflowId: {workflowId || "not started"}</div>
                  </div>

                  <div className="mb-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-[#0b1020] p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-white/45">Inspector</div>
                      <div className="mt-2 text-sm text-white/70">這裡編輯的是當前所選節點的真實輸入，不是靜態 mock UI。</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-[#0b1020] p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-white/45">Next Step</div>
                      <div className="mt-2 text-sm font-semibold text-white">{nextRecommendedNode()}</div>
                      <div className="mt-1 text-xs text-white/55">你可以直接跳到建議節點繼續流程。</div>
                    </div>
                  </div>

                  {globalStep.error ? <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200"><AlertCircle className="h-4 w-4" /> {globalStep.error}</div> : null}
                  {auxError ? <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200"><AlertCircle className="h-4 w-4" /> {auxError}</div> : null}
                  {globalStep.success ? <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200"><CheckCircle2 className="h-4 w-4" /> 上一步执行成功</div> : null}

                  {renderCompactInspector()}

                  <div className="mt-5 rounded-2xl border border-white/10 bg-[#0b1020] p-4">
                    <div className="mb-2 text-sm font-semibold text-white">Latest Output Snapshot</div>
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs text-white/70">{JSON.stringify(selectedNodeSnapshot(), null, 2)}</pre>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-white/5">
                <CardContent className="p-5">
                  <div className="mb-3 text-lg font-bold">运行状态</div>
                  <div className="mb-4 flex flex-wrap gap-2">
                    <input
                      value={workflowIdInput}
                      onChange={(e) => setWorkflowIdInput(e.target.value)}
                      placeholder="Paste workflowId"
                      className="min-w-[220px] flex-1 rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white"
                    />
                    <Button
                      variant="outline"
                      className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                      onClick={() => {
                        const nextId = s(workflowIdInput).trim();
                        if (!nextId) return;
                        setWorkflowId(nextId);
                        void refreshWorkflow(nextId);
                      }}
                    >
                      Load Workflow
                    </Button>
                    <Button
                      variant="outline"
                      className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                      onClick={() => void refreshWorkflow()}
                      disabled={!workflowId}
                    >
                      <RefreshCcw className="mr-2 h-4 w-4" />
                      Refresh
                    </Button>
                  </div>
                  <div className="space-y-2 text-sm text-white/72">
                    <div>currentStep: <code>{s(workflow?.currentStep) || "--"}</code></div>
                    <div>status: <code>{s(workflow?.status) || "--"}</code></div>
                    <div>storyboard scenes: <code>{String(Array.isArray(outputs.storyboard) ? outputs.storyboard.length : 0)}</code></div>
                    <div>scene bundles: <code>{String(storyboardImages.length)}</code></div>
                    <div>scene videos: <code>{String(storyboardImages.filter((item) => s(item?.sceneVideoUrl).trim()).length)}</code></div>
                    <div>scene voices: <code>{String(storyboardImages.filter((item) => s(item?.sceneVoiceUrl).trim()).length)}</code></div>
                    <div>storyboard warnings: <code>{String(storyboardImageWarnings.length)}</code></div>
                  </div>
                </CardContent>
              </Card>

              {debugMode ? (
                <Card className="border-white/10 bg-white/5">
                  <CardContent className="p-5">
                    <div className="mb-3 text-lg font-bold">Debug 面板</div>
                    {envStatus ? <div className="mb-3 text-xs text-white/55">env: hasFAL={String(Boolean(envStatus.hasFalKey))} hasOpenAI={String(Boolean(envStatus.hasOpenAIKey))} hasAiMusic={String(Boolean(envStatus.hasAiMusicKey))} hasBlob={String(Boolean(envStatus.hasBlobReadWriteToken))} hasMVSPBlob={String(Boolean(envStatus.hasMvspReadWriteToken))}</div> : null}
                    {lastDebugEntry ? (
                      <div className="space-y-3 text-xs text-white/70">
                        <div>Last Op: <code>{lastDebugEntry.op}</code> / HTTP <code>{lastDebugEntry.status}</code> / ok=<code>{String(lastDebugEntry.httpOk)}</code></div>
                        <div>
                          <div className="mb-1 font-semibold text-white/80">Request</div>
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-[#0b1020] p-3">{JSON.stringify(lastDebugEntry.request, null, 2)}</pre>
                        </div>
                        <div>
                          <div className="mb-1 font-semibold text-white/80">Response</div>
                          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-[#0b1020] p-3">{JSON.stringify(lastDebugEntry.json, null, 2)}</pre>
                        </div>
                      </div>
                    ) : <div className="text-sm text-white/55">执行任一节点后，这里会显示真实 request / response。</div>}
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
