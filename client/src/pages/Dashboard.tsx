import { useState } from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Loader2, ArrowLeft, Plus, BarChart, User, Film, Video } from "lucide-react";

type TabType = "transactions" | "usage";

export default function LayoutDashboard() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<TabType>("transactions");

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
              <span className="text-4xl font-bold">{credits.balance}</span>
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
                {planConfig?.nameCn ?? "入門版"}
              </span>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="m-4">
          <span className="text-lg font-semibold mb-4 block">Credits 消耗参考</span>
          <div className="grid grid-cols-2 gap-4">
            <CostCard icon={<BarChart className="h-6 w-6" />} label="视频 PK 评分" cost={8} balance={credits.balance} />
            <CostCard icon={<User className="h-6 w-6" />} label="偶像生成" cost={3} balance={credits.balance} />
            <CostCard icon={<Film className="h-6 w-6" />} label="分镜脚本" cost={15} balance={credits.balance} />
            <CostCard icon={<Video className="h-6 w-6" />} label="视频生成" cost={25} balance={credits.balance} />
          </div>
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
                         tx.source === "subscription" ? "订阅发放" :
                         tx.source === "bonus" ? "管理员赠送" :
                         tx.source === "beta" ? "内测奖励" :
                         tx.source === "referral" ? "邀请奖励" :
                         tx.source === "usage" ? tx.action : tx.source}
                      </span>
                      <span className="text-xs text-gray-400 block">
                        {tx.createdAt ? new Date(tx.createdAt).toLocaleString("zh-TW") : ""}
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
                        {log.action === "mvAnalysis" ? "视频 PK 评分" :
                         log.action === "idolGeneration" ? "虚拟偶像生成" :
                         log.action === "storyboard" ? "分镜脚本生成" :
                         log.action === "videoGeneration" ? "视频生成" : log.action}
                      </span>
                      <span className="text-xs text-gray-400 block">
                        {log.createdAt ? new Date(log.createdAt).toLocaleString("zh-TW") : ""}
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
