import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState, useRef, useEffect, useCallback } from "react";
import { Sparkles, Loader2, Download, Upload, Box, Image as ImageIcon, RotateCcw, Crown, Zap, Star } from "lucide-react";
import { CREDIT_COSTS } from "@shared/plans";

// ─── Types ──────────────────────────────────────
type IdolStyle = "anime" | "realistic" | "cyberpunk" | "fantasy" | "chibi";
type TabType = "generate" | "to3d";
type Mode3D = "rapid" | "pro";
type ImageQuality = "free" | "2k" | "4k";

const STYLES: { value: IdolStyle; label: string; desc: string }[] = [
  { value: "anime", label: "动漫风", desc: "日系动漫画风，色彩鲜明" },
  { value: "realistic", label: "写实风", desc: "极度逼真的真人效果" },
  { value: "cyberpunk", label: "赛博朋克", desc: "霓虹灯光、未来科技感" },
  { value: "fantasy", label: "奇幻风", desc: "奇幻世界角色设计" },
  { value: "chibi", label: "Q版可爱", desc: "可爱Q版卡通风格" },
];

const QUALITY_TIERS: { id: ImageQuality; label: string; desc: string; credits: number; icon: typeof Star; color: string }[] = [
  { id: "free", label: "免费版", desc: "标准画质", credits: 0, icon: Star, color: "text-green-400 border-green-500/50 bg-green-500/10" },
  { id: "2k", label: "2K 高清", desc: "2048×2048", credits: CREDIT_COSTS.storyboardImage2K, icon: Zap, color: "text-blue-400 border-blue-500/50 bg-blue-500/10" },
  { id: "4k", label: "4K 超清", desc: "4096×4096", credits: CREDIT_COSTS.storyboardImage4K, icon: Crown, color: "text-amber-400 border-amber-500/50 bg-amber-500/10" },
];

