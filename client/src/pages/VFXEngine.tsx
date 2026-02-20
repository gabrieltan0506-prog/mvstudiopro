import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState, useMemo } from "react";
import {
  Wand2, Play, Loader2, Film, Clapperboard, Sparkles,
  ArrowRight, Image as ImageIcon, Video, Settings2, Zap,
  Download, RotateCcw, Clock, CheckCircle2, XCircle, History
} from "lucide-react";
import { VideoInteraction } from "@/components/VideoInteraction";

/* ── Emotion Filters ── */
const EMOTION_FILTERS = [
  { id: "warm", label: "暖色情感", desc: "温暖柔和的色调", color: "border-orange-500/50 bg-orange-500/10 text-orange-400", promptHint: "warm golden tones, soft lighting, romantic atmosphere" },
  { id: "cold", label: "冷色忧郁", desc: "冷蓝色调，忧郁氛围", color: "border-blue-500/50 bg-blue-500/10 text-blue-400", promptHint: "cold blue tones, melancholic mood, moody lighting" },
  { id: "vintage", label: "复古胶片", desc: "经典胶片质感", color: "border-amber-500/50 bg-amber-500/10 text-amber-400", promptHint: "vintage film grain, retro color grading, nostalgic feel" },
  { id: "neon", label: "霓虹闪烁", desc: "赛博朋克霓虹效果", color: "border-purple-500/50 bg-purple-500/10 text-purple-400", promptHint: "neon lights, cyberpunk aesthetic, vibrant glowing colors" },
  { id: "dreamy", label: "梦幻柔焦", desc: "柔焦梦境般效果", color: "border-pink-500/50 bg-pink-500/10 text-pink-400", promptHint: "dreamy soft focus, ethereal glow, pastel colors" },
  { id: "dramatic", label: "戏剧光影", desc: "强烈明暗对比", color: "border-red-500/50 bg-red-500/10 text-red-400", promptHint: "dramatic chiaroscuro lighting, high contrast, cinematic shadows" },
];

/* ── Transition Effects ── */
const TRANSITIONS = [
  { id: "fade", label: "淡入淡出", promptHint: "smooth fade transition" },
  { id: "dissolve", label: "溶解过渡", promptHint: "dissolve transition effect" },
  { id: "wipe", label: "擦除转场", promptHint: "wipe transition" },
  { id: "zoom", label: "缩放转场", promptHint: "zoom transition" },
  { id: "glitch", label: "故障效果", promptHint: "glitch transition effect" },
  { id: "flash", label: "闪白转场", promptHint: "flash white transition" },
];

/* ── Quality/Resolution Options ── */
const QUALITY_OPTIONS = [
  { quality: "fast" as const, resolution: "720p" as const, label: "快速 720p", desc: "约30秒生成", credits: 15 },
  { quality: "fast" as const, resolution: "1080p" as const, label: "快速 1080p", desc: "约45秒生成", credits: 25 },
  { quality: "standard" as const, resolution: "720p" as const, label: "标准 720p", desc: "约90秒，更高质量", credits: 30 },
  { quality: "standard" as const, resolution: "1080p" as const, label: "标准 1080p", desc: "约120秒，最佳质量", credits: 50 },
];

