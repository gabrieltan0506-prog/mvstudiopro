
import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, ArrowLeft, BarChart2, RefreshCw, TrendingUp, User, Users, CircleDollarSign, Undo2, AlertTriangle } from "lucide-react";

// Helper component for individual metric cards
function MetricCard({ title, value, subtitle, icon: Icon, color }: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <div className="flex-1 rounded-xl border border-white/10 bg-zinc-900 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-400">{title}</p>
        <Icon className="h-5 w-5" style={{ color }} />
      </div>
      <p className="mt-2 text-3xl font-bold" style={{ color }}>{value}</p>
      <p className="mt-1 text-xs text-gray-500">{subtitle}</p>
    </div>
  );
}

export default function AdminFinance() {
  const [, navigate] = useLocation();
  const { user, isAuthenticated, loading: authLoading } = useAuth();

  const { data: metrics, isLoading, refetch } = trpc.stripe.adminMetrics.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
    retry: false,
  });

  const { data: kpiData } = trpc.stripe.adminKpiMetrics.useQuery(undefined, {
    enabled: isAuthenticated && user?.role === "admin",
    retry: false,
  });

  const { data: auditLogs } = trpc.stripe.adminAuditLogs.useQuery(
    { limit: 20 },
    { enabled: isAuthenticated && user?.role === "admin", retry: false }
  );

  const [targetUserId, setTargetUserId] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const addCreditsMutation = trpc.stripe.adminAddCredits.useMutation();

  useEffect(() => {
    if (!authLoading && (!isAuthenticated || user?.role !== "admin")) {
      navigate("/");
    }
  }, [authLoading, isAuthenticated, user, navigate]);

  if (authLoading || !isAuthenticated || user?.role !== "admin") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0A0A0C]">
        {authLoading ? <Loader2 className="h-8 w-8 animate-spin text-gray-400" /> : <p className="text-gray-400">无权限访问</p>}
      </div>
    );
  }

  const handleAddCredits = async () => {
    if (!targetUserId || !creditAmount || !creditReason) {
      toast.error("请填写所有字段");
      return;
    }
    try {
      await addCreditsMutation.mutateAsync({
        targetUserId: parseInt(targetUserId),
        amount: parseInt(creditAmount),
        reason: creditReason,
      });
      toast.success(`已成功为用户 ${targetUserId} 添加 ${creditAmount} Credits`);
      setTargetUserId("");
      setCreditAmount("");
      setCreditReason("");
      refetch();
    } catch (err: any) {
      toast.error(err.message || "操作失败");
    }
  };

  const renderActionName = (action: string) => {
    const actionMap: { [key: string]: string } = {
      mvAnalysis: "视频 PK 评分",
      idolGeneration: "偶像生成",
      storyboard: "分镜脚本",
      videoGeneration: "视频生成",
    };
    return actionMap[action] || action;
  };

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="overflow-y-auto p-6 pb-20">
        {/* Header */}
        <header className="flex items-center">
          <button onClick={() => window.history.back()} className="mr-4 p-2">
            <ArrowLeft className="h-6 w-6" />
          </button>
          <h1 className="flex-1 text-xl font-bold">财务监控 LayoutDashboard</h1>
          <Link href="/admin-team-stats">
            <a className="mr-2 rounded-lg p-2 hover:bg-zinc-800">
              <BarChart2 className="h-5 w-5 text-purple-500" />
            </a>
          </Link>
          <button onClick={() => refetch()} className="rounded-lg p-2 hover:bg-zinc-800">
            <RefreshCw className="h-5 w-5 text-orange-500" />
          </button>
        </header>

        {isLoading ? (
          <div className="flex justify-center pt-20">
            <Loader2 className="h-10 w-10 animate-spin text-orange-500" />
          </div>
        ) : metrics ? (
          <main className="mt-6 space-y-8">
            {/* Key Metrics */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <MetricCard title="MRR" value={`$${metrics.estimatedMRR}`} subtitle="月经常性收入" icon={TrendingUp} color="#22C55E" />
                <MetricCard title="ARPU" value={`$${metrics.arpu.toFixed(2)}`} subtitle="每用户平均收入" icon={User} color="#3B82F6" />
                <MetricCard title="订阅用户" value={`${metrics.totalSubscribers}`} subtitle="活跃订阅" icon={Users} color="#FF6B35" />
                <MetricCard title="Credits 流通" value={`${metrics.totalCreditsBalance}`} subtitle="总余额" icon={CircleDollarSign} color="#A855F7" />
            </div>

            {/* Plan Distribution */}
            <section>
              <h2 className="text-lg font-bold">方案分布</h2>
              <div className="mt-4 rounded-lg border border-white/10 bg-zinc-900 p-4">
                {Object.entries(metrics.planCounts).map(([plan, count]) => (
                  <div key={plan} className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      <span className={`h-3 w-3 rounded-full ${plan === 'free' ? 'bg-gray-400' : plan === 'pro' ? 'bg-orange-500' : 'bg-purple-500'}`} />
                      <span className="text-sm">{plan === 'free' ? '免费版' : plan === 'pro' ? '专业版' : '企业版'}</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-400">{count as number} 人</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Monthly Usage & Breakdown */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <section>
                <h2 className="text-lg font-bold">本月使用统计</h2>
                <div className="mt-4 space-y-4 rounded-lg border border-white/10 bg-zinc-900 p-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">总操作次数</span>
                    <span className="font-bold">{metrics.monthlyUsage.totalActions}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Credits 消耗</span>
                    <span className="font-bold">{metrics.monthlyUsage.totalCredits}</span>
                  </div>
                </div>
              </section>
              <section>
                <h2 className="text-lg font-bold">本月收入</h2>
                 <div className="mt-4 space-y-4 rounded-lg border border-white/10 bg-zinc-900 p-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Credits 购买交易</span>
                    <span className="font-bold text-green-500">{metrics.monthlyRevenue.transactionCount} 笔</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Credits 发放量</span>
                    <span className="font-bold text-green-500">{metrics.monthlyRevenue.totalCreditsAdded}</span>
                  </div>
                </div>
              </section>
            </div>

            {/* Action Breakdown */}
            {metrics.actionBreakdown.length > 0 && (
              <section>
                <h2 className="text-lg font-bold">功能使用明细</h2>
                <div className="mt-4 rounded-lg border border-white/10 bg-zinc-900 p-4">
                  {metrics.actionBreakdown.map((item: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-gray-300">{renderActionName(item.action)}</span>
                      <div className="flex gap-6">
                        <span className="text-gray-400">{item.count} 次</span>
                        <span className="font-semibold text-orange-500">{item.totalCredits} Credits</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* KPI Metrics */}
            {kpiData && (
              <section>
                <h2 className="text-lg font-bold">KPI 指针 ({kpiData.period})</h2>
                <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
                    <div className="flex flex-col items-center rounded-lg border border-white/10 bg-zinc-900 p-3">
                        <span className="text-xs font-semibold text-gray-400">Trial→Paid</span>
                        <span className="mt-1 text-2xl font-bold text-green-500">{kpiData.trialConversion.conversionRate}%</span>
                        <span className="text-xs text-gray-500">{kpiData.trialConversion.trialToPaid}/{kpiData.trialConversion.trialStarts}</span>
                    </div>
                    <div className="flex flex-col items-center rounded-lg border border-white/10 bg-zinc-900 p-3">
                        <span className="text-xs font-semibold text-gray-400">Churn Rate</span>
                        <span className={`mt-1 text-2xl font-bold ${kpiData.churn.churnRate > 10 ? 'text-red-500' : 'text-yellow-500'}`}>{kpiData.churn.churnRate}%</span>
                        <span className="text-xs text-gray-500">{kpiData.churn.churnedUsers}/{kpiData.churn.totalPaidUsers}</span>
                    </div>
                    <div className="flex flex-col items-center rounded-lg border border-white/10 bg-zinc-900 p-3">
                        <span className="text-xs font-semibold text-gray-400">LTV</span>
                        <span className="mt-1 text-2xl font-bold text-blue-500">${kpiData.revenue.estimatedLTV}</span>
                        <span className="text-xs text-gray-500">ARPU ${kpiData.revenue.arpu}</span>
                    </div>
                    <div className="flex flex-col items-center rounded-lg border border-white/10 bg-zinc-900 p-3">
                        <span className="text-xs font-semibold text-gray-400">退款</span>
                        <span className="mt-1 text-2xl font-bold text-red-500">{kpiData.refunds.count}</span>
                        <span className="text-xs text-gray-500">${kpiData.refunds.totalAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex flex-col items-center rounded-lg border border-white/10 bg-zinc-900 p-3">
                        <span className="text-xs font-semibold text-gray-400">付款失败</span>
                        <span className={`mt-1 text-2xl font-bold ${kpiData.paymentFailures > 0 ? 'text-red-500' : 'text-green-500'}`}>{kpiData.paymentFailures}</span>
                        <span className="text-xs text-gray-500">本月</span>
                    </div>
                    <div className="flex flex-col items-center rounded-lg border border-white/10 bg-zinc-900 p-3">
                        <span className="text-xs font-semibold text-gray-400">MRR</span>
                        <span className="mt-1 text-2xl font-bold text-green-500">${kpiData.revenue.mrr}</span>
                        <span className="text-xs text-gray-500">月经常性收入</span>
                    </div>
                </div>
              </section>
            )}

            {/* Recent Transactions & Audit Logs */}
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              <section>
                <h2 className="text-lg font-bold">最近交易</h2>
                <div className="mt-4 space-y-2">
                  {metrics.recentTransactions.length > 0 ? (
                    metrics.recentTransactions.map((tx: any) => (
                      <div key={tx.id} className="flex items-center border-b border-zinc-800 py-3">
                        <div className="flex-1">
                          <p className="text-sm font-medium">用户 #{tx.userId}</p>
                          <p className="text-xs text-gray-500">
                            {tx.source} · {tx.action ?? "-"} · {tx.createdAt ? new Date(tx.createdAt).toLocaleString("zh-CN") : ""}
                          </p>
                        </div>
                        <p className={`text-base font-bold ${tx.amount > 0 ? "text-green-500" : "text-red-500"}`}>
                          {tx.amount > 0 ? "+" : ""}{tx.amount}
                        </p>
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-sm text-gray-500">暂无交易记录</p>
                  )}
                </div>
              </section>

              {auditLogs && auditLogs.length > 0 && (
                <section>
                  <h2 className="text-lg font-bold">审计日志 (最近20条)</h2>
                  <div className="mt-4 space-y-2">
                    {auditLogs.map((log: any) => (
                      <div key={log.id} className="flex items-center border-b border-zinc-800 py-2.5">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${log.status === 'success' ? 'bg-green-500' : log.status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'}`} />
                            <p className="text-sm font-semibold">{log.action}</p>
                          </div>
                          <p className="ml-4 text-xs text-gray-500">
                            {log.eventType} · {log.userId ? `用户#${log.userId}` : ""} · {log.createdAt ? new Date(log.createdAt).toLocaleString("zh-CN") : ""}
                          </p>
                        </div>
                        {log.amount !== null && log.amount !== 0 && (
                          <p className={`text-sm font-bold ${log.amount > 0 ? "text-green-500" : "text-red-500"}`}>
                            {log.amount > 0 ? "+" : ""}{(log.amount / 100).toFixed(2)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* Admin: Plus Credits */}
            <section>
              <h2 className="text-lg font-bold">手动添加 Credits</h2>
              <div className="mt-4 flex flex-col gap-3 rounded-lg border border-white/10 bg-zinc-900 p-4">
                <input
                  type="number"
                  placeholder="用户 ID"
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm placeholder-gray-500 focus:border-orange-500 focus:outline-none"
                />
                <input
                  type="number"
                  placeholder="Credits 数量"
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm placeholder-gray-500 focus:border-orange-500 focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="原因"
                  value={creditReason}
                  onChange={(e) => setCreditReason(e.target.value)}
                  className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm placeholder-gray-500 focus:border-orange-500 focus:outline-none"
                />
                <button
                  onClick={handleAddCredits}
                  disabled={addCreditsMutation.isPending}
                  className="mt-2 flex h-10 items-center justify-center rounded-lg bg-orange-600 px-4 text-sm font-bold text-white transition-colors hover:bg-orange-500 disabled:cursor-not-allowed disabled:bg-orange-700"
                >
                  {addCreditsMutation.isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    "添加 Credits"
                  )}
                </button>
              </div>
            </section>
          </main>
        ) : (
          <div className="flex justify-center pt-20">
            <p className="text-gray-500">无法加载数据</p>
          </div>
        )}
      </div>
    </div>
  );
}
