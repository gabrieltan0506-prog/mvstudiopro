// @ts-nocheck
import React, { useState, useCallback, useRef } from "react";
import { ExpiryWarningBanner, CreationHistoryPanel } from "@/components/CreationManager";
import { useLocation, Link } from "wouter";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { ModelViewer } from "@/components/ModelViewer"; // Assuming this component exists for web
import { CREDIT_COSTS } from "@/lib/credits";
import { 
  View, Box, Zap, Sparkles, Wand2, GitCompare, Ticket, Upload, CheckCircle2, Check, AlertCircle, 
  CheckCircle, Download, Layers, GalleryVertical, Orbit, Gamepad2, Puzzle, DraftingCompass, Film, ArrowRight, Loader2, X
} from "lucide-react";

/* ===== 对比图数据 ===== */
const COMPARISON_IMAGES = {
  astronaut: {
    title: "宇航员模型",
    desc: "左：精雕 3D + PBR 材质（颜色、光照、细节完整）\n右：闪电 3D 基础 mesh（几何结构清晰，无材质）",
    url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/dw5mTl5cKGtD.webp",
  },
  cartoon: {
    title: "卡通角色转换",
    desc: "2D 图片 → 3D 模型，卷发、格子衬衫、相机细节完美还原",
    url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/4DcnKuTCvPgM.jpg",
  },
  warrior: {
    title: "高精度角色",
    desc: "Hunyuan3D 3.1 Pro 生成，毛发纹理、盔甲、腰带扣等细节极致还原",
    url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663335430453/zre1qFWcy4sn.jpg",
  },
};

/* ===== 模式定义 ===== */
type ModelTier = "rapid" | "pro";

interface TierConfig {
  id: ModelTier;
  name: string;
  subtitle: string;
  speed: string;
  baseCredits: number;
  apiCost: string;
  color: string;
  icon: React.ElementType;
  features: string[];
  badge?: string;
}

const TIERS: TierConfig[] = [
  {
    id: "rapid",
    name: "闪电 3D",
    subtitle: "Rapid · 快速预览",
    speed: "15-30 秒",
    baseCredits: 5,
    apiCost: "$0.225",
    color: "#64D2FF",
    icon: Zap,
    badge: "推荐入门",
    features: [
      "15-30 秒极速生成",
      "中等几何精度",
      "支持 GLB / OBJ 导出",
      "可选 PBR 材质（+3 Credits）",
    ],
  },
  {
    id: "pro",
    name: "精雕 3D",
    subtitle: "Pro · 高精度",
    speed: "45-90 秒",
    baseCredits: 9,
    apiCost: "$0.375",
    color: "#FFD60A",
    icon: Sparkles,
    badge: "专业品质",
    features: [
      "高精度曲面平滑",
      "纹理细腻，颜色精准",
      "支持 GLB / OBJ 导出",
      "可选 PBR + 多视角 + 自定义面数",
    ],
  },
];

/* ===== 维度系列定价包 ===== */
interface PricingPack {
  name: string;
  subtitle: string;
  contents: string;
  price: string;
  discount: string;
  color: string;
  popular?: boolean;
}

const DIMENSION_PACKS: PricingPack[] = [
  { name: "维度·体验包", subtitle: "新用户专享", contents: "闪电 3D × 3 次", price: "15 Credits", discount: "限購 2 次", color: "#30D158" },
  { name: "维度·探索包", subtitle: "入门创作", contents: "闪电 3D × 10 + 精雕 3D × 2", price: "¥58", discount: "约 85 折", color: "#64D2FF" },
  { name: "维度·创作包", subtitle: "进阶创作", contents: "闪电 3D × 20 + 精雕 3D × 10（含 PBR）", price: "¥168", discount: "约 75 折", color: "#C77DBA", popular: true },
  { name: "维度·大师包", subtitle: "专业制作", contents: "精雕 3D × 30（含 PBR）+ 多视角 × 10", price: "¥358", discount: "约 70 折", color: "#FFD60A" },
  { name: "维度·工作室包", subtitle: "团队/企业", contents: "精雕 3D × 100（全选项）", price: "¥888", discount: "约 65 折", color: "#FF6B6B" },
];

