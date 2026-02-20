import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState, useRef, useEffect } from "react";
import { Upload, BarChart3, Loader2, CheckCircle, Sparkles, Heart, Camera, BookOpen, Eye, Gift, ArrowRight, ShieldCheck, ShieldAlert } from "lucide-react";

const WAIT_TIPS = [
  "AI 正在逐帧分析视频内容...",
  "正在评估故事情感表达...",
  "正在分析镜头运镜技巧...",
  "正在检查叙事逻辑完整性...",
  "正在评估视频清晰度与画质...",
  "正在计算综合评分...",
  "即将完成，请稍候...",
];

const SCORE_COLORS: Record<string, { text: string; bg: string; ring: string }> = {
  storyEmotion: { text: "text-rose-400", bg: "bg-rose-500/10", ring: "stroke-rose-400" },
  cameraWork: { text: "text-sky-400", bg: "bg-sky-500/10", ring: "stroke-sky-400" },
  narrativeLogic: { text: "text-amber-400", bg: "bg-amber-500/10", ring: "stroke-amber-400" },
  videoClarity: { text: "text-emerald-400", bg: "bg-emerald-500/10", ring: "stroke-emerald-400" },
};

function CircularScore({ score, color, size = 100 }: { score: number; color: string; size?: number }) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth="6" className="text-white/5" />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth="6" strokeLinecap="round"
        className={color}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 1.2s ease-out" }}
      />
    </svg>
  );
}

