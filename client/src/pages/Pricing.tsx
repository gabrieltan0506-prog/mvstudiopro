import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState, useRef, useEffect } from "react";
import { Check, Crown, Zap, Building2, Upload, Loader2, CreditCard, Coins, ArrowRight } from "lucide-react";
import { PLANS, CREDIT_PACKS, type PlanType } from "@shared/plans";
import { useSearch } from "wouter";

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

const PACK_ORDER = ["small", "medium", "large"] as const;

export default function Pricing() {
  const { isAuthenticated } = useAuth();
  const search = useSearch();
  const [billingInterval, setBillingInterval] = useState<"month" | "year">("month");
  const [selectedPlan, setSelectedPlan] = useState<PlanType | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [loadingPack, setLoadingPack] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = "套餐定价 - MV Studio Pro";
    const params = new URLSearchParams(search);
    if (params.get("payment") === "success") {
      toast.success("支付成功！感谢您的订阅。");
    } else if (params.get("payment") === "canceled") {
      toast.info("支付已取消。");
    } else if (params.get("credits") === "purchased") {
      toast.success("Credits 购买成功！");
    }
  }, []);

  // Stripe subscription
  const createSubscription = trpc.stripe.createSubscription.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        toast.info("正在跳转到支付页面...");
        window.open(data.url, "_blank");
      }
      setLoadingPlan(null);
    },
    onError: (err) => {
      toast.error(`订阅失败: ${err.message}`);
      setLoadingPlan(null);
    },
  });

  // Stripe credit purchase
  const purchaseCredits = trpc.stripe.purchaseCredits.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        toast.info("正在跳转到支付页面...");
        window.open(data.url, "_blank");
      }
      setLoadingPack(null);
    },
    onError: (err) => {
      toast.error(`购买失败: ${err.message}`);
      setLoadingPack(null);
    },
  });

  // Screenshot payment (fallback)
  const submitPayment = trpc.payment.submit.useMutation({
    onSuccess: () => {
      toast.success("付款截图已提交，等待人工审核（24小时内）");
      setDialogOpen(false);
    },
    onError: () => toast.error("提交失败，请重试"),
  });

  const handleStripeSubscribe = (planType: "pro" | "enterprise") => {
    setLoadingPlan(`${planType}_${billingInterval}`);
    createSubscription.mutate({ planType, interval: billingInterval });
  };

  const handleCreditPurchase = (pack: "small" | "medium" | "large") => {
    setLoadingPack(pack);
    purchaseCredits.mutate({ pack });
  };

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
      <div className="pt-24 pb-16 container max-w-6xl">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold mb-3">选择适合你的套餐</h1>
          <p className="text-muted-foreground max-w-lg mx-auto">从基础创作到企业级制作，为每一位创作者提供专业工具</p>
        </div>

        {/* Billing Toggle */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-card/80 border border-border/50">
            <button
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${billingInterval === "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setBillingInterval("month")}
            >
              月付
            </button>
            <button
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${billingInterval === "year" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setBillingInterval("year")}
            >
              年付 <span className="text-xs opacity-80">省 20%</span>
            </button>
          </div>
        </div>

        {/* Subscription Plans */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {PLAN_ORDER.map(planId => {
            const plan = PLANS[planId];
            const price = billingInterval === "month" ? plan.monthlyPrice : plan.yearlyPrice;
            const isLoading = loadingPlan === `${planId}_${billingInterval}`;
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
                    {price === 0 ? (
                      <span className="text-3xl font-bold">免费</span>
                    ) : (
                      <>
                        <span className="text-3xl font-bold">${price}</span>
                        <span className="text-muted-foreground text-sm">/{billingInterval === "month" ? "月" : "年"}</span>
                      </>
                    )}
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
                    <div className="space-y-2">
                      {planId !== "free" ? (
                        <>
                          <Button
                            className={`w-full gap-2 ${planId === "pro" ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-purple-600 text-white hover:bg-purple-700"}`}
                            disabled={isLoading}
                            onClick={() => handleStripeSubscribe(planId as "pro" | "enterprise")}
                          >
                            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                            {isLoading ? "处理中..." : "在线支付"}
                          </Button>
                          <Button
                            className="w-full text-xs"
                            variant="ghost"
                            size="sm"
                            onClick={() => { setSelectedPlan(planId); setDialogOpen(true); }}
                          >
                            或使用截图付款
                          </Button>
                        </>
                      ) : (
                        <Button className="w-full bg-transparent" variant="outline" disabled>
                          当前方案
                        </Button>
                      )}
                    </div>
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

        {/* Credits Packs */}
        <div className="mb-16">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold mb-2 flex items-center justify-center gap-2">
              <Coins className="h-6 w-6 text-primary" /> Credits 充值
            </h2>
            <p className="text-muted-foreground text-sm">按需购买 Credits，灵活使用各项 AI 功能</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {PACK_ORDER.map(packId => {
              const pack = CREDIT_PACKS[packId];
              const isLoading = loadingPack === packId;
              return (
                <Card key={packId} className={`bg-card/50 border-border/50 ${packId === "medium" ? "ring-1 ring-primary/20 border-primary/30" : ""}`}>
                  {packId === "medium" && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full">
                      性价比之选
                    </div>
                  )}
                  <CardHeader className="text-center pb-3">
                    <CardTitle className="text-base">{pack.labelCn}</CardTitle>
                    <div className="mt-2">
                      <span className="text-2xl font-bold">${pack.price}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{pack.credits} Credits</p>
                  </CardHeader>
                  <CardContent>
                    {isAuthenticated ? (
                      <Button
                        className="w-full gap-2"
                        variant={packId === "medium" ? "default" : "outline"}
                        disabled={isLoading}
                        onClick={() => handleCreditPurchase(packId)}
                      >
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                        {isLoading ? "处理中..." : "立即购买"}
                      </Button>
                    ) : (
                      <Button className="w-full" variant="outline" onClick={() => { window.location.href = getLoginUrl(); }}>
                        登录后购买
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-center mb-6">常见问题</h2>
          <div className="space-y-4">
            {[
              { q: "Credits 是什么？", a: "Credits 是平台的通用积分，每次使用 AI 功能（分析、生成偶像、分镜脚本等）都会消耗一定数量的 Credits。订阅套餐每月自动发放 Credits，也可单独充值。" },
              { q: "支持哪些付款方式？", a: "支持 Visa、Mastercard、American Express 等国际信用卡/借记卡在线支付（通过 Stripe 安全处理）。如需其他付款方式，可选择截图付款，我们的团队会在 24 小时内完成人工审核。" },
              { q: "可以随时升级或降级吗？", a: "可以。升级立即生效，剩余 Credits 会累计；降级将在当前周期结束后生效。" },
              { q: "年付有什么优惠？", a: "年付享 20% 折扣。专业版年付 $278（相当于每月 $23.2），企业版年付 $950（相当于每月 $79.2）。" },
              { q: "企业版有什么额外服务？", a: "企业版包含专属客户经理、API 接口、自定义品牌水印、优先技术支持、团队席位管理等高级服务。" },
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

      {/* Screenshot Payment Dialog (fallback) */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>截图付款</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              如果您无法使用在线支付，请向以下账户转账后上传付款截图。审核通过后将自动开通 <strong>{sp?.nameCn}</strong> 套餐。
            </p>
            <Card className="bg-background/50 border-border/50">
              <CardContent className="p-4 text-sm space-y-1">
                <div>套餐：{sp?.nameCn}</div>
                <div>金额：${billingInterval === "month" ? sp?.monthlyPrice : sp?.yearlyPrice}/{billingInterval === "month" ? "月" : "年"}</div>
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
