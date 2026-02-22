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
  FolderOpen, Flame, Zap, Box, Music2
} from "lucide-react";

/* ── Runway-style Cinematic Particle Canvas ── */
function CinematicBackground() {
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
      "232,130,94", "168,85,247", "59,130,246",
      "236,72,153", "245,158,11", "99,102,241", "20,184,166",
    ];

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }

    function initParticles() {
      particles = [];
      const count = Math.floor((canvas!.width * canvas!.height) / 12000);
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * canvas!.width,
          y: Math.random() * canvas!.height,
          vx: (Math.random() - 0.5) * 0.2,
          vy: (Math.random() - 0.5) * 0.2,
          r: Math.random() * 1.8 + 0.3,
          baseO: Math.random() * 0.4 + 0.1,
          color: colors[Math.floor(Math.random() * colors.length)],
          phase: Math.random() * Math.PI * 2,
        });
      }
    }

    function drawLightRays(time: number) {
      const w = canvas!.width, h = canvas!.height;
      const sweepX = (Math.sin(time * 0.12) * 0.3 + 0.35) * w;
      const sweepY = (Math.cos(time * 0.1) * 0.2 + 0.2) * h;
      const grad1 = ctx!.createRadialGradient(sweepX, sweepY, 0, sweepX, sweepY, w * 0.5);
      grad1.addColorStop(0, "rgba(232,130,94,0.18)");
      grad1.addColorStop(0.3, "rgba(168,85,247,0.08)");
      grad1.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = grad1;
      ctx!.fillRect(0, 0, w, h);

      const s2x = (Math.sin(time * 0.08 + 2) * 0.25 + 0.65) * w;
      const s2y = (Math.cos(time * 0.06 + 1) * 0.2 + 0.7) * h;
      const grad2 = ctx!.createRadialGradient(s2x, s2y, 0, s2x, s2y, w * 0.4);
      grad2.addColorStop(0, "rgba(59,130,246,0.14)");
      grad2.addColorStop(0.4, "rgba(20,184,166,0.06)");
      grad2.addColorStop(1, "rgba(0,0,0,0)");
      ctx!.fillStyle = grad2;
      ctx!.fillRect(0, 0, w, h);
    }

    function draw() {
      t += 0.016;
      const w = canvas!.width, h = canvas!.height;
      ctx!.clearRect(0, 0, w, h);
      drawLightRays(t);

      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
        const breathe = Math.sin(t * 1.5 + p.phase) * 0.15 + 1;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r * breathe, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(${p.color},${p.baseO * breathe})`;
        ctx!.fill();
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = dx * dx + dy * dy;
          if (dist < 8000) {
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.strokeStyle = `rgba(232,130,94,${(1 - dist / 8000) * 0.08})`;
            ctx!.lineWidth = 0.4;
            ctx!.stroke();
          }
        }
      }
      animId = requestAnimationFrame(draw);
    }

    resize(); initParticles(); draw();
    const handleResize = () => { resize(); initParticles(); };
    window.addEventListener("resize", handleResize);
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", handleResize); };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />;
}

/* ── Creative Tools Data ── */
const CREATIVE_TOOLS = [
  {
    icon: BarChart3, title: "视频 PK 评分", titleEn: "Video PK Score",
    desc: "AI 自动分析画面构图、色彩风格、节奏感与爆款潜力评分",
    gradient: "from-blue-500 to-cyan-400", iconColor: "text-blue-400", glowColor: "rgba(59,130,246,0.3)",
    href: "/analysis", ready: true, credits: "8 Credits/次",
  },
  {
    icon: Sparkles, title: "虚拟偶像工坊", titleEn: "Virtual Idol Studio",
    desc: "输入描述即可生成动漫风、写实风、赛博朋克等多风格虚拟偶像",
    gradient: "from-green-500 to-emerald-400", iconColor: "text-green-400", glowColor: "rgba(34,197,94,0.3)",
    href: "/idol", ready: true, credits: "3 Credits/次",
  },
  {
    icon: Clapperboard, title: "智能分镜生成", titleEn: "AI Storyboard",
    desc: "輸入歌詞或文本，AI 自動生成專業視頻分鏡腳本與分鏡圖",
    gradient: "from-yellow-500 to-amber-400", iconColor: "text-yellow-400", glowColor: "rgba(245,158,11,0.3)",
    href: "/storyboard", ready: true, credits: "8 Credits 起",
  },
  {
    icon: Wand2, title: "分镜转视频", titleEn: "Storyboard to Video",
    desc: "将分镜脚本转化为高质量视频片段，支持情感滤镜与动态特效",
    gradient: "from-emerald-500 to-teal-400", iconColor: "text-emerald-400", glowColor: "rgba(20,184,166,0.3)",
    href: "/vfx", ready: true, credits: "50 Credits/次",
  },
  {
    icon: Zap, title: "可靈工作室", titleEn: "Kling AI Studio",
    desc: "Kling 2.1 视频生成、Motion Control 动作迁移、Lip-Sync 对口型",
    gradient: "from-purple-500 to-violet-400", iconColor: "text-purple-400", glowColor: "rgba(168,85,247,0.3)",
    href: "/remix", ready: true, credits: "按模型计费",
  },
  {
    icon: Box, title: "2D 转 3D 工坊", titleEn: "3D Studio",
    desc: "将 2D 图片一键转换为高精度 3D 模型，支持 PBR 材质与多视角",
    gradient: "from-cyan-500 to-blue-400", iconColor: "text-cyan-400", glowColor: "rgba(6,182,212,0.3)",
    href: "/3d-studio", ready: true, credits: "5 Credits 起",
  },
  {
    icon: Flame, title: "爆款展厅", titleEn: "Showcase Gallery",
    desc: "浏览 90 分以上的获奖爆款视频，评论互动，发现优秀创作者",
    gradient: "from-orange-500 to-red-400", iconColor: "text-orange-400", glowColor: "rgba(249,115,22,0.3)",
    href: "/showcase", ready: true, credits: "免费浏览",
  },
  {
    icon: FolderOpen, title: "我的创作", titleEn: "My Creations",
    desc: "查看已上传视频的评分历史、Credits 奖励记录和分析详情",
    gradient: "from-sky-500 to-indigo-400", iconColor: "text-sky-400", glowColor: "rgba(14,165,233,0.3)",
    href: "/dashboard", ready: true, credits: "免费使用",
  },
];

const SHOWCASE_MVS = [
  { id: "mv1", title: "Neon Dreams", artist: "CyberVox", thumbnail: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&h=340&fit=crop" },
  { id: "mv2", title: "Sakura Rain", artist: "Luna AI", thumbnail: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=600&h=340&fit=crop" },
  { id: "mv3", title: "Digital Soul", artist: "PixelBeat", thumbnail: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&h=340&fit=crop" },
];

/* ── Staggered Reveal Hook ── */
function useStaggerReveal(count: number, delay = 80) {
  const [visible, setVisible] = useState<boolean[]>(new Array(count).fill(false));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          for (let i = 0; i < count; i++) {
            setTimeout(() => setVisible(prev => { const n = [...prev]; n[i] = true; return n; }), i * delay);
          }
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [count, delay]);

  return { ref, visible };
}

export default function Home() {
  const { isAuthenticated } = useAuth();
  const [contactForm, setContactForm] = useState({ name: "", email: "", subject: "", message: "" });
  const toolsReveal = useStaggerReveal(CREATIVE_TOOLS.length, 90);
  const [heroLoaded, setHeroLoaded] = useState(false);

  useEffect(() => {
    document.title = "MV Studio Pro - AI 驱动的一站式视频创作平台";
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute("content", "MV Studio Pro 是专业的AI视频创作平台，提供视频PK评分、虚拟偶像生成、智能分镜脚本、分镜转视频等一站式创作工具。");
    requestAnimationFrame(() => setHeroLoaded(true));
  }, []);

  const submitGuestbook = trpc.guestbook.submit.useMutation({
    onSuccess: () => { toast.success("消息已发送！我们会尽快回复您。"); setContactForm({ name: "", email: "", subject: "", message: "" }); },
    onError: () => toast.error("发送失败，请稍后重试"),
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />

      {/* ═══ Hero Section — Runway/Midjourney Cinematic Style ═══ */}
      <section className="relative pt-24 pb-8 overflow-hidden min-h-[60vh] flex items-center" style={{ background: 'linear-gradient(135deg, #101018 0%, #15131f 25%, #18141a 50%, #121520 75%, #101018 100%)' }}>
        <CinematicBackground />

        {/* Animated gradient orbs */}
        <div className="absolute top-[-10%] left-[5%] w-[600px] h-[600px] rounded-full blur-[160px] animate-[heroGlow1_8s_ease-in-out_infinite]" />
        <div className="absolute bottom-[-15%] right-[0%] w-[550px] h-[550px] rounded-full blur-[150px] animate-[heroGlow2_10s_ease-in-out_infinite]" />
        <div className="absolute top-[20%] left-[40%] w-[450px] h-[450px] rounded-full blur-[140px] animate-[heroGlow3_12s_ease-in-out_infinite]" />

        {/* Vignette */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_65%_at_50%_45%,transparent_0%,rgba(16,16,18,0.15)_60%,rgba(16,16,18,0.55)_100%)]" />

        {/* Noise texture */}
        <div className="absolute inset-0 opacity-[0.02]" style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
          backgroundSize: "128px 128px"
        }} />

        <div className="container relative z-10">
          <div className="max-w-4xl mx-auto text-center">
            {/* Badge — cinematic reveal */}
            <div
              className={`inline-flex items-center gap-2 px-5 py-2 mb-6 rounded-full border border-primary/30 bg-primary/10 text-primary text-sm font-medium backdrop-blur-sm transition-all duration-700 ${heroLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}
            >
              <Sparkles className="h-4 w-4" /> AI 驱动的一站式视频创作平台
            </div>

            {/* Main Title — staggered word reveal */}
            <h1
              className={`text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1] mb-6 transition-all duration-700 delay-150 ${heroLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
            >
              让你视频的每一帧
              <br />
              <span className="bg-gradient-to-r from-primary via-orange-400 to-amber-400 bg-clip-text text-transparent">
                都成为爆款的起点
              </span>
            </h1>

            {/* Subtitle */}
            <p
              className={`text-lg text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed transition-all duration-700 delay-300 ${heroLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
            >
              从视频 PK 评分到虚拟偶像生成，8 大 AI 创作工具一站搞定
            </p>

            {/* CTA Buttons */}
            <div
              className={`flex flex-col sm:flex-row gap-4 justify-center transition-all duration-700 delay-[450ms] ${heroLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
            >
              {isAuthenticated ? (
                <Link href="/showcase">
                  <Button size="lg" className="btn-gradient-primary gap-2 text-base px-8 shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all duration-300 hover:scale-[1.03] active:scale-[0.97]">
                    进入爆款展厅 <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
              ) : (
                <Button
                  size="lg"
                  className="btn-gradient-primary gap-2 text-base px-8 shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all duration-300 hover:scale-[1.03] active:scale-[0.97]"
                  onClick={() => { window.location.href = getLoginUrl(); }}
                >
                  開始創作 <ArrowRight className="h-5 w-5" />
                </Button>
              )}
              <Link href="/showcase">
                <Button size="lg" variant="outline" className="gap-2 text-base px-8 bg-transparent border-white/20 hover:bg-white/5 hover:border-white/30 transition-all duration-300 hover:scale-[1.03] active:scale-[0.97]">
                  <Play className="h-5 w-5" /> 浏览精选作品
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Bottom gradient fade — shorter */}
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-background to-transparent" />
      </section>

      {/* ═══ Creative Tools — Immediately visible, Runway card style ═══ */}
      <section className="pt-10 pb-20 relative">
        {/* Section ambient glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full blur-[200px] bg-primary/5 pointer-events-none" />

        <div className="container relative z-10">
          <div className="text-center mb-10">
            <p className="text-primary text-sm font-semibold tracking-widest uppercase mb-2">✨ Creative Tools</p>
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">创作工具</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">8 大 AI 驱动的全方位视频创作工具，从灵感到成品一站搞定</p>
          </div>

          {/* Tool cards — 4 columns, staggered reveal */}
          <div ref={toolsReveal.ref} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {CREATIVE_TOOLS.map((tool, i) => (
              <Link key={tool.title} href={tool.ready ? tool.href : "#"} onClick={(e) => { if (!tool.ready) { e.preventDefault(); toast.info("功能即将上线，敬请期待！"); } }}>
                <div
                  className={`group relative rounded-xl overflow-hidden transition-all duration-500 cursor-pointer h-full
                    ${toolsReveal.visible[i] ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}
                  `}
                  style={{ transitionDelay: `${i * 60}ms` }}
                >
                  {/* Glass card background */}
                  <div className="absolute inset-0 bg-white/[0.03] backdrop-blur-sm border border-white/[0.06] rounded-xl transition-all duration-400 group-hover:bg-white/[0.06] group-hover:border-white/[0.12]" />

                  {/* Hover glow effect */}
                  <div
                    className="absolute -inset-px rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-xl"
                    style={{ background: tool.glowColor }}
                  />

                  {/* Content */}
                  <div className="relative p-5 flex flex-col h-full min-h-[200px]">
                    {/* Icon with gradient background */}
                    <div className={`w-11 h-11 rounded-lg bg-gradient-to-br ${tool.gradient} flex items-center justify-center mb-4 shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:shadow-xl group-hover:rotate-[-3deg]`}>
                      <tool.icon className="h-5 w-5 text-white" />
                    </div>

                    {/* Title */}
                    <h3 className="text-[15px] font-bold mb-1.5 transition-colors duration-300 group-hover:text-white">{tool.title}</h3>
                    <p className="text-[11px] text-muted-foreground/60 font-medium uppercase tracking-wider mb-2">{tool.titleEn}</p>

                    {/* Description */}
                    <p className="text-xs text-muted-foreground leading-relaxed flex-1 mb-3">{tool.desc}</p>

                    {/* Credits badge + arrow */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium text-primary/80 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
                        {tool.credits}
                      </span>
                      <div className={`${tool.iconColor} flex items-center gap-1 text-xs font-medium opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-[-4px] group-hover:translate-x-0`}>
                        进入 <ArrowRight className="h-3 w-3" />
                      </div>
                    </div>
                  </div>
                </div>
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
            <Link href="/showcase">
              <Button variant="ghost" className="gap-1 text-primary hover:text-primary/80 transition-all duration-300 hover:translate-x-1">
                查看全部 <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {SHOWCASE_MVS.map((mv) => (
              <Link key={mv.id} href="/showcase">
                <Card className="overflow-hidden bg-card/50 border-border/50 hover:border-primary/30 transition-all duration-500 group cursor-pointer hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-1">
                  <div className="relative aspect-video overflow-hidden">
                    <img src={mv.thumbnail} alt={mv.title} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out" />
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="w-14 h-14 rounded-full bg-primary/90 flex items-center justify-center scale-75 group-hover:scale-100 transition-transform duration-300">
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
              <div key={s.label} className="group">
                <div className="text-3xl font-bold text-primary mb-1 transition-transform duration-300 group-hover:scale-110">{s.value}</div>
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
          <Card className="bg-card/50 border-border/50 hover:border-border/70 transition-all duration-300">
            <CardContent className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input placeholder="您的姓名" value={contactForm.name} onChange={(e) => setContactForm(p => ({ ...p, name: e.target.value }))} className="bg-background/50 transition-all duration-300 focus:shadow-lg focus:shadow-primary/5" />
                <Input placeholder="邮箱地址" type="email" value={contactForm.email} onChange={(e) => setContactForm(p => ({ ...p, email: e.target.value }))} className="bg-background/50 transition-all duration-300 focus:shadow-lg focus:shadow-primary/5" />
              </div>
              <Input placeholder="主题" value={contactForm.subject} onChange={(e) => setContactForm(p => ({ ...p, subject: e.target.value }))} className="bg-background/50 transition-all duration-300 focus:shadow-lg focus:shadow-primary/5" />
              <Textarea placeholder="请输入您的消息..." rows={4} value={contactForm.message} onChange={(e) => setContactForm(p => ({ ...p, message: e.target.value }))} className="bg-background/50 transition-all duration-300 focus:shadow-lg focus:shadow-primary/5" />
              <Button
                className="w-full btn-gradient-primary gap-2 transition-all duration-300 hover:scale-[1.01] active:scale-[0.99]"
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
            <Link href="/pricing" className="hover:text-foreground no-underline transition-colors duration-300">套餐定价</Link>
            <Link href="/showcase" className="hover:text-foreground no-underline transition-colors duration-300">爆款展厅</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
