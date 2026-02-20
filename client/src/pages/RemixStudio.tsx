import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState, useRef, useCallback } from "react";
import {
  Upload, Loader2, Scissors, Check, Shield, Film,
  Sparkles, Play, Pause, RotateCcw, Volume2, VolumeX,
  Hash, ArrowRight, CheckCircle2, AlertCircle,
} from "lucide-react";

export default function RemixStudio() {
  const { isAuthenticated } = useAuth();

  // Upload state
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Edit state
  const [editDescription, setEditDescription] = useState("");
  const [trimStart, setTrimStart] = useState("");
  const [trimEnd, setTrimEnd] = useState("");

  // Remix hash state
  const [registering, setRegistering] = useState(false);
  const [remixHash, setRemixHash] = useState("");
  const [hashRegistered, setHashRegistered] = useState(false);

  // Video player state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Verification state
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<any>(null);

  const registerRemixMutation = trpc.mvAnalysis.registerRemix.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setRemixHash(data.signatureHash);
        setHashRegistered(true);
        toast.success("Remix Hash 注册成功！此视频已获得平台认证，可参加 PK 评分获得奖励");
      }
      setRegistering(false);
    },
    onError: (err) => {
      toast.error(err.message || "Hash 注册失败");
      setRegistering(false);
    },
  });

  // Upload video
  const handleFileSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith("video/")) {
      toast.error("请上传视频文件（MP4/MOV/AVI/WebM）");
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      toast.error("视频文件不能超过 500MB");
      return;
    }

    setVideoFile(file);
    setUploading(true);
    setUploadProgress(0);
    setHashRegistered(false);
    setRemixHash("");
    setVerificationResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      // Simulate progress
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 10, 90));
      }, 300);

      const resp = await fetch("/api/upload", { method: "POST", body: formData });
      clearInterval(progressInterval);

      if (!resp.ok) throw new Error("Upload failed");
      const data = await resp.json();
      setVideoUrl(data.url);
      setUploadProgress(100);
      toast.success("视频上传成功！");
    } catch {
      toast.error("上传失败，请重试");
      setVideoFile(null);
    } finally {
      setUploading(false);
    }
  }, []);

  // Register remix hash
  const handleRegisterRemix = () => {
    if (!videoUrl) {
      toast.error("请先上传视频");
      return;
    }
    setRegistering(true);
    registerRemixMutation.mutate({ videoUrl });
  };

  // Video player controls
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (playing) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setPlaying(!playing);
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // Reset
  const handleReset = () => {
    setVideoFile(null);
    setVideoUrl("");
    setUploadProgress(0);
    setEditDescription("");
    setTrimStart("");
    setTrimEnd("");
    setRemixHash("");
    setHashRegistered(false);
    setVerificationResult(null);
    setPlaying(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="pt-32 text-center container">
          <Scissors className="h-16 w-16 text-primary mx-auto mb-6" />
          <h1 className="text-3xl font-bold mb-4">二次创作工坊</h1>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
            上传外来视频进行编辑，自动注册 Remix Hash 获得平台认证，参加 PK 评分赢取 Credits 奖励
          </p>
          <Button size="lg" className="bg-primary text-primary-foreground" onClick={() => { window.location.href = getLoginUrl(); }}>
            登录后使用
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <div className="pt-24 pb-16 container max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
              <Scissors className="h-5 w-5 text-cyan-400" />
            </div>
            <h1 className="text-3xl font-bold">二次创作工坊</h1>
          </div>
          <p className="text-muted-foreground">上传外来视频 → 编辑描述 → 自动注册 Remix Hash → 参加 PK 评分赢 Credits</p>
        </div>

        {/* Workflow Steps */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-8">
          {[
            { step: 1, label: "上传视频", icon: Upload, done: !!videoUrl, active: !videoUrl },
            { step: 2, label: "编辑描述", icon: Sparkles, done: !!editDescription.trim(), active: !!videoUrl && !editDescription.trim() },
            { step: 3, label: "注册 Hash", icon: Hash, done: hashRegistered, active: !!videoUrl && !!editDescription.trim() && !hashRegistered },
            { step: 4, label: "参加 PK", icon: Shield, done: false, active: hashRegistered },
          ].map(({ step, label, icon: Icon, done, active }) => (
            <div
              key={step}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                done ? "bg-green-500/10 border-green-500/30" :
                active ? "bg-primary/10 border-primary/30" :
                "bg-card/30 border-border/30"
              }`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                done ? "bg-green-500 text-white" :
                active ? "bg-primary text-primary-foreground" :
                "bg-muted text-muted-foreground"
              }`}>
                {done ? <Check className="h-4 w-4" /> : step}
              </div>
              <div>
                <div className={`text-sm font-medium ${done ? "text-green-400" : active ? "text-primary" : "text-muted-foreground"}`}>
                  {label}
                </div>
              </div>
              <Icon className={`h-4 w-4 ml-auto ${done ? "text-green-400" : active ? "text-primary" : "text-muted-foreground/50"}`} />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Left: Upload & Edit */}
          <div className="lg:col-span-2 space-y-4">
            {/* Upload Area */}
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-6 space-y-4">
                <h3 className="font-medium flex items-center gap-2">
                  <Upload className="h-4 w-4 text-primary" /> 上传视频
                </h3>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-msvideo,video/webm,video/avi"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
                />

                {!videoUrl ? (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="w-full border-2 border-dashed border-border/50 rounded-lg p-10 text-center hover:border-primary/50 transition-colors"
                  >
                    {uploading ? (
                      <div className="space-y-3">
                        <Loader2 className="h-10 w-10 text-primary mx-auto animate-spin" />
                        <p className="text-sm text-muted-foreground">上传中... {uploadProgress}%</p>
                        <div className="w-full bg-muted rounded-full h-1.5">
                          <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} />
                        </div>
                      </div>
                    ) : (
                      <>
                        <Film className="h-10 w-10 text-muted-foreground/50 mx-auto" />
                        <p className="text-sm text-muted-foreground mt-3">点击上传视频文件</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">支持 MP4/MOV/AVI/WebM，最大 500MB</p>
                      </>
                    )}
                  </button>
                ) : (
                  <div className="flex items-center justify-between p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-400" />
                      <span className="text-sm text-green-400 truncate max-w-[200px]">{videoFile?.name || "已上传"}</span>
                    </div>
                    <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={handleReset}>
                      <RotateCcw className="h-3 w-3 mr-1" /> 更换
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Edit Description */}
            {videoUrl && (
              <Card className="bg-card/50 border-border/50">
                <CardContent className="p-6 space-y-4">
                  <h3 className="font-medium flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" /> 编辑描述
                  </h3>
                  <Textarea
                    placeholder="描述你对这个视频做了哪些二次创作...\n\n例如：添加了字幕、调整了色调、剪辑了精华片段、配上了新的背景音乐..."
                    rows={4}
                    value={editDescription}
                    onChange={e => setEditDescription(e.target.value)}
                    className="bg-background/50"
                  />

                  {/* Optional: Trim points */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">裁剪起点（可选）</label>
                      <input
                        type="text"
                        placeholder="0:00"
                        value={trimStart}
                        onChange={e => setTrimStart(e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-md bg-background/50 border border-border/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">裁剪终点（可选）</label>
                      <input
                        type="text"
                        placeholder="5:00"
                        value={trimEnd}
                        onChange={e => setTrimEnd(e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-md bg-background/50 border border-border/50"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Register Remix Hash */}
            {videoUrl && (
              <Card className={`border-border/50 ${hashRegistered ? "bg-green-500/5 border-green-500/30" : "bg-card/50"}`}>
                <CardContent className="p-6 space-y-4">
                  <h3 className="font-medium flex items-center gap-2">
                    <Hash className="h-4 w-4 text-primary" /> Remix Hash 认证
                  </h3>

                  {!hashRegistered ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        注册 Remix Hash 后，此视频将获得平台认证标记，可以参加视频 PK 评分并赢取 Credits 奖励。
                      </p>
                      <Button
                        className="w-full gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
                        disabled={registering || !editDescription.trim()}
                        onClick={handleRegisterRemix}
                      >
                        {registering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                        {registering ? "注册中..." : "注册 Remix Hash"}
                      </Button>
                      {!editDescription.trim() && (
                        <p className="text-xs text-amber-400 flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> 请先填写编辑描述
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-green-400">
                        <CheckCircle2 className="h-5 w-5" />
                        <span className="font-medium">Hash 注册成功！</span>
                      </div>
                      <div className="bg-background/50 rounded-lg p-3">
                        <p className="text-xs text-muted-foreground mb-1">Remix Hash</p>
                        <p className="text-sm font-mono text-primary break-all">{remixHash}</p>
                      </div>
                      <Button
                        className="w-full gap-2"
                        variant="outline"
                        onClick={() => { window.location.href = "/analysis"; }}
                      >
                        <ArrowRight className="h-4 w-4" /> 前往视频 PK 评分
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right: Video Preview */}
          <div className="lg:col-span-3">
            {!videoUrl ? (
              <div className="h-full min-h-[400px] flex items-center justify-center border-2 border-dashed border-border/30 rounded-xl p-12">
                <div className="text-center">
                  <Film className="h-16 w-16 text-muted-foreground/20 mx-auto mb-4" />
                  <p className="text-muted-foreground text-lg mb-2">上传视频开始二次创作</p>
                  <p className="text-sm text-muted-foreground/60 max-w-sm mx-auto">
                    上传外来视频，添加编辑描述，注册 Remix Hash 获得平台认证
                  </p>
                  <div className="flex items-center justify-center gap-6 mt-6 text-xs text-muted-foreground/50">
                    <span className="flex items-center gap-1"><Upload className="h-3 w-3" /> 上传</span>
                    <span>→</span>
                    <span className="flex items-center gap-1"><Sparkles className="h-3 w-3" /> 编辑</span>
                    <span>→</span>
                    <span className="flex items-center gap-1"><Hash className="h-3 w-3" /> 认证</span>
                    <span>→</span>
                    <span className="flex items-center gap-1"><Shield className="h-3 w-3" /> PK</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Video Player */}
                <Card className="bg-card/50 border-border/50 overflow-hidden">
                  <div className="relative bg-black aspect-video">
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      className="w-full h-full object-contain"
                      onTimeUpdate={handleTimeUpdate}
                      onLoadedMetadata={handleLoadedMetadata}
                      onEnded={() => setPlaying(false)}
                      muted={muted}
                    />
                  </div>
                  {/* Controls */}
                  <div className="p-3 flex items-center gap-3">
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={togglePlay}>
                      {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <div className="flex-1">
                      <input
                        type="range"
                        min={0}
                        max={duration || 100}
                        value={currentTime}
                        onChange={e => {
                          const t = Number(e.target.value);
                          if (videoRef.current) videoRef.current.currentTime = t;
                          setCurrentTime(t);
                        }}
                        className="w-full h-1 accent-primary"
                      />
                    </div>
                    <span className="text-xs text-muted-foreground min-w-[70px] text-right">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setMuted(!muted)}>
                      {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </Button>
                  </div>
                </Card>

                {/* Video Info */}
                <Card className="bg-card/50 border-border/50">
                  <CardContent className="p-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-xs text-muted-foreground">文件名</span>
                        <p className="truncate">{videoFile?.name || "未知"}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">大小</span>
                        <p>{videoFile ? `${(videoFile.size / 1024 / 1024).toFixed(1)} MB` : "未知"}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">时长</span>
                        <p>{formatTime(duration)}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">认证状态</span>
                        <p className={hashRegistered ? "text-green-400" : "text-amber-400"}>
                          {hashRegistered ? "已认证" : "未认证"}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Tips */}
                <Card className="bg-cyan-500/5 border-cyan-500/20">
                  <CardContent className="p-4">
                    <h4 className="text-sm font-medium text-cyan-400 mb-2">二次创作说明</h4>
                    <ul className="text-xs text-muted-foreground space-y-1.5">
                      <li>1. 上传外来视频后，填写你的编辑描述（添加了什么效果、做了哪些修改）</li>
                      <li>2. 注册 Remix Hash 后，视频获得平台认证标记</li>
                      <li>3. 认证后的视频可以参加「视频 PK 评分」，获得 Credits 奖励</li>
                      <li>4. 评分标准：≥90 分 +25 Credits，80-89 分 +15 Credits</li>
                      <li>5. 未认证的外来视频只能评分，不能获得 Credits 奖励</li>
                    </ul>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
