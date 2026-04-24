import React, { useEffect, useMemo, useState } from "react";
import { readGrowthHandoff } from "@/lib/growthHandoff";
import Navbar from "@/components/Navbar";
import { trpc } from "@/lib/trpc";
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
  videoErrorMessage?: string;
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
  icon: React.ComponentType<any>;
  status: NodeStatus;
};

// 每个节点的积分成本（0 = 免费）
const NODE_CREDIT_COST: Record<string, { cost: number; unit?: string; step?: string }> = {
  prompt:      { cost: 0 },
  script:      { cost: 0 },                               // 脚本生成：免费
  storyboard:  { cost: 5, step: "storyboard" },
  assets:      { cost: 5, unit: "/张", step: "scene_image" },
  renderStill: { cost: 9, unit: "/次", step: "render_still" },
  removebg:    { cost: 0 },                               // 开发中
  video:       { cost: 80, unit: "/场景", step: "scene_video" },
  voice:       { cost: 5, unit: "/场景", step: "scene_voice" },
  music:       { cost: 12, step: "music" },
  render:      { cost: 5, step: "final_render" },
};

const NODE_ITEMS: NodeItem[] = [
  { id: "prompt", title: "提示词输入", en: "Prompt", x: 60, y: 120, color: "from-fuchsia-500/30 to-pink-500/10", icon: Sparkles, status: "已接入" },
  { id: "script", title: "脚本生成", en: "Script", x: 320, y: 70, color: "from-violet-500/30 to-indigo-500/10", icon: FileText, status: "已接入" },
  { id: "storyboard", title: "故事板", en: "Storyboard", x: 590, y: 70, color: "from-sky-500/30 to-cyan-500/10", icon: PanelsTopLeft, status: "已接入" },
  { id: "assets", title: "分镜资产", en: "Scene Assets", x: 860, y: 70, color: "from-emerald-500/30 to-teal-500/10", icon: ImageIcon, status: "已接入" },
  { id: "renderStill", title: "多人静帧", en: "Render Still", x: 860, y: 290, color: "from-amber-500/30 to-yellow-500/10", icon: Lock, status: "已接入" },
  { id: "removebg", title: "去背景", en: "Background Removal", x: 1120, y: 290, color: "from-orange-500/30 to-red-500/10", icon: Scissors, status: "开发中" },
  { id: "video", title: "视频生成", en: "Scene Video", x: 1120, y: 70, color: "from-blue-500/30 to-indigo-500/10", icon: Video, status: "已接入" },
  { id: "voice", title: "智能旁白", en: "Scene Voice", x: 1380, y: 70, color: "from-cyan-500/30 to-blue-500/10", icon: Mic2, status: "已接入" },
  { id: "music", title: "自动配乐", en: "Music", x: 1380, y: 290, color: "from-pink-500/30 to-fuchsia-500/10", icon: Music2, status: "已接入" },
  { id: "render", title: "最终成片", en: "Final Render", x: 1640, y: 180, color: "from-white/20 to-white/5", icon: Clapperboard, status: "已接入" },
];

