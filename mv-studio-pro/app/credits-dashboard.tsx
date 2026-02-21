import { ScrollView, Text, View, TouchableOpacity, ActivityIndicator, FlatList, StyleSheet } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useRouter } from "expo-router";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
// Credits costs are displayed inline, no server import needed

type TabType = "overview" | "transactions" | "usage";

export default function CreditsDashboardScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>("overview");

  const { data: subData, isLoading: subLoading } = trpc.stripe.getSubscription.useQuery(undefined, {
    retry: false,
  });
  const { data: transactions, isLoading: txLoading } = trpc.stripe.getTransactions.useQuery({ limit: 100 });
  const { data: usageLogs, isLoading: usageLoading } = trpc.stripe.getUsageLogs.useQuery({ limit: 100 });

  if (subLoading) {
    return (
      <ScreenContainer className="bg-background">
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator color="#FF6B35" size="large" />
        </View>
      </ScreenContainer>
    );
  }

  const credits = subData?.credits ?? { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 };
  const plan = subData?.plan ?? "free";
  const planConfig = subData?.planConfig;

  return (
    <ScreenContainer className="bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={24} color="#ECEDEE" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Credits 总览</Text>
        </View>

        {/* Balance Card */}
        <View style={styles.balanceCard}>
          <View style={styles.balanceTop}>
            <View>
              <Text style={styles.balanceLabel}>可用 Credits</Text>
              <Text style={styles.balanceAmount}>{credits.balance}</Text>
            </View>
            <TouchableOpacity
              onPress={() => router.push("/pricing" as any)}
              style={styles.topUpBtn}
            >
              <MaterialIcons name="add" size={18} color="#fff" />
              <Text style={styles.topUpBtnText}>加值</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.balanceStats}>
            <View style={styles.balanceStat}>
              <Text style={styles.balanceStatLabel}>累计获得</Text>
              <Text style={styles.balanceStatValue}>{credits.lifetimeEarned}</Text>
            </View>
            <View style={styles.balanceDivider} />
            <View style={styles.balanceStat}>
              <Text style={styles.balanceStatLabel}>累计消耗</Text>
              <Text style={styles.balanceStatValue}>{credits.lifetimeSpent}</Text>
            </View>
            <View style={styles.balanceDivider} />
            <View style={styles.balanceStat}>
              <Text style={styles.balanceStatLabel}>当前方案</Text>
              <Text style={[styles.balanceStatValue, { color: "#FF6B35" }]}>
                {planConfig?.nameCn ?? "免费版"}
              </Text>
            </View>
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <Text style={styles.sectionTitle}>Credits 消耗参考</Text>
          <View style={styles.costGrid}>
            <CostCard icon="analytics" label="视频 PK 评分" cost={8} balance={credits.balance} />
            <CostCard icon="face" label="偶像生成" cost={3} balance={credits.balance} />
            <CostCard icon="movie-creation" label="分镜脚本" cost={15} balance={credits.balance} />
            <CostCard icon="videocam" label="视频生成" cost={25} balance={credits.balance} />
          </View>
        </View>

        {/* Tabs */}
        <View style={styles.tabBar}>
          <TabButton label="交易记录" active={activeTab === "transactions"} onPress={() => setActiveTab("transactions")} />
          <TabButton label="使用日志" active={activeTab === "usage"} onPress={() => setActiveTab("usage")} />
        </View>

        {/* Tab Content */}
        {activeTab === "transactions" && (
          <View style={styles.listContainer}>
            {txLoading ? (
              <ActivityIndicator color="#FF6B35" style={{ marginTop: 20 }} />
            ) : transactions && transactions.length > 0 ? (
              transactions.map((tx: any) => (
                <View key={tx.id} style={styles.listItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listItemTitle}>
                      {tx.source === "purchase" ? "Credits 购买" :
                       tx.source === "subscription" ? "订阅发放" :
                       tx.source === "bonus" ? "管理员赠送" :
                       tx.source === "beta" ? "内测奖励" :
                       tx.source === "referral" ? "邀请奖励" :
                       tx.source === "usage" ? tx.action : tx.source}
                    </Text>
                    <Text style={styles.listItemDate}>
                      {tx.createdAt ? new Date(tx.createdAt).toLocaleString("zh-TW") : ""}
                    </Text>
                  </View>
                  <Text style={[styles.listItemAmount, { color: tx.amount > 0 ? "#22C55E" : "#EF4444" }]}>
                    {tx.amount > 0 ? "+" : ""}{tx.amount}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyText}>暂无交易记录</Text>
            )}
          </View>
        )}

        {activeTab === "usage" && (
          <View style={styles.listContainer}>
            {usageLoading ? (
              <ActivityIndicator color="#FF6B35" style={{ marginTop: 20 }} />
            ) : usageLogs && usageLogs.length > 0 ? (
              usageLogs.map((log: any) => (
                <View key={log.id} style={styles.listItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listItemTitle}>
                      {log.action === "mvAnalysis" ? "视频 PK 评分" :
                       log.action === "idolGeneration" ? "虚拟偶像生成" :
                       log.action === "storyboard" ? "分镜脚本生成" :
                       log.action === "videoGeneration" ? "视频生成" : log.action}
                    </Text>
                    <Text style={styles.listItemDate}>
                      {log.createdAt ? new Date(log.createdAt).toLocaleString("zh-TW") : ""}
                    </Text>
                  </View>
                  <Text style={[styles.listItemAmount, { color: "#EF4444" }]}>
                    -{log.creditsCost}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyText}>暂无使用记录</Text>
            )}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

function CostCard({ icon, label, cost, balance }: { icon: string; label: string; cost: number; balance: number }) {
  const canAfford = balance >= cost;
  const times = Math.floor(balance / cost);
  return (
    <View style={styles.costCard}>
      <MaterialIcons name={icon as any} size={24} color={canAfford ? "#FF6B35" : "#555"} />
      <Text style={[styles.costCardLabel, !canAfford && { color: "#555" }]}>{label}</Text>
      <Text style={styles.costCardCost}>{cost} Credits</Text>
      <Text style={[styles.costCardTimes, { color: canAfford ? "#22C55E" : "#EF4444" }]}>
        可用 {times} 次
      </Text>
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.tabBtn, active && styles.tabBtnActive]}>
      <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  backBtn: { marginRight: 12 },
  headerTitle: { fontSize: 22, fontWeight: "700", color: "#ECEDEE" },

  balanceCard: {
    marginHorizontal: 24, marginTop: 16, backgroundColor: "#1A1A1D",
    borderRadius: 16, padding: 24, borderWidth: 1, borderColor: "#FF6B3533",
  },
  balanceTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  balanceLabel: { color: "#9BA1A6", fontSize: 13 },
  balanceAmount: { color: "#FF6B35", fontSize: 42, fontWeight: "800", marginTop: 4 },
  topUpBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#FF6B35", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8,
  },
  topUpBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },

  balanceStats: {
    flexDirection: "row", marginTop: 20, paddingTop: 16,
    borderTopWidth: 1, borderTopColor: "#2A2A2D",
  },
  balanceStat: { flex: 1, alignItems: "center" },
  balanceStatLabel: { color: "#9BA1A6", fontSize: 12 },
  balanceStatValue: { color: "#ECEDEE", fontSize: 16, fontWeight: "700", marginTop: 4 },
  balanceDivider: { width: 1, backgroundColor: "#2A2A2D", marginHorizontal: 8 },

  quickActions: { paddingHorizontal: 24, marginTop: 24 },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#ECEDEE", marginBottom: 12 },
  costGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  costCard: {
    width: "48%" as any, backgroundColor: "#1A1A1D", borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: "#2A2A2D", alignItems: "center",
  },
  costCardLabel: { color: "#ECEDEE", fontSize: 13, fontWeight: "600", marginTop: 6 },
  costCardCost: { color: "#9BA1A6", fontSize: 12, marginTop: 2 },
  costCardTimes: { fontSize: 12, fontWeight: "600", marginTop: 4 },

  tabBar: {
    flexDirection: "row", marginHorizontal: 24, marginTop: 24,
    backgroundColor: "#1A1A1D", borderRadius: 10, padding: 3,
  },
  tabBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  tabBtnActive: { backgroundColor: "#FF6B35" },
  tabBtnText: { color: "#9BA1A6", fontSize: 14, fontWeight: "600" },
  tabBtnTextActive: { color: "#fff" },

  listContainer: { paddingHorizontal: 24, marginTop: 12 },
  listItem: {
    flexDirection: "row", alignItems: "center", paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: "#1A1A1D",
  },
  listItemTitle: { color: "#ECEDEE", fontSize: 14, fontWeight: "500" },
  listItemDate: { color: "#9BA1A6", fontSize: 12, marginTop: 2 },
  listItemAmount: { fontSize: 16, fontWeight: "700" },
  emptyText: { color: "#9BA1A6", textAlign: "center", marginTop: 20, fontSize: 14 },
});
