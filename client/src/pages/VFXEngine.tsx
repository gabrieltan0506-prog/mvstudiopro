import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState } from "react";
import {
  Wand2, Play, Loader2, Film, Clapperboard, Sparkles,
  ArrowRight, Image as ImageIcon, Video, Settings2, Zap
} from "lucide-react";

/* ── Emotion Filters ── */
const EMOTION_FILTERS = [
  { id: "warm", label: "暖色情感", desc: "温暖柔和的色调", color: "border-orange-500/50 bg-orange-500/10 text-orange-400" },
  { id: "cold", label: "冷色忧郁", desc: "冷蓝色调，忧郁氛围", color: "border-blue-500/50 bg-blue-500/10 text-blue-400" },
  { id: "vintage", label: "复古胶片", desc: "经典胶片质感", color: "border-amber-500/50 bg-amber-500/10 text-amber-400" },
  { id: "neon", label: "霓虹闪烁", desc: "赛博朋克霓虹效果", color: "border-purple-500/50 bg-purple-500/10 text-purple-400" },
  { id: "dreamy", label: "梦幻柔焦", desc: "柔焦梦境般效果", color: "border-pink-500/50 bg-pink-500/10 text-pink-400" },
  { id: "dramatic", label: "戏剧光影", desc: "强烈明暗对比", color: "border-red-500/50 bg-red-500/10 text-red-400" },
];

/* ── Transition Effects ── */
const TRANSITIONS = [
  { id: "fade", label: "淡入淡出" },
  { id: "dissolve", label: "溶解过渡" },
  { id: "wipe", label: "擦除转场" },
  { id: "zoom", label: "缩放转场" },
  { id: "glitch", label: "故障效果" },
  { id: "flash", label: "闪白转场" },
];

/* ── Video Quality Options ── */
const QUALITY_OPTIONS = [
  { id: "720p", label: "720p 标清", credits: 30 },
  { id: "1080p", label: "1080p 高清", credits: 50 },
  { id: "4k", label: "4K 超清", credits: 80 },
];