export default function VFXEngine() {
  const { isAuthenticated } = useAuth();
  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);
  const [selectedTransition, setSelectedTransition] = useState<string | null>(null);
  const [intensity, setIntensity] = useState([70]);
  const [qualityIdx, setQualityIdx] = useState(0); // index into QUALITY_OPTIONS
  const [customPrompt, setCustomPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [showHistory, setShowHistory] = useState(false);

  // Fetch user's storyboard list
  const storyboardList = trpc.storyboard.myList.useQuery(undefined, { enabled: isAuthenticated });
  const [selectedStoryboard, setSelectedStoryboard] = useState<string | null>(null);

  // Veo API status
  const veoStatus = trpc.veo.status.useQuery();

  // Video generation mutation
  const generateMutation = trpc.veo.generate.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("视频生成完成！");
        historyQuery.refetch();
      } else {
        toast.error(data.error || "视频生成失败");
      }
    },
    onError: (err) => {
      toast.error("请求失败: " + err.message);
    },
  });

  // Video generation history
  const historyQuery = trpc.veo.myList.useQuery(undefined, { enabled: isAuthenticated });

  const storyboards = storyboardList.data ?? [];
  const selectedSb = useMemo(() => {
    if (!selectedStoryboard) return null;
    return storyboards.find((s: any) => String(s.id) === selectedStoryboard) ?? null;
  }, [selectedStoryboard, storyboards]);

  const currentQuality = QUALITY_OPTIONS[qualityIdx];

  // Build the final prompt from storyboard + filters + custom text
  const buildPrompt = (): string => {
    const parts: string[] = [];

    // Base: storyboard scene descriptions
    if (selectedSb) {
      const sb = selectedSb.storyboard as any;
      if (sb?.scenes) {
        const sceneDescs = sb.scenes.map((s: any) =>
          `Scene ${s.sceneNumber}: ${s.description}. Camera: ${s.cameraMovement}. Mood: ${s.mood}.`
        ).join(" ");
        parts.push(`MV storyboard video: ${sb.title || ""}. ${sceneDescs}`);
      }
    }

    // Custom prompt
    if (customPrompt.trim()) {
      parts.push(customPrompt.trim());
    }

    // Emotion filter
    if (selectedFilter) {
      const filter = EMOTION_FILTERS.find(f => f.id === selectedFilter);
      if (filter) parts.push(`Visual style: ${filter.promptHint}, intensity ${intensity[0]}%`);
    }

    // Transition
    if (selectedTransition) {
      const trans = TRANSITIONS.find(t => t.id === selectedTransition);
      if (trans) parts.push(`Transition: ${trans.promptHint}`);
    }

    // Always add cinematic quality
    parts.push("Professional cinematography, high production value, smooth motion.");

    return parts.join(". ");
  };

  const handleGenerate = () => {
    if (!selectedStoryboard && !customPrompt.trim()) {
      toast.error("请选择分镜脚本或输入自定义描述");
      return;
    }

    const prompt = buildPrompt();
    if (prompt.length < 10) {
      toast.error("描述太短，请提供更多细节");
      return;
    }

    generateMutation.mutate({
      prompt,
      quality: currentQuality.quality,
      resolution: currentQuality.resolution,
      aspectRatio,
      emotionFilter: selectedFilter ?? undefined,
      transition: selectedTransition ?? undefined,
      storyboardId: selectedStoryboard ? Number(selectedStoryboard) : undefined,
    });
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="pt-32 text-center container">
          <div className="w-20 h-20 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-6">
            <Wand2 className="h-10 w-10 text-emerald-400" />
          </div>
          <h1 className="text-3xl font-bold mb-4">分镜转视频</h1>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
            将分镜脚本转化为高质量视频片段，由 Google Veo 3.1 AI 驱动
          </p>
          <Button size="lg" className="bg-primary text-primary-foreground" onClick={() => { window.location.href = getLoginUrl(); }}>
            登录后使用
          </Button>
        </div>
      </div>
    );
  }

  const history = historyQuery.data ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <div className="pt-24 pb-16 container max-w-6xl">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <Wand2 className="h-5 w-5 text-emerald-400" />
              </div>
              <h1 className="text-3xl font-bold">分镜转视频</h1>
              <Badge variant="outline" className="text-emerald-400 border-emerald-500/50 text-xs">
                Veo 3.1 {veoStatus.data?.available ? "已连接" : "未连接"}
              </Badge>
            </div>
            <p className="text-muted-foreground">由 Google Veo 3.1 驱动，将分镜脚本转化为高质量 AI 视频</p>
          </div>
          <Button
            variant="outline"
            className="bg-transparent gap-2"
            onClick={() => setShowHistory(!showHistory)}
          >
            <History className="h-4 w-4" />
            {showHistory ? "返回生成" : "生成历史"}
          </Button>
        </div>

        {showHistory ? (
          /* ── History View ── */
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">生成历史</h2>
            {history.length === 0 ? (
              <Card className="bg-card/50 border-border/50">
                <CardContent className="p-12 text-center">
                  <Video className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                  <p className="text-muted-foreground">暂无生成记录</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {history.map((gen: any) => (
                  <Card key={gen.id} className="bg-card/50 border-border/50 overflow-hidden">
                    <CardContent className="p-0">
                      {gen.status === "completed" && gen.videoUrl ? (
                        <video
                          src={gen.videoUrl}
                          controls
                          className="w-full aspect-video bg-black"
                          preload="metadata"
                        />
                      ) : (
                        <div className="w-full aspect-video bg-black/50 flex items-center justify-center">
                          {gen.status === "generating" ? (
                            <div className="text-center">
                              <Loader2 className="h-8 w-8 animate-spin text-emerald-400 mx-auto mb-2" />
                              <p className="text-xs text-muted-foreground">生成中...</p>
                            </div>
                          ) : (
                            <div className="text-center">
                              <XCircle className="h-8 w-8 text-red-400 mx-auto mb-2" />
                              <p className="text-xs text-red-400">生成失败</p>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {gen.status === "completed" && <CheckCircle2 className="h-4 w-4 text-emerald-400" />}
                            {gen.status === "generating" && <Loader2 className="h-4 w-4 animate-spin text-yellow-400" />}
                            {gen.status === "failed" && <XCircle className="h-4 w-4 text-red-400" />}
                            <span className="text-sm font-medium">
                              {gen.quality === "fast" ? "快速" : "标准"} {gen.resolution}
                            </span>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(gen.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{gen.prompt}</p>
                        {gen.status === "completed" && gen.videoUrl && (
                          <div className="space-y-3 mt-3">
                            <Button
                              size="sm"
                              variant="outline"
                              className="bg-transparent gap-1 text-xs"
                              onClick={() => window.open(gen.videoUrl, "_blank")}
                            >
                              <Download className="h-3 w-3" /> 下载视频
                            </Button>
                            <VideoInteraction videoUrl={gen.videoUrl} title={gen.prompt?.slice(0, 30)} compact />
                          </div>
                        )}
                        {gen.status === "failed" && gen.errorMessage && (
                          <p className="text-xs text-red-400 mt-2">{gen.errorMessage}</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── Generation View ── */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Configuration Panel */}
            <div className="space-y-4">
              {/* Step 1: Select Storyboard */}
              <Card className="bg-card/50 border-border/50">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs font-bold text-emerald-400">1</div>
                    <h3 className="text-sm font-semibold">选择分镜脚本</h3>
                  </div>
                  {storyboards.length > 0 ? (
                    <Select value={selectedStoryboard ?? ""} onValueChange={setSelectedStoryboard}>
                      <SelectTrigger className="bg-background/50">
                        <SelectValue placeholder="选择已生成的分镜脚本" />
                      </SelectTrigger>
                      <SelectContent>
                        {storyboards.map((sb: any) => (
                          <SelectItem key={sb.id} value={String(sb.id)}>
                            <div className="flex items-center gap-2">
                              <Clapperboard className="h-3 w-3" />
                              <span className="truncate max-w-[180px]">{sb.storyboard?.title || `分镜 #${sb.id}`}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="text-center py-4">
                      <Clapperboard className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground mb-2">暂无分镜脚本</p>
                      <Button size="sm" variant="outline" className="bg-transparent text-xs" onClick={() => window.location.href = "/storyboard"}>
                        去创建分镜 <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                  )}
                  {/* Custom prompt */}
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground mb-1.5">或输入自定义描述（可与分镜叠加）</p>
                    <Textarea
                      placeholder="描述你想要的视频画面，例如：一位女孩在樱花树下弹吉他，镜头缓慢推进..."
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                      className="bg-background/50 text-sm min-h-[80px] resize-none"
                      maxLength={1000}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Step 2: Emotion Filter */}
              <Card className="bg-card/50 border-border/50">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs font-bold text-emerald-400">2</div>
                    <h3 className="text-sm font-semibold">情感滤镜</h3>
                    <span className="text-[10px] text-muted-foreground/60">可选</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {EMOTION_FILTERS.map(f => (
                      <button
                        key={f.id}
                        onClick={() => setSelectedFilter(selectedFilter === f.id ? null : f.id)}
                        className={`p-2.5 rounded-lg text-xs text-left transition-all border ${
                          selectedFilter === f.id ? f.color : "bg-background/30 border-border/30 text-muted-foreground hover:border-border"
                        }`}
                      >
                        <div className="font-medium">{f.label}</div>
                        <div className="text-[10px] opacity-70 mt-0.5">{f.desc}</div>
                      </button>
                    ))}
                  </div>
                  {selectedFilter && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-muted-foreground">滤镜强度</span>
                        <span className="text-xs text-muted-foreground">{intensity[0]}%</span>
                      </div>
                      <Slider value={intensity} onValueChange={setIntensity} max={100} step={5} />
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Step 3: Transition */}
              <Card className="bg-card/50 border-border/50">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs font-bold text-emerald-400">3</div>
                    <h3 className="text-sm font-semibold">转场效果</h3>
                    <span className="text-[10px] text-muted-foreground/60">可选</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {TRANSITIONS.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setSelectedTransition(selectedTransition === t.id ? null : t.id)}
                        className={`p-2 rounded-lg text-xs text-center transition-all border ${
                          selectedTransition === t.id
                            ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50"
                            : "bg-background/30 border-border/30 text-muted-foreground hover:border-border"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Step 4: Quality + Aspect Ratio */}
              <Card className="bg-card/50 border-border/50">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs font-bold text-emerald-400">4</div>
                    <h3 className="text-sm font-semibold">输出设置</h3>
                  </div>

                  {/* Aspect Ratio */}
                  <div className="mb-3">
                    <p className="text-xs text-muted-foreground mb-2">画面比例</p>
                    <div className="grid grid-cols-2 gap-2">
                      {(["16:9", "9:16"] as const).map(ar => (
                        <button
                          key={ar}
                          onClick={() => setAspectRatio(ar)}
                          className={`p-2 rounded-lg text-xs text-center transition-all border ${
                            aspectRatio === ar
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50"
                              : "bg-background/30 border-border/30 text-muted-foreground hover:border-border"
                          }`}
                        >
                          {ar === "16:9" ? "横屏 16:9" : "竖屏 9:16"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quality */}
                  <p className="text-xs text-muted-foreground mb-2">质量与速度</p>
                  <div className="space-y-2">
                    {QUALITY_OPTIONS.map((q, idx) => (
                      <button
                        key={idx}
                        onClick={() => setQualityIdx(idx)}
                        className={`w-full p-3 rounded-lg text-left transition-all border flex items-center justify-between ${
                          qualityIdx === idx
                            ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50"
                            : "bg-background/30 border-border/30 text-muted-foreground hover:border-border"
                        }`}
                      >
                        <div>
                          <span className="text-sm font-medium">{q.label}</span>
                          <p className="text-[10px] opacity-60 mt-0.5">{q.desc}</p>
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0">{q.credits} Credits</Badge>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Generate Button */}
              <Button
                className="w-full bg-emerald-600 text-white hover:bg-emerald-700 gap-2 h-12 text-base"
                disabled={generateMutation.isPending || (!selectedStoryboard && !customPrompt.trim())}
                onClick={handleGenerate}
              >
                {generateMutation.isPending ? (
                  <><Loader2 className="h-5 w-5 animate-spin" /> AI 正在生成视频...</>
                ) : (
                  <><Zap className="h-5 w-5" /> 开始生成视频 ({currentQuality.credits} Credits)</>
                )}
              </Button>
            </div>

            {/* Right: Preview & Result */}
            <div className="lg:col-span-2 space-y-4">
              {/* Main Preview Area */}
              <Card className="bg-card/50 border-border/50">
                <CardContent className="p-6">
                  {generateMutation.isPending ? (
                    <div className="min-h-[400px] flex items-center justify-center">
                      <div className="text-center max-w-md">
                        <div className="relative w-24 h-24 mx-auto mb-6">
                          <div className="absolute inset-0 rounded-full border-4 border-emerald-500/20" />
                          <div
                            className="absolute inset-0 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin"
                            style={{ animationDuration: "2s" }}
                          />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Video className="h-8 w-8 text-emerald-400" />
                          </div>
                        </div>
                        <h3 className="text-lg font-semibold mb-2">Veo 3.1 正在生成视频...</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          AI 正在将你的描述转化为视频，{currentQuality.quality === "fast" ? "预计 30-60 秒" : "预计 1-3 分钟"}
                        </p>
                        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          <span>请勿关闭页面，生成完成后会自动显示</span>
                        </div>
                      </div>
                    </div>
                  ) : generateMutation.isSuccess && generateMutation.data?.success && generateMutation.data?.videoUrl ? (
                    <div className="min-h-[400px]">
                      <video
                        src={generateMutation.data.videoUrl}
                        controls
                        autoPlay
                        className="w-full rounded-lg bg-black"
                        style={{ aspectRatio: aspectRatio === "16:9" ? "16/9" : "9/16" }}
                      />
                      <div className="flex gap-3 mt-4">
                        <Button
                          variant="outline"
                          className="bg-transparent gap-2"
                          onClick={() => {
                            generateMutation.reset();
                            setCustomPrompt("");
                          }}
                        >
                          <RotateCcw className="h-4 w-4" /> 重新生成
                        </Button>
                        <Button
                          className="bg-emerald-600 text-white hover:bg-emerald-700 gap-2"
                          onClick={() => window.open(generateMutation.data!.videoUrl!, "_blank")}
                        >
                          <Download className="h-4 w-4" /> 下载视频
                        </Button>
                      </div>
                    </div>
                  ) : generateMutation.isSuccess && !generateMutation.data?.success ? (
                    <div className="min-h-[400px] flex items-center justify-center">
                      <div className="text-center max-w-md">
                        <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
                          <XCircle className="h-10 w-10 text-red-400" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">生成失败</h3>
                        <p className="text-sm text-muted-foreground mb-4">{generateMutation.data?.error}</p>
                        <p className="text-xs text-muted-foreground mb-6">Credits 已自动退还</p>
                        <Button
                          variant="outline"
                          className="bg-transparent gap-2"
                          onClick={() => generateMutation.reset()}
                        >
                          <RotateCcw className="h-4 w-4" /> 重试
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="min-h-[400px] flex items-center justify-center">
                      <div className="text-center max-w-md">
                        <div className="w-20 h-20 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-6">
                          <Film className="h-10 w-10 text-emerald-400/50" />
                        </div>
                        <h3 className="text-lg font-semibold mb-2">分镜转视频</h3>
                        <p className="text-sm text-muted-foreground mb-6">
                          选择分镜脚本或输入描述，设置滤镜和转场效果，Veo 3.1 AI 将自动生成 8 秒高质量视频
                        </p>
                        <div className="grid grid-cols-3 gap-4 text-center">
                          <div>
                            <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center mx-auto mb-2">
                              <ImageIcon className="h-5 w-5 text-orange-400" />
                            </div>
                            <p className="text-xs text-muted-foreground">分镜描述</p>
                          </div>
                          <div>
                            <ArrowRight className="h-5 w-5 text-muted-foreground/30 mx-auto mt-2" />
                          </div>
                          <div>
                            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center mx-auto mb-2">
                              <Video className="h-5 w-5 text-emerald-400" />
                            </div>
                            <p className="text-xs text-muted-foreground">AI 视频</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Configuration Summary */}
              <Card className="bg-card/50 border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Settings2 className="h-4 w-4" /> 当前配置
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 rounded-lg bg-background/30 border border-border/30">
                      <p className="text-[10px] text-muted-foreground mb-1">分镜脚本</p>
                      <p className="text-xs font-medium truncate">
                        {selectedSb
                          ? (selectedSb.storyboard as any)?.title || `分镜 #${selectedStoryboard}`
                          : customPrompt.trim() ? "自定义描述" : "未选择"}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-background/30 border border-border/30">
                      <p className="text-[10px] text-muted-foreground mb-1">情感滤镜</p>
                      <p className="text-xs font-medium">
                        {selectedFilter ? EMOTION_FILTERS.find(f => f.id === selectedFilter)?.label : "无"}
                        {selectedFilter && ` ${intensity[0]}%`}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-background/30 border border-border/30">
                      <p className="text-[10px] text-muted-foreground mb-1">画面比例</p>
                      <p className="text-xs font-medium">
                        {aspectRatio === "16:9" ? "横屏 16:9" : "竖屏 9:16"}
                      </p>
                    </div>
                    <div className="p-3 rounded-lg bg-background/30 border border-border/30">
                      <p className="text-[10px] text-muted-foreground mb-1">输出质量</p>
                      <p className="text-xs font-medium">{currentQuality.label}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Tips */}
              <Card className="bg-emerald-500/5 border-emerald-500/20">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <Sparkles className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-medium text-emerald-400 mb-1">Veo 3.1 使用提示</h4>
                      <ul className="text-xs text-muted-foreground space-y-1">
                        <li>• 每次生成约 8 秒高质量视频，含原生音频</li>
                        <li>• 快速模式适合预览效果，标准模式画质更高</li>
                        <li>• 描述越详细，生成效果越好（建议包含场景、光线、镜头运动）</li>
                        <li>• 生成失败时 Credits 会自动退还</li>
                        <li>• 支持横屏（16:9）和竖屏（9:16）两种比例</li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
