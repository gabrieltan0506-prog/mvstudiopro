
import { useState, useEffect, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ArrowLeft, RefreshCw, Users, PieChart, Wallet, TrendingUp, Loader2 } from "lucide-react";

// ─── 功能名称映射 ────────────────────────────
const ACTION_LABELS: Record<string, string> = {
  mvAnalysis: "视频 PK 评分",
  idolGeneration: "偶像生成",
  storyboard: "分镜脚本",
  videoGeneration: "视频生成",
  idol3D: "偶像转 3D",
};

// ─── 图表颜色 ────────────────────────────────
const CHART_COLORS = [
  "#FF6B35", "#3B82F6", "#22C55E", "#A855F7", "#F59E0B",
  "#EF4444", "#06B6D4", "#EC4899", "#84CC16", "#F97316",
];

const ROLE_LABELS: Record<string, string> = {
  owner: "拥有者",
  admin: "管理员",
  member: "成员",
};

const TIME_RANGES = [
  { label: "7天", value: 7 },
  { label: "30天", value: 30 },
  { label: "90天", value: 90 },
];

export default function AdminTeamStats() {
  const [location, navigate] = useLocation();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [selectedDays, setSelectedDays] = useState(30);
  const [selectedTeamId, setSelectedTeamId] = useState<number | undefined>(undefined);

  const { data, isLoading, refetch, error } = trpc.stripe.adminTeamCreditsStats.useQuery(
    { teamId: selectedTeamId, days: selectedDays },
    {
      enabled: isAuthenticated && user?.role === "admin",
      retry: false,
    }
  );

  useEffect(() => {
    if (!authLoading && (!isAuthenticated || user?.role !== "admin")) {
      toast.error("无权限访问");
      navigate("/");
    }
  }, [authLoading, isAuthenticated, user, navigate]);

  useEffect(() => {
    if (data?.selectedTeamId && !selectedTeamId) {
      setSelectedTeamId(data.selectedTeamId);
    }
  }, [data?.selectedTeamId, selectedTeamId]);

  if (authLoading || !isAuthenticated || user?.role !== "admin") {
    return (
      <div className="min-h-screen bg-[#0A0A0C] flex justify-center items-center">
        <Loader2 className="h-12 w-12 animate-spin text-[#FF6B35]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0C] text-[#F7F4EF]">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <header className="flex items-center justify-between pb-4 mb-6 border-b border-white/10">
          <button onClick={() => window.history.back()} className="p-2 rounded-full hover:bg-white/10">
            <ArrowLeft className="h-6 w-6" />
          </button>
          <h1 className="text-xl font-bold">团队 Credits 统计</h1>
          <button onClick={() => refetch()} className="p-2 rounded-full hover:bg-white/10">
            <RefreshCw className={`h-5 w-5 text-[#FF6B35] ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </header>

        {isLoading && !data ? (
          <div className="flex justify-center items-center pt-20">
            <Loader2 className="h-12 w-12 animate-spin text-[#FF6B35]" />
          </div>
        ) : error ? (
           <div className="text-center pt-20">
            <p className="text-red-500">无法加载数据: {error.message}</p>
          </div>
        ) : data ? (
          <div className="space-y-8">
            {/* 团队选择器 */}
            {data.teams.length > 1 && (
              <section>
                <h2 className="text-lg font-bold text-[#ECEDEE] mb-3">选择团队</h2>
                <div className="flex flex-wrap gap-2">
                  {data.teams.map((t: any) => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTeamId(t.id)}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${selectedTeamId === t.id
                          ? "bg-[#FF6B35] text-white"
                          : "bg-[#1A1A1D] border border-white/10 text-gray-400 hover:bg-white/5"
                        }`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* 时间范围筛选器 */}
            <section>
              <h2 className="text-lg font-bold text-[#ECEDEE] mb-3">时间范围</h2>
              <div className="flex flex-wrap gap-2">
                {TIME_RANGES.map((range) => (
                  <button
                    key={range.value}
                    onClick={() => setSelectedDays(range.value)}
                    className={`px-5 py-2 rounded-full text-sm font-medium transition-colors ${selectedDays === range.value
                        ? "bg-[#3B82F6] text-white"
                        : "bg-[#1A1A1D] border border-white/10 text-gray-400 hover:bg-white/5"
                      }`}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
            </section>

            {/* 汇总指针 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                title="团队成员"
                value={`${data.summary.totalMembers}`}
                subtitle="活跃成员"
                icon={<Users className="h-5 w-5" />}
                color="#3B82F6"
              />
              <MetricCard
                title="使用率"
                value={`${data.summary.utilizationRate}%`}
                subtitle="Credits 利用率"
                icon={<PieChart className="h-5 w-5" />}
                color={data.summary.utilizationRate > 70 ? "#22C55E" : data.summary.utilizationRate > 30 ? "#F59E0B" : "#EF4444"}
              />
              <MetricCard
                title="已分配"
                value={`${data.summary.totalAllocated}`}
                subtitle="Credits 总额度"
                icon={<Wallet className="h-5 w-5" />}
                color="#FF6B35"
              />
              <MetricCard
                title="已使用"
                value={`${data.summary.totalUsed}`}
                subtitle="Credits 消耗"
                icon={<TrendingUp className="h-5 w-5" />}
                color="#A855F7"
              />
            </div>

            {/* 成员用量排行 */}
            <Card>
              <CardTitle>成员用量排行</CardTitle>
              {data.memberRanking.length > 0 ? (
                <div className="space-y-4 mt-4">
                  {data.memberRanking.map((member: any, idx: number) => {
                    const maxUsed = Math.max(...data.memberRanking.map((m: any) => m.used), 1);
                    const barPercentage = Math.max((member.used / maxUsed) * 100, 1);
                    const utilizationColor = member.utilizationRate > 80 ? "text-red-500" :
                                           member.utilizationRate > 50 ? "text-yellow-500" : "text-green-500";
                    return (
                      <div key={member.memberId} className="space-y-2">
                        <div className="flex justify-between items-center text-sm">
                           <div className="flex items-center gap-3 w-1/3">
                             <span className="font-mono text-gray-500">#{idx + 1}</span>
                             <div className="truncate">
                               <p className="font-medium truncate text-white">{member.userName ?? member.userEmail ?? `用户 #${member.userId}`}</p>
                               <p className="text-xs text-gray-400">{ROLE_LABELS[member.role] ?? member.role}</p>
                             </div>
                           </div>
                           <div className="flex items-center gap-2 text-xs">
                              <span className="font-medium text-white">{member.used}</span>
                              <span className="text-gray-500">/ {member.allocated}</span>
                              <span className={`font-bold w-12 text-right ${utilizationColor}`}>{member.utilizationRate}%</span>
                           </div>
                        </div>
                        <div className="w-full bg-white/5 rounded-full h-2.5">
                          <div
                            className="h-2.5 rounded-full"
                            style={{ width: `${barPercentage}%`, backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState>暂无成员数据</EmptyState>
              )}
            </Card>

            {/* 功能使用分布 & 消耗趋势 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* 功能使用分布 */}
              <Card>
                <CardTitle>功能使用分布</CardTitle>
                {data.featureDistribution.length > 0 ? (
                  <div className="mt-4 space-y-4">
                    {/* Donut Chart Simulation */}
                    <div className="space-y-3">
                      {(() => {
                        const total = data.featureDistribution.reduce((s: number, f: any) => s + f.totalCredits, 0);
                        return data.featureDistribution.map((feature: any, idx: number) => {
                          const percent = total > 0 ? Math.round((feature.totalCredits / total) * 100) : 0;
                          return (
                            <div key={feature.action} className="flex items-center gap-3 text-sm">
                              <div className="flex items-center gap-2 w-28 truncate">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }} />
                                <span className="text-gray-300 truncate" title={ACTION_LABELS[feature.action] ?? feature.action}>{ACTION_LABELS[feature.action] ?? feature.action}</span>
                              </div>
                              <div className="flex-1 bg-white/5 h-2 rounded-full">
                                <div className="h-2 rounded-full" style={{ width: `${percent}%`, backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }} />
                              </div>
                              <div className="text-right w-24">
                                <span className="font-semibold text-white">{percent}%</span>
                                <span className="ml-2 text-xs text-gray-400">{feature.totalCredits} Cr</span>
                              </div>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                ) : (
                  <EmptyState>暂无使用记录</EmptyState>
                )}
              </Card>

              {/* Credits 消耗趋势 */}
              <Card>
                <CardTitle>Credits 消耗趋势</CardTitle>
                {data.dailyTrend.length > 0 ? (
                  <div className="mt-4">
                    {/* Trend Chart Simulation */}
                    <div className="flex gap-2 items-end h-40">
                      {(() => {
                        const maxCredits = Math.max(...data.dailyTrend.map((d: any) => d.credits), 1);
                        const displayData = data.dailyTrend.slice(-14);
                        return displayData.map((day: any) => {
                          const height = Math.max((day.credits / maxCredits) * 100, 2);
                          const barColor = day.credits > maxCredits * 0.7 ? "#EF4444" :
                                         day.credits > maxCredits * 0.4 ? "#F59E0B" : "#22C55E";
                          return (
                            <div key={day.date} className="flex-1 flex flex-col items-center justify-end gap-1 group">
                               <div className="w-full h-full flex items-end">
                                <div className="w-full rounded-t-sm transition-all duration-300 group-hover:opacity-80" style={{ height: `${height}%`, backgroundColor: barColor }} />
                               </div>
                               <span className="text-xs text-gray-500">{day.date.slice(5)}</span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                     {/* Trend Summary */}
                    <div className="mt-4 pt-4 border-t border-white/10 flex justify-between text-center">
                        <div className="text-sm">
                            <p className="text-gray-400">总消耗</p>
                            <p className="font-bold text-lg text-white">{data.dailyTrend.reduce((s: number, d: any) => s + d.credits, 0)}</p>
                        </div>
                        <div className="text-sm">
                            <p className="text-gray-400">总操作</p>
                            <p className="font-bold text-lg text-white">{data.dailyTrend.reduce((s: number, d: any) => s + d.actions, 0)}</p>
                        </div>
                        <div className="text-sm">
                            <p className="text-gray-400">日均消耗</p>
                            <p className="font-bold text-lg text-white">{Math.round(data.dailyTrend.reduce((s: number, d: any) => s + d.credits, 0) / Math.max(data.dailyTrend.length, 1))}</p>
                        </div>
                    </div>
                  </div>
                ) : (
                  <EmptyState>暂无趋势数据</EmptyState>
                )}
              </Card>
            </div>

            {/* 成员功能使用明细 */}
            {data.memberFeatureBreakdown && data.memberFeatureBreakdown.length > 0 && (
              <Card>
                <CardTitle>成员功能使用明细</CardTitle>
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {(() => {
                    const grouped: Record<number, { name: string; features: { action: string; count: number; credits: number }[] }> = {};
                    data.memberFeatureBreakdown.forEach((item: any) => {
                      if (!grouped[item.userId]) {
                        const member = data.memberRanking.find((m: any) => m.userId === item.userId);
                        grouped[item.userId] = {
                          name: member?.userName ?? member?.userEmail ?? `用户 #${item.userId}`,
                          features: [],
                        };
                      }
                      grouped[item.userId].features.push({
                        action: item.action,
                        count: item.count,
                        credits: item.credits,
                      });
                    });

                    return Object.entries(grouped).map(([userId, userData]) => (
                      <div key={userId} className="bg-[#101012] p-4 rounded-lg border border-white/10">
                        <h4 className="font-bold text-white truncate mb-3">{userData.name}</h4>
                        <div className="space-y-2 text-sm">
                          {userData.features.map((f, idx) => (
                            <div key={f.action} className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }} />
                                <span className="text-gray-300">{ACTION_LABELS[f.action] ?? f.action}</span>
                              </div>
                              <span className="font-mono text-gray-400">
                                {f.count} 次 · {f.credits} Cr
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </Card>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── UI Components ────────────────────────────

const MetricCard = ({ title, value, subtitle, icon, color }: {
  title: string; value: string; subtitle: string; icon: React.ReactNode; color: string;
}) => (
  <div className="bg-[#1A1A1D] border border-white/10 rounded-xl p-4">
    <div className="flex justify-between items-start">
      <p className="text-sm font-semibold text-gray-400">{title}</p>
      <div style={{ color }}>{icon}</div>
    </div>
    <p className="text-3xl font-bold mt-2" style={{ color }}>{value}</p>
    <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
  </div>
);

const Card = ({ children }: { children: React.ReactNode }) => (
  <section className="bg-[#1A1A1D] border border-white/10 rounded-xl p-4 sm:p-6">
    {children}
  </section>
);

const CardTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-lg font-bold text-[#ECEDEE]">{children}</h2>
);

const EmptyState = ({ children }: { children: React.ReactNode }) => (
  <div className="text-center py-10">
    <p className="text-gray-500">{children}</p>
  </div>
);
