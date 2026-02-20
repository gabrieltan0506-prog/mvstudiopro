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
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Film, Sparkles, Clapperboard, Wand2, Users, BarChart3,
  ArrowRight, Play, Star, Send, ChevronRight, Video, Trophy,
  FolderOpen, Flame, Zap
} from "lucide-react";

/* ── Particle Canvas Background with light rays & color shifts ── */
function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let t = 0;
    interface Particle { x: number; y: number; vx: number; vy: number; r: number; baseO: number; color: string; phase: number; }
    let particles: Particle[] = [];

    const colors = [
      "232,130,94",  // warm orange (primary)
      "168,85,247",  // purple
      "59,130,246",  // blue
      "236,72,153",  // pink
      "245,158,11",  // amber
      "99,102,241",  // indigo
      "20,184,166",  // teal
    ];

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }

    function initParticles() {
      particles = [];
      const count = Math.floor((canvas!.width * canvas!.height) / 10000);
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * canvas!.width,
          y: Math.random() * canvas!.height,
          vx: (Math.random() - 0.5) * 0.25,
          vy: (Math.random() - 0.5) * 0.25,
          r: Math.random() * 2 + 0.3,
          baseO: Math.random() * 0.5 + 0.15,
          color: colors[Math.floor(Math.random() * colors.length)],
          phase: Math.random() * Math.PI * 2,
        });
      }
    }

    function drawLightRays(time: number) {
      const w = canvas!.width;
      const h = canvas!.height;
      // Diagonal light sweep from top-left
      const sweepX = (Math.sin(time * 0.15) * 0.3 + 0.3) * w;
      const sweepY = (Math.cos(time * 0.12) * 0.2 + 0.15) * h;
      const grad1 = ctx!.createRadialGradient(sweepX, sweepY, 0, sweepX, sweepY, w * 0.55);
      grad1.addColorStop(0, "rgba(232,130,94,0.20)");
      grad1.addColorStop(0.3, "rgba(168,85,247,0.10)");
      grad1.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = grad1;
      ctx!.fillRect(0, 0, w, h);

      // Secondary light from bottom-right
      const s2x = (Math.sin(time * 0.1 + 2) * 0.25 + 0.7) * w;
      const s2y = (Math.cos(time * 0.08 + 1) * 0.2 + 0.75) * h;
      const grad2 = ctx!.createRadialGradient(s2x, s2y, 0, s2x, s2y, w * 0.45);
      grad2.addColorStop(0, "rgba(59,130,246,0.16)");
      grad2.addColorStop(0.4, "rgba(20,184,166,0.08)");
      grad2.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = grad2;
      ctx!.fillRect(0, 0, w, h);

      // Tertiary warm glow center
      const s3x = (Math.sin(time * 0.07 + 4) * 0.15 + 0.5) * w;
      const s3y = (Math.cos(time * 0.09 + 3) * 0.15 + 0.45) * h;
      const grad3 = ctx!.createRadialGradient(s3x, s3y, 0, s3x, s3y, w * 0.35);
      grad3.addColorStop(0, "rgba(245,158,11,0.14)");
      grad3.addColorStop(0.5, "rgba(236,72,153,0.07)");
      grad3.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = grad3;
      ctx!.fillRect(0, 0, w, h);
    }

    function draw() {
      t += 0.016;
      const w = canvas!.width;
      const h = canvas!.height;
      ctx!.clearRect(0, 0, w, h);

      // Draw animated light rays first
      drawLightRays(t);

      // Draw particles with breathing opacity
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;
        const breathe = Math.sin(t * 1.5 + p.phase) * 0.15 + 1;
        const opacity = p.baseO * breathe;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r * breathe, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${p.color},${opacity})`;
        ctx!.fill();
      }

      // Subtle connection lines between nearby particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = dx * dx + dy * dy;
          if (dist < 10000) {
            const lineO = (1 - dist / 10000) * 0.10;
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.strokeStyle = `rgba(232,130,94,${lineO})`;
            ctx!.lineWidth = 0.5;
            ctx!.stroke();
          }
        }
      }

      animId = requestAnimationFrame(draw);
    }

    resize();
    initParticles();
    draw();
    const handleResize = () => { resize(); initParticles(); };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />;
}

/* ── Creative Tools Cards (旧版 9 宫格彩色卡片) ── */
const CREATIVE_TOOLS = [
  {
    icon: Film, title: "视频展厅", titleEn: "Video Gallery",
    desc: "浏览精选视频作品，支持在线播放、评论交互和留言板功能",
    borderColor: "border-t-red-500", iconBg: "bg-red-500/20", iconColor: "text-red-400",
    href: "/gallery", ready: true,
  },
  {
    icon: BarChart3, title: "视频 PK 评分", titleEn: "Video PK Score",
    desc: "上传视频，AI 自动分析画面构图、色彩风格、节奏感与爆款潜力评分",
    borderColor: "border-t-blue-500", iconBg: "bg-blue-500/20", iconColor: "text-blue-400",
    href: "/analysis", ready: true,
  },
  {
    icon: Sparkles, title: "虚拟偶像工坊", titleEn: "Virtual Idol Studio",
    desc: "输入描述即可生成动漫风、写实风、赛博朋克等多风格虚拟偶像形象",
    borderColor: "border-t-green-500", iconBg: "bg-green-500/20", iconColor: "text-green-400",
    href: "/idol", ready: true,
  },
  {
    icon: Clapperboard, title: "智能脚本与分镜生成", titleEn: "Script & Storyboard",
    desc: "输入歌词或文本，AI 自动生成专业视频分镜脚本，免费 10 个分镜或 600 字以内",
    borderColor: "border-t-yellow-500", iconBg: "bg-yellow-500/20", iconColor: "text-yellow-400",
    href: "/storyboard", ready: true,
  },
  {
    icon: Wand2, title: "分镜转视频", titleEn: "Storyboard to Video",
    desc: "将分镜脚本转化为高质量视频片段，支持情感滤镜、动态特效和转场效果",
    borderColor: "border-t-emerald-500", iconBg: "bg-emerald-500/20", iconColor: "text-emerald-400",
    href: "/vfx", ready: true,
  },
  {
    icon: Trophy, title: "爆款视频奖励", titleEn: "Viral Video Rewards",
    desc: "上传已发布的爆款视频，AI 自动评分，80 分以上可获得 30-80 Credits 奖励",
    borderColor: "border-t-amber-500", iconBg: "bg-amber-500/20", iconColor: "text-amber-400",
    href: "/analysis", ready: false,
  },
  {
    icon: FolderOpen, title: "我的视频", titleEn: "My Videos",
    desc: "查看已上传视频的评分历史、Credits 奖励记录和分析详情",
    borderColor: "border-t-sky-500", iconBg: "bg-sky-500/20", iconColor: "text-sky-400",
    href: "/dashboard", ready: true,
  },
  {
    icon: Flame, title: "平台展厅", titleEn: "Platform Gallery",
    desc: "浏览 90 分以上的获奖爆款视频，发现优秀创作者和爆款灵感",
    borderColor: "border-t-orange-500", iconBg: "bg-orange-500/20", iconColor: "text-orange-400",
    href: "/gallery", ready: true,
  },
  {
    icon: Zap, title: "Kling AI 工作室", titleEn: "Kling AI Studio",
    desc: "3.0 Omni 视频生成、Motion Control 动作迁移、Lip-Sync 对口型，一站式 AI 视频制作",
    borderColor: "border-t-purple-500", iconBg: "bg-purple-500/20", iconColor: "text-purple-400",
    href: "/vfx", ready: false,
  },
];

const SHOWCASE_MVS = [
  { id: "mv1", title: "Neon Dreams", artist: "CyberVox", thumbnail: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&h=340&fit=crop" },
  { id: "mv2", title: "Sakura Rain", artist: "Luna AI", thumbnail: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=600&h=340&fit=crop" },
  { id: "mv3", title: "Digital Soul", artist: "PixelBeat", thumbnail: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&h=340&fit=crop" },
];

export default function Home() {
  const { isAuthenticated } = useAuth();
  const [contactForm, setContactForm] = useState({ name: "", email: "", subject: "", message: "" });

  useEffect(() => {
    document.title = "MV Studio Pro - AI 驱动的一站式视频创作平台";
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute("content", "MV Studio Pro 是专业的AI视频创作平台，提供视频PK评分、虚拟偶像生成、智能分镜脚本、分镜转视频等一站式创作工具。");
  }, []);

  const submitGuestbook = trpc.guestbook.submit.useMutation({
    onSuccess: () => { toast.success("消息已发送！我们会尽快回复您。"); setContactForm({ name: "", email: "", subject: "", message: "" }); },
    onError: () => toast.error("发送失败，请稍后重试"),
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />

      {/* ═══ Hero Section (tapnow.ai style) ═══ */}
      <section className="relative pt-28 pb-24 overflow-hidden min-h-[85vh] flex items-center" style={{ background: 'linear-gradient(135deg, #101018 0%, #15131f 25%, #18141a 50%, #121520 75%, #101018 100%)' }}>
        {/* Particle background */}
        <ParticleBackground />

        {/* Multi-layer animated gradient orbs for rich light & color */}
        <div className="absolute top-[-10%] left-[5%] w-[700px] h-[700px] rounded-full blur-[160px] animate-[heroGlow1_8s_ease-in-out_infinite]" />
        <div className="absolute bottom-[-15%] right-[0%] w-[650px] h-[650px] rounded-full blur-[150px] animate-[heroGlow2_10s_ease-in-out_infinite]" />
        <div className="absolute top-[20%] left-[40%] w-[550px] h-[550px] rounded-full blur-[140px] animate-[heroGlow3_12s_ease-in-out_infinite]" />
        <div className="absolute top-[5%] right-[15%] w-[500px] h-[500px] rounded-full blur-[130px] animate-[heroGlow4_9s_ease-in-out_infinite]" />
        <div className="absolute bottom-[10%] left-[25%] w-[450px] h-[450px] rounded-full blur-[120px] animate-[heroGlow5_11s_ease-in-out_infinite]" />

        {/* Soft vignette overlay — keeps edges dark, center luminous */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_65%_at_50%_45%,transparent_0%,rgba(16,16,18,0.15)_60%,rgba(16,16,18,0.55)_100%)]" />

        {/* Very subtle noise texture for depth */}
        <div className="absolute inset-0 opacity-[0.025]" style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: "128px 128px"
        }} />

        {/* Subtle grid lines */}
        <div className="absolute inset-0 opacity-[0.06]" style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "60px 60px"
        }} />

        <div className="container relative z-10">
          <div className="max-w-4xl mx-auto text-center">
            {/* Badge */}
            <div
              className="inline-flex items-center gap-2 px-5 py-2 mb-8 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm font-medium backdrop-blur-sm"
              style={{ animation: "fadeInUp 0.6s ease-out both" }}
            >
              <Sparkles className="h-4 w-4" /> AI 驱动的一站式视频创作平台
            </div>

            {/* Main Title */}
            <h1
              className="text-4xl sm:text-5xl lg:text-7xl font-extrabold tracking-tight leading-[1.1] mb-8"
              style={{ animation: "fadeInUp 0.8s ease-out 0.15s both" }}
            >
              让你视频的每一帧
              <br />
              <span className="bg-gradient-to-r from-primary via-orange-400 to-amber-400 bg-clip-text text-transparent">
                都成为爆款的起点
              </span>
            </h1>

            {/* Subtitle */}
            <p
              className="text-lg sm:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed"
              style={{ animation: "fadeInUp 0.8s ease-out 0.3s both" }}
            >
              从视频 PK 评分到虚拟偶像生成，AI 驱动的一站式视频创作平台
            </p>

            {/* CTA Buttons */}
            <div
              className="flex flex-col sm:flex-row gap-4 justify-center"
              style={{ animation: "fadeInUp 0.8s ease-out 0.45s both" }}
            >
              {isAuthenticated ? (
                <Link href="/gallery">
                  <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 text-base px-8 shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all">
                    进入视频展厅 <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
              ) : (
                <Button
                  size="lg"
                  className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 text-base px-8 shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all"
                  onClick={() => { window.location.href = getLoginUrl(); }}
                >
                  免费开始创作 <ArrowRight className="h-5 w-5" />
                </Button>
              )}
              <Link href="/gallery">
                <Button size="lg" variant="outline" className="gap-2 text-base px-8 bg-transparent border-white/20 hover:bg-white/5 hover:border-white/30 transition-all">
                  <Play className="h-5 w-5" /> 浏览精选作品
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Bottom gradient fade */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
      </section>

      {/* ═══ Creative Tools (旧版 9 宫格彩色卡片) ═══ */}
      <section className="py-20">
        <div className="container">
          <div className="text-center mb-14">
            <p className="text-primary text-sm font-semibold tracking-widest uppercase mb-3">✨ Creative Tools</p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">创作工具</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">探索 AI 驱动的全方位视频创作工具</p>
          </div>

          {/* Top row: 5 cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5 mb-5">
            {CREATIVE_TOOLS.slice(0, 5).map((tool) => (
              <Link key={tool.title} href={tool.ready ? tool.href : "#"} onClick={(e) => { if (!tool.ready) { e.preventDefault(); toast.info("功能即将上线，敬请期待！"); } }}>
                <Card className={`bg-card/60 border-border/40 ${tool.borderColor} border-t-2 hover:bg-card/80 hover:border-t-3 transition-all group cursor-pointer h-full`}>
                  <CardContent className="p-5 flex flex-col h-full">
                    <div className={`w-12 h-12 rounded-xl ${tool.iconBg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                      <tool.icon className={`h-6 w-6 ${tool.iconColor}`} />
                    </div>
                    <h3 className="text-base font-semibold mb-2">{tool.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed flex-1">{tool.desc}</p>
                    {tool.ready && (
                      <div className={`mt-4 text-xs font-medium ${tool.iconColor} flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity`}>
                        立即使用 <ArrowRight className="h-3 w-3" />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {/* Bottom row: 4 cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {CREATIVE_TOOLS.slice(5).map((tool) => (
              <Link key={tool.title} href={tool.ready ? tool.href : "#"} onClick={(e) => { if (!tool.ready) { e.preventDefault(); toast.info("功能即将上线，敬请期待！"); } }}>
                <Card className={`bg-card/60 border-border/40 ${tool.borderColor} border-t-2 hover:bg-card/80 hover:border-t-3 transition-all group cursor-pointer h-full`}>
                  <CardContent className="p-5 flex flex-col h-full">
                    <div className={`w-12 h-12 rounded-xl ${tool.iconBg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                      <tool.icon className={`h-6 w-6 ${tool.iconColor}`} />
                    </div>
                    <h3 className="text-base font-semibold mb-2">{tool.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed flex-1">{tool.desc}</p>
                    {tool.ready && (
                      <div className={`mt-4 text-xs font-medium ${tool.iconColor} flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity`}>
                        立即使用 <ArrowRight className="h-3 w-3" />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Showcase MVs ═══ */}
      <section className="py-20 border-t border-border/30">
        <div className="container">
          <div className="flex items-center justify-between mb-10">
            <div>
              <h2 className="text-3xl font-bold mb-2">精选作品</h2>
              <p className="text-muted-foreground">探索由 AI 辅助创作的优秀视频</p>
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
                    <img src={mv.thumbnail} alt={mv.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
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

      {/* ═══ Stats ═══ */}
      <section className="py-16 border-t border-border/30">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {[
              { value: "10,000+", label: "创作者" },
              { value: "50,000+", label: "视频分析" },
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

      {/* ═══ Contact ═══ */}
      <section className="py-20 border-t border-border/30">
        <div className="container max-w-2xl">
          <div className="text-center mb-10">
            <h2 className="text-3xl font-bold mb-4">联系我们</h2>
            <p className="text-muted-foreground">有任何问题或合作意向，欢迎留言</p>
          </div>
          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input placeholder="您的姓名" value={contactForm.name} onChange={(e) => setContactForm(p => ({ ...p, name: e.target.value }))} className="bg-background/50" />
                <Input placeholder="邮箱地址" type="email" value={contactForm.email} onChange={(e) => setContactForm(p => ({ ...p, email: e.target.value }))} className="bg-background/50" />
              </div>
              <Input placeholder="主题" value={contactForm.subject} onChange={(e) => setContactForm(p => ({ ...p, subject: e.target.value }))} className="bg-background/50" />
              <Textarea placeholder="请输入您的消息..." rows={4} value={contactForm.message} onChange={(e) => setContactForm(p => ({ ...p, message: e.target.value }))} className="bg-background/50" />
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

      {/* ═══ Footer ═══ */}
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
            <Link href="/pricing" className="hover:text-foreground no-underline">套餐定价</Link>
            <Link href="/gallery" className="hover:text-foreground no-underline">视频展厅</Link>
          </div>
        </div>
      </footer>

      {/* ═══ CSS Animations ═══ */}
      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
