import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import { useState } from "react";
import {
  Film, Sparkles, Clapperboard, Wand2, Users, BarChart3,
  ArrowRight, Play, Star, Send, ChevronRight
} from "lucide-react";

const FEATURES = [
  { icon: BarChart3, title: "MV 智能分析", desc: "AI 自动分析画面构图、色彩风格、节奏感与爆款潜力评分", color: "from-orange-500/20 to-red-500/20" },
  { icon: Sparkles, title: "虚拟偶像工坊", desc: "输入描述生成动漫风、写实风、赛博朋克等多风格虚拟偶像", color: "from-purple-500/20 to-pink-500/20" },
  { icon: Clapperboard, title: "歌词生成分镜", desc: "输入歌词，AI 自动生成专业 MV 分镜脚本，支持导出 PDF", color: "from-blue-500/20 to-cyan-500/20" },
  { icon: Wand2, title: "视觉特效引擎", desc: "为 MV 素材添加情感滤镜、光量动态特效和转场效果", color: "from-emerald-500/20 to-teal-500/20" },
  { icon: Film, title: "MV 展厅", desc: "精选 MV 作品展示，支持在线播放、评论互动和留言板", color: "from-amber-500/20 to-yellow-500/20" },
  { icon: Users, title: "团队协作", desc: "团队创建、成员邀请、角色分配、使用量统计一站管理", color: "from-indigo-500/20 to-violet-500/20" },
];

const SHOWCASE_MVS = [
  { id: "mv1", title: "Neon Dreams", artist: "CyberVox", thumbnail: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&h=340&fit=crop" },
  { id: "mv2", title: "Sakura Rain", artist: "Luna AI", thumbnail: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=600&h=340&fit=crop" },
  { id: "mv3", title: "Digital Soul", artist: "PixelBeat", thumbnail: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&h=340&fit=crop" },
];

export default function Home() {
  const { isAuthenticated } = useAuth();
  const [contactForm, setContactForm] = useState({ name: "", email: "", subject: "", message: "" });
  const submitGuestbook = trpc.guestbook.submit.useMutation({
    onSuccess: () => { toast.success("消息已发送！我们会尽快回复您。"); setContactForm({ name: "", email: "", subject: "", message: "" }); },
    onError: () => toast.error("发送失败，请稍后重试"),
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />

      {/* Hero */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5" />
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute bottom-10 right-1/4 w-72 h-72 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="container relative">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 mb-6 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm font-medium">
              <Sparkles className="h-4 w-4" /> AI 驱动的一站式 MV 创作平台
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight mb-6">
              用 AI 重新定义
              <br />
              <span className="bg-gradient-to-r from-primary via-orange-400 to-amber-400 bg-clip-text text-transparent">
                MV 创作体验
              </span>
            </h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
              从 MV 智能分析、虚拟偶像生成到分镜脚本创作，MV Studio Pro 为音乐创作者提供全流程 AI 工具，让每一帧画面都充满灵感。
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              {isAuthenticated ? (
                <Link href="/gallery">
                  <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 text-base px-8">
                    进入 MV 展厅 <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
              ) : (
                <Button
                  size="lg"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 text-base px-8"
                  onClick={() => { window.location.href = getLoginUrl(); }}
                >
                  免费开始创作 <ArrowRight className="h-5 w-5" />
                </Button>
              )}
              <Link href="/gallery">
                <Button size="lg" variant="outline" className="gap-2 text-base px-8 bg-transparent">
                  <Play className="h-5 w-5" /> 浏览精选 MV
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 border-t border-border/30">
        <div className="container">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold mb-4">核心功能</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">六大 AI 工具模块，覆盖 MV 创作全流程</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f) => (
              <Card key={f.title} className="bg-card/50 border-border/50 hover:border-primary/30 transition-all group">
                <CardContent className="p-6">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                    <f.icon className="h-6 w-6 text-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Showcase MVs */}
      <section className="py-20 border-t border-border/30">
        <div className="container">
          <div className="flex items-center justify-between mb-10">
            <div>
              <h2 className="text-3xl font-bold mb-2">精选 MV</h2>
              <p className="text-muted-foreground">探索由 AI 辅助创作的优秀作品</p>
            </div>
            <Link href="/gallery">
              <Button variant="ghost" className="gap-1 text-primary hover:text-primary/80">
                查看全部 <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {SHOWCASE_MVS.map((mv) => (
              <Link key={mv.id} href="/gallery">
                <Card className="overflow-hidden bg-card/50 border-border/50 hover:border-primary/30 transition-all group cursor-pointer">
                  <div className="relative aspect-video overflow-hidden">
                    <img
                      src={mv.thumbnail}
                      alt={mv.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="w-14 h-14 rounded-full bg-primary/90 flex items-center justify-center">
                        <Play className="h-6 w-6 text-primary-foreground ml-0.5" />
                      </div>
                    </div>
                  </div>
                  <CardContent className="p-4">
                    <h3 className="font-semibold">{mv.title}</h3>
                    <p className="text-sm text-muted-foreground">{mv.artist}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 border-t border-border/30">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { value: "10,000+", label: "创作者" },
              { value: "50,000+", label: "MV 分析" },
              { value: "30,000+", label: "虚拟偶像" },
              { value: "98%", label: "满意度" },
            ].map((s) => (
              <div key={s.label}>
                <div className="text-3xl font-bold text-primary mb-1">{s.value}</div>
                <div className="text-sm text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="py-20 border-t border-border/30">
        <div className="container max-w-2xl">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-4">联系我们</h2>
            <p className="text-muted-foreground">有任何问题或合作意向，欢迎留言</p>
          </div>
          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  placeholder="您的姓名"
                  value={contactForm.name}
                  onChange={(e) => setContactForm(p => ({ ...p, name: e.target.value }))}
                  className="bg-background/50"
                />
                <Input
                  placeholder="邮箱地址"
                  type="email"
                  value={contactForm.email}
                  onChange={(e) => setContactForm(p => ({ ...p, email: e.target.value }))}
                  className="bg-background/50"
                />
              </div>
              <Input
                placeholder="主题"
                value={contactForm.subject}
                onChange={(e) => setContactForm(p => ({ ...p, subject: e.target.value }))}
                className="bg-background/50"
              />
              <Textarea
                placeholder="请输入您的消息..."
                rows={4}
                value={contactForm.message}
                onChange={(e) => setContactForm(p => ({ ...p, message: e.target.value }))}
                className="bg-background/50"
              />
              <Button
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
                disabled={submitGuestbook.isPending || !contactForm.name || !contactForm.subject || !contactForm.message}
                onClick={() => submitGuestbook.mutate(contactForm)}
              >
                <Send className="h-4 w-4" />
                {submitGuestbook.isPending ? "发送中..." : "发送消息"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-10 border-t border-border/30">
        <div className="container flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Film className="h-5 w-5 text-primary" />
            <span className="font-semibold">MV Studio Pro</span>
          </div>
          <p className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} MV Studio Pro. All rights reserved.
          </p>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <span className="hover:text-foreground cursor-pointer">隐私政策</span>
            <span className="hover:text-foreground cursor-pointer">服务条款</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
