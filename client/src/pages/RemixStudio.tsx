// @ts-nocheck

import React, { useState, useCallback, useRef, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Sparkles, Footprints, Mic2, Layers, Coins, RefreshCw, CheckCircle, Download, Upload, Loader2 } from "lucide-react";

// ─── Types ──────────────────────────────────────────

type KlingTab = "omniVideo" | "motionControl" | "lipSync" | "elements";
type KlingMode = "std" | "pro";
type AspectRatio = "16:9" | "9:16" | "1:1";
type Duration = "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "15";

interface TaskInfo {
  taskId: string;
  type: KlingTab;
  status: "submitted" | "processing" | "succeed" | "failed";
  createdAt: number;
  videoUrl?: string;
  error?: string;
}

// ─── Tab Config ─────────────────────────────────────

const TABS: Array<{ id: KlingTab; label: string; icon: React.ElementType; color: string; desc: string }> = [
  { id: "omniVideo", label: "Omni Video", icon: Sparkles, color: "#A855F7", desc: "3.0 文生视频 / 图生视频 / 分镜叙事" },
  { id: "motionControl", label: "Motion Control", icon: Footprints, color: "#3B82F6", desc: "2.6 动作迁移：图片 + 动作视频 → 动画" },
  { id: "lipSync", label: "Lip-Sync", icon: Mic2, color: "#EC4899", desc: "对口型：视频 + 音频 → 口型同步" },
  { id: "elements", label: "Elements", icon: Layers, color: "#10B981", desc: "角色元素库：保持角色一致性" },
];

// ─── Cost Display ───────────────────────────────────

function CostBadge({ mode, duration, type, hasVideo = false, hasAudio = false }: {
  mode: KlingMode; duration: number; type: string; hasVideo?: boolean; hasAudio?: boolean;
}) {
  let units = 0;
  let usd = 0;

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
  usd = units * 0.098; // Trial pack rate

  return (
    <div className="flex items-center space-x-1 bg-gray-800 text-yellow-400 px-2 py-1 rounded-full text-xs">
      <Coins className="h-3.5 w-3.5" />
      <span>{units.toFixed(1)} units</span>
      <span className="text-gray-400">(~${usd.toFixed(2)})</span>
    </div>
  );
}

// ─── Mode Selector ──────────────────────────────────

function ModeSelector({ mode, onModeChange }: { mode: KlingMode; onModeChange: (m: KlingMode) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm font-medium text-gray-300">品质模式</span>
      <div className="flex items-center space-x-2 rounded-lg bg-gray-800 p-1">
        <button
          onClick={() => onModeChange("std")}
          className={`px-3 py-1 text-sm rounded-md ${mode === "std" ? "bg-purple-600 text-white" : "text-gray-300"}`}>
          Standard 720p
        </button>
        <button
          onClick={() => onModeChange("pro")}
          className={`px-3 py-1 text-sm rounded-md ${mode === "pro" ? "bg-purple-600 text-white" : "text-gray-300"}`}>
          Pro 1080p
        </button>
      </div>
    </div>
  );
}

// ─── Duration Selector ──────────────────────────────

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
          <button
            key={d}
            onClick={() => onDurationChange(d)}
            className={`px-3 py-1 text-sm rounded-md ${duration === d ? "bg-purple-600 text-white" : "text-gray-300"}`}>
            {d}s
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Aspect Ratio Selector ──────────────────────────

