import { ScrollView, Text, View, TouchableOpacity, ActivityIndicator, TextInput, StyleSheet, Alert, Platform } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useRouter } from "expo-router";
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/hooks/use-auth";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

export default function AdminFinanceScreen() {
  const router = useRouter();
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

  // Admin add credits form
  const [targetUserId, setTargetUserId] = useState("");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const addCreditsMutation = trpc.stripe.adminAddCredits.useMutation();

  useEffect(() => {
    if (!authLoading && (!isAuthenticated || user?.role !== "admin")) {
      router.replace("/" as any);
    }
  }, [authLoading, isAuthenticated, user]);

  if (!isAuthenticated || user?.role !== "admin") {
    return (
      <ScreenContainer className="bg-background">
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: "#9BA1A6" }}>无权限访问</Text>
        </View>
      </ScreenContainer>
    );
  }

  const handleAddCredits = async () => {
    if (!targetUserId || !creditAmount || !creditReason) {
      const msg = "请填写所有字段";
      if (Platform.OS === "web") { alert(msg); } else { Alert.alert("提示", msg); }
      return;
    }
    try {
      await addCreditsMutation.mutateAsync({
        targetUserId: parseInt(targetUserId),
        amount: parseInt(creditAmount),
        reason: creditReason,
      });
      const msg = `已成功为用户 ${targetUserId} 添加 ${creditAmount} Credits`;
      if (Platform.OS === "web") { alert(msg); } else { Alert.alert("成功", msg); }
      setTargetUserId("");
      setCreditAmount("");
      setCreditReason("");
      refetch();
    } catch (err: any) {
      const msg = err.message || "操作失败";
      if (Platform.OS === "web") { alert(msg); } else { Alert.alert("错误", msg); }
    }
  };

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color="#ECEDEE" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>财务监控 Dashboard</Text>
          <TouchableOpacity onPress={() => router.push("/admin-team-stats" as any)} style={{ marginRight: 8, padding: 4 }}>
            <MaterialIcons name="bar-chart" size={22} color="#A855F7" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => refetch()} style={styles.refreshBtn}>
            <MaterialIcons name="refresh" size={22} color="#FF6B35" />
          </TouchableOpacity>
        </View>

        {isLoading ? (
          <View style={{ paddingTop: 60 }}>
            <ActivityIndicator color="#FF6B35" size="large" />
          </View>
        ) : metrics ? (
          <>
            {/* Key Metrics Row */}
            <View style={styles.metricsRow}>
              <MetricCard
                title="MRR"
                value={`$${metrics.estimatedMRR}`}
                subtitle="月经常性收入"
                icon="trending-up"
                color="#22C55E"
              />
              <MetricCard
                title="ARPU"
                value={`$${metrics.arpu.toFixed(2)}`}
                subtitle="每用户平均收入"
                icon="person"
                color="#3B82F6"
              />
            </View>

            <View style={styles.metricsRow}>
              <MetricCard
                title="订阅用户"
                value={`${metrics.totalSubscribers}`}
                subtitle="活跃订阅"
                icon="people"
                color="#FF6B35"
              />
              <MetricCard
                title="Credits 流通"
                value={`${metrics.totalCreditsBalance}`}
                subtitle="总余额"
                icon="toll"
                color="#A855F7"
              />
            </View>

            {/* Plan Distribution */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>方案分布</Text>
              <View style={styles.planDistribution}>
                {Object.entries(metrics.planCounts).map(([plan, count]) => (
                  <View key={plan} style={styles.planRow}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View style={[styles.planDot, {
                        backgroundColor: plan === "free" ? "#9BA1A6" : plan === "pro" ? "#FF6B35" : "#A855F7"
                      }]} />
                      <Text style={styles.planLabel}>
                        {plan === "free" ? "免费版" : plan === "pro" ? "专业版" : "企业版"}
                      </Text>
                    </View>
                    <Text style={styles.planCount}>{count as number} 人</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Monthly Usage */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>本月使用统计</Text>
              <View style={styles.usageCard}>
                <View style={styles.usageRow}>
                  <Text style={styles.usageLabel}>总操作次数</Text>
                  <Text style={styles.usageValue}>{metrics.monthlyUsage.totalActions}</Text>
                </View>
                <View style={styles.usageRow}>
                  <Text style={styles.usageLabel}>Credits 消耗</Text>
                  <Text style={styles.usageValue}>{metrics.monthlyUsage.totalCredits}</Text>
                </View>
              </View>

              {/* Action Breakdown */}
              {metrics.actionBreakdown.length > 0 && (
                <View style={styles.breakdownCard}>
                  <Text style={styles.breakdownTitle}>功能使用明细</Text>
                  {metrics.actionBreakdown.map((item: any, idx: number) => (
                    <View key={idx} style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>
                        {item.action === "mvAnalysis" ? "视频 PK 评分" :
                         item.action === "idolGeneration" ? "偶像生成" :
                         item.action === "storyboard" ? "分镜脚本" :
                         item.action === "videoGeneration" ? "视频生成" : item.action}
                      </Text>
                      <View style={{ flexDirection: "row", gap: 16 }}>
                        <Text style={styles.breakdownCount}>{item.count} 次</Text>
                        <Text style={styles.breakdownCredits}>{item.totalCredits} Credits</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Revenue */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>本月收入</Text>
              <View style={styles.revenueCard}>
                <View style={styles.revenueRow}>
                  <Text style={styles.revenueLabel}>Credits 购买交易</Text>
                  <Text style={styles.revenueValue}>{metrics.monthlyRevenue.transactionCount} 笔</Text>
                </View>
                <View style={styles.revenueRow}>
                  <Text style={styles.revenueLabel}>Credits 发放量</Text>
                  <Text style={styles.revenueValue}>{metrics.monthlyRevenue.totalCreditsAdded}</Text>
                </View>
              </View>
            </View>

            {/* Recent Transactions */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>最近交易</Text>
              {metrics.recentTransactions.length > 0 ? (
                metrics.recentTransactions.map((tx: any) => (
                  <View key={tx.id} style={styles.txRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.txUser}>用户 #{tx.userId}</Text>
                      <Text style={styles.txMeta}>
                        {tx.source} · {tx.action ?? "-"} · {tx.createdAt ? new Date(tx.createdAt).toLocaleString("zh-TW") : ""}
                      </Text>
                    </View>
                    <Text style={[styles.txAmount, { color: tx.amount > 0 ? "#22C55E" : "#EF4444" }]}>
                      {tx.amount > 0 ? "+" : ""}{tx.amount}
                    </Text>
                  </View>
                ))
              ) : (
                <Text style={styles.emptyText}>暂无交易记录</Text>
              )}
            </View>

            {/* KPI 增强指针 */}
            {kpiData && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>KPI 指针（{kpiData.period}）</Text>
                <View style={styles.metricsRow2}>
                  <View style={styles.kpiCard}>
                    <Text style={styles.kpiLabel}>Trial→Paid</Text>
                    <Text style={[styles.kpiValue, { color: "#22C55E" }]}>{kpiData.trialConversion.conversionRate}%</Text>
                    <Text style={styles.kpiDetail}>{kpiData.trialConversion.trialToPaid}/{kpiData.trialConversion.trialStarts}</Text>
                  </View>
                  <View style={styles.kpiCard}>
                    <Text style={styles.kpiLabel}>Churn Rate</Text>
                    <Text style={[styles.kpiValue, { color: kpiData.churn.churnRate > 10 ? "#EF4444" : "#F59E0B" }]}>{kpiData.churn.churnRate}%</Text>
                    <Text style={styles.kpiDetail}>{kpiData.churn.churnedUsers}/{kpiData.churn.totalPaidUsers}</Text>
                  </View>
                  <View style={styles.kpiCard}>
                    <Text style={styles.kpiLabel}>LTV</Text>
                    <Text style={[styles.kpiValue, { color: "#3B82F6" }]}>${kpiData.revenue.estimatedLTV}</Text>
                    <Text style={styles.kpiDetail}>ARPU ${kpiData.revenue.arpu}</Text>
                  </View>
                </View>
                <View style={[styles.metricsRow2, { marginTop: 10 }]}>
                  <View style={styles.kpiCard}>
                    <Text style={styles.kpiLabel}>退款</Text>
                    <Text style={[styles.kpiValue, { color: "#EF4444" }]}>{kpiData.refunds.count}</Text>
                    <Text style={styles.kpiDetail}>${kpiData.refunds.totalAmount.toFixed(2)}</Text>
                  </View>
                  <View style={styles.kpiCard}>
                    <Text style={styles.kpiLabel}>付款失败</Text>
                    <Text style={[styles.kpiValue, { color: kpiData.paymentFailures > 0 ? "#EF4444" : "#22C55E" }]}>{kpiData.paymentFailures}</Text>
                    <Text style={styles.kpiDetail}>本月</Text>
                  </View>
                  <View style={styles.kpiCard}>
                    <Text style={styles.kpiLabel}>MRR</Text>
                    <Text style={[styles.kpiValue, { color: "#22C55E" }]}>${kpiData.revenue.mrr}</Text>
                    <Text style={styles.kpiDetail}>月经常性收入</Text>
                  </View>
                </View>
              </View>
            )}

            {/* 审计日志 */}
            {auditLogs && auditLogs.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>审计日志（最近 20 条）</Text>
                {auditLogs.map((log: any) => (
                  <View key={log.id} style={styles.auditRow}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <View style={[styles.auditDot, {
                          backgroundColor: log.status === "success" ? "#22C55E" : log.status === "failed" ? "#EF4444" : "#F59E0B"
                        }]} />
                        <Text style={styles.auditAction}>{log.action}</Text>
                      </View>
                      <Text style={styles.auditMeta}>
                        {log.eventType} · {log.userId ? `用户#${log.userId}` : ""} · {log.createdAt ? new Date(log.createdAt).toLocaleString("zh-TW") : ""}
                      </Text>
                    </View>
                    {log.amount !== null && log.amount !== 0 && (
                      <Text style={[styles.auditAmount, { color: log.amount > 0 ? "#22C55E" : "#EF4444" }]}>
                        {log.amount > 0 ? "+" : ""}{(log.amount / 100).toFixed(2)}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* Admin: Add Credits */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>手动添加 Credits</Text>
              <View style={styles.formCard}>
                <TextInput
                  placeholder="用户 ID"
                  placeholderTextColor="#666"
                  value={targetUserId}
                  onChangeText={setTargetUserId}
                  keyboardType="numeric"
                  style={styles.input}
                />
                <TextInput
                  placeholder="Credits 数量"
                  placeholderTextColor="#666"
                  value={creditAmount}
                  onChangeText={setCreditAmount}
                  keyboardType="numeric"
                  style={styles.input}
                />
                <TextInput
                  placeholder="原因"
                  placeholderTextColor="#666"
                  value={creditReason}
                  onChangeText={setCreditReason}
                  style={styles.input}
                />
                <TouchableOpacity
                  onPress={handleAddCredits}
                  disabled={addCreditsMutation.isPending}
                  style={styles.addBtn}
                >
                  {addCreditsMutation.isPending ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.addBtnText}>添加 Credits</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
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

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8,
  },
  backBtn: { marginRight: 12 },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: "700", color: "#ECEDEE" },
  refreshBtn: { padding: 4 },

  metricsRow: { flexDirection: "row", paddingHorizontal: 24, gap: 12, marginTop: 12 },
  metricCard: {
    flex: 1, backgroundColor: "#1A1A1D", borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: "#2A2A2D",
  },
  metricTitle: { color: "#9BA1A6", fontSize: 12, fontWeight: "600" },
  metricValue: { fontSize: 28, fontWeight: "800", marginTop: 8 },
  metricSubtitle: { color: "#9BA1A6", fontSize: 11, marginTop: 2 },

  section: { paddingHorizontal: 24, marginTop: 28 },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: "#ECEDEE", marginBottom: 12 },

  planDistribution: {
    backgroundColor: "#1A1A1D", borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: "#2A2A2D",
  },
  planRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 8,
  },
  planDot: { width: 10, height: 10, borderRadius: 5 },
  planLabel: { color: "#ECEDEE", fontSize: 14 },
  planCount: { color: "#9BA1A6", fontSize: 14, fontWeight: "600" },

  usageCard: {
    backgroundColor: "#1A1A1D", borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: "#2A2A2D",
  },
  usageRow: {
    flexDirection: "row", justifyContent: "space-between", paddingVertical: 8,
  },
  usageLabel: { color: "#9BA1A6", fontSize: 14 },
  usageValue: { color: "#ECEDEE", fontSize: 16, fontWeight: "700" },

  breakdownCard: {
    backgroundColor: "#1A1A1D", borderRadius: 12, padding: 16, marginTop: 12,
    borderWidth: 1, borderColor: "#2A2A2D",
  },
  breakdownTitle: { color: "#9BA1A6", fontSize: 13, marginBottom: 8 },
  breakdownRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6,
  },
  breakdownLabel: { color: "#ECEDEE", fontSize: 14 },
  breakdownCount: { color: "#9BA1A6", fontSize: 13 },
  breakdownCredits: { color: "#FF6B35", fontSize: 13, fontWeight: "600" },

  revenueCard: {
    backgroundColor: "#1A1A1D", borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: "#2A2A2D",
  },
  revenueRow: {
    flexDirection: "row", justifyContent: "space-between", paddingVertical: 8,
  },
  revenueLabel: { color: "#9BA1A6", fontSize: 14 },
  revenueValue: { color: "#22C55E", fontSize: 16, fontWeight: "700" },

  txRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: "#1A1A1D",
  },
  txUser: { color: "#ECEDEE", fontSize: 14, fontWeight: "500" },
  txMeta: { color: "#9BA1A6", fontSize: 12, marginTop: 2 },
  txAmount: { fontSize: 16, fontWeight: "700" },

  formCard: {
    backgroundColor: "#1A1A1D", borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: "#2A2A2D", gap: 10,
  },
  input: {
    backgroundColor: "#0A0A0B", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12,
    color: "#ECEDEE", fontSize: 14, borderWidth: 1, borderColor: "#2A2A2D",
  },
  addBtn: {
    backgroundColor: "#FF6B35", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 4,
  },
  addBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  emptyText: { color: "#9BA1A6", textAlign: "center", fontSize: 14 },

  metricsRow2: { flexDirection: "row", paddingHorizontal: 0, gap: 8 },
  kpiCard: {
    flex: 1, backgroundColor: "#1A1A1D", borderRadius: 10, padding: 12,
    alignItems: "center", borderWidth: 1, borderColor: "#2A2A2D",
  },
  kpiLabel: { color: "#9BA1A6", fontSize: 11, fontWeight: "600" },
  kpiValue: { fontSize: 22, fontWeight: "800", marginTop: 4 },
  kpiDetail: { color: "#9BA1A6", fontSize: 10, marginTop: 2 },

  auditRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "#1A1A1D",
  },
  auditDot: { width: 8, height: 8, borderRadius: 4 },
  auditAction: { color: "#ECEDEE", fontSize: 13, fontWeight: "600" },
  auditMeta: { color: "#9BA1A6", fontSize: 11, marginTop: 2, marginLeft: 14 },
  auditAmount: { fontSize: 14, fontWeight: "700" },
});