export default function VFXEngine() {
  const { isAuthenticated } = useAuth();
  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);
  const [selectedTransition, setSelectedTransition] = useState<string | null>(null);
  const [intensity, setIntensity] = useState([70]);
  const [quality, setQuality] = useState("1080p");
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);

  // Fetch user's storyboard list
  const storyboardList = trpc.storyboard.myList.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const [selectedStoryboard, setSelectedStoryboard] = useState<string | null>(null);

  const handleGenerate = () => {
    if (!selectedStoryboard) {
      toast.error("请先选择一个分镜脚本");
      return;
    }
    setGenerating(true);
    setGenerationProgress(0);

    // Simulate video generation progress
    const interval = setInterval(() => {
      setGenerationProgress(p => {
        if (p >= 95) {
          clearInterval(interval);
          setTimeout(() => {
            setGenerating(false);
            setGenerationProgress(100);
            toast.success("视频生成完成！");
            toast.info("Kling AI 视频生成 API 接入中，敬请期待完整功能！");
          }, 1000);
          return 95;
        }
        return p + Math.random() * 8;
      });
    }, 500);
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
            将分镜脚本转化为高质量视频片段，支持情感滤镜、动态特效和转场效果
          </p>
          <Button size="lg" className="bg-primary text-primary-foreground" onClick={() => { window.location.href = getLoginUrl(); }}>
            登录后使用
          </Button>
        </div>
      </div>
    );
  }

  const storyboards = storyboardList.data ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <div className="pt-24 pb-16 container max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Wand2 className="h-5 w-5 text-emerald-400" />
            </div>
            <h1 className="text-3xl font-bold">分镜转视频</h1>
          </div>
          <p className="text-muted-foreground">将分镜脚本转化为高质量视频片段，支持情感滤镜、动态特效和转场效果</p>
          <p className="text-xs text-muted-foreground/60 mt-1">消耗 50 Credits / 次（1080p）</p>
        </div>

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
                            <span className="truncate max-w-[180px]">{sb.title || `分镜 #${sb.id}`}</span>
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
              </CardContent>
            </Card>

            {/* Step 2: Emotion Filter */}
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs font-bold text-emerald-400">2</div>
                  <h3 className="text-sm font-semibold">情感滤镜</h3>
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

            {/* Step 4: Quality */}
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center text-xs font-bold text-emerald-400">4</div>
                  <h3 className="text-sm font-semibold">输出质量</h3>
                </div>
                <div className="space-y-2">
                  {QUALITY_OPTIONS.map(q => (
                    <button
                      key={q.id}
                      onClick={() => setQuality(q.id)}
                      className={`w-full p-3 rounded-lg text-left transition-all border flex items-center justify-between ${
                        quality === q.id
                          ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/50"
                          : "bg-background/30 border-border/30 text-muted-foreground hover:border-border"
                      }`}
                    >
                      <span className="text-sm font-medium">{q.label}</span>
                      <Badge variant="outline" className="text-[10px]">{q.credits} Credits</Badge>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Generate Button */}
            <Button
              className="w-full bg-emerald-600 text-white hover:bg-emerald-700 gap-2 h-12 text-base"
              disabled={generating || !selectedStoryboard}
              onClick={handleGenerate}
            >
              {generating ? (
                <><Loader2 className="h-5 w-5 animate-spin" /> 生成中 {Math.round(generationProgress)}%</>
              ) : (
                <><Zap className="h-5 w-5" /> 开始生成视频</>
              )}
            </Button>
          </div>

          {/* Right: Preview & Result */}
          <div className="lg:col-span-2 space-y-4">
            {/* Preview Area */}
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-6">
                {generating ? (
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
                      <h3 className="text-lg font-semibold mb-2">AI 正在生成视频...</h3>
                      <p className="text-sm text-muted-foreground mb-4">
                        正在将分镜脚本转化为视频片段，请耐心等待
                      </p>
                      <div className="w-full bg-border/30 rounded-full h-2 mb-2">
                        <div
                          className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                          style={{ width: `${generationProgress}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">{Math.round(generationProgress)}% 完成</p>
                    </div>
                  </div>
                ) : generationProgress >= 100 ? (
                  <div className="min-h-[400px] flex items-center justify-center">
                    <div className="text-center max-w-md">
                      <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-6">
                        <Sparkles className="h-10 w-10 text-emerald-400" />
                      </div>
                      <h3 className="text-lg font-semibold mb-2">视频生成演示完成</h3>
                      <p className="text-sm text-muted-foreground mb-6">
                        Kling AI 视频生成 API 正在接入中，完整功能即将上线。
                        目前展示的是分镜转视频的工作流程和界面。
                      </p>
                      <div className="flex gap-3 justify-center">
                        <Button
                          variant="outline"
                          className="bg-transparent gap-2"
                          onClick={() => { setGenerationProgress(0); setSelectedStoryboard(null); }}
                        >
                          重新生成
                        </Button>
                        <Button className="bg-emerald-600 text-white hover:bg-emerald-700 gap-2" onClick={() => window.location.href = "/storyboard"}>
                          <Clapperboard className="h-4 w-4" /> 创建新分镜
                        </Button>
                      </div>
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
                        选择分镜脚本、设置滤镜和转场效果，AI 将自动生成高质量视频片段
                      </p>
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <div className="w-10 h-10 rounded-lg bg-orange-500/10 flex items-center justify-center mx-auto mb-2">
                            <ImageIcon className="h-5 w-5 text-orange-400" />
                          </div>
                          <p className="text-xs text-muted-foreground">分镜图片</p>
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
                      {selectedStoryboard
                        ? storyboards.find((s: any) => String(s.id) === selectedStoryboard)?.lyrics?.slice(0, 20) || `分镜 #${selectedStoryboard}`
                        : "未选择"}
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
                    <p className="text-[10px] text-muted-foreground mb-1">转场效果</p>
                    <p className="text-xs font-medium">
                      {selectedTransition ? TRANSITIONS.find(t => t.id === selectedTransition)?.label : "无"}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-background/30 border border-border/30">
                    <p className="text-[10px] text-muted-foreground mb-1">输出质量</p>
                    <p className="text-xs font-medium">
                      {QUALITY_OPTIONS.find(q => q.id === quality)?.label}
                    </p>
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
                    <h4 className="text-sm font-medium text-emerald-400 mb-1">使用提示</h4>
                    <ul className="text-xs text-muted-foreground space-y-1">
                      <li>• 先在「智能脚本与分镜生成」中创建分镜脚本</li>
                      <li>• 选择合适的情感滤镜可以让视频更有感染力</li>
                      <li>• 转场效果建议与音乐节奏匹配</li>
                      <li>• 4K 输出需要更多 Credits，建议先用 720p 预览效果</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