function AspectRatioSelector({ ratio, onRatioChange }: {
  ratio: AspectRatio; onRatioChange: (r: AspectRatio) => void;
}) {
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
          <button
            key={o.value}
            onClick={() => onRatioChange(o.value)}
            className={`px-3 py-1 text-sm rounded-md ${ratio === o.value ? "bg-purple-600 text-white" : "text-gray-300"}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Task Status Card ───────────────────────────────

function TaskStatusCard({ task, onPoll }: { task: TaskInfo; onPoll: () => void }) {
  const statusColors: Record<string, string> = {
    submitted: "text-yellow-400",
    processing: "text-blue-500",
    succeed: "text-green-500",
    failed: "text-red-500",
  };
  const statusLabels: Record<string, string> = {
    submitted: "已提交",
    processing: "生成中...",
    succeed: "完成",
    failed: "失败",
  };

  return (
    <div className="bg-gray-800 p-4 rounded-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className={`h-2.5 w-2.5 rounded-full ${statusColors[task.status].replace('text-', 'bg-')}`} />
          <span className="font-semibold text-white">{task.type === "omniVideo" ? "Omni Video" : task.type === "motionControl" ? "Motion Control" : "Lip-Sync"}</span>
          <span className={`font-medium ${statusColors[task.status]}`}>{statusLabels[task.status]}</span>
        </div>
        {(task.status === "processing" || task.status === "submitted") && (
          <button onClick={onPoll} className="flex items-center space-x-1 text-purple-400 hover:text-purple-300">
            <RefreshCw className="h-4 w-4" />
            <span className="text-sm">刷新状态</span>
          </button>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-2">Task: {task.taskId.slice(0, 16)}...</p>
      {task.status === "succeed" && task.videoUrl && (
        <div className="mt-3 flex items-center justify-between bg-gray-700 p-2 rounded-md">
            <div className="flex items-center space-x-2">
                <CheckCircle className="h-5 w-5 text-green-500" />
                <span className="text-sm text-gray-200">视频已生成</span>
            </div>
            <a href={task.videoUrl} target="_blank" rel="noopener noreferrer" className="flex items-center space-x-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm hover:bg-blue-700">
                <Download className="h-4 w-4" />
                <span>下载</span>
            </a>
        </div>
      )}
      {task.status === "failed" && task.error && (
        <p className="mt-2 text-sm text-red-400 bg-red-900/50 p-2 rounded-md">{task.error}</p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// Omni Video Panel
// ═══════════════════════════════════════════════════════

function OmniVideoPanel({ onTaskCreated }: { onTaskCreated: (task: TaskInfo) => void }) {
  const [subTab, setSubTab] = useState<"t2v" | "i2v" | "storyboard">("t2v");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [mode, setMode] = useState<KlingMode>("std");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("16:9");
  const [duration, setDuration] = useState<Duration>("5");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Storyboard shots
  const [shots, setShots] = useState<Array<{ prompt: string; duration: string }>>([
    { prompt: "", duration: "5" },
    { prompt: "", duration: "5" },
  ]);

  const createT2V = trpc.kling.omniVideo.createT2V.useMutation();
  const createI2V = trpc.kling.omniVideo.createI2V.useMutation();
  const createStoryboard = trpc.kling.omniVideo.createStoryboard.useMutation();

  const handlePickImage = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImageUri(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() && subTab !== "storyboard") {
      toast.error("请输入描述文本");
      return;
    }
    setLoading(true);
    try {
      let result: { success: boolean; taskId: string };

      if (subTab === "t2v") {
        result = await createT2V.mutateAsync({
          prompt: prompt.trim(),
          negativePrompt: negativePrompt.trim() || undefined,
          mode,
          aspectRatio,
          duration,
        });
      } else if (subTab === "i2v") {
        if (!imageUri) {
          toast.error("请选择一张参考图片");
          setLoading(false);
          return;
        }
        result = await createI2V.mutateAsync({
          prompt: prompt.trim(),
          imageUrl: imageUri,
          mode,
          aspectRatio,
          duration,
        });
      } else {
        const validShots = shots.filter((s) => s.prompt.trim());
        if (validShots.length < 1) {
          toast.error("请至少填写一个分镜描述");
          setLoading(false);
          return;
        }
        result = await createStoryboard.mutateAsync({
          shots: validShots,
          mode,
          aspectRatio,
        });
      }

      if (result.success) {
        onTaskCreated({ taskId: result.taskId, type: "omniVideo", status: "submitted", createdAt: Date.now() });
        toast.success("任务已提交");
      } else {
        toast.error("任务提交失败");
      }
    } catch (error) {
      console.error(error);
      toast.error("发生错误，请稍后再试");
    } finally {
      setLoading(false);
    }
  }, [prompt, negativePrompt, mode, aspectRatio, duration, imageUri, subTab, shots, createT2V, createI2V, createStoryboard, onTaskCreated]);

  return (
    <div className="space-y-4">
      <div className="flex space-x-2 border-b border-gray-700">
        <button onClick={() => setSubTab("t2v")} className={`py-2 px-4 text-sm ${subTab === 't2v' ? 'border-b-2 border-purple-500 text-white' : 'text-gray-400'}`}>文生视频</button>
        <button onClick={() => setSubTab("i2v")} className={`py-2 px-4 text-sm ${subTab === 'i2v' ? 'border-b-2 border-purple-500 text-white' : 'text-gray-400'}`}>图生视频</button>
        <button onClick={() => setSubTab("storyboard")} className={`py-2 px-4 text-sm ${subTab === 'storyboard' ? 'border-b-2 border-purple-500 text-white' : 'text-gray-400'}`}>分镜叙事</button>
      </div>

      {subTab !== 'storyboard' && (
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="输入你的视频创意描述..."
          className="w-full p-3 bg-gray-800 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-purple-500 border border-gray-700"
          rows={4}
        />
      )}

      {subTab === 'i2v' && (
        <div className="space-y-2">
            <span className="text-sm font-medium text-gray-300">参考图片</span>
            <div onClick={handlePickImage} className="w-full h-40 border-2 border-dashed border-gray-600 rounded-lg flex items-center justify-center cursor-pointer hover:border-purple-500">
                {imageUri ? (
                    <img src={imageUri} alt="Preview" className="h-full w-full object-contain rounded-lg" />
                ) : (
                    <div className="text-center text-gray-400">
                        <Upload className="mx-auto h-8 w-8" />
                        <p>点击上传图片</p>
                    </div>
                )}
            </div>
            <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
        </div>
      )}

      <ModeSelector mode={mode} onModeChange={setMode} />
      <AspectRatioSelector ratio={aspectRatio} onRatioChange={setAspectRatio} />
      <DurationSelector duration={duration} onDurationChange={setDuration} />

      <div className="flex justify-end items-center space-x-4 pt-4">
        <CostBadge mode={mode} duration={parseInt(duration)} type="omniVideo" hasVideo={subTab === 'i2v'} />
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="px-6 py-2.5 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : '生成视频'}
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
  const getTaskStatus = trpc.kling.getTaskStatus.useMutation();

  const handleCreateTask = (task: TaskInfo) => {
    setTasks(prev => [task, ...prev]);
  };

  const pollTaskStatus = useCallback(async (taskId: string) => {
    try {
      const result = await getTaskStatus.mutateAsync({ taskId });
      if (result) {
        setTasks(prev => prev.map(t => t.taskId === taskId ? { ...t, status: result.status, videoUrl: result.videoUrl, error: result.error } : t));
        if (result.status === 'succeed' || result.status === 'failed') {
          toast.info(`任务 ${taskId.slice(0,8)}... ${result.status === 'succeed' ? '已完成' : '失败'}`);
        }
      }
    } catch (error) {
      console.error(`Failed to poll task ${taskId}`, error);
      toast.error("刷新任务状态失败");
    }
  }, [getTaskStatus]);

  useEffect(() => {
    const interval = setInterval(() => {
      tasks.forEach(task => {
        if (task.status === 'submitted' || task.status === 'processing') {
          pollTaskStatus(task.taskId);
        }
      });
    }, 15000); // Poll every 15 seconds

    return () => clearInterval(interval);
  }, [tasks, pollTaskStatus]);

  const renderPanel = () => {
    switch (activeTab) {
      case "omniVideo":
        return <OmniVideoPanel onTaskCreated={handleCreateTask} />;
      // case "motionControl":
      //   return <MotionControlPanel onTaskCreated={handleCreateTask} />;
      // case "lipSync":
      //   return <LipSyncPanel onTaskCreated={handleCreateTask} />;
      default:
        return <div className="text-center py-10 text-gray-400">此功能正在开发中...</div>;
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Left Panel: Controls */}
          <div className="md:col-span-2 bg-[#1A1A1C] p-6 rounded-2xl shadow-lg">
            <div className="flex items-center space-x-6 border-b border-gray-700 mb-6">
              {TABS.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center space-x-2 pb-3 border-b-2 ${activeTab === tab.id ? 'border-purple-500 text-white' : 'border- text-gray-400 hover:text-white'}`}>
                  <tab.icon className="h-5 w-5" style={{ color: tab.color }} />
                  <span className="font-medium">{tab.label}</span>
                </button>
              ))}
            </div>
            {renderPanel()}
          </div>

          {/* Right Panel: Task List */}
          <div className="bg-[#1A1A1C] p-6 rounded-2xl shadow-lg">
            <h2 className="text-xl font-bold mb-4">任务队列</h2>
            <div className="space-y-4 overflow-y-auto max-h-[80vh]">
              {tasks.length > 0 ? (
                tasks.map(task => (
                  <TaskStatusCard key={task.taskId} task={task} onPoll={() => pollTaskStatus(task.taskId)} />
                ))
              ) : (
                <div className="text-center py-10 text-gray-500">
                  <p>暂无任务</p>
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
