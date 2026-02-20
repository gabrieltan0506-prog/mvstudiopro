import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState, useCallback } from "react";
import { Clapperboard, Loader2, FileDown, Image, ChevronDown, ChevronUp, Copy, Check, Lightbulb, Sparkles, Zap, Crown, ArrowRight } from "lucide-react";
import { CREDIT_COSTS } from "@shared/plans";

/** Format the entire storyboard result into a readable plain-text string. */
function formatStoryboardText(result: any): string {
  const lines: string[] = [];
  lines.push(`【${result.title || "分镜脚本"}】`);
  lines.push("");

  const scenes: any[] = result.scenes || [];
  scenes.forEach((scene: any, i: number) => {
    lines.push(`── 场景 ${i + 1}: ${scene.title || ""} ──`);
    if (scene.duration || scene.cameraAngle) {
      lines.push(`时长: ${scene.duration || "4s"}  |  机位: ${scene.cameraAngle || "中景"}`);
    }
    if (scene.description || scene.visual) {
      lines.push(`画面描述: ${scene.description || scene.visual}`);
    }
    if (scene.lyrics) {
      lines.push(`对应歌词: ${scene.lyrics}`);
    }
    if (scene.mood) {
      lines.push(`情绪氛围: ${scene.mood}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

/** Format a single scene into plain text. */
function formatSceneText(scene: any, index: number): string {
  const lines: string[] = [];
  lines.push(`── 场景 ${index + 1}: ${scene.title || ""} ──`);
  if (scene.duration || scene.cameraAngle) {
    lines.push(`时长: ${scene.duration || "4s"}  |  机位: ${scene.cameraAngle || "中景"}`);
  }
  if (scene.description || scene.visual) {
    lines.push(`画面描述: ${scene.description || scene.visual}`);
  }
  if (scene.lyrics) {
    lines.push(`对应歌词: ${scene.lyrics}`);
  }
  if (scene.mood) {
    lines.push(`情绪氛围: ${scene.mood}`);
  }
  return lines.join("\n");
}

type InspirationMode = "free" | "gemini";

export default function Storyboard() {
  const { isAuthenticated } = useAuth();
  const [lyrics, setLyrics] = useState("");
  const [sceneCount, setSceneCount] = useState("6");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [expandedScene, setExpandedScene] = useState<number | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedScene, setCopiedScene] = useState<number | null>(null);

  // Inspiration state
  const [showInspiration, setShowInspiration] = useState(false);
  const [inspirationKeywords, setInspirationKeywords] = useState("");
  const [inspirationMode, setInspirationMode] = useState<InspirationMode>("free");
  const [generatingInspiration, setGeneratingInspiration] = useState(false);
  const [inspirationResult, setInspirationResult] = useState<any>(null);

  const generateMutation = trpc.storyboard.generate.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setResult(data.storyboard);
        toast.success("分镜脚本生成成功！");
      } else {
        toast.error("生成失败");
      }
      setGenerating(false);
    },
    onError: () => { toast.error("生成失败，请重试"); setGenerating(false); },
  });

  const inspirationMutation = trpc.storyboard.generateInspiration.useMutation({
    onSuccess: (data: any) => {
      if (data.success) {
        setInspirationResult(data);
        toast.success("文案生成成功！");
      } else {
        toast.error(data.error || "生成失败");
      }
      setGeneratingInspiration(false);
    },
    onError: () => { toast.error("文案生成失败，请重试"); setGeneratingInspiration(false); },
  });

  const generateImageMutation = trpc.storyboard.generateImage.useMutation({
    onSuccess: (data) => {
      if (data.success && data.imageUrl) {
        toast.success("分镜图片生成成功！");
      } else {
        toast.error(data.error || "图片生成失败");
      }
    },
    onError: () => toast.error("图片生成失败"),
  });

  const { data: myStoryboards } = trpc.storyboard.myList.useQuery(undefined, { enabled: isAuthenticated });

  const handleGenerate = () => {
    if (!lyrics.trim()) { toast.error("请输入歌词或文本内容"); return; }
    setGenerating(true);
    setResult(null);
    setCopiedAll(false);
    setCopiedScene(null);
    generateMutation.mutate({ lyrics: lyrics.trim(), sceneCount: parseInt(sceneCount) });
  };

  const handleGenerateInspiration = () => {
    if (!inspirationKeywords.trim()) { toast.error("请输入你的灵感关键词"); return; }
    setGeneratingInspiration(true);
    setInspirationResult(null);
    inspirationMutation.mutate({ keywords: inspirationKeywords.trim(), mode: inspirationMode });
  };

  /** Use inspiration result as lyrics input */
  const useInspirationAsLyrics = () => {
    if (inspirationResult?.content) {
      setLyrics(inspirationResult.content);
      if (inspirationResult.suggestedScenes) {
        setSceneCount(String(Math.min(inspirationResult.suggestedScenes, 20)));
      }
      setShowInspiration(false);
      toast.success("已将文案填入输入框，可直接生成分镜！");
    }
  };

  /** Copy the full storyboard to clipboard */
  const handleCopyAll = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(formatStoryboardText(result));
      setCopiedAll(true);
      toast.success("已复制全部脚本内容到剪贴板");
      setTimeout(() => setCopiedAll(false), 2000);
    } catch {
      toast.error("复制失败，请手动选取复制");
    }
  }, [result]);

  /** Copy a single scene to clipboard */
  const handleCopyScene = useCallback(async (scene: any, index: number) => {
    try {
      await navigator.clipboard.writeText(formatSceneText(scene, index));
      setCopiedScene(index);
      toast.success(`已复制场景 ${index + 1} 到剪贴板`);
      setTimeout(() => setCopiedScene(null), 2000);
    } catch {
      toast.error("复制失败，请手动选取复制");
    }
  }, []);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="pt-32 text-center container">
          <Clapperboard className="h-16 w-16 text-primary mx-auto mb-6" />
          <h1 className="text-3xl font-bold mb-4">智能脚本与分镜生成</h1>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">输入歌词或文本，AI 自动生成专业视频分镜脚本</p>
          <Button size="lg" className="bg-primary text-primary-foreground" onClick={() => { window.location.href = getLoginUrl(); }}>登录后使用</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <div className="pt-24 pb-16 container max-w-5xl">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center">
              <Clapperboard className="h-5 w-5 text-yellow-400" />
            </div>
            <h1 className="text-3xl font-bold">智能脚本与分镜生成</h1>
          </div>
          <p className="text-muted-foreground">输入歌词或文本，AI 自动生成专业视频分镜脚本</p>
        </div>

        {/* ═══ 灵感文案生成栏位 ═══ */}
        <Card className="mb-8 bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-orange-500/10 border-purple-500/30">
          <CardContent className="p-0">
            <button
              className="w-full p-5 flex items-center justify-between text-left"
              onClick={() => setShowInspiration(!showInspiration)}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                  <Lightbulb className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">没灵感？给我三句话，我帮你写</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">输入几个关键词或简短描述，AI 帮你生成完整的视频文案或歌词</p>
                </div>
              </div>
              <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${showInspiration ? "rotate-180" : ""}`} />
            </button>

            {showInspiration && (
              <div className="px-5 pb-5 space-y-4 border-t border-purple-500/20 pt-4">
                {/* Mode Selection */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setInspirationMode("free")}
                    className={`p-3 rounded-lg text-left transition-all ${
                      inspirationMode === "free"
                        ? "bg-green-500/10 border-2 border-green-500/50"
                        : "bg-background/30 border-2 border-border/30 hover:border-primary/30"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-green-400" />
                      <span className="font-medium text-sm">免费版</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">最多 1000 字 · 10 个分镜</div>
                  </button>
                  <button
                    onClick={() => setInspirationMode("gemini")}
                    className={`p-3 rounded-lg text-left transition-all ${
                      inspirationMode === "gemini"
                        ? "bg-amber-500/10 border-2 border-amber-500/50"
                        : "bg-background/30 border-2 border-border/30 hover:border-primary/30"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Crown className="h-4 w-4 text-amber-400" />
                      <span className="font-medium text-sm">Gemini 增强版</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">最多 2000 字 · 20 个分镜 · {CREDIT_COSTS.inspiration} Credits</div>
                  </button>
                </div>

                {/* Keywords Input */}
                <div>
                  <label className="text-sm font-medium mb-2 block">你的灵感关键词</label>
                  <Textarea
                    placeholder={"例如：\n深夜城市 孤独的旅人 霓虹灯下的告别\n\n或者：\n一个女孩在雨中奔跑，追逐远去的列车，回忆在闪回"}
                    rows={4}
                    value={inspirationKeywords}
                    onChange={e => setInspirationKeywords(e.target.value)}
                    className="bg-background/50"
                    maxLength={500}
                  />
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs text-muted-foreground">{inspirationKeywords.length}/500 字</p>
                    {inspirationMode === "gemini" && (
                      <p className="text-xs text-amber-400">消耗 {CREDIT_COSTS.inspiration} Credits</p>
                    )}
                  </div>
                </div>

                <Button
                  className="w-full gap-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-700 hover:to-pink-700"
                  disabled={generatingInspiration || !inspirationKeywords.trim()}
                  onClick={handleGenerateInspiration}
                >
                  {generatingInspiration ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
                  {generatingInspiration ? "AI 正在创作..." : "生成文案"}
                </Button>

                {/* Inspiration Result */}
                {inspirationResult && inspirationResult.success && (
                  <Card className="bg-card/80 border-border/50">
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-primary">{inspirationResult.title}</h4>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary">{inspirationResult.mood}</span>
                          <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400">{inspirationResult.style}</span>
                        </div>
                      </div>
                      <div className="bg-background/50 rounded-lg p-4 max-h-60 overflow-y-auto">
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{inspirationResult.content}</p>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                          建议分镜数：{inspirationResult.suggestedScenes} 个 · {inspirationResult.mode === "gemini" ? "Gemini 增强版" : "免费版"}
                        </p>
                        <Button
                          size="sm"
                          className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
                          onClick={useInspirationAsLyrics}
                        >
                          <ArrowRight className="h-3.5 w-3.5" /> 使用此文案生成分镜
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Input */}
          <div className="lg:col-span-1 space-y-4">
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-6 space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">歌词 / 文本内容</label>
                  <Textarea
                    placeholder={"在这里粘贴歌词或输入文本内容...\n\n例如：\n月光洒落在窗台\n你的影子在风中摇摆\n城市的霓虹灯闪烁\n我们在人海中相遇"}
                    rows={10}
                    value={lyrics}
                    onChange={e => setLyrics(e.target.value)}
                    className="bg-background/50"
                  />
                  <p className="text-xs text-muted-foreground mt-1">{lyrics.length} 字</p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">分镜数量</label>
                  <Select value={sceneCount} onValueChange={setSceneCount}>
                    <SelectTrigger className="bg-background/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="4">4 个分镜</SelectItem>
                      <SelectItem value="6">6 个分镜</SelectItem>
                      <SelectItem value="8">8 个分镜</SelectItem>
                      <SelectItem value="10">10 个分镜</SelectItem>
                      <SelectItem value="12">12 个分镜</SelectItem>
                      <SelectItem value="16">16 个分镜</SelectItem>
                      <SelectItem value="20">20 个分镜</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
                  disabled={generating || !lyrics.trim()}
                  onClick={handleGenerate}
                >
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
                  {generating ? "生成中..." : "生成分镜脚本"}
                </Button>
                <p className="text-xs text-center text-muted-foreground">消耗 {CREDIT_COSTS.storyboard} Credits / 次（免费用户首次免费）</p>
              </CardContent>
            </Card>

            {/* History */}
            {myStoryboards && myStoryboards.length > 0 && (
              <Card className="bg-card/50 border-border/50">
                <CardHeader className="pb-3"><CardTitle className="text-sm">历史记录</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {myStoryboards.slice(0, 5).map((s: any) => (
                    <button
                      key={s.id}
                      className="w-full text-left p-2 rounded-md bg-background/30 hover:bg-background/50 transition-colors"
                      onClick={() => { setResult(s.storyboard); setCopiedAll(false); setCopiedScene(null); }}
                    >
                      <div className="text-xs text-muted-foreground truncate">{s.lyrics?.slice(0, 40)}...</div>
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right: Result */}
          <div className="lg:col-span-2">
            {!result && !generating ? (
              <div className="h-full flex items-center justify-center border-2 border-dashed border-border/30 rounded-xl p-12">
                <div className="text-center">
                  <Clapperboard className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                  <p className="text-muted-foreground">分镜脚本将显示在这里</p>
                  <p className="text-xs text-muted-foreground/60 mt-2">没有灵感？试试上方的「AI 文案生成」功能</p>
                </div>
              </div>
            ) : generating ? (
              <Card className="bg-card/50 border-border/50">
                <CardContent className="p-12 text-center">
                  <Loader2 className="h-10 w-10 text-primary mx-auto mb-4 animate-spin" />
                  <p className="font-medium">AI 正在生成分镜脚本...</p>
                  <p className="text-sm text-muted-foreground mt-1">正在分析歌词内容，构思画面场景</p>
                </CardContent>
              </Card>
            ) : result && (
              <div className="space-y-4">
                {/* Title row with Copy All + Export PDF */}
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">{result.title || "分镜脚本"}</h3>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className={`gap-1.5 transition-all ${
                        copiedAll
                          ? "bg-green-500/10 border-green-500/40 text-green-400 hover:bg-green-500/20"
                          : "bg-transparent"
                      }`}
                      onClick={handleCopyAll}
                    >
                      {copiedAll ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copiedAll ? "已复制" : "一键复制"}
                    </Button>
                    <Button variant="outline" size="sm" className="bg-transparent gap-1" onClick={() => toast.info("PDF 导出功能即将上线")}>
                      <FileDown className="h-4 w-4" /> 导出 PDF
                    </Button>
                  </div>
                </div>

                {/* Scene cards */}
                {(result.scenes || []).map((scene: any, i: number) => (
                  <Card key={i} className="bg-card/50 border-border/50">
                    <CardContent className="p-4">
                      <button
                        className="w-full flex items-center justify-between"
                        onClick={() => setExpandedScene(expandedScene === i ? null : i)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center text-primary text-sm font-bold">
                            {i + 1}
                          </div>
                          <div className="text-left">
                            <div className="font-medium text-sm">{scene.title || `场景 ${i + 1}`}</div>
                            <div className="text-xs text-muted-foreground">{scene.timeRange} · {scene.mood}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {/* Per-scene copy button (visible when expanded) */}
                          {expandedScene === i && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className={`h-7 w-7 transition-all ${
                                copiedScene === i ? "text-green-400" : "text-muted-foreground hover:text-foreground"
                              }`}
                              onClick={(e) => { e.stopPropagation(); handleCopyScene(scene, i); }}
                              title="复制此场景"
                            >
                              {copiedScene === i ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            </Button>
                          )}
                          {expandedScene === i ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </div>
                      </button>
                      {expandedScene === i && (
                        <div className="mt-4 space-y-3 pl-11">
                          <div>
                            <span className="text-xs font-medium text-muted-foreground">画面描述</span>
                            <p className="text-sm mt-1">{scene.description || scene.visual || "暂无描述"}</p>
                          </div>
                          {scene.lyrics && (
                            <div>
                              <span className="text-xs font-medium text-muted-foreground">对应歌词</span>
                              <p className="text-sm mt-1 text-primary/80">{scene.lyrics}</p>
                            </div>
                          )}
                          {scene.mood && (
                            <div>
                              <span className="text-xs font-medium text-muted-foreground">情绪氛围</span>
                              <p className="text-sm mt-1">{scene.mood}</p>
                            </div>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="bg-transparent gap-1"
                            disabled={generateImageMutation.isPending}
                            onClick={() => generateImageMutation.mutate({ sceneDescription: scene.description || scene.visual || scene.title })}
                          >
                            <Image className="h-3 w-3" /> 生成分镜图
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
