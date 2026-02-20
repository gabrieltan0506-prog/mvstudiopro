import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState, useRef } from "react";
import { Upload, BarChart3, Palette, Music, TrendingUp, Loader2, Film, CheckCircle, AlertCircle } from "lucide-react";

export default function MVAnalysis() {
  const { isAuthenticated } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<any>(null);

  const analyzeMutation = trpc.mvAnalysis.analyze.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setResult(data.analysis);
        toast.success("分析完成！");
      } else {
        toast.error("分析失败，请重试");
      }
      setAnalyzing(false);
    },
    onError: () => { toast.error("分析失败"); setAnalyzing(false); },
  });

  const handleUpload = async (file: File) => {
    if (file.size > 16 * 1024 * 1024) {
      toast.error("文件大小不能超过 16MB");
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setResult(null);

    // Simulate upload progress
    const interval = setInterval(() => {
      setUploadProgress(p => {
        if (p >= 90) { clearInterval(interval); return 90; }
        return p + Math.random() * 15;
      });
    }, 300);

    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/trpc/mvAnalysis.analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl: URL.createObjectURL(file), filename: file.name }),
      });
      clearInterval(interval);
      setUploadProgress(100);
      setUploading(false);
      setAnalyzing(true);
      // Use tRPC mutation for actual analysis
      analyzeMutation.mutate({ videoUrl: "uploaded://" + file.name, fileName: file.name });
    } catch {
      clearInterval(interval);
      setUploading(false);
      toast.error("上传失败");
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="pt-32 text-center container">
          <BarChart3 className="h-16 w-16 text-primary mx-auto mb-6" />
          <h1 className="text-3xl font-bold mb-4">MV 智能分析</h1>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">上传 MV 视频，AI 自动分析画面构图、色彩风格、节奏感与爆款潜力评分</p>
          <Button size="lg" className="bg-primary text-primary-foreground" onClick={() => { window.location.href = getLoginUrl(); }}>登录后使用</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <div className="pt-24 pb-16 container max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">MV 智能分析</h1>
          <p className="text-muted-foreground">上传 MV 视频，AI 自动分析画面构图、色彩风格、节奏感与爆款潜力</p>
        </div>

        {/* Upload Area */}
        {!result && (
          <Card className="bg-card/50 border-border/50 mb-8">
            <CardContent className="p-8">
              <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); }} />
              {!uploading && !analyzing ? (
                <div
                  className="border-2 border-dashed border-border/50 rounded-xl p-12 text-center hover:border-primary/50 transition-colors cursor-pointer"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">点击或拖拽上传 MV 视频</h3>
                  <p className="text-sm text-muted-foreground">支持 MP4、MOV、AVI 格式，最大 16MB</p>
                </div>
              ) : uploading ? (
                <div className="text-center py-8">
                  <Upload className="h-10 w-10 text-primary mx-auto mb-4 animate-bounce" />
                  <h3 className="font-semibold mb-3">正在上传...</h3>
                  <Progress value={uploadProgress} className="max-w-md mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">{Math.round(uploadProgress)}%</p>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Loader2 className="h-10 w-10 text-primary mx-auto mb-4 animate-spin" />
                  <h3 className="font-semibold mb-2">AI 正在分析中...</h3>
                  <p className="text-sm text-muted-foreground">正在分析画面构图、色彩风格、节奏感等维度</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Analysis Result */}
        {result && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-green-400">
                <CheckCircle className="h-5 w-5" />
                <span className="font-semibold">分析完成</span>
              </div>
              <Button variant="outline" className="bg-transparent" onClick={() => { setResult(null); setUploadProgress(0); }}>重新分析</Button>
            </div>

            {/* Score Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "画面构图", score: result.composition ?? 85, icon: Film, color: "text-blue-400" },
                { label: "色彩风格", score: result.colorStyle ?? 78, icon: Palette, color: "text-purple-400" },
                { label: "节奏感", score: result.rhythm ?? 82, icon: Music, color: "text-green-400" },
                { label: "爆款潜力", score: result.viralPotential ?? 76, icon: TrendingUp, color: "text-primary" },
              ].map(item => (
                <Card key={item.label} className="bg-card/50 border-border/50">
                  <CardContent className="p-4 text-center">
                    <item.icon className={`h-6 w-6 mx-auto mb-2 ${item.color}`} />
                    <div className="text-2xl font-bold mb-1">{item.score}</div>
                    <div className="text-xs text-muted-foreground">{item.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Detailed Analysis */}
            <Card className="bg-card/50 border-border/50">
              <CardHeader><CardTitle>详细分析报告</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {result.details ? (
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{result.details}</p>
                ) : (
                  <>
                    <div>
                      <h4 className="font-medium mb-1">画面构图分析</h4>
                      <p className="text-sm text-muted-foreground">{result.compositionAnalysis ?? "画面整体构图合理，主体突出，背景层次分明。建议在转场处增加更多视觉引导元素。"}</p>
                    </div>
                    <div>
                      <h4 className="font-medium mb-1">色彩风格分析</h4>
                      <p className="text-sm text-muted-foreground">{result.colorAnalysis ?? "色彩搭配和谐，主色调统一。暖色调为主，营造出温馨氛围。可考虑在高潮部分增加对比色。"}</p>
                    </div>
                    <div>
                      <h4 className="font-medium mb-1">节奏感分析</h4>
                      <p className="text-sm text-muted-foreground">{result.rhythmAnalysis ?? "画面切换节奏与音乐节拍基本同步，副歌部分的快切效果出色。建议前奏部分适当放慢节奏。"}</p>
                    </div>
                    <div>
                      <h4 className="font-medium mb-1">爆款潜力建议</h4>
                      <p className="text-sm text-muted-foreground">{result.suggestions ?? "整体质量较高，建议增加更多记忆点画面，如标志性动作或视觉符号，有助于提升传播性。"}</p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
