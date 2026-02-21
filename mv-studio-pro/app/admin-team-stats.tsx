import {
  ScrollView,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
  Platform,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useRouter } from "expo-router";
import { useState, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

const SCREEN_WIDTH = Dimensions.get("window").width;
const CHART_PADDING = 48;
const CHART_WIDTH = Math.min(SCREEN_WIDTH - CHART_PADDING, 600);

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

export default function AdminTeamStatsScreen() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [selectedDays, setSelectedDays] = useState(30);
  const [selectedTeamId, setSelectedTeamId] = useState<number | undefined>(undefined);

  const { data, isLoading, refetch } = trpc.stripe.adminTeamCreditsStats.useQuery(
    { teamId: selectedTeamId, days: selectedDays },
    {
      enabled: isAuthenticated && user?.role === "admin",
      retry: false,
    }
  );

  useEffect(() => {
    if (!authLoading && (!isAuthenticated || user?.role !== "admin")) {
      router.replace("/" as any);
    }
  }, [authLoading, isAuthenticated, user]);

  // 当数据加载后，设置默认选中的团队
  useEffect(() => {
    if (data?.selectedTeamId && !selectedTeamId) {
      setSelectedTeamId(data.selectedTeamId);
    }
  }, [data?.selectedTeamId]);

  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <ScreenContainer className="bg-background">
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: "#9BA1A6" }}>无权限访问</Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color="#ECEDEE" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>团队 Credits 统计</Text>
          <TouchableOpacity onPress={() => refetch()} style={styles.refreshBtn}>
            <MaterialIcons name="refresh" size={22} color="#FF6B35" />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={{ paddingTop: 60 }}>
            <ActivityIndicator color="#FF6B35" size="large" />
          </View>
        ) : data ? (
          <>
            {/* 团队选择器 */}
            {data.teams.length > 1 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>选择团队</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    {data.teams.map((t: any) => (
                      <TouchableOpacity
                        key={t.id}
                        onPress={() => setSelectedTeamId(t.id)}
                        style={[
                          styles.teamChip,
                          selectedTeamId === t.id && styles.teamChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.teamChipText,
                            selectedTeamId === t.id && styles.teamChipTextActive,
                          ]}
                        >
                          {t.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {/* 时间范围筛选器 */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>时间范围</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {TIME_RANGES.map((range) => (
                  <TouchableOpacity
                    key={range.value}
                    onPress={() => setSelectedDays(range.value)}
                    style={[
                      styles.timeChip,
                      selectedDays === range.value && styles.timeChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.timeChipText,
                        selectedDays === range.value && styles.timeChipTextActive,
                      ]}
                    >
                      {range.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* 汇总指针 */}
            <View style={styles.metricsRow}>
              <MetricCard
                title="团队成员"
                value={`${data.summary.totalMembers}`}
                subtitle="活跃成员"
                icon="people"
                color="#3B82F6"
              />
              <MetricCard
                title="使用率"
                value={`${data.summary.utilizationRate}%`}
                subtitle="Credits 利用率"
                icon="pie-chart"
                color={data.summary.utilizationRate > 70 ? "#22C55E" : data.summary.utilizationRate > 30 ? "#F59E0B" : "#EF4444"}
              />
            </View>
            <View style={styles.metricsRow}>
              <MetricCard
                title="已分配"
                value={`${data.summary.totalAllocated}`}
                subtitle="Credits 总额度"
                icon="account-balance-wallet"
                color="#FF6B35"
              />
              <MetricCard
                title="已使用"
                value={`${data.summary.totalUsed}`}
                subtitle="Credits 消耗"
                icon="trending-up"
                color="#A855F7"
              />
            </View>

            {/* 成员用量排行柱状图 */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>成员用量排行</Text>
              <View style={styles.chartCard}>
                {data.memberRanking.length > 0 ? (
                  data.memberRanking.map((member: any, idx: number) => {
                    const maxUsed = Math.max(...data.memberRanking.map((m: any) => m.used), 1);
                    const barWidth = Math.max((member.used / maxUsed) * (CHART_WIDTH - 120), 4);
                    return (
                      <View key={member.memberId} style={styles.barRow}>
                        <View style={styles.barLabel}>
                          <Text style={styles.barRank}>#{idx + 1}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.barName} numberOfLines={1}>
                              {member.userName ?? member.userEmail ?? `用户 #${member.userId}`}
                            </Text>
                            <Text style={styles.barRole}>
                              {ROLE_LABELS[member.role] ?? member.role}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.barContainer}>
                          <View style={styles.barTrack}>
                            <View
                              style={[
                                styles.barFill,
                                {
                                  width: barWidth,
                                  backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
                                },
                              ]}
                            />
                          </View>
                          <View style={styles.barStats}>
                            <Text style={styles.barValue}>{member.used}</Text>
                            <Text style={styles.barTotal}>/ {member.allocated}</Text>
                            <Text style={[styles.barPercent, {
                              color: member.utilizationRate > 80 ? "#EF4444" :
                                     member.utilizationRate > 50 ? "#F59E0B" : "#22C55E"
                            }]}>
                              {member.utilizationRate}%
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  })
                ) : (
                  <Text style={styles.emptyText}>暂无成员数据</Text>
                )}
              </View>
            </View>

            {/* 功能使用分布环形图（仿真） */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>功能使用分布</Text>
              <View style={styles.chartCard}>
                {data.featureDistribution.length > 0 ? (
                  <>
                    {/* 环形图仿真 - 使用进度条展示各功能占比 */}
                    <View style={styles.donutContainer}>
                      {(() => {
                        const total = data.featureDistribution.reduce(
                          (s: number, f: any) => s + f.totalCredits, 0
                        );
                        return data.featureDistribution.map((feature: any, idx: number) => {
                          const percent = total > 0 ? Math.round((feature.totalCredits / total) * 100) : 0;
                          return (
                            <View key={feature.action} style={styles.donutRow}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, width: 100 }}>
                                <View style={[styles.donutDot, { backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }]} />
                                <Text style={styles.donutLabel}>
                                  {ACTION_LABELS[feature.action] ?? feature.action}
                                </Text>
                              </View>
                              <View style={styles.donutBarTrack}>
                                <View
                                  style={[
                                    styles.donutBarFill,
                                    {
                                      width: `${percent}%` as any,
                                      backgroundColor: CHART_COLORS[idx % CHART_COLORS.length],
                                    },
                                  ]}
                                />
                              </View>
                              <View style={{ alignItems: "flex-end", minWidth: 70 }}>
                                <Text style={styles.donutPercent}>{percent}%</Text>
                                <Text style={styles.donutCredits}>{feature.totalCredits} Cr</Text>
                              </View>
                            </View>
                          );
                        });
                      })()}
                    </View>
                    {/* 功能使用次数表格 */}
                    <View style={styles.featureTable}>
                      <View style={styles.featureTableHeader}>
                        <Text style={[styles.featureTableCell, { flex: 2 }]}>功能</Text>
                        <Text style={[styles.featureTableCell, { flex: 1, textAlign: "center" }]}>次数</Text>
                        <Text style={[styles.featureTableCell, { flex: 1, textAlign: "right" }]}>Credits</Text>
                      </View>
                      {data.featureDistribution.map((f: any, idx: number) => (
                        <View key={f.action} style={styles.featureTableRow}>
                          <View style={{ flex: 2, flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <View style={[styles.featureTableDot, { backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }]} />
                            <Text style={styles.featureTableLabel}>
                              {ACTION_LABELS[f.action] ?? f.action}
                            </Text>
                          </View>
                          <Text style={[styles.featureTableValue, { flex: 1, textAlign: "center" }]}>
                            {f.count}
                          </Text>
                          <Text style={[styles.featureTableCredits, { flex: 1, textAlign: "right" }]}>
                            {f.totalCredits}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </>
                ) : (
                  <Text style={styles.emptyText}>暂无使用记录</Text>
                )}
              </View>
            </View>

            {/* Credits 消耗时间趋势折线图（仿真） */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Credits 消耗趋势</Text>
              <View style={styles.chartCard}>
                {data.dailyTrend.length > 0 ? (
                  <View>
                    {/* 趋势图 - 使用柱状图仿真 */}
                    <View style={styles.trendChart}>
                      {(() => {
                        const maxCredits = Math.max(...data.dailyTrend.map((d: any) => d.credits), 1);
                        const barMaxHeight = 120;
                        // 只显示最近的数据点（最多 14 个）
                        const displayData = data.dailyTrend.slice(-14);
                        const barW = Math.max(Math.floor((CHART_WIDTH - 80) / displayData.length) - 4, 8);
                        return (
                          <>
                            {/* Y 轴标签 */}
                            <View style={styles.trendYAxis}>
                              <Text style={styles.trendYLabel}>{maxCredits}</Text>
                              <Text style={styles.trendYLabel}>{Math.round(maxCredits / 2)}</Text>
                              <Text style={styles.trendYLabel}>0</Text>
                            </View>
                            {/* 柱状图 */}
                            <View style={styles.trendBars}>
                              {displayData.map((day: any, idx: number) => {
                                const height = Math.max((day.credits / maxCredits) * barMaxHeight, 2);
                                return (
                                  <View key={day.date} style={styles.trendBarCol}>
                                    <View style={{ height: barMaxHeight, justifyContent: "flex-end" }}>
                                      <View
                                        style={[
                                          styles.trendBar,
                                          {
                                            height,
                                            width: barW,
                                            backgroundColor: day.credits > maxCredits * 0.7 ? "#EF4444" :
                                              day.credits > maxCredits * 0.4 ? "#F59E0B" : "#22C55E",
                                          },
                                        ]}
                                      />
                                    </View>
                                    <Text style={styles.trendXLabel}>
                                      {day.date.slice(5)} {/* MM-DD */}
                                    </Text>
                                  </View>
                                );
                              })}
                            </View>
                          </>
                        );
                      })()}
                    </View>
                    {/* 趋势汇总 */}
                    <View style={styles.trendSummary}>
                      <View style={styles.trendSummaryItem}>
                        <Text style={styles.trendSummaryLabel}>总消耗</Text>
                        <Text style={styles.trendSummaryValue}>
                          {data.dailyTrend.reduce((s: number, d: any) => s + d.credits, 0)} Credits
                        </Text>
                      </View>
                      <View style={styles.trendSummaryItem}>
                        <Text style={styles.trendSummaryLabel}>总操作</Text>
                        <Text style={styles.trendSummaryValue}>
                          {data.dailyTrend.reduce((s: number, d: any) => s + d.actions, 0)} 次
                        </Text>
                      </View>
                      <View style={styles.trendSummaryItem}>
                        <Text style={styles.trendSummaryLabel}>日均</Text>
                        <Text style={styles.trendSummaryValue}>
                          {Math.round(
                            data.dailyTrend.reduce((s: number, d: any) => s + d.credits, 0) /
                              Math.max(data.dailyTrend.length, 1)
                          )} Cr/天
                        </Text>
                      </View>
                    </View>
                  </View>
                ) : (
                  <Text style={styles.emptyText}>暂无趋势数据</Text>
                )}
              </View>
            </View>

            {/* 成员功能使用明细 */}
            {data.memberFeatureBreakdown && data.memberFeatureBreakdown.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>成员功能使用明细</Text>
                <View style={styles.chartCard}>
                  {(() => {
                    // 按成员分组
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

                    return Object.entries(grouped).map(([userId, data]) => (
                      <View key={userId} style={styles.memberBreakdown}>
                        <Text style={styles.memberBreakdownName}>{data.name}</Text>
                        {data.features.map((f, idx) => (
                          <View key={f.action} style={styles.memberBreakdownRow}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <View style={[styles.featureTableDot, { backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }]} />
                              <Text style={styles.memberBreakdownAction}>
                                {ACTION_LABELS[f.action] ?? f.action}
                              </Text>
                            </View>
                            <Text style={styles.memberBreakdownStats}>
                              {f.count} 次 · {f.credits} Cr
                            </Text>
                          </View>
                        ))}
                      </View>
                    ));
                  })()}
                </View>
              </View>
            )}
          </>
        ) : (
          <View style={{ paddingTop: 60 }}>
            <Text style={styles.emptyText}>无法加载数据</Text>
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

// ─── MetricCard 组件 ────────────────────────────
function MetricCard({ title, value, subtitle, icon, color }: {
  title: string; value: string; subtitle: string; icon: string; color: string;
}) {
  return (
    <View style={styles.metricCard}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={styles.metricTitle}>{title}</Text>
        <MaterialIcons name={icon as any} size={20} color={color} />
      </View>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={styles.metricSubtitle}>{subtitle}</Text>
    </View>
  );
}

// ─── 样式 ────────────────────────────────────────
const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8,
  },
  backBtn: { marginRight: 12 },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: "700", color: "#ECEDEE" },
  refreshBtn: { padding: 4 },

  section: { paddingHorizontal: 24, marginTop: 24 },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: "#ECEDEE", marginBottom: 12 },

  // 团队选择器
  teamChip: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: "#1A1A1D", borderWidth: 1, borderColor: "#2A2A2D",
  },
  teamChipActive: { backgroundColor: "#FF6B35", borderColor: "#FF6B35" },
  teamChipText: { color: "#9BA1A6", fontSize: 14, fontWeight: "500" },
  teamChipTextActive: { color: "#fff" },

  // 时间范围
  timeChip: {
    paddingHorizontal: 20, paddingVertical: 8, borderRadius: 20,
    backgroundColor: "#1A1A1D", borderWidth: 1, borderColor: "#2A2A2D",
  },
  timeChipActive: { backgroundColor: "#3B82F6", borderColor: "#3B82F6" },
  timeChipText: { color: "#9BA1A6", fontSize: 14, fontWeight: "500" },
  timeChipTextActive: { color: "#fff" },

  // 指针卡片
  metricsRow: { flexDirection: "row", paddingHorizontal: 24, gap: 12, marginTop: 12 },
  metricCard: {
    flex: 1, backgroundColor: "#1A1A1D", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: "#2A2A2D",
  },
  metricTitle: { color: "#9BA1A6", fontSize: 12, fontWeight: "600" },
  metricValue: { fontSize: 28, fontWeight: "800", marginTop: 8 },
  metricSubtitle: { color: "#9BA1A6", fontSize: 11, marginTop: 2 },

  // 图表卡片
  chartCard: {
    backgroundColor: "#1A1A1D", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: "#2A2A2D",
  },

  // 柱状图 - 成员排行
  barRow: { marginBottom: 16 },
  barLabel: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  barRank: { color: "#FF6B35", fontSize: 14, fontWeight: "700", width: 28 },
  barName: { color: "#ECEDEE", fontSize: 14, fontWeight: "600" },
  barRole: { color: "#9BA1A6", fontSize: 11 },
  barContainer: { paddingLeft: 36 },
  barTrack: {
    height: 20, backgroundColor: "#0A0A0B", borderRadius: 10, overflow: "hidden",
  },
  barFill: { height: 20, borderRadius: 10, minWidth: 4 },
  barStats: { flexDirection: "row", gap: 6, marginTop: 4, alignItems: "center" },
  barValue: { color: "#ECEDEE", fontSize: 13, fontWeight: "700" },
  barTotal: { color: "#9BA1A6", fontSize: 12 },
  barPercent: { fontSize: 12, fontWeight: "700" },

  // 环形图仿真
  donutContainer: { gap: 12 },
  donutRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  donutDot: { width: 10, height: 10, borderRadius: 5 },
  donutLabel: { color: "#ECEDEE", fontSize: 13 },
  donutBarTrack: {
    flex: 1, height: 16, backgroundColor: "#0A0A0B", borderRadius: 8, overflow: "hidden",
  },
  donutBarFill: { height: 16, borderRadius: 8, minWidth: 4 },
  donutPercent: { color: "#ECEDEE", fontSize: 13, fontWeight: "700" },
  donutCredits: { color: "#9BA1A6", fontSize: 11 },

  // 功能表格
  featureTable: { marginTop: 16, borderTopWidth: 1, borderTopColor: "#2A2A2D", paddingTop: 12 },
  featureTableHeader: { flexDirection: "row", paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "#2A2A2D" },
  featureTableCell: { color: "#9BA1A6", fontSize: 12, fontWeight: "600" },
  featureTableRow: { flexDirection: "row", paddingVertical: 8, alignItems: "center" },
  featureTableDot: { width: 8, height: 8, borderRadius: 4 },
  featureTableLabel: { color: "#ECEDEE", fontSize: 13 },
  featureTableValue: { color: "#ECEDEE", fontSize: 14, fontWeight: "600" },
  featureTableCredits: { color: "#FF6B35", fontSize: 14, fontWeight: "700" },

  // 趋势图
  trendChart: { flexDirection: "row", gap: 8 },
  trendYAxis: { justifyContent: "space-between", height: 120, paddingRight: 4 },
  trendYLabel: { color: "#9BA1A6", fontSize: 10, textAlign: "right" },
  trendBars: { flex: 1, flexDirection: "row", alignItems: "flex-end", gap: 2, justifyContent: "space-around" },
  trendBarCol: { alignItems: "center" },
  trendBar: { borderRadius: 4 },
  trendXLabel: { color: "#9BA1A6", fontSize: 9, marginTop: 4, transform: [{ rotate: "-45deg" }] },
  trendSummary: {
    flexDirection: "row", justifyContent: "space-around", marginTop: 16,
    paddingTop: 12, borderTopWidth: 1, borderTopColor: "#2A2A2D",
  },
  trendSummaryItem: { alignItems: "center" },
  trendSummaryLabel: { color: "#9BA1A6", fontSize: 11 },
  trendSummaryValue: { color: "#ECEDEE", fontSize: 15, fontWeight: "700", marginTop: 2 },

  // 成员功能明细
  memberBreakdown: {
    marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: "#2A2A2D",
  },
  memberBreakdownName: { color: "#ECEDEE", fontSize: 15, fontWeight: "700", marginBottom: 8 },
  memberBreakdownRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4, paddingLeft: 8,
  },
  memberBreakdownAction: { color: "#9BA1A6", fontSize: 13 },
  memberBreakdownStats: { color: "#FF6B35", fontSize: 13, fontWeight: "600" },

  emptyText: { color: "#9BA1A6", textAlign: "center", fontSize: 14, paddingVertical: 20 },
});
