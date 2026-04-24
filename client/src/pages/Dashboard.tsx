import { useState } from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, ArrowLeft, Plus, BarChart, User, Film, Video, Gift, TrendingUp, Workflow } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";

type TabType = "transactions" | "usage";

export default function LayoutDashboard() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<TabType>("transactions");
  const [betaCode, setBetaCode] = useState("");
  const [redeemLoading, setRedeemLoading] = useState(false);
  const { user } = useAuth();
  const redeemMutation = trpc.betaCode.redeem.useMutation();

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

        {/* Quick Actions */}
        <div className="m-4">
          <span className="text-lg font-semibold mb-4 block">Credits 消耗参考</span>
          <div className="grid grid-cols-2 gap-4">
            <CostCard icon={<BarChart className="h-6 w-6" />} label="成长营 GROWTH" cost={40} balance={credits.balance} />
            <CostCard icon={<Film className="h-6 w-6" />} label="成长营 REMIX" cost={50} balance={credits.balance} />
            <CostCard icon={<TrendingUp className="h-6 w-6" />} label="平台趋势·主分析" cost={30} balance={credits.balance} />
            <CostCard icon={<TrendingUp className="h-6 w-6" />} label="平台趋势·每次追问" cost={20} balance={credits.balance} />
            <CostCard icon={<Video className="h-6 w-6" />} label="工作流·故事板起" cost={5} balance={credits.balance} />
            <CostCard icon={<Video className="h-6 w-6" />} label="工作流·场景视频" cost={80} balance={credits.balance} />
          </div>
          <p className="text-xs text-gray-500 mt-2">节点工作流：脚本免费；分镜/静帧/配音/配乐/合成等按步计费，管理后台「定价明细」可查看全部。</p>
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
                         log.action === "growthCampRemix" ? "成长营 REMIX 二创" :
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

function CostCard({ icon, label, cost, balance }: { icon: React.ReactNode; label: string; cost: number; balance: number }) {
  const canAfford = balance >= cost;
  const times = canAfford ? Math.floor(balance / cost) : 0;
  return (
    <div className={`flex flex-col items-center justify-center p-4 rounded-lg bg-[#1C1C1E] ${canAfford ? 'text-white' : 'text-gray-600'}`}>
      <div className={`mb-2 ${canAfford ? 'text-primary' : 'text-gray-600'}`}>{icon}</div>
      <span className="text-sm text-center font-medium">{label}</span>
      <span className="text-xs text-gray-400">{cost} Credits</span>
      <span className={`text-xs mt-1 ${canAfford ? 'text-green-400' : 'text-red-500'}`}>
        {canAfford ? `可用 ${times} 次` : '余额不足'}
      </span>
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
