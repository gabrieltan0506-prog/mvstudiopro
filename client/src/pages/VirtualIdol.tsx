import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState, useRef, useEffect } from "react";
import { Sparkles, Loader2, Download, Box, Image as ImageIcon, Crown, Zap, Star, ArrowDown, ChevronDown, ChevronUp } from "lucide-react";
import { CREDIT_COSTS } from "@shared/plans";
import { ModelViewer } from "@/components/ModelViewer";
// ─── Types ──────────────────────────────────────────
type IdolStyle = "anime" | "realistic" | "cyberpunk" | "fantasy" | "chibi";
type ImageQuality = "free" | "2k" | "4k";
type Mode3D = "rapid" | "pro";

const STYLES: { value: IdolStyle; label: string; desc: string; emoji: string }[] = [
  { value: "anime", label: "动漫风", desc: "日系动漫画风", emoji: "🎨" },
  { value: "realistic", label: "写实风", desc: "极度逼真", emoji: "📷" },
  { value: "cyberpunk", label: "赛博朋克", desc: "霓虹科技感", emoji: "🌃" },
  { value: "fantasy", label: "奇幻风", desc: "魔幻世界", emoji: "✨" },
  { value: "chibi", label: "Q版可爱", desc: "卡通萌系", emoji: "🎀" },
];

const QUALITY_TIERS: { id: ImageQuality; label: string; desc: string; credits: number; icon: typeof Star; color: string }[] = [
  { id: "free", label: "免费版", desc: "标准画质", credits: 0, icon: Star, color: "text-green-400 border-green-500/50 bg-green-500/10" },
  { id: "2k", label: "2K 高清", desc: "2048×2048", credits: CREDIT_COSTS.storyboardImage2K, icon: Zap, color: "text-blue-400 border-blue-500/50 bg-blue-500/10" },
  { id: "4k", label: "4K 超清", desc: "4096×4096", credits: CREDIT_COSTS.storyboardImage4K, icon: Crown, color: "text-amber-400 border-amber-500/50 bg-amber-500/10" },
];