const EDGES = [
  ["prompt", "script"],
  ["script", "storyboard"],
  ["storyboard", "assets"],
  ["assets", "renderStill"],
  ["assets", "video"],
  ["renderStill", "video"],  // 多人静帧 → 视频生成（角色一致性）
  ["video", "voice"],        // 视频生成完成后 → 智能旁白
  ["video", "music"],        // 视频生成完成后 → 自动配乐
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

// op → { step, getQuantity? } 映射表（只列付费步骤）
type StepKey = "storyboard" | "scene_image" | "render_still" | "scene_video" | "scene_voice" | "music" | "final_render";
const OP_CREDIT_STEP: Record<string, { step: StepKey; getQuantity?: (body: Record<string, any>) => number }> = {
  workflowgeneratestoryboard:        { step: "storyboard" },
  workflowgeneratestoryboardimages:  { step: "scene_image", getQuantity: (b) => Number(b.storyboard?.length ?? b.sceneCount ?? 1) || 1 },
  workflowregeneratesceneimages:     { step: "scene_image" },
  workflowgeneratesceneimage:        { step: "scene_image" },
  workflowregeneratesceneasset:      { step: "scene_image" },
  workflowgeneraterenderstill:       { step: "render_still" },
  workflowgeneratevideo:             { step: "scene_video" },
  workflowgeneratescenevideo:        { step: "scene_video" },
  workflowgeneratevoice:             { step: "scene_voice" },
  workflowgeneratescenevoice:        { step: "scene_voice" },
  workflowgeneratemusic:             { step: "music" },
  workflowrendervideo:               { step: "final_render" },
  workflowrenderfinalvideo:          { step: "final_render" },
};

export default function WorkflowNodes() {
  const [selected, setSelected] = useState<string>("prompt");
  const [workflowId, setWorkflowId] = useState<string>("");
  const [workflowIdInput, setWorkflowIdInput] = useState<string>("");
  const [workflow, setWorkflow] = useState<any>(null);
  const [envStatus, setEnvStatus] = useState<Record<string, boolean> | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [lastDebugEntry, setLastDebugEntry] = useState<DebugEntry | null>(null);
  const [globalStep, setGlobalStep] = useState<StepState>(INITIAL_STEP);
  const [auxBusyKey, setAuxBusyKey] = useState("");
  const [auxError, setAuxError] = useState("");

  const chargeStepMutation = trpc.workflow.chargeStep.useMutation();
  const refundStepMutation = trpc.workflow.refundStep.useMutation();
  const [uploadingAssetKey, setUploadingAssetKey] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("未来都市追逐，镜头节奏快速，电影感强");
  const [targetWords, setTargetWords] = useState("900");
  const [targetScenes, setTargetScenes] = useState("6");
  const [scriptText, setScriptText] = useState("");
  const [scriptDirty, setScriptDirty] = useState(false);
  const [storyboard, setStoryboard] = useState<Scene[]>([]);
  const [storyboardDirty, setStoryboardDirty] = useState(false);
  const [sceneVoiceTextMap, setSceneVoiceTextMap] = useState<Record<string, string>>({});
  const [sceneVoiceTypeMap, setSceneVoiceTypeMap] = useState<Record<string, string>>({});
  const [sceneVoiceStyleMap, setSceneVoiceStyleMap] = useState<Record<string, string>>({});
  const [voiceLabText, setVoiceLabText] = useState("你好，这是一段独立语音测试，不依赖分镜或脚本。");
  const [voiceLabType, setVoiceLabType] = useState("female");
  const [voiceLabStyle, setVoiceLabStyle] = useState("warm");
  const [voiceLabResult, setVoiceLabResult] = useState<{ voiceUrl: string; voiceProvider: string; voiceModel: string; voiceVoice: string } | null>(null);
  const [renderStillPromptMap, setRenderStillPromptMap] = useState<Record<string, string>>({});
  const [musicPrompt, setMusicPrompt] = useState(""); // 留空 = 后端 Gemini 自动生成
  const [musicProvider, setMusicProvider] = useState("suno");
  const [musicDuration, setMusicDuration] = useState("30");
  const [lastAiMusicPrompt, setLastAiMusicPrompt] = useState(""); // 服务端返回的 AI 生成 prompt
  const [musicStartSec, setMusicStartSec] = useState("0");
  const [musicEndSec, setMusicEndSec] = useState("0");
  const [musicVolume, setMusicVolume] = useState("0.35");
  const [voiceVolume, setVoiceVolume] = useState("1");
  const [musicFadeInSec, setMusicFadeInSec] = useState("0");
  const [musicFadeOutSec, setMusicFadeOutSec] = useState("0");
  const [renderVoiceSceneMap, setRenderVoiceSceneMap] = useState<Record<string, boolean>>({});
  const [reuseCharacterSceneMap, setReuseCharacterSceneMap] = useState<Record<string, string>>({});
  const [reuseSceneImageMap, setReuseSceneImageMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const persisted = readGrowthHandoff();
    const handoff = persisted?.handoff;
    if (!handoff) return;
    setPrompt((prev) =>
      !prev.trim() || prev === "未来都市追逐，镜头节奏快速，电影感强"
        ? handoff.workflowPrompt || handoff.brief || prev
        : prev,
    );
    setVoiceLabText((prev) =>
      !prev.trim() || prev === "你好，这是一段独立语音测试，不依赖分镜或脚本。"
        ? handoff.brief || prev
        : prev,
    );
    setMusicPrompt((prev) =>
      !prev.trim() || prev === "cinematic trailer soundtrack, hybrid orchestral + modern electronic pulse, no vocal"
        ? `cinematic trailer soundtrack for ${handoff.recommendedTrack}`
        : prev,
    );
  }, []);

  const nodes = useMemo(() => NODE_ITEMS, []);
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const current = nodeMap.get(selected) || nodes[0];
  const outputs = workflow?.outputs || {};
  const effectiveWorkflowId = s(workflowId || workflow?.workflowId || workflowIdInput).trim();
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
    if (effectiveWorkflowId) {
      window.localStorage.setItem("workflowNodes:workflowId", effectiveWorkflowId);
      setWorkflowIdInput(effectiveWorkflowId);
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set("workflowId", effectiveWorkflowId);
      window.history.replaceState({}, "", nextUrl.toString());
      return;
    }
    window.localStorage.removeItem("workflowNodes:workflowId");
  }, [effectiveWorkflowId]);

  useEffect(() => {
    if (!effectiveWorkflowId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const resp = await fetch(`/api/jobs?op=workflowStatus&workflowId=${encodeURIComponent(effectiveWorkflowId)}`);
      const json = await resp.json().catch(() => null);
      if (!cancelled && resp.ok && json?.workflow && json.workflow.status !== "not_found") {
        setWorkflow(json.workflow);
      } else if (!cancelled && resp.ok && json?.workflow?.status === "not_found") {
        setGlobalStep({ loading: false, error: "workflow_not_found", success: false });
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [effectiveWorkflowId]);

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
      setSceneVoiceTextMap((prev) => {
        const next = { ...prev };
        for (const scene of normalized) {
          const key = String(scene.sceneIndex);
          if (!(key in next)) next[key] = scene.voiceover || "";
        }
        return next;
      });
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
        const explicitVoiceIndexes = Array.isArray(nextOutputs.includeSceneVoiceIndexes)
          ? new Set(nextOutputs.includeSceneVoiceIndexes.map((value: any) => Number(value || 0)).filter((value: number) => value > 0))
          : null;
        for (const scene of normalized) {
          const key = String(scene.sceneIndex);
          if (!(key in next)) next[key] = explicitVoiceIndexes ? explicitVoiceIndexes.has(Number(scene.sceneIndex || 0)) : false;
        }
        return next;
      });
    }
  }, [workflow, scriptDirty, storyboardDirty]);

  useEffect(() => {
    // Music prompt 由后端 Gemini 自动生成，前端不再自动填充
    void buildMusicPromptSeedFromScenes; // keep function in scope, avoid unused-variable lint
  }, [storyboard]);

  useEffect(() => {
    const nextProvider = s(outputs.musicProvider).trim().toLowerCase();
    if (nextProvider === "suno" || nextProvider === "udio") setMusicProvider(nextProvider);
  }, [outputs.musicProvider]);

  useEffect(() => {
    if (outputs.musicStartSec != null) setMusicStartSec(String(outputs.musicStartSec));
    if (outputs.musicEndSec != null) setMusicEndSec(String(outputs.musicEndSec));
    if (outputs.musicVolume != null) setMusicVolume(String(outputs.musicVolume));
    if (outputs.voiceVolume != null) setVoiceVolume(String(outputs.voiceVolume));
    if (outputs.musicFadeInSec != null) setMusicFadeInSec(String(outputs.musicFadeInSec));
    if (outputs.musicFadeOutSec != null) setMusicFadeOutSec(String(outputs.musicFadeOutSec));
  }, [outputs.musicStartSec, outputs.musicEndSec, outputs.musicVolume, outputs.voiceVolume, outputs.musicFadeInSec, outputs.musicFadeOutSec]);

  function writeBackWorkflow(json: any) {
    const nextId = s(json?.workflow?.workflowId || json?.workflowId || effectiveWorkflowId).trim();
    if (nextId) setWorkflowId(nextId);
    if (json?.workflow) setWorkflow(json.workflow);
    setScriptDirty(false);
    setStoryboardDirty(false);
    // 捕获服务端返回的 AI 生成 music prompt
    if (s(json?.musicPrompt).trim()) setLastAiMusicPrompt(s(json.musicPrompt).trim());
  }

  function buildRequestBody(body: Record<string, any>) {
    return {
      ...body,
      workflowId: body.workflowId || effectiveWorkflowId || undefined,
      workflow: body.workflow || workflow || undefined,
      script: body.script ?? scriptText,
      storyboard: body.storyboard ?? storyboard,
    };
  }

  async function refreshWorkflow(targetWorkflowId?: string) {
    const nextId = s(targetWorkflowId || effectiveWorkflowId).trim();
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

    // ── 付费步骤：先扣积分，失败则退款 ──
    const opKey = op.toLowerCase();
    const creditInfo = OP_CREDIT_STEP[opKey];
    let chargedCost = 0;
    let chargedStep: StepKey | null = null;
    let chargedQty = 1;
    if (creditInfo) {
      try {
        const qty = creditInfo.getQuantity ? creditInfo.getQuantity(body) : 1;
        const charge = await chargeStepMutation.mutateAsync({ step: creditInfo.step, quantity: qty });
        chargedCost = charge.cost;
        chargedStep = creditInfo.step;
        chargedQty = qty;
      } catch (err: any) {
        const msg = err?.message || "Credits 不足，请前往充值页面购买积分";
        setGlobalStep({ loading: false, error: msg, success: false });
        return null;
      }
    }

    try {
      const payload = buildRequestBody(body);
      const result = await postJson(op, payload);
      setLastDebugEntry({ op, request: payload, httpOk: result.httpOk, status: result.status, json: result.json });
      if (!result.httpOk || result.json?.ok === false) {
        // 操作失败，退款
        if (chargedStep && chargedCost > 0) {
          void refundStepMutation.mutateAsync({ step: chargedStep, quantity: chargedQty, reason: `${op} 失败退款` }).catch(() => {});
        }
        const errorText = extractErrorText(result.json);
        setGlobalStep({ loading: false, error: errorText, success: false });
        return null;
      }
      writeBackWorkflow(result.json);
      setGlobalStep({ loading: false, error: "", success: true });
      onSuccess?.(result.json);
      return result.json;
    } catch (error: any) {
      // 异常，退款
      if (chargedStep && chargedCost > 0) {
        void refundStepMutation.mutateAsync({ step: chargedStep, quantity: chargedQty, reason: `${op} 异常退款` }).catch(() => {});
      }
      setGlobalStep({ loading: false, error: error?.message || String(error) || "request_failed", success: false });
      return null;
    }
  }

  async function runAuxStep(key: string, op: string, body: Record<string, any>, onSuccess?: (json: any) => void) {
    setAuxBusyKey(key);
    setAuxError("");

    // 与 runOp 共用同一套积分拦截（aux 级别的场景步骤也要扣费）
    const opKey = op.toLowerCase();
    const creditInfo = OP_CREDIT_STEP[opKey];
    let auxChargedCost = 0;
    let auxChargedStep: StepKey | null = null;
    let auxChargedQty = 1;
    if (creditInfo) {
      try {
        const qty = creditInfo.getQuantity ? creditInfo.getQuantity(body) : 1;
        const charge = await chargeStepMutation.mutateAsync({ step: creditInfo.step, quantity: qty });
        auxChargedCost = charge.cost;
        auxChargedStep = creditInfo.step;
        auxChargedQty = qty;
      } catch (err: any) {
        setAuxError(err?.message || "Credits 不足，请前往充值页面购买积分");
        setAuxBusyKey("");
        return null;
      }
    }

    try {
      const payload = buildRequestBody(body);
      const result = await postJson(op, payload);
      setLastDebugEntry({ op, request: payload, httpOk: result.httpOk, status: result.status, json: result.json });
      if (!result.httpOk || result.json?.ok === false) {
        if (auxChargedStep && auxChargedCost > 0) {
          void refundStepMutation.mutateAsync({ step: auxChargedStep, quantity: auxChargedQty, reason: `${op} 失败退款` }).catch(() => {});
        }
        setAuxError(extractErrorText(result.json));
        return null;
      }
      writeBackWorkflow(result.json);
      onSuccess?.(result.json);
      return result.json;
    } catch (error: any) {
      if (auxChargedStep && auxChargedCost > 0) {
        void refundStepMutation.mutateAsync({ step: auxChargedStep, quantity: auxChargedQty, reason: `${op} 异常退款` }).catch(() => {});
      }
      setAuxError(error?.message || String(error) || "request_failed");
      return null;
    } finally {
      setAuxBusyKey("");
    }
  }

  // ─── Veo 3.1 异步生成场景视频（start → poll → save）──────────────────────
  async function generateSceneVideoVeo(sceneIndex: number, sceneBody: Record<string, any>) {
    const busyKey = `scene-video-${sceneIndex}`;
    setAuxBusyKey(busyKey);
    setAuxError("");

    // 先扣积分
    try {
      await chargeStepMutation.mutateAsync({ step: "scene_video", quantity: 1 });
    } catch (err: any) {
      setAuxError(err?.message || "Credits 不足，请前往充值页面购买积分");
      setAuxBusyKey("");
      return;
    }

    try {
      // Phase-1: 启动任务
      const startPayload = buildRequestBody({ ...sceneBody, sceneIndex });
      const startResult = await postJson("workflowGenerateSceneVideo", startPayload);
      if (!startResult.httpOk || startResult.json?.ok === false) {
        void refundStepMutation.mutateAsync({ step: "scene_video", quantity: 1, reason: "veo_start 失败退款" }).catch(() => {});
        setAuxError(extractErrorText(startResult.json));
        setAuxBusyKey("");
        return;
      }
      writeBackWorkflow(startResult.json);

      const { taskId, veoModel, veoLocation } = startResult.json as { taskId: string; veoModel: string; veoLocation: string };
      if (!taskId) {
        void refundStepMutation.mutateAsync({ step: "scene_video", quantity: 1, reason: "veo_no_taskId 退款" }).catch(() => {});
        setAuxError("Veo 任务启动失败：未返回 taskId");
        setAuxBusyKey("");
        return;
      }

      // Phase-2: 前端轮询（最多 80 次，每 5s，共 ~6.5min）
      let videoUrl = "";
      for (let i = 0; i < 80; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const pollResult = await postJson("workflowVeoPoll", {
          taskId, veoModel, veoLocation,
          workflowId: effectiveWorkflowId,
        });
        if (!pollResult.httpOk) continue;
        const { done, failed, videoUrl: url, error } = pollResult.json as { done: boolean; failed: boolean; videoUrl: string; error?: string };
        if (failed) {
          void refundStepMutation.mutateAsync({ step: "scene_video", quantity: 1, reason: `veo 生成失败退款: ${error || ""}` }).catch(() => {});
          setAuxError(`Veo 生成失败: ${error || "unknown"}`);
          setAuxBusyKey("");
          return;
        }
        if (done && url) { videoUrl = url; break; }
      }

      if (!videoUrl) {
        void refundStepMutation.mutateAsync({ step: "scene_video", quantity: 1, reason: "veo 超时退款" }).catch(() => {});
        setAuxError("Veo 生成超时（约 6.5 分钟），请重试");
        setAuxBusyKey("");
        return;
      }

      // Phase-3: 保存 URL 回 workflow
      const saveResult = await postJson("workflowVeoSave", buildRequestBody({
        sceneIndex, videoUrl,
        veoModel: veoModel || "veo-3.1-generate-001",
      }));
      if (saveResult.httpOk && saveResult.json?.ok !== false) {
        writeBackWorkflow(saveResult.json);
      }
    } catch (err: any) {
      void refundStepMutation.mutateAsync({ step: "scene_video", quantity: 1, reason: "veo 异常退款" }).catch(() => {});
      setAuxError(err?.message || "veo_error");
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

  function getSceneBundle(sceneIndex: number) {
    return sceneBundlesByIndex[sceneIndex] || { sceneIndex, images: [] };
  }

  async function reuseSceneAssetFromScene(targetSceneIndex: number, sourceSceneIndex: number, assetType: "character" | "scene") {
    const sourceBundle = getSceneBundle(sourceSceneIndex);
    const sourceUrl = assetType === "character"
      ? getCharacterImageUrls(sourceBundle)[0] || ""
      : getSceneImageUrls(sourceBundle)[0] || "";
    if (!sourceUrl) {
      setAuxError(assetType === "character" ? "source_character_image_not_found" : "source_scene_image_not_found");
      return;
    }
    await runAuxStep(`reuse-${assetType}-${targetSceneIndex}`, "workflowUploadSceneImage", {
      workflowId,
      sceneIndex: targetSceneIndex,
      imageUrl: sourceUrl,
      assetType,
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

  function isNodeReady(nodeId: string) {
    return !["待执行", "待开始"].includes(renderNodeStatus(nodeId));
  }

  function isEdgeActive(fromId: string, toId: string) {
    if (selected === fromId || selected === toId) return true;
    return isNodeReady(fromId) && isNodeReady(toId);
  }

  function getSceneCardError(sceneIndex: number) {
    const bundle = sceneBundlesByIndex[sceneIndex];
    const persisted = s(bundle?.videoErrorMessage).trim();
    if (persisted) return persisted;
    if (
      auxError &&
      lastDebugEntry?.request &&
      Number(lastDebugEntry.request.sceneIndex || 0) === sceneIndex &&
      ["workflowGenerateSceneVideo", "workflowGenerateSceneVoice", "workflowGenerateSceneImage", "workflowGenerateRenderStill", "workflowUploadSceneImage"].includes(lastDebugEntry.op)
    ) {
      return auxError;
    }
    return "";
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
          {globalStep.loading ? "生成中..." : "生成脚本"}
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
            {globalStep.loading ? "更新中..." : "载入分镜阶段"}
          </Button>
          <div className="text-sm text-white/60">这一步沿用现有后端协议，将 workflow 切到 storyboard 阶段。分镜内容的编辑与保存会在下一个节点完成。</div>
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
          <div className="text-sm text-white/60">把当前编辑过的 scenes 写回 workflow，后续节点会直接使用这份 storyboard。</div>
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
          这个节点是 scene 级素材工作台。每个分镜保留 1 张角色图和 1 张场景图，并在这里决定当前用哪张素材进入后续 Scene Video。
        </div>
        <div className="flex flex-wrap gap-3">
          <Button disabled={globalStep.loading || !storyboard.length} onClick={() => void runOp("workflowGenerateStoryboardImages", {
            workflowId,
            workflow,
            storyboard,
          }, () => setSelected("renderStill"))} className="rounded-xl bg-primary px-5">
            {globalStep.loading ? "生成中..." : "生成全部分镜资产"}
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
                    {auxBusyKey === `scene-assets-${bundle.sceneIndex}` ? "生成中..." : "生成分镜资产"}
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
          多人场景建议走 Render Still，再在 Final Render 中插入，避免直接用 scene video 造成角色不稳定。
        </div>
        {storyboard.map((scene) => (
          <div key={scene.sceneIndex} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-white">Scene {scene.sceneIndex}</div>
              <div className={`rounded-full border px-2 py-1 text-xs ${scene.renderStillNeeded ? 'border-amber-400/30 bg-amber-400/10 text-amber-200' : 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'}`}>{scene.renderStillNeeded ? 'Render Still Needed' : 'Scene Video OK'}</div>
            </div>
            {!scene.renderStillNeeded ? (
              <Button variant="outline" className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={() => updateScene(scene.sceneIndex, { renderStillNeeded: true })}>
                Enable Render Still For This Scene
              </Button>
            ) : (
              <>
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
                  })} className="rounded-xl bg-primary px-5">{auxBusyKey === `render-still-${scene.sceneIndex}` ? "生成中..." : "生成静帧"}</Button>
                  <div className="text-xs text-white/60 break-all">{s(storyboardImages.find((item) => Number(item.sceneIndex) === scene.sceneIndex)?.renderStillImageUrl) || "no render still yet"}</div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    );
  }

  function renderVoicePanel() {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-primary/30 bg-primary/10 p-4">
          <div className="mb-2 text-sm font-semibold text-white">语音实验室</div>
          <div className="mb-3 text-sm text-white/70">直接输入文字生成语音，不依赖 scene、storyboard 或 script。</div>
          <textarea
            value={voiceLabText}
            onChange={(e) => setVoiceLabText(e.target.value)}
            rows={4}
            placeholder="直接输入你要测试的旁白文字"
            className="mb-3 w-full rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white"
          />
          <div className="grid gap-3 md:grid-cols-2">
            <select value={voiceLabType} onChange={(e) => setVoiceLabType(e.target.value)} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white">
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="cartoon">Cartoon</option>
            </select>
            <select value={voiceLabStyle} onChange={(e) => setVoiceLabStyle(e.target.value)} className="rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white">
              <option value="">Normal</option>
              <option value="warm">Warm</option>
              <option value="calm">Calm</option>
              <option value="energetic">Energetic</option>
              <option value="cinematic">Cinematic</option>
            </select>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              disabled={auxBusyKey === "voice-lab" || !voiceLabText.trim()}
              onClick={() => void runAuxStep("voice-lab", "generateVoice", {
                text: voiceLabText.trim(),
                voiceType: voiceLabType,
                voiceStyle: voiceLabStyle,
                voice: mapSceneVoiceTypeToVoice(voiceLabType),
                voicePrompt: DEFAULT_SCENE_VOICE_PROMPT,
              }, (json) => {
                setVoiceLabResult({
                  voiceUrl: s(json?.voiceUrl).trim(),
                  voiceProvider: s(json?.voiceProvider).trim(),
                  voiceModel: s(json?.voiceModel).trim(),
                  voiceVoice: s(json?.voiceVoice).trim(),
                });
              })}
              className="rounded-xl bg-primary px-5"
            >
              {auxBusyKey === "voice-lab" ? "生成中..." : "生成语音"}
            </Button>
            {voiceLabResult ? (
              <div className="text-xs text-white/60">
                {voiceLabResult.voiceProvider} / {voiceLabResult.voiceModel} / {voiceLabResult.voiceVoice}
              </div>
            ) : null}
          </div>
          {voiceLabResult?.voiceUrl ? <audio key={voiceLabResult.voiceUrl} className="mt-3 w-full" controls src={toMediaUrl(voiceLabResult.voiceUrl)} /> : null}
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
          旁白以 scene 为单位生成。勾选 <span className="font-semibold text-white">加入成片</span> 的 scene 才会在最终 Render 中混入。
        </div>
        {storyboard.map((scene) => {
          const key = String(scene.sceneIndex);
          const bundle = storyboardImages.find((item) => Number(item.sceneIndex) === scene.sceneIndex);
          const manualVoiceText = sceneVoiceTextMap[key] ?? "";
          return (
            <div key={scene.sceneIndex} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-2 text-sm font-semibold text-white">Scene {scene.sceneIndex}</div>
              <div className="mb-2 text-xs font-medium uppercase tracking-[0.22em] text-white/45">Direct Voice Text</div>
              <textarea
                value={manualVoiceText}
                onChange={(e) => setSceneVoiceTextMap((prev) => ({ ...prev, [key]: e.target.value }))}
                rows={4}
                placeholder="直接输入你要生成的旁白文字"
                className="mb-3 w-full rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white"
              />
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
                <Button
                  disabled={auxBusyKey === `scene-voice-${scene.sceneIndex}` || !manualVoiceText.trim()}
                  onClick={() => void runAuxStep(`scene-voice-${scene.sceneIndex}`, "workflowGenerateSceneVoice", {
                    workflowId,
                    sceneIndex: scene.sceneIndex,
                    dialogueText: manualVoiceText.trim(),
                    voicePrompt: DEFAULT_SCENE_VOICE_PROMPT,
                    voiceType: sceneVoiceTypeMap[key] ?? scene.voiceType ?? "female",
                    voiceStyle: sceneVoiceStyleMap[key] ?? scene.voiceStyle ?? "",
                    voice: mapSceneVoiceTypeToVoice(sceneVoiceTypeMap[key] ?? scene.voiceType ?? "female"),
                  })}
                  className="rounded-xl bg-primary px-5"
                >
                  {auxBusyKey === `scene-voice-${scene.sceneIndex}` ? "生成中..." : "生成场景旁白"}
                </Button>
                <label className="inline-flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={Boolean(renderVoiceSceneMap[key])} onChange={(e) => setRenderVoiceSceneMap((prev) => ({ ...prev, [key]: e.target.checked }))} /> 加入成片</label>
              </div>
              {bundle?.sceneVoiceUrl ? <audio key={bundle.sceneVoiceUrl} className="mt-3 w-full" controls src={toMediaUrl(bundle.sceneVoiceUrl)} /> : null}
            </div>
          );
        })}
      </div>
    );
  }

  function renderMusicPanel() {
    const displayPrompt = lastAiMusicPrompt || s(outputs.musicPrompt).trim();
    return (
      <div className="space-y-4">
        {/* 说明卡 */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
          <div className="flex items-center gap-2 font-semibold text-white/90">
            <span className="rounded-full border border-pink-400/40 bg-pink-400/10 px-2 py-0.5 text-[11px] font-bold text-pink-300">Suno V5.5</span>
            <span className="rounded-full border border-violet-400/40 bg-violet-400/10 px-2 py-0.5 text-[11px] font-bold text-violet-300">Gemini 2.5 Pro</span>
            自动配乐
          </div>
          <p className="mt-2 leading-relaxed">
            系统将根据脚本内容，由 Gemini 2.5 Pro 自动生成专业 Music Prompt，再送至 Suno V5.5 合成纯音乐 BGM。
            无需手动填写 Prompt，点击「生成配乐」即可。
          </p>
        </div>

        {/* 自定义 Prompt（可选覆盖） */}
        <div className="space-y-2">
          <label className="flex items-center justify-between text-xs text-white/55">
            <span>自定义 Music Prompt（留空 = AI 自动生成）</span>
            {displayPrompt && (
              <button
                type="button"
                className="text-[11px] text-violet-400 hover:text-violet-300"
                onClick={() => setMusicPrompt(displayPrompt)}
              >
                载入上次 AI 生成结果
              </button>
            )}
          </label>
          <textarea
            value={musicPrompt}
            onChange={(e) => setMusicPrompt(e.target.value)}
            rows={3}
            placeholder="留空则由 Gemini 自动根据脚本生成…"
            className="w-full rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white placeholder-white/25"
          />
        </div>

        {/* 时长 */}
        <div className="flex items-center gap-3">
          <label className="text-xs text-white/55 whitespace-nowrap">时长（秒）</label>
          <input
            value={musicDuration}
            onChange={(e) => setMusicDuration(e.target.value)}
            className="w-28 rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white"
            placeholder="30"
          />
        </div>

        {/* 上次 AI 生成的 prompt 预览 */}
        {displayPrompt && (
          <div className="rounded-xl border border-violet-400/20 bg-violet-400/5 p-3">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-violet-400">AI 生成的 Music Prompt</div>
            <p className="text-xs leading-relaxed text-white/70">{displayPrompt}</p>
          </div>
        )}

        <Button
          disabled={globalStep.loading}
          onClick={() => void runOp("workflowGenerateMusic", {
            workflowId,
            musicPrompt: musicPrompt.trim() || undefined,
            musicProvider,
            musicDuration: Number(musicDuration || 0) || undefined,
          })}
          className="rounded-xl bg-primary px-5"
        >
          {globalStep.loading ? "生成中…" : "生成配乐 · Suno V5.5"}
        </Button>

        {outputs.musicUrl && (
          <audio key={outputs.musicUrl} className="w-full" controls src={toMediaUrl(outputs.musicUrl)} />
        )}
      </div>
    );
  }

  function renderVideoPanel() {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/70">
          Scene Video 会读取这个 workflow 里当前已选定的角色图与场景图。如果 scene 被标记为多人场景，建议回 Render Still 节点处理。
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
                <Button
                  disabled={auxBusyKey === `scene-video-${scene.sceneIndex}`}
                  onClick={() => void generateSceneVideoVeo(scene.sceneIndex, {
                    workflowId,
                    duration: "8s",
                    scenePrompt: scene.scenePrompt,
                    primarySubject: scene.primarySubject,
                    character: scene.character,
                    action: scene.action,
                    camera: scene.camera,
                    mood: scene.mood,
                    lighting: scene.lighting,
                  })}
                  className="rounded-xl bg-primary px-5"
                >
                  {auxBusyKey === `scene-video-${scene.sceneIndex}` ? "Veo 生成中…" : "生成场景视频 · Veo 3.1"}
                </Button>
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
        <div className="rounded-2xl border border-white/10 bg-[#0b1020] p-4">
          <div className="mb-3 text-sm font-semibold text-white">配乐截取区间</div>
          <div className="mb-3 text-xs text-white/60">这里控制配乐从第几秒开始，到第几秒结束。留空或填 0 表示从头开始或不限制结束时间。</div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-2 text-sm text-white/80">
              <span>配乐开始秒数</span>
              <input value={musicStartSec} onChange={(e) => setMusicStartSec(e.target.value)} className="w-full rounded-xl border border-white/15 bg-[#11162a] p-3 text-sm text-white" placeholder="例如 10" />
            </label>
            <label className="space-y-2 text-sm text-white/80">
              <span>配乐结束秒数</span>
              <input value={musicEndSec} onChange={(e) => setMusicEndSec(e.target.value)} className="w-full rounded-xl border border-white/15 bg-[#11162a] p-3 text-sm text-white" placeholder="例如 40" />
            </label>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2 text-sm text-white/80">
            <span>配乐音量</span>
            <input value={musicVolume} onChange={(e) => setMusicVolume(e.target.value)} className="w-full rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" placeholder="0.35" />
          </label>
          <label className="space-y-2 text-sm text-white/80">
            <span>旁白音量</span>
            <input value={voiceVolume} onChange={(e) => setVoiceVolume(e.target.value)} className="w-full rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" placeholder="1.0" />
          </label>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-2 text-sm text-white/80">
            <span>配乐淡入秒数</span>
            <input value={musicFadeInSec} onChange={(e) => setMusicFadeInSec(e.target.value)} className="w-full rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" placeholder="例如 2" />
          </label>
          <label className="space-y-2 text-sm text-white/80">
            <span>配乐淡出秒数</span>
            <input value={musicFadeOutSec} onChange={(e) => setMusicFadeOutSec(e.target.value)} className="w-full rounded-xl border border-white/15 bg-[#0b1020] p-3 text-sm text-white" placeholder="例如 2" />
          </label>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
          Render 会自动拼接已生成的 scene video、你勾选加入成片的 scene voice，以及指定区间内的音乐片段，并统一输出 finalVideoUrl。
        </div>
        <Button disabled={globalStep.loading} onClick={() => void runOp("workflowRenderVideo", {
          workflowId,
          musicStartSec: Number(musicStartSec || 0) || 0,
          musicEndSec: Number(musicEndSec || 0) || 0,
          musicVolume: Number(musicVolume || 0),
          voiceVolume: Number(voiceVolume || 0),
          musicFadeInSec: Number(musicFadeInSec || 0) || 0,
          musicFadeOutSec: Number(musicFadeOutSec || 0) || 0,
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
      <div className="overflow-x-auto rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(236,72,153,0.16),transparent_28%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.14),transparent_30%),rgba(255,255,255,0.02)] p-4">
        <div className="relative h-[430px] min-w-[1820px]">
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1820 430" fill="none" preserveAspectRatio="none">
            {EDGES.map(([fromId, toId]) => {
              const from = nodeMap.get(fromId);
              const to = nodeMap.get(toId);
              if (!from || !to) return null;
              const active = isEdgeActive(fromId, toId);
              return (
                <path
                  key={`${fromId}-${toId}`}
                  d={edgePath(from, to)}
                  stroke={active ? "rgba(244,114,182,0.95)" : "rgba(255,255,255,0.18)"}
                  strokeWidth={active ? 4 : 2}
                  strokeDasharray={active ? "0" : "10 8"}
                  strokeLinecap="round"
                />
              );
            })}
          </svg>

          {nodes.map((node) => {
            const Icon = node.icon;
            const active = selected === node.id;
            const ready = isNodeReady(node.id);
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => setSelected(node.id)}
                className={`absolute w-[220px] rounded-[26px] border p-4 text-left transition-all ${active ? "border-primary/60 bg-primary/12 shadow-[0_20px_60px_rgba(236,72,153,0.24)]" : ready ? "border-emerald-400/20 bg-emerald-400/[0.06]" : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"}`}
                style={{ left: node.x, top: node.y }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${active ? "border-primary/40 bg-primary/15 text-primary" : "border-white/10 bg-white/10 text-white"}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-lg font-black text-white">{node.title}</div>
                      <div className="text-xs uppercase tracking-[0.16em] text-white/40">{node.en}</div>
                    </div>
                  </div>
                  <span className={`mt-1 h-3 w-3 rounded-full ${active ? "bg-primary shadow-[0_0_0_6px_rgba(236,72,153,0.18)]" : ready ? "bg-emerald-300" : node.status === "开发中" ? "bg-amber-300" : "bg-white/30"}`} />
                </div>
                <div className="mt-5 flex items-center justify-between text-xs text-white/55">
                  <span>{renderNodeStatus(node.id)}</span>
                  <div className="flex items-center gap-1.5">
                    {/* 积分标签 */}
                    {(() => {
                      const info = NODE_CREDIT_COST[node.id];
                      if (!info) return null;
                      if (info.cost === 0) {
                        return (
                          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                            免费
                          </span>
                        );
                      }
                      return (
                        <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                          {info.cost} cr{info.unit ?? ""}
                        </span>
                      );
                    })()}
                    <span className={`rounded-full border px-2 py-1 ${badgeClass(node.status)}`}>{node.status}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function renderSceneCanvas() {
    if (!storyboard.length) {
      return (
        <div className="rounded-[28px] border border-dashed border-white/15 bg-white/[0.03] p-8 text-sm text-white/55">
          先生成 script 和 storyboard，左侧画布才会展开真正的 scene 创作工作区。
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
          <div>
            <div className="text-lg font-bold text-white">分镜画布</div>
            <div className="mt-1 text-sm text-white/60">左侧画布现在是创作主工作区。分镜文案、角色图、场景图、旁白、场景视频与生成操作都在这里完成。</div>
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
          const sceneVideoUrl = s(bundle?.sceneVideoUrl).trim();
          const selectedSceneImageUrl = s(bundle?.selectedSceneImageUrl).trim() || sceneUrl;
          const busyAssets = auxBusyKey === `scene-assets-${scene.sceneIndex}`;
          const busyVideo = auxBusyKey === `scene-video-${scene.sceneIndex}`;
          const sceneCardError = getSceneCardError(Number(scene.sceneIndex || 0));
          const siblingScenes = storyboard.filter((item) => item.sceneIndex !== scene.sceneIndex);
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

              <div className="space-y-4 p-5">
                {sceneCardError ? (
                  <div className="flex items-center gap-2 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    <AlertCircle className="h-4 w-4" />
                    {sceneCardError}
                  </div>
                ) : null}

                <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="space-y-4 rounded-[26px] border border-white/10 bg-[#0b1020] p-4">
                    <div className="mb-2 text-xs uppercase tracking-[0.18em] text-white/45">Scene Prompt</div>
                    <textarea
                      value={scene.scenePrompt || ""}
                      onChange={(e) => updateScene(scene.sceneIndex, { scenePrompt: e.target.value })}
                      rows={6}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm leading-6 text-white outline-none"
                    />
                    <div className="text-xs uppercase tracking-[0.18em] text-white/45">Scene Meta</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <input value={scene.primarySubject || ""} onChange={(e) => updateScene(scene.sceneIndex, { primarySubject: e.target.value })} className="rounded-xl border border-white/10 bg-[#0b1020] p-3 text-sm text-white" placeholder="Primary Subject" />
                      <input value={scene.character || ""} onChange={(e) => updateScene(scene.sceneIndex, { character: e.target.value })} className="rounded-xl border border-white/10 bg-[#0b1020] p-3 text-sm text-white" placeholder="Character" />
                      <input value={scene.action || ""} onChange={(e) => updateScene(scene.sceneIndex, { action: e.target.value })} className="rounded-xl border border-white/10 bg-[#0b1020] p-3 text-sm text-white" placeholder="Action" />
                      <input value={scene.camera || ""} onChange={(e) => updateScene(scene.sceneIndex, { camera: e.target.value })} className="rounded-xl border border-white/10 bg-[#0b1020] p-3 text-sm text-white" placeholder="Camera" />
                      <input value={scene.mood || ""} onChange={(e) => updateScene(scene.sceneIndex, { mood: e.target.value })} className="rounded-xl border border-white/10 bg-[#0b1020] p-3 text-sm text-white" placeholder="Mood" />
                      <input value={scene.lighting || ""} onChange={(e) => updateScene(scene.sceneIndex, { lighting: e.target.value })} className="rounded-xl border border-white/10 bg-[#0b1020] p-3 text-sm text-white" placeholder="Lighting" />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" className="rounded-xl border-white/10 bg-white/[0.03] text-white hover:bg-white/10" onClick={() => setSelected("voice")}>
                        Voice Node
                      </Button>
                      <Button variant="outline" className="rounded-xl border-white/10 bg-white/[0.03] text-white hover:bg-white/10" onClick={() => setSelected("renderStill")}>
                        Render Still Node
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-[26px] border border-white/10 bg-[#0b1020] p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-white/45">Character</div>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] ${characterUrl ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-white/5 text-white/45"}`}>{characterUrl ? "Ready" : "Pending"}</span>
                    </div>
                    {characterUrl ? (
                      <div className="flex min-h-[520px] items-center justify-center rounded-2xl border border-white/10 bg-black/30 p-3">
                        <img src={toMediaUrl(characterUrl)} alt={`scene-${scene.sceneIndex}-character`} className="max-h-[500px] w-full rounded-xl object-contain" />
                      </div>
                    ) : (
                      <div className="flex min-h-[520px] items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 text-sm text-white/35">No character image</div>
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
                      <Button className="rounded-xl bg-primary px-4" disabled={busyAssets} onClick={() => void runAuxStep(`scene-character-${scene.sceneIndex}`, "workflowRegenerateSceneAsset", { workflowId, workflow, storyboard, sceneIndex: scene.sceneIndex, assetType: "character" })}>
                        {busyAssets ? "生成中..." : "重生角色图"}
                      </Button>
                      {characterUrl ? (
                        <a href={toMediaUrl(characterUrl)} download>
                          <Button variant="outline" className="rounded-xl border-white/10 bg-white/[0.03] text-white hover:bg-white/10">Download Original</Button>
                        </a>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <select value={reuseCharacterSceneMap[String(scene.sceneIndex)] ?? ""} onChange={(e) => setReuseCharacterSceneMap((prev) => ({ ...prev, [String(scene.sceneIndex)]: e.target.value }))} className="min-w-[160px] rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white">
                        <option value="">Reuse character from...</option>
                        {siblingScenes.map((sourceScene) => (
                          <option key={sourceScene.sceneIndex} value={String(sourceScene.sceneIndex)}>Scene {sourceScene.sceneIndex}</option>
                        ))}
                      </select>
                      <Button variant="outline" className="rounded-xl border-white/10 bg-white/[0.03] text-white hover:bg-white/10" disabled={!reuseCharacterSceneMap[String(scene.sceneIndex)]} onClick={() => void reuseSceneAssetFromScene(scene.sceneIndex, Number(reuseCharacterSceneMap[String(scene.sceneIndex)] || 0), "character")}>
                        Use Scene Character
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-4 rounded-[26px] border border-white/10 bg-[#0b1020] p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-white/45">Scene Image</div>
                      <span className={`rounded-full border px-2.5 py-1 text-[11px] ${selectedSceneImageUrl ? "border-primary/30 bg-primary/10 text-primary" : "border-white/10 bg-white/5 text-white/45"}`}>{selectedSceneImageUrl ? "Selected" : "Pending"}</span>
                    </div>
                    {sceneUrl ? (
                      <button type="button" onClick={() => selectSceneImage(scene.sceneIndex, sceneUrl)} className="block w-full">
                        <div className={`flex min-h-[360px] items-center justify-center rounded-2xl border bg-black/30 p-3 transition-all ${selectedSceneImageUrl === sceneUrl ? "border-primary shadow-[0_0_0_1px_rgba(236,72,153,0.28)]" : "border-white/10"}`}>
                          <img src={toMediaUrl(sceneUrl)} alt={`scene-${scene.sceneIndex}-environment`} className="max-h-[340px] w-full rounded-xl object-contain" />
                        </div>
                      </button>
                    ) : (
                      <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 text-sm text-white/35">No scene image</div>
                    )}
                    <div className="flex flex-wrap gap-2">
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
                      <Button className="rounded-xl bg-primary px-4" disabled={busyAssets} onClick={() => void runAuxStep(`scene-environment-${scene.sceneIndex}`, "workflowRegenerateSceneAsset", { workflowId, workflow, storyboard, sceneIndex: scene.sceneIndex, assetType: "scene" })}>
                        {busyAssets ? "生成中..." : "重生场景图"}
                      </Button>
                      {sceneUrl ? (
                        <>
                          <Button variant="outline" className="rounded-xl border-white/10 bg-white/[0.03] text-white hover:bg-white/10" onClick={() => selectSceneImage(scene.sceneIndex, sceneUrl)}>
                            Use This Scene
                          </Button>
                          <a href={toMediaUrl(sceneUrl)} download>
                            <Button variant="outline" className="rounded-xl border-white/10 bg-white/[0.03] text-white hover:bg-white/10">Download Original</Button>
                          </a>
                        </>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <select value={reuseSceneImageMap[String(scene.sceneIndex)] ?? ""} onChange={(e) => setReuseSceneImageMap((prev) => ({ ...prev, [String(scene.sceneIndex)]: e.target.value }))} className="min-w-[160px] rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-white">
                        <option value="">Reuse scene from...</option>
                        {siblingScenes.map((sourceScene) => (
                          <option key={sourceScene.sceneIndex} value={String(sourceScene.sceneIndex)}>Scene {sourceScene.sceneIndex}</option>
                        ))}
                      </select>
                      <Button variant="outline" className="rounded-xl border-white/10 bg-white/[0.03] text-white hover:bg-white/10" disabled={!reuseSceneImageMap[String(scene.sceneIndex)]} onClick={() => void reuseSceneAssetFromScene(scene.sceneIndex, Number(reuseSceneImageMap[String(scene.sceneIndex)] || 0), "scene")}>
                        Use Scene Background
                      </Button>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-white/45">Scene Video</div>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] ${sceneVideoUrl ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-white/5 text-white/45"}`}>{sceneVideoUrl ? "Ready" : "Pending"}</span>
                      </div>
                      {sceneVideoUrl ? (
                        <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-white/10 bg-black/30 p-3">
                          <video key={sceneVideoUrl} controls className="max-h-[220px] w-full rounded-xl object-contain" src={toMediaUrl(sceneVideoUrl)} />
                        </div>
                      ) : (
                        <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 text-sm text-white/35">暂未生成场景视频</div>
                      )}
                      {scene.renderStillNeeded ? (
                        <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                          这个 scene 已标记为 Render Still，需要时再到 Render Still 节点处理。
                        </div>
                      ) : null}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <Button
                          className="rounded-xl bg-primary px-4"
                          disabled={busyVideo || !characterUrl || !sceneUrl || Boolean(scene.renderStillNeeded)}
                          onClick={() => void generateSceneVideoVeo(scene.sceneIndex, {
                            workflowId,
                            duration: "8s",
                            scenePrompt: scene.scenePrompt,
                            primarySubject: scene.primarySubject,
                            character: scene.character,
                            action: scene.action,
                            camera: scene.camera,
                            mood: scene.mood,
                            lighting: scene.lighting,
                          })}
                        >
                          {busyVideo ? "Veo 生成中…" : "生成视频 · Veo 3.1"}
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
    if (selected === "prompt" || selected === "script" || selected === "voice") {
      return (
        <div className="space-y-5">
          {renderWorkflowRibbon()}
          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6">
            {selected === "prompt" ? renderPromptPanel() : selected === "script" ? renderScriptPanel() : renderVoicePanel()}
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
          这个节点的主要创作操作已经搬到左侧画布。右侧只保留节点说明、状态与输出快照，方便你快速对照。
        </div>
        <div className="rounded-2xl border border-white/10 bg-[#0b1020] p-4 text-sm text-white/72">
          <div className="text-xs uppercase tracking-[0.18em] text-white/45">当前节点概览</div>
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
                <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm text-primary">创作画布 <span className="ml-2 text-xs text-white/45">Workflow Canvas</span></div>
                <h1 className="mt-4 text-3xl font-black tracking-tight md:text-5xl">/workflow-nodes 创作画布</h1>
                <p className="mt-3 max-w-4xl text-sm leading-7 text-white/72 md:text-base">保留旧版 <span className="text-white">/workflow</span> 作为 fallback，这里负责真实执行、节点检查与 scene 级编辑，目标是让 Prompt 到 Final Render 的链路更清晰。</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button className="rounded-xl bg-primary px-5 text-primary-foreground hover:bg-primary/90" onClick={() => setSelected(nextRecommendedNode())}>
                  <Wand2 className="mr-2 h-4 w-4" />
                  打开建议节点
                </Button>
                <a href="/workflow">
                  <Button variant="outline" className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10">查看旧版工作流</Button>
                </a>
              </div>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-white/60">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                <ArrowRight className="h-4 w-4" />
                建议节点: <span className="font-semibold text-white">{nextRecommendedNode()}</span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                <LoaderCircle className={`h-4 w-4 ${globalStep.loading || !!auxBusyKey ? "animate-spin text-primary" : "text-white/45"}`} />
                当前状态: <span className="font-semibold text-white">{globalStep.loading || !!auxBusyKey ? "处理中" : "空闲"}</span>
              </div>
            </div>
          </div>

          <div className="mb-4">
            {renderSummaryCards()}
          </div>

          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-lg font-bold text-white">验收导航</div>
              <div className="mt-1 text-sm text-white/55">十个节点在上方同步高亮，左侧画布负责真正的创作与执行。</div>
            </div>
            <div className="flex flex-wrap gap-2">
              {["prompt", "script", "storyboard", "assets", "renderStill", "removebg", "video", "voice", "music", "render"].map((nodeId) => (
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
                  <div className="mt-1 text-sm text-white/55">左侧是主创作区，不再只是示意图。你可以直接在 scene 卡片里完成素材、旁白、视频与静帧操作。</div>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/60">
                  <Move className="h-4 w-4" />
                  画布优先创作
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
                    <div className="text-sm text-white/60">workflowId: {effectiveWorkflowId || "未开始"}</div>
                  </div>

                  <div className="mb-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-[#0b1020] p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-white/45">当前编辑区</div>
                      <div className="mt-2 text-sm text-white/70">这里编辑的是当前所选节点的真实输入，不是静态 mock UI。</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-[#0b1020] p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-white/45">下一步</div>
                      <div className="mt-2 text-sm font-semibold text-white">{nextRecommendedNode()}</div>
                      <div className="mt-1 text-xs text-white/55">你可以直接跳到建议节点继续流程。</div>
                    </div>
                  </div>

                  {globalStep.error ? <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200"><AlertCircle className="h-4 w-4" /> {globalStep.error}</div> : null}
                  {auxError ? <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200"><AlertCircle className="h-4 w-4" /> {auxError}</div> : null}
                  {globalStep.success ? <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200"><CheckCircle2 className="h-4 w-4" /> 上一步执行成功</div> : null}

                  {renderCompactInspector()}

                  {debugMode ? (
                    <div className="mt-5 rounded-2xl border border-white/10 bg-[#0b1020] p-4">
                      <div className="mb-2 text-sm font-semibold text-white">最新输出快照</div>
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-xs text-white/70">{JSON.stringify(selectedNodeSnapshot(), null, 2)}</pre>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-white/5">
                <CardContent className="p-5">
                  <div className="mb-3 text-lg font-bold">运行状态</div>
                  {debugMode ? (
                    <div className="mb-4 flex flex-wrap gap-2">
                      <input
                        value={workflowIdInput}
                        onChange={(e) => setWorkflowIdInput(e.target.value)}
                        placeholder="粘贴 workflowId"
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
                        载入 workflow
                      </Button>
                      <Button
                        variant="outline"
                        className="rounded-xl border-white/15 bg-white/5 text-white hover:bg-white/10"
                        onClick={() => void refreshWorkflow()}
                        disabled={!effectiveWorkflowId}
                      >
                        <RefreshCcw className="mr-2 h-4 w-4" />
                        刷新
                      </Button>
                    </div>
                  ) : (
                    <div className="mb-4 text-sm text-white/60">需要查看 workflowId、输出快照或手动载入时，可以打开右上角 Debug。</div>
                  )}
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
