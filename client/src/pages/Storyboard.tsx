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
import {
  Clapperboard, Loader2, FileDown, Image as ImageIcon, ChevronDown, ChevronUp,
  Copy, Check, Lightbulb, Sparkles, Crown, ArrowRight, Sun, User, Move,
  Eye, Users, Camera, Video, Palette, Music, Heart, Zap,
} from "lucide-react";
import { CREDIT_COSTS } from "@shared/plans";

/* ─── Copy formatting helpers ─── */
function formatStoryboardText(result: any): string {
  const lines: string[] = [];
  lines.push(`【${result.title || "分镜脚本"}】`);
  if (result.overallMood) lines.push(`整体情绪: ${result.overallMood}`);
  if (result.suggestedBPM) lines.push(`建议 BPM: ${result.suggestedBPM}`);
  if (result.colorPalette) lines.push(`色彩方案: ${result.colorPalette}`);
  lines.push("");

  (result.scenes || []).forEach((s: any, i: number) => {
    lines.push(`══ 场景 ${i + 1} ══  ${s.timeRange || ""}`);
    if (s.description) lines.push(`画面描述: ${s.description}`);
    if (s.lighting) lines.push(`灯光设计: ${s.lighting}`);
    if (s.characterExpression) lines.push(`人物表情: ${s.characterExpression}`);
    if (s.characterAction) lines.push(`人物动作: ${s.characterAction}`);
    if (s.characterDemeanor) lines.push(`人物神态: ${s.characterDemeanor}`);
    if (s.characterInteraction) lines.push(`人物互动: ${s.characterInteraction}`);
    if (s.shotType) lines.push(`摄影机位: ${s.shotType}`);
    if (s.cameraMovement) lines.push(`镜头运动: ${s.cameraMovement}`);
    if (s.colorTone) lines.push(`色调调色: ${s.colorTone}`);
    if (s.bpm) lines.push(`配乐节奏: ${s.bpm}`);
    if (s.mood) lines.push(`情绪氛围: ${s.mood}`);
    if (s.lyrics) lines.push(`对应歌词: ${s.lyrics}`);
    lines.push("");
  });
  return lines.join("\n");
}

function formatSceneText(scene: any, index: number): string {
  const lines: string[] = [];
  lines.push(`══ 场景 ${index + 1} ══  ${scene.timeRange || ""}`);
  if (scene.description) lines.push(`画面描述: ${scene.description}`);
  if (scene.lighting) lines.push(`灯光设计: ${scene.lighting}`);
  if (scene.characterExpression) lines.push(`人物表情: ${scene.characterExpression}`);
  if (scene.characterAction) lines.push(`人物动作: ${scene.characterAction}`);
  if (scene.characterDemeanor) lines.push(`人物神态: ${scene.characterDemeanor}`);
  if (scene.characterInteraction) lines.push(`人物互动: ${scene.characterInteraction}`);
  if (scene.shotType) lines.push(`摄影机位: ${scene.shotType}`);
  if (scene.cameraMovement) lines.push(`镜头运动: ${scene.cameraMovement}`);
  if (scene.colorTone) lines.push(`色调调色: ${scene.colorTone}`);
  if (scene.bpm) lines.push(`配乐节奏: ${scene.bpm}`);
  if (scene.mood) lines.push(`情绪氛围: ${scene.mood}`);
  if (scene.lyrics) lines.push(`对应歌词: ${scene.lyrics}`);
  return lines.join("\n");
}

