import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Loader2, Download, Upload, Box, RotateCcw, Crown, Zap,
  Sparkles, Check, Info, ChevronDown, ChevronUp, Layers,
  Palette, Eye, Settings2, ShoppingBag, ArrowRight,
} from "lucide-react";
import { CREDIT_COSTS, DIMENSION_PACKS } from "@shared/plans";
import Navbar from "@/components/Navbar";

// ─── Types ──────────────────────────────────────
type ModelTier = "rapid" | "pro";
type TabType = "generate" | "compare" | "pricing";

interface TierConfig {
  id: ModelTier;
  name: string;
  subtitle: string;
  icon: typeof Zap;
  color: string;
  borderColor: string;
  bgColor: string;
  badge: string;
  badgeColor: string;
  time: string;
  baseCredits: number;
  features: string[];
}

const TIERS: TierConfig[] = [
  {
    id: "rapid",
    name: "闪电 3D",
    subtitle: "快速预览 · 30 秒出模",
    icon: Zap,
    color: "text-cyan-400",
    borderColor: "border-cyan-500/50",
    bgColor: "bg-cyan-500/10",
    badge: "RAPID",
    badgeColor: "bg-cyan-500/20 text-cyan-400",
    time: "~30 秒",
    baseCredits: CREDIT_COSTS.rapid3D,
    features: [
      "30 秒极速出模",
      "标准网格质量",
      "自动 UV 展开",
      "GLB / OBJ 导出",
      "可选 PBR 材质",
    ],
  },
  {
    id: "pro",
    name: "精雕 3D",
    subtitle: "影视级品质 · 60 秒精雕",
    icon: Crown,
    color: "text-amber-400",
    borderColor: "border-amber-500/50",
    bgColor: "bg-amber-500/10",
    badge: "PRO",
    badgeColor: "bg-amber-500/20 text-amber-400",
    time: "~60 秒",
    baseCredits: CREDIT_COSTS.pro3D,
    features: [
      "影视级网格精度",
      "高密度拓扑结构",
      "PBR 材质支持",
      "多视角输入",
      "自定义面数控制",
      "GLB / OBJ 导出",
    ],
  },
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
export default function ThreeDStudio() {
  const { isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>("generate");

  // Generation state
  const [selectedTier, setSelectedTier] = useState<ModelTier>("rapid");
  const [enablePbr, setEnablePbr] = useState(false);
  const [enableMultiview, setEnableMultiview] = useState(false);
  const [enableCustomFaces, setEnableCustomFaces] = useState(false);
  const [targetFaceCount, setTargetFaceCount] = useState(50000);
  const [textureResolution, setTextureResolution] = useState<"512" | "1024" | "2048">("1024");
  const [outputFormat, setOutputFormat] = useState<"glb" | "obj">("glb");
  const [uploadedImageUrl, setUploadedImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Queries
  const statusQuery = trpc.hunyuan3d.status.useQuery();
  const history = trpc.hunyuan3d.myList.useQuery(undefined, { enabled: isAuthenticated && activeTab === "generate" });

  // Cost estimation
  const costEstimate = trpc.hunyuan3d.estimateCost.useQuery(
    { tier: selectedTier, enablePbr, enableMultiview, enableCustomFaces },
    { placeholderData: (prev) => prev }
  );

  const currentCredits = useMemo(() => {
    return costEstimate.data?.credits ?? TIERS.find(t => t.id === selectedTier)?.baseCredits ?? 0;
  }, [costEstimate.data, selectedTier]);

  // Mutations
  const generateMutation = trpc.hunyuan3d.generate.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`3D 模型生成成功！耗时 ${(data as any).timeTaken?.toFixed(1) ?? "?"}s`);
        history.refetch();
      } else {
        toast.error(data.error || "3D 生成失败");
      }
      setGenerating(false);
    },
    onError: (err) => { toast.error(err.message || "3D 生成失败，请重试"); setGenerating(false); },
  });

  // Upload handler
  const handleFileUpload = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("请上传图片文件（JPG/PNG）"); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error("图片大小不能超过 10MB"); return; }
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

  const handleGenerate = () => {
    if (!uploadedImageUrl) { toast.error("请先上传一张 2D 图片"); return; }
    setGenerating(true);
    generateMutation.mutate({
      imageUrl: uploadedImageUrl,
      tier: selectedTier,
      enablePbr,
      enableMultiview: selectedTier === "pro" ? enableMultiview : false,
      enableCustomFaces: selectedTier === "pro" ? enableCustomFaces : false,
      targetFaceCount: enableCustomFaces ? targetFaceCount : undefined,
      textureResolution,
      outputFormat,
    });
  };

  // ─── Not Authenticated ─────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="pt-16">
          <div className="container py-20 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/30 mb-6">
              <Sparkles className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-semibold text-amber-400 tracking-wider">HUNYUAN3D v3.1</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold mb-4">
              2D 图片 <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-amber-400 to-green-400">→ 3D 模型</span>
            </h1>
            <p className="text-muted-foreground max-w-lg mx-auto mb-8">
              上传一张 2D 图片，AI 自动生成高质量 3D 模型。支持 GLB / OBJ 导出，可直接导入 Blender、Unity、Unreal Engine。
            </p>
            <Button onClick={() => { window.location.href = getLoginUrl(); }} className="bg-primary text-primary-foreground">
              登录开始创作
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Tab Navigation ────────────────────────────
  const tabs = [
    { id: "generate" as const, label: "生成 3D", icon: Box },
    { id: "compare" as const, label: "模式对比", icon: Layers },
    { id: "pricing" as const, label: "维度收费包", icon: ShoppingBag },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="pt-16">
        {/* Header */}
        <div className="relative overflow-hidden py-12 md:py-16 px-6">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/8 via-amber-500/5 to-purple-500/8" />
          <div className="relative text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 mb-4">
              <Sparkles className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-xs font-bold text-amber-400 tracking-widest">HUNYUAN3D v3.1</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
              2D 图片 <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-amber-400 to-green-400">→ 3D 模型</span>
            </h1>
            <p className="text-muted-foreground mt-3 max-w-md mx-auto text-sm">
              闪电 3D · 精雕 3D · PBR 材质 · 多视角 · GLB/OBJ 导出
            </p>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex justify-center gap-2 px-6 py-3 border-b border-border/50 bg-background/80 backdrop-blur-sm">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                activeTab === tab.id
                  ? "bg-amber-500/10 border border-amber-500/30 text-amber-400"
                  : "bg-card/50 text-muted-foreground hover:text-foreground hover:bg-card"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="container max-w-6xl py-8">
          {/* ===== Generate Tab ===== */}
          {activeTab === "generate" && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Left: Controls */}
              <div className="lg:col-span-2 space-y-5">
                {/* Tier Selection */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Settings2 className="h-4 w-4 text-muted-foreground" />
                    选择模式
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {TIERS.map((tier) => (
                      <button
                        key={tier.id}
                        onClick={() => {
                          setSelectedTier(tier.id);
                          if (tier.id === "rapid") {
                            setEnableMultiview(false);
                            setEnableCustomFaces(false);
                          }
                        }}
                        className={`relative p-4 rounded-xl text-left transition-all border-2 ${
                          selectedTier === tier.id
                            ? `${tier.bgColor} ${tier.borderColor}`
                            : "bg-card/30 border-border/30 hover:border-border/60"
                        }`}
                      >
                        {selectedTier === tier.id && (
                          <div className={`absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center ${tier.bgColor}`}>
                            <Check className={`h-3.5 w-3.5 ${tier.color}`} />
                          </div>
                        )}
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${tier.badgeColor} mb-2`}>
                          {tier.badge}
                        </span>
                        <div className="flex items-center gap-1.5 mb-1">
                          <tier.icon className={`h-4 w-4 ${tier.color}`} />
                          <span className="font-bold text-sm">{tier.name}</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{tier.subtitle}</p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span>{tier.time}</span>
                          <span className="text-amber-400 font-semibold">{tier.baseCredits} Credits 起</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Upload Area */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    上传 2D 图片
                  </h3>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }}
                  />
                  {uploadedImageUrl ? (
                    <div className="relative rounded-xl overflow-hidden border-2 border-border/50">
                      <img src={uploadedImageUrl} alt="Uploaded" className="w-full h-56 object-cover" />
                      <Button
                        size="sm"
                        variant="outline"
                        className="absolute top-3 right-3 bg-black/60 border-white/30 text-white hover:bg-black/80"
                        onClick={() => { setUploadedImageUrl(""); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" /> 更换
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="w-full border-2 border-dashed border-border/50 rounded-xl p-10 text-center hover:border-cyan-500/40 transition-colors"
                    >
                      <div className="w-16 h-16 rounded-full bg-cyan-500/10 flex items-center justify-center mx-auto mb-3">
                        {uploading ? (
                          <Loader2 className="h-7 w-7 text-cyan-400 animate-spin" />
                        ) : (
                          <Upload className="h-7 w-7 text-cyan-400" />
                        )}
                      </div>
                      <p className="font-semibold text-sm">{uploading ? "上传中..." : "点击上传图片"}</p>
                      <p className="text-xs text-muted-foreground mt-1">支持 JPG / PNG，最大 10MB</p>
                    </button>
                  )}
                </div>

                {/* Options */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Palette className="h-4 w-4 text-muted-foreground" />
                    生成选项
                  </h3>
                  <div className="space-y-2">
                    {/* PBR */}
                    <button
                      onClick={() => setEnablePbr(!enablePbr)}
                      className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${
                        enablePbr
                          ? "bg-green-500/5 border-green-500/40"
                          : "bg-card/30 border-border/30 hover:border-border/60"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Palette className={`h-4 w-4 ${enablePbr ? "text-green-400" : "text-muted-foreground"}`} />
                        <div className="text-left">
                          <span className="text-sm font-medium">PBR 材质</span>
                          <p className="text-xs text-muted-foreground">金属度、粗糙度、法线贴图</p>
                        </div>
                      </div>
                      <span className="text-xs text-amber-400 font-semibold">+3 Credits</span>
                    </button>

                    {/* Pro-only: Multiview */}
                    {selectedTier === "pro" && (
                      <button
                        onClick={() => setEnableMultiview(!enableMultiview)}
                        className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${
                          enableMultiview
                            ? "bg-purple-500/5 border-purple-500/40"
                            : "bg-card/30 border-border/30 hover:border-border/60"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Eye className={`h-4 w-4 ${enableMultiview ? "text-purple-400" : "text-muted-foreground"}`} />
                          <div className="text-left">
                            <span className="text-sm font-medium">多视角输入</span>
                            <p className="text-xs text-muted-foreground">多角度参考提升精度</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">PRO</span>
                          <span className="text-xs text-amber-400 font-semibold">+3 Credits</span>
                        </div>
                      </button>
                    )}

                    {/* Pro-only: Custom Faces */}
                    {selectedTier === "pro" && (
                      <button
                        onClick={() => setEnableCustomFaces(!enableCustomFaces)}
                        className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${
                          enableCustomFaces
                            ? "bg-orange-500/5 border-orange-500/40"
                            : "bg-card/30 border-border/30 hover:border-border/60"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Layers className={`h-4 w-4 ${enableCustomFaces ? "text-orange-400" : "text-muted-foreground"}`} />
                          <div className="text-left">
                            <span className="text-sm font-medium">自定义面数</span>
                            <p className="text-xs text-muted-foreground">控制网格密度（默认 50K 面）</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">PRO</span>
                          <span className="text-xs text-amber-400 font-semibold">+3 Credits</span>
                        </div>
                      </button>
                    )}

                    {enableCustomFaces && selectedTier === "pro" && (
                      <div className="pl-10 pr-3 pb-1">
                        <label className="text-xs text-muted-foreground mb-1 block">面数: {targetFaceCount.toLocaleString()}</label>
                        <input
                          type="range"
                          min={10000}
                          max={200000}
                          step={5000}
                          value={targetFaceCount}
                          onChange={(e) => setTargetFaceCount(Number(e.target.value))}
                          className="w-full accent-amber-400"
                        />
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>10K</span><span>200K</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Advanced Options */}
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  高级设置
                </button>
                {showAdvanced && (
                  <div className="space-y-3 pl-2 border-l-2 border-border/30">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">纹理分辨率</label>
                      <div className="flex gap-2">
                        {(["512", "1024", "2048"] as const).map((res) => (
                          <button
                            key={res}
                            onClick={() => setTextureResolution(res)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                              textureResolution === res
                                ? "bg-primary/10 border border-primary/40 text-primary"
                                : "bg-card/30 border border-border/30 text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {res}px
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground mb-1 block">输出格式</label>
                      <div className="flex gap-2">
                        {(["glb", "obj"] as const).map((fmt) => (
                          <button
                            key={fmt}
                            onClick={() => setOutputFormat(fmt)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium uppercase transition-all ${
                              outputFormat === fmt
                                ? "bg-primary/10 border border-primary/40 text-primary"
                                : "bg-card/30 border border-border/30 text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            {fmt}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Cost Summary */}
                <Card className="bg-card/50 border-border/50">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">模式</span>
                      <span className="font-medium">{selectedTier === "rapid" ? "闪电 3D" : "精雕 3D"}</span>
                    </div>
                    {enablePbr && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">PBR 材质</span>
                        <span className="text-green-400">+3 Credits</span>
                      </div>
                    )}
                    {enableMultiview && selectedTier === "pro" && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">多视角</span>
                        <span className="text-purple-400">+3 Credits</span>
                      </div>
                    )}
                    {enableCustomFaces && selectedTier === "pro" && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">自定义面数</span>
                        <span className="text-orange-400">+3 Credits</span>
                      </div>
                    )}
                    <div className="border-t border-border/30 pt-2 flex justify-between">
                      <span className="font-bold">总计</span>
                      <span className="text-lg font-extrabold text-amber-400">{currentCredits} Credits</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Generate Button */}
                <Button
                  className="w-full h-14 text-base font-bold bg-gradient-to-r from-cyan-500 via-amber-500 to-green-500 text-black hover:opacity-90 transition-opacity rounded-xl"
                  disabled={generating || !uploadedImageUrl || !statusQuery.data?.available}
                  onClick={handleGenerate}
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      {selectedTier === "rapid" ? "闪电生成中..." : "精雕生成中..."}
                    </>
                  ) : (
                    <>
                      <Box className="h-5 w-5 mr-2" />
                      开始生成 · {currentCredits} Credits
                    </>
                  )}
                </Button>

                <p className="text-xs text-center text-muted-foreground">
                  生成失败自动退回 Credits · 输出 {outputFormat.toUpperCase()} 格式
                </p>
              </div>

              {/* Right: Results */}
              <div className="lg:col-span-3">
                {generating && (
                  <Card className="bg-card/50 border-border/50 mb-4">
                    <CardContent className="p-8 text-center">
                      <Loader2 className="h-10 w-10 text-primary mx-auto mb-4 animate-spin" />
                      <p className="font-semibold">Hunyuan3D 正在生成 3D 模型...</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {selectedTier === "rapid" ? "闪电模式约需 30 秒" : "精雕模式约需 60 秒"}
                      </p>
                    </CardContent>
                  </Card>
                )}

                {history.data && history.data.length > 0 ? (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold">生成历史</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {history.data.map((gen) => (
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
                                <Box className="h-12 w-12 text-muted-foreground/30" />
                              </div>
                            )}
                          </div>
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                                gen.mode === "pro" ? "bg-amber-500/20 text-amber-400" : "bg-cyan-500/20 text-cyan-400"
                              }`}>
                                {gen.mode === "pro" ? "精雕 PRO" : "闪电 RAPID"}
                              </span>
                              <span className={`text-xs font-medium ${
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
                              {gen.creditsUsed > 0 && ` · ${gen.creditsUsed} Credits`}
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
                                {gen.textureUrl && (
                                  <Button size="sm" variant="outline" className="text-xs h-7 px-2" onClick={() => window.open(gen.textureUrl!, "_blank")}>
                                    <Download className="h-3 w-3 mr-1" /> 纹理
                                  </Button>
                                )}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ) : !generating ? (
                  <div className="h-full min-h-[400px] flex items-center justify-center border-2 border-dashed border-border/30 rounded-xl p-12">
                    <div className="text-center">
                      <Box className="h-16 w-16 text-muted-foreground/20 mx-auto mb-4" />
                      <p className="text-lg font-semibold text-muted-foreground">上传图片开始 3D 创作</p>
                      <p className="text-sm text-muted-foreground/60 mt-2">支持闪电（快速）和精雕（高质量）两种模式</p>
                      <p className="text-xs text-muted-foreground/40 mt-4">输出格式：GLB / OBJ · 可导入 Blender / Unity / Unreal</p>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* ===== Compare Tab ===== */}
          {activeTab === "compare" && (
            <div className="space-y-8">
              <div>
                <h2 className="text-2xl font-bold mb-2">闪电 3D vs 精雕 3D</h2>
                <p className="text-muted-foreground">两种模式各有所长，根据您的需求选择最合适的方案</p>
              </div>

              {/* Comparison Table */}
              <div className="rounded-xl border border-border/50 overflow-hidden">
                <div className="grid grid-cols-3 bg-card/80 p-4 border-b border-border/50">
                  <div className="font-bold">对比项</div>
                  <div className="font-bold text-cyan-400 text-center">闪电 3D (Rapid)</div>
                  <div className="font-bold text-amber-400 text-center">精雕 3D (Pro)</div>
                </div>
                {[
                  ["生成时间", "~30 秒", "~60 秒"],
                  ["网格质量", "标准", "影视级高精度"],
                  ["纹理分辨率", "512 / 1024", "512 / 1024 / 2048"],
                  ["PBR 材质", "可选（+3 Credits）", "可选（+3 Credits）"],
                  ["多视角输入", "不支持", "支持（+3 Credits）"],
                  ["自定义面数", "不支持", "支持（+3 Credits）"],
                  ["基础价格", `${CREDIT_COSTS.rapid3D} Credits`, `${CREDIT_COSTS.pro3D} Credits`],
                  ["最高价格", `${CREDIT_COSTS.rapid3D_pbr} Credits`, `${CREDIT_COSTS.pro3D_full} Credits`],
                  ["输出格式", "GLB / OBJ", "GLB / OBJ"],
                  ["适用场景", "快速预览、概念验证", "影视制作、游戏资产"],
                ].map(([label, rapid, pro], i) => (
                  <div key={i} className={`grid grid-cols-3 p-3 ${i % 2 === 0 ? "bg-card/30" : ""} border-b border-border/20 last:border-0`}>
                    <div className="text-sm font-medium">{label}</div>
                    <div className="text-sm text-center text-muted-foreground">{rapid}</div>
                    <div className="text-sm text-center text-muted-foreground">{pro}</div>
                  </div>
                ))}
              </div>

              {/* Use Cases */}
              <div>
                <h3 className="text-lg font-bold mb-4">推荐使用场景</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { scene: "社交媒体 3D 头像", tier: "闪电 3D", tierColor: "text-cyan-400", borderColor: "border-l-cyan-500", reason: "快速出模，效果足够" },
                    { scene: "游戏角色资产", tier: "精雕 3D + PBR", tierColor: "text-amber-400", borderColor: "border-l-amber-500", reason: "高精度网格 + PBR 材质" },
                    { scene: "电商产品展示", tier: "精雕 3D", tierColor: "text-amber-400", borderColor: "border-l-amber-500", reason: "高质量纹理还原" },
                    { scene: "概念设计验证", tier: "闪电 3D", tierColor: "text-cyan-400", borderColor: "border-l-cyan-500", reason: "快速迭代，低成本" },
                    { scene: "影视 VFX 预览", tier: "精雕 3D + 多视角", tierColor: "text-amber-400", borderColor: "border-l-amber-500", reason: "多角度参考提升精度" },
                    { scene: "建筑可视化", tier: "精雕 3D + 自定义面数", tierColor: "text-amber-400", borderColor: "border-l-amber-500", reason: "精确控制模型复杂度" },
                  ].map((item, i) => (
                    <div key={i} className={`bg-card/50 rounded-xl p-4 border-l-4 ${item.borderColor}`}>
                      <p className="font-bold text-sm mb-1">{item.scene}</p>
                      <div className="flex items-center gap-2 mb-1">
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className={`text-sm font-semibold ${item.tierColor}`}>{item.tier}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{item.reason}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Compatible Software */}
              <div>
                <h3 className="text-lg font-bold mb-4">兼容软件</h3>
                <div className="flex flex-wrap gap-3">
                  {[
                    { name: "Blender", desc: "开源 3D" },
                    { name: "Unity", desc: "游戏引擎" },
                    { name: "Unreal Engine", desc: "虚幻引擎" },
                    { name: "Cinema 4D", desc: "动态设计" },
                    { name: "Maya", desc: "影视动画" },
                    { name: "3ds Max", desc: "建筑可视化" },
                    { name: "ZBrush", desc: "数字雕刻" },
                    { name: "Substance", desc: "材质绘制" },
                  ].map((sw) => (
                    <div key={sw.name} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card/50 border border-border/30">
                      <span className="text-sm font-semibold">{sw.name}</span>
                      <span className="text-[10px] text-muted-foreground">{sw.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ===== Pricing Tab ===== */}
          {activeTab === "pricing" && (
            <div className="space-y-8">
              <div>
                <h2 className="text-2xl font-bold mb-2">维度系列 · 3D 收费包</h2>
                <p className="text-muted-foreground">批量购买更优惠，适合不同创作需求</p>
              </div>

              {/* Dimension Packs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                {DIMENSION_PACKS.map((pack, i) => (
                  <Card
                    key={i}
                    className={`relative overflow-hidden border-2 transition-all hover:scale-[1.02] ${
                      (pack as any).popular ? "border-purple-500/50 shadow-lg shadow-purple-500/10" : "border-border/50"
                    }`}
                    style={{ borderColor: `${pack.color}40` }}
                  >
                    {(pack as any).popular && (
                      <div className="absolute top-0 right-5 px-3 py-1 rounded-b-lg text-[10px] font-bold text-black" style={{ backgroundColor: pack.color }}>
                        最受欢迎
                      </div>
                    )}
                    <CardContent className="p-5">
                      <h4 className="text-lg font-extrabold mb-0.5" style={{ color: pack.color }}>{pack.name}</h4>
                      <p className="text-xs text-muted-foreground mb-3">{pack.subtitle}</p>
                      <p className="text-2xl font-extrabold mb-1">{pack.price}</p>
                      {pack.discount && <p className="text-xs text-green-400 font-semibold mb-3">{pack.discount}</p>}
                      <div className="h-px bg-border/30 my-3" />
                      <p className="text-xs text-muted-foreground leading-relaxed">{pack.contents}</p>
                      <Button
                        className="w-full mt-4 rounded-xl font-bold"
                        variant="outline"
                        style={{ borderColor: `${pack.color}40`, color: pack.color }}
                        onClick={() => {
                          if (pack.price === "免费") {
                            toast.success("体验包已领取！");
                          } else {
                            toast("功能即将上线", { description: "收费包购买功能正在开发中" });
                          }
                        }}
                      >
                        {pack.price === "免费" ? "立即领取" : "立即购买"}
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Subscription Table */}
              <div>
                <h3 className="text-lg font-bold mb-4">订阅方案 · 每月 3D 额度</h3>
                <div className="rounded-xl border border-border/50 overflow-hidden">
                  <div className="grid grid-cols-3 bg-card/80 p-4 border-b border-border/50">
                    <div className="font-bold">订阅等级</div>
                    <div className="font-bold text-center">每月 3D 额度</div>
                    <div className="font-bold text-center">可用模式</div>
                  </div>
                  {[
                    ["免费版", "闪电 3D × 3 次", "仅闪电"],
                    ["初级会员 ¥108/月", "闪电 × 15 + 精雕 × 5", "全部"],
                    ["高级会员 ¥358/月", "闪电 × 50 + 精雕 × 20", "全部 + 优先"],
                    ["学生版", "闪电 × 8 + 精雕 × 2", "全部"],
                  ].map(([plan, quota, mode], i) => (
                    <div key={i} className={`grid grid-cols-3 p-3 ${i % 2 === 0 ? "bg-card/30" : ""} border-b border-border/20 last:border-0`}>
                      <div className="text-sm font-semibold">{plan}</div>
                      <div className="text-sm text-center text-muted-foreground">{quota}</div>
                      <div className="text-sm text-center text-muted-foreground">{mode}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
