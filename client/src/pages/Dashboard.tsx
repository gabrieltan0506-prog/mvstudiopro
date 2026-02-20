import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Coins, BarChart3, Sparkles, Clapperboard, Wand2, Film, TrendingUp, CreditCard, ArrowUpRight } from "lucide-react";
import { Link } from "wouter";
import { CREDIT_COSTS } from "@shared/plans";

export default function Dashboard() {
  const { user, isAuthenticated } = useAuth();
  const { data: balance } = trpc.credits.balance.useQuery(undefined, { enabled: isAuthenticated });
  const { data: usage } = trpc.credits.usage.useQuery(undefined, { enabled: isAuthenticated });

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Navbar />
        <div className="pt-32 text-center container">
          <Coins className="h-16 w-16 text-primary mx-auto mb-6" />
          <h1 className="text-3xl font-bold mb-4">个人中心</h1>
          <p className="text-muted-foreground mb-8">登录后查看你的 Credits 余额和使用统计</p>
          <Button size="lg" className="bg-primary text-primary-foreground" onClick={() => { window.location.href = getLoginUrl(); }}>立即登录</Button>
        </div>
      </div>
    );
  }

  const usageItems = [
    { label: "视频PK评分", key: "mvAnalysis" as const, icon: BarChart3, color: "text-blue-400", cost: CREDIT_COSTS.mvAnalysis },
    { label: "虚拟偶像生成", key: "idolGeneration" as const, icon: Sparkles, color: "text-purple-400", cost: CREDIT_COSTS.idolGeneration },
    { label: "分镜脚本", key: "storyboard" as const, icon: Clapperboard, color: "text-green-400", cost: CREDIT_COSTS.storyboard },
    { label: "视频生成", key: "videoGeneration" as const, icon: Film, color: "text-primary", cost: CREDIT_COSTS.videoGeneration },
    { label: "偶像转 3D", key: "idol3D" as const, icon: Wand2, color: "text-pink-400", cost: CREDIT_COSTS.idol3D },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <div className="pt-24 pb-16 container max-w-5xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">欢迎回来，{user?.name || "创作者"}</h1>
          <p className="text-muted-foreground">管理你的 Credits 和查看使用统计</p>
        </div>

        {/* Credits Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-gradient-to-br from-primary/20 to-primary/5 border-primary/30 md:col-span-2">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Credits 余额</p>
                  <p className="text-4xl font-bold text-primary">{balance?.balance ?? 0}</p>
                </div>
                <Coins className="h-10 w-10 text-primary/50" />
              </div>
              <div className="flex gap-3">
                <Link href="/pricing">
                  <Button size="sm" className="bg-primary text-primary-foreground gap-1">
                    <CreditCard className="h-3.5 w-3.5" /> 充值 Credits
                  </Button>
                </Link>
                <Link href="/pricing">
                  <Button size="sm" variant="outline" className="bg-transparent gap-1">
                    <ArrowUpRight className="h-3.5 w-3.5" /> 升级套餐
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-muted-foreground">本月使用</p>
                <TrendingUp className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-3xl font-bold">{(() => { if (!usage) return 0; let t = 0; Object.values(usage).forEach((v: any) => { t += v?.usageCount ?? 0; }); return t; })()}</p>
              <p className="text-xs text-muted-foreground mt-1">次 AI 功能调用</p>
            </CardContent>
          </Card>
        </div>

        {/* Usage Breakdown */}
        <Card className="bg-card/50 border-border/50 mb-8">
          <CardHeader><CardTitle>功能使用明细</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-5">
              {usageItems.map(item => {
                const count = (usage as any)?.[item.key] ?? 0;
                const maxCount = Math.max(count, 10);
                return (
                  <div key={item.key} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <item.icon className={`h-4 w-4 ${item.color}`} />
                        <span className="text-sm font-medium">{item.label}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-bold">{count} 次</span>
                        <span className="text-xs text-muted-foreground ml-2">({item.cost} Credits/次)</span>
                      </div>
                    </div>
                    <Progress value={(count / maxCount) * 100} className="h-2" />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <h3 className="text-lg font-semibold mb-4">快速开始</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "视频PK评分", href: "/analysis", icon: BarChart3, color: "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20" },
            { label: "虚拟偶像", href: "/idol", icon: Sparkles, color: "bg-purple-500/10 text-purple-400 hover:bg-purple-500/20" },
            { label: "分镜脚本", href: "/storyboard", icon: Clapperboard, color: "bg-green-500/10 text-green-400 hover:bg-green-500/20" },
            { label: "分镜转视频", href: "/vfx", icon: Wand2, color: "bg-primary/10 text-primary hover:bg-primary/20" },
          ].map(item => (
            <Link key={item.href} href={item.href}>
              <Card className={`cursor-pointer transition-colors ${item.color} border-transparent`}>
                <CardContent className="p-4 text-center">
                  <item.icon className="h-6 w-6 mx-auto mb-2" />
                  <span className="text-sm font-medium">{item.label}</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
