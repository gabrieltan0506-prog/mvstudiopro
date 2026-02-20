import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState, useRef } from "react";
import { Upload, BarChart3, Palette, Music, TrendingUp, Loader2, Film, CheckCircle, Sparkles } from "lucide-react";

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
        toast.success("PK 评分完成！");
      } else {
        toast.error("分析失败，请重试");
      }
      setAnalyzing(false);
    },
    onError: (err) => { toast.error(err.message || "分析失败"); setAnalyzing(false); },
  });

  const handleUpload = async (file: File) => {
    if (file.size > 16 * 1024 * 1024) {
      toast.error("文件大小不能超过 16MB");
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setResult(null);

    try {
      // Step 1: Upload to S3 via /api/upload
      const formData = new FormData();
      formData.append("file", file);

      const progressInterval = setInterval(() => {
        setUploadProgress(p => {
          if (p >= 85) { clearInterval(progressInterval); return 85; }
          return p + Math.random() * 12;
        });
      }, 300);

      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      clearInterval(progressInterval);

      if (!uploadRes.ok) {
        throw new Error("上传失败");
      }

      const { url: videoUrl } = await uploadRes.json();
      setUploadProgress(100);
      setUploading(false);

      // Step 2: Call AI analysis with S3 URL
      setAnalyzing(true);
      analyzeMutation.mutate({ videoUrl, fileName: file.name });
    } catch {
      setUploading(false);
      setUploadProgress(0);
      toast.error("上传失败，请重试");
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="pt-32 text-center container">
          <BarChart3 className="h-16 w-16 text-blue-400 mx-auto mb-6" />
          <h1 className="text-3xl font-bold mb-4">视频 PK 评分</h1>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
            上传视频，AI 自动分析画面构图、色彩风格、节奏感与爆款潜力评分
          </p>
          <Button size="lg" className="bg-primary text-primary-foreground" onClick={() => { window.location.href = getLoginUrl(); }}>
            登录后使用
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <div className="pt-24 pb-16 container max-w-4xl">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-blue-400" />
            </div>
            <h1 className="text-3xl font-bold">视频 PK 评分</h1>
          </div>
          <p className="text-muted-foreground">上传视频，AI 自动分析画面构图、色彩风格、节奏感与爆款潜力评分</p>
          <p className="text-xs text-muted-foreground/60 mt-1">消耗 5 Credits / 次</p>
        </div>

        {/* Upload Area */}
        {!result && (
          <Card className="bg-card/50 border-border/50 mb-8">
            <CardContent className="p-8">
              <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); }} />
              {!uploading && !analyzing ? (
                <div
                  className="border-2 border-dashed border-border/50 rounded-xl p-12 text-center hover:border-blue-500/50 transition-colors cursor-pointer group"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4 group-hover:text-blue-400 transition-colors" />
                  <h3 className="text-lg font-semibold mb-2">点击或拖拽上传视频</h3>
                  <p className="text-sm text-muted-foreground">支持 MP4、MOV、AVI 格式，最大 16MB</p>
                </div>
              ) : uploading ? (
                <div className="text-center py-8">
                  <Upload className="h-10 w-10 text-blue-400 mx-auto mb-4 animate-bounce" />
                  <h3 className="font-semibold mb-3">正在上传...</h3>
                  <Progress value={uploadProgress} className="max-w-md mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">{Math.round(uploadProgress)}%</p>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Loader2 className="h-10 w-10 text-blue-400 mx-auto mb-4 animate-spin" />
                  <h3 className="font-semibold mb-2">AI 正在 PK 评分中...</h3>
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
                <span className="font-semibold">PK 评分完成</span>
              </div>
              <Button variant="outline" className="bg-transparent" onClick={() => { setResult(null); setUploadProgress(0); }}>
                重新评分
              </Button>
            </div>

            {/* Score Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "画面构图", score: result.composition ?? 85, icon: Film, color: "text-blue-400", bg: "bg-blue-500/10" },
                { label: "色彩风格", score: result.colorStyle ?? 78, icon: Palette, color: "text-purple-400", bg: "bg-purple-500/10" },
                { label: "节奏感", score: result.rhythm ?? 82, icon: Music, color: "text-green-400", bg: "bg-green-500/10" },
                { label: "爆款潜力", score: result.viralPotential ?? 76, icon: TrendingUp, color: "text-primary", bg: "bg-primary/10" },
              ].map(item => (
                <Card key={item.label} className={`${item.bg} border-border/50`}>
                  <CardContent className="p-4 text-center">
                    <item.icon className={`h-6 w-6 mx-auto mb-2 ${item.color}`} />
                    <div className="text-3xl font-bold mb-1">{item.score}</div>
                    <div className="text-xs text-muted-foreground">{item.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Overall Score */}
            <Card className="bg-gradient-to-r from-primary/10 via-purple-500/10 to-blue-500/10 border-primary/30">
              <CardContent className="p-6 text-center">
                <Sparkles className="h-8 w-8 text-primary mx-auto mb-2" />
                <div className="text-5xl font-extrabold text-primary mb-2">
                  {Math.round(((result.composition ?? 85) + (result.colorStyle ?? 78) + (result.rhythm ?? 82) + (result.viralPotential ?? 76)) / 4)}
                </div>
                <div className="text-sm text-muted-foreground">综合 PK 评分</div>
              </CardContent>
            </Card>

            {/* Detailed Analysis */}
            <Card className="bg-card/50 border-border/50">
              <CardHeader><CardTitle>详细分析报告</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {result.details ? (
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{result.details}</p>
                ) : (
                  <>
                    <div>
                      <h4 className="font-medium mb-1 text-blue-400">画面构图分析</h4>
                      <p className="text-sm text-muted-foreground">{result.compositionAnalysis ?? "画面整体构图合理，主体突出，背景层次分明。建议在转场处增加更多视觉引导元素。"}</p>
                    </div>
                    <div>
                      <h4 className="font-medium mb-1 text-purple-400">色彩风格分析</h4>
                      <p className="text-sm text-muted-foreground">{result.colorAnalysis ?? "色彩搭配和谐，主色调统一。暖色调为主，营造出温馨氛围。可考虑在高潮部分增加对比色。"}</p>
                    </div>
                    <div>
                      <h4 className="font-medium mb-1 text-green-400">节奏感分析</h4>
                      <p className="text-sm text-muted-foreground">{result.rhythmAnalysis ?? "画面切换节奏与音乐节拍基本同步，副歌部分的快切效果出色。建议前奏部分适当放慢节奏。"}</p>
                    </div>
                    <div>
                      <h4 className="font-medium mb-1 text-primary">爆款潜力建议</h4>
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
