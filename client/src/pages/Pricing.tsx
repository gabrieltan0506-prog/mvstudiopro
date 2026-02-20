import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState, useRef } from "react";
import { Check, Crown, Zap, Building2, Upload, Loader2 } from "lucide-react";
import { PLANS, type PlanType } from "@shared/plans";

const PLAN_ORDER: PlanType[] = ["free", "pro", "enterprise"];

const planIcons: Record<PlanType, React.ReactNode> = {
  free: <Zap className="h-6 w-6" />,
  pro: <Crown className="h-6 w-6" />,
  enterprise: <Building2 className="h-6 w-6" />,
};

const planColors: Record<PlanType, string> = {
  free: "border-border/50",
  pro: "border-primary/50 ring-1 ring-primary/20",
  enterprise: "border-purple-500/50 ring-1 ring-purple-500/20",
};

export default function Pricing() {
  const { isAuthenticated } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState<PlanType | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const submitPayment = trpc.payment.submit.useMutation({
    onSuccess: () => {
      toast.success("付款截图已提交，等待人工审核");
      setDialogOpen(false);
    },
    onError: () => toast.error("提交失败，请重试"),
  });

  const handlePaymentUpload = async (file: File) => {
    if (!selectedPlan) return;
    const plan = PLANS[selectedPlan];
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (res.ok) {
        const { url } = await res.json();
        submitPayment.mutate({ packageType: selectedPlan, screenshotUrl: url, amount: String(plan.monthlyPrice) });
      } else {
        toast.error("截图上传失败");
      }
    } catch {
      toast.error("上传失败");
    }
    setUploading(false);
  };

  const sp = selectedPlan ? PLANS[selectedPlan] : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <div className="pt-24 pb-16 container max-w-5xl">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold mb-3">选择适合你的套餐</h1>
          <p className="text-muted-foreground max-w-lg mx-auto">从基础创作到企业级制作，为每一位创作者提供专业工具</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {PLAN_ORDER.map(planId => {
            const plan = PLANS[planId];
            return (
              <Card key={planId} className={`bg-card/50 relative ${planColors[planId]}`}>
                {planId === "pro" && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full">
                    最受欢迎
                  </div>
                )}
                <CardHeader className="text-center pb-4">
                  <div className={`mx-auto mb-3 w-12 h-12 rounded-xl flex items-center justify-center ${
                    planId === "pro" ? "bg-primary/20 text-primary" :
                    planId === "enterprise" ? "bg-purple-500/20 text-purple-400" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {planIcons[planId]}
                  </div>
                  <CardTitle className="text-lg">{plan.nameCn}</CardTitle>
                  <div className="mt-2">
                    <span className="text-3xl font-bold">{plan.monthlyPrice === 0 ? "免费" : `¥${plan.monthlyPrice}`}</span>
                    {plan.monthlyPrice > 0 && <span className="text-muted-foreground text-sm">/月</span>}
                  </div>
                  {plan.monthlyCredits > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">{plan.monthlyCredits} Credits/月</p>
                  )}
                </CardHeader>
                <CardContent className="space-y-4">
                  <ul className="space-y-2.5">
                    {plan.featuresCn.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <span className="text-muted-foreground">{f}</span>
                      </li>
                    ))}
                  </ul>
                  {isAuthenticated ? (
                    <Button
                      className={`w-full ${planId === "pro" ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-transparent"}`}
                      variant={planId === "pro" ? "default" : "outline"}
                      onClick={() => {
                        if (plan.monthlyPrice === 0) { toast.info("你已在免费方案中"); return; }
                        setSelectedPlan(planId);
                        setDialogOpen(true);
                      }}
                    >
                      {plan.monthlyPrice === 0 ? "当前方案" : "立即订阅"}
                    </Button>
                  ) : (
                    <Button className="w-full bg-transparent" variant="outline" onClick={() => { window.location.href = getLoginUrl(); }}>
                      登录后订阅
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-center mb-6">常见问题</h2>
          <div className="space-y-4">
            {[
              { q: "Credits 是什么？", a: "Credits 是平台的通用积分，每次使用 AI 功能（分析、生成偶像、分镜脚本等）都会消耗一定数量的 Credits。" },
              { q: "如何付款？", a: "选择套餐后上传付款截图，我们的团队会在 24 小时内完成人工审核并开通服务。" },
              { q: "可以随时升级或降级吗？", a: "可以。升级立即生效，剩余 Credits 会累计；降级将在当前周期结束后生效。" },
              { q: "企业版有什么额外服务？", a: "企业版包含专属客户经理、API 接口、自定义品牌水印、优先技术支持等高级服务。" },
            ].map((item, i) => (
              <Card key={i} className="bg-card/50 border-border/50">
                <CardContent className="p-4">
                  <h4 className="font-medium text-sm mb-1">{item.q}</h4>
                  <p className="text-sm text-muted-foreground">{item.a}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* Payment Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>提交付款截图</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              请向以下账户转账后，上传付款截图。审核通过后将自动开通 <strong>{sp?.nameCn}</strong> 套餐。
            </p>
            <Card className="bg-background/50 border-border/50">
              <CardContent className="p-4 text-sm space-y-1">
                <div>套餐：{sp?.nameCn}</div>
                <div>金额：¥{sp?.monthlyPrice}/月</div>
                <div>Credits：{sp?.monthlyCredits}/月</div>
              </CardContent>
            </Card>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { if (e.target.files?.[0]) handlePaymentUpload(e.target.files[0]); }} />
            <Button className="w-full gap-2" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? "上传中..." : "上传付款截图"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
