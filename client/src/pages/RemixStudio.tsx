// @ts-nocheck

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { JOB_PROGRESS_MESSAGES, createJob, getJob, type JobType, type JobStatus } from "@/lib/jobs";
import {
  Sparkles, Footprints, Mic2, Layers, Coins, RefreshCw,
  CheckCircle, Download, Upload, Loader2, Trash2, Play,
  Image as ImageIcon, Video, Plus, X, Info, ChevronDown, Clock, Heart, Star,
} from "lucide-react";
import { ExpiryWarningBanner, CreationHistoryPanel, FavoriteButton } from "@/components/CreationManager";

// ─── Types ──────────────────────────────────────────

type KlingTab = "omniVideo" | "motionControl" | "lipSync" | "elements" | "imageGen" | "history";
type KlingMode = "std" | "pro";
type AspectRatio = "16:9" | "9:16" | "1:1";
type Duration = "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "15";

interface TaskInfo {
  taskId: string;
  jobType: JobType;
  jobInput: Record<string, unknown>;
  type: KlingTab;
  subType?: string;
  status: JobStatus;
  createdAt: number;
  output?: Record<string, any>;
  error?: string;
}

// ─── Tab Config ─────────────────────────────────────

const TABS: Array<{ id: KlingTab; label: string; icon: React.ElementType; color: string; desc: string }> = [
  { id: "omniVideo", label: "Omni Video", icon: Sparkles, color: "#A855F7", desc: "3.0 文生视频 / 图生视频 / 分镜叙事" },
  { id: "motionControl", label: "Motion Control", icon: Footprints, color: "#3B82F6", desc: "2.6 动作迁移：图片 + 动作视频 → 动画" },
  { id: "lipSync", label: "Lip-Sync", icon: Mic2, color: "#EC4899", desc: "对口型：视频 + 音频 → 口型同步" },
  { id: "elements", label: "Elements", icon: Layers, color: "#10B981", desc: "角色元素库：保持角色一致性" },
  { id: "imageGen", label: "Image Gen", icon: ImageIcon, color: "#F59E0B", desc: "Kling AI 圖片生成：支持 1K/2K 解析度，O1 和 V2.1 模型" },
  { id: "history", label: "生成記錄", icon: Clock, color: "#6B7280", desc: "查看可靈工作室的所有生成記錄和收藏" },
];

// ─── Shared UI Components ───────────────────────────

function CostBadge({ mode, duration, type, hasVideo = false, hasAudio = false }: {
  mode: KlingMode; duration: number; type: string; hasVideo?: boolean; hasAudio?: boolean;
}) {
  // 根據類型計算平台 Credits 消耗
  let credits = 0;
  if (type === "omniVideo") {
    credits = 80; // klingVideo
  } else if (type === "motionControl") {
    credits = 70; // klingMotionControl
  } else if (type === "lipSync") {
    credits = 60; // klingLipSync
  }

  // 同時計算 Kling API units 供參考
  let units = 0;
  if (type === "omniVideo") {
    const base = mode === "std"
      ? (!hasVideo && !hasAudio ? 0.6 : !hasVideo && hasAudio ? 0.8 : hasVideo && !hasAudio ? 0.9 : 1.1)
      : (!hasVideo && !hasAudio ? 0.8 : !hasVideo && hasAudio ? 1.0 : hasVideo && !hasAudio ? 1.2 : 1.4);
    units = base * duration;
  } else if (type === "motionControl") {
    units = (mode === "std" ? 0.5 : 0.8) * duration;
  } else if (type === "lipSync") {
    units = 0.05 + 0.5 * Math.ceil(duration / 5);
  }

  return (
    <div className="flex items-center space-x-2 bg-gray-800 text-yellow-400 px-3 py-1.5 rounded-full text-xs">
      <Coins className="h-3.5 w-3.5" />
      <span className="font-bold">{credits} Credits</span>
      <span className="text-gray-500">|</span>
      <span className="text-gray-400">{units.toFixed(1)} API units</span>
    </div>
  );
}

function ModeSelector({ mode, onModeChange }: { mode: KlingMode; onModeChange: (m: KlingMode) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-gray-300">品质模式</span>
      <div className="flex items-center space-x-2 rounded-lg bg-gray-800 p-1">
        <button onClick={() => onModeChange("std")} className={`px-3 py-1 text-sm rounded-md transition-colors ${mode === "std" ? "bg-purple-600 text-white" : "text-gray-300 hover:text-white"}`}>Standard 720p</button>
        <button onClick={() => onModeChange("pro")} className={`px-3 py-1 text-sm rounded-md transition-colors ${mode === "pro" ? "bg-purple-600 text-white" : "text-gray-300 hover:text-white"}`}>Pro 1080p</button>
      </div>
    </div>
  );
}

function DurationSelector({ duration, onDurationChange, maxDuration = "15" }: {
  duration: Duration; onDurationChange: (d: Duration) => void; maxDuration?: string;
}) {
  const options: Duration[] = ["3", "5", "10", "15"];
  const filtered = options.filter((d) => parseInt(d) <= parseInt(maxDuration));
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-gray-300">时长（秒）</span>
      <div className="flex items-center space-x-2 rounded-lg bg-gray-800 p-1">
        {filtered.map((d) => (
          <button key={d} onClick={() => onDurationChange(d)} className={`px-3 py-1 text-sm rounded-md transition-colors ${duration === d ? "bg-purple-600 text-white" : "text-gray-300 hover:text-white"}`}>{d}s</button>
        ))}
      </div>
    </div>
  );
}