/* ===== 3D 软件兼容列表 ===== */
const COMPATIBLE_SOFTWARE = [
  { name: "Blender", icon: Orbit, desc: "開源工具" },
  { name: "Unity", icon: Gamepad2, desc: "游戏引擎" },
  { name: "Unreal", icon: Puzzle, desc: "虚幻引擎" },
  { name: "Maya", icon: DraftingCompass, desc: "专业建模" },
  { name: "Cinema 4D", icon: Film, desc: "动态设计" },
  { name: "3ds Max", icon: View, desc: "建筑可视化" },
];

/* ===== 主组件 ===== */
export default function ThreeDStudioPage() {
  const { user, isAuthenticated } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 状态
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<ModelTier>("rapid");
  const [enablePbr, setEnablePbr] = useState(false);
  const [enableMultiview, setEnableMultiview] = useState(false);
  const [enableCustomFaces, setEnableCustomFaces] = useState(false);
  const [targetFaceCount, setTargetFaceCount] = useState(50000);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState("");
  const [generatedResult, setGeneratedResult] = useState<{
    glbUrl: string;
    objUrl?: string;
    textureUrl?: string;
    previewUrl?: string;
    formats: string[];
    timeTaken: number;
    creditsUsed: number;
    tier: string;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"generate" | "compare" | "pricing">("generate");
  const [error, setError] = useState<string | null>(null);

  // 计算 Credits
  const calculateCredits = useCallback(() => {
    if (selectedTier === "rapid") {
      return enablePbr ? 8 : 5;
    }
    // Pro
    if (enablePbr && enableMultiview && enableCustomFaces) return 18;
    if (enablePbr && enableMultiview) return 15;
    if (enablePbr) return 12;
    return 9;
  }, [selectedTier, enablePbr, enableMultiview, enableCustomFaces]);

  // 选择图片
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new ((FileReader as any))();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
        setGeneratedResult(null);
        setError(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const pickImage = () => {
    fileInputRef.current?.click();
  };

  const generateMutation = trpc.hunyuan3d.generate.useMutation();

  // 计算当前配置的 Credits 费用
  const getCreditsRequired = () => {
    if (selectedTier === "rapid") {
      return enablePbr ? 20 : 15;
    }
    if (enablePbr && enableMultiview && enableCustomFaces) return 50;
    if (enablePbr && enableMultiview) return 45;
    if (enablePbr) return 40;
    return 35;
  };

  // 生成 3D 模型
  const doGenerate = async () => {
    try {
      setIsGenerating(true);
      setError(null);
      setGenerationProgress(selectedTier === "rapid" ? "闪电模式生成中，预计 15-30 秒..." : "精雕模式生成中，预计 45-90 秒...");

      const result = await generateMutation.mutateAsync({
        imageUrl: selectedImage!,
        tier: selectedTier,
        enablePbr,
        targetFaceCount: enableCustomFaces ? targetFaceCount : undefined,
      });

      if (!result.success || !result.output) {
    // @ts-ignore
        throw new ((AlertCircle as any))(result.error || "生成失败，请重试");
      }

      setGeneratedResult({
        glbUrl: result.output.model_url,
        objUrl: result.output.obj_url,
        textureUrl: result.output.texture_url,
        previewUrl: result.output.preview_url,
        formats: result.output.available_formats,
        timeTaken: result.timeTaken ?? 0,
        creditsUsed: result.creditsUsed,
        tier: result.tier,
      });

      setGenerationProgress("");
    } catch (e: any) {
      setError(e.message || "生成失败，请重试");
      toast.error(e.message || "生成失败，请重试");
      setGenerationProgress("");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerate = () => {
    if (!selectedImage) {
      setError("请先选择一张图片");
      toast.error("请先选择一张图片");
      return;
    }
    if (!isAuthenticated) {
      setError("请先登录");
      toast.error("请先登录");
      return;
    }
    const credits = getCreditsRequired();
    const tierLabel = selectedTier === "rapid" ? "闪电 3D (Rapid)" : "精雕 3D (Pro)";
    const extras = [
      enablePbr && "PBR 材质",
      enableMultiview && "多视角",
      enableCustomFaces && "自定义面数",
    ].filter(Boolean).join(" + ");
    const desc = `${tierLabel}${extras ? ` + ${extras}` : ""}`;

    const confirmed = window.confirm(`即将扣除 ${credits} Credits\n\n模式：${desc}\n预计时间：${selectedTier === "rapid" ? "15-30 秒" : "45-90 秒"}\n\n确认继续？`);
    if (confirmed) doGenerate();
  };

  // 下载模型
  const handleDownload = (url: string, format: string) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = `manus-3d-studio-model.${format}`;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF] page-enter">
      <div className="ambient-glow" />
      <div className="flex-grow">

        {/* ===== 页面标题 ===== */}
        <div className="relative overflow-hidden bg-[#101012] px-6 py-10 text-center md:py-16">
          <div className="absolute inset-0 z-0 bg-gradient-to-br from-[rgba(100,210,255,0.12)] via-[rgba(255,214,10,0.08)] to-[rgba(199,125,186,0.10)]"></div>
          <div className="relative z-10 mx-auto flex flex-col items-center">
            <div className="mb-4 flex items-center gap-1.5 rounded-full border border-[rgba(255,214,10,0.30)] bg-[rgba(255,214,10,0.15)] px-3.5 py-1.5">
              <View size={14} className="text-[#FFD60A]" />
              <span className="text-xs font-bold uppercase tracking-widest text-[#FFD60A]">HUNYUAN3D v3.1</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tighter text-white md:text-5xl">2D 转 3D 工作室</h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#B5B0AB] md:text-base md:leading-loose">
              上传任意 2D 图片，AI 自动生成高质量 3D 模型<br />
              支持 GLB / OBJ 格式导出，可直接导入 Blender、Unity、Unreal
            </p>
          </div>
        </div>

        {/* ===== Tab 切换 ===== */}
        <div className="flex justify-center gap-2 border-b border-white/10 bg-[#0D0D0F] px-6 py-3">
          {([
            { key: "generate", label: "生成模型", icon: Wand2 },
            { key: "compare", label: "效果对比", icon: GitCompare },
            { key: "pricing", label: "维度定价包", icon: Ticket },
          ] as const).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${ 
                activeTab === tab.key 
                ? "border border-[rgba(255,214,10,0.30)] bg-[rgba(255,214,10,0.12)] text-[#FFD60A]"
                : "bg-[#1A1A1D] text-[#9B9691] hover:bg-white/5"
              }`}>
              <tab.icon size={16} />
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ===== Tab Content ===== */}
        <div className="mx-auto w-full max-w-5xl px-5 py-8 md:px-10">
          {activeTab === "generate" && (
            <div className="flex flex-col gap-8 md:flex-row md:gap-10">
              {/* Left Column: Upload & Result */}
              <div className="flex-1">
                {generatedResult ? (
                  <div className="glass-card p-6">
                    <div className="mb-4 flex items-center gap-3">
                      <CheckCircle size={24} className="text-green-500" />
                      <h2 className="text-xl font-bold text-white">3D 模型生成完成</h2>
                    </div>

                    <div className="mb-5 grid grid-cols-3 divide-x divide-white/10 rounded-lg border border-white/10 bg-black/20">
                      <div className="p-3 text-center">
                        <p className="text-xs text-gray-400">模式</p>
                        <p className="mt-1 font-semibold">{generatedResult.tier === "rapid" ? "闪电 3D" : "精雕 3D"}</p>
                      </div>
                      <div className="p-3 text-center">
                        <p className="text-xs text-gray-400">耗时</p>
                        <p className="mt-1 font-semibold">{generatedResult.timeTaken.toFixed(1)} 秒</p>
                      </div>
                      <div className="p-3 text-center">
                        <p className="text-xs text-gray-400">消耗</p>
                        <p className="mt-1 font-semibold text-[#FFD60A]">{generatedResult.creditsUsed} Credits</p>
                      </div>
                    </div>

                    <div className="mb-6 aspect-video w-full overflow-hidden rounded-lg border border-white/10 bg-black/30">
                       <ModelViewer
                        glbUrl={generatedResult.glbUrl}
                        objUrl={generatedResult.objUrl}
                        textureUrl={generatedResult.textureUrl}
                        thumbnailUrl={generatedResult.previewUrl}
                        autoRotate={true}
                      />
                    </div>

                    <h3 className="mb-2 text-lg font-bold">导出 3D 模型文件</h3>
                    <p className="mb-4 text-sm text-gray-400">下载后可直接导入 Blender、Unity、Unreal Engine 等 3D 软件</p>

                    <div className="grid gap-4 md:grid-cols-2">
                      <button onClick={() => handleDownload(generatedResult.glbUrl, "glb")} className="group rounded-xl border-2 border-[#64D2FF] bg-[#1A1A1D] p-4 text-left transition-all duration-300 hover:bg-[#64D2FF]/10 hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg hover:shadow-[#64D2FF]/10">
                        <div className="flex items-start justify-between">
                          <div className="rounded-lg bg-[#64D2FF]/15 p-3">
                            <Box size={32} className="text-[#64D2FF]" />
                          </div>
                          <div className="rounded-full bg-[#64D2FF] px-4 py-1.5 text-black transition-opacity group-hover:opacity-100 md:opacity-0">
                            <Download size={18} />
                          </div>
                        </div>
                        <h4 className="mt-3 font-bold text-white">GLB 格式</h4>
                        <p className="mt-1 text-xs text-gray-400">二进制 glTF，包含模型+材质+纹理。推荐用于 Web / Unity / Blender。</p>
                      </button>
                      
                      <button disabled={!generatedResult.objUrl} onClick={() => generatedResult.objUrl && handleDownload(generatedResult.objUrl, "obj")} className="group rounded-xl border-2 border-[#FFD60A] bg-[#1A1A1D] p-4 text-left transition-all duration-300 hover:bg-[#FFD60A]/10 hover:scale-[1.02] active:scale-[0.98] hover:shadow-lg hover:shadow-[#FFD60A]/10 disabled:cursor-not-allowed disabled:opacity-50">
                        <div className="flex items-start justify-between">
                          <div className="rounded-lg bg-[#FFD60A]/15 p-3">
                            <Layers size={32} className="text-[#FFD60A]" />
                          </div>
                           <div className="rounded-full bg-[#FFD60A] px-4 py-1.5 text-black transition-opacity group-hover:opacity-100 md:opacity-0">
                            <Download size={18} />
                          </div>
                        </div>
                        <h4 className="mt-3 font-bold text-white">OBJ 格式</h4>
                        <p className="mt-1 text-xs text-gray-400">通用 3D 格式，兼容性最广。推荐用于 Maya / 3ds Max / Cinema 4D。</p>
                      </button>
                    </div>

                    {generatedResult.textureUrl && (
                      <button onClick={() => handleDownload(generatedResult.textureUrl!, "png")} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border- py-2.5 text-sm font-semibold text-[#C77DBA] transition-colors hover:border-[#C77DBA] hover:bg-[#C77DBA]/10">
                        <GalleryVertical size={20} />
                        <span>下载纹理贴图 (.png)</span>
                      </button>
                    )}
                    
                    <div className="mt-8">
                      <h4 className="text-center font-semibold text-gray-300">兼容 3D 软件</h4>
                      <div className="mt-4 grid grid-cols-3 gap-4 md:grid-cols-6">
                        {COMPATIBLE_SOFTWARE.map((sw) => (
                          <div key={sw.name} className="flex flex-col items-center text-center">
                            <sw.icon size={24} className="text-gray-400" />
                            <p className="mt-1.5 text-xs font-semibold text-gray-300">{sw.name}</p>
                            <p className="text-xs text-gray-500">{sw.desc}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>
                ) : (
                  <div className="glass-card p-1 !border-dashed !border-2">
                    <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileSelect} className="hidden" />
                    {selectedImage ? (
                      <div className="relative">
                        <img src={selectedImage} alt="Uploaded preview" className="aspect-video w-full rounded-xl object-cover" />
                        <button onClick={pickImage} className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-black/80">
                          <Upload size={16} />
                          <span>重新选择</span>
                        </button>
                      </div>
                    ) : (
                      <button onClick={pickImage} className="flex w-full flex-col items-center justify-center p-10 text-center">
                        <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-blue-500/10">
                          <Upload size={40} className="text-blue-400" />
                        </div>
                        <h3 className="text-lg font-bold text-white">上传图片</h3>
                        <p className="text-sm text-gray-400">从电脑中选择一张图片开始</p>
                        <p className="mt-2 text-xs text-gray-600">支持 JPG, PNG, WEBP. 推荐分辨率 1024x1024</p>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Right Column: Options */}
              <div className="w-full md:w-80">
                <div className="sticky top-8 flex flex-col gap-5">
                  <div>
                    <h3 className="font-bold text-white">1. 选择模式</h3>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      {TIERS.map((tier) => (
                        <button key={tier.id} onClick={() => setSelectedTier(tier.id)} className={`relative rounded-xl border-2 p-4 text-left transition-all ${selectedTier === tier.id ? 'border-[' + tier.color + '] bg-[' + tier.color + ']/10' : 'border-white/10 bg-[#1A1A1D] hover:bg-white/5'}`}>
                          {tier.badge && <div className="absolute -top-2.5 right-3 rounded-full px-2 py-0.5 text-xs font-bold" style={{ backgroundColor: tier.color, color: '#000' }}>{tier.badge}</div>}
                          <tier.icon size={24} style={{ color: tier.color }} />
                          <h4 className="mt-2 font-bold text-white">{tier.name}</h4>
                          <p className="text-xs text-gray-400">{tier.subtitle}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="font-bold text-white">2. 高级选项</h3>
                    <div className="mt-3 flex flex-col gap-3">
                      <label className={`relative flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${enablePbr ? 'border-green-500 bg-green-500/10' : 'border-white/10 bg-[#1A1A1D]'}`}>
                        <input type="checkbox" checked={enablePbr} onChange={(e) => setEnablePbr(e.target.checked)} className="absolute h-full w-full opacity-0" />
                        <div className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 ${enablePbr ? 'border-green-500 bg-green-500' : 'border-gray-500'}`}>
                          {enablePbr && <Check size={14} className="text-black" />}
                        </div>
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-white">PBR 真实材质</span>
                            <span className="text-sm font-bold text-[#FFD60A]">+3 Credits</span>
                          </div>
                          <p className="text-xs text-gray-400">生成包含颜色、粗糙度、金属度的 PBR 贴图，效果更真实。</p>
                        </div>
                      </label>
                      
                      <label className={`relative flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${selectedTier === 'rapid' ? 'cursor-not-allowed opacity-50' : ''} ${enableMultiview && selectedTier === 'pro' ? 'border-green-500 bg-green-500/10' : 'border-white/10 bg-[#1A1A1D]'}`}>
                        <input type="checkbox" disabled={selectedTier === 'rapid'} checked={enableMultiview} onChange={(e) => setEnableMultiview(e.target.checked)} className="absolute h-full w-full opacity-0" />
                        <div className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 ${enableMultiview && selectedTier === 'pro' ? 'border-green-500 bg-green-500' : 'border-gray-500'}`}>
                          {enableMultiview && <Check size={14} className="text-black" />}
                        </div>
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-white">多视角增强</span>
                            <span className="text-sm font-bold text-[#FFD60A]">+3 Credits</span>
                          </div>
                          <p className="text-xs text-gray-400">提升模型背面和侧面的细节还原度。仅精雕模式可用。</p>
                        </div>
                      </label>

                      <label className={`relative flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${selectedTier === 'rapid' ? 'cursor-not-allowed opacity-50' : ''} ${enableCustomFaces && selectedTier === 'pro' ? 'border-green-500 bg-green-500/10' : 'border-white/10 bg-[#1A1A1D]'}`}>
                        <input type="checkbox" disabled={selectedTier === 'rapid'} checked={enableCustomFaces} onChange={(e) => setEnableCustomFaces(e.target.checked)} className="absolute h-full w-full opacity-0" />
                        <div className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 ${enableCustomFaces && selectedTier === 'pro' ? 'border-green-500 bg-green-500' : 'border-gray-500'}`}>
                          {enableCustomFaces && <Check size={14} className="text-black" />}
                        </div>
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-white">自定义精度</span>
                            <span className="text-sm font-bold text-[#FFD60A]">+3 Credits</span>
                          </div>
                          <p className="text-xs text-gray-400">自定义模型面数，用于游戏或动画。仅精雕模式可用。</p>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-bold text-white">3. 费用预估</h3>
                    <div className="mt-3 space-y-2 rounded-lg border border-white/10 bg-[#1A1A1D] p-4 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-300">{selectedTier === "rapid" ? "闪电 3D" : "精雕 3D"} 基础</span>
                        <span className="font-semibold">{selectedTier === "rapid" ? 5 : 9} Credits</span>
                      </div>
                      {enablePbr && (
                        <div className="flex justify-between">
                          <span className="text-gray-300">+ PBR 真实材质</span>
                          <span className="font-semibold">3 Credits</span>
                        </div>
                      )}
                      {enableMultiview && selectedTier === "pro" && (
                        <div className="flex justify-between">
                          <span className="text-gray-300">+ 多视角增强</span>
                          <span className="font-semibold">3 Credits</span>
                        </div>
                      )}
                      {enableCustomFaces && selectedTier === "pro" && (
                        <div className="flex justify-between">
                          <span className="text-gray-300">+ 自定义精度</span>
                          <span className="font-semibold">3 Credits</span>
                        </div>
                      )}
                      <div className="!mt-3 flex justify-between border-t border-white/10 pt-3">
                        <span className="font-bold text-white">合计消耗</span>
                        <span className="font-bold text-lg text-[#FFD60A]">{calculateCredits()} Credits</span>
                      </div>
                    </div>
                  </div>

                  <button onClick={handleGenerate} disabled={isGenerating} className="flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-[#FFD60A] text-lg font-bold text-black transition-all duration-300 hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] hover:shadow-xl hover:shadow-[#FFD60A]/20 disabled:cursor-not-allowed disabled:opacity-60 ripple-effect">
                    {isGenerating ? (
                      <>
                        <Loader2 size={22} className="animate-spin" />
                        <span>{generationProgress || "生成中..."}</span>
                      </>
                    ) : (
                      <>
                        <Wand2 size={22} />
                        <span>生成 3D 模型</span>
                      </>
                    )}
                  </button>

                  {error && (
                    <div className="flex items-center gap-2 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                      <AlertCircle size={18} />
                      <span>{error}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "compare" && (
             <div>
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-white md:text-3xl">闪电 3D vs 精雕 3D 效果对比</h2>
                    <p className="mx-auto mt-3 max-w-2xl text-sm text-gray-400 md:text-base">基于 Hunyuan3D v3.1 实际生成效果，帮助您选择最适合的模式</p>
                </div>

                <div className="mt-8 overflow-hidden glass-card-subtle text-sm">
                    <div className="grid grid-cols-[1.5fr,2fr,2fr] bg-white/5 font-bold text-white">
                        <div className="p-3">对比维度</div>
                        <div className="p-3 text-[#64D2FF]">闪电 3D (Rapid)</div>
                        <div className="p-3 text-[#FFD60A]">精雕 3D (Pro)</div>
                    </div>
                    {[
                        ["生成速度", "15-30 秒", "45-90 秒"],
                        ["几何精度", "中等，边缘有锯齿", "高，曲面平滑"],
                        ["纹理还原", "颜色大致准确", "颜色精准，渐变自然"],
                        ["面部细节", "五官轮廓正确", "表情、皮肤纹理清晰"],
                        ["PBR 材质", "支持（+3 Credits）", "支持（效果更好）"],
                        ["多视角输入", "不支持", "支持（+3 Credits）"],
                        ["自定义面数", "不支持", "支持（+3 Credits）"],
                    ].map(([label, rapid, pro], i) => (
                        <div key={i} className={`grid grid-cols-[1.5fr,2fr,2fr] border-t border-white/10 ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                            <div className="p-3 font-semibold text-white">{label}</div>
                            <div className="p-3 text-gray-300">{rapid}</div>
                            <div className="p-3 text-gray-300">{pro}</div>
                        </div>
                    ))}
                </div>

                <h3 className="mt-12 text-center text-2xl font-bold text-white">实际效果展示</h3>
                <div className="mt-6 grid gap-8 md:grid-cols-3">
                    {Object.values(COMPARISON_IMAGES).map((img, i) => (
                        <div key={i} className="overflow-hidden rounded-xl border border-white/10 bg-[#1A1A1D]">
                            <img src={img.url} alt={img.title} className="h-48 w-full object-cover" />
                            <div className="p-4">
                                <h4 className="font-bold text-white">{img.title}</h4>
                                <p className="mt-1 text-sm text-gray-400">{img.desc.replace(/\n/g, ' ')}</p>
                            </div>
                        </div>
                    ))}
                </div>

                <h3 className="mt-12 text-center text-2xl font-bold text-white">适用场景建议</h3>
                <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[
                    { scene: "快速预览 / 概念验证", tier: "闪电 3D", reason: "速度快、成本低", color: "#64D2FF" },
                    { scene: "社交媒体展示", tier: "闪电 3D + PBR", reason: "加材质后视觉效果提升明显", color: "#64D2FF" },
                    { scene: "商业用途 / 产品展示", tier: "精雕 3D + PBR", reason: "细节精准，适合正式发布", color: "#FFD60A" },
                    { scene: "游戏 / 动画资产", tier: "精雕 3D + 全选项", reason: "可控制面数适配引擎需求", color: "#FFD60A" },
                    { scene: "3D 打印", tier: "精雕 3D", reason: "几何精度高，打印效果好", color: "#FFD60A" },
                ].map((item, i) => (
                    <div key={i} className="rounded-lg bg-[#1A1A1D] p-4" style={{ borderLeft: `4px solid ${item.color}` }}>
                        <p className="font-semibold text-white">{item.scene}</p>
                        <div className="mt-2 flex items-center gap-1.5">
                            <ArrowRight size={14} style={{ color: item.color }} />
                            <span className="font-bold" style={{ color: item.color }}>{item.tier}</span>
                        </div>
                        <p className="mt-1 text-sm text-gray-400">{item.reason}</p>
                    </div>
                ))}
                </div>
            </div>
          )}

          {activeTab === "pricing" && (
            <div>
                <div className="text-center">
                    <h2 className="text-2xl font-bold text-white md:text-3xl">维度系列 · 3D 专属收费包</h2>
                    <p className="mx-auto mt-3 max-w-2xl text-sm text-gray-400 md:text-base">为重度 3D 用户提供专属优惠包，批量购买更划算</p>
                </div>

                <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    {DIMENSION_PACKS.map((pack, i) => (
                        <div key={i} className={`relative flex flex-col rounded-2xl border-2 bg-[#1A1A1D] p-5 ${pack.popular ? 'border-[' + pack.color + ']' : 'border-white/10'}`} style={{ borderColor: pack.color }}>
                            {pack.popular && <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-bold text-black" style={{ backgroundColor: pack.color }}>最受欢迎</div>}
                            <h3 className="text-lg font-bold" style={{ color: pack.color }}>{pack.name}</h3>
                            <p className="text-sm text-gray-400">{pack.subtitle}</p>
                            <p className="my-4 text-3xl font-extrabold text-white">{pack.price}</p>
                            {pack.discount && <p className="text-sm font-semibold text-yellow-400">{pack.discount}</p>}
                            <div className="my-5 h-px flex-shrink-0 bg-white/10"></div>
                            <p className="flex-grow text-sm text-gray-300">{pack.contents}</p>
                            <button className="mt-5 w-full rounded-lg py-2.5 font-bold transition-colors" style={{ backgroundColor: `${pack.color}20`, color: pack.color, border: `1px solid ${pack.color}` }}>
                                立即購買
                            </button>
                        </div>
                    ))}
                </div>

                <h3 className="mt-12 text-center text-2xl font-bold text-white">订阅方案 · 每月 3D 额度</h3>
                 <div className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-[#1A1A1D] text-sm">
                    <div className="grid grid-cols-[1.5fr,2fr,1.5fr] bg-white/5 font-bold text-white">
                        <div className="p-3">订阅等级</div>
                        <div className="p-3">每月 3D 额度</div>
                        <div className="p-3">可用模式</div>
                    </div>
                    {[
                        ["入門版", "闪电 3D × 3 次", "仅闪电"],
                        ["专业版 ¥108/月", "闪电 × 15 + 精雕 × 5", "全部"],
                        ["企业版 ¥358/月", "闪电 × 50 + 精雕 × 20", "全部 + 优先"],
                        ["学生版", "闪电 × 8 + 精雕 × 2", "全部"],
                    ].map(([plan, quota, mode], i) => (
                        <div key={i} className={`grid grid-cols-[1.5fr,2fr,1.5fr] border-t border-white/10 ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                            <div className="p-3 font-semibold text-white">{plan}</div>
                            <div className="p-3 text-gray-300">{quota}</div>
                            <div className="p-3 text-gray-300">{mode}</div>
                        </div>
                    ))}
                </div>
            </div>
          )}
        </div>

        {/* ===== 生成歷史和收藏 ===== */}
        <div className="bg-[#1A1A1D] rounded-2xl p-6 mt-8">
          <CreationHistoryPanel type="idol_3d" title="3D 模型生成歷史" />
        </div>

        {/* ===== 底部间距 ===== */}
        <div className="h-20" />
      </div>
    </div>
  );
}