// ─
// ─── Main Component ─────────────────────────────
export default function VirtualIdol() {
  const { user, isAuthenticated } = useAuth();
  const isAdminUser = user?.role === "admin";

  // 2D Generation state
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState<IdolStyle>("realistic");
  const [quality, setQuality] = useState<ImageQuality>("free");
  const [generating, setGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<{ url: string; quality: string }[]>([]);

  // 3D Generation state
  const [selected2DImage, setSelected2DImage] = useState<string | null>(null);
  const [mode3d, setMode3d] = useState<Mode3D>("rapid");
  const [enablePbr, setEnablePbr] = useState(false);
  const [generating3d, setGenerating3d] = useState(false);
  const [show3DSection, setShow3DSection] = useState(true);

  // Queries
  const history3d = trpc.hunyuan3d.myList.useQuery(undefined, { enabled: isAuthenticated });

  const generateMutation = trpc.virtualIdol.generate.useMutation({
    onSuccess: (data) => {
      if (data.success && data.imageUrl) {
        const q = (data as any).quality || "free";
        setGeneratedImages(prev => [{ url: data.imageUrl!, quality: q }, ...prev]);
        // Auto-select the newly generated image for 3D
        setSelected2DImage(data.imageUrl!);
        const qualityLabel = q === "4k" ? "4K 超清" : q === "2k" ? "2K 高清" : "标准";
        toast.success(`偶像形象生成成功！(${qualityLabel})`);
      } else {
        toast.error(data.error || "生成失败");
      }
      setGenerating(false);
    },
    onError: () => { toast.error("生成失败，请重试"); setGenerating(false); },
  });

  const generate3dMutation = trpc.hunyuan3d.generate.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("3D 模型生成成功！");
        history3d.refetch();
      } else {
        toast.error(data.error || "3D 生成失败");
      }
      setGenerating3d(false);
    },
    onError: (err) => { toast.error(err.message || "3D 生成失败，请重试"); setGenerating3d(false); },
  });

  const handleGenerate = () => {
    if (!description.trim()) { toast.error("请输入偶像描述"); return; }
    setGenerating(true);
    generateMutation.mutate({ description: description.trim(), style, quality });
  };

  const handleGenerate3D = () => {
    if (!selected2DImage) { toast.error("请先生成一张偶像图像"); return; }
    setGenerating3d(true);
    generate3dMutation.mutate({
      imageUrl: selected2DImage,
      tier: mode3d,
      enablePbr,
    });
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="pt-32 text-center container">
          <Sparkles className="h-16 w-16 text-primary mx-auto mb-6" />
          <h1 className="text-3xl font-bold mb-4">虚拟偶像工坊</h1>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">AI 生成虚拟偶像形象，支持免费 / 2K / 4K 三档画质，一键转换为 3D 模型</p>
          <Button size="lg" className="bg-primary text-primary-foreground" onClick={() => { window.location.href = getLoginUrl(); }}>登录后使用</Button>
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
          <h1 className="text-3xl font-bold mb-2">虚拟偶像工坊</h1>
          <p className="text-muted-foreground">AI 生成偶像形象 → 一键转 3D 模型，上下一体化流程</p>
          {isAdminUser && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-medium">
              <Crown className="h-3 w-3" /> 管理员模式 · 所有功能免费
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════════
            上半部分：2D 偶像生成
            ═══════════════════════════════════════════════ */}
        <section className="mb-4">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/20 text-primary font-bold text-sm">1</div>
            <div>
              <h2 className="text-xl font-bold">生成 2D 偶像形象</h2>
              <p className="text-sm text-muted-foreground">描述你的偶像，选择风格和画质</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Left: Controls */}
            <div className="lg:col-span-2">
              <Card className="bg-card/50 border-border/50">
                <CardContent className="p-5 space-y-4">
                  {/* Description */}
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">偶像描述</label>
                    <Textarea
                      placeholder="例如：一位蓝色长发的少女，穿着白色连衣裙，手持吉他，站在樱花树下..."
                      rows={3}
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      className="bg-background/50"
                    />
                  </div>

                  {/* Style Selection */}
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">艺术风格</label>
                    <div className="grid grid-cols-5 gap-1.5">
                      {STYLES.map(s => (
                        <button
                          key={s.value}
                          onClick={() => setStyle(s.value)}
                          className={`p-2 rounded-lg text-center transition-all ${
                            style === s.value
                              ? "bg-primary/20 border-2 border-primary/50 text-primary"
                              : "bg-background/30 border-2 border-border/30 text-muted-foreground hover:border-primary/30"
                          }`}
                        >
                          <div className="text-lg mb-0.5">{s.emoji}</div>
                          <div className="text-[10px] font-medium leading-tight">{s.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quality Selection */}
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">画质档位</label>
                    <div className="space-y-1.5">
                      {QUALITY_TIERS.map(tier => {
                        const Icon = tier.icon;
                        const isSelected = quality === tier.id;
                        return (
                          <button
                            key={tier.id}
                            onClick={() => setQuality(tier.id)}
                            className={`w-full p-2.5 rounded-lg text-left transition-all flex items-center gap-2.5 ${
                              isSelected
                                ? `border-2 ${tier.color}`
                                : "bg-background/30 border-2 border-border/30 hover:border-primary/30"
                            }`}
                          >
                            <Icon className={`h-4 w-4 flex-shrink-0 ${isSelected ? "" : "text-muted-foreground"}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{tier.label}</span>
                                <span className="text-xs text-muted-foreground">{tier.desc}</span>
                              </div>
                            </div>
                            <div className="flex-shrink-0">
                              {isAdminUser ? (
                                <span className="text-xs font-medium text-amber-400">免费</span>
                              ) : tier.credits > 0 ? (
                                <span className="text-xs font-medium text-primary/70">{tier.credits} Cr</span>
                              ) : (
                                <span className="text-xs font-medium text-green-400">免费</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <Button
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
                    disabled={generating || !description.trim()}
                    onClick={handleGenerate}
                  >
                    {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {generating ? "生成中..." : `生成偶像形象${quality !== "free" ? ` (${quality.toUpperCase()})` : ""}`}
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Right: Generated Results */}
            <div className="lg:col-span-3">
              {generatedImages.length === 0 && !generating ? (
                <div className="h-full min-h-[280px] flex items-center justify-center border-2 border-dashed border-border/30 rounded-xl p-8">
                  <div className="text-center">
                    <Sparkles className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-muted-foreground">生成的偶像形象将显示在这里</p>
                    <p className="text-sm text-muted-foreground/60 mt-1">点击图片可选中用于下方 3D 转换</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {generating && (
                    <Card className="bg-card/50 border-border/50">
                      <CardContent className="p-6 text-center">
                        <Loader2 className="h-8 w-8 text-primary mx-auto mb-3 animate-spin" />
                        <p className="font-medium text-sm">AI 正在创作中...</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {quality === "4k" ? "4K 超清，约 15-30 秒" : quality === "2k" ? "2K 高清，约 10-20 秒" : "标准模式，约 10-20 秒"}
                        </p>
                      </CardContent>
                    </Card>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {generatedImages.map((img, i) => {
                      const isSelected = selected2DImage === img.url;
                      return (
                        <Card
                          key={i}
                          className={`overflow-hidden group cursor-pointer transition-all ${
                            isSelected
                              ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                              : "hover:ring-1 hover:ring-primary/30"
                          }`}
                          onClick={() => setSelected2DImage(img.url)}
                        >
                          <div className="relative aspect-square">
                            <img src={img.url} alt={`偶像 ${i + 1}`} className="w-full h-full object-cover" />
                            {/* Quality badge */}
                            <div className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                              img.quality === "4k" ? "bg-amber-500/80 text-white" :
                              img.quality === "2k" ? "bg-blue-500/80 text-white" :
                              "bg-green-500/80 text-white"
                            }`}>
                              {img.quality === "4k" ? "4K" : img.quality === "2k" ? "2K" : "标准"}
                            </div>
                            {/* Selected indicator */}
                            {isSelected && (
                              <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                                <ArrowDown className="h-3 w-3 text-primary-foreground" />
                              </div>
                            )}
                            {/* Hover overlay */}
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                              <Button size="sm" variant="outline" className="bg-black/50 border-white/30 text-white h-7 text-xs px-2" onClick={(e) => { e.stopPropagation(); window.open(img.url, "_blank"); }}>
                                <Download className="h-3 w-3 mr-1" /> 下载
                              </Button>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                  {selected2DImage && (
                    <p className="text-xs text-center text-primary/70 flex items-center justify-center gap-1">
                      <ArrowDown className="h-3 w-3" /> 已选中图片，可在下方直接转 3D
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ═══ Divider Arrow ═══ */}
        {generatedImages.length > 0 && (
          <div className="flex items-center justify-center my-6">
            <button
              onClick={() => setShow3DSection(!show3DSection)}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/30 text-primary text-sm font-medium hover:bg-primary/20 transition-colors"
            >
              <Box className="h-4 w-4" />
              <span>一键转 3D 模型</span>
              {show3DSection ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════════
            下半部分：3D 模型生成
            ═══════════════════════════════════════════════ */}
        {show3DSection && (
          <section>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/20 text-primary font-bold text-sm">2</div>
              <div>
                <h2 className="text-xl font-bold">转换 3D 模型</h2>
                <p className="text-sm text-muted-foreground">选择上方生成的图片，一键转为 3D 模型</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Left: 3D Controls */}
              <div className="lg:col-span-2">
                <Card className="bg-card/50 border-border/50">
                  <CardContent className="p-5 space-y-4">
                    {/* Selected Image Preview */}
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">选中的偶像图片</label>
                      {selected2DImage ? (
                        <div className="relative rounded-lg overflow-hidden border border-primary/30 aspect-square">
                          <img src={selected2DImage} alt="选中图片" className="w-full h-full object-cover" />
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                            <p className="text-[10px] text-white/80 text-center">此图片将用于 3D 转换</p>
                          </div>
                        </div>
                      ) : (
                        <div className="aspect-square rounded-lg border-2 border-dashed border-border/30 flex items-center justify-center">
                          <div className="text-center p-4">
                            <ImageIcon className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                            <p className="text-xs text-muted-foreground">请先在上方生成偶像图片</p>
                            <p className="text-[10px] text-muted-foreground/60 mt-1">点击图片即可选中</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Mode Selection */}
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">生成模式</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setMode3d("rapid")}
                          className={`p-2.5 rounded-lg text-left transition-all ${
                            mode3d === "rapid"
                              ? "bg-blue-500/10 border-2 border-blue-500/50"
                              : "bg-background/30 border-2 border-border/30 hover:border-primary/30"
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <Zap className="h-4 w-4 text-blue-400" />
                            <span className="font-medium text-sm">Rapid</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">~30 秒</div>
                          <div className="text-xs mt-0.5">
                            {isAdminUser ? (
                              <span className="text-amber-400 font-medium">免费</span>
                            ) : (
                              <span className="text-primary/70 font-medium">{CREDIT_COSTS.idol3DRapid} Credits</span>
                            )}
                          </div>
                        </button>
                        <button
                          onClick={() => setMode3d("pro")}
                          className={`p-2.5 rounded-lg text-left transition-all ${
                            mode3d === "pro"
                              ? "bg-amber-500/10 border-2 border-amber-500/50"
                              : "bg-background/30 border-2 border-border/30 hover:border-primary/30"
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <Crown className="h-4 w-4 text-amber-400" />
                            <span className="font-medium text-sm">Pro</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">~60 秒</div>
                          <div className="text-xs mt-0.5">
                            {isAdminUser ? (
                              <span className="text-amber-400 font-medium">免费</span>
                            ) : (
                              <span className="text-primary/70 font-medium">{CREDIT_COSTS.idol3DPro} Credits</span>
                            )}
                          </div>
                        </button>
                      </div>
                    </div>

                    {/* PBR Option */}
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={enablePbr}
                        onChange={e => setEnablePbr(e.target.checked)}
                        className="rounded border-border"
                      />
                      <span>PBR 材质</span>
                      <span className="text-xs text-muted-foreground">（金属、粗糙度、法线贴图）</span>
                    </label>

                    <Button
                      className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
                      disabled={generating3d || !selected2DImage}
                      onClick={handleGenerate3D}
                    >
                      {generating3d ? <Loader2 className="h-4 w-4 animate-spin" /> : <Box className="h-4 w-4" />}
                      {generating3d ? "3D 模型生成中..." : "生成 3D 模型"}
                    </Button>
                  </CardContent>
                </Card>
              </div>

              {/* Right: 3D Results */}
              <div className="lg:col-span-3">
                {generating3d && (
                  <Card className="bg-card/50 border-border/50 mb-4">
                    <CardContent className="p-6 text-center">
                      <Loader2 className="h-8 w-8 text-primary mx-auto mb-3 animate-spin" />
                      <p className="font-medium text-sm">Hunyuan3D 正在生成 3D 模型...</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {mode3d === "rapid" ? "Rapid 模式约需 30 秒" : "Pro 模式约需 60 秒"}
                      </p>
                    </CardContent>
                  </Card>
                )}

                {history3d.data && history3d.data.length > 0 ? (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-muted-foreground">3D 生成历史</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {history3d.data.map((gen) => (
                        <Card key={gen.id} className="overflow-hidden bg-card/50 border-border/50">
                          <div className="relative aspect-square bg-black/20">
                            {gen.status === "completed" && gen.modelGlbUrl ? (
                              <ModelViewer glbUrl={gen.modelGlbUrl} thumbnailUrl={gen.thumbnailUrl} />
                            ) : gen.status === "generating" ? (
                              <div className="w-full h-full flex items-center justify-center">
                                <Loader2 className="h-8 w-8 text-primary animate-spin" />
                              </div>
                            ) : gen.status === "failed" ? (
                              <div className="w-full h-full flex items-center justify-center">
                                <p className="text-sm text-red-400">生成失败</p>
                              </div>
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Box className="h-10 w-10 text-muted-foreground/30" />
                              </div>
                            )}
                          </div>
                          <CardContent className="p-2.5">
                            <div className="flex items-center justify-between mb-1">
                              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                                gen.mode === "pro" ? "bg-amber-500/20 text-amber-400" : "bg-blue-500/20 text-blue-400"
                              }`}>
                                {gen.mode === "pro" ? "Pro" : "Rapid"}
                              </span>
                              <span className={`text-xs ${
                                gen.status === "completed" ? "text-green-400" :
                                gen.status === "failed" ? "text-red-400" :
                                "text-yellow-400"
                              }`}>
                                {gen.status === "completed" ? "完成" :
                                 gen.status === "failed" ? "失败" :
                                 gen.status === "generating" ? "生成中" : "等待中"}
                              </span>
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                              {new Date(gen.createdAt).toLocaleString()}
                            </p>
                            {gen.status === "completed" && (
                              <div className="flex gap-1 mt-1.5 flex-wrap">
                                {gen.modelGlbUrl && (
                                  <Button size="sm" variant="outline" className="text-[10px] h-6 px-1.5" onClick={() => window.open(gen.modelGlbUrl!, "_blank")}>
                                    <Download className="h-2.5 w-2.5 mr-0.5" /> GLB
                                  </Button>
                                )}
                                {gen.modelObjUrl && (
                                  <Button size="sm" variant="outline" className="text-[10px] h-6 px-1.5" onClick={() => window.open(gen.modelObjUrl!, "_blank")}>
                                    <Download className="h-2.5 w-2.5 mr-0.5" /> OBJ
                                  </Button>
                                )}
                                {gen.modelFbxUrl && (
                                  <Button size="sm" variant="outline" className="text-[10px] h-6 px-1.5" onClick={() => window.open(gen.modelFbxUrl!, "_blank")}>
                                    <Download className="h-2.5 w-2.5 mr-0.5" /> FBX
                                  </Button>
                                )}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ) : !generating3d ? (
                  <div className="h-full min-h-[250px] flex items-center justify-center border-2 border-dashed border-border/30 rounded-xl p-8">
                    <div className="text-center">
                      <Box className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                      <p className="text-muted-foreground text-sm">选择上方生成的图片，一键转 3D</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">支持 Rapid（快速）和 Pro（高质量）两种模式</p>
                      <p className="text-[10px] text-muted-foreground/40 mt-2">输出格式：GLB / OBJ</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        )}
      </div>


    </div>
  );
}