function AspectRatioSelector({ ratio, onRatioChange }: { ratio: AspectRatio; onRatioChange: (r: AspectRatio) => void }) {
  const options: Array<{ value: AspectRatio; label: string }> = [
    { value: "16:9", label: "16:9 横屏" },
    { value: "9:16", label: "9:16 竖屏" },
    { value: "1:1", label: "1:1 方形" },
  ];
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-gray-300">画面比例</span>
      <div className="flex items-center space-x-2 rounded-lg bg-gray-800 p-1">
        {options.map((o) => (
          <button key={o.value} onClick={() => onRatioChange(o.value)} className={`px-3 py-1 text-sm rounded-md transition-colors ${ratio === o.value ? "bg-purple-600 text-white" : "text-gray-300 hover:text-white"}`}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

function FileUploadBox({ label, accept, value, onChange, preview }: {
  label: string; accept: string; value: string | null; onChange: (dataUrl: string | null) => void; preview?: "image" | "video";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => onChange(reader.result as string);
    reader.readAsDataURL(file);
  };
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-gray-300">{label}</span>
      <div
        onClick={() => ref.current?.click()}
        className="w-full h-40 border-2 border-dashed border-gray-600 rounded-lg flex items-center justify-center cursor-pointer hover:border-purple-500 transition-colors relative overflow-hidden"
      >
        {value ? (
          <>
            {preview === "video" ? (
              <video src={value} className="h-full w-full object-contain rounded-lg" controls />
            ) : (
              <img src={value} alt="Preview" className="h-full w-full object-contain rounded-lg" />
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onChange(null); }}
              className="absolute top-2 right-2 bg-red-600 text-white rounded-full p-1 hover:bg-red-700"
            >
              <X className="h-3 w-3" />
            </button>
          </>
        ) : (
          <div className="text-center text-gray-400">
            <Upload className="mx-auto h-8 w-8" />
            <p className="text-sm mt-1">点击上传</p>
          </div>
        )}
      </div>
      <input type="file" accept={accept} ref={ref} onChange={handleFile} className="hidden" />
    </div>
  );
}

// ─── Task Status Card ───────────────────────────────

function TaskStatusCard({ task, onPoll, onRetry }: { task: TaskInfo; onPoll: () => void; onRetry: () => void }) {
  const statusColors: Record<string, string> = {
    queued: "bg-yellow-400",
    running: "bg-blue-500",
    succeeded: "bg-green-500",
    failed: "bg-red-500",
  };
  const statusLabels: Record<string, string> = {
    queued: "排队中",
    running: "生成中...",
    succeeded: "完成",
    failed: "失败",
  };
  const typeLabels: Record<string, string> = {
    omniVideo: "Omni Video",
    motionControl: "Motion Control",
    lipSync: "Lip-Sync",
    elements: "Elements",
    imageGen: "Image Gen",
  };
  const messageIndex = Math.floor((Date.now() - task.createdAt) / 2200) % JOB_PROGRESS_MESSAGES[task.jobType].length;
  const progressMessage = JOB_PROGRESS_MESSAGES[task.jobType][messageIndex];
  const videoUrl = task.output?.videoUrl as string | undefined;
  const imageUrls = Array.isArray(task.output?.images)
    ? (task.output?.images as string[])
    : typeof task.output?.imageUrl === "string"
    ? [task.output.imageUrl]
    : [];

  return (
    <div className="bg-gray-800 p-4 rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className={`h-2.5 w-2.5 rounded-full ${statusColors[task.status]}`} />
          <span className="font-semibold text-white">{typeLabels[task.type] || task.type}</span>
          {task.subType && <span className="text-xs text-gray-400">({task.subType})</span>}
          <span className={`font-medium text-sm ${task.status === "succeeded" ? "text-green-400" : task.status === "failed" ? "text-red-400" : task.status === "running" ? "text-blue-400" : "text-yellow-400"}`}>
            {statusLabels[task.status]}
          </span>
        </div>
        {(task.status === "running" || task.status === "queued") && (
          <button onClick={onPoll} className="flex items-center space-x-1 text-purple-400 hover:text-purple-300 transition-colors">
            <RefreshCw className="h-4 w-4" />
            <span className="text-sm">刷新</span>
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-1.5 font-mono">Task: {task.taskId.slice(0, 20)}...</p>
      {(task.status === "running" || task.status === "queued") && (
        <p className="mt-2 text-xs text-gray-400">{progressMessage}</p>
      )}
      {task.status === "succeeded" && videoUrl && (
        <div className="mt-3 space-y-2">
          <video src={videoUrl} controls className="w-full rounded-md max-h-48" />
          <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center space-x-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm hover:bg-blue-700 transition-colors">
            <Download className="h-4 w-4" />
            <span>下载视频</span>
          </a>
        </div>
      )}
      {task.status === "succeeded" && imageUrls.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {imageUrls.slice(0, 4).map((url) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              <img src={url} alt="Generated" className="h-24 w-full rounded-md object-cover" />
            </a>
          ))}
        </div>
      )}
      {task.status === "failed" && task.error && (
        <div className="mt-2 space-y-2">
          <p className="text-sm text-red-400 bg-red-900/30 p-2 rounded-md">{task.error}</p>
          <button onClick={onRetry} className="inline-flex items-center space-x-1 rounded-md bg-red-500/20 px-2.5 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/30">
            <RefreshCw className="h-3.5 w-3.5" />
            <span>重试</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Omni Video Panel
// ═══════════════════════════════════════════════════════

function OmniVideoPanel({ enqueueTask }: { enqueueTask: (input: { jobType: JobType; taskType: KlingTab; subType?: string; jobInput: Record<string, unknown> }) => Promise<void> }) {
  const [subTab, setSubTab] = useState<"t2v" | "i2v" | "storyboard">("t2v");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [mode, setMode] = useState<KlingMode>("std");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [duration, setDuration] = useState<Duration>("5");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [enableFaceConsistency, setEnableFaceConsistency] = useState(false);
  const [useReferenceImage, setUseReferenceImage] = useState(false);
  const [smoothLayeredTransformation, setSmoothLayeredTransformation] = useState(false);
  const [referenceImageUri, setReferenceImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [shots, setShots] = useState<Array<{ prompt: string; duration: string }>>([
    { prompt: "", duration: "5" },
    { prompt: "", duration: "5" },
  ]);

  const uploadFile = trpc.kling.uploadFile.useMutation();

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() && subTab !== "storyboard") {
      toast.error("请输入描述文本");
      return;
    }
    setLoading(true);
    try {
      let referenceImageUrl: string | undefined;
      if (useReferenceImage && referenceImageUri) {
        referenceImageUrl = referenceImageUri;
        if (referenceImageUri.startsWith("data:")) {
          const base64 = referenceImageUri.split(",")[1];
          const ext = referenceImageUri.split(";")[0].split("/")[1] || "png";
          const uploaded = await uploadFile.mutateAsync({
            fileBase64: base64,
            fileName: `kling-ref.${ext}`,
            mimeType: `image/${ext}`,
            folder: "images",
          });
          referenceImageUrl = uploaded.url;
        }
      }

      const optionalParams: Record<string, unknown> = {};
      if (referenceImageUrl) {
        optionalParams.reference_image = referenceImageUrl;
      }
      if (enableFaceConsistency) {
        optionalParams.face_consistency = true;
        optionalParams.identity_strength = 0.8;
      }
      if (smoothLayeredTransformation) {
        optionalParams.transformation_mode = "layered";
      }

      if (subTab === "t2v") {
        await enqueueTask({
          jobType: "video",
          taskType: "omniVideo",
          subType: "t2v",
          jobInput: {
            action: "omni_t2v",
            params: {
              prompt: prompt.trim(),
              negativePrompt: negativePrompt.trim() || undefined,
              mode,
              aspectRatio,
              duration,
              ...optionalParams,
            },
          },
        });
      } else if (subTab === "i2v") {
        if (!imageUri) {
          toast.error("请选择一张参考图片");
          setLoading(false);
          return;
        }
        // Upload image to S3 first
        let imageUrl = imageUri;
        if (imageUri.startsWith("data:")) {
          const base64 = imageUri.split(",")[1];
          const ext = imageUri.split(";")[0].split("/")[1] || "png";
          const uploaded = await uploadFile.mutateAsync({
            fileBase64: base64,
            fileName: `i2v-ref.${ext}`,
            mimeType: `image/${ext}`,
            folder: "images",
          });
          imageUrl = uploaded.url;
        }
        await enqueueTask({
          jobType: "video",
          taskType: "omniVideo",
          subType: "i2v",
          jobInput: {
            action: "omni_i2v",
            params: {
              prompt: prompt.trim(),
              imageUrl,
              mode,
              aspectRatio,
              duration,
              ...optionalParams,
            },
          },
        });
      } else {
        const validShots = shots.filter((s) => s.prompt.trim());
        if (validShots.length < 1) {
          toast.error("请至少填写一个分镜描述");
          setLoading(false);
          return;
        }
        await enqueueTask({
          jobType: "video",
          taskType: "omniVideo",
          subType: "storyboard",
          jobInput: {
            action: "omni_storyboard",
            params: {
              shots: validShots,
              mode,
              aspectRatio,
              ...optionalParams,
            },
          },
        });
      }
      toast.success("任务已加入队列，请在右侧查看进度");
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || "发生错误，请稍后再试");
    } finally {
      setLoading(false);
    }
  }, [prompt, negativePrompt, mode, aspectRatio, duration, imageUri, subTab, shots, enqueueTask, useReferenceImage, referenceImageUri, enableFaceConsistency, smoothLayeredTransformation]);

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex space-x-1 bg-gray-800/50 rounded-lg p-1">
        {[
          { id: "t2v", label: "文生视频", icon: Sparkles },
          { id: "i2v", label: "图生视频", icon: ImageIcon },
          { id: "storyboard", label: "分镜叙事", icon: Video },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id as any)}
            className={`flex-1 flex items-center justify-center space-x-1.5 py-2 px-3 text-sm rounded-md transition-colors ${subTab === t.id ? "bg-purple-600 text-white" : "text-gray-400 hover:text-white"}`}
          >
            <t.icon className="h-4 w-4" />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Prompt */}
      {subTab !== "storyboard" && (
        <div className="space-y-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="输入你的视频创意描述..."
            className="w-full p-3 bg-gray-800 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-purple-500 border border-gray-700 resize-none"
            rows={4}
          />
          <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center space-x-1 text-xs text-gray-400 hover:text-gray-300">
            <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
            <span>高级选项</span>
          </button>
          {showAdvanced && (
            <textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="负面提示词（不希望出现的内容）..."
              className="w-full p-3 bg-gray-800 rounded-lg text-white placeholder-gray-500 focus:ring-1 focus:ring-gray-600 border border-gray-700 resize-none text-sm"
              rows={2}
            />
          )}
        </div>
      )}

      {/* Image upload for I2V */}
      {subTab === "i2v" && (
        <FileUploadBox label="参考图片" accept="image/*" value={imageUri} onChange={setImageUri} preview="image" />
      )}

      <div className="space-y-3 rounded-lg border border-gray-700 bg-gray-800/40 p-3">
        <label className="flex items-center justify-between text-sm text-gray-200">
          <span>鎖定人臉一致性</span>
          <input
            type="checkbox"
            checked={enableFaceConsistency}
            onChange={(e) => setEnableFaceConsistency(e.target.checked)}
            className="h-4 w-4 accent-purple-600"
          />
        </label>
        <label className="flex items-center justify-between text-sm text-gray-200">
          <span>使用參考圖片</span>
          <input
            type="checkbox"
            checked={useReferenceImage}
            onChange={(e) => {
              setUseReferenceImage(e.target.checked);
              if (!e.target.checked) setReferenceImageUri(null);
            }}
            className="h-4 w-4 accent-purple-600"
          />
        </label>
        <label className="flex items-center justify-between text-sm text-gray-200">
          <span>平滑分層換裝（避免整體變形）</span>
          <input
            type="checkbox"
            checked={smoothLayeredTransformation}
            onChange={(e) => setSmoothLayeredTransformation(e.target.checked)}
            className="h-4 w-4 accent-purple-600"
          />
        </label>
      </div>

      {useReferenceImage && (
        <FileUploadBox
          label="上傳參考圖片"
          accept="image/*"
          value={referenceImageUri}
          onChange={setReferenceImageUri}
          preview="image"
        />
      )}

      {/* Storyboard shots */}
      {subTab === "storyboard" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-300">分镜列表（最多 6 个镜头）</span>
            {shots.length < 6 && (
              <button onClick={() => setShots([...shots, { prompt: "", duration: "5" }])} className="flex items-center space-x-1 text-purple-400 hover:text-purple-300 text-sm">
                <Plus className="h-4 w-4" />
                <span>添加镜头</span>
              </button>
            )}
          </div>
          {shots.map((shot, i) => (
            <div key={i} className="flex items-start space-x-2 bg-gray-800/50 p-3 rounded-lg">
              <span className="text-xs text-gray-500 mt-2 font-mono w-6">#{i + 1}</span>
              <div className="flex-1 space-y-2">
                <textarea
                  value={shot.prompt}
                  onChange={(e) => {
                    const newShots = [...shots];
                    newShots[i].prompt = e.target.value;
                    setShots(newShots);
                  }}
                  placeholder={`镜头 ${i + 1} 描述...`}
                  className="w-full p-2 bg-gray-800 rounded-md text-white placeholder-gray-500 border border-gray-700 text-sm resize-none"
                  rows={2}
                />
                <select
                  value={shot.duration}
                  onChange={(e) => {
                    const newShots = [...shots];
                    newShots[i].duration = e.target.value;
                    setShots(newShots);
                  }}
                  className="bg-gray-800 text-gray-300 text-xs rounded-md border border-gray-700 px-2 py-1"
                >
                  {["3", "5", "10"].map((d) => <option key={d} value={d}>{d}s</option>)}
                </select>
              </div>
              {shots.length > 1 && (
                <button onClick={() => setShots(shots.filter((_, j) => j !== i))} className="text-gray-500 hover:text-red-400 mt-2">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="space-y-3 pt-2">
        <ModeSelector mode={mode} onModeChange={setMode} />
        <AspectRatioSelector ratio={aspectRatio} onRatioChange={setAspectRatio} />
        {subTab !== "storyboard" && <DurationSelector duration={duration} onDurationChange={setDuration} />}
      </div>

      {/* Submit */}
      <div className="flex justify-between items-center pt-4 border-t border-gray-700">
        <CostBadge mode={mode} duration={parseInt(duration)} type="omniVideo" hasVideo={subTab === "i2v"} />
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="px-6 py-2.5 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center space-x-2 transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] hover:shadow-lg hover:shadow-purple-600/30 ripple-effect"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
          <span>{loading ? "生成中..." : "生成视频"}</span>
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Motion Control Panel (2.6)
// ═══════════════════════════════════════════════════════

function MotionControlPanel({ enqueueTask }: { enqueueTask: (input: { jobType: JobType; taskType: KlingTab; subType?: string; jobInput: Record<string, unknown> }) => Promise<void> }) {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [mode, setMode] = useState<KlingMode>("std");
  const [orientation, setOrientation] = useState<"image" | "video">("video");
  const [prompt, setPrompt] = useState("");
  const [keepSound, setKeepSound] = useState(true);
  const [loading, setLoading] = useState(false);

  const uploadFile = trpc.kling.uploadFile.useMutation();

  const handleSubmit = useCallback(async () => {
    if (!imageUri) {
      toast.error("请上传角色图片");
      return;
    }
    if (!videoUri) {
      toast.error("请上传动作参考视频");
      return;
    }
    setLoading(true);
    try {
      // Upload image
      let imageUrl = imageUri;
      if (imageUri.startsWith("data:")) {
        const base64 = imageUri.split(",")[1];
        const ext = imageUri.split(";")[0].split("/")[1] || "png";
        const uploaded = await uploadFile.mutateAsync({
          fileBase64: base64, fileName: `mc-img.${ext}`, mimeType: `image/${ext}`, folder: "images",
        });
        imageUrl = uploaded.url;
      }

      // Upload video
      let videoUrl = videoUri;
      if (videoUri.startsWith("data:")) {
        const base64 = videoUri.split(",")[1];
        const ext = videoUri.split(";")[0].split("/")[1] || "mp4";
        const uploaded = await uploadFile.mutateAsync({
          fileBase64: base64, fileName: `mc-vid.${ext}`, mimeType: `video/${ext}`, folder: "videos",
        });
        videoUrl = uploaded.url;
      }

      await enqueueTask({
        jobType: "video",
        taskType: "motionControl",
        subType: `${orientation} orientation`,
        jobInput: {
          action: "motion_control",
          params: {
            imageUrl,
            videoUrl,
            orientation,
            mode,
            prompt: prompt.trim() || undefined,
            keepOriginalSound: keepSound,
          },
        },
      });
      toast.success("Motion Control 任务已加入队列");
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || "提交失败，请稍后再试");
    } finally {
      setLoading(false);
    }
  }, [imageUri, videoUri, mode, orientation, prompt, keepSound, enqueueTask]);

  return (
    <div className="space-y-4">
      <div className="bg-blue-900/20 border border-blue-800/40 rounded-lg p-3 flex items-start space-x-2">
        <Info className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-blue-300">
          上传一张角色图片和一段动作参考视频，AI 会将角色"穿上"视频中的动作。适合舞蹈、运动、手势等动作迁移。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FileUploadBox label="角色图片" accept="image/*" value={imageUri} onChange={setImageUri} preview="image" />
        <FileUploadBox label="动作参考视频" accept="video/*" value={videoUri} onChange={setVideoUri} preview="video" />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">画面方向跟随</span>
        <div className="flex items-center space-x-2 rounded-lg bg-gray-800 p-1">
          <button onClick={() => setOrientation("image")} className={`px-3 py-1 text-sm rounded-md transition-colors ${orientation === "image" ? "bg-blue-600 text-white" : "text-gray-300 hover:text-white"}`}>跟随图片</button>
          <button onClick={() => setOrientation("video")} className={`px-3 py-1 text-sm rounded-md transition-colors ${orientation === "video" ? "bg-blue-600 text-white" : "text-gray-300 hover:text-white"}`}>跟随视频</button>
        </div>
      </div>

      <ModeSelector mode={mode} onModeChange={setMode} />

      <div className="space-y-2">
        <span className="text-sm font-medium text-gray-300">补充描述（可选）</span>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="对生成结果的额外描述，如场景、风格等..."
          className="w-full p-3 bg-gray-800 rounded-lg text-white placeholder-gray-500 border border-gray-700 resize-none text-sm"
          rows={2}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">保留原始音频</span>
        <button
          onClick={() => setKeepSound(!keepSound)}
          className={`w-11 h-6 rounded-full transition-colors ${keepSound ? "bg-blue-600" : "bg-gray-600"} relative`}
        >
          <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${keepSound ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>

      <div className="flex justify-between items-center pt-4 border-t border-gray-700">
        <CostBadge mode={mode} duration={5} type="motionControl" />
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center space-x-2 transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] hover:shadow-lg hover:shadow-blue-600/30 ripple-effect"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Footprints className="h-5 w-5" />}
          <span>{loading ? "提交中..." : "开始动作迁移"}</span>
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Lip-Sync Panel
// ═══════════════════════════════════════════════════════

function LipSyncPanel({ enqueueTask }: { enqueueTask: (input: { jobType: JobType; taskType: KlingTab; subType?: string; jobInput: Record<string, unknown> }) => Promise<void> }) {
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoUrlForJob, setVideoUrlForJob] = useState<string | null>(null);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const [step, setStep] = useState<"upload" | "selectFace" | "configure">("upload");
  const [faceTaskId, setFaceTaskId] = useState<string | null>(null);
  const [faces, setFaces] = useState<Array<{ face_id: string; face_image_url?: string }>>([]);
  const [selectedFace, setSelectedFace] = useState<string | null>(null);
  const [soundVolume, setSoundVolume] = useState(1);
  const [originalVolume, setOriginalVolume] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pollLoading, setPollLoading] = useState(false);

  const identifyFaces = trpc.kling.lipSync.identifyFaces.useMutation();
  const uploadFile = trpc.kling.uploadFile.useMutation();

  // Step 1: Upload video and identify faces
  const handleIdentifyFaces = useCallback(async () => {
    if (!videoUri) {
      toast.error("请上传包含人脸的视频");
      return;
    }
    setLoading(true);
    try {
      let videoUrl = videoUri;
      if (videoUri.startsWith("data:")) {
        const base64 = videoUri.split(",")[1];
        const ext = videoUri.split(";")[0].split("/")[1] || "mp4";
        const uploaded = await uploadFile.mutateAsync({
          fileBase64: base64, fileName: `lipsync-vid.${ext}`, mimeType: `video/${ext}`, folder: "videos",
        });
        videoUrl = uploaded.url;
      }

      const result = await identifyFaces.mutateAsync({ videoUrl });
      if (result?.task_id) {
        setVideoUrlForJob(videoUrl);
        setFaceTaskId(result.task_id);
        setStep("selectFace");
        toast.success("人脸识别任务已提交，请点击「查询结果」获取人脸列表");
      }
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || "人脸识别失败");
    } finally {
      setLoading(false);
    }
  }, [videoUri]);

  // Poll face identification result
  const handlePollFaces = useCallback(async () => {
    if (!faceTaskId) return;
    setPollLoading(true);
    try {
      const response = await fetch(
        `/api/trpc/kling.lipSync.getFaceResult?input=${encodeURIComponent(JSON.stringify({ taskId: faceTaskId }))}`,
        { credentials: "include" }
      );
      const json = await response.json();
      const data = json?.result?.data;
      if (data?.task_status === "succeed" && data?.task_result?.face_list) {
        setFaces(data.task_result.face_list);
        if (data.task_result.face_list.length > 0) {
          setSelectedFace(data.task_result.face_list[0].face_id);
        }
        toast.success(`检测到 ${data.task_result.face_list.length} 张人脸`);
      } else if (data?.task_status === "processing") {
        toast.info("人脸识别仍在处理中，请稍后再试");
      } else if (data?.task_status === "failed") {
        toast.error("人脸识别失败: " + (data?.task_status_msg || "未知错误"));
      }
    } catch (error) {
      console.error(error);
      toast.error("查询人脸结果失败");
    } finally {
      setPollLoading(false);
    }
  }, [faceTaskId]);

  // Step 2: Create lip-sync task
  const handleCreateLipSync = useCallback(async () => {
    if (!selectedFace || !faceTaskId || !audioUri) {
      toast.error("请完成所有步骤");
      return;
    }
    setLoading(true);
    try {
      let audioUrl = audioUri;
      if (audioUri.startsWith("data:")) {
        const base64 = audioUri.split(",")[1];
        const ext = audioUri.split(";")[0].split("/")[1] || "mp3";
        const uploaded = await uploadFile.mutateAsync({
          fileBase64: base64, fileName: `lipsync-audio.${ext}`, mimeType: `audio/${ext}`, folder: "audio",
        });
        audioUrl = uploaded.url;
      }

      await enqueueTask({
        jobType: "video",
        taskType: "lipSync",
        subType: "audio sync",
        jobInput: {
          action: "lip_sync",
          params: {
            sessionId: faceTaskId,
            faceId: selectedFace,
            audioUrl,
            soundVolume,
            originalAudioVolume: originalVolume,
            videoUrl: videoUrlForJob || undefined,
          },
        },
      });
      toast.success("Lip-Sync 任务已加入队列");
      setStep("upload");
      setVideoUri(null);
      setVideoUrlForJob(null);
      setAudioUri(null);
      setFaceTaskId(null);
      setFaces([]);
      setSelectedFace(null);
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || "Lip-Sync 提交失败");
    } finally {
      setLoading(false);
    }
  }, [selectedFace, faceTaskId, audioUri, soundVolume, originalVolume, videoUrlForJob, enqueueTask]);

  return (
    <div className="space-y-4">
      <div className="bg-pink-900/20 border border-pink-800/40 rounded-lg p-3 flex items-start space-x-2">
        <Info className="h-5 w-5 text-pink-400 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-pink-300">
          上传包含人脸的视频和音频文件，AI 会自动将音频与视频中的人脸口型同步。分三步：1) 上传视频识别人脸 → 2) 选择目标人脸 → 3) 上传音频并生成。
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center space-x-2">
        {["上传视频", "选择人脸", "配置音频"].map((label, i) => {
          const stepIdx = i === 0 ? "upload" : i === 1 ? "selectFace" : "configure";
          const isActive = step === stepIdx;
          const isDone = (step === "selectFace" && i === 0) || (step === "configure" && i <= 1);
          return (
            <React.Fragment key={i}>
              {i > 0 && <div className={`flex-1 h-0.5 ${isDone ? "bg-pink-500" : "bg-gray-700"}`} />}
              <div className={`flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-medium ${isActive ? "bg-pink-600 text-white" : isDone ? "bg-pink-900/50 text-pink-300" : "bg-gray-800 text-gray-500"}`}>
                <span>{i + 1}. {label}</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Step 1: Upload video */}
      {step === "upload" && (
        <div className="space-y-4">
          <FileUploadBox label="包含人脸的视频" accept="video/*" value={videoUri} onChange={setVideoUri} preview="video" />
          <button
            onClick={handleIdentifyFaces}
            disabled={loading || !videoUri}
            className="w-full py-2.5 bg-pink-600 text-white font-semibold rounded-lg hover:bg-pink-700 disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center justify-center space-x-2 transition-colors"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic2 className="h-5 w-5" />}
            <span>{loading ? "识别中..." : "识别人脸"}</span>
          </button>
        </div>
      )}

      {/* Step 2: Select face */}
      {step === "selectFace" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-300">检测到的人脸</span>
            <button
              onClick={handlePollFaces}
              disabled={pollLoading}
              className="flex items-center space-x-1 text-pink-400 hover:text-pink-300 text-sm"
            >
              {pollLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span>查询结果</span>
            </button>
          </div>

          {faces.length > 0 ? (
            <div className="grid grid-cols-3 gap-3">
              {faces.map((face, i) => (
                <button
                  key={face.face_id}
                  onClick={() => setSelectedFace(face.face_id)}
                  className={`p-2 rounded-lg border-2 transition-colors ${selectedFace === face.face_id ? "border-pink-500 bg-pink-900/30" : "border-gray-700 hover:border-gray-500"}`}
                >
                  {face.face_image_url ? (
                    <img src={face.face_image_url} alt={`Face ${i + 1}`} className="w-full h-20 object-cover rounded-md" />
                  ) : (
                    <div className="w-full h-20 bg-gray-800 rounded-md flex items-center justify-center text-gray-500 text-xs">
                      Face {i + 1}
                    </div>
                  )}
                  <p className="text-xs text-center mt-1 text-gray-400 truncate">{face.face_id.slice(0, 12)}...</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-gray-500">
              <p className="text-sm">点击「查询结果」获取人脸列表</p>
              <p className="text-xs mt-1">人脸识别通常需要 10-30 秒</p>
            </div>
          )}

          {faces.length > 0 && selectedFace && (
            <button
              onClick={() => setStep("configure")}
              className="w-full py-2.5 bg-pink-600 text-white font-semibold rounded-lg hover:bg-pink-700 transition-colors"
            >
              下一步：配置音频
            </button>
          )}
        </div>
      )}

      {/* Step 3: Configure audio and submit */}
      {step === "configure" && (
        <div className="space-y-4">
          <FileUploadBox label="音频文件（MP3/WAV）" accept="audio/*" value={audioUri} onChange={setAudioUri} />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">新音频音量</span>
              <div className="flex items-center space-x-2">
                <input
                  type="range" min="0" max="2" step="0.1" value={soundVolume}
                  onChange={(e) => setSoundVolume(parseFloat(e.target.value))}
                  className="w-24 accent-pink-500"
                />
                <span className="text-sm text-gray-400 w-8">{soundVolume.toFixed(1)}</span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">原始音频音量</span>
              <div className="flex items-center space-x-2">
                <input
                  type="range" min="0" max="2" step="0.1" value={originalVolume}
                  onChange={(e) => setOriginalVolume(parseFloat(e.target.value))}
                  className="w-24 accent-pink-500"
                />
                <span className="text-sm text-gray-400 w-8">{originalVolume.toFixed(1)}</span>
              </div>
            </div>
          </div>

          <div className="flex space-x-3 pt-2">
            <button onClick={() => setStep("selectFace")} className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors text-sm">
              返回
            </button>
            <button
              onClick={handleCreateLipSync}
              disabled={loading || !audioUri}
              className="flex-1 py-2.5 bg-pink-600 text-white font-semibold rounded-lg hover:bg-pink-700 disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center justify-center space-x-2 transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] hover:shadow-lg hover:shadow-pink-600/30 ripple-effect"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
              <span>{loading ? "提交中..." : "生成 Lip-Sync"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Elements Panel (Character Library)
// ═══════════════════════════════════════════════════════

function ElementsPanel() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [elementName, setElementName] = useState("");
  const [createType, setCreateType] = useState<"image" | "video">("image");
  const [loading, setLoading] = useState(false);

  const createImageElement = trpc.kling.elements.createImage.useMutation();
  const createVideoElement = trpc.kling.elements.createVideo.useMutation();
  const uploadFile = trpc.kling.uploadFile.useMutation();
  const listElements = trpc.kling.elements.list.useQuery({ pageNum: 1, pageSize: 30 });
  const deleteElement = trpc.kling.elements.delete.useMutation();

  const handleCreate = useCallback(async () => {
    setLoading(true);
    try {
      if (createType === "image") {
        if (!imageUri) {
          toast.error("请上传角色图片");
          setLoading(false);
          return;
        }
        let imageUrl = imageUri;
        if (imageUri.startsWith("data:")) {
          const base64 = imageUri.split(",")[1];
          const ext = imageUri.split(";")[0].split("/")[1] || "png";
          const uploaded = await uploadFile.mutateAsync({
            fileBase64: base64, fileName: `elem-img.${ext}`, mimeType: `image/${ext}`, folder: "images",
          });
          imageUrl = uploaded.url;
        }
        const result = await createImageElement.mutateAsync({
          imageUrls: [imageUrl],
          name: elementName.trim() || undefined,
        });
        if (result.success) {
          toast.success(`角色元素已创建 (ID: ${result.elementId})`);
          listElements.refetch();
          setImageUri(null);
          setElementName("");
        }
      } else {
        if (!videoUri) {
          toast.error("请上传角色视频");
          setLoading(false);
          return;
        }
        let videoUrl = videoUri;
        if (videoUri.startsWith("data:")) {
          const base64 = videoUri.split(",")[1];
          const ext = videoUri.split(";")[0].split("/")[1] || "mp4";
          const uploaded = await uploadFile.mutateAsync({
            fileBase64: base64, fileName: `elem-vid.${ext}`, mimeType: `video/${ext}`, folder: "videos",
          });
          videoUrl = uploaded.url;
        }
        const result = await createVideoElement.mutateAsync({
          videoUrl,
          name: elementName.trim() || undefined,
        });
        if (result.success) {
          toast.success(`角色元素已创建 (ID: ${result.elementId})`);
          listElements.refetch();
          setVideoUri(null);
          setElementName("");
        }
      }
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || "创建角色元素失败");
    } finally {
      setLoading(false);
    }
  }, [createType, imageUri, videoUri, elementName]);

  const handleDelete = useCallback(async (elementId: number) => {
    if (!confirm("确定要删除此角色元素吗？")) return;
    try {
      await deleteElement.mutateAsync({ elementId });
      toast.success("角色元素已删除");
      listElements.refetch();
    } catch (error: any) {
      toast.error(error?.message || "删除失败");
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-emerald-900/20 border border-emerald-800/40 rounded-lg p-3 flex items-start space-x-2">
        <Info className="h-5 w-5 text-emerald-400 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-emerald-300">
          创建角色元素后，可在 Omni Video 的分镜叙事和 All-in-One 模式中引用，确保多个视频中角色外观一致。
        </p>
      </div>

      {/* Create new element */}
      <div className="bg-gray-800/50 p-4 rounded-lg space-y-3">
        <h3 className="text-sm font-semibold text-white">创建新角色元素</h3>

        <div className="flex items-center space-x-2 rounded-lg bg-gray-800 p-1">
          <button onClick={() => setCreateType("image")} className={`flex-1 flex items-center justify-center space-x-1.5 py-1.5 text-sm rounded-md transition-colors ${createType === "image" ? "bg-emerald-600 text-white" : "text-gray-400 hover:text-white"}`}>
            <ImageIcon className="h-4 w-4" />
            <span>图片角色</span>
          </button>
          <button onClick={() => setCreateType("video")} className={`flex-1 flex items-center justify-center space-x-1.5 py-1.5 text-sm rounded-md transition-colors ${createType === "video" ? "bg-emerald-600 text-white" : "text-gray-400 hover:text-white"}`}>
            <Video className="h-4 w-4" />
            <span>视频角色（含声音）</span>
          </button>
        </div>

        {createType === "image" ? (
          <FileUploadBox label="角色图片" accept="image/*" value={imageUri} onChange={setImageUri} preview="image" />
        ) : (
          <FileUploadBox label="角色视频" accept="video/*" value={videoUri} onChange={setVideoUri} preview="video" />
        )}

        <div className="space-y-1">
          <span className="text-sm text-gray-300">角色名称（可选）</span>
          <input
            value={elementName}
            onChange={(e) => setElementName(e.target.value)}
            placeholder="如：主角、配角A..."
            className="w-full p-2 bg-gray-800 rounded-md text-white placeholder-gray-500 border border-gray-700 text-sm"
          />
        </div>

        <button
          onClick={handleCreate}
          disabled={loading}
          className="w-full py-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center justify-center space-x-2 transition-all duration-300 hover:scale-[1.03] active:scale-[0.97] hover:shadow-lg hover:shadow-emerald-600/30 ripple-effect text-sm"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          <span>{loading ? "创建中..." : "创建角色元素"}</span>
        </button>
      </div>

      {/* Element list */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">已有角色元素</h3>
          <button onClick={() => listElements.refetch()} className="text-emerald-400 hover:text-emerald-300 text-xs flex items-center space-x-1">
            <RefreshCw className="h-3 w-3" />
            <span>刷新</span>
          </button>
        </div>

        {listElements.isLoading ? (
          <div className="text-center py-6 text-gray-500">
            <Loader2 className="h-6 w-6 animate-spin mx-auto" />
            <p className="text-sm mt-2">加载中...</p>
          </div>
        ) : listElements.data && Array.isArray(listElements.data) && listElements.data.length > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            {(listElements.data as any[]).map((elem: any) => (
              <div key={elem.element_id || elem.id} className="bg-gray-800 p-3 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white truncate">{elem.name || `Element #${elem.element_id || elem.id}`}</span>
                  <button onClick={() => handleDelete(elem.element_id || elem.id)} className="text-gray-500 hover:text-red-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="text-xs text-gray-500">ID: {elem.element_id || elem.id}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-gray-500">
            <Layers className="h-8 w-8 mx-auto opacity-50" />
            <p className="text-sm mt-2">暂无角色元素</p>
            <p className="text-xs mt-1">创建角色元素后可在视频生成中引用</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Image Generation Panel (Kling AI)
// ═══════════════════════════════════════════════════════

function ImageGenPanel({ enqueueTask }: { enqueueTask: (input: { jobType: JobType; taskType: KlingTab; subType?: string; jobInput: Record<string, unknown> }) => Promise<void> }) {
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [model, setModel] = useState<"kling-image-o1" | "kling-v2-1" | "nano-banana">("kling-image-o1");
  const [resolution, setResolution] = useState<"1k" | "2k" | "4k">("1k");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("1:1");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [imageFidelity, setImageFidelity] = useState(0.5);
  const [count, setCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const uploadFile = trpc.kling.uploadFile.useMutation();

  // Credit costs
  const creditCost = useMemo(() => {
    if (model === "nano-banana") return resolution === "4k" ? 18 : 12;
    if (model === "kling-image-o1") return resolution === "2k" ? 10 : 8;
    return resolution === "2k" ? 7 : 5;
  }, [model, resolution]);

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim()) {
      toast.error("請輸入圖片描述");
      return;
    }
    setLoading(true);
    try {
      let refUrl: string | undefined;
      if (referenceImage?.startsWith("data:")) {
        const base64 = referenceImage.split(",")[1];
        const ext = referenceImage.split(";")[0].split("/")[1] || "png";
        const uploaded = await uploadFile.mutateAsync({
          fileBase64: base64, fileName: `img-ref.${ext}`, mimeType: `image/${ext}`, folder: "images",
        });
        refUrl = uploaded.url;
      } else if (referenceImage) {
        refUrl = referenceImage;
      }

      if (model === "nano-banana") {
        await enqueueTask({
          jobType: "image",
          taskType: "imageGen",
          subType: `nano ${resolution === "4k" ? "4k" : "2k"}`,
          jobInput: {
            action: "nano_image",
            params: {
              prompt: prompt.trim(),
              quality: resolution === "4k" ? "4k" : "2k",
              referenceImageUrl: refUrl,
            },
          },
        });
      } else {
        await enqueueTask({
          jobType: "image",
          taskType: "imageGen",
          subType: `${model} ${resolution}`,
          jobInput: {
            action: "kling_image",
            params: {
              prompt: prompt.trim(),
              negativePrompt: negativePrompt.trim() || undefined,
              model,
              resolution,
              aspectRatio,
              referenceImageUrl: refUrl,
              imageFidelity: refUrl ? imageFidelity : undefined,
              count,
            },
          },
        });
      }
      toast.success("圖片生成任務已加入隊列");
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || "發生錯誤");
    } finally {
      setLoading(false);
    }
  }, [prompt, negativePrompt, model, resolution, aspectRatio, referenceImage, imageFidelity, count, enqueueTask]);

  return (
    <div className="space-y-4">
      <div className="bg-amber-900/20 border border-amber-800/40 rounded-lg p-3 flex items-start space-x-2">
        <Info className="h-5 w-5 text-amber-400 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-amber-300">
          Kling AI 圖片生成：O1 模型質量更高（8 Credits/張），V2.1 模型速度更快（5 Credits/張）。支持 1K 和 2K 解析度。
        </p>
      </div>

      {/* Model selector */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">模型選擇</span>
        <div className="flex items-center space-x-2 rounded-lg bg-gray-800 p-1">
          <button onClick={() => setModel("kling-image-o1")} className={`px-3 py-1 text-sm rounded-md transition-colors ${model === "kling-image-o1" ? "bg-amber-600 text-white" : "text-gray-300 hover:text-white"}`}>O1 高質量</button>
          <button onClick={() => setModel("kling-v2-1")} className={`px-3 py-1 text-sm rounded-md transition-colors ${model === "kling-v2-1" ? "bg-amber-600 text-white" : "text-gray-300 hover:text-white"}`}>V2.1 快速</button>
          <button
            onClick={() => {
              setModel("nano-banana");
              if (resolution === "1k") setResolution("2k");
            }}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${model === "nano-banana" ? "bg-amber-600 text-white" : "text-gray-300 hover:text-white"}`}
          >
            Nano
          </button>
        </div>
      </div>

      {/* Resolution */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">解析度</span>
        <div className="flex items-center space-x-2 rounded-lg bg-gray-800 p-1">
          {model !== "nano-banana" && (
            <button onClick={() => setResolution("1k")} className={`px-3 py-1 text-sm rounded-md transition-colors ${resolution === "1k" ? "bg-amber-600 text-white" : "text-gray-300 hover:text-white"}`}>1K 標準</button>
          )}
          <button onClick={() => setResolution("2k")} className={`px-3 py-1 text-sm rounded-md transition-colors ${resolution === "2k" ? "bg-amber-600 text-white" : "text-gray-300 hover:text-white"}`}>2K 高清</button>
          {model === "nano-banana" && (
            <button onClick={() => setResolution("4k")} className={`px-3 py-1 text-sm rounded-md transition-colors ${resolution === "4k" ? "bg-amber-600 text-white" : "text-gray-300 hover:text-white"}`}>4K 超清</button>
          )}
        </div>
      </div>

      {/* Prompt */}
      <div className="space-y-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述你想生成的圖片..."
          className="w-full p-3 bg-gray-800 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-amber-500 border border-gray-700 resize-none"
          rows={4}
        />
      </div>

      {model !== "nano-banana" && <AspectRatioSelector ratio={aspectRatio} onRatioChange={setAspectRatio} />}

      {/* Count */}
      {model !== "nano-banana" && (
        <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">生成數量</span>
        <div className="flex items-center space-x-2 rounded-lg bg-gray-800 p-1">
          {[1, 2, 3, 4].map((n) => (
            <button key={n} onClick={() => setCount(n)} className={`px-3 py-1 text-sm rounded-md transition-colors ${count === n ? "bg-amber-600 text-white" : "text-gray-300 hover:text-white"}`}>{n}</button>
          ))}
        </div>
        </div>
      )}

      {/* Reference image */}
      <button onClick={() => setShowAdvanced(!showAdvanced)} className="flex items-center space-x-1 text-xs text-gray-400 hover:text-gray-300">
        <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
        <span>高級選項（參考圖、負面提示詞）</span>
      </button>
      {showAdvanced && (
        <div className="space-y-3 bg-gray-800/30 p-3 rounded-lg">
          <FileUploadBox label="參考圖片（可選）" accept="image/*" value={referenceImage} onChange={setReferenceImage} preview="image" />
          {referenceImage && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">參考圖影響度</span>
              <div className="flex items-center space-x-2">
                <input type="range" min="0" max="1" step="0.05" value={imageFidelity} onChange={(e) => setImageFidelity(parseFloat(e.target.value))} className="w-24 accent-amber-500" />
                <span className="text-sm text-gray-400 w-8">{imageFidelity.toFixed(2)}</span>
              </div>
            </div>
          )}
          <textarea
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            placeholder="負面提示詞（不希望出現的內容）..."
            className="w-full p-3 bg-gray-800 rounded-lg text-white placeholder-gray-500 border border-gray-700 resize-none text-sm"
            rows={2}
          />
        </div>
      )}

      {/* Submit */}
      <div className="flex justify-between items-center pt-4 border-t border-gray-700">
        <div className="flex items-center space-x-1 bg-gray-800 text-yellow-400 px-2 py-1 rounded-full text-xs">
          <Coins className="h-3.5 w-3.5" />
          <span>{creditCost * (model === "nano-banana" ? 1 : count)} Credits</span>
          <span className="text-gray-400">({model === "nano-banana" ? 1 : count}張 x {creditCost})</span>
        </div>
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="px-6 py-2.5 bg-amber-600 text-white font-semibold rounded-lg hover:bg-amber-700 disabled:bg-gray-600 disabled:cursor-not-allowed flex items-center space-x-2 transition-colors"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageIcon className="h-5 w-5" />}
          <span>{loading ? "生成中..." : "生成圖片"}</span>
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Main Page Component
// ═══════════════════════════════════════════════════════

export default function RemixStudioPage() {
  const [activeTab, setActiveTab] = useState<KlingTab>("omniVideo");
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const { user } = useAuth();

  const enqueueTask = useCallback(
    async (payload: {
      jobType: JobType;
      taskType: KlingTab;
      subType?: string;
      jobInput: Record<string, unknown>;
    }) => {
      if (!user?.id) {
        throw new Error("请先登录");
      }

      const { jobId } = await createJob({
        type: payload.jobType,
        userId: String(user.id),
        input: payload.jobInput,
      });

      setTasks((prev) => [
        {
          taskId: jobId,
          jobType: payload.jobType,
          jobInput: payload.jobInput,
          type: payload.taskType,
          subType: payload.subType,
          status: "queued",
          createdAt: Date.now(),
        },
        ...prev,
      ]);
    },
    [user?.id]
  );

  const pollTaskStatus = useCallback(async (taskId: string) => {
    try {
      const data = await getJob(taskId);

      setTasks((prev) => {
        const current = prev.find((task) => task.taskId === taskId);
        if (!current) return prev;

        if (current.status !== data.status) {
          if (data.status === "succeeded") {
            toast.success("任务完成！");
          } else if (data.status === "failed") {
            toast.error("任务失败，请点击重试。");
          }
        }

        return prev.map((task) =>
          task.taskId === taskId
            ? {
                ...task,
                status: data.status,
                output: data.output || task.output,
                error: data.status === "failed" ? "这次生成没有成功，请点击重试。" : task.error,
              }
            : task
        );
      });
    } catch (error) {
      console.error(`Failed to poll task ${taskId}`, error);
    }
  }, []);

  // Auto-poll active tasks
  useEffect(() => {
    const activeTasks = tasks.filter((t) => t.status === "queued" || t.status === "running");
    if (activeTasks.length === 0) return;

    const interval = setInterval(() => {
      activeTasks.forEach((task) => {
        pollTaskStatus(task.taskId);
      });
    }, 1800);

    return () => clearInterval(interval);
  }, [tasks, pollTaskStatus]);

  const handleRetryTask = useCallback(
    async (task: TaskInfo) => {
      try {
        await enqueueTask({
          jobType: task.jobType,
          taskType: task.type,
          subType: task.subType,
          jobInput: task.jobInput,
        });
      } catch (error: any) {
        toast.error(error?.message || "重试失败");
      }
    },
    [enqueueTask]
  );

  const renderPanel = () => {
    switch (activeTab) {
      case "omniVideo":
        return <OmniVideoPanel enqueueTask={enqueueTask} />;
      case "motionControl":
        return <MotionControlPanel enqueueTask={enqueueTask} />;
      case "lipSync":
        return <LipSyncPanel enqueueTask={enqueueTask} />;
      case "elements":
        return <ElementsPanel />;
      case "imageGen":
        return <ImageGenPanel enqueueTask={enqueueTask} />;
      case "history":
        return <CreationHistoryPanel title="可靈工作室生成記錄" />;
      default:
        return null;
    }
  };

  const activeTabInfo = TABS.find((t) => t.id === activeTab);

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF] page-enter">
      <div className="ambient-glow" />
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
            可灵工作室
          </h1>
          <p className="text-gray-400 mt-1">Kling AI — 視頻生成 · 動作遷移 · 口型同步 · 圖片生成 · 角色元素</p>
        </div>

        {/* Expiry Warning */}
        <ExpiryWarningBanner />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Panel: Controls */}
          <div className="lg:col-span-2 glass-card p-6">
            {/* Tab navigation */}
            <div className="flex items-center space-x-1 mb-6 overflow-x-auto pb-2">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 px-4 py-2.5 rounded-lg whitespace-nowrap transition-all ${
                    activeTab === tab.id
                      ? "bg-white/10 text-white shadow-md backdrop-blur-sm"
                      : "text-gray-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <tab.icon className="h-5 w-5" style={{ color: activeTab === tab.id ? tab.color : undefined }} />
                  <span className="font-medium text-sm">{tab.label}</span>
                </button>
              ))}
            </div>

            {/* Tab description */}
            {activeTabInfo && (
              <p className="text-sm text-gray-500 mb-4 pb-4 border-b border-gray-800">{activeTabInfo.desc}</p>
            )}

            {/* Panel content */}
            {renderPanel()}
          </div>

          {/* Right Panel: Task Queue */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">任务队列</h2>
              {tasks.length > 0 && (
                <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">{tasks.length} 个任务</span>
              )}
            </div>
            <div className="space-y-3 overflow-y-auto max-h-[75vh]">
              {tasks.length > 0 ? (
                tasks.map((task) => (
                  <TaskStatusCard
                    key={task.taskId}
                    task={task}
                    onPoll={() => pollTaskStatus(task.taskId)}
                    onRetry={() => handleRetryTask(task)}
                  />
                ))
              ) : (
                <div className="text-center py-16 text-gray-600">
                  <Video className="h-12 w-12 mx-auto opacity-30" />
                  <p className="mt-3 font-medium">暂无任务</p>
                  <p className="text-sm mt-1">生成的视频任务将显示在这里</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
