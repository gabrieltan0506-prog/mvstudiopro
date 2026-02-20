import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { toast } from "sonner";
import { useState, useRef } from "react";
import { Wand2, Upload, Loader2, Download, RotateCcw } from "lucide-react";

const FILTERS = [
  { id: "warm", label: "暖色情感", desc: "温暖柔和的色调", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  { id: "cold", label: "冷色忧郁", desc: "冷蓝色调，忧郁氛围", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  { id: "vintage", label: "复古胶片", desc: "经典胶片质感", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  { id: "neon", label: "霓虹闪烁", desc: "赛博朋克霓虹效果", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  { id: "dreamy", label: "梦幻柔焦", desc: "柔焦梦境般效果", color: "bg-pink-500/20 text-pink-400 border-pink-500/30" },
  { id: "dramatic", label: "戏剧光影", desc: "强烈明暗对比", color: "bg-red-500/20 text-red-400 border-red-500/30" },
];

const TRANSITIONS = [
  { id: "fade", label: "淡入淡出" },
  { id: "dissolve", label: "溶解过渡" },
  { id: "wipe", label: "擦除转场" },
  { id: "zoom", label: "缩放转场" },
  { id: "glitch", label: "故障效果" },
  { id: "flash", label: "闪白转场" },
];

export default function VFXEngine() {
  const { isAuthenticated } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFilter, setSelectedFilter] = useState<string | null>(null);
  const [selectedTransition, setSelectedTransition] = useState<string | null>(null);
  const [intensity, setIntensity] = useState([70]);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);

  const handleUpload = (file: File) => {
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      toast.error("请上传图片或视频文件");
      return;
    }
    const url = URL.createObjectURL(file);
    setUploadedImage(url);
    setResultImage(null);
  };

  const handleApply = () => {
    if (!uploadedImage) { toast.error("请先上传素材"); return; }
    if (!selectedFilter && !selectedTransition) { toast.error("请选择至少一个滤镜或转场效果"); return; }
    setProcessing(true);
    // Simulate processing
    setTimeout(() => {
      setResultImage(uploadedImage);
      setProcessing(false);
      toast.success("特效应用成功！");
    }, 2000);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="pt-32 text-center container">
          <Wand2 className="h-16 w-16 text-primary mx-auto mb-6" />
          <h1 className="text-3xl font-bold mb-4">视觉特效引擎</h1>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">为 MV 素材添加情感滤镜、光量动态特效和转场效果</p>
          <Button size="lg" className="bg-primary text-primary-foreground" onClick={() => { window.location.href = getLoginUrl(); }}>登录后使用</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <div className="pt-24 pb-16 container max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">视觉特效引擎</h1>
          <p className="text-muted-foreground">为 MV 素材添加情感滤镜、光量动态特效和转场效果</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Controls */}
          <div className="space-y-4">
            {/* Upload */}
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-5">
                <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); }} />
                <Button variant="outline" className="w-full bg-transparent gap-2" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4" /> {uploadedImage ? "更换素材" : "上传 MV 素材"}
                </Button>
              </CardContent>
            </Card>

            {/* Emotion Filters */}
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-5">
                <h3 className="text-sm font-semibold mb-3">情感滤镜</h3>
                <div className="grid grid-cols-2 gap-2">
                  {FILTERS.map(f => (
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
              </CardContent>
            </Card>

            {/* Transitions */}
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-5">
                <h3 className="text-sm font-semibold mb-3">转场效果</h3>
                <div className="grid grid-cols-3 gap-2">
                  {TRANSITIONS.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTransition(selectedTransition === t.id ? null : t.id)}
                      className={`p-2 rounded-lg text-xs text-center transition-all border ${
                        selectedTransition === t.id
                          ? "bg-primary/20 text-primary border-primary/50"
                          : "bg-background/30 border-border/30 text-muted-foreground hover:border-border"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Intensity */}
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold">特效强度</h3>
                  <span className="text-xs text-muted-foreground">{intensity[0]}%</span>
                </div>
                <Slider value={intensity} onValueChange={setIntensity} max={100} step={5} className="w-full" />
              </CardContent>
            </Card>

            <Button
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
              disabled={processing || !uploadedImage}
              onClick={handleApply}
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {processing ? "处理中..." : "应用特效"}
            </Button>
          </div>

          {/* Right: Preview */}
          <div className="lg:col-span-2">
            <Card className="bg-card/50 border-border/50 h-full">
              <CardContent className="p-6 h-full">
                {!uploadedImage ? (
                  <div
                    className="h-full min-h-[400px] flex items-center justify-center border-2 border-dashed border-border/30 rounded-xl cursor-pointer hover:border-primary/30 transition-colors"
                    onClick={() => fileRef.current?.click()}
                  >
                    <div className="text-center">
                      <Upload className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                      <p className="text-muted-foreground">点击上传 MV 素材</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">支持图片和视频文件</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">
                        {resultImage ? "效果预览" : "原始素材"}
                      </h3>
                      <div className="flex gap-2">
                        {resultImage && (
                          <>
                            <Button size="sm" variant="outline" className="bg-transparent gap-1" onClick={() => { setResultImage(null); }}>
                              <RotateCcw className="h-3 w-3" /> 重置
                            </Button>
                            <Button size="sm" variant="outline" className="bg-transparent gap-1" onClick={() => toast.info("下载功能即将上线")}>
                              <Download className="h-3 w-3" /> 下载
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="relative rounded-xl overflow-hidden bg-black/50">
                      <img
                        src={resultImage || uploadedImage}
                        alt="预览"
                        className={`w-full max-h-[500px] object-contain ${
                          selectedFilter === "warm" ? "brightness-110 saturate-125 hue-rotate-15" :
                          selectedFilter === "cold" ? "brightness-95 saturate-80 hue-rotate-180" :
                          selectedFilter === "vintage" ? "sepia brightness-95 contrast-110" :
                          selectedFilter === "neon" ? "brightness-110 contrast-125 saturate-150" :
                          selectedFilter === "dreamy" ? "brightness-110 blur-[0.5px] saturate-80" :
                          selectedFilter === "dramatic" ? "contrast-150 brightness-90" : ""
                        }`}
                      />
                      {processing && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                          <div className="text-center">
                            <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto mb-2" />
                            <p className="text-sm">正在应用特效...</p>
                          </div>
                        </div>
                      )}
                    </div>
                    {selectedFilter && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Wand2 className="h-3 w-3" />
                        当前滤镜：{FILTERS.find(f => f.id === selectedFilter)?.label} · 强度 {intensity[0]}%
                        {selectedTransition && ` · 转场：${TRANSITIONS.find(t => t.id === selectedTransition)?.label}`}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
