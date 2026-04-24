import { useState } from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, ArrowLeft, Plus, Gift, Lock, Coins } from "lucide-react";
import { CREDIT_TO_CNY } from "@shared/plans";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";

type TabType = "transactions" | "usage";

export default function LayoutDashboard() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<TabType>("transactions");
  const [betaCode, setBetaCode] = useState("");
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [loginPasswordNew, setLoginPasswordNew] = useState("");
  const [loginPasswordBusy, setLoginPasswordBusy] = useState(false);
  const { user } = useAuth();
  const redeemMutation = trpc.betaCode.redeem.useMutation();
  const { data: loginPasswordStatus, refetch: refetchLoginPassword } = trpc.emailAuth.hasLoginPassword.useQuery(
    undefined,
    { retry: false },
  );
  const setLoginPasswordMutation = trpc.emailAuth.setLoginPassword.useMutation();
  const hasLoginPassword = loginPasswordStatus?.hasPassword === true;

  const { data: subData, isLoading: subLoading } = trpc.stripe.getSubscription.useQuery(undefined, {
    retry: false,
  });
  const { data: transactions, isLoading: txLoading } = trpc.stripe.getTransactions.useQuery({ limit: 100 });
  const { data: usageLogs, isLoading: usageLoading } = trpc.stripe.getUsageLogs.useQuery({ limit: 100 });

  if (subLoading) {
    return (
      <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF] flex items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin" />
      </div>
    );
  }

  const credits = subData?.credits ?? { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 };
  const planConfig = subData?.planConfig;
  const verifyStatusLabel =
    user?.verifyStatus === "approved"
      ? "已通过"
      : user?.verifyStatus === "pending"
      ? "待确认"
      : user?.verifyStatus === "rejected"
      ? "已拒绝"
      : "未认证";

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="pb-16">
        {/* Header */}
        <div className="flex items-center p-4 border-b border-white/10">
          <button onClick={() => window.history.back()} className="p-2">
            <ArrowLeft className="h-6 w-6" />
          </button>
          <span className="text-lg font-semibold ml-4">Credits 总览</span>
        </div>

        {/* Balance Card */}
        <div className="bg-[#1C1C1E] rounded-lg p-6 m-4">
          <div className="flex justify-between items-center">
            <div className="flex flex-col">
              <span className="text-sm text-gray-400">可用 Credits</span>
              <span className="text-4xl font-bold">{typeof user?.credits === "number" ? user.credits : credits.balance}</span>
            </div>
            <button
              onClick={() => navigate("/pricing")}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg"
            >
              <Plus className="h-5 w-5" />
              <span>加值</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-white/10">
            <div className="flex flex-col">
              <span className="text-sm text-gray-400">累计获得</span>
              <span className="text-lg font-semibold">{credits.lifetimeEarned}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm text-gray-400">累计消耗</span>
              <span className="text-lg font-semibold">{credits.lifetimeSpent}</span>
            </div>
            <div className="flex flex-col col-span-2">
              <span className="text-sm text-gray-400">当前方案</span>
              <span className="text-lg font-semibold">
                {planConfig?.nameCn ?? "入门版"}
              </span>
            </div>
            <div className="flex flex-col col-span-2">
              <span className="text-sm text-gray-400">认证状态</span>
              <span className="text-lg font-semibold">{verifyStatusLabel}</span>
            </div>
          </div>
        </div>

        {/* Beta Code Redemption */}
        <div className="mx-4 mb-4 bg-gradient-to-r from-[#1A1A1D] to-[#1C1C2E] rounded-xl p-4 border border-[#FF6B35]/30">
          <div className="flex items-center gap-2 mb-3">
            <Gift className="h-5 w-5 text-[#FF6B35]" />
            <span className="text-sm font-semibold text-white">兑换内测码</span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="输入内测码（如 ABCD-EFGH-IJKL）"
              value={betaCode}
              onChange={(e) => setBetaCode(e.target.value.toUpperCase())}
              className="flex-1 bg-[#0A0A0C] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-[#FF6B35]/50 font-mono"
            />
            <button
              disabled={redeemLoading || !betaCode.trim()}
              onClick={async () => {
                setRedeemLoading(true);
                try {
                  const result = await redeemMutation.mutateAsync({ code: betaCode });
                  toast.success(result.message);
                  setBetaCode("");
                } catch (err: any) {
                  toast.error(err.message || "兑换失败，请检查内测码是否正确");
                } finally {
                  setRedeemLoading(false);
                }
              }}
              className="bg-[#FF6B35] text-white px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center gap-1 whitespace-nowrap"
            >
              {redeemLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "兑换"}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">
            内测码由 <span className="text-gray-400">Supervisor / Admin</span> 在「管理面板 → 生成内测邀请码」批量生成：可设每组码赠送的积分、最大兑换次数与有效期；用户在此输入码并兑换后，积分立即入账（来源：内测码）。
          </p>
        </div>

        {/* 登录密码（邮箱验证码注册用户可在此补设） */}
        <div className="mx-4 mb-4 bg-[#1A1A1D] rounded-xl p-4 border border-white/10">
          <div className="flex items-center gap-2 mb-2">
            <Lock className="h-5 w-5 text-violet-400" />
            <span className="text-sm font-semibold text-white">登錄密碼</span>
            {loginPasswordStatus === undefined ? (
              <span className="text-xs text-gray-500">檢查中…</span>
            ) : hasLoginPassword ? (
              <span className="text-xs text-emerald-400/90">已設置，可在此重置</span>
            ) : (
              <span className="text-xs text-amber-400/90">尚未設置，建議補設以便密碼登錄</span>
            )}
          </div>

          {/* 顯示綁定的郵箱 */}
          <div className="mb-3 px-3 py-2 rounded-lg bg-white/5 border border-white/8">
            <span className="text-xs text-gray-400">綁定郵箱：</span>
            <span className="text-xs text-white font-mono">
              {user?.email ?? <span className="text-amber-400/80">未綁定郵箱（無法設置密碼）</span>}
            </span>
          </div>

          <p className="text-xs text-gray-500 mb-3 leading-relaxed">
            用驗證碼登錄的帳號默認無密碼。設置後可同時使用驗證碼或密碼登錄。已登錄狀態下可直接設置/重置，無需填原密碼。
          </p>

          {user?.email ? (
            <div className="space-y-2">
              <input
                type="password"
                autoComplete="new-password"
                placeholder={hasLoginPassword ? "新密碼（至少 8 位）" : "設置密碼（至少 8 位）"}
                value={loginPasswordNew}
                onChange={(e) => setLoginPasswordNew(e.target.value)}
                className="w-full bg-[#0A0A0C] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-violet-500/40"
              />
              <button
                type="button"
                disabled={loginPasswordBusy || loginPasswordNew.length < 8}
                onClick={async () => {
                  setLoginPasswordBusy(true);
                  try {
                    await setLoginPasswordMutation.mutateAsync({
                      newPassword: loginPasswordNew,
                    });
                    toast.success(hasLoginPassword ? "密碼已更新" : "登錄密碼已設置");
                    setLoginPasswordNew("");
                    void refetchLoginPassword();
                  } catch (err: any) {
                    toast.error(err?.message || "設置失敗");
                  } finally {
                    setLoginPasswordBusy(false);
                  }
                }}
                className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-semibold"
              >
                {loginPasswordBusy ? "提交中…" : hasLoginPassword ? "重置密碼" : "設置登錄密碼"}
              </button>
            </div>
          ) : (
            <p className="text-xs text-amber-400/70">請先用郵箱驗證碼登錄，系統會自動綁定郵箱。</p>
          )}
        </div>

        <div className="m-4 rounded-xl p-4 border border-white/10 bg-[#1C1C1E]">
          <div className="flex items-center gap-2 mb-2">
            <Coins className="h-5 w-5 text-[#FF6B35]" />
            <span className="text-lg font-semibold">Credits 说明</span>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            对外定价以<strong className="text-gray-400">积分加值包</strong>为准；使用功能时按实际规则从余额扣减。当前余额{" "}
            <span className="text-[#FF6B35] font-bold">{credits.balance}</span> Credits；参考约 1 Credit ≈ ¥{CREDIT_TO_CNY.toFixed(2)}。充值见{" "}
            <Link href="/pricing" className="text-[#FF6B35] underline-offset-2 hover:underline">
              定价页
            </Link>
            。
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 px-4 mt-6 border-b border-white/10">
          <TabButton label="交易记录" active={activeTab === "transactions"} onClick={() => setActiveTab("transactions")} />
          <TabButton label="使用日志" active={activeTab === "usage"} onClick={() => setActiveTab("usage")} />
        </div>

        {/* Tab Content */}
        <div className="p-4 space-y-4">
          {activeTab === "transactions" && (
            <div>
              {txLoading ? (
                <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
              ) : transactions && transactions.length > 0 ? (
                transactions.map((tx: any) => (
                  <div key={tx.id} className="flex justify-between items-center p-3 bg-[#1C1C1E] rounded-lg mb-2">
                    <div className="flex-1">
                      <span className="font-medium">
                        {tx.source === "purchase" ? "Credits 购买" :
                         tx.source === "payment" ? "扫码充值" :
                         tx.source === "subscription" ? "订阅发放" :
                         tx.source === "bonus" ? "管理员赠送" :
                         tx.source === "beta" ? "内测码兑换" :
                         tx.source === "referral" ? "邀请奖励" :
                         tx.source === "refund" ? "分析失败退款" :
                         tx.source === "usage" ? tx.action : tx.source}
                      </span>
                      <span className="text-xs text-gray-400 block">
                        {tx.createdAt ? new Date(tx.createdAt).toLocaleString("zh-CN") : ""}
                      </span>
                    </div>
                    <span className={`font-bold text-lg ${tx.amount > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {tx.amount > 0 ? "+" : ""}{tx.amount}
                    </span>
                  </div>
                ))
              ) : (
                <span className="block text-center text-gray-500 py-8">暂无交易记录</span>
              )}
            </div>
          )}

          {activeTab === "usage" && (
            <div>
              {usageLoading ? (
                <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
              ) : usageLogs && usageLogs.length > 0 ? (
                usageLogs.map((log: any) => (
                  <div key={log.id} className="flex justify-between items-center p-3 bg-[#1C1C1E] rounded-lg mb-2">
                    <div className="flex-1">
                      <span className="font-medium">
                        {log.action === "growthCampGrowth" ? "成长营 GROWTH 分析" :
                         log.action === "growthCampRemix" ? "成长营 · 二次创作" :
                         log.action === "platformTrend" ? "平台趋势分析" :
                         log.action === "platformTrendFollowUp" ? "平台趋势追问" :
                         log.action === "workflowNodes" ? "节点工作流" :
                         log.action === "mvAnalysis" ? "视频 PK 评分" :
                         log.action === "idolGeneration" ? "虚拟偶像生成" :
                         log.action === "storyboard" ? "分镜脚本生成" :
                         log.action === "videoGeneration" ? "视频生成" : log.action}
                      </span>
                      <span className="text-xs text-gray-400 block">
                        {log.createdAt ? new Date(log.createdAt).toLocaleString("zh-CN") : ""}
                      </span>
                    </div>
                    <span className="font-bold text-lg text-red-400">
                      -{log.creditsCost}
                    </span>
                  </div>
                ))
              ) : (
                <span className="block text-center text-gray-500 py-8">暂无使用记录</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`py-2 px-4 text-sm font-medium ${active ? 'border-b-2 border-primary text-primary' : 'text-gray-400'}`}>
      <span>{label}</span>
    </button>
  );
}
