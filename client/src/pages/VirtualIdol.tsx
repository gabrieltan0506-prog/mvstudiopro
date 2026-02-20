import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState } from "react";
import { Sparkles, Loader2, Download, RefreshCw } from "lucide-react";

type IdolStyle = "anime" | "realistic" | "cyberpunk" | "fantasy" | "chibi";

const STYLES: { value: IdolStyle; label: string; desc: string }[] = [
  { value: "anime", label: "动漫风", desc: "日系动漫画风，色彩鲜明" },
  { value: "realistic", label: "写实风", desc: "极度逼真的真人效果" },
  { value: "cyberpunk", label: "赛博朋克", desc: "霓虹灯光、未来科技感" },
  { value: "fantasy", label: "奇幻风", desc: "奇幻世界角色设计" },
  { value: "chibi", label: "Q版可爱", desc: "可爱Q版卡通风格" },
];

export default function VirtualIdol() {
  const { isAuthenticated } = useAuth();
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState<IdolStyle>("realistic");
  const [generating, setGenerating] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);

  const generateMutation = trpc.virtualIdol.generate.useMutation({
    onSuccess: (data) => {
      if (data.success && data.imageUrl) {
        setGeneratedImages(prev => [data.imageUrl!, ...prev]);
        toast.success("偶像形象生成成功！");
      } else {
        toast.error(data.error || "生成失败");
      }
      setGenerating(false);
    },
    onError: () => { toast.error("生成失败，请重试"); setGenerating(false); },
  });

  const handleGenerate = () => {
    if (!description.trim()) { toast.error("请输入偶像描述"); return; }
    setGenerating(true);
    generateMutation.mutate({ description: description.trim(), style });
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="pt-32 text-center container">
          <Sparkles className="h-16 w-16 text-primary mx-auto mb-6" />
          <h1 className="text-3xl font-bold mb-4">虚拟偶像工坊</h1>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">输入描述生成动漫风、写实风、赛博朋克等多风格虚拟偶像形象</p>
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
          <h1 className="text-3xl font-bold mb-2">虚拟偶像工坊</h1>
          <p className="text-muted-foreground">输入描述，选择风格，AI 为你生成独特的虚拟偶像形象</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* Left: Controls */}
          <div className="lg:col-span-2 space-y-6">
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-6 space-y-5">
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

                <div>
                  <label className="text-sm font-medium mb-2 block">艺术风格</label>
                  <Select value={style} onValueChange={(v) => setStyle(v as IdolStyle)}>
                    <SelectTrigger className="bg-background/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STYLES.map(s => (
                        <SelectItem key={s.value} value={s.value}>{s.label} - {s.desc}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Style Preview Cards */}
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

                <Button
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
                  disabled={generating || !description.trim()}
                  onClick={handleGenerate}
                >
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {generating ? "生成中..." : "生成偶像形象"}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Right: Generated Images */}
          <div className="lg:col-span-3">
            {generatedImages.length === 0 && !generating ? (
              <div className="h-full flex items-center justify-center border-2 border-dashed border-border/30 rounded-xl p-12">
                <div className="text-center">
                  <Sparkles className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                  <p className="text-muted-foreground">生成的偶像形象将显示在这里</p>
                  <p className="text-sm text-muted-foreground/60 mt-1">输入描述并选择风格开始创作</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {generating && (
                  <Card className="bg-card/50 border-border/50">
                    <CardContent className="p-8 text-center">
                      <Loader2 className="h-10 w-10 text-primary mx-auto mb-4 animate-spin" />
                      <p className="font-medium">AI 正在创作中...</p>
                      <p className="text-sm text-muted-foreground mt-1">预计需要 10-20 秒</p>
                    </CardContent>
                  </Card>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {generatedImages.map((url, i) => (
                    <Card key={i} className="overflow-hidden bg-card/50 border-border/50 group">
                      <div className="relative aspect-square">
                        <img src={url} alt={`虚拟偶像 ${i + 1}`} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                          <Button size="sm" variant="outline" className="bg-black/50 border-white/30 text-white" onClick={() => window.open(url, "_blank")}>
                            <Download className="h-4 w-4 mr-1" /> 下载
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
      </div>
    </div>
  );
}