export default function MVAnalysis() {
  const { isAuthenticated } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [reward, setReward] = useState<any>(null);
  const [verification, setVerification] = useState<any>(null);
  const [tipIndex, setTipIndex] = useState(0);

  // Rotate tips during analysis
  useEffect(() => {
    if (!analyzing) return;
    const interval = setInterval(() => {
      setTipIndex(i => (i + 1) % WAIT_TIPS.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [analyzing]);

  const analyzeMutation = trpc.mvAnalysis.analyze.useMutation({
    onSuccess: (data: any) => {
      if (data.success) {
        setResult(data.analysis);
        setReward(data.reward);
        setVerification(data.verification);
        if (data.reward?.given) {
          toast.success(`恭喜获得 ${data.reward.emoji} ${data.reward.tier} 奖励：+${data.reward.credits} Credits！`);
        } else if (data.verification && !data.verification.verified) {
          toast.info("PK 评分完成！非平台视频无法获得 Credits 奖励");
        } else {
          toast.success("PK 评分完成！");
        }
      } else {
        toast.error(data.error || "分析失败，请重试");
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
    setReward(null);
    setTipIndex(0);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const progressInterval = setInterval(() => {
        setUploadProgress(p => {
          if (p >= 85) { clearInterval(progressInterval); return 85; }
          return p + Math.random() * 12;
        });
      }, 300);

      const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
      clearInterval(progressInterval);

      if (!uploadRes.ok) throw new Error("上传失败");

      const { url: videoUrl } = await uploadRes.json();
      setUploadProgress(100);
      setUploading(false);

      setAnalyzing(true);
      analyzeMutation.mutate({ videoUrl, fileName: file.name });
    } catch {
      setUploading(false);
      setUploadProgress(0);
      toast.error("上传失败，请重试");
    }
  };

  const dimensions = result ? [
    { key: "storyEmotion", label: "故事情感", score: result.storyEmotion, analysis: result.storyEmotionAnalysis, icon: Heart },
    { key: "cameraWork", label: "镜头运镜", score: result.cameraWork, analysis: result.cameraWorkAnalysis, icon: Camera },
    { key: "narrativeLogic", label: "叙事逻辑", score: result.narrativeLogic, analysis: result.narrativeLogicAnalysis, icon: BookOpen },
    { key: "videoClarity", label: "视频清晰度", score: result.videoClarity, analysis: result.videoClarityAnalysis, icon: Eye },
  ] : [];

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="pt-32 text-center container">
          <BarChart3 className="h-16 w-16 text-blue-400 mx-auto mb-6" />
          <h1 className="text-3xl font-bold mb-4">视频 PK 评分</h1>
          <p className="text-muted-foreground mb-4 max-w-lg mx-auto">
            上传视频，AI 从故事情感、镜头运镜、叙事逻辑、视频清晰度四大维度深度评分
          </p>
          <p className="text-sm text-muted-foreground/70 mb-8">高分作品可获得 Credits 奖励</p>
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
      <div className="pt-24 pb-16 container max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-blue-400" />
            </div>
            <h1 className="text-3xl font-bold">视频 PK 评分</h1>
          </div>
          <p className="text-muted-foreground">AI 从故事情感、镜头运镜、叙事逻辑、视频清晰度四大维度深度评分</p>
          <div className="flex items-center gap-4 mt-2">
            <span className="text-xs text-muted-foreground/60">消耗 8 Credits / 次（前 2 次免费）</span>
            <span className="text-xs text-muted-foreground/60">|</span>
            <span className="text-xs text-amber-400/80">🏆 高分可获 Credits 奖励</span>
          </div>
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
                  <p className="text-sm text-muted-foreground">支持 MP4、MOV、AVI 格式，最大 16MB，5 分钟以内</p>
                </div>
              ) : uploading ? (
                <div className="text-center py-8">
                  <Upload className="h-10 w-10 text-blue-400 mx-auto mb-4 animate-bounce" />
                  <h3 className="font-semibold mb-3">正在上传...</h3>
                  <Progress value={uploadProgress} className="max-w-md mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">{Math.round(uploadProgress)}%</p>
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="relative w-20 h-20 mx-auto mb-6">
                    <div className="absolute inset-0 rounded-full border-4 border-blue-500/20" />
                    <div className="absolute inset-0 rounded-full border-4 border-blue-400 border-t-transparent animate-spin" />
                    <Sparkles className="absolute inset-0 m-auto h-8 w-8 text-blue-400" />
                  </div>
                  <h3 className="font-semibold mb-2 text-lg">AI 正在深度分析中...</h3>
                  <p className="text-sm text-muted-foreground animate-pulse transition-all">{WAIT_TIPS[tipIndex]}</p>
                  <div className="flex justify-center gap-1 mt-4">
                    {WAIT_TIPS.map((_, i) => (
                      <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${i === tipIndex ? "bg-blue-400" : "bg-white/10"}`} />
                    ))}
                  </div>
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
              <Button variant="outline" className="bg-transparent" onClick={() => { setResult(null); setReward(null); setVerification(null); setUploadProgress(0); }}>
                重新评分
              </Button>
            </div>

            {/* Verification Banner */}
            {verification && (
              <Card className={verification.verified
                ? "bg-emerald-500/10 border-emerald-500/30"
                : "bg-amber-500/10 border-amber-500/30"
              }>
                <CardContent className="p-4 flex items-center gap-3">
                  {verification.verified ? (
                    <>
                      <ShieldCheck className="h-5 w-5 text-emerald-400 shrink-0" />
                      <div>
                        <span className="text-sm font-medium text-emerald-300">平台认证视频</span>
                        <span className="text-xs text-emerald-200/60 ml-2">
                          {verification.source === "original" ? "原创作品" : "二次创作"} · 符合奖励资格
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <ShieldAlert className="h-5 w-5 text-amber-400 shrink-0" />
                      <div>
                        <span className="text-sm font-medium text-amber-300">非平台视频</span>
                        <span className="text-xs text-amber-200/60 ml-2">未检测到平台签名，无法获得 Credits 奖励。在平台生成或二次创作的视频可获得奖励。</span>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Reward Banner */}
            {reward && reward.given && (
              <Card className="bg-gradient-to-r from-amber-500/15 via-yellow-500/10 to-orange-500/15 border-amber-500/30 overflow-hidden relative">
                <CardContent className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="text-4xl">{reward.emoji}</div>
                    <div>
                      <div className="font-bold text-lg text-amber-300">{reward.tier}</div>
                      <div className="text-sm text-amber-200/70">综合评分 {result.overall} 分</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Gift className="h-5 w-5 text-amber-400" />
                    <span className="text-2xl font-bold text-amber-300">+{reward.credits}</span>
                    <span className="text-sm text-amber-200/70">Credits</span>
                  </div>
                </CardContent>
              </Card>
            )}
            {reward && !reward.given && (
              <Card className="bg-card/30 border-border/30">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="text-2xl">{reward.emoji}</div>
                  <div>
                    <span className="text-sm text-muted-foreground">{reward.tier} — 综合评分 {result.overall} 分，继续努力，80 分以上可获得 Credits 奖励！</span>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Overall Score */}
            <Card className="bg-gradient-to-r from-primary/10 via-purple-500/10 to-blue-500/10 border-primary/30">
              <CardContent className="p-8 text-center">
                <div className="relative w-32 h-32 mx-auto mb-4">
                  <CircularScore score={result.overall} color="stroke-primary" size={128} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div className="text-4xl font-extrabold text-primary">{result.overall}</div>
                    <div className="text-[10px] text-muted-foreground">综合评分</div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground max-w-xl mx-auto">{result.summary}</p>
              </CardContent>
            </Card>

            {/* Four Dimension Scores */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {dimensions.map(dim => {
                const colors = SCORE_COLORS[dim.key];
                return (
                  <Card key={dim.key} className={`${colors.bg} border-border/50`}>
                    <CardContent className="p-4 text-center">
                      <div className="relative w-20 h-20 mx-auto mb-3">
                        <CircularScore score={dim.score} color={colors.ring} size={80} />
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <div className="text-2xl font-bold">{dim.score}</div>
                        </div>
                      </div>
                      <dim.icon className={`h-4 w-4 mx-auto mb-1 ${colors.text}`} />
                      <div className="text-xs text-muted-foreground">{dim.label}</div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Detailed Analysis */}
            <Card className="bg-card/50 border-border/50">
              <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" /> 详细分析报告</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                {dimensions.map(dim => {
                  const colors = SCORE_COLORS[dim.key];
                  return (
                    <div key={dim.key} className="flex gap-4">
                      <div className={`w-1 rounded-full ${colors.bg.replace("/10", "/40")}`} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <dim.icon className={`h-4 w-4 ${colors.text}`} />
                          <h4 className={`font-medium ${colors.text}`}>{dim.label}</h4>
                          <span className="text-xs text-muted-foreground ml-auto">{dim.score}/100</span>
                        </div>
                        <p className="text-sm text-muted-foreground leading-relaxed">{dim.analysis}</p>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {/* Highlights & Improvements */}
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="bg-emerald-500/5 border-emerald-500/20">
                <CardHeader><CardTitle className="text-emerald-400 text-base flex items-center gap-2"><Sparkles className="h-4 w-4" /> 亮点分析</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {(result.highlights || []).map((h: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <CheckCircle className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                        <span>{h}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
              <Card className="bg-amber-500/5 border-amber-500/20">
                <CardHeader><CardTitle className="text-amber-400 text-base flex items-center gap-2"><ArrowRight className="h-4 w-4" /> 改进建议</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {(result.improvements || []).map((imp: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <span className="text-amber-400 mt-0.5 shrink-0 text-xs font-bold">{i + 1}.</span>
                        <span>{imp}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>

            {/* Reward Tiers Reference */}
            <Card className="bg-card/30 border-border/30">
              <CardHeader><CardTitle className="text-sm text-muted-foreground flex items-center gap-2"><Gift className="h-4 w-4" /> PK 评分奖励等级</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-3">
                    {[
                     { min: 90, credits: 25, label: "精品级", emoji: "🏆", active: result.overall >= 90 },
                     { min: 80, credits: 15, label: "优秀级", emoji: "🌟", active: result.overall >= 80 && result.overall < 90 },
                     { min: 0, credits: 0, label: "继续加油", emoji: "💪", active: result.overall < 80 },
                  ].map(tier => (
                    <div key={tier.min} className={`text-center p-3 rounded-lg border transition-all ${tier.active ? "border-primary/50 bg-primary/10 scale-105" : "border-border/20 bg-card/20 opacity-50"}`}>
                      <div className="text-xl mb-1">{tier.emoji}</div>
                      <div className={`text-xs font-medium ${tier.active ? "text-primary" : "text-muted-foreground"}`}>{tier.label}</div>
                      <div className="text-[10px] text-muted-foreground">{tier.min > 0 ? `≥${tier.min}分` : "<80分"}</div>
                      <div className={`text-xs font-bold mt-1 ${tier.active ? "text-amber-400" : "text-muted-foreground/50"}`}>
                        {tier.credits > 0 ? `+${tier.credits} Credits` : "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
