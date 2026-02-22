import { useState } from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, CheckCircle, Coins, ChevronRight, Gift, Bolt, Zap, Flame, Settings, Receipt, BarChart3, Smile, Box, Film, Video } from "lucide-react";

type BillingInterval = "monthly" | "yearly";

export default function Pricing() {
  const [, navigate] = useLocation();
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);

  const { data: planData, isLoading: plansLoading } = trpc.stripe.getPlans.useQuery();
  const { data: subData, isLoading: subLoading } = trpc.stripe.getSubscription.useQuery(undefined, {
    retry: false,
  });

  const checkoutMutation = trpc.stripe.createCheckoutSession.useMutation();
  const creditPackMutation = trpc.stripe.createCreditPackCheckout.useMutation();
  const portalMutation = trpc.stripe.getPortalUrl.useMutation();
  const { data: invoicesData } = trpc.stripe.getInvoices.useQuery(undefined, { retry: false });

  const handleOpenPortal = async () => {
    try {
      const result = await portalMutation.mutateAsync();
      if (result.url) {
        window.open(result.url, "_blank");
      }
    } catch (err: any) {
      toast.error(err.message || "无法打开订阅管理页面");
    }
  };

  const handleSubscribe = async (plan: "pro" | "enterprise") => {
    setLoadingPlan(plan);
    try {
      const result = await checkoutMutation.mutateAsync({ plan, interval });
      if (result.url) {
        window.open(result.url, "_blank");
      }
    } catch (err: any) {
      toast.error(err.message || "无法创建付款页面");
    } finally {
      setLoadingPlan(null);
    }
  };

  const handleBuyCreditPack = async (packId: "small" | "medium" | "large") => {
    setLoadingPlan(packId);
    try {
      const result = await creditPackMutation.mutateAsync({ packId });
      if (result.url) {
        window.open(result.url, "_blank");
      }
    } catch (err: any) {
      toast.error(err.message || "无法创建付款页面");
    } finally {
      setLoadingPlan(null);
    }
  };

  const currentPlan = subData?.plan ?? "free";

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="overflow-y-auto pb-16">
        {/* Header */}
        <div className="px-6 pt-8 pb-4">
          <h1 className="text-3xl font-extrabold text-white">选择方案</h1>
          <p className="text-base text-gray-400 mt-1">解锁 AI 创作的全部潜力</p>
        </div>

        {/* Credits Balance (if logged in) */}
        {subData && (
          <Link href="/credits-dashboard">
            <a className="flex justify-between items-center mx-6 mb-4 bg-[#1A1A1D] rounded-xl p-4 border border-white/10 cursor-pointer">
              <div className="flex items-center gap-2">
                <Coins className="h-5 w-5 text-[#FF6B35]" />
                <span className="text-sm text-white">Credits 余额</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-lg font-bold text-[#FF6B35]">{subData.credits.balance}</span>
                <ChevronRight className="h-5 w-5 text-gray-500" />
              </div>
            </a>
          </Link>
        )}

        {/* Billing Toggle */}
        <div className="flex mx-6 mb-5 bg-[#1A1A1D] rounded-lg p-1">
          <button
            onClick={() => setInterval("monthly")}
            className={`flex-1 py-2.5 rounded-md flex items-center justify-center gap-1.5 text-sm font-semibold transition-colors ${interval === "monthly" ? "bg-[#FF6B35] text-white" : "text-gray-400"}`}>
            月付
          </button>
          <button
            onClick={() => setInterval("yearly")}
            className={`flex-1 py-2.5 rounded-md flex items-center justify-center gap-1.5 text-sm font-semibold transition-colors ${interval === "yearly" ? "bg-[#FF6B35] text-white" : "text-gray-400"}`}>
            年付
            <span className="bg-green-500 text-white text-xs font-bold rounded px-1.5 py-0.5">省 20%</span>
          </button>
        </div>

        {/* Plan Cards */}
        <div className="px-6 space-y-4">
          {/* Free Plan */}
          <div className={`relative bg-[#1A1A1D] rounded-2xl p-6 border ${currentPlan === "free" ? "border-[#FF6B35] border-2" : "border-white/10"}`}>
            {currentPlan === "free" && (
                <div className="absolute top-3 right-3 bg-[#FF6B35]/20 rounded-full px-3 py-1">
                    <span className="text-[#FF6B35] text-xs font-semibold">当前方案</span>
                </div>
            )}
            <h2 className="text-xl font-bold text-white mb-2">入門版</h2>
            <p className="text-4xl font-extrabold text-white">¥0<span className="text-sm font-normal text-gray-400 ml-1">/月</span></p>
            <div className="mt-4 space-y-1.5">
              <FeatureRow text="視頻 PK 評分（前 2 次）0 Credits" />
              <FeatureRow text="偶像生成（前 3 次）0 Credits" />
              <FeatureRow text="分鏡腳本（第 1 次）0 Credits" />
              <FeatureRow text="视频展厅浏览" />
            </div>
          </div>

          {/* Pro Plan */}
          <div className={`relative bg-[#FF6B35] rounded-2xl p-6 border ${currentPlan === "pro" ? "border-white/50 border-2" : "border-[#FF6B35]"}`}>
             <div className="absolute -top-2.5 left-5 bg-[#0A0A0C] rounded-full px-3 py-1">
                <span className="text-[#FF6B35] text-xs font-bold">最受欢迎</span>
            </div>
            {currentPlan === "pro" && (
                <div className="absolute top-3 right-3 bg-white/20 rounded-full px-3 py-1">
                    <span className="text-white text-xs font-semibold">当前方案</span>
                </div>
            )}
            <h2 className="text-xl font-bold text-white mb-2">专业版</h2>
            {currentPlan === "free" && (
                <div className="flex items-center gap-1.5 mb-2">
                    <Gift className="h-3 w-3 text-white" />
                    <span className="text-xs text-white font-semibold">7 天體驗期</span>
                </div>
            )}
            <div className="flex items-baseline">
                <p className="text-4xl font-extrabold text-white">
                    ${interval === "monthly" ? "29" : "23"}
                </p>
                <span className="text-sm font-normal text-white/80 ml-1">/月</span>
            </div>
            {interval === "yearly" && (
              <p className="text-white/70 text-sm mt-0.5">
                年付 ¥1036（省 ¥216）
              </p>
            )}
            <div className="mt-4 space-y-1.5">
                <FeatureRow text="无限视频 PK 评分" light />
                <FeatureRow text="无限虚拟偶像生成" light />
                <FeatureRow text="无限分镜脚本生成" light />
                <FeatureRow text="偶像图片转 3D" light />
                <FeatureRow text="视频生成" light />
                <FeatureRow text="PDF 报告导出" light />
                <FeatureRow text="每月 500 Credits" light />
                <FeatureRow text="优先处理队列" light />
            </div>
            <button
              onClick={() => handleSubscribe("pro")}
              disabled={currentPlan === "pro" || loadingPlan === "pro"}
              className="w-full bg-white rounded-lg py-3.5 mt-5 text-center text-base font-bold text-[#0A0A0C] disabled:opacity-50">
              {loadingPlan === "pro" ? (
                <Loader2 className="h-5 w-5 animate-spin mx-auto" />
              ) : (
                <span>
                  {currentPlan === "pro" ? "已訂閱" : currentPlan === "free" ? "開始 7 天體驗" : "立即升級"}
                </span>
              )}
            </button>
          </div>

          {/* Enterprise Plan */}
          <div className={`relative bg-[#1A1A1D] rounded-2xl p-6 border ${currentPlan === "enterprise" ? "border-[#FF6B35] border-2" : "border-white/10"}`}>
            {currentPlan === "enterprise" && (
                <div className="absolute top-3 right-3 bg-[#FF6B35]/20 rounded-full px-3 py-1">
                    <span className="text-[#FF6B35] text-xs font-semibold">当前方案</span>
                </div>
            )}
            <h2 className="text-xl font-bold text-white mb-2">企业版</h2>
            <div className="flex items-baseline">
                <p className="text-4xl font-extrabold text-white">${interval === "monthly" ? "99" : "79"}</p>
                <span className="text-sm font-normal text-gray-400 ml-1">/月</span>
            </div>
            {interval === "yearly" && (
              <p className="text-gray-400 text-sm mt-0.5">
                年付 ¥3437（省 ¥859）
              </p>
            )}
            <div className="mt-4 space-y-1.5">
                <FeatureRow text="所有专业版功能" />
                <FeatureRow text="API 访问" />
                <FeatureRow text="白标授权" />
                <FeatureRow text="专属客服" />
                <FeatureRow text="团队席位" />
                <FeatureRow text="每月 2000 Credits" />
                <FeatureRow text="发票付款" />
            </div>
            <button
              onClick={() => handleSubscribe("enterprise")}
              disabled={currentPlan === "enterprise" || loadingPlan === "enterprise"}
              className="w-full border border-[#FF6B35] rounded-lg py-3.5 mt-5 text-center text-base font-bold text-[#FF6B35] disabled:opacity-50">
              {loadingPlan === "enterprise" ? (
                <Loader2 className="h-5 w-5 animate-spin mx-auto text-[#FF6B35]" />
              ) : (
                <span>
                  {currentPlan === "enterprise" ? "已订阅" : "联系销售"}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Credits Packs Section */}
        <div className="mt-8 px-6">
          <h3 className="text-2xl font-bold text-white">Credits 加值包</h3>
          <p className="text-gray-400 mt-1">需要更多 Credits？随时加值，永不过期</p>

          <div className="grid grid-cols-3 gap-4 mt-4">
            {/* Small Pack */}
            <button
              onClick={() => handleBuyCreditPack("small")}
              disabled={loadingPlan === "small"}
              className="relative flex flex-col items-center justify-center bg-[#1A1A1D] border border-white/10 rounded-xl p-4 text-center transition-colors hover:border-[#FF6B35] disabled:opacity-50">
              <Bolt className="h-8 w-8 text-[#FF6B35]" />
              <span className="text-2xl font-bold text-white mt-2">100</span>
              <span className="text-sm text-gray-400">Credits</span>
              <span className="text-lg font-semibold text-white mt-2">¥68</span>
              {loadingPlan === "small" ? (
                <Loader2 className="h-5 w-5 animate-spin mt-2 text-[#FF6B35]" />
              ) : (
                <span className="text-sm font-semibold text-[#FF6B35] mt-2">购买</span>
              )}
            </button>

            {/* Medium Pack */}
            <button
              onClick={() => handleBuyCreditPack("medium")}
              disabled={loadingPlan === "medium"}
              className="relative flex flex-col items-center justify-center bg-[#1A1A1D] border-2 border-[#FF6B35] rounded-xl p-4 text-center transition-colors disabled:opacity-50">
                <div className="absolute -top-2.5 bg-[#FF6B35] text-white text-xs font-bold rounded-full px-2 py-0.5">热门</div>
              <Zap className="h-8 w-8 text-[#FF6B35]" />
              <span className="text-2xl font-bold text-white mt-2">250</span>
              <span className="text-sm text-gray-400">Credits</span>
              <span className="text-lg font-semibold text-white mt-2">¥168</span>
              <span className="text-xs text-green-400">省 4%</span>
              {loadingPlan === "medium" ? (
                <Loader2 className="h-5 w-5 animate-spin mt-2 text-[#FF6B35]" />
              ) : (
                <span className="text-sm font-semibold text-[#FF6B35] mt-2">购买</span>
              )}
            </button>

            {/* Large Pack */}
            <button
              onClick={() => handleBuyCreditPack("large")}
              disabled={loadingPlan === "large"}
              className="relative flex flex-col items-center justify-center bg-[#1A1A1D] border border-white/10 rounded-xl p-4 text-center transition-colors hover:border-[#FF6B35] disabled:opacity-50">
                <div className="absolute -top-2.5 bg-green-500 text-white text-xs font-bold rounded-full px-2 py-0.5">最超值</div>
              <Flame className="h-8 w-8 text-[#FF6B35]" />
              <span className="text-2xl font-bold text-white mt-2">500</span>
              <span className="text-sm text-gray-400">Credits</span>
              <span className="text-lg font-semibold text-white mt-2">¥328</span>
              <span className="text-xs text-green-400">省 6.3%</span>
              {loadingPlan === "large" ? (
                <Loader2 className="h-5 w-5 animate-spin mt-2 text-[#FF6B35]" />
              ) : (
                <span className="text-sm font-semibold text-[#FF6B35] mt-2">购买</span>
              )}
            </button>
          </div>
        </div>

        {/* Credits Cost Table */}
        <div className="mt-8 px-6">
          <h3 className="text-2xl font-bold text-white">Credits 消耗说明</h3>
          <div className="bg-[#1A1A1D] border border-white/10 rounded-xl mt-4 divide-y divide-white/10">
            <CostRow icon={<BarChart3 className="h-5 w-5 text-[#FF6B35]" />} label="视频 PK 评分" cost={8} />
            <CostRow icon={<Smile className="h-5 w-5 text-[#FF6B35]" />} label="虚拟偶像生成" cost={3} />
            <CostRow icon={<Box className="h-5 w-5 text-[#FF6B35]" />} label="偶像转 3D" cost={10} badge="PRO" />
            <CostRow icon={<Film className="h-5 w-5 text-[#FF6B35]" />} label="分镜脚本生成" cost={15} />
            <CostRow icon={<Video className="h-5 w-5 text-[#FF6B35]" />} label="视频生成" cost={25} />
          </div>
        </div>

        {/* Student Discount */}
        <Link href="/student-verification">
            <a className="block mx-6 mt-8 p-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl cursor-pointer">
                <h4 className="text-xl font-bold text-white">🎓 学生优惠</h4>
                <p className="text-white/80 mt-1 text-sm">验证学生身份，享受超值订阅优惠（一年版含视频生成 2 次/月）</p>
                <div className="flex gap-4 mt-2">
                    <div>
                        <p className="text-lg font-bold text-white">¥138</p>
                        <p className="text-xs text-white/80">半年</p>
                    </div>
                    <div>
                        <p className="text-lg font-bold text-white">¥268</p>
                        <p className="text-xs text-white/80">一年</p>
                    </div>
                </div>
            </a>
        </Link>

        {/* Subscription Management */}
        {subData?.subscription && subData.plan !== "free" && (
          <div className="mt-8 px-6">
            <h3 className="text-2xl font-bold text-white">订阅管理</h3>
            <div className="bg-[#1A1A1D] border border-white/10 rounded-xl mt-4 p-4">
              <div className="flex justify-between items-center">
                <p className="text-base font-semibold text-white">
                  {subData.planConfig.nameCn}
                </p>
                {subData.subscription.cancelAtPeriodEnd && (
                  <div className="bg-yellow-500/20 px-2 py-0.5 rounded">
                    <p className="text-yellow-400 text-xs">即将取消</p>
                  </div>
                )}
              </div>
              {subData.subscription.currentPeriodEnd && (
                <p className="text-gray-400 text-sm mt-1">
                  {subData.subscription.cancelAtPeriodEnd ? "到期日" : "下次续费"}：
                  {new Date(subData.subscription.currentPeriodEnd).toLocaleDateString("zh-TW")}
                </p>
              )}

              <div className="flex gap-2.5 mt-3.5">
                <button
                  onClick={handleOpenPortal}
                  disabled={portalMutation.isPending}
                  className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-50">
                  <Settings className="h-4 w-4 text-[#FF6B35]" />
                  <span>
                    {portalMutation.isPending ? "加载中..." : "管理订阅"}
                  </span>
                </button>
                <Link href="/credits-dashboard">
                    <a className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white rounded-md px-3 py-2 text-sm font-semibold">
                        <Receipt className="h-4 w-4 text-[#FF6B35]" />
                        <span>帐单记录</span>
                    </a>
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* 历史发票 */}
        {invoicesData && invoicesData.length > 0 && (
          <div className="mt-8 px-6">
            <h3 className="text-2xl font-bold text-white">历史发票</h3>
            <div className="bg-[#1A1A1D] border border-white/10 rounded-xl mt-4 divide-y divide-white/10">
              {invoicesData.slice(0, 5).map((inv: any, idx: number) => (
                <div key={inv.id || idx} className="flex justify-between items-center p-4">
                  <div className="flex-1">
                    <p className="text-sm text-white">
                      {inv.description || `发票 #${inv.stripeInvoiceId?.slice(-6) || idx + 1}`}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {inv.createdAt ? new Date(inv.createdAt).toLocaleDateString("zh-TW") : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-[#FF6B35]">
                      ${((inv.amountPaid ?? 0) / 100).toFixed(2)}
                    </p>
                    <div className={`mt-1 px-2 py-0.5 rounded text-xs inline-block ${inv.status === "paid" ? "bg-green-500/20 text-green-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                        {inv.status === "paid" ? "已付款" : inv.status === "open" ? "待付款" : inv.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FeatureRow({ text, light }: { text: string; light?: boolean }) {
  return (
    <div className="flex items-center mb-1.5">
      <CheckCircle className={`h-4 w-4 ${light ? "text-green-300" : "text-green-500"}`} />
      <span className={`text-sm ml-2 ${light ? "text-white/90" : "text-gray-200"}`}>
        {text}
      </span>
    </div>
  );
}

function CostRow({ icon, label, cost, badge }: { icon: React.ReactNode; label: string; cost: number; badge?: string }) {
  return (
    <div className="flex justify-between items-center p-4">
      <div className="flex items-center gap-2.5">
        {icon}
        <span className="text-sm text-gray-200">{label}</span>
        {badge && (
          <div className="bg-[#FF6B35] rounded text-white text-[10px] font-extrabold px-1.5 py-0.5">{badge}</div>
        )}
      </div>
      <span className="text-sm font-semibold text-[#FF6B35]">{cost} Credits</span>
    </div>
  );
}