// ─── 3D Model Viewer ────────────────────────────
function ModelViewer({ glbUrl, thumbnailUrl }: { glbUrl: string; thumbnailUrl?: string | null }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!glbUrl || !canvasRef.current) return;
    const el = canvasRef.current;
    const mv = document.createElement("model-viewer") as any;
    mv.src = glbUrl;
    mv.alt = "3D Model";
    mv.setAttribute("auto-rotate", "");
    mv.setAttribute("camera-controls", "");
    mv.setAttribute("shadow-intensity", "1");
    mv.style.width = "100%";
    mv.style.height = "100%";
    mv.style.background = "transparent";
    if (thumbnailUrl) mv.poster = thumbnailUrl;
    mv.addEventListener("load", () => setLoaded(true));
    mv.addEventListener("error", () => setError(true));
    el.innerHTML = "";
    el.appendChild(mv);
    return () => { el.innerHTML = ""; };
  }, [glbUrl, thumbnailUrl]);

  if (error && thumbnailUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-black/20 rounded-lg">
        <img src={thumbnailUrl} alt="3D Preview" className="max-w-full max-h-full object-contain" />
      </div>
    );
  }

  return (
    <div ref={canvasRef} className="w-full h-full relative">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-8 w-8 text-primary animate-spin" />
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────
export default function VirtualIdol() {
  const { isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>("generate");

  // 2D Generation state
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState<IdolStyle>("realistic");
  const [quality, setQuality] = useState<ImageQuality>("free");
  const [generating, setGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<{ url: string; quality: string }[]>([]);

  // 3D Generation state
  const [mode3d, setMode3d] = useState<Mode3D>("rapid");
  const [enablePbr, setEnablePbr] = useState(false);
  const [enableGeometry, setEnableGeometry] = useState(false);
  const [uploadedImageUrl, setUploadedImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [generating3d, setGenerating3d] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Queries
  const history3d = trpc.hunyuan3d.myList.useQuery(undefined, { enabled: isAuthenticated && activeTab === "to3d" });

  const generateMutation = trpc.virtualIdol.generate.useMutation({
    onSuccess: (data) => {
      if (data.success && data.imageUrl) {
        const q = (data as any).quality || "free";
        setGeneratedImages(prev => [{ url: data.imageUrl!, quality: q }, ...prev]);
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

  // Upload image for 3D conversion
  const handleFileUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("请上传图片文件"); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error("图片大小不能超过 8MB"); return; }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const resp = await fetch("/api/upload-image", { method: "POST", body: formData });
      if (!resp.ok) throw new Error("Upload failed");
      const data = await resp.json();
      setUploadedImageUrl(data.url);
      toast.success("图片上传成功！");
    } catch {
      toast.error("上传失败，请重试");
    } finally {
      setUploading(false);
    }
  }, []);

  // Use a generated 2D image for 3D conversion
  const useImageFor3D = (url: string) => {
    setUploadedImageUrl(url);
    setActiveTab("to3d");
    toast.success("已选择图片，切换到 2D 转 3D");
  };

  const handleGenerate3D = () => {
    if (!uploadedImageUrl) { toast.error("请先上传或选择一张图片"); return; }
    setGenerating3d(true);
    generate3dMutation.mutate({
      inputImageUrl: uploadedImageUrl,
      mode: mode3d,
      enablePbr,
      enableGeometry,
    });
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="pt-32 text-center container">
          <Sparkles className="h-16 w-16 text-primary mx-auto mb-6" />
          <h1 className="text-3xl font-bold mb-4">虚拟偶像工坊</h1>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">AI 生成虚拟偶像形象，支持免费 / 2K / 4K 三档画质，并可将 2D 图片转换为 3D 模型</p>
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
          <p className="text-muted-foreground">AI 生成虚拟偶像形象 · 免费 / 2K / 4K 三档画质 · 2D 转 3D 模型</p>
        </div>

        {/* Tab Switch */}
        <div className="flex gap-2 mb-8">
          <Button
            variant={activeTab === "generate" ? "default" : "outline"}
            onClick={() => setActiveTab("generate")}
            className={`gap-2 ${activeTab === "generate" ? "bg-primary text-primary-foreground" : ""}`}
          >
            <ImageIcon className="h-4 w-4" /> AI 偶像生成
          </Button>
          <Button
            variant={activeTab === "to3d" ? "default" : "outline"}
            onClick={() => setActiveTab("to3d")}
            className={`gap-2 ${activeTab === "to3d" ? "bg-primary text-primary-foreground" : ""}`}
          >
            <Box className="h-4 w-4" /> 2D 转 3D
          </Button>
        </div>

        {/* ═══ Tab: AI 偶像生成 ═══ */}
        {activeTab === "generate" && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            <div className="lg:col-span-2 space-y-6">
              <Card className="bg-card/50 border-border/50">
                <CardContent className="p-6 space-y-5">
                  {/* Description */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">偶像描述</label>
                    <Textarea
                      placeholder="例如：一位蓝色长发的少女，穿着白色连衣裙，手持吉他，站在樱花树下..."
                      rows={4}
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      className="bg-background/50"
                    />
                  </div>

                  {/* Style Selection */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">艺术风格</label>
                    <Select value={style} onValueChange={(v) => setStyle(v as IdolStyle)}>
                      <SelectTrigger className="bg-background/50"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STYLES.map(s => (
                          <SelectItem key={s.value} value={s.value}>{s.label} - {s.desc}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {STYLES.map(s => (
                      <button
                        key={s.value}
                        onClick={() => setStyle(s.value)}
                        className={`p-2 rounded-lg text-center text-xs transition-all ${
                          style === s.value
                            ? "bg-primary/20 border border-primary/50 text-primary"
                            : "bg-background/30 border border-border/30 text-muted-foreground hover:border-primary/30"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>

                  {/* Quality Selection - 三档 */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">画质档位</label>
                    <div className="space-y-2">
                      {QUALITY_TIERS.map(tier => {
                        const Icon = tier.icon;
                        const isSelected = quality === tier.id;
                        return (
                          <button
                            key={tier.id}
                            onClick={() => setQuality(tier.id)}
                            className={`w-full p-3 rounded-lg text-left transition-all flex items-center gap-3 ${
                              isSelected
                                ? `border-2 ${tier.color}`
                                : "bg-background/30 border-2 border-border/30 hover:border-primary/30"
                            }`}
                          >
                            <Icon className={`h-5 w-5 flex-shrink-0 ${isSelected ? "" : "text-muted-foreground"}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{tier.label}</span>
                                <span className="text-xs text-muted-foreground">{tier.desc}</span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                {tier.credits > 0 ? (
                                  <span className="text-xs font-medium text-primary/70">{tier.credits} Credits</span>
                                ) : (
                                  <span className="text-xs font-medium text-green-400">免费</span>
                                )}
                              </div>
                            </div>
                            {isSelected && (
                              <div className="w-2 h-2 rounded-full bg-current flex-shrink-0" />
                            )}
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

                  {quality !== "free" && (
                    <p className="text-xs text-center text-muted-foreground">
                      本次生成将消耗 <span className="text-primary font-medium">{quality === "2k" ? CREDIT_COSTS.storyboardImage2K : CREDIT_COSTS.storyboardImage4K} Credits</span>，生成失败自动退回
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right: Generated Results */}
            <div className="lg:col-span-3">
              {generatedImages.length === 0 && !generating ? (
                <div className="h-full min-h-[300px] flex items-center justify-center border-2 border-dashed border-border/30 rounded-xl p-12">
                  <div className="text-center">
                    <Sparkles className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                    <p className="text-muted-foreground">生成的偶像形象将显示在这里</p>
                    <p className="text-sm text-muted-foreground/60 mt-1">输入描述并选择风格和画质开始创作</p>
                    <div className="flex items-center justify-center gap-4 mt-4 text-xs text-muted-foreground/50">
                      <span className="flex items-center gap-1"><Star className="h-3 w-3 text-green-400" /> 免费版</span>
                      <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-blue-400" /> 2K 高清</span>
                      <span className="flex items-center gap-1"><Crown className="h-3 w-3 text-amber-400" /> 4K 超清</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {generating && (
                    <Card className="bg-card/50 border-border/50">
                      <CardContent className="p-8 text-center">
                        <Loader2 className="h-10 w-10 text-primary mx-auto mb-4 animate-spin" />
                        <p className="font-medium">AI 正在创作中...</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          {quality === "4k" ? "4K 超清模式，预计 15-30 秒" : quality === "2k" ? "2K 高清模式，预计 10-20 秒" : "标准模式，预计 10-20 秒"}
                        </p>
                      </CardContent>
                    </Card>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {generatedImages.map((img, i) => (
                      <Card key={i} className="overflow-hidden bg-card/50 border-border/50 group">
                        <div className="relative aspect-square">
                          <img src={img.url} alt={`虚拟偶像 ${i + 1}`} className="w-full h-full object-cover" />
                          {/* Quality badge */}
                          <div className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs font-medium ${
                            img.quality === "4k" ? "bg-amber-500/80 text-white" :
                            img.quality === "2k" ? "bg-blue-500/80 text-white" :
                            "bg-green-500/80 text-white"
                          }`}>
                            {img.quality === "4k" ? "4K" : img.quality === "2k" ? "2K" : "标准"}
                          </div>
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                            <Button size="sm" variant="outline" className="bg-black/50 border-white/30 text-white" onClick={() => window.open(img.url, "_blank")}>
                              <Download className="h-4 w-4 mr-1" /> 下载
                            </Button>
                            <Button size="sm" variant="outline" className="bg-black/50 border-white/30 text-white" onClick={() => useImageFor3D(img.url)}>
                              <Box className="h-4 w-4 mr-1" /> 转 3D
                            </Button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ Tab: 2D 转 3D ═══ */}
        {activeTab === "to3d" && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            {/* Left: Controls */}
            <div className="lg:col-span-2 space-y-6">
              <Card className="bg-card/50 border-border/50">
                <CardContent className="p-6 space-y-5">
                  {/* Image Upload */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">上传参考图片</label>
                    <p className="text-xs text-muted-foreground mb-3">支持 JPG/PNG/WEBP，128-5000px，最大 8MB。建议：简单背景、单个物体、物体占画面 50% 以上</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
                    />
                    {uploadedImageUrl ? (
                      <div className="relative rounded-lg overflow-hidden border border-border/50">
                        <img src={uploadedImageUrl} alt="参考图" className="w-full aspect-square object-cover" />
                        <Button
                          size="sm"
                          variant="outline"
                          className="absolute top-2 right-2 bg-black/50 border-white/30 text-white"
                          onClick={() => { setUploadedImageUrl(""); fileInputRef.current && (fileInputRef.current.value = ""); }}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" /> 更换
                        </Button>
                      </div>
                    ) : (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="w-full border-2 border-dashed border-border/50 rounded-lg p-8 text-center hover:border-primary/50 transition-colors"
                      >
                        {uploading ? (
                          <Loader2 className="h-8 w-8 text-primary mx-auto animate-spin" />
                        ) : (
                          <Upload className="h-8 w-8 text-muted-foreground/50 mx-auto" />
                        )}
                        <p className="text-sm text-muted-foreground mt-2">
                          {uploading ? "上传中..." : "点击上传或拖拽图片"}
                        </p>
                      </button>
                    )}
                  </div>

                  {/* Mode Selection */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">生成模式</label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => setMode3d("rapid")}
                        className={`p-3 rounded-lg text-left transition-all ${
                          mode3d === "rapid"
                            ? "bg-blue-500/10 border-2 border-blue-500/50"
                            : "bg-background/30 border-2 border-border/30 hover:border-primary/30"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <Zap className="h-4 w-4 text-blue-400" />
                          <span className="font-medium text-sm">Rapid 快速版</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">~30 秒 · {CREDIT_COSTS.idol3DRapid} Credits</div>
                        <div className="text-xs text-blue-400/70 mt-0.5">$0.225/次</div>
                      </button>
                      <button
                        onClick={() => setMode3d("pro")}
                        className={`p-3 rounded-lg text-left transition-all ${
                          mode3d === "pro"
                            ? "bg-amber-500/10 border-2 border-amber-500/50"
                            : "bg-background/30 border-2 border-border/30 hover:border-primary/30"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <Crown className="h-4 w-4 text-amber-400" />
                          <span className="font-medium text-sm">Pro 高质量版</span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">~60 秒 · {CREDIT_COSTS.idol3DPro} Credits</div>
                        <div className="text-xs text-amber-400/70 mt-0.5">$0.375/次</div>
                      </button>
                    </div>
                  </div>

                  {/* Advanced Options */}
                  <div>
                    <label className="text-sm font-medium mb-2 block">高级选项</label>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={enablePbr}
                          onChange={e => { setEnablePbr(e.target.checked); if (e.target.checked) setEnableGeometry(false); }}
                          className="rounded border-border"
                        />
                        <span>PBR 材质</span>
                        <span className="text-xs text-muted-foreground">（金属、粗糙度、法线贴图）</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={enableGeometry}
                          onChange={e => { setEnableGeometry(e.target.checked); if (e.target.checked) setEnablePbr(false); }}
                          className="rounded border-border"
                        />
                        <span>仅几何白模</span>
                        <span className="text-xs text-muted-foreground">（无纹理，纯白色模型）</span>
                      </label>
                    </div>
                  </div>

                  <Button
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
                    disabled={generating3d || !uploadedImageUrl}
                    onClick={handleGenerate3D}
                  >
                    {generating3d ? <Loader2 className="h-4 w-4 animate-spin" /> : <Box className="h-4 w-4" />}
                    {generating3d ? "3D 模型生成中..." : "生成 3D 模型"}
                  </Button>

                  <p className="text-xs text-center text-muted-foreground">
                    本次生成将消耗 <span className="text-primary font-medium">{mode3d === "rapid" ? CREDIT_COSTS.idol3DRapid : CREDIT_COSTS.idol3DPro} Credits</span>，生成失败自动退回
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Right: 3D Results */}
            <div className="lg:col-span-3">
              {generating3d && (
                <Card className="bg-card/50 border-border/50 mb-4">
                  <CardContent className="p-8 text-center">
                    <Loader2 className="h-10 w-10 text-primary mx-auto mb-4 animate-spin" />
                    <p className="font-medium">Hunyuan3D 正在生成 3D 模型...</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {mode3d === "rapid" ? "Rapid 模式约需 30 秒" : "Pro 模式约需 60 秒"}
                    </p>
                  </CardContent>
                </Card>
              )}

              {history3d.data && history3d.data.length > 0 ? (
                <div className="space-y-4">
                  <h3 className="text-lg font-semibold">生成历史</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                          ) : gen.status === "pending" && gen.thumbnailUrl ? (
                            <img src={gen.thumbnailUrl} alt="Preview" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Box className="h-12 w-12 text-muted-foreground/30" />
                            </div>
                          )}
                        </div>
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
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
                          <p className="text-xs text-muted-foreground">
                            {new Date(gen.createdAt).toLocaleString()}
                          </p>
                          {gen.status === "completed" && (
                            <div className="flex gap-1 mt-2 flex-wrap">
                              {gen.modelGlbUrl && (
                                <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => window.open(gen.modelGlbUrl!, "_blank")}>
                                  <Download className="h-3 w-3 mr-1" /> GLB
                                </Button>
                              )}
                              {gen.modelObjUrl && (
                                <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => window.open(gen.modelObjUrl!, "_blank")}>
                                  <Download className="h-3 w-3 mr-1" /> OBJ
                                </Button>
                              )}
                              {gen.modelFbxUrl && (
                                <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => window.open(gen.modelFbxUrl!, "_blank")}>
                                  <Download className="h-3 w-3 mr-1" /> FBX
                                </Button>
                              )}
                              {gen.modelUsdzUrl && (
                                <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => window.open(gen.modelUsdzUrl!, "_blank")}>
                                  <Download className="h-3 w-3 mr-1" /> USDZ
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
                <div className="h-full min-h-[300px] flex items-center justify-center border-2 border-dashed border-border/30 rounded-xl p-12">
                  <div className="text-center">
                    <Box className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                    <p className="text-muted-foreground">上传图片并生成 3D 模型</p>
                    <p className="text-sm text-muted-foreground/60 mt-1">支持 Rapid（快速）和 Pro（高质量）两种模式</p>
                    <p className="text-xs text-muted-foreground/40 mt-3">输出格式：GLB / OBJ / FBX / USDZ</p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* model-viewer script */}
      <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js" />
    </div>
  );
}
