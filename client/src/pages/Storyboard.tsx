import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState } from "react";
import { Clapperboard, Loader2, FileDown, Image, ChevronDown, ChevronUp } from "lucide-react";

export default function Storyboard() {
  const { isAuthenticated } = useAuth();
  const [lyrics, setLyrics] = useState("");
  const [sceneCount, setSceneCount] = useState("6");
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [expandedScene, setExpandedScene] = useState<number | null>(null);

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
    generateMutation.mutate({ lyrics: lyrics.trim(), sceneCount: parseInt(sceneCount) });
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="pt-32 text-center container">
          <Clapperboard className="h-16 w-16 text-primary mx-auto mb-6" />
          <h1 className="text-3xl font-bold mb-4">歌词生成分镜</h1>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">输入歌词或文本，AI 自动生成专业 MV 分镜脚本</p>
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
          <h1 className="text-3xl font-bold mb-2">歌词生成分镜</h1>
          <p className="text-muted-foreground">输入歌词或文本，AI 自动生成专业 MV 分镜脚本，支持导出 PDF</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Input */}
          <div className="lg:col-span-1 space-y-4">
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-6 space-y-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">歌词 / 文本内容</label>
                  <Textarea
                    placeholder="在这里粘贴歌词或输入文本内容...&#10;&#10;例如：&#10;月光洒落在窗台&#10;你的影子在风中摇摆&#10;城市的霓虹灯闪烁&#10;我们在人海中相遇"
                    rows={10}
                    value={lyrics}
                    onChange={e => setLyrics(e.target.value)}
                    className="bg-background/50"
                  />
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
                      <SelectItem value="12">12 个分镜</SelectItem>
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
                      onClick={() => setResult(s.storyboard)}
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
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">{result.title || "分镜脚本"}</h3>
                  <Button variant="outline" size="sm" className="bg-transparent gap-1" onClick={() => toast.info("PDF 导出功能即将上线")}>
                    <FileDown className="h-4 w-4" /> 导出 PDF
                  </Button>
                </div>
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
                            <div className="text-xs text-muted-foreground">{scene.duration || "4s"} · {scene.cameraAngle || "中景"}</div>
                          </div>
                        </div>
                        {expandedScene === i ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
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