/* ─── Detail row component ─── */
function DetailRow({ icon: Icon, label, value, color }: { icon: any; label: string; value?: string; color: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2.5 items-start">
      <div className={`w-6 h-6 rounded flex items-center justify-center shrink-0 mt-0.5 ${color}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <p className="text-sm mt-0.5 leading-relaxed">{value}</p>
      </div>
    </div>
  );
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

  // Image upgrade state per scene
  const [sceneImages, setSceneImages] = useState<Record<number, { url: string; quality: string }>>({});
  const [generatingImage, setGeneratingImage] = useState<Record<number, boolean>>({});

  const generateMutation = trpc.storyboard.generate.useMutation({
    onSuccess: (data: any) => {
      if (data.success) {
        setResult(data.storyboard);
        // Populate auto-generated images
        const imgs: Record<number, { url: string; quality: string }> = {};
        (data.storyboard?.scenes || []).forEach((s: any, i: number) => {
          if (s.generatedImageUrl) imgs[i] = { url: s.generatedImageUrl, quality: "free" };
        });
        setSceneImages(imgs);
        toast.success("分镜脚本生成成功！含自动分镜图");
      } else {
        toast.error((data as any).error || "生成失败");
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

  const generateImageMutation = trpc.storyboard.generateImage.useMutation();

  const { data: myStoryboards } = trpc.storyboard.myList.useQuery(undefined, { enabled: isAuthenticated });

  const handleGenerate = () => {
    if (!lyrics.trim()) { toast.error("请输入歌词或文本内容"); return; }
    setGenerating(true);
    setResult(null);
    setSceneImages({});
    setCopiedAll(false);
    setCopiedScene(null);
    setExpandedScene(null);
    generateMutation.mutate({ lyrics: lyrics.trim(), sceneCount: parseInt(sceneCount) });
  };

  const handleGenerateInspiration = () => {
    if (!inspirationKeywords.trim()) { toast.error("请输入你的灵感关键词"); return; }
    setGeneratingInspiration(true);
    setInspirationResult(null);
    inspirationMutation.mutate({ keywords: inspirationKeywords.trim(), mode: inspirationMode });
  };

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

  /** Upgrade scene image to 2K or 4K */
  const handleUpgradeImage = async (sceneIndex: number, scene: any, quality: "2k" | "4k") => {
    setGeneratingImage(prev => ({ ...prev, [sceneIndex]: true }));
    generateImageMutation.mutate(
      {
        sceneDescription: scene.description || "",
        imagePrompt: scene.imagePrompt || "",
        colorTone: scene.colorTone || "",
        quality,
      },
      {
        onSuccess: (data) => {
          if (data.success && data.imageUrl) {
            setSceneImages(prev => ({ ...prev, [sceneIndex]: { url: data.imageUrl!, quality } }));
            toast.success(`${quality.toUpperCase()} 分镜图生成成功！`);
          } else {
            toast.error((data as any).error || "图片生成失败");
          }
          setGeneratingImage(prev => ({ ...prev, [sceneIndex]: false }));
        },
        onError: () => {
          toast.error("图片生成失败");
          setGeneratingImage(prev => ({ ...prev, [sceneIndex]: false }));
        },
      }
    );
  };

  const handleCopyAll = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(formatStoryboardText(result));
      setCopiedAll(true);
      toast.success("已复制全部脚本内容到剪贴板");
      setTimeout(() => setCopiedAll(false), 2000);
    } catch { toast.error("复制失败"); }
  }, [result]);

  const handleCopyScene = useCallback(async (scene: any, index: number) => {
    try {
      await navigator.clipboard.writeText(formatSceneText(scene, index));
      setCopiedScene(index);
      toast.success(`已复制场景 ${index + 1}`);
      setTimeout(() => setCopiedScene(null), 2000);
    } catch { toast.error("复制失败"); }
  }, []);

  /* ─── Not logged in ─── */
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="pt-32 text-center container">
          <Clapperboard className="h-16 w-16 text-primary mx-auto mb-6" />
          <h1 className="text-3xl font-bold mb-4">智能脚本与分镜生成</h1>
          <p className="text-muted-foreground mb-4 max-w-xl mx-auto">
            输入歌词或文本，AI 自动生成专业级分镜脚本 — 包含灯光设计、人物表情/动作/神态/互动、摄影机位与镜头运动、配乐 BPM、自动分镜图
          </p>
          <Button size="lg" className="bg-primary text-primary-foreground" onClick={() => { window.location.href = getLoginUrl(); }}>登录后使用</Button>
        </div>
      </div>
    );
  }

  /* ─── Main UI ─── */
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <div className="pt-24 pb-16 container max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center">
              <Clapperboard className="h-5 w-5 text-yellow-400" />
            </div>
            <h1 className="text-3xl font-bold">智能脚本与分镜生成</h1>
          </div>
          <p className="text-muted-foreground">
            AI 导演级分镜 — 灯光 · 表情 · 动作 · 神态 · 互动 · 机位 · 镜头 · 色调 · BPM · 自动分镜图
          </p>
        </div>

        {/* ═══ 灵感文案生成栏位 ═══ */}
        <Card className="mb-8 bg-gradient-to-r from-purple-500/10 via-pink-500/10 to-orange-500/10 border-purple-500/30">
          <CardContent className="p-0">
            <button className="w-full p-5 flex items-center justify-between text-left" onClick={() => setShowInspiration(!showInspiration)}>
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
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => setInspirationMode("free")} className={`p-3 rounded-lg text-left transition-all ${inspirationMode === "free" ? "bg-green-500/10 border-2 border-green-500/50" : "bg-background/30 border-2 border-border/30 hover:border-primary/30"}`}>
                    <div className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-green-400" /><span className="font-medium text-sm">免费版</span></div>
                    <div className="text-xs text-muted-foreground mt-1">最多 1000 字 · 10 个分镜</div>
                  </button>
                  <button onClick={() => setInspirationMode("gemini")} className={`p-3 rounded-lg text-left transition-all ${inspirationMode === "gemini" ? "bg-amber-500/10 border-2 border-amber-500/50" : "bg-background/30 border-2 border-border/30 hover:border-primary/30"}`}>
                    <div className="flex items-center gap-1.5"><Crown className="h-4 w-4 text-amber-400" /><span className="font-medium text-sm">Gemini 增强版</span></div>
                    <div className="text-xs text-muted-foreground mt-1">最多 2000 字 · 20 个分镜 · {CREDIT_COSTS.inspiration} Credits</div>
                  </button>
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">你的灵感关键词</label>
                  <Textarea placeholder={"例如：\n深夜城市 孤独的旅人 霓虹灯下的告别\n\n或者：\n一个女孩在雨中奔跑，追逐远去的列车，回忆在闪回"} rows={4} value={inspirationKeywords} onChange={e => setInspirationKeywords(e.target.value)} className="bg-background/50" maxLength={500} />
                  <div className="flex items-center justify-between mt-1">
                    <p className="text-xs text-muted-foreground">{inspirationKeywords.length}/500 字</p>
                    {inspirationMode === "gemini" && <p className="text-xs text-amber-400">消耗 {CREDIT_COSTS.inspiration} Credits</p>}
                  </div>
                </div>
                <Button className="w-full gap-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-700 hover:to-pink-700" disabled={generatingInspiration || !inspirationKeywords.trim()} onClick={handleGenerateInspiration}>
                  {generatingInspiration ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lightbulb className="h-4 w-4" />}
                  {generatingInspiration ? "AI 正在创作..." : "生成文案"}
                </Button>

                {inspirationResult && inspirationResult.success && (
                  <Card className="bg-card/80 border-border/50">
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h4 className="font-bold text-primary">{inspirationResult.title}</h4>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                          <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary">{inspirationResult.mood}</span>
                          <span className="px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400">{inspirationResult.style}</span>
                          {inspirationResult.suggestedBPM && <span className="px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400">BPM {inspirationResult.suggestedBPM}</span>}
                          {inspirationResult.colorScheme && <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400">{inspirationResult.colorScheme}</span>}
                        </div>
                      </div>
                      <div className="bg-background/50 rounded-lg p-4 max-h-60 overflow-y-auto">
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">{inspirationResult.content}</p>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">建议分镜数：{inspirationResult.suggestedScenes} 个 · {inspirationResult.mode === "gemini" ? "Gemini 增强版" : "免费版"}</p>
                        <Button size="sm" className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90" onClick={useInspirationAsLyrics}>
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
          {/* ─── Left: Input ─── */}
          <div className="lg:col-span-1 space-y-4">
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-6 space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">歌词 / 文本内容</label>
                  <Textarea placeholder={"在这里粘贴歌词或输入文本内容...\n\n例如：\n月光洒落在窗台\n你的影子在风中摇摆\n城市的霓虹灯闪烁\n我们在人海中相遇"} rows={10} value={lyrics} onChange={e => setLyrics(e.target.value)} className="bg-background/50" />
                  <p className="text-xs text-muted-foreground mt-1">{lyrics.length} 字</p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-2 block">分镜数量</label>
                  <Select value={sceneCount} onValueChange={setSceneCount}>
                    <SelectTrigger className="bg-background/50"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[2, 4, 6, 8, 10, 12, 16, 20].map(n => (
                        <SelectItem key={n} value={String(n)}>{n} 个分镜</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2" disabled={generating || !lyrics.trim()} onClick={handleGenerate}>
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
                  {generating ? "AI 导演正在构思..." : "生成专业分镜脚本"}
                </Button>
                <p className="text-xs text-center text-muted-foreground">消耗 {CREDIT_COSTS.storyboard} Credits / 次（免费用户首次免费）· 含自动分镜图</p>
              </CardContent>
            </Card>

            {myStoryboards && myStoryboards.length > 0 && (
              <Card className="bg-card/50 border-border/50">
                <CardHeader className="pb-3"><CardTitle className="text-sm">历史记录</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {myStoryboards.slice(0, 5).map((s: any) => (
                    <button key={s.id} className="w-full text-left p-2 rounded-md bg-background/30 hover:bg-background/50 transition-colors" onClick={() => { setResult(s.storyboard); setSceneImages({}); setCopiedAll(false); setCopiedScene(null); }}>
                      <div className="text-xs text-muted-foreground truncate">{s.lyrics?.slice(0, 40)}...</div>
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {/* ─── Right: Result ─── */}
          <div className="lg:col-span-2">
            {!result && !generating ? (
              <div className="h-full flex items-center justify-center border-2 border-dashed border-border/30 rounded-xl p-12">
                <div className="text-center">
                  <Clapperboard className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                  <p className="text-muted-foreground">分镜脚本将显示在这里</p>
                  <p className="text-xs text-muted-foreground/60 mt-2">AI 将分析灯光、表情、动作、机位、BPM 等 14 个专业维度</p>
                </div>
              </div>
            ) : generating ? (
              <Card className="bg-card/50 border-border/50">
                <CardContent className="p-12 text-center">
                  <Loader2 className="h-10 w-10 text-primary mx-auto mb-4 animate-spin" />
                  <p className="font-medium">AI 导演正在构思分镜脚本...</p>
                  <p className="text-sm text-muted-foreground mt-1">分析灯光 · 表情 · 动作 · 机位 · BPM · 生成分镜图</p>
                  <p className="text-xs text-muted-foreground/60 mt-3">首次生成可能需要 30-60 秒</p>
                </CardContent>
              </Card>
            ) : result && (
              <div className="space-y-4">
                {/* Overall info bar */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-lg font-semibold">{result.title || "分镜脚本"}</h3>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {result.overallMood && <span className="text-xs px-2 py-0.5 rounded-full bg-pink-500/10 text-pink-400">{result.overallMood}</span>}
                      {result.suggestedBPM && <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400">BPM {result.suggestedBPM}</span>}
                      {result.colorPalette && <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400">{result.colorPalette}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className={`gap-1.5 transition-all ${copiedAll ? "bg-green-500/10 border-green-500/40 text-green-400" : "bg-transparent"}`} onClick={handleCopyAll}>
                      {copiedAll ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      {copiedAll ? "已复制" : "一键复制"}
                    </Button>
                    <Button variant="outline" size="sm" className="bg-transparent gap-1" onClick={() => toast.info("PDF 导出功能即将上线")}>
                      <FileDown className="h-4 w-4" /> 导出 PDF
                    </Button>
                  </div>
                </div>

                {/* Scene cards */}
                {(result.scenes || []).map((scene: any, i: number) => {
                  const isExpanded = expandedScene === i;
                  const img = sceneImages[i];
                  const isGenImg = generatingImage[i];
                  return (
                    <Card key={i} className="bg-card/50 border-border/50 overflow-hidden">
                      <CardContent className="p-0">
                        {/* Header row */}
                        <button className="w-full p-4 flex items-center justify-between text-left" onClick={() => setExpandedScene(isExpanded ? null : i)}>
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center text-primary text-sm font-bold">{i + 1}</div>
                            <div>
                              <div className="font-medium text-sm">场景 {scene.sceneNumber || i + 1}</div>
                              <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                                <span>{scene.timeRange}</span>
                                {scene.shotType && <><span className="text-border">·</span><span>{scene.shotType}</span></>}
                                {scene.mood && <><span className="text-border">·</span><span>{scene.mood}</span></>}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {isExpanded && (
                              <Button variant="ghost" size="icon" className={`h-7 w-7 ${copiedScene === i ? "text-green-400" : "text-muted-foreground hover:text-foreground"}`} onClick={(e) => { e.stopPropagation(); handleCopyScene(scene, i); }} title="复制此场景">
                                {copiedScene === i ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                              </Button>
                            )}
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </div>
                        </button>

                        {/* Expanded content */}
                        {isExpanded && (
                          <div className="px-4 pb-4 space-y-4">
                            {/* Auto-generated image + upgrade buttons */}
                            <div className="rounded-lg overflow-hidden bg-background/30 border border-border/30">
                              {img ? (
                                <div className="relative">
                                  <img src={img.url} alt={`场景 ${i + 1} 分镜图`} className="w-full aspect-video object-cover" />
                                  <div className="absolute top-2 right-2 flex items-center gap-1">
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${img.quality === "4k" ? "bg-amber-500 text-white" : img.quality === "2k" ? "bg-blue-500 text-white" : "bg-white/80 text-gray-700"}`}>
                                      {img.quality === "4k" ? "4K" : img.quality === "2k" ? "2K" : "基础"}
                                    </span>
                                  </div>
                                </div>
                              ) : (
                                <div className="aspect-video flex items-center justify-center">
                                  <div className="text-center">
                                    <ImageIcon className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                                    <p className="text-xs text-muted-foreground/50">分镜图生成中或暂无</p>
                                  </div>
                                </div>
                              )}
                              {/* Upgrade buttons */}
                              <div className="p-2 flex items-center justify-between bg-background/50">
                                <span className="text-xs text-muted-foreground">升级分镜图质量</span>
                                <div className="flex items-center gap-2">
                                  <Button size="sm" variant="outline" className="h-7 text-xs bg-transparent gap-1" disabled={isGenImg || img?.quality === "2k" || img?.quality === "4k"} onClick={() => handleUpgradeImage(i, scene, "2k")}>
                                    {isGenImg ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                                    2K · {CREDIT_COSTS.storyboardImage2K} Credits
                                  </Button>
                                  <Button size="sm" variant="outline" className="h-7 text-xs bg-transparent gap-1 border-amber-500/40 text-amber-400 hover:bg-amber-500/10" disabled={isGenImg || img?.quality === "4k"} onClick={() => handleUpgradeImage(i, scene, "4k")}>
                                    {isGenImg ? <Loader2 className="h-3 w-3 animate-spin" /> : <Crown className="h-3 w-3" />}
                                    4K · {CREDIT_COSTS.storyboardImage4K} Credits
                                  </Button>
                                </div>
                              </div>
                            </div>

                            {/* All detail dimensions */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <DetailRow icon={Eye} label="画面描述" value={scene.description} color="bg-blue-500/20 text-blue-400" />
                              <DetailRow icon={Sun} label="灯光设计" value={scene.lighting} color="bg-yellow-500/20 text-yellow-400" />
                              <DetailRow icon={User} label="人物表情" value={scene.characterExpression} color="bg-pink-500/20 text-pink-400" />
                              <DetailRow icon={Move} label="人物动作" value={scene.characterAction} color="bg-green-500/20 text-green-400" />
                              <DetailRow icon={Heart} label="人物神态" value={scene.characterDemeanor} color="bg-rose-500/20 text-rose-400" />
                              <DetailRow icon={Users} label="人物互动" value={scene.characterInteraction} color="bg-violet-500/20 text-violet-400" />
                              <DetailRow icon={Camera} label="摄影机位" value={scene.shotType} color="bg-cyan-500/20 text-cyan-400" />
                              <DetailRow icon={Video} label="镜头运动" value={scene.cameraMovement} color="bg-indigo-500/20 text-indigo-400" />
                              <DetailRow icon={Palette} label="色调调色" value={scene.colorTone} color="bg-orange-500/20 text-orange-400" />
                              <DetailRow icon={Music} label="配乐节奏" value={scene.bpm} color="bg-emerald-500/20 text-emerald-400" />
                            </div>

                            {/* Lyrics */}
                            {scene.lyrics && (
                              <div className="bg-primary/5 rounded-lg p-3 border border-primary/10">
                                <span className="text-xs font-medium text-primary/70">对应歌词</span>
                                <p className="text-sm mt-1 text-primary/90 italic">{scene.lyrics}</p>
                              </div>
                            )}

                            {/* Mood */}
                            {scene.mood && (
                              <div className="flex items-center gap-2">
                                <Heart className="h-3.5 w-3.5 text-pink-400" />
                                <span className="text-xs text-muted-foreground">情绪氛围：</span>
                                <span className="text-xs font-medium">{scene.mood}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
